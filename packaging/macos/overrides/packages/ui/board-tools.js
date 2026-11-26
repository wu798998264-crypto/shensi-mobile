import {chooseMediaRange} from './media-trim.js';
import {frameLatest} from './board-interaction.js';
import {captureNodeVersion,fittedBoardViewport} from './canvas-model.js';
import {originalIcon} from './original-icons.js';
import {escapeHtml as h} from './editor.js';
import {contextMenu} from './context-menu.js';
import {addTextCard,copySelection,pasteSelection,nodeSidePoint,connectionPath} from './canvas-model.js';
import {createDepthCards} from './depth-card.js';
import {splitWhiteboardContent} from './whiteboard-smart-split.js';
import {openBoardAssets,assetContent} from './board-assets.js';
import {chooseBoardMedia} from './board-upload.js';
import {openArrangePreview} from './board-arrange.js';
import {chooseStorageLocation} from './storage-location-picker.js';
import {chooseCardReplacement} from './card-replacement.js';
import {openBoardVideoParser} from './board-video-parser.js';
import {duplicateCards} from './card-duplicate.js';
import {chooseDocumentExport} from './document-export.js';
import {generationCardRatio,inheritedMediaRatio} from './generation-intent.js';

export const CARD_COLORS={default:'',gray:'#a9adb3',red:'#df6d68',orange:'#e8915a',yellow:'#e8c85b',green:'#6fbd8a',teal:'#4fb5a7',cyan:'#5bb7d3',blue:'#6f9fd5',indigo:'#7886d8',purple:'#a477d2',pink:'#d982ad'};
const colorNames=['默认','灰色','红色','橙色','黄色','绿色','青绿色','青色','蓝色','靛色','紫色','粉色'];
const item=(value,label,extra={})=>({value,label,...extra});
const generateItems=()=>[['text','文本'],['image','图片'],['video','视频'],['audio','音频']].map(([id,label])=>item('generate-'+id,'生成'+label));
const isTextCard=node=>node&&!node.file&&node.type!=='file'&&!['image','video','audio'].includes(node.kind);

// The menu target is captured before opening: a later selection cannot redirect
// an edit to another card or turn an edge action into a canvas action.
export function createBoardTools(c){
 let toolbar,imageEditor,duplicating=false,savingNote=false;const depth=createDepthCards({...c,focus:node=>{c.select([node.id]);return action('focus',{node});}});
 const canvas=()=>c.current()?.canvas;
 const nodes=()=>canvas().nodes.filter(n=>c.selected().has(n.id));
 const mutate=fn=>{c.undo();fn();c.changed();};
 const focus=node=>{const board=document.querySelector('.board'),v=canvas().viewport;v.zoom=Math.min(1.4,(board.clientWidth-100)/node.width,(board.clientHeight-100)/node.height);v.x=(board.clientWidth-node.width*v.zoom)/2-node.x*v.zoom;v.y=(board.clientHeight-node.height*v.zoom)/2-node.y*v.zoom;c.changed();};
 const add=(point,fields={})=>{let node;mutate(()=>{node=addTextCard(canvas(),{...point,...fields});Object.assign(node,fields);c.select([node.id]);});return node;};
 const referenceItems=[item('reference-document','引用文档'),item('reference-book','引用小说')];
 async function menu(event){
  event.preventDefault();const board=event.currentTarget,card=event.target.closest('[data-node]'),edge=event.target.closest('[data-edge]'),targetId=card?.dataset.node,node=canvas().nodes.find(n=>n.id===targetId),r=board.getBoundingClientRect(),v=canvas().viewport,point={x:(event.clientX-r.left-v.x)/v.zoom,y:(event.clientY-r.top-v.y)/v.zoom};
  const scope=c.libraryId()+':'+c.current().id;
  if(node&&!c.selected().has(node.id)){c.select([node.id]);c.selectionChanged?.();}
  if(edge&&!node&&!c.selectedEdges?.().has(edge.dataset.edge)){c.selectEdges?.([edge.dataset.edge]);c.selectionChanged?.();}
  const refs=item('reference','引用',{children:referenceItems}),colors=item('color','卡片颜色',{children:Object.keys(CARD_COLORS).map((id,i)=>item('color-'+id,colorNames[i],{swatch:CARD_COLORS[id],checked:(node?.color||'default')===id}))});
  const items=edge&&!node?[item('delete-edge','删除连线',{danger:true})]:node?[
   ...(c.generationEnabled()?[item('generate','生成',{children:generateItems()}),...(!node.file&&!String(node.text||'').trim()&&node.operation?.type!=='depth-explorer'?[item('parse-video','采集')]:[])]:[]),item('preview','预览'),item('versions','查看历史版本'),item('save-history','保存历史版本'),item('attachment','上传'),
   item('replace-media','替换'),...(!node.file?[item('edit','编辑文字'),item('smart-split','智能拆分')]:[]),null,refs,...(!node.file?[item('save-as-note','另存为笔记')]:[]),
   item('copy-cards','复制'),item('cut-cards','剪切'),item('duplicate-card','创建副本'),isTextCard(node)?item('export-text','导出',{icon:originalIcon('export')}):item('save-as','另存为'),item('reveal','打开所在文件夹'),null,item('link-upstream','选择上游卡片'),item('focus','聚焦卡片'),...(c.selected().size>1?[item('arrange','局部整理')]:[]),colors,item('delete-cards','删除卡片',{danger:true})
  ]:[item('add-plain','创建节点'),...(c.generationEnabled()?generateItems():[]),...(c.generationEnabled()&&c.depthEnabled?.()?[item('create-depth','深度摸索')]:[]),...(c.generationEnabled()?[item('parse-video','采集')]:[]),item('paste-cards','粘贴',{disabled:!c.canPaste()}),...referenceItems,item('attachment','上传'),null,item('select-cards','选择全部卡片'),item('arrange-all','自动整理'),item('fit','一键居中')];
  const answer=await contextMenu(items,event);if(answer.value==='cancel'||scope!==c.libraryId()+':'+c.current()?.id)return;
  if(node&&!canvas().nodes.some(n=>n.id===node.id))return;
  try{await action(answer.value,{node:node||null,edgeId:edge?.dataset.edge,point});}catch(error){c.toast(error.message);}
 }
 async function reference(kind,target,point){
  const scope=c.libraryId()+':'+c.current().id,ensureActive=()=>{if(scope!==c.libraryId()+':'+c.current().id)throw Error('白板已切换，未添加引用');};
  if(kind==='book'){const ref=await openBookPicker({api:(path,body)=>c.api('/api/official'+path,body),notebookId:c.libraryId()});if(!ref)return;ensureActive();const novel=await c.api('/api/official/books/read',{id:c.libraryId(),referenceId:ref.referenceId});ensureActive();const card=add(point,{name:novel.title+' · 小说引用',text:novel.text,bookReference:{referenceId:novel.id,coverage:novel.coverage,sha256:novel.sha256}});if(target)mutate(()=>canvas().edges.push({id:'edge-'+crypto.randomUUID(),fromNode:card.id,toNode:target.id}));await c.flush();return;}
  const readApi=(path,body)=>c.api(path,body,false);
  const ref=await openReferencePicker({api:readApi,kind:'document',notebookId:c.libraryId()});if(!ref)return;ensureActive();
  const doc=await readReference(readApi,ref);ensureActive();
  const node=add(point,{kind:'reference',name:doc.title,text:doc.text,reference:doc.reference,coreLinkedDocument:true});if(target)mutate(()=>canvas().edges.push({id:'edge-'+crypto.randomUUID(),fromNode:node.id,toNode:target.id}));await c.flush();
 }
 async function action(value,{node=nodes()[0],edgeId,point,seconds}={}){
  const board=document.querySelector('.board'),v=canvas().viewport;point??=node?{x:node.x-node.width-80,y:node.y}:{x:(80-v.x)/v.zoom,y:(80-v.y)/v.zoom};
  if(value==='parse-video')return openBoardVideoParser(c,{node,point});
  if(value==='create-depth'){if(!c.generationEnabled()||!c.depthEnabled?.())throw Error('请先启用白板生成和深度摸索插件');const input=node;const created=add(input?{x:input.x+input.width+100,y:input.y}:point,{name:'深度摸索',text:'',operation:{type:'depth-explorer',settings:{quality:'balanced',provider:'auto',invertDepth:false,keepAudio:true}},width:420,height:240});if(input?.file)mutate(()=>canvas().edges.push({id:'edge-'+crypto.randomUUID(),fromNode:input.id,toNode:created.id}));await c.flush();return;}
  if(value.startsWith('generate-')){if(!c.generationEnabled())throw Error('白板生成插件已停用');if(!node)node=add(point);c.select([node.id]);c.changed();await c.generate(value.slice(9));return;}
  if(['reference-document','reference-book'].includes(value))return reference(value.slice(10),node,point);
  if(value.startsWith('color-')){const color=value.slice(6);mutate(()=>nodes().forEach(n=>n.color=color));return;}
  if(value==='add-plain'){add(point);return;}
  if(value==='replace-media'){
   if(!await c.flush())return;const id=c.libraryId(),documentId=c.current().id,stamp=c.stamp(),targetId=node.id;
   const operations=new Map();await chooseCardReplacement({nodes:canvas().nodes.map(({id,kind,file,name})=>({id,kind,file,name})),nodeId:targetId,loadAssets:async()=>(await c.api('/api/board/assets')).assets,assetUrl:(path,asset)=>c.assetUrl(path,asset?.sourceDocumentId||documentId,asset?.sourceNotebookId||id),applySelection:async(answer,title)=>{
    if(id!==c.libraryId()||documentId!==c.current()?.id||c.isDirty()||c.stamp()!==stamp)throw Error('白板已变化，未替换，请重新选择');
    const key=JSON.stringify(answer);if(!operations.has(key))operations.set(key,'replace-'+crypto.randomUUID());
    const result=await c.api('/api/board/assets/replace',{id,documentId,nodeId:targetId,expectedStateStamp:stamp,operationId:operations.get(key),...answer});
    if(id===c.libraryId()&&documentId===c.current()?.id&&!c.isDirty()&&c.stamp()===stamp){c.undo();c.apply(result);c.toast('已替换并保存：'+title);}else c.toast('替换已保存到原白板，当前人工稿保留');
   }});return;
  }
  if(value==='preview'||value==='edit'||value==='versions')return c.openNode(node.id,value==='versions'?'history':value==='edit'?'edit':'preview');
  if(['edit-image','separate','trim','frame'].includes(value))return mediaEdit(value,node,seconds);
  if(value==='assets'){
   if(!await c.flush())return;const scope=c.libraryId()+':'+c.current().id,active=()=>{if(scope!==c.libraryId()+':'+c.current().id)throw Error('白板已切换');return canvas();};
   let catalog=[];const refreshCatalog=async()=>{catalog=(await c.api('/api/board/assets')).assets;};await refreshCatalog();active();
   const sourceUrl=(path,asset)=>c.assetUrl(path,asset.sourceDocumentId,asset.sourceNotebookId);
   return openBoardAssets({canvas:active,catalog:()=>catalog,refreshCatalog,assetUrl:sourceUrl,toast:c.toast,changed:()=>c.changed(false),flush:c.flush,
    reveal:asset=>c.api('/api/settings/open-folder',{id:asset.sourceNotebookId,kind:asset.coreNodeSnapshot?.file?'attachment':'item',documentId:asset.sourceDocumentId,relativePath:asset.coreNodeSnapshot?.file}),
    remove:async asset=>{const result=await c.api('/api/board/assets/remove',{sourceId:asset.id,expectedStateStamp:asset.sourceStateStamp});if(result.id===c.libraryId())c.apply(result);},
    transform:async asset=>{const answer=await chooseStorageLocation({api:c.api,notebookId:c.libraryId(),title:asset.nodeName||'资产笔记'});if(!answer)return;const target=await c.api('/api/state?id='+encodeURIComponent(answer.id));await refreshCatalog();const live=catalog.find(a=>a.id===asset.id);if(!live)throw Error('原资产已变化');const result=await c.api('/api/board/assets/land',{...answer,sourceId:live.id,expectedSourceStateStamp:live.sourceStateStamp,expectedStateStamp:target.stateStamp});if(answer.id===c.libraryId())c.apply(result);c.toast('已保存为文档，原资产保留');},
    setTrashed:async(assets,trashed)=>{active();const groups=Map.groupBy(assets,a=>a.sourceNotebookId);let completed=0;try{for(const [id,items] of groups){const result=await c.api('/api/board/assets/trash',{sourceIds:items.map(a=>a.id),trashed,expectedStateStamp:items[0].sourceStateStamp});if(id===c.libraryId())c.apply(result);completed+=items.length;}}catch(error){await refreshCatalog();throw Error((completed?'已处理 '+completed+' 项；其余未改动。':'')+error.message);}},
    download:(node,asset)=>{if(!node.file)return c.download(node.text||'',(node.name||'文本')+'.md');const a=document.createElement('a');a.href=sourceUrl(node.file,asset);a.download=node.name||'媒体';a.click();},
    upload:async()=>{const entries=await chooseBoardMedia({api:c.api,id:c.libraryId(),documentId:c.current().id,ensureActive:active,includeText:true});active();if(entries.length){mutate(()=>{canvas().assets??=[];for(const entry of entries){const duplicate=canvas().assets.some(a=>entry.kind==='text'?a.kind==='text'&&a.text===entry.text:a.attachment?.relativePath===entry.file);if(duplicate)continue;canvas().assets.push({id:'asset-library-'+crypto.randomUUID(),kind:entry.kind,origin:'upload',source:'asset-library',nodeName:entry.name,text:entry.text||'',attachment:entry.attachment,createdAt:new Date().toISOString()});}});if(!await c.flush())throw Error('上传资产未保存，请处理保存冲突');}},
    add:{run:async asset=>{active();const {node:source}=await c.api('/api/board/assets/import',{id:c.libraryId(),documentId:c.current().id,sourceId:asset.id,expectedSourceStateStamp:asset.sourceStateStamp});active();mutate(()=>{const n=addTextCard(canvas(),{...point,name:source.name||asset.nodeName,text:source.text||''});if(source.file)Object.assign(n,{type:'file',kind:source.kind,file:source.file,mimeType:source.mimeType,durationMs:source.durationMs,videoWidth:source.videoWidth,videoHeight:source.videoHeight});c.select([n.id]);});if(!await c.flush())throw Error('添加未保存，请处理保存冲突');}}
   });
  }
  if(value==='save-history'){if(!node)return c.run('save-history');c.undo();if(!captureNodeVersion(canvas(),node.id)){c.toast(String(node.text||node.file||'').trim()?'当前内容已存在于历史版本中，无需重复保存':'空白卡片不会保存历史版本');return;}c.changed(false);if(await c.flush())c.toast('已保存卡片历史版本');return;}
  if(value==='focus'){focus(node);return;}
  if(value==='delete-edge'){const ids=new Set(c.selectedEdges?.().has(edgeId)?c.selectedEdges():[edgeId]);mutate(()=>{canvas().edges=canvas().edges.filter(e=>!ids.has(e.id));c.selectEdges?.([]);});return;}
  if(value==='select-cards'){c.select(canvas().nodes.map(n=>n.id));c.selectionChanged?.();return;}
  if(value==='duplicate-card'){
   if(duplicating){c.toast?.('正在创建副本，请稍候');return;}const scope=c.libraryId()+':'+c.current().id,ids=[...c.selected()];if(!ids.length)return;
   duplicating=true;try{
    c.toast?.('正在创建副本，请稍候');
    if(c.finishEditing&&!await c.finishEditing())throw Error('未创建副本：卡片编辑尚未保存，请点击顶部保存状态处理后重试。');
    if(!await c.flush())throw Error('未创建副本：当前内容尚未保存，请点击顶部保存状态处理后重试。');
    if(scope!==c.libraryId()+':'+c.current()?.id)throw Error('白板已切换，未创建副本');
    const liveIds=new Set(canvas().nodes.map(n=>n.id));if(ids.some(id=>!liveIds.has(id)))throw Error('原卡片已变化，请重新选择后创建副本');
    const liveBoard=document.querySelector('.board');
    mutate(()=>{const created=new Set(duplicateCards(c.current(),ids));c.select([...created]);const copies=canvas().nodes.filter(n=>created.has(n.id)),view=canvas().viewport;
     if(liveBoard?.clientWidth&&liveBoard?.clientHeight&&copies.some(n=>n.x*view.zoom+view.x<24||n.y*view.zoom+view.y<24||(n.x+n.width)*view.zoom+view.x>liveBoard.clientWidth-24||(n.y+n.height)*view.zoom+view.y>liveBoard.clientHeight-24))Object.assign(view,fittedBoardViewport(copies,liveBoard.clientWidth,liveBoard.clientHeight));
    });
    try{c.toast?.(await c.flush()?'副本已创建并保存':'副本已创建，暂未保存；请点击顶部保存状态继续保存，无需再次创建。');}
    catch(error){c.toast?.('副本已创建，暂未保存；请点击顶部保存状态继续保存，无需再次创建。');}
   }finally{duplicating=false;}return;
  }
  if(value==='cut-cards'){const scope=c.libraryId()+':'+c.current().id,ids=[...c.selected()].sort().join('\0');const copied=await c.run('copy-cards');if(copied?.copied&&scope===c.libraryId()+':'+c.current()?.id&&ids===[...c.selected()].sort().join('\0'))await c.run('delete-cards');return;}
  if(value==='reveal'){
   const id=c.libraryId(),documentId=c.current().id,nodeId=node?.id;if(!await c.flush())return;
   if(id!==c.libraryId()||documentId!==c.current()?.id)throw Error('白板已切换，未打开文件夹');
   const live=canvas().nodes.find(n=>n.id===nodeId);if(nodeId&&!live)throw Error('卡片已不存在，未打开文件夹');
   return c.api('/api/settings/open-folder',{id,kind:live?.file?'attachment':'item',documentId,...(live?.file?{relativePath:live.file}:{})});
  }
  if(value==='export-text'){
   const id=c.libraryId(),documentId=c.current().id,nodeId=node?.id;
   const ensureActive=()=>{if(id!==c.libraryId()||documentId!==c.current()?.id)throw Error('白板已切换，请回到原卡片导出');};
   if(c.finishEditing&&!await c.finishEditing())return;ensureActive();if(!await c.flush())return;ensureActive();
   const stamp=c.stamp(),saved=structuredClone(c.current());
   const exported=await chooseDocumentExport({api:c.api,modal:c.modal,id,state:{documents:{[documentId]:saved}},stateStamp:stamp,documentIds:[documentId],nodeId,beforeExport:()=>{ensureActive();if(c.isDirty()||c.stamp()!==stamp)throw Error('卡片内容已变化，请重新打开导出选项');}});
   if(exported?.saved)c.toast('已导出');return;
  }
  if(value==='save-as'){if(node.file){const a=document.createElement('a');a.href=c.assetUrl(node.file);a.download=node.name||'媒体';a.click();}else c.download(node.text||'',(node.name||'文本')+'.md');return;}
  if(value==='open-source'){const ref=node.reference;if(ref?.notebookId===c.libraryId())return c.openDocument(ref.documentId);if(ref)throw Error('请先切换到引用所在的笔记本');if(node.url){const result=await c.api('/api/open-link',{url:node.url});if(!result.opened)window.open(result.url,'_blank','noopener');}return;}
  if(value==='link-upstream'){const choices=canvas().nodes.filter(n=>n.id!==node.id),answer=await c.modal('选择上游卡片',`<label>上游卡片<select name="source">${choices.map(n=>`<option value="${h(n.id)}">${h(n.name||n.id)}</option>`).join('')}</select></label>`);if(answer.value==='ok'&&answer.source)mutate(()=>{if(!canvas().edges.some(e=>e.fromNode===answer.source&&e.toNode===node.id))canvas().edges.push({id:'edge-'+crypto.randomUUID(),fromNode:answer.source,toNode:node.id});});return;}
  if(value==='smart-split'){const result=splitWhiteboardContent(node.text);if(result.parts.length<2){c.toast('没有识别到可拆分结构；原文保持完整');return;}const answer=await c.modal('智能拆分',`<p>将原文按原版结构识别拆为 ${result.parts.length} 张卡片，保留原卡片。</p><div class="history-preview">${h(result.parts.map(p=>p.title).join('\n'))}</div>`);if(answer.value!=='ok')return;mutate(()=>result.parts.forEach((part,index)=>{const card=addTextCard(canvas(),{name:part.title,text:part.text,x:node.x+node.width+100,y:node.y+index*280});canvas().edges.push({id:'edge-'+crypto.randomUUID(),fromNode:node.id,toNode:card.id});}));await c.flush();return;}
  if(value==='arrange'||value==='arrange-all')return openArrangePreview({canvas:canvas(),selectedIds:value==='arrange'?[...c.selected()]:null,active:()=>canvas(),undo:c.undo,changed:c.changed,toast:c.toast});
  if(value==='save-as-note'){
   if(savingNote)return;const id=c.libraryId(),documentId=c.current().id,nodeId=node?.id;
   const source=()=>{if(id!==c.libraryId()||documentId!==c.current()?.id)throw Error('白板已切换，请回到原卡片另存为笔记');const live=canvas().nodes.find(n=>n.id===nodeId);if(!live||live.file)throw Error('原文本卡片已变化，请重新选择');return live;};
   savingNote=true;try{
    if(c.finishEditing&&!await c.finishEditing()||!await c.flush())return;const live=source(),text=String(live.text||'');
    const answer=await chooseStorageLocation({api:(path,body)=>c.api(path,body,false),notebookId:id,title:live.name||'白板笔记',preview:text});if(!answer)return;
    if(!await c.flush())return;
    const target=await c.api('/api/state?id='+encodeURIComponent(answer.id),undefined,false);
    const sourceState=answer.id===id?target:await c.api('/api/state?id='+encodeURIComponent(id),undefined,false),savedSource=sourceState.state.documents[documentId]?.canvas?.nodes.find(n=>n.id===nodeId);
    if(!savedSource||savedSource.file||String(savedSource.text||'')!==text||String(source().text||'')!==text)throw Error('卡片内容已变化，请重新预览后保存');
    await c.api('/api/document',{id:answer.id,expectedStateStamp:target.stateStamp,kind:'note',document:{title:answer.title,markdown:text,coreFolderId:answer.folderId,...(target.state.coreWork?.enabled?{coreWorkRole:'library',coreWorkContentType:'reference'}:{})}},false);
    c.toast('已另存为笔记，原卡片保留');
    if(answer.id===c.libraryId())try{await c.refreshWorkspace?.();}catch(error){c.toast('笔记已保存，目录刷新失败：'+error.message);}
   }finally{savingNote=false;}return;
  }
  return c.run(value);
 }
 async function mediaEdit(action,node,seconds){
  const doc=c.current(),id=c.libraryId(),documentId=doc.id||c.documentId?.();
  const submit=async extra=>{if(!(await c.flush()))throw Error('请先处理保存冲突');const stamp=c.stamp(),result=await c.api('/api/board/media/edit',{id,documentId,nodeId:node.id,operationId:'media-edit-'+crypto.randomUUID(),action,expectedStateStamp:c.stamp(),...extra});if(id===c.libraryId()&&documentId===(c.current().id||c.documentId?.())&&!c.isDirty()&&c.stamp()===stamp){c.undo();c.apply(result);c.toast('处理结果已创建为下游卡片，原素材和历史保留');}else c.toast('媒体结果已保存；当前人工稿保留，请回到原白板读取合并');};
  if(action==='edit-image'){
   action='image';if(!imageEditor){const {createImageCardEditor}=await import('/legacy/image-card-editor.js');imageEditor=createImageCardEditor();imageEditor.dialog.addEventListener('image-editor-error',e=>c.toast(e.detail?.message||'图片编辑失败'));}
   await imageEditor.open({src:c.assetUrl(node.file),name:node.name,onSave:async({blob})=>{if(id!==c.libraryId()||documentId!==(c.current().id||c.documentId?.()))throw Error('请回到原白板保存');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});await submit({imageBase64:base64});}});return;
  }
  if(action==='separate'){await submit({});return;}
  if(action==='trim'){const range=await chooseMediaRange(node,c.assetUrl(node.file));if(range)await submit(range);return;}
  if(action==='frame'){
   const video=[...document.querySelectorAll('[data-node]')].find(el=>el.dataset.node===node.id)?.querySelector('video'),currentTimeMs=Math.max(0,Number.isFinite(seconds)?seconds:(video?.currentTime||0))*1000;
   const answer=await contextMenu([item('current','当前帧'),item('first','首帧'),item('last','尾帧')],toolbar?.querySelector('[data-board-tool="frame"]')||{});
   if(['current','first','last'].includes(answer.value))await submit({position:answer.value,currentTimeMs});return;
  }
 }
 function mount(board){
  toolbar?.remove();const selected=nodes();toolbar=document.createElement('div');toolbar.className='whiteboard-card-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','当前卡片工具');
  const node=selected.length===1?selected[0]:null;toolbar.hidden=!node||node.operation?.type==='depth-explorer';
  if(node&&node.operation?.type!=='depth-explorer'){const buttons=[['focus','聚焦卡片','⌖'],...(node.kind==='image'?[['edit-image','编辑图片','✎']]:node.kind==='video'?[['separate','分离音视频','↙'],['trim','截取视频片段','✂'],['frame','截取关键帧','▣']]:node.kind==='audio'?[['trim','截取音频片段','✂']]:[]),...(!node.file?[['edit','编辑文本','✎']]:[]),['versions','历史版本','◷'],['save-as','保存下载','↓'],['preview','放大预览','⛶'],...(node.reference||node.url?[['open-source','打开来源','↗']]:[])];toolbar.innerHTML=buttons.map(([value,label,glyph])=>`<button type="button" data-board-tool="${value}" title="${label}" aria-label="${label}"><span aria-hidden="true">${originalIcon(value)||glyph}</span>${['edit','separate','trim'].includes(value)?'<span>'+h(label)+'</span>':''}</button>`).join('');toolbar.onclick=e=>{const value=e.target.closest('[data-board-tool]')?.dataset.boardTool;if(!value)return;void action(value,{node}).catch(error=>c.toast(error.message));};board.append(toolbar);position();}
  board.oncontextmenu=menu;depth.mount(board);
 }
 function position(){const selection=nodes(),node=selection.length===1?selection[0]:null,board=document.querySelector('.board');if(!toolbar)return;if(!node||node.operation?.type==='depth-explorer'){toolbar.hidden=true;return;}if(toolbar.hidden||!board)return;const v=canvas().viewport;toolbar.style.left=Math.max(8,Math.min(board.clientWidth-toolbar.offsetWidth-8,(node.x+node.width/2)*v.zoom+v.x-toolbar.offsetWidth/2))+'px';const corner=board.querySelector('.whiteboard-corner-controls'),minTop=corner?corner.offsetTop+corner.offsetHeight+8:8;toolbar.style.top=Math.max(minTop,node.y*v.zoom+v.y-toolbar.offsetHeight-30)+'px';}
 function connectPointer(event){
  event.preventDefault();event.stopPropagation();const port=event.target.closest('[data-connect]'),board=document.querySelector('.board'),source=canvas().nodes.find(n=>n.id===port.dataset.connect);if(!source)return;
  const scope=c.libraryId()+':'+c.current().id,active=()=>scope===c.libraryId()+':'+c.current()?.id;
  const sources=c.selected().has(source.id)?nodes():[source],sourceIds=new Set(sources.map(n=>n.id));
  const side=port.dataset.connectSide||'right',svg=board.querySelector('.edges'),lines=sources.map(n=>{const start=nodeSidePoint(n,side),line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',connectionPath(start,start));line.setAttribute('class','connection-preview');svg.append(line);return {start,line};});
  const removeLines=()=>lines.forEach(({line})=>line.remove());
  const connect=targetId=>sources.filter(n=>canvas().nodes.some(live=>live.id===n.id)&&n.id!==targetId&&!canvas().edges.some(edge=>edge.fromNode===n.id&&edge.toNode===targetId)).map(n=>({id:'edge-'+crypto.randomUUID(),fromNode:n.id,toNode:targetId,fromSide:side}));
  board.setPointerCapture(event.pointerId);
  let candidate=null;
  const ports=[...board.querySelectorAll('[data-connect]')].filter(el=>!sourceIds.has(el.dataset.connect)).map(element=>({element,rect:element.getBoundingClientRect()}));
  const locate=e=>{let nearest=null,distance=38;for(const {element,rect:r} of ports){const d=Math.hypot(e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);if(d<distance){nearest=element;distance=d;}}return nearest;};
  const highlight=port=>{for(const card of board.querySelectorAll('.connection-target'))card.classList.remove('connection-target');for(const el of board.querySelectorAll('.connection-port-target'))el.classList.remove('connection-port-target');candidate=port;if(port){port.closest('[data-node]').classList.add('connection-target');port.classList.add('connection-port-target');}};
  const boardRect=board.getBoundingClientRect(),motion=frameLatest(e=>{if(!active())return cleanup();const r=boardRect,v=canvas().viewport,next=locate(e);if(next!==candidate)highlight(next);const target=candidate&&canvas().nodes.find(n=>n.id===candidate.dataset.connect),end=target?nodeSidePoint(target,candidate.dataset.connectSide):{x:(e.clientX-r.left-v.x)/v.zoom,y:(e.clientY-r.top-v.y)/v.zoom};for(const {start,line}of lines)line.setAttribute('d',connectionPath(start,end));});
  board.onpointermove=e=>motion.push({clientX:e.clientX,clientY:e.clientY});
  const cancel=()=>cleanup(),escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cleanup();}};
  const cleanup=(remove=true)=>{motion.cancel();highlight(null);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',cancel);board.removeEventListener('lostpointercapture',cancel);board.onpointermove=null;board.onpointerup=null;board.onpointercancel=null;if(remove)removeLines();if(board.hasPointerCapture(event.pointerId))board.releasePointerCapture(event.pointerId);};
  document.addEventListener('keydown',escape,true);window.addEventListener('blur',cancel);board.addEventListener('lostpointercapture',cancel);
  board.onpointerup=async e=>{const nearby=locate(e);cleanup(false);const element=document.elementFromPoint(e.clientX,e.clientY),targetPort=nearby||element?.closest('[data-connect]'),targetId=targetPort?.dataset.connect||element?.closest('[data-node]')?.dataset.node;
   if(!active()){removeLines();return;}
   if(targetId){removeLines();if(sourceIds.has(targetId)||!canvas().nodes.some(n=>n.id===targetId))return;const edges=connect(targetId);if(edges.length)mutate(()=>canvas().edges.push(...edges.map(edge=>({...edge,toSide:targetPort?.dataset.connectSide||'left'}))));return;}
   const rect=board.getBoundingClientRect(),v=canvas().viewport;if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom){removeLines();return;}
   const point={x:(e.clientX-rect.left-v.x)/v.zoom,y:(e.clientY-rect.top-v.y)/v.zoom},answer=await contextMenu([item('add-plain','普通卡片'),...(c.generationEnabled()?generateItems():[]),...(c.generationEnabled()&&c.depthEnabled?.()?[item('create-depth','深度摸索')]:[])],e);removeLines();if(answer.value==='cancel'||!active())return;
   try{if(!sources.some(n=>canvas().nodes.some(live=>live.id===n.id)))return;const isDepth=answer.value==='create-depth',channel=answer.value.startsWith('generate-')?answer.value.slice(9):'';if(isDepth&&!c.depthEnabled?.())throw Error('深度摸索插件已停用');mutate(()=>{const fields=isDepth?{name:'深度摸索',text:'',width:420,height:240,operation:{type:'depth-explorer',settings:{quality:'balanced',provider:'auto',invertDepth:false,keepAudio:true}}}:{},node=addTextCard(canvas(),{...point,...fields});Object.assign(node,fields);canvas().edges.push(...connect(node.id).map(edge=>({...edge,toSide:'left'})));if(channel){node.generationIntent={channel};generationCardRatio(node,channel,inheritedMediaRatio(canvas(),node,channel));}c.select([node.id]);});if(channel&&active())await c.generate(channel);await c.flush();}catch(error){c.toast(error.message);}

  };
  board.onpointercancel=()=>cleanup();
 }
 return {mount,position,action,connectPointer,depthMarkup:depth.markup,click:depth.click};
}

export function arrangeCards(nodes,edges,layout='columns'){
 const ids=new Set(nodes.map(n=>n.id)),levels=new Map(nodes.map(n=>[n.id,0]));
 // Bounded relaxation also handles cyclic graphs without hanging the editor.
 for(let i=0;i<Math.min(nodes.length,20);i++){let changed=false;for(const e of edges){if(!ids.has(e.fromNode)||!ids.has(e.toNode))continue;const next=Math.min(nodes.length-1,levels.get(e.fromNode)+1);if(next>levels.get(e.toNode)){levels.set(e.toNode,next);changed=true;}}if(!changed)break;}
 const counts=new Map();for(const n of nodes){const level=levels.get(n.id),row=counts.get(level)||0;counts.set(level,row+1);n.x=60+(layout==='columns'?level:row)*460;n.y=60+(layout==='columns'?row:level)*340;}
}
import {openReferencePicker,readReference} from './reference-picker.js';
import {openBookPicker} from './book-picker.js';
