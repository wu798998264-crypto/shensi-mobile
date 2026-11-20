// Shared desktop/mobile transfer contract. Native adapters own file IO and the
// encrypted login store. Journals contain identities/hashes, never auth tokens.
import {ACCOUNT_SERVICE_URL,accountEndpoint} from '../core/src/account-service-endpoints.mjs';
const failure=(message,code,status)=>Object.assign(Error(message),{code,...status?{status}: {}});
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const toHex=value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
export function createCloudFileClient({issuer=ACCOUNT_SERVICE_URL,getSession,journal,fetchImpl=fetch,crypto=globalThis.crypto,allowLoopbackForTests=false,expectedMemberId}={}){
 let address;try{address=accountEndpoint(issuer,{allowLoopback:allowLoopbackForTests});}catch(error){throw failure(error.message,'CLOUD_SYNC_INVALID_ISSUER');}
 const {serviceBaseUrl}=address;
 issuer=address.issuer;
 if(typeof getSession!=='function'||!journal||!['get','set','remove'].every(key=>typeof journal[key]==='function')||!crypto?.subtle||!crypto.randomUUID)throw failure('云同步缺少安全登录或持久续传记录','CLOUD_SYNC_ADAPTER_REQUIRED');
 const flights=new Set();
 const hash=async bytes=>toHex(await crypto.subtle.digest('SHA-256',bytes));
 async function session(){const value=await getSession();if(value?.issuer!==issuer||!id(value.user?.id)||typeof value.token!=='string'||!value.token||value.token.length>16384)throw failure('请先登录此云空间的神思账号','CLOUD_SYNC_LOGIN_REQUIRED');if(expectedMemberId!==undefined&&value.user.id!==expectedMemberId)throw failure('登录账号已变化，未向新账号同步原笔记本','CLOUD_SYNC_ACCOUNT_CHANGED');return value;}
 const request=async(auth,path,{method='GET',body,bytes,sha256,signal,binary=false}={})=>{
  const current=await session();if(current.user.id!==auth.user.id||current.token!==auth.token)throw failure('登录账号已变化，原上传记录已保留','CLOUD_SYNC_ACCOUNT_CHANGED');
  let response;try{response=await fetchImpl(serviceBaseUrl+path,{method,redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])]),headers:{Authorization:'Bearer '+auth.token,Accept:binary?'application/octet-stream':'application/json',...(bytes?{'Content-Type':'application/octet-stream','X-Content-SHA256':sha256}:body!==undefined?{'Content-Type':'application/json'}:{})},body:bytes||(body===undefined?undefined:JSON.stringify(body))});}catch{throw failure(signal?.aborted?'同步已暂停，原上传可继续':'云同步连接中断，原上传记录已保留，请续传而非重复新建','CLOUD_SYNC_NETWORK_UNKNOWN');}
  const chunks=[];let count=0;const limit=response.ok&&binary?4*1024*1024:512*1024;
  try{const reader=response.body.getReader();for(;;){const next=await reader.read();if(next.done)break;count+=next.value.byteLength;if(count>limit){await reader.cancel();throw failure('云同步响应超过限制','CLOUD_SYNC_INVALID_RESPONSE');}chunks.push(next.value);}}
  catch(error){if(error.code)throw error;throw failure('响应中断，原同步记录已保留','CLOUD_SYNC_NETWORK_UNKNOWN');}
  const output=new Uint8Array(count);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.byteLength;}
  if(response.ok&&binary)return output;
  let value;try{value=JSON.parse(new TextDecoder().decode(output));}catch{throw failure('云同步响应格式无效','CLOUD_SYNC_INVALID_RESPONSE');}
  if(!response.ok){const safe=typeof value.code==='string'&&/^CLOUD_SYNC_[A-Z_]{1,70}$/.test(value.code);throw failure(safe?String(value.message||'云同步未完成').slice(0,260):response.status===401?'账号登录已失效，请重新登录':'云同步服务暂不可用',safe?value.code:'CLOUD_SYNC_REJECTED',response.status);}
  return value;
 };
 const authenticate=async signal=>{const auth=await session(),me=await request(auth,'/v1/auth/me',{signal});if(me.user?.id!==auth.user.id)throw failure('服务器账号与本机账号不一致','CLOUD_SYNC_ACCOUNT_CHANGED');return auth;};
 const journalKey=(auth,key)=>'cloud-transfer:'+issuer+':'+auth.user.id+':'+key;
 const enter=async(key,fn)=>{if(flights.has(key))throw failure('此文件正在同步','CLOUD_SYNC_BUSY');flights.add(key);try{return await fn();}finally{flights.delete(key);}};
 return {
  status:async({signal}={})=>request(await authenticate(signal),'/v1/cloud-sync/status',{signal}),
  allocate:async({signal}={})=>request(await authenticate(signal),'/v1/cloud-sync/space',{method:'POST',body:{},signal}),
  list:async({state='current',after,signal}={})=>{if(!['current','history','trash'].includes(state)||after&&!id(after))throw failure('文件分页无效','CLOUD_SYNC_INVALID_REQUEST');return request(await authenticate(signal),'/v1/cloud-sync/files?'+new URLSearchParams({state,limit:'100',...(after?{after}:{})}),{signal});},
  listAll:async({state='current',signal}={})=>{
   if(!['current','history','trash'].includes(state))throw failure('文件分页无效','CLOUD_SYNC_INVALID_REQUEST');
   const auth=await authenticate(signal),items=[],ids=new Set(),cursors=new Set();let after;
   for(let page=0;page<1000;page++){
    const value=await request(auth,'/v1/cloud-sync/files?'+new URLSearchParams({state,limit:'100',...(after?{after}:{})}),{signal});
    if(!Array.isArray(value.items)||value.items.length>100||value.items.some(f=>!id(f?.id)||ids.has(f.id)))throw failure('云端文件列表变化或格式无效，请重新读取；未采用残缺清单','CLOUD_SYNC_INVALID_RESPONSE');
    for(const item of value.items){if(ids.has(item.id))throw failure('云端分页包含重复文件，未采用残缺清单','CLOUD_SYNC_INVALID_RESPONSE');ids.add(item.id);items.push(item);}
    if(value.nextAfter==null||value.nextAfter==='')return {items,nextAfter:null,complete:true};
    if(!id(value.nextAfter)||cursors.has(value.nextAfter)||!value.items.length)throw failure('云端文件分页循环或游标无效','CLOUD_SYNC_INVALID_RESPONSE');cursors.add(value.nextAfter);after=value.nextAfter;
   }throw failure('云端文件分页超过安全上限，未采用残缺清单','CLOUD_SYNC_INVALID_RESPONSE');
  },
  upload:async({key,name,kind,source,baseRevision=null,resolveFileIds,onProgress=()=>{},signal})=>{
   if(!id(key)||!source||!Number.isSafeInteger(source.bytes)||source.bytes<0||source.bytes>2*1024**3||!digest(source.sha256)||typeof source.read!=='function')throw failure('需要有效的本地文件及完整摘要','CLOUD_SYNC_INVALID_SOURCE');
   const auth=await authenticate(signal),jkey=journalKey(auth,key);
   return enter(jkey,async()=>{
    const intent={key,name,kind,bytes:source.bytes,sha256:source.sha256,baseRevision,...resolveFileIds?{resolveFileIds}:{}},fingerprint=await hash(new TextEncoder().encode(JSON.stringify(intent)));let saved=await journal.get(jkey);
    if(saved&&saved.fingerprint!==fingerprint&&!saved.completed)throw failure('本地内容已变化，请先处理原上传；未覆盖原续传记录','CLOUD_SYNC_SOURCE_CHANGED');
    if(!saved||saved.fingerprint!==fingerprint){saved={fingerprint,idempotencyKey:crypto.randomUUID(),uploadId:null,completed:false};await journal.set(jkey,saved);}
    let upload;
    if(saved.uploadId){if(!id(saved.uploadId))throw failure('续传记录损坏','CLOUD_SYNC_INVALID_JOURNAL');upload=(await request(auth,'/v1/cloud-sync/uploads/'+saved.uploadId,{signal})).upload;}
    else {upload=(await request(auth,'/v1/cloud-sync/uploads',{method:'POST',body:{...intent,idempotencyKey:saved.idempotencyKey},signal})).upload;if(!id(upload?.id))throw failure('上传响应无效','CLOUD_SYNC_INVALID_RESPONSE');saved={...saved,uploadId:upload.id};await journal.set(jkey,saved);}
    if(upload?.id!==saved.uploadId||upload.bytes!==source.bytes||upload.sha256!==source.sha256||upload.chunkBytes!==4*1024*1024||upload.chunkCount!==Math.ceil(source.bytes/upload.chunkBytes)||!Array.isArray(upload.received))throw failure('上传身份或分块响应不一致','CLOUD_SYNC_INVALID_RESPONSE');
    if(upload.status==='committed'){saved={...saved,completed:true,fileId:upload.fileId};await journal.set(jkey,saved);onProgress({phase:'complete',bytes:source.bytes,total:source.bytes});return {fileId:upload.fileId,conflict:upload.conflict===true,resumed:true};}
    if(upload.status!=='pending')throw failure('原上传已结束，请先清除本地续传记录','CLOUD_SYNC_UPLOAD_FINISHED');
    const received=new Map(upload.received.map(c=>[c.index,c]));let sent=0;
    for(let index=0;index<upload.chunkCount;index++){
     const start=index*upload.chunkBytes,end=Math.min(start+upload.chunkBytes,source.bytes),bytes=await source.read(start,end);if(!(bytes instanceof Uint8Array)||bytes.length!==end-start)throw failure('本地文件读取不完整，原上传记录已保留','CLOUD_SYNC_SOURCE_CHANGED');
     const sha256=await hash(bytes),prior=received.get(index);if(prior&&(prior.bytes!==bytes.length||prior.sha256!==sha256))throw failure('本地文件与原上传不同，未覆盖云端分块','CLOUD_SYNC_SOURCE_CHANGED');
     if(!prior)await request(auth,'/v1/cloud-sync/uploads/'+upload.id+'/chunks/'+index,{method:'PUT',bytes,sha256,signal});
     sent+=bytes.length;onProgress({phase:'uploading',bytes:sent,total:source.bytes});
    }
    const result=await request(auth,'/v1/cloud-sync/uploads/'+upload.id+'/commit',{method:'POST',body:{},signal});if(!id(result.file?.id))throw failure('发布响应无效，请查询原上传','CLOUD_SYNC_INVALID_RESPONSE');
    saved={...saved,completed:true,fileId:result.file.id};await journal.set(jkey,saved);onProgress({phase:'complete',bytes:source.bytes,total:source.bytes});return {fileId:result.file.id,conflict:result.conflict===true,resumed:false};
   });
  },
  cancel:async({key,signal})=>{if(!id(key))throw failure('文件身份无效','CLOUD_SYNC_INVALID_REQUEST');const auth=await authenticate(signal),jkey=journalKey(auth,key);return enter(jkey,async()=>{const saved=await journal.get(jkey);if(!saved)return {cancelled:false};if(saved.uploadId&&!saved.completed)await request(auth,'/v1/cloud-sync/uploads/'+saved.uploadId,{method:'DELETE',signal});await journal.remove(jkey);return {cancelled:true};});},
  download:async({fileId,sink,onProgress=()=>{},signal})=>{
   if(!id(fileId)||!sink||!['begin','write','finish','abort'].every(key=>typeof sink[key]==='function'))throw failure('需要原生暂存文件与校验写入器','CLOUD_SYNC_INVALID_SINK');
   const auth=await authenticate(signal),manifest=await request(auth,'/v1/cloud-sync/files/'+fileId+'/manifest',{signal});
   if(manifest.file?.id!==fileId||!digest(manifest.file.sha256)||!Number.isSafeInteger(manifest.file.bytes)||manifest.file.bytes<0||manifest.chunkBytes!==4*1024*1024||!Array.isArray(manifest.chunks)||manifest.chunks.length!==Math.ceil(manifest.file.bytes/manifest.chunkBytes))throw failure('下载清单无效','CLOUD_SYNC_INVALID_RESPONSE');
   await sink.begin(manifest);let received=0;
   try{for(let index=0;index<manifest.chunks.length;index++){
    const chunk=manifest.chunks[index],expected=Math.min(manifest.chunkBytes,manifest.file.bytes-received);if(chunk.index!==index||chunk.bytes!==expected||!digest(chunk.sha256))throw failure('下载分块清单无效','CLOUD_SYNC_INVALID_RESPONSE');
    const bytes=await request(auth,'/v1/cloud-sync/files/'+fileId+'/chunks/'+index,{binary:true,signal});if(bytes.length!==expected||await hash(bytes)!==chunk.sha256)throw failure('下载摘要不符，未替换本地文件','CLOUD_SYNC_HASH_MISMATCH');
    await sink.write(index,bytes);received+=bytes.length;onProgress({phase:'downloading',bytes:received,total:manifest.file.bytes});
   }
   const current=await session();if(current.user.id!==auth.user.id||current.token!==auth.token)throw failure('登录账号已变化，未采用原账号下载','CLOUD_SYNC_ACCOUNT_CHANGED');
   const verified=await sink.finish({bytes:manifest.file.bytes,sha256:manifest.file.sha256});if(verified?.verified!==true)throw failure('本地整文件校验未确认，未完成下载','CLOUD_SYNC_HASH_MISMATCH');onProgress({phase:'complete',bytes:received,total:received});return {file:manifest.file,verified:true};
   }catch(error){await sink.abort().catch(()=>{});throw error;}
  }
 };
}
