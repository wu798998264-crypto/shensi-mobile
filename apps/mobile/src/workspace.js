import {renderMarkdown,editorMarkdown,editRichText,bindRichText} from '../../../packages/mobile/rich-text.mjs';
import {mobileEditorTools,editorIcon} from '../../../packages/mobile/editor-icons.mjs';
import {mountServicePanels} from './service-panels.js';
const element=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);return e;};
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const closeDialog=dialog=>{dialog.close();dialog.remove();};
export async function mountFoundation(root,{documents,account,nutstore,marketplace,cloud,hostLabel='ANDROID · 0.0.2 测试版'}={}){
 let notebooks=await documents.list(),notebookId=notebooks[0]?.id||'',current=notebookId?await documents.load(notebookId):null,documentId='',editing=false,pending=Promise.resolve(),failedDraft=false;
 let textarea,notice,tree,content,select,mode;let draftRevision=0;
 root.replaceChildren();root.className='native-workspace';
 const brand=element('header',undefined,{class:'brand'});brand.append(element('span','神思笔记'),element('small',hostLabel));
 const status=element('p','联网测试版：本机文档与历史、账号登录、官方云笔记本快照、手机模板插件。完整预览布局、白板媒体及自动双向同步尚未完成。',{class:'status'});
 const toolbar=element('nav',undefined,{class:'notebooks','aria-label':'笔记本'});select=element('select',undefined,{'aria-label':'当前笔记本'});
 const addBook=element('button','＋ 笔记本',{'data-action':'notebook'});toolbar.append(select,addBook);
 const body=element('div',undefined,{class:'workspace-body'});tree=element('aside',undefined,{class:'document-tree','aria-label':'文档目录'});content=element('section',undefined,{class:'document-content'});body.append(tree,content);
 notice=element('p','',{role:'status','aria-live':'polite',class:'notice'});root.append(brand,status,toolbar,body,notice);
 if(account&&nutstore&&marketplace)mountServicePanels(root,{account,nutstore,marketplace,cloud,documents,currentNotebook:()=>notebookId,canTransfer:()=>!editing,refreshWorkspace:async()=>{notebooks=await documents.list();if(notebookId)current=await documents.load(notebookId);fillNotebooks();fillTree();renderDocument();}});
 const showError=error=>{notice.textContent=error.message||'操作失败，输入保留。';};
 async function safe(fn){try{await fn();}catch(error){showError(error);}}
 function fillNotebooks(){select.replaceChildren();if(!notebooks.length)select.append(element('option','尚无笔记本'));for(const n of notebooks)select.append(element('option',n.title,{value:n.id}));select.value=notebookId;}
 function fillTree(){tree.replaceChildren();for(const d of Object.values(current?.state.documents||{})){const b=element('button',d.title,{'data-document':d.id,class:d.id===documentId?'selected':''});b.onclick=()=>safe(async()=>{if(editing){notice.textContent='请先切换阅读并保存当前文档。';return;}documentId=d.id;renderDocument();fillTree();});tree.append(b);}if(current){const add=element('button','＋ 新建文档',{'data-action':'document'});add.onclick=()=>newItem('document');tree.append(add);}}
 function renderDocument(){
  content.replaceChildren();const doc=current?.state.documents[documentId];if(!doc){content.append(element('h1','写下新的篇章'),element('p','新建一个笔记本，再开始写作。正文、草稿和历史将保存在本机。'));return;}
  const bar=element('div',undefined,{class:'document-actions'});mode=element('button',editing?'保存并阅读':'编辑',{'data-action':'mode'});const history=element('button','历史版本',{'data-action':'history'});bar.append(mode,history);content.append(bar,element('h1',doc.title));
  const draft=current.state.mobileDrafts?.[documentId];draftRevision=draft?.draftRevision||0;
  if(editing){
   const tools=element('nav',undefined,{class:'editor-tools','aria-label':'文本编辑工具栏'});
   for(const [command,label] of mobileEditorTools){const button=element('button','',{type:'button','aria-label':label,title:label});button.innerHTML=editorIcon(command);button.onpointerdown=e=>e.preventDefault();button.onclick=()=>editRichText(textarea,command);tools.append(button);}
   content.insertBefore(tools,content.querySelector('h1'));
   textarea=element('article',undefined,{'aria-label':'文档正文',contenteditable:'true',spellcheck:'false'});textarea.innerHTML=renderMarkdown(draft?.markdown??doc.markdown);content.append(textarea);bindRichText(textarea,saveDraft);
  }
  else {const article=element('article');article.innerHTML=renderMarkdown(doc.markdown);content.append(article);if(draft){const recover=element('button','恢复未保存草稿',{'data-action':'recover'});recover.onclick=()=>{editing=true;failedDraft=false;renderDocument();};content.append(recover);}}
  mode.onclick=()=>safe(async()=>{
   if(!editing){editing=true;failedDraft=false;renderDocument();textarea.focus();return;}
   mode.disabled=true;await pending;
   try{if(failedDraft)throw Error('草稿保存发生冲突，输入仍在。请复制保留后重新读取，不会强制覆盖。');
    current=await documents.saveDocument(notebookId,{documentId,markdown:editorMarkdown(textarea),expectedRevision:current.revision,operationId:uid('save'),draftRevision});
    editing=false;notice.textContent='已保存，历史版本已核对。';renderDocument();
   }finally{mode.disabled=false;}
  });
  history.onclick=()=>{if(editing){notice.textContent='请先保存当前编辑。';return;}showHistory();};
 }
 function saveDraft(){
  const markdown=editorMarkdown(textarea),revision=++draftRevision,target=documentId,book=notebookId;
  pending=pending.then(async()=>{if(failedDraft)return;try{current=await documents.saveDraft(book,{documentId:target,markdown,draftRevision:revision,baseRevision:current.revision});notice.textContent='草稿已保存';}catch(error){failedDraft=true;showError(error);}});
 }
 function showHistory(){
  const dialog=element('dialog'),heading=element('h2','历史版本'),close=element('button','关闭',{'data-action':'close-history'});close.onclick=()=>closeDialog(dialog);dialog.append(heading,close);
  for(const version of current.state.histories[documentId]||[]){const item=element('section',undefined,{class:'version'});item.append(element('time',version.createdAt),element('pre',version.document.markdown));const restore=element('button','恢复此版本',{'data-version':version.id});restore.onclick=()=>safe(async()=>{current=await documents.restoreVersion(notebookId,{documentId,versionId:version.id,expectedRevision:current.revision,operationId:uid('restore')});closeDialog(dialog);renderDocument();notice.textContent='已恢复；恢复前全文仍保留在恢复记录中。';});const remove=element('button','删除',{'aria-label':'删除此版本',class:'delete-version'});remove.onclick=()=>{const confirm=element('dialog'),cancel=element('button','取消'),accept=element('button','确认删除');confirm.append(element('h3','删除此历史版本？'),element('p','只删除此历史记录，当前正文不变。此操作不可撤销。'),cancel,accept);cancel.onclick=()=>closeDialog(confirm);accept.onclick=()=>safe(async()=>{accept.disabled=true;try{current=await documents.deleteVersion(notebookId,{documentId,versionId:version.id,confirmed:true,expectedRevision:current.revision,operationId:uid('delete-version')});closeDialog(confirm);closeDialog(dialog);showHistory();}finally{accept.disabled=false;}});confirm.addEventListener('close',()=>confirm.remove());root.append(confirm);confirm.showModal();};const actions=element('div',undefined,{class:'version-actions'});actions.append(restore,remove);item.append(actions);dialog.append(item);}
  dialog.addEventListener('close',()=>dialog.remove());root.append(dialog);dialog.showModal();
 }
 function newItem(kind){
  if(editing){notice.textContent='请先保存当前编辑。';return;}
  const dialog=element('dialog'),form=element('form'),input=element('input',undefined,{'aria-label':'名称',maxlength:'200',required:''}),submit=element('button','创建',{type:'submit'}),cancel=element('button','取消',{type:'button'});cancel.onclick=()=>closeDialog(dialog);form.append(element('h2',kind==='notebook'?'新建笔记本':'新建文档'),input,submit,cancel);dialog.append(form);root.append(dialog);
  form.onsubmit=event=>{event.preventDefault();safe(async()=>{submit.disabled=true;try{if(kind==='notebook'){const nextId=uid('notebook');current=await documents.createNotebook({id:nextId,title:input.value});notebookId=nextId;notebooks=await documents.list();documentId='';}else{const nextId=uid('note');current=await documents.createDocument(notebookId,{documentId:nextId,title:input.value,markdown:'',expectedRevision:current.revision,operationId:uid('create')});documentId=nextId;}closeDialog(dialog);fillNotebooks();fillTree();renderDocument();}finally{submit.disabled=false;}});};
  dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();input.focus();
 }
 addBook.onclick=()=>newItem('notebook');select.onchange=()=>safe(async()=>{if(editing){select.value=notebookId;notice.textContent='请先保存当前编辑。';return;}notebookId=select.value;current=await documents.load(notebookId);documentId=Object.keys(current.state.documents)[0]||'';fillTree();renderDocument();});
 documentId=Object.keys(current?.state.documents||{})[0]||'';fillNotebooks();fillTree();renderDocument();
 return {flush:()=>pending};
}
