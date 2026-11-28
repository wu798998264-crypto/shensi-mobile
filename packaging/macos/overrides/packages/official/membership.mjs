import {join} from 'node:path';
import {readFile,stat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jsonStore,failure} from './store.mjs';
import {sealMemberData,openMemberData} from './member-seal.mjs';
import {createCloudFileClient} from '../mobile/cloud-sync-client.mjs';
import {cloudSyncStatus as readCloudStatus} from '../core/src/cloud-sync-status.mjs';
import {ACCOUNT_SERVICE_URL,accountEndpoint,accountSessionRejected} from '../core/src/account-service-endpoints.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const accountErrors={EMAIL_DOMAIN_TYPO:'请核对收件地址，QQ 邮箱的后缀是 qq.com。',EMAIL_UNAVAILABLE:'邮箱服务暂不可用，请稍后重试或使用密码登录',EMAIL_SEND_FAILED:'验证码邮件未能发送，请稍后重试',EMAIL_RATE_LIMIT:'发送过于频繁，请稍后重试',EMAIL_DAILY_LIMIT:'今日验证码发送次数已达上限',EMAIL_BUSY:'验证码正在发送，请稍候',EMAIL_CODE_INVALID:'验证码错误或已过期，请重新获取',EMAIL_BIND_REQUIRED:'该邮箱尚未验证绑定，请先用原账号密码登录',EMAIL_INVALID:'请输入有效邮箱'};
const publicAccount=user=>({id:String(user.id||''),account:String(user.account||''),displayName:String(user.displayName||'神思用户'),email:String(user.email||''),emailVerifiedAt:Number(user.emailVerifiedAt)||0,hasPassword:user.hasPassword===true,avatar:typeof user.avatar==='string'&&user.avatar.startsWith('data:image/png;base64,')&&user.avatar.length<=180000?user.avatar:'',role:String(user.role||'user')});
const sameProfile=(a,b)=>['id','channel','model','protocol','baseUrl'].every(k=>a?.[k]===b?.[k]);
const balance=value=>{if(!Number.isSafeInteger(value?.available)||value.available<0||!Number.isSafeInteger(value?.reserved)||value.reserved<0)throw failure('会员积分响应无效');return {available:value.available,reserved:value.reserved};};
const profile=value=>{
 if(!value||! /^[a-zA-Z0-9_.-]{1,80}$/.test(value.id)||!['text','image','video','audio'].includes(value.channel)||!['chat_completions','responses','anthropic_messages'].includes(value.protocol)||typeof value.name!=='string'||typeof value.model!=='string')throw failure('会员模型响应无效');
 const u=new URL(value.baseUrl);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw failure('会员模型接口无效');
 return Object.fromEntries(['id','name','channel','model','protocol','baseUrl','provider'].map(k=>[k,String(value[k]||'').slice(0,4000)]));
};

export function createMembershipService({dataRoot,models,accountBaseUrl=process.env.SHENSI_NOTES_ACCOUNT_URL||ACCOUNT_SERVICE_URL}={}){
 let address;try{address=accountEndpoint(accountBaseUrl,{allowLoopback:true});}catch(error){throw failure(error.message);}
 const {issuer,serviceBaseUrl}=address,controller=new AbortController();let queue=Promise.resolve(),verifiedSession='',verifiedComputeSession='',closed=false,lastError='';
 let cloudSession='',cloudStatus={state:'unverified',checkedAt:'',message:'云空间尚未联网核验'};
 const serial=(fn,signal)=>{const pending=queue.catch(()=>{}).then(()=>{if(closed)throw failure('会员服务已关闭');if(signal?.aborted)throw failure('任务已停止','ABORTED');return fn();});queue=pending;if(!signal)return pending;return new Promise((resolve,reject)=>{const abort=()=>reject(failure('任务已停止','ABORTED'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});};
 const readSecret=async(key,initial)=>{const value=await models.secret(key);return value?JSON.parse(value):initial;};
 const stateKey=id=>'member-state.'+hash(issuer+'\n'+id);
 const login=()=>readSecret('member-login',null);
 const empty=()=>({issuer,memberId:'',keys:[],quota:null,checkedAt:''});
 const state=async()=>{const auth=await login();if(!auth?.user?.id||auth.issuer!==issuer)return empty();return await readSecret(stateKey(auth.user.id),null)||{...empty(),memberId:auth.user.id};};
 const saveState=s=>models.putSecret(stateKey(s.memberId),JSON.stringify(s));
 const fileFor=memberId=>join(dataRoot,'member-models',hash(issuer+'\n'+memberId)+'.sealed.json');
 const sealedFiles=async memberId=>{const pattern=new RegExp('^'+hash(issuer+'\n'+memberId)+'\\.sealed(?:\\.conflict-remote-[a-f0-9]{8})?\\.json$');return (await readdir(join(dataRoot,'member-models')).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(name=>pattern.test(name)).sort().map(name=>join(dataRoot,'member-models',name));};
 const requireLogin=async()=>{const auth=await login();if(!auth?.token||auth.issuer!==issuer)throw failure('请先登录神思会员账号','MEMBER_LOGIN_REQUIRED');return auth;};
 async function request(path,{token,body,signal}={}){
  const timeoutMs=path==='/v1/auth/email-code'?30000:path==='/v1/cloud-sync/status'?5000:15000;
  let response;try{response=await fetch(serviceBaseUrl+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])])});}catch(error){if(signal?.aborted)throw failure('任务已停止','ABORTED');const code=error.cause?.code||error.code;throw failure(path==='/v1/auth/email-code'?'验证码发送结果尚未确认，请先检查收件箱和垃圾邮件，稍后再试。':code==='ECONNRESET'?'与原神思账号服务的安全连接被中断，请检查网络或代理后重试':error.name==='TimeoutError'?'连接原神思账号服务超时，请检查网络或代理后重试':'无法连接神思账号服务，请检查网络后重试','MEMBER_SERVICE_UNAVAILABLE');}
  const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.byteLength;if(size>1024*1024)throw failure('账号服务响应超过限制');chunks.push(chunk);}const bytes=Buffer.concat(chunks).toString('utf8');let value;try{value=JSON.parse(bytes);}catch{if(response.ok)throw failure('账号服务未提供有效的会员接口','MEMBER_SERVICE_UNAVAILABLE');value={};}
  if(!value||typeof value!=='object'||Array.isArray(value)){if(response.ok)throw failure('账号服务响应格式无效','MEMBER_SERVICE_UNAVAILABLE');value={};}
  if(path==='/v1/auth/me'&&response.status===401){
   const invalid=accountSessionRejected(response.status,value);
   throw Object.assign(failure(invalid?'登录已失效，请重新登录':'账号核验暂时不可用，已保留本机登录，请稍后刷新',invalid?'ACCOUNT_SESSION_INVALID':'MEMBER_SERVICE_UNAVAILABLE'),{statusCode:401});
  }
  if(!response.ok&&(path.startsWith('/v1/auth/')||path.startsWith('/v1/account/')))throw Object.assign(failure(accountErrors[value.code]||({400:'账户信息不完整或格式不正确，请检查后重试',401:'登录已失效或凭证不正确',403:'账号操作未获授权',409:'账号或资料状态已变化，请刷新后重试',429:'请求过于频繁，请稍后重试'}[response.status]||'账户服务暂不可用'),accountErrors[value.code]?value.code:'ACCOUNT_SERVICE_REJECTED'),{statusCode:response.status,retryAfterSeconds:Math.min(86400,Math.max(0,Number(value.retryAfterSeconds)||0))});
  if(!response.ok){const message=response.status===401?'账号登录已失效，请重新登录':response.status===403?'算力权益、密钥归属或有效期核验未通过':response.status===404||response.status===503?'官方模型服务尚未开放或暂不可用':response.status===409?'该签发请求已处理或待核对，请刷新后处理':response.status===429?'请求或会员密钥数量已达上限':'会员操作未完成，请刷新状态核对';throw Object.assign(failure(message,'MEMBER_SERVICE_REJECTED'),{statusCode:response.status});}
  return value;
 }
 async function status(){const auth=await login(),saved=await state(),files=auth?.issuer===issuer?await sealedFiles(auth.user.id):[];
  return {issuer,authenticated:!!auth?.token&&auth.issuer===issuer,user:auth?.issuer===issuer?(saved.publicUser?.id===auth.user.id?saved.publicUser:auth.user):null,membership:saved.memberId===auth?.user?.id?saved.membership:null,quota:saved.memberId===auth?.user?.id?saved.quota:null,checkedAt:saved.memberId===auth?.user?.id?saved.checkedAt:'',cached:verifiedSession!==auth?.token,models:saved.memberId===auth?.user?.id?saved.catalog||[]:[],enabled:saved.memberId===auth?.user?.id&&saved.catalogEnabled===true,keys:saved.memberId===auth?.user?.id?saved.remoteKeys||[]:[],localKeyIds:saved.memberId===auth?.user?.id?saved.keys.map(k=>k.key.id):[],sealedAvailable:files.length>0,sealedCopies:files.length,unlockRemembered:!!await models.secret('member-sync-unlock'),lastError};
 }
 async function modelAccess(){
  const auth=await login(),saved=await state(),authenticated=!!auth?.token&&auth.issuer===issuer,verified=authenticated&&saved.memberId===auth.user.id&&verifiedComputeSession===auth.token;
  const compute=verified?saved.compute:null,entitled=compute?.entitled===true&&(!compute.expiresAt||compute.expiresAt>Date.now());
  const status=!authenticated?'login_required':!verified?'unverified':!entitled?compute?.purchased?'inactive':'purchase_required':!saved.catalogEnabled?'service_unavailable':'available';
  const message={login_required:'请先登录神思账号，再购买算力积分套餐。可在账户页查看算力权益。',unverified:'算力购买状态尚未联网核实，请刷新账号状态；不会使用缓存解锁官方模型。',purchase_required:'请购买算力积分套餐后使用官方模型。购买开放状态及可用套餐请查看账户页。',inactive:'算力套餐已到期或暂停，请核对套餐权益；已有积分与流水保留。',service_unavailable:'已购买算力套餐；官方模型供应暂未提供服务。',available:'官方算力已解锁，使用真实供应目录；积分不足时不能生成。'}[status];
  return {id:'official-compute',name:'官方算力',status,locked:!entitled,entitled,message,issuer,memberId:authenticated?auth.user.id:'',enabled:entitled&&saved.catalogEnabled===true,
   ...(verified&&entitled&&saved.catalogEnabled&&Number.isSafeInteger(saved.quota?.available)?{credit:saved.quota.available,creditUpdatedAt:saved.checkedAt}:{}),activeKeys:verified?(saved.remoteKeys||[]).filter(k=>k.status==='active'&&k.expiresAt>Date.now()).map(k=>k.id):[]};
 }
 async function refreshCloudStatus(auth){
  cloudSession=auth.token;
  try{
   const result=await request('/v1/cloud-sync/status',{token:auth.token});
   cloudStatus=readCloudStatus(result);
  }catch(error){cloudStatus={state:'unavailable',message:error.statusCode===401?'账号登录已失效，请重新登录':'官方云空间连接未完成：'+error.message,checkedAt:new Date().toISOString()};}
 }
 async function accountStatus(){const full=await status(),auth=await login(),officialConfiguration=await modelAccess(),cloud=full.authenticated?(cloudSession===auth?.token&&verifiedSession===auth?.token?cloudStatus:{state:'unverified',checkedAt:'',message:'云空间尚未联网核验'}):{state:'login_required',checkedAt:'',message:'请先登录神思账号'};return {issuer,serviceBaseUrl,authenticated:full.authenticated,user:full.user,checkedAt:full.checkedAt,cached:full.cached,lastError:full.lastError,officialConfiguration,cloudSyncStatus:{...cloud},services:{cloudSync:cloud.state==='available',computeCredits:officialConfiguration.enabled===true}};}
 async function authenticatedUser(auth){
  try{const me=await request('/v1/auth/me',{token:auth.token});if(typeof me?.user?.id!=='string'||!me.user.id.trim())throw failure('账号核验响应不完整，已保留本机登录','ACCOUNT_INVALID_RESPONSE');if(me.user.id!==auth.user.id)throw Object.assign(failure('账号身份发生变化，请重新登录','ACCOUNT_MISMATCH'),{statusCode:401});return me;}
  catch(error){if(['ACCOUNT_SESSION_INVALID','ACCOUNT_MISMATCH'].includes(error.code)){const current=await login();if(current?.token===auth.token&&current?.issuer===auth.issuer){await models.putSecret('member-login','');await models.putSecret('member-sync-unlock','');verifiedSession='';verifiedComputeSession='';cloudSession='';}}throw error;}
 }
 async function refreshAccount(){const auth=await requireLogin();try{const me=await authenticatedUser(auth);const saved=await state();await saveState({...saved,issuer,memberId:auth.user.id,publicUser:publicAccount(me.user),checkedAt:new Date().toISOString()});verifiedSession=auth.token;lastError='';
   // Account login must work even while commercial services are unavailable.
   await Promise.all([refresh().catch(async error=>{verifiedComputeSession='';const current=await login();if(current?.token===auth.token){verifiedSession=auth.token;lastError='';}else throw error;}),refreshCloudStatus(auth)]);return accountStatus();
  }catch(error){verifiedSession='';verifiedComputeSession='';lastError=error.message;throw error;}}
 async function refresh(){const auth=await requireLogin();try{
  const me=await authenticatedUser(auth);
  const [member,quota]=await Promise.all([request('/v1/membership',{token:auth.token}),request('/v1/quota',{token:auth.token})]);
  let catalog=null;try{catalog=await request('/v1/member-models',{token:auth.token});}catch(e){if(![404,503].includes(e.statusCode))throw e;}
  if(catalog&&(!Array.isArray(catalog.keys)||catalog.keys.length>500||!Array.isArray(catalog.models)||catalog.models.length>100))throw failure('会员模型目录响应无效');
  let compute=catalog?.compute;if(!compute)try{compute=(await request('/v1/compute/entitlement',{token:auth.token})).compute;}catch(e){if(![404,503].includes(e.statusCode))throw e;}
  if(compute&&(typeof compute.entitled!=='boolean'||typeof compute.purchased!=='boolean'||!Number.isSafeInteger(compute.expiresAt)||compute.expiresAt<0))throw failure('算力权益响应无效');
  const old=await state(),remoteKeys=catalog?.keys||old.remoteKeys||[],next={...old,issuer,memberId:auth.user.id,publicUser:publicAccount(me.user),keys:(old.memberId===auth.user.id?old.keys:[]).filter(item=>!catalog||remoteKeys.some(k=>k.id===item.key.id&&k.status==='active'&&k.expiresAt>Date.now())),quota:balance(quota),membership:member.membership,compute:compute||null,catalog:catalog?(catalog.models||[]).map(profile):old.catalog||[],catalogEnabled:catalog?.enabled===true,remoteKeys,checkedAt:new Date().toISOString()};
  await saveState(next);verifiedSession=auth.token;verifiedComputeSession=compute?auth.token:'';lastError='';return status();
 }catch(e){verifiedComputeSession='';verifiedSession='';lastError=e.message;throw e;}}
 async function verify(auth,item,signal){
  if(!item?.key?.id||typeof item.apiKey!=='string'||item.apiKey.length>32000)throw failure('会员同步密钥格式无效');
  const result=await request('/v1/member-models/verify',{token:auth.token,body:{keyId:item.key.id,apiKey:item.apiKey},signal}),p=profile(result.profile);
  if(result.memberId!==auth.user.id||result.key?.id!==item.key.id||result.key.status!=='active'||!Number.isSafeInteger(result.key.expiresAt)||result.key.expiresAt<=Date.now()||!sameProfile(p,item.profile))throw failure('会员密钥与模型配置不匹配');
  return {key:result.key,profile:p,apiKey:item.apiKey};
 }
 async function install(items){const selected=new Map();for(const item of items)if(!selected.has(item.profile.id)||selected.get(item.profile.id).key.createdAt<item.key.createdAt)selected.set(item.profile.id,item);
  return models.installMemberProfiles([...selected.values()].map(item=>({profile:item.profile,memberRef:{issuer,memberId:item.memberId,keyId:item.key.id,modelId:item.profile.id},id:'member-'+hash(issuer+'\n'+item.memberId+'\n'+item.profile.id).slice(0,40)})));
 }
 async function writeEnvelope(passphrase){const auth=await requireLogin(),saved=await state();if(saved.memberId!==auth.user.id)throw failure('会员身份不匹配');
  const keys=[];for(const item of saved.keys)keys.push(await verify(auth,item));
  const quota=balance(await request('/v1/quota',{token:auth.token})),checkedAt=new Date().toISOString(),envelope=await sealMemberData({issuer,memberId:auth.user.id,keys,quota,checkedAt},passphrase);
  await jsonStore(fileFor(auth.user.id),null).update(()=>envelope);await saveState({...saved,quota,checkedAt});verifiedSession=auth.token;return {sealed:true,keyCount:keys.length};
 }
 async function resolve(p,{signal}={}){return serial(async()=>{
  const auth=await requireLogin(),saved=await state(),ref=p.memberRef;
  if(ref.issuer!==issuer||ref.memberId!==auth.user.id||saved.memberId!==auth.user.id)throw failure('请登录此配置所属的神思会员账号','MEMBER_ACCOUNT_MISMATCH');
  const item=saved.keys.find(k=>k.key.id===ref.keyId&&k.profile.id===ref.modelId);if(!item||!sameProfile({...p,id:ref.modelId},item.profile))throw failure('会员密钥或模型绑定已变化，请重新核验');
  try{return {apiKey:(await verify(auth,item,signal)).apiKey};}catch(e){verifiedSession='';verifiedComputeSession='';lastError=e.message;throw e;}
 },signal);}
 async function action(name,body={}){return serial(async()=>{
  if(name==='status')return status();
  if(name==='account-status')return accountStatus();
  if(name==='account-refresh')return refreshAccount();
  if(name==='email-config')return request('/v1/auth/email-config');
  if(name==='email-code'){const purpose=body.purpose||'login';if(!['login','bind','password','merge'].includes(purpose))throw failure('邮箱验证用途无效');const auth=purpose==='login'?null:await requireLogin();return request('/v1/auth/email-code',{token:auth?.token,body:{email:body.email,purpose}});}
  if(name==='billing-config')return request('/v1/billing/config');
  if(['billing-orders','billing-purchase','billing-reconcile'].includes(name)){
   const auth=await requireLogin();
   return request(name==='billing-reconcile'?'/v1/billing/reconcile':'/v1/billing/orders',{token:auth.token,...(name==='billing-orders'?{}:{body})});
  }
  if(name==='recovery-question')return request('/v1/auth/recovery-question',{body:{account:body.account}});
  if(name==='recover')return request('/v1/auth/recover',{body:{account:body.account,securityAnswer:body.securityAnswer,newPassword:body.newPassword}});
  if(['login','register','email-login'].includes(name)){
   const allowed=name==='register'?['account','displayName','contact','password','securityQuestion','securityAnswer']:name==='email-login'?['email','challengeId','code']:['account','password'];if(allowed.some(key=>typeof body[key]!=='string'||body[key].length>256))throw failure('请完整填写账户资料');
   const result=await request('/v1/auth/'+name,{body:{...Object.fromEntries(allowed.map(key=>[key,body[key]])),rememberMe:true}});
   if(!result.user?.id||typeof result.token!=='string'||!result.token||result.token.length>16384)throw failure('账号响应无效');
   // A mismatched or unverified new login must not replace the previous one.
   const me=await request('/v1/auth/me',{token:result.token});if(me.user?.id!==result.user.id)throw failure('登录返回的身份不一致，原登录保留','ACCOUNT_MISMATCH');
   await models.putSecret('member-login',JSON.stringify({issuer,token:result.token,user:publicAccount(me.user)}),{remember:true});await models.putSecret('member-sync-unlock','');verifiedSession=result.token;verifiedComputeSession='';lastError='';
   const saved=await state();await saveState({...saved,issuer,memberId:me.user.id,publicUser:publicAccount(me.user),checkedAt:new Date().toISOString()});
   return body.accountOnly===true?accountStatus():status();
  }
  if(name==='logout'){const auth=await login();await models.putSecret('member-login','');await models.putSecret('member-sync-unlock','');verifiedSession='';verifiedComputeSession='';lastError='';if(auth?.issuer===issuer)try{await request('/v1/auth/logout',{token:auth.token,body:{}});}catch{lastError='已退出本机账号；云端会话注销未确认';}return status();}
  if(name==='refresh')return refresh();
  const auth=await requireLogin();
  if(name==='notices'){const offset=Number(body.offset||0),limit=Number(body.limit||100);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw failure('通知分页无效');return {...await request('/v1/account/notices?'+new URLSearchParams({offset,limit,...body.unread===true?{unread:'true'}:{}}),{token:auth.token}),accountId:auth.user.id,issuer};}
  if(name==='notice-read'){if(body.accountId!==auth.user.id||typeof body.noticeId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(body.noticeId))throw failure('通知账号已变化，请重新打开');return request('/v1/account/notices/'+encodeURIComponent(body.noticeId)+'/read',{token:auth.token,body:{}});}
  if(name==='merge-config')return request('/v1/account/merge-config',{token:auth.token});
  if(name==='profile-status')return request('/v1/account/profile',{token:auth.token});
  if(['profile','email-bind','password','merge-prove','merge-preview','merge-commit'].includes(name)){
   const fields={profile:['displayName','avatar'],'email-bind':['email','challengeId','code'],password:['email','account','challengeId','code','newPassword'],'merge-prove':['slot','method','account','password','email','challengeId','code'],'merge-preview':['targetProof','sourceProof'],'merge-commit':['ticket','confirmTargetId']}[name];
   const payload=Object.fromEntries(fields.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
   const path='/v1/account/'+(name.startsWith('merge-')?name.replace('merge-','merge/'):name);
   const result=await request(path,{token:auth.token,body:payload});
   if(['profile','email-bind','password','merge-commit'].includes(name)){if(result.user?.id!==auth.user.id)throw failure('账号身份发生变化，请重新登录');const saved=await state();await saveState({...saved,publicUser:publicAccount(result.user)});verifiedSession='';verifiedComputeSession='';}
   return result;
  }
  if(name==='issue'){
   if(typeof body.modelId!=='string'||typeof body.requestId!=='string')throw failure('签发参数无效');
   const result=await request('/v1/member-models/issue',{token:auth.token,body:{modelId:body.modelId,requestId:body.requestId,...(body.replaceKeyId?{replaceKeyId:body.replaceKeyId}:{})}});
   const item=await verify(auth,{key:result.key,profile:profile(result.profile),apiKey:result.apiKey}),saved=await state();
   const keys=(saved.memberId===auth.user.id?saved.keys:[]).filter(k=>k.key.id!==body.replaceKeyId&&k.key.id!==item.key.id);keys.push(item);
   await saveState({...saved,issuer,memberId:auth.user.id,keys});await install(keys.map(k=>({...k,memberId:auth.user.id})));await refresh();
   const passphrase=await models.secret('member-sync-unlock');if(passphrase)await writeEnvelope(passphrase);
   return {...await status(),warning:result.warning||''};
  }
  if(name==='revoke'){
   let error;try{await request('/v1/member-models/revoke',{token:auth.token,body:{keyId:body.keyId}});}catch(e){error=e;}
   // Keep the key only until server state confirms it is no longer active.
   await refresh();const saved=await state(),remote=saved.remoteKeys.find(k=>k.id===body.keyId);
   if(remote&&remote.status!=='active'){saved.keys=saved.keys.filter(k=>k.key.id!==body.keyId);await saveState(saved);const passphrase=await models.secret('member-sync-unlock');if(passphrase)await writeEnvelope(passphrase);}
   if(error)throw error;return status();
  }
  if(name==='seal'){const result=await writeEnvelope(body.passphrase);await models.putSecret('member-sync-unlock',body.passphrase,{remember:body.remember===true});return {...await status(),...result};}
  if(name==='unlock'){
   const paths=await sealedFiles(auth.user.id);if(!paths.length)throw failure('尚未收到此会员的同步文件，请先完成资料同步');if(paths.length>16)throw failure('会员同步冲突副本超过 16 份，请先归档已合并的加密副本');
   const catalog=await request('/v1/member-models',{token:auth.token}),candidates=new Map();if(!Array.isArray(catalog.keys))throw failure('会员模型目录无效');
   for(const path of paths){const info=await stat(path);if(info.size>1024*1024)throw failure('会员同步文件超过限制');let envelope;try{envelope=JSON.parse(await readFile(path,'utf8'));}catch{throw failure('会员同步文件无效');}
    const opened=await openMemberData(envelope,body.passphrase,{issuer,memberId:auth.user.id});if(!Array.isArray(opened.keys)||opened.keys.length>16)throw failure('会员同步文件中的密钥数量无效');
    for(const item of opened.keys){const current=catalog.keys.find(k=>k.id===item?.key?.id);if(!current)throw failure('同步文件含不属于当前会员的密钥');if(current.status!=='active'||current.expiresAt<=Date.now())continue;const old=candidates.get(item.key.id);if(old&&(!sameProfile(old.profile,item.profile)||old.apiKey!==item.apiKey))throw failure('同一会员密钥的加密副本不一致，未覆盖已有配置');candidates.set(item.key.id,item);}
   }
   if(candidates.size>16)throw failure('有效会员密钥超过数量限制');const accepted=[];for(const item of candidates.values())accepted.push(await verify(auth,item));
   const quota=balance(await request('/v1/quota',{token:auth.token})),old=await state();
   const merged=new Map((old.memberId===auth.user.id?old.keys:[]).map(k=>[k.key.id,k]));for(const item of accepted)merged.set(item.key.id,item);
   await saveState({...old,issuer,memberId:auth.user.id,keys:[...merged.values()],quota,checkedAt:new Date().toISOString()});await install(accepted.map(k=>({...k,memberId:auth.user.id})));
   await models.putSecret('member-sync-unlock',body.passphrase,{remember:body.remember===true});await refresh();return {...await status(),restored:new Set(accepted.map(k=>k.profile.id)).size,restoredKeys:accepted.length};
  }
  throw failure('未知会员操作');
 });}
 return {action,resolve,modelAccess,issuer,
  cloudFiles:({journal,expectedMemberId}={})=>createCloudFileClient({issuer:serviceBaseUrl,journal,expectedMemberId,allowLoopbackForTests:new URL(issuer).protocol==='http:',getSession:async()=>{if(closed)throw failure('账号服务已关闭');return requireLogin();}}),
  close:()=>{closed=true;controller.abort();}};
}
