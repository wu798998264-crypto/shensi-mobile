import {validateCloudNotebook,portableNotebookSnapshot,CLOUD_NOTEBOOK_LIMIT} from '../core/src/notebook-snapshot.mjs';
import {checkpoint} from '../core/src/history.mjs';
import {syncDigest} from '../core/src/sync-revision-journal.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function createMobileNotebookTransfer({documents,storage,media}){
 const verifyMedia=async snapshot=>{if(snapshot.format==='shensi-notebook-snapshot-v2'){if(!media)throw Error('当前入口未加载白板附件同步');for(const receipt of snapshot.media)await media.source(receipt);}};
 return {
  async export(id){let row=await documents.load(id);if(!row.state)throw Error('笔记本不存在');await verifyMedia(portableNotebookSnapshot(id,row.state,{allowMedia:!!media}));row=await documents.checkpointForSync(id,{expectedRevision:row.revision,direction:'upload'});return portableNotebookSnapshot(id,row.state,{allowMedia:!!media});},
  async import(snapshot){
   const state=structuredClone(validateCloudNotebook(snapshot));await verifyMedia(snapshot);const old=await storage.read(state.notebook.id),original=state.notebook.id;
   if(old.value!==null){await documents.checkpointForSync(original,{expectedRevision:old.revision,direction:'download'});state.notebook.id='notebook-'+crypto.randomUUID();state.notebook.title=state.notebook.title.slice(0,180)+'（坚果云副本）';}
   for(const [id,doc]of Object.entries(state.documents))if(!doc.deleted)checkpoint(state,id,{source:'sync',operationType:'snapshot',reason:'坚果云下载版本'});
   const value=JSON.stringify(state);if(encoder.encode(value).length>CLOUD_NOTEBOOK_LIMIT)throw Error('笔记本超过8MiB，未删减正文或历史');
   const saved=await storage.compareAndSwap(state.notebook.id,0,value);if(saved.value!==value||saved.revision!==1)throw Error('下载保存回执不符，请核对后继续');
   if(JSON.stringify((await documents.load(state.notebook.id)).state)!==value)throw Error('下载保存回读不符，原库未覆盖');return {notebookId:state.notebook.id,copy:original!==state.notebook.id};
  }
 };
}

// Same manual notebook exchange on desktop and phone. A remote branch never
// replaces a local notebook. Whole-library automatic sync remains separate.
export function createNutstoreNotebookTransfer({repository,notebooks,metadata,scope,media}){
 const path=id=>'notebooks/'+id+'.json',key=id=>'nutstore-notebook:'+scope+':'+id;
 const pendingKey='nutstore-notebook-conflicts:'+scope;
 const pending=async(id,add)=>{const ids=new Set(await metadata.get(pendingKey)||[]);add?ids.add(id):ids.delete(id);await metadata.set(pendingKey,[...ids]);};
 const validId=id=>{if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))throw Error('笔记本身份无效');return id;};
 const changed=()=>Object.assign(Error('云端版本已变化，请重新打开冲突窗口核对；双方内容和已保存的副本均保留'),{code:'REMOTE_CHANGED_DURING_SYNC'});
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
   const result=await notebooks.import(snapshot);
   if(result.notebookId===snapshot.state.notebook.id&&histories.heads.length===1&&histories.heads[0]===entry.revision)await metadata.set(key(result.notebookId),{etag:await syncDigest(encoder.encode(entry.revision)),hash:entry.hash});
   return result;
  },
  async conflicts(){
   const ids=new Set(await metadata.get(pendingKey)||[]),items=await repository.inventory();
   return items.filter(e=>/^notebooks\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.json$/.test(e.logicalPath)).filter(e=>e.conflicted||ids.has(e.logicalPath.slice(10,-5))).map(e=>({id:e.logicalPath.slice(10,-5),logicalPath:e.logicalPath,version:e.etag,reason:'此笔记本存在尚未核对的云端版本。保留双方会下载全部云端分支为独立副本，再上传当前本地版本；不自动拼接正文。',remote:e,resolutions:['keep_both']}));
  },
  async resolve({conflictId:id,resolution,expectedVersion},onProgress){
   validId(id);if(resolution!=='keep_both'||typeof expectedVersion!=='string'||!expectedVersion)throw Error('请先查看冲突并选择保留双方');
   const current=(await repository.inventory()).find(e=>e.logicalPath===path(id));if(!current||current.etag!==expectedVersion)throw changed();
   const copies=[];
   // First preserve EVERY remote head through the ordinary validated import.
   // Neither local notebook nor remote history is replaced or deleted.
   for(const entry of current.conflicted?current.branches:[current])if(!entry.deleted)copies.push(await api.download(entry,onProgress));
   const snapshot=await notebooks.export(id);validateCloudNotebook(snapshot);const bytes=encoder.encode(JSON.stringify(snapshot)),hash=await syncDigest(bytes);
   await uploadMedia(snapshot,onProgress);
   if((await repository.inventory()).find(e=>e.logicalPath===path(id))?.etag!==expectedVersion)throw changed();
   const result=await repository.upload({entry:{logicalPath:path(id),bytes,hash,size:bytes.length,contentType:'application/json'},expectedRemoteExists:!current.deleted,expectedRemoteEtag:current.etag,...current.conflicted?{resolveRevisions:current.revisionIds}:{},onProgress});
   const verified=(await repository.inventory()).find(e=>e.logicalPath===path(id));if(verified?.etag!==result.etag||verified.conflicted)throw changed();
   await metadata.set(key(id),{etag:result.etag,hash});await pending(id,false);return {verified:true,revision:result.revision,copies,historyPreserved:true};
  }
 };return api;
}
