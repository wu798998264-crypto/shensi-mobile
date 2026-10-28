export function allowedMobileServiceUrl(raw){
 const url=new URL(raw);
 const account=url.origin==='https://api.hexing.studio'&&url.pathname.startsWith('/skill/');
 const nutstore=url.origin==='https://dav.jianguoyun.com'&&(url.pathname==='/dav'||url.pathname.startsWith('/dav/'));
 if(url.username||url.password||url.hash||!account&&!nutstore)throw Error('不允许连接此服务地址');
 return url.href;
}
export function nativeFetchAdapter(http){
 return async(url,options={})=>{
  allowedMobileServiceUrl(url);if(options.signal?.aborted)throw Error('请求已取消');
  const result=await http.request({url,method:options.method||'GET',headers:options.headers||{},data:options.body,responseType:'text',disableRedirects:true,connectTimeout:15000,readTimeout:20000});
  if(result.status>=300&&result.status<400)throw Error('服务重定向被拒绝，未转发凭据');
  if(result.url&&result.url!==url)throw Error('服务返回了不同地址');
  const text=typeof result.data==='string'?result.data:JSON.stringify(result.data);
  if(new TextEncoder().encode(text).length>4*1024*1024)throw Error('服务响应超过安全大小');
  return new Response([204,205,304].includes(result.status)?null:text,{status:result.status,headers:result.headers});
 };
}
