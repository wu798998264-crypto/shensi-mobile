import {assertVersion} from '../core/src/history.mjs';
const max=8*1024*1024,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
export function validateCloudNotebook(value){
 if(value?.format!=='shensi-notebook-snapshot-v1'||!value.state||value.state.schemaVersion!==1||!validId(value.state.notebook?.id)||typeof value.state.notebook.title!=='string'||!value.state.notebook.title.trim()||value.state.notebook.title.length>200)throw Error('不是兼容的神思笔记本快照');
 const state=value.state;if(!state.documents||Array.isArray(state.documents)||!state.histories||Array.isArray(state.histories))throw Error('笔记本结构不完整');
 for(const [id,doc]of Object.entries(state.documents)){if(!validId(id)||doc?.id!==id||typeof doc.title!=='string'||doc.title.length>200||typeof doc.markdown!=='string'||doc.markdown.length>2000000||doc.canvas)throw Error('此测试包只恢复普通文档笔记本；白板保持原文件，不强制转换');}
 for(const [id,versions]of Object.entries(state.histories)){if(!validId(id)||!Array.isArray(versions))throw Error('历史版本结构无效');for(const version of versions){if(version?.document?.id!==id)throw Error('历史文档身份无效');assertVersion(version);}}
 return state;
}
export function createCloudNotebookSync({documents,storage,metadata,account}){
 const files=account.cloudFiles({journal:metadata});
 return {status:()=>files.status(),allocate:()=>files.allocate(),list:()=>files.list(),
  async upload(notebookId,onProgress){
   const row=await documents.load(notebookId);if(!row.state)throw Error('笔记本不存在');
   const snapshot={format:'shensi-notebook-snapshot-v1',state:row.state};validateCloudNotebook(snapshot);
   const bytes=encoder.encode(JSON.stringify(snapshot));if(bytes.length>max)throw Error('当前测试包快照上限为8MiB，未删减历史');
   const who=await account.status();if(!who.user?.id)throw Error('请先登录');
   const mark='cloud-notebook-base:'+who.user.id+':'+notebookId,base=await metadata.get(mark),sha256=await sha(bytes);
   if(base?.sha256===sha256){const current=(await files.list()).items.find(f=>f.id===base.fileId);if(current?.sha256===sha256)return {fileId:current.id,resumed:true,unchanged:true,conflict:false};throw Error('本机内容未变，但云端版本已变化或不在当前页；请先下载核对，不重复上传');}
   const result=await files.upload({key:notebookId,name:row.state.notebook.title+'.shensi.json',kind:'index',baseRevision:base?.revision??null,source:{bytes:bytes.length,sha256,read:async(a,b)=>bytes.slice(a,b)},onProgress});
   if(!result.conflict){const listed=await files.list();const file=listed.items.find(f=>f.id===result.fileId);if(file)await metadata.set(mark,{revision:file.revision,fileId:file.id,sha256});}
   return result;
  },
  async download(file,onProgress){
   if(file.kind!=='index'||file.bytes>max)throw Error('此入口仅恢复8MiB以内的笔记本快照');
   let parts=[],snapshot;await files.download({fileId:file.id,onProgress,sink:{
    begin:async manifest=>{if(manifest.file.bytes>max)throw Error('快照超过移动端安全上限');parts=[];},
    write:async(_,bytes)=>parts.push(bytes),abort:async()=>{parts=[];snapshot=null;},
    finish:async expected=>{const length=parts.reduce((n,b)=>n+b.length,0),bytes=new Uint8Array(length);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}if(length!==expected.bytes||await sha(bytes)!==expected.sha256)throw Error('完整快照校验失败');snapshot=JSON.parse(decoder.decode(bytes));validateCloudNotebook(snapshot);return {verified:true};}
   }});
   const state=structuredClone(snapshot.state),original=state.notebook.id,old=await storage.read(original);
   if(old.value!==null){state.notebook.id='notebook-'+crypto.randomUUID();state.notebook.title=state.notebook.title.slice(0,180)+'（云端副本）';}
   // No existing notebook is overwritten. Histories/drafts/receipts remain whole.
   const value=JSON.stringify(state);if(encoder.encode(value).length>max)throw Error('快照超过原生存储上限');
   const saved=await storage.compareAndSwap(state.notebook.id,0,value);if(saved.value!==value||saved.revision!==1)throw Error('恢复保存回执无效');
   const read=await documents.load(state.notebook.id);if(JSON.stringify(read.state)!==value)throw Error('恢复回读不一致');
   return {notebookId:state.notebook.id,copy:state.notebook.id!==original};
  }
 };
}
