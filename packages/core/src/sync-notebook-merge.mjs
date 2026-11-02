import {snapshotDocument,assertVersion} from './history.mjs';
import {stableVersionJson,sha256HexSync,stampHistoryEntryIntegrity} from '../legacy/version-integrity.js';
import {validateCloudNotebook,portableNotebookSnapshot} from './notebook-snapshot.mjs';
const clone=structuredClone,signature=doc=>stableVersionJson(snapshotDocument(doc));
const contentSignature=doc=>{const value=snapshotDocument(doc);for(const field of ['id','moduleId','documentKind'])delete value[field];value.deleted=!!value.deleted;if(value.canvas){if(!value.canvas.assets?.length)delete value.canvas.assets;value.canvas.settings={snapToGrid:true,gridSize:20,...value.canvas.settings};for(const node of value.canvas.nodes||[])if(node.localMedia)delete node.file;}return stableVersionJson(value);};
export const syncDocumentContent=doc=>stableVersionJson(doc?[doc.title,doc.markdown,doc.html,doc.canvas?.nodes,doc.canvas?.edges,!!doc.deleted]:null);
const time=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)&&n>0?n:0;};
export function documentSyncTime(state,id){
 const doc=state.documents[id],times=state.coreDocumentTimes?.[id]||{};if(!doc)return {modifiedAt:'',createdAt:''};
 const modifiedAt=time(times.modifiedAt)||time(doc?.updatedAt)||time(doc?.modifiedAt);
 if(modifiedAt)return {modifiedAt:new Date(modifiedAt).toISOString(),createdAt:times.createdAt||doc?.createdAt||''};
 const matched=(state.histories[id]||[]).filter(v=>v.document&&signature(v.document)===signature(doc)&&v.source!=='sync').map(v=>time(v.createdAt||v.time)).filter(Boolean);
 return {modifiedAt:matched.length?new Date(Math.max(...matched)).toISOString():'',createdAt:times.createdAt||doc?.createdAt||''};
}
export function notebookConflictName(snapshots){const states=snapshots.map(validateCloudNotebook),ids=[...new Set(states.flatMap(s=>Object.keys(s.documents)))].filter(id=>new Set(states.map(s=>s.documents[id]?contentSignature(s.documents[id]):'missing')).size>1),names=ids.map(id=>states.find(s=>s.documents[id]).documents[id].title);return {ids,name:states[0].notebook.title+(names.length?' / '+names.slice(0,3).join('、')+(names.length>3?' 等'+names.length+'项':''):'')};}
export function notebookSyncPreview(snapshot,label,documentIds){
 const state=validateCloudNotebook(snapshot),docs=Object.entries(state.documents).filter(([id])=>!documentIds?.length||documentIds.includes(id));
 return {label,name:state.notebook.title,modifiedAt:docs.map(([id])=>documentSyncTime(state,id).modifiedAt).sort().at(-1)||'',createdAt:docs.length===1?documentSyncTime(state,docs[0][0]).createdAt:'',text:docs.slice(0,80).map(([id,d])=>`${d.title}${d.deleted?'（已删除）':''}\n创建：${documentSyncTime(state,id).createdAt||'未记录'}\n修改：${documentSyncTime(state,id).modifiedAt||'未记录'}\n${d.canvas?'白板 · '+d.canvas.nodes.length+' 张卡片\n'+d.canvas.nodes.slice(0,15).map(n=>n.name||n.text||n.type).join('\n'):String(d.markdown).slice(0,1200)}`).join('\n\n').slice(0,32000),documentCount:docs.length};
}
export function notebookDeletionConflicts(snapshots){
 const states=snapshots.map(validateCloudNotebook),byId=new Map();for(const state of states)for(const [id,doc]of Object.entries(state.documents)){const list=byId.get(id)||[];list.push(doc);byId.set(id,list);}
 return [...byId].filter(([id,docs])=>docs.some(d=>d.deleted)&&docs.some(d=>!d.deleted)&&!agreedDeletion(states,id,docs)).map(([id,docs])=>({id,title:docs.find(d=>!d.deleted).title}));
}
function agreedDeletion(states,id,docs){
 const hashes=docs.map(d=>sha256HexSync(contentSignature(d)));
 const matches=states.flatMap(s=>s.coreSyncResolutions?.[id]?[s.coreSyncResolutions[id]]:[]).filter(d=>hashes.includes(d.output)&&states.every(s=>{
  const doc=s.documents[id];if(!doc)return true;
  const hash=sha256HexSync(contentSignature(doc)),modified=time(documentSyncTime(s,id).modifiedAt);
  if(d.resolvedAt&&modified>time(d.resolvedAt))return false;
  // Offline devices may still have an observed ancestor, not either conflict
  // head. Only that exact old content/time is covered; new edits still ask.
  return d.inputs.includes(hash)||modified>0&&modified<=time(d.ancestors?.[hash]);
 }));
 return matches.length&&new Set(matches.map(d=>d.output)).size===1?matches[0]:null;
}
// A single stable document identity, with immutable competing contents in its
// history. Upload time is deliberately NOT used as the edit time.
export function mergeNotebookSnapshots(local,remotes,{resolution='keep_both'}={}){
 if(!['keep_both','use_local','use_remote','delete_both','restore_live'].includes(resolution))throw Error('冲突处理方式无效');
 const snapshots=[local,...remotes],states=snapshots.map(s=>validateCloudNotebook(s)),id=states[0].notebook.id;
 if(states.some(s=>s.notebook.id!==id))throw Error('笔记本身份不一致，未合并');
 const result=clone(states[0]);result.coreDocumentTimes??={};result.histories??={};result.coreSyncDraftHistory??=[];result.coreSyncRetainedAt??={};
 const newest=choices=>{
  if(choices.length===1)return choices[0];
  if(choices.every(c=>contentSignature(c.doc)===contentSignature(choices[0].doc)))return choices[0];
  const groups=new Map();for(const c of choices){const key=contentSignature(c.doc),at=time(documentSyncTime(c.state,c.id).modifiedAt);if(!groups.has(key)||at>groups.get(key).at)groups.set(key,{...c,at});}const sorted=[...groups.values()].sort((a,b)=>b.at-a.at);
  if(sorted.some(c=>!c.at||c.at>Date.now()+300000)||sorted[0].at===sorted[1].at)throw Object.assign(Error('“'+choices[0].doc.title+'”的修改时间缺失、相同或设备时钟异常，无法判断较新版本；请预览后选择保留本地或保留云端，双方内容会进入历史'),{code:'SYNC_TIME_UNCERTAIN'});
  return sorted[0];
 };
 const union=(lists,key)=>{const map=new Map();for(const list of lists)for(const item of list||[])if(!map.has(key(item)))map.set(key(item),clone(item));return [...map.values()];};
 const ids=new Set(states.flatMap(s=>Object.keys(s.documents)));
 for(const documentId of ids){
  const choices=states.flatMap((state,index)=>state.documents[documentId]?[{state,index,id:documentId,doc:state.documents[documentId]}]:[]),live=choices.filter(c=>!c.doc.deleted),deleted=choices.filter(c=>c.doc.deleted);
  const histories=new Map();for(const choice of choices)for(const entry of choice.state.histories[documentId]||[]){assertVersion(entry);if(histories.has(entry.id)&&signature(histories.get(entry.id).document)!==signature(entry.document))throw Error('相同历史身份包含不同内容，已停止合并');if(!histories.has(entry.id))histories.set(entry.id,clone(entry));}
  for(const choice of choices){if([...histories.values()].some(v=>signature(v.document)===signature(choice.doc)))continue;const document=snapshotDocument(choice.doc),hash=sha256HexSync(signature(document)),times=documentSyncTime(choice.state,documentId),stamp=times.modifiedAt||times.createdAt||'1970-01-01T00:00:00.000Z';const version=stampHistoryEntryIntegrity({id:'sync-history-'+hash,title:document.title,name:'同步冲突保留版本',time:stamp,createdAt:stamp,scopeType:'document',scopeId:documentId,document},{source:'sync',operationType:'merge',reason:'同步冲突保留版本'});histories.set(version.id,version);}
  const decision=chosen=>{
   const ancestors={};for(const entry of histories.values()){const stamp=time(entry.createdAt||entry.time),hash=sha256HexSync(contentSignature(entry.document));if(stamp>time(ancestors[hash]))ancestors[hash]=new Date(stamp).toISOString();}
   return {inputs:[...new Set(choices.map(c=>sha256HexSync(contentSignature(c.doc))))],ancestors,output:sha256HexSync(contentSignature(chosen.doc)),resolvedAt:new Date().toISOString()};
  };
  let chosen;
  if(deleted.length&&live.length){
   const known=agreedDeletion(states,documentId,choices.map(c=>c.doc));
   if(!['delete_both','restore_live'].includes(resolution)&&!known)throw Object.assign(Error('“'+live[0].doc.title+'”在一端已删除，请确认双端删除，或取消删除并恢复'),{code:'SYNC_DELETE_CONFIRMATION_REQUIRED'});
   chosen=['delete_both','restore_live'].includes(resolution)?(resolution==='delete_both'?deleted[0]:live.find(c=>c.index===0)||newest(live)):choices.find(c=>sha256HexSync(contentSignature(c.doc))===known.output);
   (result.coreSyncResolutions??={})[documentId]=['delete_both','restore_live'].includes(resolution)?decision(chosen):clone(known);
  }else{
   const known=agreedDeletion(states,documentId,choices.map(c=>c.doc));
   chosen=resolution==='use_local'?choices.find(c=>c.index===0)||newest(choices):resolution==='use_remote'?newest(choices.filter(c=>c.index!==0).length?choices.filter(c=>c.index!==0):choices):known?choices.find(c=>sha256HexSync(contentSignature(c.doc))===known.output):newest(choices);
   // An explicit choice may intentionally keep an older edit. Propagate that
   // decision, not a forged modification time, so a third device cannot undo it.
   if(['use_local','use_remote'].includes(resolution)||known){
    (result.coreSyncResolutions??={})[documentId]=['use_local','use_remote'].includes(resolution)?decision(chosen):clone(known);
   }
  }
  result.documents[documentId]=clone(chosen.doc);result.coreDocumentTimes[documentId]=documentSyncTime(chosen.state,documentId);
  result.histories[documentId]=[...histories.values()].sort((a,b)=>time(b.createdAt||b.time)-time(a.createdAt||a.time)||a.id.localeCompare(b.id));
  const retained=result.coreSyncRetainedAt[documentId]??={};for(const entry of histories.values()){const known=states.map(s=>time(s.coreSyncRetainedAt?.[documentId]?.[entry.id])).filter(Boolean);retained[entry.id]=known.length?new Date(Math.max(...known)).toISOString():new Date().toISOString();}
 }
 for(const state of states)for(const [id,decision]of Object.entries(state.coreSyncResolutions||{}))if(!result.coreSyncResolutions?.[id])(result.coreSyncResolutions??={})[id]=clone(decision);
 result.coreFolders=union(states.map(s=>s.coreFolders),f=>f.id);result.coreFavorites=[...new Set(states.flatMap(s=>s.coreFavorites||[]))];result.coreRestoreLog=union(states.map(s=>s.coreRestoreLog),v=>v.id);result.coreHistoryDeleted=union(states.map(s=>s.coreHistoryDeleted),v=>stableVersionJson(v));
 result.mobileDrafts??={};for(const state of states.slice(1)){for(const [docId,draft]of Object.entries(state.mobileDrafts||{})){if(!result.mobileDrafts[docId])result.mobileDrafts[docId]=clone(draft);else if(stableVersionJson(result.mobileDrafts[docId])!==stableVersionJson(draft))result.coreSyncDraftHistory.push({documentId:docId,draft:clone(draft)});}}
 result.coreSyncDraftHistory=union([result.coreSyncDraftHistory,...states.slice(1).map(s=>s.coreSyncDraftHistory)],v=>stableVersionJson(v));
 return portableNotebookSnapshot(id,result,{allowMedia:true});
}
