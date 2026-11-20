import {mergeNotebookSnapshots,syncDocumentVersion} from '../core/src/sync-notebook-merge.mjs';
import {portableNotebookSnapshot} from '../core/src/notebook-snapshot.mjs';
import {syncDigest} from '../core/src/sync-revision-journal.mjs';
import {stableVersionJson} from '../core/legacy/version-integrity.js';

const hash=s=>syncDigest(new TextEncoder().encode(JSON.stringify(s)));
// Stable key order prevents desktop materialization and phone object insertion
// order from republishing byte-different but semantically identical snapshots.
const portable=s=>JSON.parse(stableVersionJson(portableNotebookSnapshot(s.state.notebook.id,s.state,{allowMedia:true})));
const matches=(doc,version)=>doc&&!doc.deleted&&syncDocumentVersion(doc)===version;
// Keep only review fingerprints in private metadata, not a second notebook.
// They survive per-request transfer instances and let a batch protect edits
// made before it reaches this notebook. Remote heads and deletions stay strict.
export function createNotebookConflictReviews({metadata,scope}){
 const key=id=>'sync-conflict-review:'+scope+':'+id;
 const fingerprints=async snapshot=>Object.fromEntries(await Promise.all(Object.entries(snapshot.state.documents).map(async([id,doc])=>[id,{hash:await hash([doc,snapshot.state.coreDocumentTimes?.[id]]),deleted:!!doc.deleted}])));
 return {
  async remember(local,remoteVersion,version,deletion){await metadata.set(key(local.state.notebook.id),{version,remoteVersion,deletion,at:Date.now(),documents:await fingerprints(local)});},
  async changed(local,remoteVersion,request){
   if(!request.preserveLocalChanges||!['use_local','use_remote'].includes(request.resolution))return null;
   const review=await metadata.get(key(local.state.notebook.id));
   if(!review||review.version!==request.expectedVersion||review.remoteVersion!==remoteVersion||review.deletion||Date.now()-review.at>86400000)return null;
   const current=await fingerprints(local);
   if(Object.entries(review.documents).some(([id,doc])=>!current[id]||current[id].deleted!==doc.deleted)||Object.values(current).some(v=>v.deleted))return null;
   return Object.keys(current).filter(id=>current[id].hash!==review.documents[id]?.hash);
  }
 };
}
export function preserveReviewedEdits(snapshot,local,ids=[]){
 for(const id of ids){snapshot.state.documents[id]=structuredClone(local.state.documents[id]);snapshot.state.coreDocumentTimes[id]=structuredClone(local.state.coreDocumentTimes?.[id]||{});if(snapshot.state.coreSyncResolutions)delete snapshot.state.coreSyncResolutions[id];}
 return snapshot;
}
// The shared snapshot has a canonical head; this device's chosen head lives
// only in machine/private metadata. Both heads remain ordinary document history.
export function sharedDeviceSnapshot(snapshot,choices={}){
 const result=structuredClone(snapshot);
 for(const [id,choice]of Object.entries(choices)){
  if(!matches(result.state.documents[id],choice.selected))continue;
  if(choice.selected===choice.shared)continue;
  const version=result.state.histories[id]?.find(v=>matches(v.document,choice.shared));
  if(!version)throw Error('同步基线版本不在历史中，已停止上传；请重新核对冲突');
  const current=result.state.documents[id],document=structuredClone(version.document);
  // History excludes placement and viewport; do not lose either when projecting
  // a historical head for upload.
  if(current.coreFolderId!==undefined)document.coreFolderId=current.coreFolderId;
  if(document.canvas&&current.canvas?.viewport!==undefined)document.canvas.viewport=structuredClone(current.canvas.viewport);
  result.state.documents[id]=document;result.state.coreDocumentTimes[id]=structuredClone(choice.sharedTime);
 }
 return portable(result);
}
function keepDeviceHeads(local,shared,choices){
 const result=structuredClone(shared),next={};
 for(const [id,choice]of Object.entries(choices)){
  const current=local.state.documents[id],remote=shared.state.documents[id];
  if(!matches(current,choice.selected)||!remote||remote.deleted)continue;
  next[id]={selected:choice.selected,shared:syncDocumentVersion(remote),sharedTime:shared.state.coreDocumentTimes?.[id]||{}};
  result.state.documents[id]=structuredClone(current);result.state.coreDocumentTimes[id]=structuredClone(local.state.coreDocumentTimes?.[id]||{});
 }
 return {snapshot:portable(result),choices:next};
}
function mergeSharedHeads(local,remotes,choices){
 const shared=sharedDeviceSnapshot(local,choices);
 // A single verified remote head may supersede a previous shared selection
 // even with equal edit times. It does not supersede this device's view.
 // Never use this shortcut for deletions, unseen edits or concurrent branches.
 if(remotes.length===1)for(const [id,choice]of Object.entries(choices)){
  const remote=remotes[0].state.documents[id];if(!matches(local.state.documents[id],choice.selected)||!remote||remote.deleted)continue;
  shared.state.documents[id]=structuredClone(remote);shared.state.coreDocumentTimes[id]=structuredClone(remotes[0].state.coreDocumentTimes?.[id]||{});
  if(shared.state.coreSyncResolutions)delete shared.state.coreSyncResolutions[id];
 }
 return mergeNotebookSnapshots(shared,remotes);
}
export function createDeviceNotebookViews({notebooks,metadata,scope}){
 const key=id=>'sync-device-current:'+scope+':'+id;
 async function choices(id,local){
  const record=await metadata.get(key(id));if(!record?.pending)return record?.choices||{};
  const current=await hash(local),pending=record.pending;
  // Resume a selection whose document commit completed before process exit.
  if(current===pending.result){await metadata.set(key(id),{choices:pending.choices});return pending.choices;}
  if(current===pending.before)return record.choices||{};
  const recovered={...record.choices};for(const [docId,choice]of Object.entries(pending.choices))if(matches(local.state.documents[docId],choice.selected))recovered[docId]=choice;
  await metadata.set(key(id),{choices:recovered});return recovered;
 }
 async function persist(local,prepared,apply){
  const id=local.state.notebook.id,prior=await choices(id,local),pending={before:await hash(local),result:await hash(prepared.snapshot),choices:prepared.choices};
  await metadata.set(key(id),{choices:prior,pending});
  // On failure leave pending intact: a document commit can finish before the
  // metadata acknowledgement. The next read recovers from actual saved content.
  const result=await apply(prepared.snapshot);await metadata.set(key(id),{choices:prepared.choices});return result;
 }
 return {
  peek:(...args)=>notebooks.peek(...args),
  async export(id){const snapshot=await notebooks.export(id);return sharedDeviceSnapshot(snapshot,await choices(id,snapshot));},
  async import(snapshot){
   let pending;
   const result=await notebooks.import(snapshot,{merge:async(local,remotes)=>{
     const id=local.state.notebook.id,prior=await choices(id,local),shared=mergeSharedHeads(local,remotes,prior),prepared=keepDeviceHeads(local,shared,prior);
     pending={id,prior,before:await hash(local),result:await hash(prepared.snapshot),choices:prepared.choices};
     await metadata.set(key(id),{choices:prior,pending:{before:pending.before,result:pending.result,choices:pending.choices}});return prepared.snapshot;
   }});
   if(pending)await metadata.set(key(pending.id),{choices:pending.choices});return result;
  },
  async apply(snapshot,{expectedHash,deviceResolution,deviceConflictIds=[],preserveLocalChanges=false,expectedSnapshot}={}){
   const id=snapshot.state.notebook.id,local=await notebooks.peek(id),liveHash=await hash(local),edited=liveHash!==expectedHash;
   if(edited&&(!preserveLocalChanges||!expectedSnapshot||await hash(expectedSnapshot)!==expectedHash||!['use_local','use_remote'].includes(deviceResolution)))throw Error('本地内容已变化，请重新预览冲突');
   const changedIds=edited?Object.keys(local.state.documents).filter(docId=>!expectedSnapshot.state.documents[docId]||syncDocumentVersion(local.state.documents[docId])!==syncDocumentVersion(expectedSnapshot.state.documents[docId])):[];
   if(edited){snapshot=mergeNotebookSnapshots(snapshot,[local],{resolution:'use_local'});for(const docId of changedIds){snapshot.state.documents[docId]=structuredClone(local.state.documents[docId]);snapshot.state.coreDocumentTimes[docId]=structuredClone(local.state.coreDocumentTimes?.[docId]||{});}}
   const selected=['use_local','use_remote'].includes(deviceResolution),prior=await choices(id,local),next={};
   const prepared=keepDeviceHeads(local,snapshot,prior);
   if(selected){for(const docId of deviceConflictIds){const doc=snapshot.state.documents[docId];if(!doc||doc.deleted)continue;next[docId]={selected:syncDocumentVersion(doc),shared:syncDocumentVersion(doc),sharedTime:snapshot.state.coreDocumentTimes?.[docId]||{}};prepared.snapshot.state.documents[docId]=structuredClone(doc);prepared.snapshot.state.coreDocumentTimes[docId]=structuredClone(snapshot.state.coreDocumentTimes?.[docId]||{});}Object.assign(prepared.choices,next);prepared.snapshot=portable(prepared.snapshot);}
   return persist(local,prepared,value=>notebooks.apply(value,{expectedHash:liveHash}));
  }
 };
}
