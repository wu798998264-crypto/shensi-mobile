import {renderMarkdown,editorMarkdown,editRichText,bindRichText} from '../../../packages/mobile/rich-text.mjs';
import {mobileEditorTools,editorIcon} from '../../../packages/mobile/editor-icons.mjs';
import {mountServicePanels} from './service-panels.js';
import {createNativeShell} from './native-shell.js';
import {mountWhiteboardAlbum} from './whiteboard-album.js';
import {mountInterfaceLanguage} from './interface-language.js';
import {createCustomApiPanels} from './custom-api-panel.js';
import {hydrateDocumentMedia} from './document-media.js';
const element=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);return e;};
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const closeDialog=dialog=>{dialog.close();dialog.remove();};
export async function mountFoundation(root,{documents,account,nutstore,marketplace,cloud,media,metadata,customApi,systemAppearance}={}){
 root.stopAutoSync?.();root.interfaceLanguage?.destroy();const language=await mountInterfaceLanguage(root,metadata);root.interfaceLanguage=language;let appearance=await metadata?.get('mobile-appearance')||'跟随系统';
 let notebooks=await documents.list(),notebookId=notebooks[0]?.id||'',current=notebookId?await documents.load(notebookId):null,documentId='',editing=false,pending=Promise.resolve(),failedDraft=false;
 let textarea,notice,tree,content,select,mode,noticeTimer,uploading=false;let draftRevision=0,favoritesOnly=false;const expandedFolders=new Set();
 const visibleDocuments=()=>Object.entries(current?.state.documents||{}).map(([id,doc])=>({...doc,id})).filter(d=>!d.deleted);
 const notify=text=>{clearTimeout(noticeTimer);notice.hidePopover?.();notice.textContent=text;if(!text)return;notice.showPopover?.();noticeTimer=setTimeout(()=>{notice.textContent='';if(notice.isConnected)notice.hidePopover?.();},2000);};
 const isFavorite=id=>(current?.state.coreFavorites||[]).includes('document:'+id);
 const apiPanels=customApi?createCustomApiPanels({root,client:customApi,metadata,notify}):null;
 const shell=createNativeShell(root,{
  language,appearance:()=>appearance,setAppearance:async value=>{await metadata?.set('mobile-appearance',value);appearance=value;await systemAppearance?.(value);},
  notebooks:()=>notebooks,renameNotebook:id=>manageNotebook(id,'rename'),deleteNotebook:id=>manageNotebook(id,'delete'),recycleNotebooks,
  customApiSettings:()=>apiPanels?.settings(),...(apiPanels?{mountChat:(body,context)=>apiPanels.mountChat(body,context).catch(showError)}:{}),
  edit:()=>{},notify,history:()=>{if(!current?.state.documents[documentId]){notify('请先打开文档');return;}if(editing){notify('请先保存当前编辑');return;}showHistory();},
  newNotebook:()=>newItem('notebook'),newDocument:()=>newItem(notebookId?'document':'notebook'),documents:visibleDocuments,
  newWhiteboard:()=>newItem(notebookId?'whiteboard':'notebook'),trashDocument:onDone=>trashDocument(onDone),
  filterFavorites:value=>{favoritesOnly=value;fillTree();},
  setDocumentFlag:(field,value)=>safe(async()=>{
   if(!documentId)throw Error('请先打开文档');
   const saveBeforeLock=field==='locked'&&value&&editing,editor=textarea,wasEditable=editor?.contentEditable;
   if(editing)editor.contentEditable='false';
   try{
    await pending;if(failedDraft)throw Error('草稿保存发生冲突，输入仍在；请先保留并核对当前编辑。');
    if(saveBeforeLock){current=await documents.saveDocument(notebookId,{documentId,markdown:editorMarkdown(editor),expectedRevision:current.revision,operationId:uid('save'),draftRevision});editing=false;renderDocument();}
    current=await documents.setDocumentFlag(notebookId,{documentId,field,value,expectedRevision:current.revision,operationId:uid('flag')});fillTree();
    if(editing)updateShell();else renderDocument();
    notify(field==='favorite'?(value?'已收藏':'已取消收藏'):(value?(saveBeforeLock?'已保存并锁定文档':'已锁定文档'):'已解除锁定'));
   }finally{if(editor?.isConnected&&wasEditable!==undefined)editor.contentEditable=wasEditable;}
  }),
  selectDocument:id=>{if(editing){notify('请先保存当前编辑');return false;}documentId=id;renderDocument();fillTree();shell.closePanel();return true;},
  closeDocument:(id=documentId)=>{const doc=current?.state.documents[id];if(doc?.locked||doc?.coreLocked||doc?.readOnly){notify('文档已锁定，请先解除锁定后再关闭。');return false;}if(id===documentId){if(editing){notify('请先保存当前编辑');return false;}documentId='';renderDocument();}return true;},
  accountStatus:()=>account?.status(),
  service:name=>{const button=[...root.querySelectorAll('.service-tools button')].find(b=>b.dataset.service===name);if(!button)return false;button.click();return true;}
 });
 ({content,notice,tree,select,mode}=shell);const addBook=shell.addBook;
 const canTransfer=()=>!editing&&!uploading&&!failedDraft&&!root.querySelector('.mobile-album-fullscreen[open]');
 if(account&&nutstore&&marketplace){mountServicePanels(root,{account,nutstore,marketplace,cloud,documents,currentNotebook:()=>notebookId,canTransfer,refreshWorkspace:async()=>{if(!canTransfer())return;const book=notebookId,revision=current?.revision,nextBooks=await documents.list(),next=book?await documents.load(book):null;if(!canTransfer()||book!==notebookId||revision!==current?.revision)return;notebooks=nextBooks;current=next;fillNotebooks();fillTree();renderDocument();}});root.querySelector('.service-tools').hidden=true;}
 const showError=error=>notify(error.message||'操作失败，输入保留。');
 async function safe(fn){try{await fn();return true;}catch(error){showError(error);return false;}}
 function fillNotebooks(){select.replaceChildren();if(!notebooks.length)select.append(element('option','尚无笔记本',{value:''}));for(const n of notebooks)select.append(element('option',n.title,{value:n.id}));select.value=notebookId;shell.renderBooks();}
 async function refreshBooks(){notebooks=await documents.list();if(!notebooks.some(n=>n.id===notebookId)){notebookId=notebooks[0]?.id||'';documentId='';}current=notebookId?await documents.load(notebookId):null;fillNotebooks();fillTree();renderDocument();}
 async function manageNotebook(id,kind){if(editing||uploading){notify('请先保存当前编辑');return;}await safe(async()=>{const snapshot=await documents.load(id),d=element('dialog'),form=element('form'),input=element('input',undefined,{'aria-label':'笔记本名称',required:'',maxlength:'200'}),accept=element('button',kind==='rename'?'保存':'确认删除',{type:'submit'}),error=element('p','',{role:'status'});input.value=snapshot.state.notebook.title;form.append(element('h2',kind==='rename'?'重命名笔记本':'删除笔记本'));if(kind==='rename')form.append(input);else form.append(element('p',snapshot.state.notebook.title,{'data-user-content':''}),element('p','删除后保留完整正文、附件和历史，可在回收站恢复。此操作仅影响本机，不会静默删除云端。'));const cancel=element('button','取消',{type:'button'});cancel.onclick=()=>closeDialog(d);form.append(error,accept,cancel);form.onsubmit=async event=>{event.preventDefault();accept.disabled=true;try{await documents[kind==='rename'?'renameNotebook':'trashNotebook'](id,{title:input.value,confirmed:true,expectedRevision:snapshot.revision,operationId:uid(kind)});closeDialog(d);await refreshBooks();notify(kind==='rename'?'已重命名笔记本':'已移入回收站，资料与历史保留。');}catch(e){error.textContent=e.message;}finally{accept.disabled=false;}};d.onclose=()=>d.remove();d.append(form);root.append(d);d.showModal();});}
 async function recycleNotebooks(){await safe(async()=>{const d=element('dialog'),close=element('button','关闭'),list=element('section');close.onclick=()=>closeDialog(d);d.append(element('h2','已删除笔记本'),close,list);d.onclose=()=>d.remove();root.append(d);d.showModal();const rows=(await documents.list({includeDeleted:true})).filter(n=>n.deleted);if(!rows.length)list.append(element('p','暂无'));for(const n of rows){const row=element('section',undefined,{class:'service-row'}),restore=element('button','恢复笔记本');row.append(element('strong',n.title,{'data-user-content':''}),restore);restore.onclick=()=>safe(async()=>{await documents.restoreNotebook(n.id,{expectedRevision:n.revision,operationId:uid('restore-book')});row.remove();await refreshBooks();notify('已恢复笔记本');});list.append(row);}});}
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
 function updateShell(){const raw=current?.state.documents[documentId],doc=raw?{...raw,id:documentId}:null;shell.update({document:doc,notebook:current?.state.notebook.title,notebookId,editing,total:visibleDocuments().length,isFavorite:isFavorite(documentId)});return doc;}
 function renderDocument(){
  content.replaceChildren();const doc=updateShell();content.classList.toggle('is-whiteboard',!!doc?.canvas);
  if(!doc){const empty=element('section',undefined,{class:'native-empty'});empty.append(element('h1','打开一个文档'),element('p','使用下方新签页菜单，或滑动展开目录。'));const create=shell.row(notebookId?'新建文档':'新建笔记本','new',()=>newItem(notebookId?'document':'notebook'));create.dataset.action=notebookId?'document':'notebook';empty.append(create);content.append(empty);return;}
  if(!doc.canvas)content.append(element('h1',doc.title));
  const locked=doc.locked||doc.coreLocked||doc.readOnly;if(locked)content.append(element('span','文档已锁定',{class:'badge'}));
  if(doc.canvas){
   mode.innerHTML=shell.button('上传素材','upload',()=>{}).innerHTML;mode.setAttribute('aria-label','上传白板素材');mode.title=locked?'白板已锁定，请先解除锁定后上传素材':'上传白板素材';
   // Keep the lock guard actionable so a tap explains why import is blocked.
   // Only an in-flight import disables it; locking never permits a write.
   mode.disabled=uploading;
   mode.onclick=()=>safe(async()=>{if(locked)throw Error('请先解除白板锁定');if(uploading)return;if(!media?.upload)throw Error('手机附件存储桥尚未加载，未上传或修改白板。');
    const book=notebookId,target=documentId,revision=current.revision;uploading=true;mode.disabled=true;
    try{const result=await media.upload({notebookId:book,documentId:target,documents,expectedRevision:revision,onProgress:notify});if(book===notebookId){current=await documents.load(book);fillTree();if(target===documentId)renderDocument();}notify(result?.cancelled?'已取消选择':`已导入 ${result?.count||0} 个素材，已保存到本机并保留历史。`);}
    finally{uploading=false;if(current?.state.documents[documentId]?.canvas)mode.disabled=false;}
   });
   mountWhiteboardAlbum(content,{document:doc,readOnly:locked,resolveMedia:media?.resolve?node=>media.resolve(node,current.state):undefined,saveText:async(nodeId,text)=>{current=await documents.saveWhiteboardText(notebookId,{documentId,nodeId,text,expectedRevision:current.revision,operationId:uid('card-save')});notify('已保存文本卡片及历史版本。');},onError:showError});return;
  }
  const draft=current.state.mobileDrafts?.[documentId];draftRevision=draft?.draftRevision||0;
  if(editing){
   const tools=element('nav',undefined,{class:'editor-tools','aria-label':'文本编辑工具栏'});
   for(const [command,label] of mobileEditorTools){const button=element('button','',{type:'button','aria-label':label,title:label});button.innerHTML=editorIcon(command);button.onpointerdown=e=>e.preventDefault();button.onclick=()=>editRichText(textarea,command);tools.append(button);}
   content.insertBefore(tools,content.querySelector('h1'));
   textarea=element('article',undefined,{'aria-label':'文档正文',contenteditable:'true',spellcheck:'false'});textarea.innerHTML=renderMarkdown(draft?.markdown??doc.markdown);content.append(textarea);hydrateDocumentMedia(textarea,current.state,media);bindRichText(textarea,saveDraft);
  }
  else {const article=element('article');article.innerHTML=renderMarkdown(doc.markdown);content.append(article);hydrateDocumentMedia(article,current.state,media);if(draft&&!locked){const recover=element('button','恢复未保存草稿',{'data-action':'recover'});recover.onclick=()=>{editing=true;failedDraft=false;renderDocument();};content.append(recover);}}
  content.append(element('small',editing?'编辑模式 · 保存在本机':'阅读模式 · 保存在本机',{class:'native-document-status'}));
  mode.onclick=()=>safe(async()=>{
   if(locked)throw Error('文档已锁定，请先在文档详情中解除锁定。');
   if(!editing){editing=true;failedDraft=false;renderDocument();textarea.focus();return;}
   mode.disabled=true;await pending;
   try{if(failedDraft)throw Error('草稿保存发生冲突，输入仍在。请复制保留后重新读取，不会强制覆盖。');
    current=await documents.saveDocument(notebookId,{documentId,markdown:editorMarkdown(textarea),expectedRevision:current.revision,operationId:uid('save'),draftRevision});
    editing=false;notify('已保存，历史版本已核对。');renderDocument();
   }finally{mode.disabled=false;}
  });
 }
 function saveDraft(){
  const markdown=editorMarkdown(textarea),revision=++draftRevision,target=documentId,book=notebookId;
  pending=pending.then(async()=>{if(failedDraft)return;try{current=await documents.saveDraft(book,{documentId:target,markdown,draftRevision:revision,baseRevision:current.revision});notify('草稿已保存');}catch(error){failedDraft=true;showError(error);}});
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
  if(version.document.canvas){article.replaceChildren();const state=current.state;mountWhiteboardAlbum(article,{document:version.document,readOnly:true,resolveMedia:media?.resolve?node=>media.resolve(node,state):undefined,onError:showError});}
  dialog.append(element('h2','历史内容'),shell.button('关闭历史','close',()=>closeDialog(dialog),{'data-action':'close-history'}),article);hydrateDocumentMedia(article,current.state,media);
  const restore=element('button','设为当前（先保留当前版）',{'data-action':'restore-version'});restore.onclick=()=>safe(async()=>{current=await documents.restoreVersion(notebookId,{documentId,versionId:version.id,expectedRevision:current.revision,operationId:uid('restore')});closeDialog(dialog);renderDocument();notify('已恢复；恢复前全文仍保留在恢复记录中。');});
  const remove=shell.button('删除此版本','trash',()=>{const confirm=element('dialog'),cancel=element('button','取消'),accept=element('button','确认删除');confirm.append(element('h3','删除此历史版本？'),element('p','只删除此历史记录，当前正文不变。此操作不可撤销。'),cancel,accept);cancel.onclick=()=>closeDialog(confirm);accept.onclick=()=>safe(async()=>{accept.disabled=true;try{current=await documents.deleteVersion(notebookId,{documentId,versionId:version.id,confirmed:true,expectedRevision:current.revision,operationId:uid('delete-version')});closeDialog(confirm);closeDialog(dialog);showHistory();}finally{accept.disabled=false;}});confirm.addEventListener('close',()=>confirm.remove());root.append(confirm);confirm.showModal();},{class:'delete-version'});
  const actions=element('div',undefined,{class:'version-actions m8-version-actions'});actions.append(restore,remove);dialog.append(actions);dialog.addEventListener('close',()=>dialog.remove());root.append(dialog);dialog.showModal();
 }
 function newItem(kind){
  if(editing){notify('请先保存当前编辑。');return;}
  const dialog=element('dialog'),form=element('form'),input=element('input',undefined,{'aria-label':'名称',maxlength:'200',required:''}),submit=element('button','创建',{type:'submit'}),cancel=element('button','取消',{type:'button'});cancel.onclick=()=>closeDialog(dialog);form.append(element('h2',kind==='notebook'?'新建笔记本':kind==='whiteboard'?'新建白板':'新建文档'),input,submit,cancel);dialog.append(form);root.append(dialog);
  form.onsubmit=event=>{event.preventDefault();safe(async()=>{submit.disabled=true;try{if(kind==='notebook'){const nextId=uid('notebook');current=await documents.createNotebook({id:nextId,title:input.value});notebookId=nextId;notebooks=await documents.list();documentId='';}else{const nextId=uid(kind==='whiteboard'?'whiteboard':'note');current=await documents[kind==='whiteboard'?'createWhiteboard':'createDocument'](notebookId,{documentId:nextId,title:input.value,markdown:'',expectedRevision:current.revision,operationId:uid('create')});documentId=nextId;}closeDialog(dialog);fillNotebooks();fillTree();renderDocument();}finally{submit.disabled=false;}});};
  dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();input.focus();
 }
 function trashDocument(onDone){
  const doc=current?.state.documents[documentId];if(!doc)return;if(editing||doc.locked||doc.coreLocked||doc.readOnly){showError(Error('请先保存并解除锁定，才能移入回收站。'));return;}
  const d=element('dialog'),cancel=element('button','取消'),accept=element('button','移入回收站');d.append(element('h3','移入回收站？'),element('p','正文、附件引用和历史版本会保留，不会彻底删除。'),cancel,accept);cancel.onclick=()=>closeDialog(d);accept.onclick=()=>safe(async()=>{accept.disabled=true;try{current=await documents.trashDocument(notebookId,{documentId,confirmed:true,expectedRevision:current.revision,operationId:uid('trash')});closeDialog(d);onDone?.();documentId='';fillTree();renderDocument();notify('已移入回收站，资料与历史保留。');}finally{accept.disabled=false;}});root.append(d);d.showModal();
 }
 addBook.onclick=()=>newItem('notebook');select.onchange=()=>safe(async()=>{if(editing){select.value=notebookId;shell.renderBooks();notify('请先保存当前编辑。');return;}notebookId=select.value;current=await documents.load(notebookId);documentId=visibleDocuments()[0]?.id||'';shell.renderBooks();fillTree();renderDocument();});
 documentId=visibleDocuments()[0]?.id||'';fillNotebooks();fillTree();renderDocument();
 return {flush:()=>pending};
}
