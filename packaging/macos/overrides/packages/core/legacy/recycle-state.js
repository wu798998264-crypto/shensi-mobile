import {createFileTrashEntry,createTreeTrashEntry,recycleHistoryCollection} from './trash.js';
import {removeDocumentFromTabs} from './document-tabs.js';

export function directorySelectionContents(state,tokens){
 const folders=new Set(),documents=new Set();
 const descend=id=>{if(folders.has(id))return;folders.add(id);for(const f of state.coreFolders||[])if(f.parentId===id)descend(f.id);};
 for(const token of tokens){const [kind,...parts]=token.split(':'),id=parts.join(':');if(kind==='folder'&&(state.coreFolders||[]).some(f=>f.id===id))descend(id);else if(kind==='document'&&state.documents[id])documents.add(id);}
 for(const [id,doc] of Object.entries(state.documents))if(folders.has(doc.coreFolderId))documents.add(id);
 return {folders,documents};
}
export function recycleSelection(state,tokens,now=Date.now()){
 const {folders,documents}=directorySelectionContents(state,tokens),removedFolders=(state.coreFolders||[]).filter(f=>folders.has(f.id)&&(!state.coreWork?.enabled||!['manuscript','outline','setting','memory','library'].includes(f.workRole)));
 if(!documents.size&&!removedFolders.length)return null;
 const payload={trashId:'trash-'+crypto.randomUUID(),histories:Object.fromEntries([...documents].map(id=>[id,structuredClone(state.histories?.[id]||[])])),folders:structuredClone(removedFolders),ancestorFolders:structuredClone(state.coreFolders||[]),favorites:(state.coreFavorites||[]).filter(t=>tokens.includes(t)||t.startsWith('document:')&&documents.has(t.slice(9))),moduleItems:Object.fromEntries(Object.entries(state.moduleItems||{}).map(([key,items])=>[key,items.filter(([id])=>documents.has(id))]))};
 const docs=Object.fromEntries([...documents].map(id=>[id,structuredClone(state.documents[id])]));
 const node=f=>({id:f.id,type:'folder',title:f.name,children:[...Object.entries(docs).filter(([,d])=>d.coreFolderId===f.id).map(([id,d])=>({id,type:'file',title:d.title})),...removedFolders.filter(c=>c.parentId===f.id).map(node)]});
 const structure=[...removedFolders.filter(f=>!removedFolders.some(p=>p.id===f.parentId)).map(node),...Object.entries(docs).filter(([,d])=>!removedFolders.some(f=>f.id===d.coreFolderId)).map(([id,d])=>({id,type:'file',title:d.title}))];
 const entry=documents.size===1&&!removedFolders.length?createFileTrashEntry({id:[...documents][0],document:docs[[...documents][0]],now,...payload}):createTreeTrashEntry({id:'selection-'+crypto.randomUUID(),title:tokens.length===1&&removedFolders.length?removedFolders[0].name:'所选目录项（'+tokens.length+' 项）',documents:docs,structure,now,...payload});
 (state.trash??=[]).push(entry);for(const id of documents){delete state.documents[id];Object.assign(state,removeDocumentFromTabs(state,id));}
 for(const [key,items] of Object.entries(state.moduleItems||{}))state.moduleItems[key]=items.filter(([id])=>!documents.has(id));
 const removed=new Set(removedFolders.map(f=>f.id));state.coreFolders=(state.coreFolders||[]).filter(f=>!removed.has(f.id));state.coreFavorites=(state.coreFavorites||[]).filter(t=>!payload.favorites.includes(t));return entry;
}
export function restoreRecycleEntry(state,entry){const next=structuredClone(state);restoreEntry(next,entry);Object.assign(state,next);}
function restoreEntry(state,entry){
 if(entry.kind==='conversation'){
  const conversation=structuredClone(entry.conversation);if(!conversation)throw Error('回收项缺少对话内容');state.conversations??=[];if(state.conversations.some(c=>c.id===conversation.id)){conversation.id='chat-'+crypto.randomUUID();conversation.title=(conversation.title||entry.title)+'（恢复）';}conversation.coreRestoredFromTrash=entry.trashId;conversation.coreRestoredPluginId=entry.coreConversationPluginId||'official.document-chat';conversation.queue=[];conversation.status=conversation.status==='running'?'interrupted':conversation.status||'idle';state.conversations.push(conversation);
 }else if(entry.kind==='history-version'){
  if(!entry.versionEntry)throw Error('回收项缺少历史版本');const collection=recycleHistoryCollection(state,entry.scope);if(!collection.some(v=>v.id===entry.versionEntry.id))collection.unshift(structuredClone(entry.versionEntry));
 }else{
  const docs=structuredClone(entry.kind==='tree'?entry.documents:entry.document?{[entry.id]:entry.document}:null);if(!docs)throw Error('该回收项不包含可恢复的文件');
  if(Object.keys(docs).some(id=>state.documents[id]))throw Error('存在相同身份的文件，已停止恢复，不覆盖现有内容');
  if((entry.folders||[]).some(f=>(state.coreFolders||[]).some(current=>current.id===f.id)))throw Error('存在相同身份的文件夹，已停止恢复，不覆盖现有目录');
  state.coreFolders??=[];const folderMap=new Map([...(entry.ancestorFolders||[]),...(entry.folders||[])].map(f=>[f.id,f]));
  const addFolder=(id,seen=new Set())=>{if(!id||state.coreFolders.some(f=>f.id===id))return;if(seen.has(id))throw Error('回收目录层级循环');const folder=folderMap.get(id);if(!folder)return;addFolder(folder.parentId,new Set([...seen,id]));state.coreFolders.push(structuredClone(folder));};
  for(const f of entry.folders||[])addFolder(f.id);for(const d of Object.values(docs))addFolder(d.coreFolderId);
  restoreLegacyPlacement(state,entry,docs);
  Object.assign(state.documents,structuredClone(docs));state.moduleItems??={};
  const added=new Set();for(const [module,items] of Object.entries(entry.moduleItems||{})){state.moduleItems[module]??=[];for(const item of items)if(docs[item[0]]&&!added.has(item[0])){state.moduleItems[module].push(structuredClone(item));added.add(item[0]);}}
  state.moduleItems.library??=[];for(const [id,d] of Object.entries(docs))if(!added.has(id))state.moduleItems.library.push([id,d.title]);
  state.coreFavorites=[...new Set([...(state.coreFavorites||[]),...(entry.favorites||[])])];
 }
 state.trash=state.trash.filter(e=>e.trashId!==entry.trashId);
}

function restoreLegacyPlacement(state,entry,docs){
 const roles={canon:'setting',setting:'setting',outline:'outline',manuscript:'manuscript',memory:'memory',library:'library'},names={setting:'设定',outline:'大纲',manuscript:'正文',memory:'记忆',library:'资料库'},segments=value=>String(value||'').replaceAll('\\','/').split('/').filter(Boolean);
 const ensure=(path,role='',type='')=>{let parent='';if(state.coreWork?.enabled){let root=state.coreFolders.find(f=>f.workRole===role&&(role!=='manuscript'||(f.workType||state.coreWork.type)===type));if(!root){root={id:'restored-folder-'+crypto.randomUUID(),name:names[role],workRole:role,...(role==='manuscript'?{workType:type}:{})};state.coreFolders.push(root);}parent=root.id;if(path[0]===root.name)path=path.slice(1);}
  for(const name of path){if(['.','..'].includes(name)||/[\u0000-\u001f]/.test(name))throw Error('回收目录层级无效');let folder=state.coreFolders.find(f=>(f.parentId||'')===parent&&f.name===name);if(!folder){folder={id:'restored-folder-'+crypto.randomUUID(),name,parentId:parent,...(role==='manuscript'?{workRole:'volume',workType:type}:{})};state.coreFolders.push(folder);}parent=folder.id;}return parent;
 };
 const oldFolders=new Map((entry.customFolders||[]).map(f=>[f.id,f]));
 for(const folder of oldFolders.values())ensure(segments(folder.folderPath||folder.label),roles[folder.moduleId]||'library',folder.viewId==='script'?'screenplay':state.coreWork?.type||'novel');
 for(const doc of Object.values(docs)){
  if(doc.coreFolderId&&state.coreFolders.some(f=>f.id===doc.coreFolderId))continue;
  const role=doc.canvas?'library':roles[doc.moduleId]||'library',type=doc.workspaceView==='script'?'screenplay':state.coreWork?.type||'novel',folder=oldFolders.get(doc.customFolderId),path=segments(folder?.folderPath||doc.customFolderPath||doc.volumeFolder||'');
  if(state.coreWork?.enabled&&role==='manuscript'&&type==='novel'&&!path.length)path.push('第001卷-未命名');
  if(path.length||state.coreWork?.enabled){doc.coreFolderId=ensure(path,role,type);if(state.coreWork?.enabled){doc.coreWorkRole=role;if(role==='manuscript')doc.coreWorkType=type;}}
 }
 state.customFolders??=[];for(const folder of entry.customFolders||[])if(!state.customFolders.some(f=>f.id===folder.id))state.customFolders.push(structuredClone(folder));
}
