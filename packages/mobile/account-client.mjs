// Shared Android/iOS service client. The caller must supply a native secure vault.
// No browser/localStorage fallback, Node dependency, generation or purchase endpoint.
import {createCloudFileClient} from './cloud-sync-client.mjs';
export const ACCOUNT_ISSUER='https://api.hexing.studio/skill';
const failure=(message,code,status)=>Object.assign(new Error(message),{code,...status?{status}: {}});
const publicUser=user=>({id:String(user.id),account:String(user.account||''),displayName:String(user.displayName||'神思用户'),email:String(user.email||''),emailVerifiedAt:Number(user.emailVerifiedAt)||0,hasPassword:user.hasPassword===true,avatar:typeof user.avatar==='string'&&user.avatar.length<=180000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(user.avatar)?user.avatar:''});
const messages={EMAIL_UNAVAILABLE:'邮箱服务暂不可用，请稍后重试或使用密码登录',EMAIL_SEND_FAILED:'验证码邮件未能发送，请稍后重试',EMAIL_RATE_LIMIT:'发送过于频繁，请稍后重试',EMAIL_DAILY_LIMIT:'今日验证码发送次数已达上限',EMAIL_BUSY:'验证码正在发送，请稍候',EMAIL_CODE_INVALID:'验证码错误或已过期，请重新获取',EMAIL_BIND_REQUIRED:'该邮箱尚未验证绑定，请先用原账号密码登录',EMAIL_INVALID:'请输入有效邮箱'};
const invalidCatalog=()=>failure('官方模型目录响应无效，请重新核验','INVALID_RESPONSE');
function publicModel(value,allowLoopback){
 if(!value||!/^[a-zA-Z0-9_.-]{1,80}$/.test(value.id)||!['text','image','video','audio'].includes(value.channel)||!['chat_completions','responses','anthropic_messages'].includes(value.protocol))throw invalidCatalog();
 for(const key of ['name','model','baseUrl'])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>4000)throw invalidCatalog();
 if(value.provider!==undefined&&(typeof value.provider!=='string'||value.provider.length>4000))throw invalidCatalog();
 let url;try{url=new URL(value.baseUrl);}catch{throw invalidCatalog();}
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||allowLoopback&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw invalidCatalog();
 // Deliberate projection: unexpected token/apiKey fields never reach the UI.
 return Object.fromEntries(['id','name','channel','model','protocol','baseUrl','provider'].map(key=>[key,value[key]||'']));
}
export function createMobileAccountClient({secureVault,fetchImpl=fetch,issuer=ACCOUNT_ISSUER,allowLoopbackForTests=false,timeoutMs=15000}={}){
 if(!secureVault||!['get','set','remove'].every(k=>typeof secureVault[k]==='function'))throw failure('需要系统安全凭据库，不允许降级为浏览器缓存','SECURE_VAULT_REQUIRED');
 const url=new URL(issuer);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||allowLoopbackForTests&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw failure('账户地址必须为无凭据的安全地址','INVALID_ISSUER');
 issuer=url.href.replace(/\/$/,'');const key='shensi.account.session:'+issuer;
 let session=null,loaded=false,verified=false,lastError='',queue=Promise.resolve();
 const persistSession=value=>secureVault.set(key,JSON.stringify({...value,user:{...value.user,avatar:''}}));
 const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
 const state=()=>({issuer,status:!session?'signed_out':verified?'verified':'verification_required',user:session?publicUser(session.user):null,lastError});
 async function load(){if(loaded)return;const raw=await secureVault.get(key);if(raw){try{const v=JSON.parse(raw);if(v.issuer!==issuer||!v.user?.id||typeof v.token!=='string'||!v.token||v.token.length>16384)throw Error();session=v;}catch{throw failure('保存的账户会话无效，请清除后重新登录','INVALID_SESSION');}}loaded=true;}
 async function request(path,{token,body}={}){
  // SMTP acknowledgement can consume 12s server-side. Leave network margin
  // without retrying a send whose outcome might already be accepted.
  const deadline=path==='/v1/auth/email-code'?Math.max(timeoutMs,30000):timeoutMs;
  let response;try{response=await fetchImpl(issuer+path,{method:body===undefined?'GET':'POST',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(deadline),headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw failure(path==='/v1/auth/email-code'?'验证码发送结果尚未确认，请先检查收件箱与垃圾邮件，稍后再试。':'账户服务连接失败或超时，请检查网络后重试','ACCOUNT_UNAVAILABLE');}
  // Do not echo raw upstream errors: a proxy could reflect a password or token.
  const reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
  if(!reader)throw failure('账户服务未返回数据','INVALID_RESPONSE');
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024*1024){await reader.cancel();throw failure('账户响应超过安全大小','INVALID_RESPONSE');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}catch(error){if(error.code)throw error;throw failure('账户响应中断，请重新核验','ACCOUNT_UNAVAILABLE');}
  let value;try{value=JSON.parse(text);}catch{throw failure('账户服务响应无效','INVALID_RESPONSE');}
  if(!response.ok)throw Object.assign(failure(messages[value.code]||({400:'账户信息不完整或格式不正确，请检查后重试',401:'登录已失效或凭证不正确',403:'账号操作未获授权',409:'账号或资料状态已变化，请刷新后重试',429:'请求过于频繁，请稍后重试'}[response.status]||'账户服务暂不可用'),messages[value.code]?value.code:'ACCOUNT_REJECTED',response.status),{retryAfterSeconds:Math.min(86400,Math.max(0,Number(value.retryAfterSeconds)||0))});
  return value;
 }
 async function verify(){
  verified=false;await load();if(!session)throw failure('请先登录神思账号','LOGIN_REQUIRED');
  try{const me=await request('/v1/auth/me',{token:session.token});if(me.user?.id!==session.user.id)throw failure('账号身份发生变化，请重新登录','ACCOUNT_MISMATCH',401);session={...session,user:publicUser(me.user)};await persistSession(session);verified=true;lastError='';return state();}
  catch(error){lastError=error.message;if(error.status===401){session=null;await secureVault.remove(key);}throw error;}
 }
 async function signIn(path,body){
  const result=await request(path,{body:{...body,rememberMe:true}});
  if(!result.user?.id||typeof result.token!=='string'||!result.token||result.token.length>16384)throw failure('登录响应无效','INVALID_RESPONSE');
  // Verify the new identity before replacing the previously saved session.
  const me=await request('/v1/auth/me',{token:result.token});if(me.user?.id!==result.user.id)throw failure('登录返回的身份不一致','ACCOUNT_MISMATCH');
  const next={issuer,token:result.token,user:publicUser(me.user)};await persistSession(next);session=next;loaded=true;verified=true;lastError='';return state();
 }
 return {
  cloudFiles:({journal,expectedMemberId}={})=>createCloudFileClient({issuer,journal,expectedMemberId,fetchImpl,allowLoopbackForTests,getSession:()=>serial(async()=>{await load();if(!session)throw failure('请先登录神思账号','LOGIN_REQUIRED');return structuredClone(session);})}),
  status:()=>serial(async()=>{await load();return state();}),
  refresh:()=>serial(verify),
  rememberedAccount:{get:async()=>{const raw=await secureVault.get(key+':name');if(!raw)return null;const saved=JSON.parse(raw);return {account:String(saved.account||'').slice(0,256),email:String(saved.email||'').slice(0,254)};},set:async value=>{if(value)await secureVault.set(key+':name',JSON.stringify({account:String(value.account||'').slice(0,256),email:String(value.email||'').slice(0,254)}));else await secureVault.remove(key+':name');}},
  register:(body={})=>serial(()=>{
   const fields=['account','displayName','contact','password','securityQuestion','securityAnswer'];if(fields.some(k=>typeof body[k]!=='string'||body[k].length>256))throw failure('请完整填写注册资料','INVALID_REGISTRATION');
   return signIn('/v1/auth/register',Object.fromEntries(fields.map(k=>[k,body[k]])));
  }),
  recoveryQuestion:({account}={})=>serial(()=>request('/v1/auth/recovery-question',{body:{account}})),
  recover:({account,securityAnswer,newPassword}={})=>serial(()=>request('/v1/auth/recover',{body:{account,securityAnswer,newPassword}})),
  profile:()=>serial(async()=>{await verify();const result=await request('/v1/account/profile',{token:session.token});if(result.user?.id!==session.user.id)throw failure('账号身份发生变化，请重新登录','ACCOUNT_MISMATCH');return {...result,user:publicUser(result.user)};}),
  updateProfile:({displayName,avatar}={})=>serial(async()=>{
   await verify();const current=await request('/v1/account/profile',{token:session.token});if(current.policy!=='pre_approval')throw failure('账号资料审核服务尚未更新，暂不能提交','PROFILE_REVIEW_UNAVAILABLE');
   const result=await request('/v1/account/profile',{token:session.token,body:{displayName,avatar}});if(result.user?.id!==session.user.id||result.policy!=='pre_approval')throw failure('资料审核响应无效，请刷新后核对','INVALID_RESPONSE');session={...session,user:publicUser(result.user)};await persistSession(session);return {...result,user:session.user};
  }),
  login:({account,password}={})=>serial(()=>{
   if(typeof account!=='string'||!account.trim()||account.length>256||typeof password!=='string'||!password||password.length>256)throw failure('请填写账号和密码','INVALID_LOGIN');
   return signIn('/v1/auth/login',{account:account.trim(),password});
  }),
  emailConfig:()=>serial(()=>request('/v1/auth/email-config')),
  sendEmailCode:({email}={})=>serial(()=>{
   if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw failure('请输入有效邮箱','INVALID_EMAIL');
   return request('/v1/auth/email-code',{body:{email,purpose:'login'}});
  }),
  emailLogin:({email,challengeId,code}={})=>serial(()=>{
   if([email,challengeId,code].some(v=>typeof v!=='string'||!v||v.length>256))throw failure('邮箱验证信息不完整','INVALID_EMAIL_LOGIN');
   return signIn('/v1/auth/email-login',{email,challengeId,code});
  }),
  entitlements:()=>serial(async()=>{
   await verify();const token=session.token;
   try{const [membership,quota,billing]=await Promise.all([request('/v1/membership',{token}),request('/v1/quota',{token}),request('/v1/billing/config')]);
    if(!Number.isSafeInteger(quota.available)||quota.available<0||!Number.isSafeInteger(quota.reserved)||quota.reserved<0)throw failure('算力余额无效','INVALID_RESPONSE');
    return {...state(),membership,quota:{available:quota.available,reserved:quota.reserved},services:{purchaseAvailable:billing.paymentEnabled===true,cloudSyncAvailable:billing.cloudSyncEnabled===true},checkedAt:new Date().toISOString()};
   }catch(error){verified=false;lastError=error.message;if(error.status===401){session=null;await secureVault.remove(key);}throw error;}
  }),
  officialModels:()=>serial(async()=>{
   await verify();
   const result=(status,compute=null,models=[])=>({issuer,user:publicUser(session.user),accountStatus:'verified',status,enabled:status==='available',compute,models,checkedAt:new Date().toISOString()});
   try{
    let catalog;
    try{catalog=await request('/v1/member-models',{token:session.token});}
    catch(error){if([404,503].includes(error.status))return result('service_unavailable');throw error;}
    if(!catalog||typeof catalog.enabled!=='boolean'||!Array.isArray(catalog.models)||catalog.models.length>100)throw invalidCatalog();
    let compute=catalog.compute;
    if(!compute)try{compute=(await request('/v1/compute/entitlement',{token:session.token})).compute;}
    catch(error){if([404,503].includes(error.status))return result('service_unavailable');throw error;}
    if(!compute||typeof compute.purchased!=='boolean'||typeof compute.entitled!=='boolean'||!Number.isSafeInteger(compute.expiresAt)||compute.expiresAt<0)throw invalidCatalog();
    compute={purchased:compute.purchased,entitled:compute.purchased&&compute.entitled&&(!compute.expiresAt||compute.expiresAt>Date.now()),expiresAt:compute.expiresAt};
    const models=catalog.models.map(value=>publicModel(value,allowLoopbackForTests));
    if(new Set(models.map(value=>value.id)).size!==models.length)throw invalidCatalog();
    if(!compute.entitled)return result(compute.purchased?'inactive':'purchase_required',compute);
    if(!catalog.enabled||!models.length)return result('service_unavailable',compute);
    return result('available',compute,models);
   }catch(error){verified=false;lastError=error.message;if(error.status===401){session=null;await secureVault.remove(key);}throw error;}
  }),
  logout:()=>serial(async()=>{
   // Clear local authentication even when remote revocation is unavailable.
   try{await load();}catch{session=null;}const token=session?.token;session=null;verified=false;loaded=false;lastError='';
   try{await secureVault.remove(key);loaded=true;}catch{lastError='安全凭据清理失败；未确认退出，请重试';throw failure(lastError,'SECURE_VAULT_FAILED');}
   if(token)try{await request('/v1/auth/logout',{token,body:{}});}catch{lastError='已退出本机账号，服务器会话注销尚未确认';}
   return state();
  })
 };
}
