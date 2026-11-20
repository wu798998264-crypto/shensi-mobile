// MOBILE / 07 (8951) presentation backed by native workspace controllers.
// No demo notebooks, sample responses or browser credential storage.
import {mobileShellIcon as shellIcon} from './shell-icons.js';
export {shellIcon};
const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
export function createNativeShell(root,actions){
 root.replaceChildren();root.className='native-workspace m3-phone native-approved';root.dataset.appearance=actions.appearance?.()||'跟随系统';root.classList.toggle('m3-dark',root.dataset.appearance==='深色');
 const button=(label,key,fn,attrs={})=>{const node=el('button',undefined,{type:'button','aria-label':label,title:label,...attrs});node.innerHTML=shellIcon(key);node.onclick=fn;return node;};
 const row=(label,key,fn,detail='')=>{const node=button(label,key,fn,{class:'m7-menu-row'});node.append(el('span',label));if(detail)node.append(el('small',detail));if(label==='历史版本')node.dataset.action='history';return node;};
 const tabs=new Map();let current=null,bookName='',bookId='',favorite=false,favoritesOnly=false,pluginChoice='chat';
 // Session-only composer drafts are distinct from document edits/history.
 // Bind each input to its original context, including IME input during a switch.
 const chatDrafts=new Map(),chatContext=()=>JSON.stringify([bookId,current?.id||null]);
 const head=el('header',undefined,{class:'phone-head'}),name=el('strong','神思'),brand=el('div',undefined,{class:'native-brand'});brand.append(name);
 const mode=button('编辑','edit',()=>actions.edit(),{'data-action':'mode'}),more=button('文档详情与状态','more',()=>detailsMenu()),headActions=el('div');headActions.append(mode,more);head.append(button('展开目录','panel',()=>showDirectory()),brand,headActions);
 const content=el('section',undefined,{class:'phone-content document-content'}),notice=el('p','',{role:'status','aria-live':'polite',class:'notice',popover:'manual'});
 const nav=el('nav',undefined,{class:'phone-foot m3-nav'});nav.append(button('快速搜索','search',()=>search()),button('新建签页','new',()=>newMenu()),button('签页切换','tabs',()=>tabsMenu()),button('当前文档','doc',()=>documentMenu()));
 const directory=el('aside',undefined,{class:'m3-directory native-directory','aria-label':'文档目录'});directory.hidden=true;
 const directoryHead=el('header'),directoryLabel=el('div',undefined,{class:'m6-directory-label'}),directoryTitle=el('span','目录');
 const favorites=button('收藏文档','star',()=>{favoritesOnly=!favoritesOnly;directoryTitle.textContent=favoritesOnly?'收藏':'目录';favorites.innerHTML=shellIcon(favoritesOnly?'starFilled':'star');favorites.setAttribute('aria-pressed',String(favoritesOnly));favorites.setAttribute('aria-label',favoritesOnly?'显示全部文档':'收藏文档');favorites.title=favorites.getAttribute('aria-label');actions.filterFavorites(favoritesOnly);},{'aria-pressed':'false','data-action':'favorites'});
 const select=el('select',undefined,{'aria-label':'当前笔记本',hidden:''}),tree=el('div',undefined,{class:'m3-tree document-tree'}),footer=el('footer'),count=el('small');
 const bookPicker=el('div',undefined,{class:'notebook-picker'}),bookButton=button('选择笔记本','down',()=>{bookMenu.hidden=!bookMenu.hidden;bookButton.setAttribute('aria-expanded',String(!bookMenu.hidden));renderBooks();},{class:'notebook-picker-button','aria-expanded':'false','aria-controls':'notebook-options'}),bookLabel=el('span','尚无笔记本',{class:'notebook-picker-name','data-user-content':''}),bookMenu=el('section',undefined,{class:'notebook-options',id:'notebook-options','aria-label':'笔记本列表'});
 bookMenu.hidden=true;bookButton.prepend(bookLabel);bookPicker.append(bookButton,bookMenu);
 function renderBooks(){bookLabel.textContent=actions.notebooks?.().find(n=>n.id===select.value)?.title||'尚无笔记本';bookMenu.replaceChildren();for(const n of actions.notebooks?.()||[]){const item=el('section',undefined,{class:'notebook-option'}),choose=el('button',n.title,{type:'button',class:'notebook-option-name','data-user-content':'','data-notebook':n.id,'aria-current':String(n.id===select.value)}),tools=el('div',undefined,{class:'notebook-option-tools'});choose.onclick=()=>{select.value=n.id;select.onchange?.();bookMenu.hidden=true;bookButton.setAttribute('aria-expanded','false');};tools.append(button('重命名笔记本','edit',()=>actions.renameNotebook(n.id),{'data-book-edit':n.id}),button('删除笔记本','trash',()=>actions.deleteNotebook(n.id),{'data-book-delete':n.id}));item.append(choose,tools);bookMenu.append(item);}bookMenu.append(row('新建笔记本','new',()=>{bookMenu.hidden=true;bookButton.setAttribute('aria-expanded','false');actions.newNotebook();}));}
 root.addEventListener('pointerdown',event=>{if(!bookPicker.contains(event.target)){bookMenu.hidden=true;bookButton.setAttribute('aria-expanded','false');}});
 const addBook=row('新建笔记本','new',()=>actions.newNotebook());addBook.dataset.action='notebook';addBook.hidden=true;
 directoryLabel.append(favorites,directoryTitle);directoryHead.append(directoryLabel,bookPicker,select);footer.append(count,button('设置','settings',()=>settings()));directory.append(directoryHead,tree,addBook,footer);
 const shade=el('button',undefined,{class:'m3-shade','aria-label':'关闭侧栏'});shade.hidden=true;shade.onclick=()=>closePanel();
 const plugin=el('aside',undefined,{class:'m3-plugin native-plugin'});plugin.hidden=true;
 root.append(head,content,nav,notice,shade,directory,plugin);
 const services=el('section',undefined,{class:'native-services'});services.hidden=true;root.append(services);
 function closePanel(){directory.hidden=plugin.hidden=shade.hidden=true;bookMenu.hidden=true;bookButton.setAttribute('aria-expanded','false');}
 function showDirectory(){closePanel();directory.hidden=shade.hidden=false;}
 function dialog(title){
  const node=el('dialog',undefined,{class:'native-sheet m3-sheet'}),heading=el('header'),close=button('关闭','close',()=>node.close(),{class:'sheet-close'});
  node.append(el('div',undefined,{class:'m3-handle','aria-hidden':'true'}));heading.append(el('h2',title),close);node.append(heading);
  node.addEventListener('click',e=>{if(e.target===node){const r=node.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)node.close();}});
  node.addEventListener('close',()=>node.remove());root.append(node);node.showModal();return node;
 }
 function openService(key){closePanel();root.querySelectorAll('dialog').forEach(d=>d.close());if(!actions.service(key))unavailable(key);}
 function unavailable(label){const d=dialog(label);d.append(el('p','此功能的原生执行器仍在接入，当前不会模拟执行或修改资料。'));}
 function newMenu(){const d=dialog('新建签页');d.classList.add('m7-action-sheet');d.append(row('创建新文档','new',()=>{d.close();actions.newDocument();}),row('新建白板','board',()=>{d.close();actions.newWhiteboard();}),row('打开文件','folderOpen',()=>unavailable('文件导入')),row('关闭当前签页','close',()=>closeCurrent(d)));}
 function closeCurrent(d){const id=current?.id;if(actions.closeDocument()===false)return;if(id)tabs.delete(id);d.close();}
 function toggleFlag(field,value,d,render){
  const controls=[...d.querySelectorAll('button')];controls.forEach(b=>b.disabled=true);
  Promise.resolve(actions.setDocumentFlag(field,value)).then(ok=>{if(ok){d.close();d.remove();render();actions.notify(notice.textContent);}}).catch(error=>actions.notify(error.message||'未保存，请重试。')).finally(()=>controls.forEach(b=>b.disabled=false));
 }
 function favoriteRow(d,render){const node=row(favorite?'取消收藏':'收藏文档',favorite?'starFilled':'star',()=>toggleFlag('favorite',!favorite,d,render));node.dataset.action='favorite';node.setAttribute('aria-pressed',String(favorite));node.disabled=!current;return node;}
 function lockRow(d,render=detailsMenu){const locked=!!(current?.locked||current?.coreLocked||current?.readOnly),node=row(locked?'解除锁定':'锁定文档',locked?'lock':'unlock',()=>toggleFlag('locked',!locked,d,render));node.dataset.action='lock';node.setAttribute('aria-pressed',String(locked));node.disabled=!current;return node;}
 function documentMenu(){
  const d=dialog(current?.title||'未打开文档');if(current)d.querySelector('h2').dataset.userContent='';d.classList.add('m7-action-sheet','m7-document-menu');
  const properties=el('section',undefined,{'aria-label':'文档属性与历史'});properties.append(row('双向链接与属性','link',()=>{d.close();detailsMenu();}),favoriteRow(d,documentMenu),lockRow(d,documentMenu),row('历史版本','history',()=>{d.close();actions.history();}));
  const group=el('section',undefined,{class:'m7-plugin-section','aria-label':'可用插件'});group.append(el('h4','可用插件'),row('打开文档对话','chat',()=>{d.close();showPlugin('chat');}),row('打开文档大纲','outline',()=>{d.close();showPlugin('outline');}),row('打开坚果云同步','cloud',()=>openService('坚果云')));d.append(properties,group);
 }
 function detailsMenu(){
  const d=dialog('文档详情与状态'),details=el('dl');d.classList.add('m7-action-sheet');
  const locked=current?.locked||current?.coreLocked||current?.readOnly,linked=actions.links?.()||[];
  for(const [label,value]of [['标题',current?.title||'—'],['位置',bookName+(current?.customFolderPath?' / '+current.customFolderPath:'')],['状态',locked?'锁定':'可编辑'],['双向链接',linked.length?linked.map(v=>v.title).join('、'):'暂无'],['属性',`类型：${current?.canvas?'白板相册':'正文'} · 字数 ${current?.markdown?.length||0}`]])details.append(el('dt',label),el('dd',value));
  const remove=row('移入回收站','trash',()=>actions.trashDocument(()=>d.close()));
  d.append(details,favoriteRow(d,detailsMenu),lockRow(d),row('历史版本','history',()=>{d.close();actions.history();}),row('关闭文档','close',()=>closeCurrent(d)),remove);
 }
 function search(){const d=dialog('快速搜索'),input=el('input',undefined,{'aria-label':'搜索当前笔记本',placeholder:'搜索当前笔记本'}),list=el('div',undefined,{'data-user-content':''});const refresh=()=>{list.replaceChildren();for(const doc of actions.documents().filter(v=>(v.title+' '+v.markdown).includes(input.value)))list.append(row(doc.title,'doc',()=>{d.close();actions.selectDocument(doc.id);}));};d.append(input,list);input.oninput=refresh;refresh();input.focus();}
 function tabsMenu(){const d=dialog('签页'),grid=el('div',undefined,{class:'m3-tab-grid'});for(const [id,doc]of tabs){const card=el('section',undefined,{class:'m3-tab-card'}),open=el('button',undefined,{type:'button'});open.append(el('b',doc.title),el('p',doc.canvas?'白板只读相册':(doc.markdown||'').slice(0,55)));open.onclick=()=>{d.close();actions.selectDocument(id);};card.append(button('关闭 '+doc.title,'close',()=>{if(actions.closeDocument(id)===false)return;tabs.delete(id);card.remove();}),open);grid.append(card);}if(!tabs.size)grid.append(el('p','尚无打开的签页'));d.append(grid);}
 function settings(){
  closePanel();const d=dialog('设置');d.classList.add('native-settings','m7-settings');
  const back=d.querySelector('.sheet-close');back.innerHTML=shellIcon('back');back.setAttribute('aria-label','返回目录');back.title='返回目录';back.onclick=()=>{d.close();showDirectory();};
  const settingRow=(label,key,fn,detail='')=>{const node=row(label,key,fn,detail);node.className='m7-setting-row';node.insertAdjacentHTML('beforeend',shellIcon('right'));return node;};
  const account=button('账户设置','user',()=>openService('账户设置'),{class:'m7-account-row'}),avatar=el('span',undefined,{class:'m7-avatar'}),text=el('span');avatar.innerHTML=shellIcon('user');text.append(el('b','账户设置'),el('small','登录账户与管理服务'));account.replaceChildren(avatar,text);account.insertAdjacentHTML('beforeend',shellIcon('right'));
  Promise.resolve(actions.accountStatus?.()).then(state=>{if(!d.isConnected||!state?.user||state.status==='signed_out')return;const displayName=text.querySelector('small');displayName.dataset.userContent='';displayName.textContent=state.user.displayName||'神思用户';if(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(state.user.avatar||'')){const image=el('img',undefined,{src:state.user.avatar,alt:'用户头像'});image.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:inherit';avatar.replaceChildren(image);}}).catch(()=>{});
  const reading=el('div',undefined,{class:'m7-setting-group'}),plugins=el('div',undefined,{class:'m7-setting-group'});
  reading.append(settingRow('界面语言','language',()=>{const list=dialog('界面语言');for(const [code,label] of [['zh-CN','简体中文'],['en','English']]){const option=row(label,'language',async()=>{try{await actions.language.set(code);list.close();d.close();settings();}catch(error){actions.notify(error.message);}});option.setAttribute('aria-pressed',String(actions.language.get()===code));list.append(option);}},actions.language?.get()==='en'?'English':'简体中文'),settingRow('外观','moon',()=>{const choice=dialog('外观');for(const [label,key]of [['浅色','sun'],['深色','moon'],['跟随系统','monitor']]){const option=row(label,key,async()=>{try{await actions.setAppearance?.(label);root.classList.toggle('m3-dark',label==='深色');root.dataset.appearance=label;choice.close();d.close();settings();}catch(error){actions.notify(error.message);}});option.setAttribute('aria-pressed',String(root.dataset.appearance===label));choice.append(option);}},root.dataset.appearance),settingRow('历史版本','history',()=>{const list=dialog('历史版本设置');list.append(el('p','保留时间设置尚未接通；已有历史不会自动清理。'),row('查看当前文档历史','history',()=>{list.close();d.close();actions.history();}));},'保留全部'),settingRow('回收站','trash',()=>actions.recycleNotebooks()));
  plugins.append(settingRow('核心插件','puzzle',()=>{const list=dialog('核心插件');list.append(row('文档对话','chat',()=>{list.close();d.close();showPlugin('chat');}),row('文档大纲','outline',()=>{list.close();d.close();showPlugin('outline');}),row('文本编辑工具栏','edit',()=>{const info=dialog('文本编辑工具栏');info.append(el('p','进入编辑模式后，在正文标题上方使用标题、粗体、斜体、列表、引用、链接、代码和清除格式。'));}));}),settingRow('扩展插件','blocks',()=>{const extensions=dialog('扩展插件'),group=el('section',undefined,{class:'m7-plugin-section'});extensions.append(row('坚果云同步','cloud',()=>openService('坚果云'),'自带'));group.append(row('插件广场','blocks',()=>openService('手机插件广场'),'手机兼容'));extensions.append(group);}),settingRow('云端同步','cloud',()=>openService('官方云端同步')),settingRow('自定义 API','sliders',()=>actions.customApiSettings()));
  d.append(account,el('h4','阅读与保存'),reading,el('h4','插件与连接'),plugins);
 }
 function showPlugin(key){
  closePanel();pluginChoice=key;plugin.replaceChildren();plugin.classList.toggle('m7-chat',key==='chat');
  const header=el('header'),heading=el('h3'),body=el('div',undefined,{class:'m3-plugin-body'+(key==='chat'?' m6-chat-body':'')}),foot=el('footer',undefined,{class:'m4-plugin-footer'});
  heading.innerHTML=shellIcon(key);heading.append(document.createTextNode(key==='outline'?'文档大纲':'文档对话'));header.append(heading);if(key==='chat')header.append(el('small','核心插件'));
  if(key==='outline'){
   const outline=el('nav',undefined,{class:'m4-outline','aria-label':'文档大纲'}),lines=(current?.markdown||'').split('\n').map(line=>/^(#{1,6})\s+(.+)$/.exec(line)).filter(Boolean);
   if(current)outline.append(row(current.title,'doc',()=>{closePanel();content.scrollTop=0;}));
   for(const match of lines){const item=row(match[2],'doc',()=>{closePanel();[...content.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(n=>n.textContent===match[2])?.scrollIntoView({block:'center'});});item.style.paddingLeft=(14+(match[1].length-1)*16)+'px';outline.append(item);}
   if(!current)outline.append(el('p','请先打开文档'));body.append(outline);
  }else{
   if(!actions.mountChat){
   body.append(el('p','可以先输入内容。模型发送通道尚未接通；未发送文字仅在当前页面保留，刷新或退出后不保留。',{class:'hint',id:'mobile-chat-availability'}));
   const compose=el('div',undefined,{class:'m3-chat-input m7-compose'}),input=el('textarea',undefined,{placeholder:'继续聊聊这一章…','aria-label':'文档对话输入','aria-describedby':'mobile-chat-availability'}),controls=el('div',undefined,{class:'m7-compose-actions'});
   const context=chatContext();input.value=chatDrafts.get(context)||'';
   input.oninput=()=>{if(input.value)chatDrafts.set(context,input.value);else chatDrafts.delete(context);};
   const configuration=row('选择配置','sparkles',()=>unavailable('文档对话模型'));configuration.className='m7-model-button';configuration.insertAdjacentHTML('beforeend',shellIcon('down'));
   const models=el('button','选择模型',{type:'button',class:'m7-effort-button','aria-label':'选择具体模型和参数'});models.insertAdjacentHTML('beforeend',shellIcon('down'));models.onclick=()=>unavailable('文档对话模型');
   const send=button('发送消息','arrow',()=>{},{class:'m7-send',disabled:'',title:'模型发送通道尚未接通，输入文字不会发送','aria-describedby':'mobile-chat-availability'});controls.append(configuration,models,send);compose.append(input,controls);body.append(compose);}
  }
  const switcher=el('div',undefined,{class:'m4-plugin-switch'}),options=el('div',undefined,{class:'m4-plugin-options'});options.hidden=true;
  for(const [id,label,icon]of [['chat','文档对话','chat'],['outline','文档大纲','doc'],['nutstore','坚果云同步','cloud']]){const option=row(label,icon,()=>id==='nutstore'?openService('坚果云'):showPlugin(id));option.classList.toggle('active',id===key);options.append(option);}
  const pill=button('切换插件',key==='chat'?'chat':'doc',()=>{options.hidden=!options.hidden;switcher.classList.toggle('expanded',!options.hidden);pill.setAttribute('aria-expanded',String(!options.hidden));pill.lastElementChild.outerHTML=shellIcon(options.hidden?'expand':'collapse');},{class:'m4-plugin-pill','aria-expanded':'false'});pill.append(el('b',key==='outline'?'文档大纲':'文档对话'));pill.insertAdjacentHTML('beforeend',shellIcon('expand'));switcher.append(options,pill);foot.append(switcher);plugin.append(header,body,foot);plugin.hidden=shade.hidden=false;if(key==='chat')actions.mountChat?.(body,chatContext());
 }
 let gesture;content.onpointerdown=e=>{if(e.target.closest('button,input,textarea,[contenteditable=true]'))return;gesture={x:e.clientX,y:e.clientY};};content.onpointerup=e=>{if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture=null;if(Math.abs(dx)>65&&Math.abs(dy)<60)dx<0?showDirectory():showPlugin(pluginChoice);};
 root.onkeydown=e=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229&&!root.querySelector('dialog[open]'))closePanel();};
 return {content,notice,tree,select,addBook,mode,services,closePanel,showDirectory,button,row,renderBooks,
  update({document,notebook,notebookId,editing,total,isFavorite}){const previousContext=chatContext();if(bookId&&bookId!==notebookId)tabs.clear();bookId=notebookId;current=document;favorite=!!isFavorite;bookName=notebook||'神思';name.textContent=bookName;count.textContent=`当前笔记本共 ${total} 个文档（含白板）`;if(document)tabs.set(document.id,document);mode.disabled=!document||!!(document.locked||document.coreLocked||document.readOnly);mode.innerHTML=shellIcon(editing?'read':'edit');mode.setAttribute('aria-label',editing?'保存并阅读':'编辑');mode.title=mode.getAttribute('aria-label');if(!plugin.hidden&&previousContext!==chatContext())showPlugin(pluginChoice);}
 };
}
