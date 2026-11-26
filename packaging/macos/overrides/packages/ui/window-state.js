// Each window owns its tabs; saved content remains shared by the notebook.
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const viewKeys=new Set(['activeDocument','activeDocumentTabId','activeModule','documentTabs']);
const ownedKeys=new Set(['histories','coreDirectoryHistories','coreHistoryDeleted','coreTextOperations','coreRestoreLog','savedAt','workspaceCommitId','coreDocumentTimes','viewHistories','volumeHistories','moduleHistories','projectHistories','currentVersionMeta','assetHistoryTombstones']);
// History is already durable and service-owned. Do not clone/serialize it for
// every keystroke or viewport change; hydrate it from disk when restoring.
export function editableDraftState(state){return structuredClone(Object.fromEntries(Object.entries(state).filter(([key])=>!ownedKeys.has(key))));}
export function restoreDraftState(draft,remote){const state=structuredClone(draft);for(const key of ownedKeys){if(Object.hasOwn(remote,key))state[key]=structuredClone(remote[key]);else delete state[key];}return state;}
export function newestLocalDraft(browser,disk,clientId){
 const local=browser?.state?browser:null,stored=disk?.state&&!disk.cleared?disk:null;
 // Revisions are comparable only within the same client. A cleared disk
 // revision must also win over an obsolete browser cache after a saved edit.
 if(local?.clientId===clientId&&disk&&Number(disk.revision)>=Number(local.revision))return stored;
 return local||stored;
}
function content(value){if(!value)return value;const copy=structuredClone(value);for(const key of ['contentRef','sourcePath','savedAt','coreRichText'])delete copy[key];return copy;}
function mergeGenerationDrafts(base,local,remote){
 if(!base?.canvas||!local?.canvas||!remote?.canvas)return null;
 const before=content(base),mine=content(local);delete before.canvas.coreGenerationDrafts;delete mine.canvas.coreGenerationDrafts;
 if(stable(before)!==stable(mine))return null;
 const baseDrafts=base.canvas.coreGenerationDrafts||{},localDrafts=local.canvas.coreGenerationDrafts||{},remoteDrafts=remote.canvas.coreGenerationDrafts||{},drafts=structuredClone(remoteDrafts),nodes=new Set(remote.canvas.nodes.map(node=>node.id));
 for(const id of new Set([...Object.keys(baseDrafts),...Object.keys(localDrafts)])){
  if(stable(baseDrafts[id])===stable(localDrafts[id]))continue;
  if(!nodes.has(id)||stable(remoteDrafts[id])!==stable(baseDrafts[id])&&stable(remoteDrafts[id])!==stable(localDrafts[id]))return null;
  if(Object.hasOwn(localDrafts,id))drafts[id]=structuredClone(localDrafts[id]);else delete drafts[id];
 }
 return {...remote,canvas:{...remote.canvas,coreGenerationDrafts:drafts}};
}
const mergeConflict=Symbol('conflict');
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
function mergeFields(base,local,remote,path=''){
 if(stable(local)===stable(base))return structuredClone(remote);
 if(stable(remote)===stable(base)||stable(local)===stable(remote))return structuredClone(local);
 if(path==='canvas.viewport')return structuredClone(local);
 if(path==='canvas.nodes.item'&&[base,local,remote].every(plain)){
  const data=v=>Object.fromEntries(['type','kind','text','file','reference','webSnapshot','operation'].filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));
  if(stable(data(local))!==stable(data(base))&&stable(data(remote))!==stable(data(base))&&stable(data(local))!==stable(data(remote)))return mergeConflict;
 }
 if(['canvas.nodes','canvas.edges','canvas.assets'].includes(path)&&[base,local,remote].every(Array.isArray)){
  if([base,local,remote].some(items=>items.some(v=>!v?.id)||new Set(items.map(v=>v.id)).size!==items.length))return mergeConflict;
  const maps=[base,local,remote].map(items=>new Map(items.map(v=>[v.id,v]))),original=base.map(v=>v.id),baseIds=new Set(original);
  const order=items=>items.filter(v=>baseIds.has(v.id)).map(v=>v.id);
  // Concurrent order edits are not silently normalized (reference order is never merged).
  const reordered=items=>stable(order(items))!==stable(original.filter(id=>items.some(v=>v.id===id)));
  if(reordered(local)&&reordered(remote)&&stable(order(local))!==stable(order(remote)))return mergeConflict;
  const ids=[...new Set([...(reordered(local)?local:remote).map(v=>v.id),...local.map(v=>v.id),...remote.map(v=>v.id)])],result=[];
  for(const id of ids){const value=mergeFields(...maps.map(m=>m.get(id)),path+'.item');if(value===mergeConflict)return value;if(value!==undefined)result.push(value);}
  return result;
 }
 if(![base,local,remote].every(plain))return mergeConflict;
 const result={};for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){const value=mergeFields(base[key],local[key],remote[key],path?path+'.'+key:key);if(value===mergeConflict)return value;if(value!==undefined)result[key]=value;}return result;
}
function mergeBoard(base,local,remote){
 if(!base?.canvas||!local?.canvas||!remote?.canvas)return null;
 const merged=mergeFields(content(base),content(local),content(remote));if(merged===mergeConflict)return null;
 const nodeIds=new Set(merged.canvas.nodes.map(n=>n.id));if((merged.canvas.edges||[]).some(e=>!nodeIds.has(e.fromNode)||!nodeIds.has(e.toNode)))return null;
 // A draft edited against a deleted card must stay a conflict, never be orphaned.
 for(const id of Object.keys(local.canvas.coreGenerationDrafts||{}))if(stable(base.canvas.coreGenerationDrafts?.[id])!==stable(local.canvas.coreGenerationDrafts[id])&&!merged.canvas.nodes.some(n=>n.id===id))return null;
 return {...remote,...merged};
}
function mergeDocument(base,local,remote){
 if(![base,local,remote].every(plain)||[base,local,remote].some(doc=>doc.canvas))return null;
 // HTML and Markdown describe the same body. Never combine concurrent edits
 // to those two representations, even when they touch different fields.
 const body=doc=>stable([doc.html,doc.markdown]);
 if(body(local)!==body(base)&&body(remote)!==body(base)&&body(local)!==body(remote))return null;
 const merged=mergeFields(content(base),content(local),content(remote));
 return merged===mergeConflict?null:{...remote,...merged};
}
export function preserveWindowView(remote,local){
 const state={...remote};for(const key of viewKeys)if(Object.hasOwn(local,key))state[key]=local[key];
 state.documentTabs=(state.documentTabs||[]).filter(tab=>!tab.documentId||state.documents[tab.documentId]);
 if(state.activeDocument&&!state.documents[state.activeDocument]){state.activeDocument='';state.activeDocumentTabId='';}
 return state;
}
export function reconcileWindowState(base,local,remote,{preferLocal=false}={}){
 if(!base)return {conflict:true};const state=preserveWindowView(structuredClone(remote),local),conflicts=[];
 for(const id of new Set([...Object.keys(base.documents||{}),...Object.keys(local.documents||{})])){
  const before=stable(content(base.documents?.[id])),mine=stable(content(local.documents?.[id])),theirs=stable(content(remote.documents?.[id]));
  if(mine===before)continue;if(theirs!==before&&theirs!==mine){const merged=mergeGenerationDrafts(base.documents?.[id],local.documents?.[id],remote.documents?.[id])||mergeBoard(base.documents?.[id],local.documents?.[id],remote.documents?.[id])||mergeDocument(base.documents?.[id],local.documents?.[id],remote.documents?.[id]);if(merged){state.documents[id]=merged;continue;}conflicts.push('document:'+id);if(!preferLocal)continue;}
  if(local.documents?.[id])state.documents[id]=local.documents[id];else delete state.documents[id];
 }
 for(const key of new Set([...Object.keys(base),...Object.keys(local)])){
  if(key==='documents'||viewKeys.has(key)||ownedKeys.has(key))continue;
  const before=stable(base[key]),mine=stable(local[key]),theirs=stable(remote[key]);
  if(mine===before)continue;
  if(key==='coreRecent'&&[base[key],local[key],remote[key]].every(v=>v===undefined||Array.isArray(v))){state[key]=[...new Set([...(local[key]||[]),...(remote[key]||[])])].filter(id=>state.documents[id]).slice(0,30);continue;}
  if(theirs!==before&&theirs!==mine){conflicts.push(key);if(!preferLocal)continue;}
  if(Object.hasOwn(local,key))state[key]=local[key];else delete state[key];
 }
 return conflicts.length&&!preferLocal?{conflict:true,conflicts}:{conflict:false,state:preserveWindowView(state,local),conflicts};
}
