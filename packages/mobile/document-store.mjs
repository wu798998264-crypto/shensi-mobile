import {checkpoint,assertVersion} from '../core/src/history.mjs';
import {sha256HexSync,stableVersionJson} from '../core/legacy/version-integrity.js';
import {renderMarkdown} from './rich-text.mjs';

const fail=(message,code='INVALID_DOCUMENT')=>Object.assign(new Error(message),{code});
const clone=structuredClone;
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const id=value=>{if(!validId(value))throw fail('无效笔记本、文档或操作身份');return value;};
const text=value=>{if(typeof value!=='string'||value.length>2000000)throw fail('文档正文无效或超过当前移动端安全上限');return value;};
const title=value=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw fail('标题不能为空且不超过200字');return value.trim();};
const hash=value=>sha256HexSync(stableVersionJson(value));
const plainHtml=renderMarkdown;

export function createMobileDocumentStore({storage}={}){
 if(!storage||!['read','compareAndSwap','list'].every(k=>typeof storage[k]==='function'))throw fail('需要原生事务存储，不允许降级到浏览器缓存','NATIVE_STORAGE_REQUIRED');
 const queues=new Map();
 const serial=(key,fn)=>{const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,next);next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;};
 async function load(key){
  id(key);const row=await storage.read(key);if(!Number.isSafeInteger(row?.revision)||row.revision<0)throw fail('存储版本无效','STORAGE_INVALID');
  if(row.value===null)return {revision:row.revision,state:null};
  let state;try{state=JSON.parse(row.value);}catch{throw fail('笔记本数据损坏；未覆盖原数据','STORAGE_INVALID');}
  if(state.schemaVersion!==1||state.notebook?.id!==key||!state.documents||!state.histories)throw fail('笔记本结构不兼容；未覆盖原数据','STORAGE_INVALID');
  return {revision:row.revision,state};
 }
 async function persist(key,current){
  const value=JSON.stringify(current.state);if(new TextEncoder().encode(value).byteLength>8*1024*1024)throw fail('笔记本超过当前移动内核8MiB上限，未删除正文或历史','STORAGE_LIMIT');
  const saved=await storage.compareAndSwap(key,current.revision,value);
  if(saved.revision!==current.revision+1||saved.value!==value)throw fail('事务提交回读不一致，请重新读取，不要重复提交','STORAGE_RECEIPT_INVALID');
  return {revision:saved.revision,state:clone(current.state)};
 }
 const document=(state,documentId)=>{
  id(documentId);const doc=state.documents[documentId];if(!doc||doc.canvas)throw fail('当前只接入普通文档；白板保持独立原协议');
  if(doc.locked||doc.coreLocked||doc.readOnly||doc.deleted)throw fail('文档已锁定、只读或在回收站','DOCUMENT_LOCKED');return doc;
 };
 async function mutate(key,request,kind,action){return serial(id(key),async()=>{
  id(request.operationId);const current=await load(key);if(!current.state)throw fail('笔记本不存在');
  const {expectedRevision,operationId,...payload}=request,requestHash=hash({kind,...payload});
  const prior=current.state.coreTextOperations?.[operationId];
  if(prior){if(prior.requestHash!==requestHash)throw fail('操作身份已用于其他内容','OPERATION_CONFLICT');return {...current,replayed:true,historyReceipt:prior.historyReceipt};}
  if(current.revision!==expectedRevision)throw fail('资料已变化，保留当前输入并重新核对','WORKSPACE_STATE_CONFLICT');
  const receipt=action(current.state);
  (current.state.coreTextOperations??={})[operationId]={requestHash,documentId:payload.documentId,createdAt:new Date().toISOString(),historyReceipt:receipt||null};
  return {...await persist(key,current),historyReceipt:receipt};
 });}
 return {
  load,
  async list(){const keys=await storage.list(),notebooks=[];for(const key of keys){const row=await load(key);if(row.state)notebooks.push({...row.state.notebook,revision:row.revision});}return notebooks;},
  createNotebook:({id:key,title:name})=>serial(id(key),async()=>{
   const current=await load(key);if(current.state)throw fail('笔记本已存在','WORKSPACE_STATE_CONFLICT');
   current.state={schemaVersion:1,notebook:{id:key,title:title(name)},documents:{},histories:{},coreFolders:[],coreTextOperations:{},coreRestoreLog:[],mobileDrafts:{}};
   return persist(key,current);
  }),
  createDocument:(key,request)=>mutate(key,request,'create',state=>{
   id(request.documentId);if(state.documents[request.documentId])throw fail('文档已经存在');
   const markdown=text(request.markdown??'');state.documents[request.documentId]={id:request.documentId,title:title(request.title),documentKind:'markdown',markdown,html:plainHtml(markdown)};
   // Desktop user-created documents do not implicitly create history.
  }),
  saveDocument:(key,request)=>mutate(key,request,'save',state=>{
   const doc=document(state,request.documentId),markdown=text(request.markdown);
   doc.markdown=markdown;doc.html=plainHtml(markdown);
   const receipt=checkpoint(state,request.documentId,{source:'user',operationType:'snapshot',reason:'手动保存历史版本'});
   const draft=state.mobileDrafts?.[request.documentId];if(draft&&Number.isSafeInteger(request.draftRevision)&&draft.draftRevision<=request.draftRevision)delete state.mobileDrafts[request.documentId];
   return receipt;
  }),
  saveDraft:(key,request)=>serial(id(key),async()=>{
   const current=await load(key);if(!current.state)throw fail('笔记本不存在');document(current.state,request.documentId);text(request.markdown);
   if(!Number.isSafeInteger(request.draftRevision)||request.draftRevision<0)throw fail('草稿版本无效');
   const prior=current.state.mobileDrafts?.[request.documentId];
   if(prior&&prior.draftRevision>=request.draftRevision){if(prior.draftRevision===request.draftRevision&&prior.markdown!==request.markdown)throw fail('同版本草稿内容冲突','WORKSPACE_STATE_CONFLICT');return current;}
   if(request.baseRevision!==current.revision)throw fail('草稿基线已变化，保留当前输入','WORKSPACE_STATE_CONFLICT');
   (current.state.mobileDrafts??={})[request.documentId]={markdown:request.markdown,draftRevision:request.draftRevision,baseRevision:request.baseRevision,updatedAt:new Date().toISOString()};
   return persist(key,current);
  }),
  deleteVersion:(key,request)=>mutate(key,request,'delete-version',state=>{
   document(state,request.documentId);id(request.versionId);
   if(request.confirmed!==true)throw fail('删除历史版本需要确认','CONFIRMATION_REQUIRED');
   const versions=state.histories[request.documentId]||[],index=versions.findIndex(v=>v.id===request.versionId);
   if(index<0)throw fail('历史版本不存在','VERSION_NOT_FOUND');
   versions.splice(index,1);
  }),
  restoreVersion:(key,request)=>mutate(key,request,'restore',state=>{
   const previous=document(state,request.documentId),version=state.histories[request.documentId]?.find(v=>v.id===request.versionId);
   if(!version?.document)throw fail('历史版本不存在');assertVersion(version);
   const restored=clone(version.document);if(restored.id!==previous.id||restored.canvas)throw fail('历史版本与目标文档不匹配');
   // Match the desktop restore rule: retain current location/title, and keep
   // the displaced complete document in the restoration log.
   state.documents[request.documentId]={...restored,title:previous.title,moduleId:previous.moduleId,contentRef:previous.contentRef,sourcePath:previous.sourcePath};
   for(const field of ['coreFolderId','customFolderId','customFolderPath']){if(Object.hasOwn(previous,field))state.documents[request.documentId][field]=previous[field];else delete state.documents[request.documentId][field];}
   (state.coreRestoreLog??=[]).push({id:crypto.randomUUID(),documentId:request.documentId,versionId:request.versionId,document:clone(previous),createdAt:new Date().toISOString()});
  })
 };
}
