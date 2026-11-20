import {ACCOUNT_SERVICE_URL} from '../core/src/account-service-endpoints.mjs';
const fields=['pluginId','version','name','description','author','packageFormat','permissions','repository','downloadUrl','sha256','sizeBytes','publishedAt'];
const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function verifyMobileArtifact(item,pem,platform){
 if(!/^[a-z][a-z0-9.-]{2,79}$/.test(item.pluginId)||!/^\d+\.\d+\.\d+$/.test(item.version)||!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(item.repository)||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<1||item.sizeBytes>2*1024*1024)throw Error('插件制品身份无效');
 if(item.packageFormat!=='shensi-template-plugin-v1'||!Array.isArray(item.permissions)||item.permissions.length||!Array.isArray(item.platforms)||!item.platforms.includes(platform)||item.platforms.some(p=>!['android','ios','desktop'].includes(p)))throw Error('此插件不能在手机上运行');
 if(item.downloadUrl!=='https://github.com/'+item.repository+'/releases/download/plugin-'+item.pluginId+'-v'+item.version+'/'+item.pluginId+'-'+item.version+'.plugin.json')throw Error('插件下载地址与审核版本不一致');
 if(item.signature?.algorithm!=='Ed25519')throw Error('插件未携带有效审核签名');
 const key=await crypto.subtle.importKey('spki',bytes(pem.replace(/-----[^-]+-----|\s/g,'')),{name:'Ed25519'},false,['verify']);
 const payload=new TextEncoder().encode(JSON.stringify(Object.fromEntries([...fields,'platforms'].map(k=>[k,item[k]]))));
 if(!await crypto.subtle.verify('Ed25519',key,bytes(item.signature.value),payload))throw Error('插件签名不匹配，未安装');return item;
}
export function validateMobileTemplate(pkg,item,platform = 'android'){
 if(pkg?.format!=='shensi-template-plugin-v1'||pkg.id!==item.pluginId||pkg.version!==item.version||pkg.code||pkg.scripts||pkg.entry||pkg.permissions?.length||(!Array.isArray(pkg.platforms)||!pkg.platforms.includes(platform))||!Array.isArray(pkg.templates)||!pkg.templates.length||pkg.templates.length>50)throw Error('插件不是受支持的无代码模板');
 const ids=new Set();for(const t of pkg.templates){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(t.id)||ids.has(t.id)||t.kind!=='note'||typeof t.name!=='string'||t.name.length>100||typeof t.markdown!=='string'||t.markdown.length>500000)throw Error('此手机版仅运行文档模板；未安装不兼容内容');ids.add(t.id);}
 return structuredClone(pkg);
}
export function createMobileMarketplaceClient({fetchImpl=fetch,artifactFetch=fetch,secureVault,metadata,platform,timeoutMs=10000}={}){
 if(!['android','ios'].includes(platform))throw Error('需要明确手机平台');
 async function request(path){let timer;const controller=new AbortController();try{return await Promise.race([(async()=>{const response=await fetchImpl(ACCOUNT_SERVICE_URL+path,{redirect:'error',credentials:'omit',signal:controller.signal});if(!response.ok)throw Error('插件广场连接失败（HTTP '+response.status+'）');const reader=response.body.getReader(),parts=[];let size=0;for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>4*1024*1024){await reader.cancel();throw Error('目录响应过大');}parts.push(p.value);}const all=new Uint8Array(size);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}return JSON.parse(new TextDecoder().decode(all));})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('插件广场连接超时，请检查网络后重试'));},timeoutMs);})]);}finally{clearTimeout(timer);}}
 async function catalog(){const c=await request('/v1/plugins/config');if(c.mode!=='plugin-marketplace'||!String(c.publicKeyPem).includes('PUBLIC KEY'))throw Error('广场配置不完整');const key='shensi.mobile.marketplace.trust',old=await secureVault.get(key);if(old&&old!==c.publicKeyPem)throw Error('广场签名公钥变化，需要管理员核对');const result=await request('/v1/plugins/catalog?platform='+platform+'&limit=100');if(result.platform!==platform||!Array.isArray(result.items)||result.items.length>100||!Number.isSafeInteger(result.total))throw Error('广场未返回正确手机分区');for(const item of result.items)await verifyMobileArtifact(item,c.publicKeyPem,platform);if(!old)await secureVault.set(key,c.publicKeyPem);return {...result,publishReady:c.publishReady===true};}
 const stored=async()=>{if(!metadata)throw Error('需要原生插件存储');return await metadata.get('mobile-plugins')||[];};
 async function checkPackage(row){const pem=await secureVault.get('shensi.mobile.marketplace.trust');await verifyMobileArtifact(row.artifact,pem,platform);const bytes=new TextEncoder().encode(row.text),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(bytes.length!==row.artifact.sizeBytes||hash!==row.artifact.sha256)throw Error('插件内容校验失败');return validateMobileTemplate(JSON.parse(row.text),row.artifact,platform);}
 let busy=false;
 const change=async fn=>{if(busy)throw Error('已有插件操作正在进行');busy=true;try{return await fn();}finally{busy=false;}};
 return {catalog,
  installed:async()=>{const rows=await stored(),result=[];for(const row of rows)result.push({artifact:row.artifact,package:await checkPackage(row)});return result;},
  install:item=>change(async()=>{
   const fresh=(await catalog()).items.find(r=>r.pluginId===item.pluginId&&r.version===item.version&&r.sha256===item.sha256);if(!fresh)throw Error('广场版本已变化或下架，请刷新');
   let url=fresh.downloadUrl,text;
   for(let step=0;step<5;step++){
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('插件下载来源不可信');
    const response=await artifactFetch(url,{redirect:'manual',credentials:'omit',headers:{Accept:'application/octet-stream'},signal:AbortSignal.timeout(30000)});
    if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('插件重定向无效');url=new URL(location,url).href;continue;}
    if(!response.ok)throw Error('插件下载失败（HTTP '+response.status+'）');
    const reader=response.body.getReader(),parts=[];let length=0;for(;;){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>fresh.sizeBytes){await reader.cancel();throw Error('插件大小不符');}parts.push(p.value);}const all=new Uint8Array(length);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}text=new TextDecoder('utf-8',{fatal:true}).decode(all);break;
   }
   if(text===undefined)throw Error('插件重定向次数过多');const row={artifact:fresh,text};await checkPackage(row);const rows=await stored(),next=[...rows.filter(r=>r.artifact.pluginId!==fresh.pluginId),row];if(new TextEncoder().encode(JSON.stringify(next)).length>3*1024*1024)throw Error('移动端插件存储超过本测试版上限');await metadata.set('mobile-plugins',next);return {installed:true,pluginId:fresh.pluginId};
  }),
  uninstall:pluginId=>change(async()=>{const rows=await stored();await metadata.set('mobile-plugins',rows.filter(r=>r.artifact.pluginId!==pluginId));return {removed:true,documentsRetained:true};}),
  async run({pluginId,templateId,documents,notebookId}){const row=(await stored()).find(r=>r.artifact.pluginId===pluginId);if(!row)throw Error('插件未安装');const pkg=await checkPackage(row),template=pkg.templates.find(t=>t.id===templateId);if(!template)throw Error('模板不存在');const current=await documents.load(notebookId);if(!current.state)throw Error('请先选择笔记本');return documents.createDocument(notebookId,{documentId:'note-'+crypto.randomUUID(),title:template.name,markdown:template.markdown,expectedRevision:current.revision,operationId:'template-'+crypto.randomUUID()});}
 };
}
