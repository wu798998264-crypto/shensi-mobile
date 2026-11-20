import {join} from 'node:path';
import {jsonStore} from './json-store.mjs';
import {validatePluginPackage} from './plugin-package.mjs';
import {verifyArtifact,readLimited,comparePluginVersions,downloadGitHubArtifact} from './plugin-artifacts.mjs';
import {pluginPlatforms,pluginSupportsPlatform} from './plugin-platforms.mjs';
import {LEGACY_ACCOUNT_SERVICE_URL,accountEndpoint} from './account-service-endpoints.mjs';

const packageFormats=['shensi-template-plugin-v1','shensi-script-plugin-v1','shensi-skill-plugin-v1'];
export const usesMarketplaceUpdates=record=>!!record&&record.category==='third-party'&&!record.available&&(!!record.marketplace||!record.builtin&&packageFormats.includes(record.package?.format)&&!record.updateChannel?.repository&&!record.package?.updates?.url&&!record.package?.updateUrl);

export function createPluginMarketplaceClient({service,models,plugins,allPlugins=()=>plugins.list(),publicCatalog,beforeReplace=async()=>{},afterReplace=()=>{},baseUrl=process.env.SHENSI_NOTES_ACCOUNT_URL||LEGACY_ACCOUNT_SERVICE_URL,fetchImpl=fetch,platform='desktop'}={}){
 pluginSupportsPlatform({},platform);if(platform==='mobile')throw Error('安装端必须明确 android 或 ios，不允许用汇总分区安装');
 let address;try{address=accountEndpoint(baseUrl,{allowLoopback:true});}catch{throw Error('插件广场地址无效');}const {issuer,serviceBaseUrl}=address;
 const trust=jsonStore(join(service.dataRoot,'machine/plugin-marketplace-trust.json'),{}),custom=jsonStore(join(service.dataRoot,'plugins/custom-plugins.json'),{revision:0,items:[]});
 const previewCache=jsonStore(join(service.dataRoot,'machine/plugin-marketplace-preview.json'),{issuer,platform,items:[]});
 const publicItem=p=>p.accessTier!=='vip'&&p.pluginId!=='thirdparty.fenjue';
 const installedRecord=p=>!(p.nativeUninstalledVersion&&p.nativeUninstalledVersion===(p.nativeInstalledVersion||p.version)&&!p.pendingVersion)&&(!!p.pendingVersion||!!p.nativeInstalledVersion||!p.available&&p.installed!==false);
 async function installedItems(items){const records=await allPlugins();return items.map(item=>{const record=records.find(p=>p.id===item.pluginId),p=record&&installedRecord(record)?record:null;return {...item,installedVersion:p?.pendingVersion||p?.nativeInstalledVersion||p?.version||'',installedCodeVersion:!p&&(record?.nativeAvailableVersion||record?.nativeUninstalledVersion)||'',updateState:p?.updateState||null,canUninstall:!!p&&(p.category==='third-party'||p.id==='thirdparty.calendar')};});}
 const auth=async()=>{const raw=await models?.secret('member-login');if(!raw)throw Error('请先在账户设置登录后上传插件');const value=JSON.parse(raw);if(value.issuer!==issuer||!value.token)throw Error('请登录此广场对应的神思账号');return value;};
 const request=async(path,{body,authenticated=false}={})=>{const login=authenticated?await auth():null;let response;try{response=await fetchImpl(serviceBaseUrl+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/json','User-Agent':'Shensi-Notes-Plugin-Marketplace',...(body?{'Content-Type':'application/json'}:{}),...(login?{Authorization:'Bearer '+login.token}:{})},body:body?JSON.stringify(body):undefined});}catch(error){throw Error('插件广场连接失败，请检查网络后重试');}let value;try{value=JSON.parse((await readLimited(response,4*1024*1024)).toString());}catch{throw Error('广场未返回有效数据');}if(!response.ok)throw Error(response.status===404?'云端尚未部署插件广场接口':response.status===401?'请重新登录神思账号':String(value.message||'广场请求未完成'));return value;};
 async function config(){const result=await request('/v1/plugins/config');if(result.mode!=='plugin-marketplace'||!String(result.publicKeyPem||'').includes('PUBLIC KEY'))throw Error('此云端尚未切换为插件广场');await trust.update(state=>{if(state[issuer]&&state[issuer]!==result.publicKeyPem)throw Error('广场签名公钥发生变化，已拒绝下载，请联系管理员核对');state[issuer]=result.publicKeyPem;return state;});return result;}
 async function catalog(body={}){let authenticated=false;try{await auth();authenticated=true;}catch{}const configuration=await config(),result=await request('/v1/plugins/catalog?'+new URLSearchParams({q:body.query||'',offset:body.offset||0,limit:100,sort:body.sort||'updated',platform}),{authenticated});if(!Array.isArray(result.items)||result.items.length>100)throw Error('插件目录无效');for(const item of result.items){verifyArtifact(item,configuration.publicKeyPem);if(!pluginSupportsPlatform(item,platform))throw Error('广场返回不兼容当前平台的插件');}return {...result,items:await installedItems(result.items),issuer};}
 async function install(body){const authenticated=await auth().then(()=>true,()=>false),configuration=await config(),result=await request('/v1/plugins/artifacts/'+encodeURIComponent(body.pluginId)+'/'+encodeURIComponent(body.version)+'?platform='+platform,{authenticated}),artifact=verifyArtifact(result.artifact,configuration.publicKeyPem);
  if(!pluginSupportsPlatform(artifact,platform))throw Error('此插件不支持当前平台，未下载或执行');
  if(artifact.pluginId!==body.pluginId||artifact.version!==body.version||body.expectedSha256&&artifact.sha256!==body.expectedSha256)throw Error('待安装版本与确认的审核制品不一致，请重新检查更新');
  if((await allPlugins()).some(p=>p.id===artifact.pluginId&&p.builtin))throw Error('此插件使用专用安装入口，不能用通用广场包覆盖');
  const bytes=await downloadGitHubArtifact(artifact,{fetchImpl}),pkg=validatePluginPackage(JSON.parse(bytes));
  if(pkg.id!==artifact.pluginId||pkg.version!==artifact.version||pkg.format!==artifact.packageFormat||JSON.stringify(pkg.permissions||[])!==JSON.stringify(artifact.permissions))throw Error('下载包与审核身份不一致');
  if(!pluginSupportsPlatform(pkg,platform)||JSON.stringify(pluginPlatforms(pkg))!==JSON.stringify(pluginPlatforms(artifact)))throw Error('包内平台与审核签名不一致');
  const previous=(await plugins.list()).find(p=>p.id===pkg.id);if(previous?.marketplace?.issuer&&previous.marketplace.issuer!==issuer)throw Error('此插件来自其他广场，请使用原广场更新');if(previous&&body.expectedVersion!==previous.version)throw Error('已安装版本发生变化，请刷新后更新');if(pkg.format==='shensi-script-plugin-v1'&&body.grantFullAccess!==true)throw Error('请先明确允许此脚本插件运行本地代码');
  let installed;if(previous)await beforeReplace(pkg.id);try{installed=await plugins.install({package:pkg,grantFullAccess:body.grantFullAccess,replace:!!previous,expectedVersion:body.expectedVersion,marketplace:{issuer,repository:artifact.repository,version:artifact.version,sha256:artifact.sha256}});}finally{if(previous)afterReplace(pkg.id);}try{await request('/v1/plugins/'+encodeURIComponent(pkg.id)+'/acquisitions',{authenticated:true,body:{version:artifact.version,sha256:artifact.sha256}});}catch{}return installed;
 }
 async function handle(name,body={}){
  if(name==='catalog-preview'){
   const saved=await previewCache.read(),seed=await publicCatalog?.peek?.()||[],records=await allPlugins();
   const existing=records.filter(p=>installedRecord(p)&&p.category==='third-party'&&p.id!=='thirdparty.fenjue').map(p=>({pluginId:p.id,name:p.name,description:p.description||'已安装的扩展插件',version:p.pendingVersion||p.nativeInstalledVersion||p.version,author:'神思',publishedAt:p.installedAt||'',packageFormat:p.package?.format,source:'installed',permissions:p.package?.permissions||[]}));
   const items=[...new Map([...existing,...saved.issuer===issuer&&saved.platform===platform?saved.items.filter(publicItem):[],...seed.filter(publicItem)].map(p=>[p.pluginId,p])).values()];return {items:await installedItems(items),nextOffset:null,issuer,cached:true};
  }
  if(name==='check-update'){
   const installed=(await plugins.list()).find(p=>p.id===body.pluginId);if(!installed||!packageFormats.includes(installed.package?.format))throw Error('请选择已安装的广场兼容插件');
   if(installed.marketplace?.issuer&&installed.marketplace.issuer!==issuer)throw Error('此插件来自其他广场，请使用原广场检查更新');
   let offset=0,found;do{const page=await catalog({query:installed.id,offset});found=page.items.find(p=>p.pluginId===installed.id);if(found||page.nextOffset===null)break;if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw Error('插件目录分页无效');offset=page.nextOffset;}while(true);
   const available=!!found&&comparePluginVersions(found.version,installed.version)>0;
   return {pluginId:installed.id,source:'marketplace',status:available?'available':found?'up_to_date':'unavailable',checkedAt:new Date().toISOString(),available,currentVersion:installed.version,latestVersion:found?.version||'',repository:found?.repository||installed.marketplace?.repository||'',...(available?{update:{...found,installedVersion:installed.version,sourceChange:!installed.marketplace}}:{}),message:!found?'此插件在广场中尚未发布或已下架':available?'发现已审核的新版本 '+found.version:'已是广场中的最新版本'};
  }
  if(name==='status')return {issuer,...await config()};
  if(name==='catalog'&&publicCatalog){
   const [community,publicRows]=await Promise.allSettled([catalog(body),publicCatalog.list()]);if(community.status==='rejected'&&publicRows.status==='rejected')throw Error('插件目录暂不可读取，请稍后重试');
   const q=String(body.query||'').toLowerCase(),items=[...(community.status==='fulfilled'?community.value.items:[]),...(publicRows.status==='fulfilled'?publicRows.value.filter(p=>[p.pluginId,p.name,p.description].join(' ').toLowerCase().includes(q)):[])];
   const unique=await installedItems([...new Map(items.map(p=>[p.pluginId,p])).values()]);
   if(!q&&!body.offset)await previewCache.update(()=>({issuer,platform,items:unique.filter(publicItem)}));
   return {items:unique,nextOffset:community.status==='fulfilled'?community.value.nextOffset:null,issuer,...community.status==='rejected'?{notice:'社区目录暂不可读取，仍可使用官方签名扩展'}:{}};
  }
  if(name==='catalog'){const result=await catalog(body);if(!body.query&&!body.offset)await previewCache.update(()=>({issuer,platform,items:result.items.filter(publicItem)}));return result;}
  if(name==='mine')return request('/v1/plugins/mine',{authenticated:true});
  if(name==='reviews'){let authenticated=false;try{await auth();authenticated=true;}catch{}return request('/v1/plugins/'+encodeURIComponent(body.pluginId)+'/reviews',{authenticated});}
  if(name==='review'){const installed=(await plugins.list()).find(p=>p.id===body.pluginId);if(installed?.marketplace?.issuer!==issuer)throw Error('请先安装此广场的插件后评价');await request('/v1/plugins/'+encodeURIComponent(body.pluginId)+'/acquisitions',{authenticated:true,body:{version:installed.marketplace.version,sha256:installed.marketplace.sha256}});return request('/v1/plugins/'+encodeURIComponent(body.pluginId)+'/reviews',{authenticated:true,body:{rating:body.rating,comment:body.comment}});}
  if(name==='custom-list')return custom.read();
  if(name==='custom-save'){const pkg=validatePluginPackage(body.package);return custom.update(state=>{if(body.expectedRevision!==state.revision)throw Error('自定义插件已在其他页面修改，请重新打开');const index=state.items.findIndex(p=>p.package.id===pkg.id&&p.package.version===pkg.version),record={id:pkg.id+'@'+pkg.version,package:pkg,updatedAt:new Date().toISOString()};if(index<0)state.items.push(record);else state.items[index]=record;state.revision++;return state;});}
  if(name==='custom-install'){const entry=(await custom.read()).items.find(p=>p.id===body.customId);if(!entry)throw Error('自定义插件已不存在');if(!pluginSupportsPlatform(entry.package,platform))throw Error('此插件不支持当前平台，未安装或执行');const previous=(await plugins.list()).find(p=>p.id===entry.package.id);if(previous&&previous.version!==body.expectedVersion)throw Error('已安装版本发生变化，请刷新后更新');if(previous)await beforeReplace(entry.package.id);try{return await plugins.install({package:entry.package,grantFullAccess:body.grantFullAccess,replace:!!previous,expectedVersion:body.expectedVersion});}finally{if(previous)afterReplace(entry.package.id);}}
  if(name==='submit'){let pkg;if(body.customId)pkg=(await custom.read()).items.find(p=>p.id===body.customId)?.package;else if(body.pluginId)pkg=(await plugins.list()).find(p=>p.id===body.pluginId)?.package;else pkg=body.package;if(!pkg)throw Error('请先保存或选择插件包');return request('/v1/plugins/submissions',{body:{package:validatePluginPackage(pkg)},authenticated:true});}
  if(name==='install')return install(body);
  throw Error('未知插件广场操作');
 }
 return {handle,issuer};
}
