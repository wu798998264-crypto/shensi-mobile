import {assertVersion} from './history.mjs';

export const CLOUD_NOTEBOOK_LIMIT=8*1024*1024;
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hasMedia=doc=>doc?.canvas||/<(?:img|audio|video|source|iframe|object)\b/i.test(String(doc?.html||'')+String(doc?.coreRichText?.html||''))||/!\[[^\]]*\]\(|\]\((?:\.\/)?(?:attachments|assets|\.shensi)\//i.test(String(doc?.markdown||''));
export function validateCloudNotebook(value){
 if(value?.format!=='shensi-notebook-snapshot-v1'||!record(value.state)||value.state.schemaVersion!==1||!validId(value.state.notebook?.id)||typeof value.state.notebook.title!=='string'||!value.state.notebook.title.trim()||value.state.notebook.title.length>200)throw Error('不是兼容的神思笔记本快照');
 const state=value.state;if(!record(state.documents)||!record(state.histories))throw Error('笔记本结构不完整');
 for(const [id,doc]of Object.entries(state.documents)){
  if(!validId(id)||!record(doc)||doc.id!==undefined&&doc.id!==id||typeof doc.title!=='string'||doc.title.length>200||typeof doc.markdown!=='string'||doc.markdown.length>2000000||doc.canvas)throw Error('此快照入口只恢复普通文档；白板附件同步未完成前不会强制转换');
  if(hasMedia(doc))throw Error('此笔记本含附件；附件协议接通前不会上传缺少文件的快照');
 }
 if(state.workspaceAssets?.length)throw Error('此笔记本含附件，不能只同步索引');
 for(const [id,versions]of Object.entries(state.histories)){if(!validId(id)||!Array.isArray(versions))throw Error('历史版本结构无效');for(const version of versions){if(!version?.document||version.document.id!==undefined&&version.document.id!==id||version.scopeId&&version.scopeId!==id)throw Error('历史文档身份无效');assertVersion(version);if(hasMedia(version.document))throw Error('历史版本含附件；不会生成缺少原文件的快照');}}
 if(state.coreRestoreLog!==undefined&&!Array.isArray(state.coreRestoreLog))throw Error('恢复记录结构无效');
 for(const item of state.coreRestoreLog||[])if(hasMedia(item.document))throw Error('恢复记录含附件，不能只同步索引');
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
export function portableNotebookState(id,state){
 if(state.workspaceAssets?.length)throw Error('此笔记本含附件，附件协议接通前不能只同步索引');
 const documents={};
 for(const [key,value]of Object.entries(state.documents||{})){
  const doc=structuredClone(value);for(const k of ['sourcePath','contentRef','savedAt','coreRichText','customFolderId','customFolderPath'])delete doc[k];documents[key]=doc;
 }
 const portable={schemaVersion:1,notebook:{id,title:state.projectName||state.notebook?.title||'我的笔记'},documents,histories:structuredClone(state.histories||{}),coreFolders:structuredClone(state.coreFolders||[]),coreFavorites:structuredClone(state.coreFavorites||[]),coreRestoreLog:structuredClone(state.coreRestoreLog||[]),mobileDrafts:structuredClone(state.mobileDrafts||{}),coreHistoryDeleted:structuredClone(state.coreHistoryDeleted||[])};
 validateCloudNotebook({format:'shensi-notebook-snapshot-v1',state:portable});return portable;
}
