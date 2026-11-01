// Desktop and Android share this immutable DAG. IO owns bytes/persistence.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const syncDigest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export function syncLogicalPath(value){
 if(typeof value!=='string'||!value||value!==value.normalize('NFC')||value.length>2048||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f<>:"|?*]/.test(p)||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)))throw Error('同步路径无效');return value;
}
export function syncRemoteRoot(value){return syncLogicalPath(String(value||'').normalize('NFC').replace(/^\/+|\/+$/g,''));}
const invalid=()=>Object.assign(Error('同步历史清单不完整或损坏，已停止应用，未覆盖本地资料'),{code:'REMOTE_METADATA_CORRUPT'});
const changed=()=>Object.assign(Error('同步版本已变化，双方内容与历史均已保留，请重新比较'),{code:'REMOTE_CHANGED_DURING_SYNC'});
export function createSyncRevisionJournal({io,remoteRoot,deviceId,layoutVersion=1}){
 if(![1,2].includes(layoutVersion))throw Error('不支持的同步历史布局');
 const root=syncRemoteRoot(remoteRoot),meta=root+'/.shensi-journal-v'+layoutVersion,revisions=meta+'/revisions',objects=meta+'/objects';let ready;
 // v2 is explicitly selected only for an independent root; do not silently
 // move the user's v1 journal. Every parent directory has at most 256 children.
 // ponytail: 65,536 leaf buckets, with the existing per-list truncation guard
 // still enforced; add a deeper protocol version only if a leaf reaches it.
 const objectPath=(base,id)=>base+'/'+(layoutVersion===2?id.slice(0,2)+'/'+id.slice(2,4)+'/':'')+id;
 const ensureParent=async path=>{if(layoutVersion===2)await io.ensure(path.slice(0,path.lastIndexOf('/')));};
 async function initialize(){
  if(!ready)ready=(async()=>{await io.ensure(root);for(const old of ['protocol.json','.shensi-sync','.shensi-sync-v2','workspaces','author','.shensi-journal-v'+(layoutVersion===1?2:1)])if((await io.head(root+'/'+old)).exists)throw Object.assign(Error('旧同步目录必须保留；安全历史协议需独立目录'),{code:'NUTSTORE_LEGACY_ROOT'});for(const path of [meta,revisions,objects])await io.ensure(path);})().catch(error=>{ready=null;throw error;});return ready;
 }
 function validate(v){
  try{if(!v||v.version!==1||!uuid.test(v.revision)||!Array.isArray(v.parents)||v.parents.length>100||new Set(v.parents).size!==v.parents.length||v.parents.some(p=>!uuid.test(p)||p===v.revision)||syncLogicalPath(v.logicalPath)!==v.logicalPath||typeof v.deleted!=='boolean'||!/^[a-f0-9]{64}$/.test(v.hash)||!Number.isSafeInteger(v.size)||v.size<0||typeof v.contentType!=='string'||v.contentType.length>256||v.deleted&&(v.object!==null||v.size!==0)||!v.deleted&&!uuid.test(v.object))throw invalid();}catch{throw invalid();}return v;
 }
 async function scan(){
  await initialize();return io.scan?io.scan(scanRecords):scanRecords(io);
 }
 async function scanRecords(reader){
  const entries=[],all=new Map();
  if(layoutVersion===1)for(const name of await reader.list(revisions))entries.push({name,path:revisions+'/'+name});
  else for(const first of await reader.list(revisions,'collections')){
   if(!/^[a-f0-9]{2}$/.test(first))throw invalid();
   for(const second of await reader.list(revisions+'/'+first,'collections')){
    if(!/^[a-f0-9]{2}$/.test(second))throw invalid();
    for(const name of await reader.list(revisions+'/'+first+'/'+second)){
     if(!name.startsWith(first+second))throw invalid();entries.push({name,path:revisions+'/'+first+'/'+second+'/'+name});
    }
   }
  }
  for(const {name,path} of entries){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))throw invalid();let bytes,v;
   try{bytes=await reader.getBytes(path,2*1024*1024);}catch(error){if(error.code==='WEBDAV_HTTP_404')throw invalid();throw error;}
   // A rate limit or expired credential is not corrupt history. Preserve the
   // transport error so the scheduler/UI can wait or ask for reconnection.
   try{v=validate(JSON.parse(decoder.decode(bytes)));}catch{throw invalid();}if(name!==v.revision+'.json'||all.has(v.revision))throw invalid();all.set(v.revision,v);
  }
  // Iterative traversal also works with long histories on mobile.
  const checked=new Set();
  for(const first of all.values()){
   const pending=[[first,false]],visiting=new Set();
   while(pending.length){const [v,done]=pending.pop();if(done){checked.add(v.revision);visiting.delete(v.revision);continue;}if(checked.has(v.revision))continue;if(visiting.has(v.revision))throw invalid();visiting.add(v.revision);pending.push([v,true]);for(const id of v.parents){const p=all.get(id);if(!p||p.logicalPath!==v.logicalPath)throw invalid();pending.push([p,false]);}}
  }
  const referenced=new Set([...all.values()].flatMap(v=>v.parents)),byPath=new Map(),inventory=[];
  for(const v of all.values())if(!referenced.has(v.revision)){const list=byPath.get(v.logicalPath)||[];list.push(v);byPath.set(v.logicalPath,list);}
  for(const [logicalPath,branches] of byPath){branches.sort((a,b)=>a.revision.localeCompare(b.revision));const revisionIds=branches.map(v=>v.revision),etag=await syncDigest(encoder.encode(revisionIds.join('\n')));if(branches.length>1)inventory.push({logicalPath,conflicted:true,branches,revisionIds,etag});else{const v=branches[0];inventory.push({...v,revisionIds,etag,...v.deleted?{tombstone:{logicalPath,lastKnownRemoteHash:v.hash,transactionId:v.revision,deletedAt:v.updatedAt}}:{}});}}
  return {all,inventory};
 }
 async function expected(path,{expectedRemoteExists=null,expectedRemoteEtag='',resolveRevisions}={},batch=null){
  const prior=batch?batch.get(path)||null:(await scan()).inventory.find(v=>v.logicalPath===path)||null;
  if(prior?.conflicted){if(!Array.isArray(resolveRevisions)||JSON.stringify([...resolveRevisions].sort())!==JSON.stringify(prior.revisionIds))throw changed();}else if(expectedRemoteExists===null||expectedRemoteExists!==!!(prior&&!prior.deleted))throw changed();
  if(prior&&expectedRemoteEtag!==prior.etag||!prior&&expectedRemoteEtag)throw changed();return prior;
 }
 async function commit(value){
  const bytes=encoder.encode(JSON.stringify(validate(value))),path=objectPath(revisions,value.revision)+'.json';await ensureParent(path);if((await io.head(path)).exists)throw changed();
  try{await io.putBytes(path,bytes,'application/json');if(await syncDigest(await io.getBytes(path,2*1024*1024))!==await syncDigest(bytes))throw invalid();}catch(error){error.pendingRevision=value.revision;throw error;}
  return {...value,revisionIds:[value.revision],etag:await syncDigest(encoder.encode(value.revision))};
 }
 async function upload({entry,...options},batch=null){
  const path=syncLogicalPath(entry.logicalPath),prior=await expected(path,options,batch),object=crypto.randomUUID(),revision=crypto.randomUUID();
  const value={version:1,logicalPath:path,revision,parents:prior?.revisionIds||[],object,deleted:false,hash:entry.hash,size:entry.size,contentType:entry.contentType||'application/octet-stream',deviceId,updatedAt:new Date().toISOString()};validate(value);
  // Adapter verifies immutable source and remote byte hash before publishing.
  const destination=objectPath(objects,object);await ensureParent(destination);await io.putEntry(destination,entry,options.onProgress);const result=await commit(value);batch?.set(path,result);return result;
 }
 async function remove({entry,...options},batch=null){
  const path=syncLogicalPath(entry.logicalPath),prior=await expected(path,options,batch);if(!prior||prior.deleted)return prior;
  const result=await commit({version:1,logicalPath:path,revision:crypto.randomUUID(),parents:prior.revisionIds,object:null,deleted:true,hash:prior.hash||await syncDigest(new Uint8Array()),size:0,contentType:'application/x-shensi-tombstone',deviceId,updatedAt:new Date().toISOString()});batch?.set(path,result);return result;
 }
 async function download({entry,...options}){validate(entry);if(entry.deleted)throw invalid();return io.downloadEntry(objectPath(objects,entry.object),entry,options);}
 async function history(path){const result=await scan();return {revisions:[...result.all.values()].filter(v=>v.logicalPath===syncLogicalPath(path)),heads:result.inventory.find(v=>v.logicalPath===path)?.revisionIds||[]};}
 async function withBatch(work){
  // Immutable branches allow one fresh inventory per serial sync plan, not a
  // whole-library rescan for every file. Concurrent writers are NOT overwritten:
  // re-read at the end and report any competing heads before claiming success.
  const snapshot=new Map((await scan()).inventory.map(v=>[v.logicalPath,v])),touched=new Set();let active=true,tail=Promise.resolve(),failure;
  const write=(fn,request)=>{
   if(!active)return Promise.reject(Object.assign(Error('本轮同步快照已结束，请重新扫描'),{code:'NUTSTORE_BATCH_CLOSED'}));
   const pending=tail.then(async()=>{if(failure)throw failure;const result=await fn(request,snapshot);touched.add(request.entry.logicalPath);return result;});
   tail=pending.catch(error=>{failure=error;});return pending;
  };
  let result;
  try{result=await work({...api,withBatch:undefined,upload:r=>write(upload,r),remove:r=>write(remove,r)});}
  finally{active=false;await tail;}
  if(failure)throw failure;
  if(touched.size){const current=new Map((await scan()).inventory.map(v=>[v.logicalPath,v]));for(const path of touched)if(current.get(path)?.etag!==snapshot.get(path)?.etag)throw changed();}
  return result;
 }
 const api={initialize,inventory:async()=>(await scan()).inventory,upload,remove,download,history,withBatch,paths:{root,metaRoot:meta}};return api;
}
