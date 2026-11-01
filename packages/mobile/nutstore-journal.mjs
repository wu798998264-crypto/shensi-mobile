import {createSyncRevisionJournal,syncDigest,syncRemoteRoot} from '../core/src/sync-revision-journal.mjs';
import {parseWebDavMultiStatus} from '../core/src/webdav-listing.mjs';
import {nextWebDavPage} from '../core/src/webdav-pagination.mjs';
import {nutstoreRetryAfter,pacedNutstoreFetch} from '../core/src/nutstore-request-gate.mjs';
import {createNutstoreDeltaClient} from '../core/src/nutstore-delta.mjs';
import {createJournalScanCache} from '../core/src/sync-journal-scan-cache.mjs';
const BASE='https://dav.jianguoyun.com/dav/',MAX=8*1024*1024;
const fault=(message,code)=>Object.assign(Error(message),{code});
// Portable bytes adapter: Android native WebDAV bridge or Node's fetch.
export function createMobileNutstoreJournal({account,password,remoteRoot,deviceId,fetchImpl=fetch,layoutVersion=1,checkpoint}){
 if(fetchImpl===globalThis.fetch)fetchImpl=pacedNutstoreFetch(fetchImpl);
 const collections=new Set();
 const authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(account+':'+password)));
 const urlFor=path=>BASE+path.split('/').map(encodeURIComponent).join('/');
 async function request(method,path,{body,headers={},expected=[200],url}={}){
  const response=await fetchImpl(url||urlFor(path),{method,headers:{Authorization:authorization,...headers},body,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(95000)});
  if(!expected.includes(response.status)){await response.body?.cancel().catch(()=>{});const limited=[429,503].includes(response.status),code=response.status===401?'WAITING_CREDENTIALS':limited?'RETRY_WAIT':'WEBDAV_HTTP_'+response.status;throw Object.assign(fault(response.status===401?'坚果云账号或应用密码无效':limited?'坚果云暂时繁忙，已停止本次传输，请等待冷却后重试；不会自动重复上传':'坚果云请求失败（HTTP '+response.status+'）',code),{status:response.status,...limited?{retryAfterMs:nutstoreRetryAfter(response.headers.get('retry-after'))}:{}});}if(!['GET','PROPFIND'].includes(method))await response.body?.cancel().catch(()=>{});return response;
 }
 async function bytes(response,max=MAX){const parts=[];let size=0;if(Number(response.headers.get('content-length'))>max){await response.body?.cancel().catch(()=>{});throw fault('同步文件超过传输上限','WEBDAV_RESPONSE_TOO_LARGE');}for await(const chunk of response.body||[]){size+=chunk.length;if(size>max)throw fault('同步文件超过传输上限','WEBDAV_RESPONSE_TOO_LARGE');parts.push(chunk);}const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;}
 const getBytes=async(path,max)=>bytes(await request('GET',path),max);
 const putBytes=async(path,body,contentType='application/octet-stream')=>{if(body.length>MAX)throw fault('当前移动端单文件上限8MiB；未截断或丢弃内容','MOBILE_SYNC_LIMIT');await request('PUT',path,{body,headers:{'Content-Type':contentType},expected:[200,201,204]});};
 const io={
  async ensure(path){let parent='';for(const part of syncRemoteRoot(path).split('/')){parent+=(parent?'/':'')+part;if(collections.has(parent))continue;await request('MKCOL',parent,{body:new Uint8Array(),expected:[201,405,409]});
   const response=await request('PROPFIND',parent,{headers:{Depth:'0','Content-Type':'application/xml'},body:'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',expected:[207]}),items=parseWebDavMultiStatus(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,4*1024*1024))),wanted=decodeURIComponent(new URL(urlFor(parent)).pathname).replace(/\/$/,'');
   const found=items.find(item=>{const url=new URL(item.href,BASE);return url.origin===new URL(BASE).origin&&decodeURIComponent(url.pathname).replace(/\/$/,'')===wanted;});if(!found?.collection||!/^HTTP\/\S+ 200\b/.test(found.status))throw fault('坚果云路径不是已确认的目录，未继续写入','WEBDAV_REMOTE_PATH_NOT_COLLECTION');collections.add(parent);
  }},
  async head(path){const r=await request('HEAD',path,{expected:[200,204,404]});return {exists:r.status!==404,size:Number(r.headers.get('content-length'))};},getBytes,putBytes,
  async list(path,kind='files'){
   const collection=urlFor(path),seen=new Set(),names=new Set();let url=collection;
   for(let page=0;page<1000;page++){
    if(seen.has(url))throw fault('同步目录分页循环，已停止','WEBDAV_PAGINATION_LOOP');seen.add(url);
    const r=await request('PROPFIND',path,{url,headers:{Depth:'1','Content-Type':'application/xml'},body:'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>',expected:[207]}),items=parseWebDavMultiStatus(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(r,4*1024*1024))),next=nextWebDavPage(r.headers.get('link'),url,collection);
    if(!items.length||items.length>=750&&!next)throw fault('同步目录清单不完整，未采用空清单或截断内容','WEBDAV_INVALID_LISTING');
    for(const item of items){const target=new URL(item.href,BASE),base=decodeURIComponent(new URL(collection).pathname).replace(/\/$/,'');if(target.origin!==new URL(BASE).origin)throw fault('同步目录来源不符','WEBDAV_INVALID_LISTING');const decoded=decodeURIComponent(target.pathname).replace(/\/$/,'');if(decoded===base&&item.collection)continue;if(!decoded.startsWith(base+'/')||decoded.slice(base.length+1).includes('/')||!/^HTTP\/\S+ 200\b/.test(item.status))throw fault('同步目录条目无效','WEBDAV_INVALID_LISTING');if(!!item.collection!==(kind==='collections'))throw fault('历史目录包含不兼容条目','WEBDAV_INVALID_LISTING');const name=decoded.slice(base.length+1);if(names.has(name))throw fault('目录分页重复，未采用不稳定清单','WEBDAV_INVALID_LISTING');names.add(name);}
    if(!next)return [...names];url=next.href;
   }throw fault('同步目录分页过多，原资料保留','WEBDAV_PAGINATION_LIMIT');
  },
  async putEntry(path,entry,onProgress){if(!(entry.bytes instanceof Uint8Array)||entry.bytes.length!==entry.size||await syncDigest(entry.bytes)!==entry.hash)throw fault('上传内容已变化','LOCAL_FILE_CHANGED_DURING_SYNC');await putBytes(path,entry.bytes,entry.contentType);const actual=await getBytes(path,entry.size);if(actual.length!==entry.size||await syncDigest(actual)!==entry.hash)throw fault('上传回读摘要不符，未提交版本','REMOTE_HASH_MISMATCH');onProgress?.({transferred:entry.size,total:entry.size});},
  async downloadEntry(path,entry,{onProgress}={}){if(entry.size>MAX)throw fault('文件超过当前移动端8MiB上限，未删减内容','MOBILE_SYNC_LIMIT');const actual=await getBytes(path,entry.size);if(actual.length!==entry.size||await syncDigest(actual)!==entry.hash)throw fault('下载校验失败，未修改本地','REMOTE_HASH_MISMATCH');onProgress?.({transferred:entry.size,total:entry.size});return actual;}
 };
 if(checkpoint){
  const root=syncRemoteRoot(remoteRoot)+'/.shensi-journal-v'+layoutVersion+'/revisions',scope=JSON.stringify([BASE,account,remoteRoot,layoutVersion]);
  const cache=createJournalScanCache({io,delta:createNutstoreDeltaClient({account,password,fetchImpl}),root,scope,checkpoint,maxCheckpointBytes:3*1024*1024});io.scan=work=>cache.run(work);
  const put=io.putBytes;io.putBytes=async(path,...args)=>{try{return await put(path,...args);}finally{cache.invalidate(path);}};
 }
 return createSyncRevisionJournal({io,remoteRoot,deviceId,layoutVersion});
}
