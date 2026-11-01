import {assertVersion} from './history.mjs';
import {validateMediaReceipt,desktopMediaPath} from '../../mobile/media-contract.mjs';

export const CLOUD_NOTEBOOK_LIMIT=8*1024*1024;
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hasMedia=doc=>doc?.canvas||doc?.coreMediaArtifacts?.length||/<(?:img|audio|video|source|iframe|object)\b|data-attachment-path\s*=/i.test(String(doc?.html||'')+String(doc?.coreRichText?.html||''))||/!\[\[|!\[[^\]]*\]\(|\]\((?:\.\/)?(?:attachments|assets|\.shensi)\//i.test(String(doc?.markdown||''));
// v2 preserves complete canvas/history bytes; it never rewrites an historical
// attachment reference. Only immutable localMedia receipts are portable yet.
export function notebookMedia(state){
 const media=new Map();
 const inspect=doc=>{
  if(!doc||hasMedia({...doc,canvas:undefined}))throw Error('文档含未接通的附件引用，不能只同步索引');
  if(!doc.canvas)return;
  if(Object.keys(doc.canvas).some(key=>!['nodes','edges','viewport','settings','assets'].includes(key))||doc.canvas.assets?.length)throw Error('白板包含未映射的历史素材或引用，不能只同步当前卡片');
  if(!Array.isArray(doc.canvas.nodes)||!Array.isArray(doc.canvas.edges))throw Error('白板结构不完整');
  const ids=new Set();for(const node of doc.canvas.nodes){
   if(!record(node)||!validId(node.id)||ids.has(node.id)||!['text','group','file'].includes(node.type))throw Error('此白板含尚未接通的卡片类型，原卡片保留');ids.add(node.id);
   if(Object.keys(node).some(key=>!['id','type','kind','name','text','label','color','x','y','width','height','localMedia','mimeType','size','file'].includes(key)))throw Error('白板包含尚未映射的卡片字段，未遗漏引用或改写原数据');
   if(node.file&&(!node.localMedia||node.file!==desktopMediaPath(node.localMedia))||node.url||node.assetPath||node.contentRef||node.references?.length||node.assets?.length)throw Error('白板含未接通的素材路径，不能遗漏原文件');
   if(node.type==='file'){const receipt=validateMediaReceipt(node.localMedia),previous=media.get(receipt.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(receipt))throw Error('同一附件身份指向不同内容，未修改历史');media.set(receipt.id,receipt);}
   else if(node.localMedia)throw Error('白板附件归属无效');
  }
  for(const edge of doc.canvas.edges)if(!record(edge)||!ids.has(edge.fromNode)||!ids.has(edge.toNode))throw Error('白板连线引用不完整');
 };
 if(state.workspaceAssets?.length)throw Error('笔记本包含未接通的工作区附件');
 for(const doc of Object.values(state.documents||{}))inspect(doc);
 for(const versions of Object.values(state.histories||{}))for(const version of versions){assertVersion(version);inspect(version.document);}
 for(const item of state.coreRestoreLog||[])inspect(item.document);
 return [...media.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function validateCloudNotebook(value){
 const withMedia=value?.format==='shensi-notebook-snapshot-v2';
 if(!withMedia&&value?.format!=='shensi-notebook-snapshot-v1'||!record(value.state)||value.state.schemaVersion!==1||!validId(value.state.notebook?.id)||typeof value.state.notebook.title!=='string'||!value.state.notebook.title.trim()||value.state.notebook.title.length>200)throw Error('不是兼容的神思笔记本快照');
 const state=value.state;if(!record(state.documents)||!record(state.histories))throw Error('笔记本结构不完整');
 for(const [id,doc]of Object.entries(state.documents)){
  if(!validId(id)||!record(doc)||doc.id!==undefined&&doc.id!==id||typeof doc.title!=='string'||doc.title.length>200||typeof doc.markdown!=='string'||doc.markdown.length>2000000||doc.canvas&&!withMedia)throw Error('此快照入口只恢复普通文档；白板附件同步未完成前不会强制转换');
  if(!withMedia&&hasMedia(doc))throw Error('此笔记本含附件；附件协议接通前不会上传缺少文件的快照');
 }
 if(state.workspaceAssets?.length)throw Error('此笔记本含附件，不能只同步索引');
 for(const [id,versions]of Object.entries(state.histories)){if(!validId(id)||!Array.isArray(versions))throw Error('历史版本结构无效');for(const version of versions){if(!version?.document||version.document.id!==undefined&&version.document.id!==id||version.scopeId&&version.scopeId!==id)throw Error('历史文档身份无效');assertVersion(version);if(!withMedia&&hasMedia(version.document))throw Error('历史版本含附件；不会生成缺少原文件的快照');}}
 if(state.coreRestoreLog!==undefined&&!Array.isArray(state.coreRestoreLog))throw Error('恢复记录结构无效');
 for(const item of state.coreRestoreLog||[])if(!withMedia&&hasMedia(item.document))throw Error('恢复记录含附件，不能只同步索引');
 if(withMedia&&JSON.stringify(notebookMedia(state))!==JSON.stringify(value.media))throw Error('白板媒体清单不完整或与历史引用不符');
 const folders=state.coreFolders||[];if(!Array.isArray(folders))throw Error('目录结构无效');const byId=new Map();
 for(const f of folders){if(!validId(f?.id)||byId.has(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>120||/[\\/\x00-\x1f]/.test(f.name)||['.','..'].includes(f.name)||f.parentId&&!validId(f.parentId))throw Error('目录名称或身份无效');byId.set(f.id,f);}
 for(const f of folders){const seen=new Set([f.id]);let parent=f.parentId;while(parent){if(seen.has(parent)||!byId.has(parent))throw Error('目录引用循环或缺失');seen.add(parent);parent=byId.get(parent).parentId;}}
 if(state.mobileDrafts!==undefined&&!record(state.mobileDrafts))throw Error('草稿结构无效');
 for(const [id,draft]of Object.entries(state.mobileDrafts||{}))if(!validId(id)||typeof draft?.markdown!=='string'||draft.markdown.length>2000000)throw Error('草稿内容无效');
 if(new TextEncoder().encode(JSON.stringify(value)).length>CLOUD_NOTEBOOK_LIMIT)throw Error('当前快照上限为8MiB，未删减历史');
 return state;
}

// Public notebook content only. Never transfer desktop settings, credentials,
// execution records or absolute paths by spreading a whole workspace object.
export function portableNotebookState(id,state,{allowMedia=false}={}){
 if(state.workspaceAssets?.length)throw Error('此笔记本含附件，附件协议接通前不能只同步索引');
 const documents={};
 for(const [key,value]of Object.entries(state.documents||{})){
  const doc=structuredClone(value);for(const k of ['sourcePath','contentRef','savedAt','coreRichText','customFolderId','customFolderPath'])delete doc[k];documents[key]=doc;
 }
 const portable={schemaVersion:1,notebook:{id,title:state.projectName||state.notebook?.title||'我的笔记'},documents,histories:structuredClone(state.histories||{}),coreFolders:structuredClone(state.coreFolders||[]),coreFavorites:structuredClone(state.coreFavorites||[]),coreRestoreLog:structuredClone(state.coreRestoreLog||[]),mobileDrafts:structuredClone(state.mobileDrafts||{}),coreHistoryDeleted:structuredClone(state.coreHistoryDeleted||[])};
 validateCloudNotebook({format:allowMedia?'shensi-notebook-snapshot-v2':'shensi-notebook-snapshot-v1',state:portable,...allowMedia?{media:notebookMedia(portable)}:{}});return portable;
}
export function portableNotebookSnapshot(id,state,{allowMedia=false}={}){
 const withMedia=allowMedia&&[...Object.values(state.documents||{}),...Object.values(state.histories||{}).flat().map(v=>v.document),...(state.coreRestoreLog||[]).map(v=>v.document)].some(hasMedia);
 const portable=portableNotebookState(id,state,{allowMedia:withMedia});
 return {format:withMedia?'shensi-notebook-snapshot-v2':'shensi-notebook-snapshot-v1',state:portable,...withMedia?{media:notebookMedia(portable)}:{}};
}
