import {validateCloudNotebook,portableNotebookSnapshot,CLOUD_NOTEBOOK_LIMIT} from '../core/src/notebook-snapshot.mjs';
import {checkpoint} from '../core/src/history.mjs';
import {syncDigest} from '../core/src/sync-revision-journal.mjs';
import {mergeNotebookSnapshots,notebookSyncPreview,notebookDeletionConflicts,notebookConflictName} from '../core/src/sync-notebook-merge.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function createMobileNotebookTransfer({documents,storage,media}){
 const verifyMedia=async snapshot=>{if(snapshot.format==='shensi-notebook-snapshot-v2'){if(!media)throw Error('当前入口未加载白板附件同步');for(const receipt of snapshot.media)await media.source(receipt);}};
 const api={
  async peek(id){const row=await documents.load(id);if(!row.state)throw Error('笔记本不存在');return portableNotebookSnapshot(id,row.state,{allowMedia:!!media});},
  async apply(snapshot,{expectedHash}={}){const state=structuredClone(validateCloudNotebook(snapshot)),id=state.notebook.id,row=await documents.load(id);if(!row.state)throw Error('原笔记本不存在，未覆盖');const current=portableNotebookSnapshot(id,row.state,{allowMedia:!!media});if(await syncDigest(encoder.encode(JSON.stringify(current)))!==expectedHash)throw Error('本地内容已变化，请重新预览冲突');await verifyMedia(snapshot);const value=JSON.stringify({...row.state,...state});if(encoder.encode(value).length>CLOUD_NOTEBOOK_LIMIT)throw Error('完整历史超过8MiB，未删减或覆盖');const saved=await storage.compareAndSwap(id,row.revision,value);if(saved.value!==value||JSON.stringify((await documents.load(id)).state)!==value)throw Error('冲突合并回读不一致');return {notebookId:id,copy:false,historyPreserved:true};},
  async export(id){let row=await documents.load(id);if(!row.state)throw Error('笔记本不存在');await verifyMedia(portableNotebookSnapshot(id,row.state,{allowMedia:!!media}));row=await documents.checkpointForSync(id,{expectedRevision:row.revision,direction:'upload'});return portableNotebookSnapshot(id,row.state,{allowMedia:!!media});},
  async import(snapshot){
   const state=structuredClone(validateCloudNotebook(snapshot));await verifyMedia(snapshot);const old=await storage.read(state.notebook.id),original=state.notebook.id;
   if(old.value!==null){const local=await api.peek(original);return api.apply(mergeNotebookSnapshots(local,[snapshot]),{expectedHash:await syncDigest(encoder.encode(JSON.stringify(local)))});}
   for(const [id,doc]of Object.entries(state.documents))if(!doc.deleted)checkpoint(state,id,{source:'sync',operationType:'snapshot',reason:'坚果云下载版本'});
   const value=JSON.stringify(state);if(encoder.encode(value).length>CLOUD_NOTEBOOK_LIMIT)throw Error('笔记本超过8MiB，未删减正文或历史');
   const saved=await storage.compareAndSwap(state.notebook.id,0,value);if(saved.value!==value||saved.revision!==1)throw Error('下载保存回执不符，请核对后继续');
   if(JSON.stringify((await documents.load(state.notebook.id)).state)!==value)throw Error('下载保存回读不符，原库未覆盖');return {notebookId:state.notebook.id,copy:original!==state.notebook.id};
  }
 };
 return api;
}

// Same manual notebook exchange on desktop and phone. Competing content is
// retained in same-document history. Whole-library automatic sync is separate.
export function createNutstoreNotebookTransfer({repository,notebooks,metadata,scope,media}){
 const path=id=>'notebooks/'+id+'.json',key=id=>'nutstore-notebook:'+scope+':'+id;
 const pendingKey='nutstore-notebook-conflicts:'+scope;
 const pending=async(id,add)=>{const ids=new Set(await metadata.get(pendingKey)||[]);add?ids.add(id):ids.delete(id);await metadata.set(pendingKey,[...ids]);};
 const validId=id=>{if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))throw Error('笔记本身份无效');return id;};
 const changed=()=>Object.assign(Error('云端版本已变化，请重新打开冲突窗口核对；双方内容和已保存的历史均保留'),{code:'REMOTE_CHANGED_DURING_SYNC'});
 function validEntry(entry){if(!/^notebooks\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.json$/.test(entry?.logicalPath||'')||entry.deleted||entry.conflicted||entry.size>CLOUD_NOTEBOOK_LIMIT)throw Error('请选择一个有效且未删除的笔记本版本');}
 const chunkBytes=4*1024*1024,mediaPath=(receipt,index)=>'media/'+receipt.id+'/'+receipt.sha256+'/'+String(index).padStart(6,'0');
 async function uploadMedia(snapshot,onProgress){
  if(snapshot.format!=='shensi-notebook-snapshot-v2')return;if(!media)throw Error('当前入口不支持完整白板附件，未上传索引');
  const current=new Map((await repository.inventory()).map(e=>[e.logicalPath,e]));
  // Immutable content-addressed chunks: interrupted uploads resume; a changed
  // head is never overwritten. Publish the notebook only after all media.
  for(const receipt of snapshot.media){const source=await media.source(receipt);for(let start=0,index=0;start<receipt.bytes;start+=chunkBytes,index++){
   const bytes=await source.read(start,Math.min(start+chunkBytes,receipt.bytes)),hash=await syncDigest(bytes),logicalPath=mediaPath(receipt,index),prior=current.get(logicalPath);
   if(prior){if(prior.conflicted||prior.deleted||prior.hash!==hash||prior.size!==bytes.length)throw Error('云端同一附件分块出现冲突，未发布残缺白板');continue;}
   const result=await repository.upload({entry:{logicalPath,bytes,hash,size:bytes.length,contentType:'application/octet-stream'},expectedRemoteExists:false,onProgress});current.set(logicalPath,result);
  }}
 }
 async function downloadMedia(snapshot,onProgress){
  if(snapshot.format!=='shensi-notebook-snapshot-v2')return;if(!media)throw Error('当前入口不支持完整白板附件，未导入索引');
  const current=new Map((await repository.inventory()).map(e=>[e.logicalPath,e]));
  for(const receipt of snapshot.media){const sink=media.sink(receipt);try{await sink.begin({file:receipt});for(let start=0,index=0;start<receipt.bytes;start+=chunkBytes,index++){
   const entry=current.get(mediaPath(receipt,index));if(!entry||entry.deleted||entry.conflicted||entry.size!==Math.min(chunkBytes,receipt.bytes-start))throw Error('云端白板附件分块缺失或冲突，未导入残缺笔记本');
   const bytes=await repository.download({entry,onProgress});await sink.write(index,bytes);
  }await sink.finish(receipt);}catch(error){await sink.abort().catch(()=>{});throw error;}}
 }
 const api={
  async list(){const items=await repository.inventory();return {items:items.filter(e=>e.logicalPath.startsWith('notebooks/')).flatMap(e=>e.conflicted?e.branches.filter(v=>!v.deleted).map(v=>({...v,conflicted:true,branch:true})):e.deleted?[]:[e])};},
  async upload(id,onProgress){
   validId(id);
   const snapshot=await notebooks.export(id);validateCloudNotebook(snapshot);const bytes=encoder.encode(JSON.stringify(snapshot)),hash=await syncDigest(bytes),base=await metadata.get(key(id)),remote=(await repository.inventory()).find(e=>e.logicalPath===path(id));
   if(remote&&!remote.deleted&&!remote.conflicted&&remote.hash===hash){await metadata.set(key(id),{etag:remote.etag,hash});return {unchanged:true,revision:remote.revision};}
   if(remote?.conflicted||remote&&(base?.etag!==remote.etag)){await pending(id,true);throw changed();}
   await uploadMedia(snapshot,onProgress);
   const result=await repository.upload({entry:{logicalPath:path(id),bytes,hash,size:bytes.length,contentType:'application/json'},expectedRemoteExists:!!(remote&&!remote.deleted),expectedRemoteEtag:remote?.etag||'',onProgress});
   await metadata.set(key(id),{etag:result.etag,hash});await pending(id,false);return {revision:result.revision,verified:true};
  },
  async download(request,onProgress){
   // Resolve caller selection from current remote history, never trust a UI
   // supplied hash/object/path. Keep historical versions downloadable.
   const histories=await repository.history(request.logicalPath),entry=histories.revisions.find(v=>v.revision===request.revision);validEntry(entry);
   const bytes=await repository.download({entry,onProgress}),snapshot=JSON.parse(decoder.decode(bytes));validateCloudNotebook(snapshot);
   if(path(snapshot.state.notebook.id)!==entry.logicalPath)throw Error('云端文件与笔记本身份不符');
   await downloadMedia(snapshot,onProgress);
   let result;try{result=await notebooks.import(snapshot);}catch(error){if(['SYNC_TIME_UNCERTAIN','SYNC_DELETE_CONFIRMATION_REQUIRED'].includes(error.code))await pending(snapshot.state.notebook.id,true);throw error;}
   if(result.notebookId===snapshot.state.notebook.id&&histories.heads.length===1&&histories.heads[0]===entry.revision)await metadata.set(key(result.notebookId),{etag:await syncDigest(encoder.encode(entry.revision)),hash:entry.hash});
   return result;
  },
  async conflicts(){
   const ids=new Set(await metadata.get(pendingKey)||[]),items=await repository.inventory();
   const result=[];for(const e of items.filter(e=>/^notebooks\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.json$/.test(e.logicalPath)).filter(e=>e.conflicted||ids.has(e.logicalPath.slice(10,-5)))){const id=e.logicalPath.slice(10,-5),local=await notebooks.peek(id),version=await syncDigest(encoder.encode(e.etag+'\n'+JSON.stringify(local))),remote=await readSnapshots(e),deletions=notebookDeletionConflicts([local,...remote]);result.push({id,logicalPath:e.logicalPath,displayName:notebookConflictName([local,...remote]).name,version,reason:deletions.length?'delete_confirmation':'both_modified',remote:e,resolutions:deletions.length?['delete_both','restore_live']:['use_remote','use_local']});}return result;
  },
  async preview({conflictId:id,expectedVersion}){const value=await conflictContext(id,expectedVersion),ids=notebookConflictName([value.local,...value.remote]).ids;return {sides:[notebookSyncPreview(value.local,'本地',ids),...value.remote.map((s,i)=>notebookSyncPreview(s,'云端版本 '+(i+1),ids))]};},
  async resolve({conflictId:id,resolution,expectedVersion},onProgress){
   const {current,local,remote}=await conflictContext(id,expectedVersion),snapshot=mergeNotebookSnapshots(local,remote,{resolution});
   for(const source of remote)await downloadMedia(source,onProgress);
   const bytes=encoder.encode(JSON.stringify(snapshot)),hash=await syncDigest(bytes),localHash=await syncDigest(encoder.encode(JSON.stringify(local)));
   await uploadMedia(snapshot,onProgress);
   if((await repository.inventory()).find(e=>e.logicalPath===path(id))?.etag!==current.etag||await syncDigest(encoder.encode(JSON.stringify(await notebooks.peek(id))))!==localHash)throw changed();
   const result=await repository.upload({entry:{logicalPath:path(id),bytes,hash,size:bytes.length,contentType:'application/json'},expectedRemoteExists:!current.deleted,expectedRemoteEtag:current.etag,...current.conflicted?{resolveRevisions:current.revisionIds}:{},onProgress});
   const verified=(await repository.inventory()).find(e=>e.logicalPath===path(id));if(verified?.etag!==result.etag||verified.conflicted)throw changed();
   await notebooks.apply(snapshot,{expectedHash:localHash});await metadata.set(key(id),{etag:result.etag,hash});await pending(id,false);return {verified:true,revision:result.revision,copies:[],historyPreserved:true,notebookId:id};
  }
 };
 async function readSnapshots(entry){const snapshots=[];for(const branch of entry.conflicted?entry.branches:[entry]){if(branch.deleted)throw Error('云端整本删除记录需要恢复历史后核对，未自动删除本机');const bytes=await repository.download({entry:branch}),snapshot=JSON.parse(decoder.decode(bytes));validateCloudNotebook(snapshot);if(path(snapshot.state.notebook.id)!==entry.logicalPath)throw Error('云端笔记本身份不符');snapshots.push(snapshot);}return snapshots;}
 async function conflictContext(id,expectedVersion){validId(id);const current=(await repository.inventory()).find(e=>e.logicalPath===path(id));if(!current)throw changed();const local=await notebooks.peek(id);if(await syncDigest(encoder.encode(current.etag+'\n'+JSON.stringify(local)))!==expectedVersion)throw changed();return {current,local,remote:await readSnapshots(current)};}
 return api;
}
