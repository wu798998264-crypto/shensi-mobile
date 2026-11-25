import {escapeHtml as h} from './editor.js';
const formats=[['docx','Word / WPS（.docx）'],['pdf','PDF（.pdf）'],['markdown','Markdown（.md）'],['text','纯文本（.txt）'],['screenplay','剧本格式（.docx）'],['epub','电子书 EPUB（.epub）']];
export async function chooseDocumentExport({api,modal,id,state,stateStamp,documentIds,nodeId,beforeExport,title='神思导出'}){
 const requested=[...new Set(documentIds)];
 if(nodeId!==undefined){
  const node=requested.length===1&&state.documents[requested[0]]?.canvas?.nodes?.find(n=>n.id===nodeId);
  if(!node||node.file||node.type==='file'||['image','video','audio'].includes(node.kind))throw Error('请选择文本卡片');
  title=node.name||'文本卡片';state={documents:{[requested[0]]:{title}}};
 }
 const single=requested.length===1?state.documents[requested[0]]:null;
 const ids=requested.filter(key=>state.documents[key]&&!state.documents[key].canvas&&!state.documents[key].virtual),board=!!single?.canvas;
 if(!board&&!ids.length)throw Error('没有可导出的正文；请单独导出白板 Canvas');
 const available=board?[['canvas','Canvas（含卡片与历史资源引用）']]:[...formats,...(single?[['html','HTML（保留富文本）']]:[])],skipped=board?0:requested.length-ids.length;
 const result=await modal(nodeId===undefined?'导出文档':'导出文本卡片',`<p>${h(single?.title||title)} · ${board?1:ids.length} 个文件</p>${skipped?'<p>所选范围含 '+skipped+' 个白板或非正文项，本次正文导出不包含它们；白板可单独导出 Canvas。</p>':''}<label>文件格式<select name="format" aria-label="导出格式">${available.map(([value,label])=>`<option value="${value}">${h(label)}</option>`).join('')}</select></label>${ids.length>1?'<label>导出方式<select name="mode" aria-label="导出方式"><option value="separate">分别导出（保留目录结构的 ZIP）</option><option value="complete">合并为一个文件</option></select></label>':''}<p class="muted">导出已保存正文，不修改文档或历史。PDF 为原版基础文字排版；复杂富文本可使用 HTML。</p>`);
 if(result.value!=='ok')return;
 await beforeExport?.();
 const exported=await api('/api/documents/export',{id,documentIds:board?requested:ids,...(nodeId!==undefined?{nodeId}:{}),expectedStateStamp:stateStamp,title,format:result.format,mode:result.mode||'separate',saveToFile:true},false);
 if(typeof exported.saved==='boolean')return exported;
 const bytes=Uint8Array.from(atob(exported.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:exported.mimeType})),a=document.createElement('a');a.href=url;a.download=exported.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 return exported;
}
