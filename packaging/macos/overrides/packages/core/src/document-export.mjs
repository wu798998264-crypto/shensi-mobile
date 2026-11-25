import {buildDocumentExportManifest} from '../legacy/document-export-contract.js';
import {createManuscriptExport} from '../legacy/server/document-export.mjs';
import {sanitizeDocumentHtml} from '../legacy/document-sanitize.js';

// Export saved snapshots only; never accept substituted document bodies from the renderer.
export async function exportDocuments(service,{id,documentIds,nodeId,expectedStateStamp,format,mode='separate',title='神思导出'}={}){
 if(!Array.isArray(documentIds)||!documentIds.length||documentIds.length>5000||documentIds.some(v=>typeof v!=='string'))throw Error('请选择 1–5000 个文档');
 if(!['separate','complete'].includes(mode))throw Error('导出模式无效');
 let {state,stateStamp}=await service.load(id);
 if(!expectedStateStamp||expectedStateStamp!==stateStamp)throw Object.assign(Error('文档已更新，请重新打开导出选项'),{code:'WORKSPACE_STATE_CONFLICT'});
 const ids=[...new Set(documentIds)];
 if(ids.some(key=>!Object.hasOwn(state.documents,key)||state.documents[key].virtual))throw Error('导出文档已删除或不可用');
 if(nodeId!==undefined){
  if(typeof nodeId!=='string'||!nodeId||ids.length!==1)throw Error('请选择一个文本卡片');
  const node=state.documents[ids[0]].canvas?.nodes?.find(n=>n.id===nodeId);
  if(!node||node.file||node.type==='file'||['image','video','audio'].includes(node.kind))throw Error('文本卡片已删除或已变为媒体卡片');
  // A temporary export view only: keep the saved whiteboard and its history intact.
  title=String(node.name||'文本卡片');state={documents:{[ids[0]]:{title,markdown:String(node.text||'')}}};
 }
 const one=ids.length===1?state.documents[ids[0]]:null,filename=String(one?.title||title||'神思导出').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,100);
 if(format==='canvas'||format==='html'){
  if(!one||format==='canvas'&&!one.canvas||format==='html'&&one.canvas)throw Error('此格式仅支持单个对应类型的文件');
  const text=format==='canvas'?JSON.stringify(one.canvas,null,2):'<!doctype html><meta charset="utf-8">'+sanitizeDocumentHtml(one.html||service.markdown(one.markdown||''));
  return {base64:Buffer.from(text).toString('base64'),fileName:filename+'.'+format,mimeType:format==='canvas'?'application/json':'text/html;charset=utf-8',documentCount:1,fileCount:1};
 }
 const folders=new Map((state.coreFolders||[]).map(f=>[f.id,f]));
 const pathForDocument=(key,doc)=>{const parts=[doc.title||key],seen=new Set();let folder=folders.get(doc.coreFolderId);while(folder&&!seen.has(folder.id)){seen.add(folder.id);parts.unshift(folder.name);folder=folders.get(folder.parentId);}return parts.join('/');};
 const manifest=buildDocumentExportManifest({state,documentIds:ids,pathForDocument});
 if(manifest.documentCount!==ids.length)throw Error('白板不能作为正文导出，请单独使用 Canvas 格式');
 if(format==='pdf'&&[title,...manifest.documents.map(d=>d.title+'\n'+(d.text||d.markdown))].some(text=>/[\u{10000}-\u{10FFFF}]/u.test(text)))throw Error('基础 PDF 字体不支持部分扩展字符或表情。为避免丢字，请选择 Word、EPUB 或 HTML 导出');
 const {bytes,...result}=createManuscriptExport({...manifest,mode,format,title});
 return {...result,base64:bytes.toString('base64')};
}
