import {ACCOUNT_SERVICE_URL} from '../core/src/account-service-endpoints.mjs';
export function allowedMobileServiceUrl(raw){
 const url=new URL(raw);
 const account=url.origin===ACCOUNT_SERVICE_URL&&/^\/(?:v1\/|health$|admin(?:\/|$))/.test(url.pathname);
 const nutstore=url.origin==='https://dav.jianguoyun.com'&&(url.pathname==='/dav'||url.pathname.startsWith('/dav/')||!url.search&&['/nsdav/delta','/nsdav/latestDeltaCursor'].includes(url.pathname));
 if(url.username||url.password||url.hash||!account&&!nutstore)throw Error('不允许连接此服务地址');
 return url.href;
}
const encode=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function nativeFetchAdapter(http,cloudTransport){
 const nutstoreRequest=createNutstoreRequestGate(input=>cloudTransport.nutstore(input).then(result=>({...result,headers:new Headers(result.headers)})),{intervalMs:200});
 return async(url,options={})=>{
  allowedMobileServiceUrl(url);if(options.signal?.aborted)throw Error('请求已取消');
  if(new URL(url).origin==='https://dav.jianguoyun.com'){
   if(new URL(url).pathname.startsWith('/nsdav/')&&options.method!=='POST')throw Error('坚果云增量接口仅允许读取变更清单');
   if(typeof cloudTransport?.nutstore!=='function')throw Error('坚果云原生WebDAV传输桥尚未加载，请更新手机版');
   const headers=new Headers(options.headers),body=options.body===undefined?new Uint8Array():typeof options.body==='string'?new TextEncoder().encode(options.body):options.body;
   if(!(body instanceof Uint8Array)||body.length>8*1024*1024)throw Error('坚果云单次传输内容超出当前原生桥限制');
   const safeHeaders={};for(const name of ['Content-Type','Depth','If-Match','If-None-Match','Range'])if(headers.has(name))safeHeaders[name]=headers.get(name);
   const result=await nutstoreRequest({url,method:options.method||'GET',authorization:headers.get('Authorization')||'',headers:safeHeaders,data:encode(body)},{signal:options.signal});
   if(options.signal?.aborted)throw Error('坚果云传输等待已超时；请先核对结果，不要重复上传');
   if(result.status>=300&&result.status<400)throw Error('服务重定向被拒绝，未转发凭据');
   const bytes=decode(result.base64);if(bytes.length>8*1024*1024)throw Error('坚果云响应超过当前原生桥限制');
   return new Response([204,205,304].includes(result.status)?null:bytes,{status:result.status,headers:result.headers});
  }
  if(new URL(url).pathname.match(/^(?:\/skill)?\/v1\/cloud-sync\/(files|uploads)\/[a-zA-Z0-9_-]+\/chunks\/\d+$/)){
   if(!cloudTransport)throw Error('原生云文件传输桥尚未接入');
   const headers=new Headers(options.headers),body=options.body;
   if(body&&!(body instanceof Uint8Array)||body?.length>4*1024*1024)throw Error('云端分块类型或大小无效');
   const result=await cloudTransport.request({url,method:options.method||'GET',token:(headers.get('Authorization')||'').replace(/^Bearer /,''),...(body?{data:encode(body),sha256:headers.get('X-Content-SHA256')}:{})});
   if(options.signal?.aborted)throw Error('请求已取消，原上传可续传');
   const bytes=decode(result.base64);if(bytes.length>4*1024*1024)throw Error('云端分块超过限制');
   return new Response(bytes,{status:result.status});
  }
  const emailCode=/^(?:\/skill)?\/v1\/auth\/email-code$/.test(new URL(url).pathname);
  const result=await http.request({url,method:options.method||'GET',headers:options.headers||{},data:options.body,responseType:'text',disableRedirects:true,connectTimeout:15000,readTimeout:emailCode?30000:20000});
  if(options.signal?.aborted)throw Error(emailCode?'验证码发送结果未确认，请先检查邮箱，不要立即重发':'请求已取消');
  if(result.status>=300&&result.status<400)throw Error('服务重定向被拒绝，未转发凭据');
  if(result.url&&result.url!==url)throw Error('服务返回了不同地址');
  const text=typeof result.data==='string'?result.data:JSON.stringify(result.data);
  if(new TextEncoder().encode(text).length>4*1024*1024)throw Error('服务响应超过安全大小');
  return new Response([204,205,304].includes(result.status)?null:text,{status:result.status,headers:result.headers});
 };
}

// GitHub public artifact downloads never receive account/vault credentials.
export function nativeArtifactFetch(transport){return async(url)=>{
 const u=new URL(url);if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('插件制品来源不可信');
 const result=await transport.artifact({url});const body=decode(result.base64);if(body.length>2*1024*1024)throw Error('插件制品过大');
 return new Response([204,205,304].includes(result.status)?null:body,{status:result.status,headers:result.location?{location:result.location}:{}});
};}
import {createNutstoreRequestGate} from '../core/src/nutstore-request-gate.mjs';
