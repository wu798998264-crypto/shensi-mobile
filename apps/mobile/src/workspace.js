import {renderMarkdown,editorMarkdown,editRichText,bindRichText} from '../../../packages/mobile/rich-text.mjs';
import {mobileEditorTools,editorIcon} from '../../../packages/mobile/editor-icons.mjs';
import {mountServicePanels} from './service-panels.js';
import {createNativeShell} from './native-shell.js';
const element=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);return e;};
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const closeDialog=dialog=>{dialog.close();dialog.remove();};
export async function mountFoundation(root,{documents,account,nutstore,marketplace,cloud,hostLabel='ANDROID · 0.0.2 测试版'}={}){
 let notebooks=await documents.list(),notebookId=notebooks[0]?.id||'',current=notebookId?await documents.load(notebookId):null,documentId='',editing=false,pending=Promise.resolve(),failedDraft=false;
 let textarea,notice,tree,content,select,mode;let draftRevision=0,favoritesOnly=false;const expandedFolders=new Set();
 const visibleDocuments=()=>Object.values(current?.state.documents||{}).filter(d=>!d.deleted);
 const isFavorite=id=>(current?.state.coreFavorites||[]).includes('document:'+id);
 const shell=createNativeShell(root,{
  edit:()=>{},history:()=>{if(!current?.state.documents[documentId]){notice.textContent='请先打开文档';return;}if(editing){notice.textContent='请先保存当前编辑';return;}showHistory();},
  newNotebook:()=>newItem('notebook'),newDocument:()=>newItem(notebookId?'document':'notebook'),documents:visibleDocuments,
  filterFavorites:value=>{favoritesOnly=value;fillTree();},
  setDocumentFlag:(field,value)=>safe(async()=>{if(editing)throw Error('请先保存当前编辑，再修改文档状态。');if(!documentId)throw Error('请先打开文档');current=await documents.setDocumentFlag(notebookId,{documentId,field,value,expectedRevision:current.revision,operationId:uid('flag')});fillTree();renderDocument();notice.textContent='';}),
  selectDocument:id=>{if(editing){notice.textContent='请先保存当前编辑';return false;}documentId=id;renderDocument();fillTree();shell.closePanel();return true;},
  closeDocument:()=>{if(editing){notice.textContent='请先保存当前编辑';return false;}documentId='';renderDocument();return true;},
  service:name=>{const button=[...root.querySelectorAll('.service-tools button')].find(b=>b.textContent===name);if(!button)return false;button.click();return true;}
 });
 ({content,notice,tree,select,mode}=shell);const addBook=shell.addBook;
 if(account&&nutstore&&marketplace){mountServicePanels(root,{account,nutstore,marketplace,cloud,documents,currentNotebook:()=>notebookId,canTransfer:()=>!editing,refreshWorkspace:async()=>{notebooks=await documents.list();if(notebookId)current=await documents.load(notebookId);fillNotebooks();fillTree();renderDocument();}});root.querySelector('.service-tools').hidden=true;}
 const showError=error=>{notice.textContent=error.message||'操作失败，输入保留。';};
 async function safe(fn){try{await fn();return true;}catch(error){showError(error);return false;}}
 function fillNotebooks(){select.replaceChildren();if(!notebooks.length)select.append(element('option','尚无笔记本',{value:''}));for(const n of notebooks)select.append(element('option',n.title,{value:n.id}));select.append(element('option','＋ 新建笔记本',{value:'__create__'}));select.value=notebookId;}
 function fillTree(){
  tree.replaceChildren();const branch={folders:new Map(),files:[]};
  const folders=current?.state.coreFolders||[];
  function folderPath(id,seen=new Set()){if(!id||seen.has(id))return '';seen.add(id);const folder=folders.find(f=>f.id===id);if(!folder)return '';return [folderPath(folder.parentId,seen),folder.name||folder.title].filter(Boolean).join(' / ');}
  for(const doc of visibleDocuments()){
   if(favoritesOnly&&!isFavorite(doc.id))continue;
   const path=favoritesOnly?'':doc.customFolderPath||folderPath(doc.coreFolderId||doc.customFolderId);let node=branch;
   for(const name of String(path||'').split(/\s*\/\s*/).filter(Boolean)){if(!node.folders.has(name))node.folders.set(name,{folders:new Map(),files:[]});node=node.folders.get(name);}node.files.push(doc);
  }
  function renderBranch(node,parent,path='',depth=0){
   for(const [name,child]of node.folders){const key=notebookId+':'+path+'/'+name,details=element('details'),summary=element('summary');summary.innerHTML=shell.button('', 'folder',()=>{}).innerHTML;summary.append(document.createTextNode(name));summary.style.paddingLeft=(8+depth*14)+'px';details.open=expandedFolders.has(key);details.ontoggle=()=>details.open?expandedFolders.add(key):expandedFolders.delete(key);details.append(summary);renderBranch(child,details,path+'/'+name,depth+1);parent.append(details);}
   for(const d of node.files){const b=shell.row(d.title,d.canvas?'tabs':'doc',()=>safe(async()=>{if(editing)throw Error('请先切换阅读并保存当前文档。');documentId=d.id;renderDocument();fillTree();shell.closePanel();}));b.dataset.document=d.id;b.style.paddingLeft=(12+depth*14)+'px';b.classList.toggle('active',d.id===documentId);parent.append(b);}
  }
  renderBranch(branch,tree);if(favoritesOnly&&!tree.childElementCount)tree.append(element('p','当前笔记本还没有收藏文档',{class:'hint'}));
 }
 function renderDocument(){
  content.replaceChildren();const doc=current?.state.documents[documentId];shell.update({document:doc,notebook:current?.state.notebook.title,notebookId,editing,total:visibleDocuments().length,isFavorite:isFavorite(documentId)});
  if(!doc){const empty=element('section',undefined,{class:'native-empty'});empty.append(element('h1','打开一个文档'),element('p','使用下方新签页菜单，或滑动展开目录。'));const create=shell.row(notebookId?'新建文档':'新建笔记本','new',()=>newItem(notebookId?'document':'notebook'));create.dataset.action=notebookId?'document':'notebook';empty.append(create);content.append(empty);return;}
  content.append(element('h1',doc.title));
  const locked=doc.locked||doc.coreLocked||doc.readOnly;if(locked)content.append(element('span','文档已锁定',{class:'badge'}));
  const draft=current.state.mobileDrafts?.[documentId];draftRevision=draft?.draftRevision||0;
  if(editing){
   const tools=element('nav',undefined,{class:'editor-tools','aria-label':'文本编辑工具栏'});
   for(const [command,label] of mobileEditorTools){const button=element('button','',{type:'button','aria-label':label,title:label});button.innerHTML=editorIcon(command);button.onpointerdown=e=>e.preventDefault();button.onclick=()=>editRichText(textarea,command);tools.append(button);}
   content.insertBefore(tools,content.querySelector('h1'));
   textarea=element('article',undefined,{'aria-label':'文档正文',contenteditable:'true',spellcheck:'false'});textarea.innerHTML=renderMarkdown(draft?.markdown??doc.markdown);content.append(textarea);bindRichText(textarea,saveDraft);
  }
  else {const article=element('article');article.innerHTML=renderMarkdown(doc.markdown);content.append(article);if(draft&&!locked){const recover=element('button','恢复未保存草稿',{'data-action':'recover'});recover.onclick=()=>{editing=true;failedDraft=false;renderDocument();};content.append(recover);}}
  content.append(element('small',editing?'编辑模式 · 保存在本机':'阅读模式 · 保存在本机',{class:'native-document-status'}));
  mode.onclick=()=>safe(async()=>{
   if(locked)throw Error('文档已锁定，请先在文档详情中解除锁定。');
   if(!editing){editing=true;failedDraft=false;renderDocument();textarea.focus();return;}
   mode.disabled=true;await pending;
   try{if(failedDraft)throw Error('草稿保存发生冲突，输入仍在。请复制保留后重新读取，不会强制覆盖。');
    current=await documents.saveDocument(notebookId,{documentId,markdown:editorMarkdown(textarea),expectedRevision:current.revision,operationId:uid('save'),draftRevision});
    editing=false;notice.textContent='已保存，历史版本已核对。';renderDocument();
   }finally{mode.disabled=false;}
  });
 }
 function saveDraft(){
  const markdown=editorMarkdown(textarea),revision=++draftRevision,target=documentId,book=notebookId;
  pending=pending.then(async()=>{if(failedDraft)return;try{current=await documents.saveDraft(book,{documentId:target,markdown,draftRevision:revision,baseRevision:current.revision});notice.textContent='草稿已保存';}catch(error){failedDraft=true;showError(error);}});
 }
 function showHistory(){
  const dialog=element('dialog'),heading=element('h2','历史版本'),close=shell.button('关闭历史','close',()=>closeDialog(dialog),{'data-action':'close-history'});dialog.append(heading,close);
  dialog.className='native-history';dialog.append(element('p',current.state.documents[documentId].title));
  for(const version of current.state.histories[documentId]||[]){const item=element('section',undefined,{class:'version'}),preview=shell.row(new Date(version.createdAt).toLocaleString(),'history',()=>{closeDialog(dialog);showVersion(version);},'预览');preview.dataset.version=version.id;item.append(preview);dialog.append(item);}
  if(!(current.state.histories[documentId]||[]).length)dialog.append(element('p','当前文档尚无历史。进入编辑模式保存后会保留历史版本。'));
  dialog.addEventListener('close',()=>dialog.remove());root.append(dialog);dialog.showModal();
 }
 function showVersion(version){
  const dialog=element('dialog',undefined,{class:'native-history'}),article=element('article');article.innerHTML=renderMarkdown(version.document.markdown);
  dialog.append(element('h2','历史内容'),shell.button('关闭历史','close',()=>closeDialog(dialog),{'data-action':'close-history'}),article);
  const restore=element('button','恢复此版本（先保留当前版）',{'data-action':'restore-version'});restore.onclick=()=>safe(async()=>{current=await documents.restoreVersion(notebookId,{documentId,versionId:version.id,expectedRevision:current.revision,operationId:uid('restore')});closeDialog(dialog);renderDocument();notice.textContent='已恢复；恢复前全文仍保留在恢复记录中。';});
  const remove=shell.button('删除此版本','trash',()=>{const confirm=element('dialog'),cancel=element('button','取消'),accept=element('button','确认删除');confirm.append(element('h3','删除此历史版本？'),element('p','只删除此历史记录，当前正文不变。此操作不可撤销。'),cancel,accept);cancel.onclick=()=>closeDialog(confirm);accept.onclick=()=>safe(async()=>{accept.disabled=true;try{current=await documents.deleteVersion(notebookId,{documentId,versionId:version.id,confirmed:true,expectedRevision:current.revision,operationId:uid('delete-version')});closeDialog(confirm);closeDialog(dialog);showHistory();}finally{accept.disabled=false;}});confirm.addEventListener('close',()=>confirm.remove());root.append(confirm);confirm.showModal();},{class:'delete-version'});
  const actions=element('div',undefined,{class:'version-actions m8-version-actions'});actions.append(restore,remove);dialog.append(actions);dialog.addEventListener('close',()=>dialog.remove());root.append(dialog);dialog.showModal();
 }
 function newItem(kind){
  if(editing){notice.textContent='请先保存当前编辑。';return;}
  const dialog=element('dialog'),form=element('form'),input=element('input',undefined,{'aria-label':'名称',maxlength:'200',required:''}),submit=element('button','创建',{type:'submit'}),cancel=element('button','取消',{type:'button'});cancel.onclick=()=>closeDialog(dialog);form.append(element('h2',kind==='notebook'?'新建笔记本':'新建文档'),input,submit,cancel);dialog.append(form);root.append(dialog);
  form.onsubmit=event=>{event.preventDefault();safe(async()=>{submit.disabled=true;try{if(kind==='notebook'){const nextId=uid('notebook');current=await documents.createNotebook({id:nextId,title:input.value});notebookId=nextId;notebooks=await documents.list();documentId='';}else{const nextId=uid('note');current=await documents.createDocument(notebookId,{documentId:nextId,title:input.value,markdown:'',expectedRevision:current.revision,operationId:uid('create')});documentId=nextId;}closeDialog(dialog);fillNotebooks();fillTree();renderDocument();}finally{submit.disabled=false;}});};
  dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();input.focus();
 }
 addBook.onclick=()=>newItem('notebook');select.onchange=()=>safe(async()=>{if(editing){select.value=notebookId;notice.textContent='请先保存当前编辑。';return;}if(select.value==='__create__'){select.value=notebookId;newItem('notebook');return;}notebookId=select.value;current=await documents.load(notebookId);documentId=visibleDocuments()[0]?.id||'';fillTree();renderDocument();});
 documentId=visibleDocuments()[0]?.id||'';fillNotebooks();fillTree();renderDocument();
 return {flush:()=>pending};
}
