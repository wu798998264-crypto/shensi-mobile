const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const size=n=>Number.isFinite(n)?(n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB'):'未读取';
function styles(){if(document.querySelector('link[data-nutstore-feedback]'))return;const link=el('link');link.rel='stylesheet';link.dataset.nutstoreFeedback='';link.href=new URL('./nutstore-feedback.css',import.meta.url).href;document.head.append(link);}

// Same controls in desktop and Android. Text content is never interpreted as
// HTML; viewing/dismissing a notice does not resolve or delete anything.
export function openNutstoreConflicts({api,owner=document.body,changed,canResolve=async()=>true,title='坚果云冲突处理',historyEnabled=false}){
 styles();
 const existing=document.querySelector('dialog[data-nutstore-conflicts][open]');if(existing){existing.focus();return existing;}
 const background=[...document.querySelectorAll('dialog[data-nutstore-conflicts]:not([open])')].find(d=>d.dataset.backgroundBusy==='true'&&d.getAttribute('aria-label')===title);if(background){background.showModal();return background;}
 for(const stale of document.querySelectorAll('dialog[data-nutstore-conflicts]:not([open])'))if(stale.dataset.backgroundBusy!=='true')stale.remove();
 const dialog=el('dialog'),header=el('header'),close=el('button','×'),status=el('p'),list=el('section'),batch=el('div');batch.className='sync-conflict-batch';
 dialog.className='nutstore-progress service-dialog';dialog.dataset.nutstoreConflicts='';dialog.setAttribute('aria-label',title);close.type='button';close.setAttribute('aria-label','关闭冲突处理');status.setAttribute('role','status');
 header.append(el('h3',title),close);dialog.append(header,el('p','双方版本均保存到同一文件的历史中，采用的版本作为本机当前版本。不同设备可采用不同版本，不新增同名副本。点击采用即执行；同步删除仍须单独确认。'),batch,status,list);owner.append(dialog);dialog.showModal();close.onclick=()=>dialog.close();dialog.oncancel=()=>{};const mediaUrls=[];dialog.onclose=()=>{if(busy||dialog.open)return;mediaUrls.forEach(url=>URL.revokeObjectURL(url));dialog.remove();};let busy=false,items=[];
 const disabledBefore=new WeakMap();
 const setBusy=value=>{busy=value;dialog.dataset.backgroundBusy=String(value);for(const button of dialog.querySelectorAll('button')){if(button===close)continue;if(value){if(!disabledBefore.has(button))disabledBefore.set(button,button.disabled);button.disabled=true;}else if(disabledBefore.has(button)){button.disabled=disabledBefore.get(button);disabledBefore.delete(button);}}for(const button of batch.querySelectorAll('button'))button.disabled=value||!items.some(item=>eligible(item,button.dataset.batchResolution));};
 const eligible=(item,resolution)=>!['delete_confirmation','delete_modify'].includes(item.reason)&&!item.local?.deleted&&!item.remote?.deleted&&!item.remote?.branches?.some(v=>v.deleted)&&(item.resolutions||['use_remote','use_local']).includes(resolution);
 const resolved=new Set();
 const removeResolved=item=>{resolved.add(JSON.stringify([item.id,item.version]));items=items.filter(v=>v.id!==item.id);for(const row of list.children)if(row.dataset.conflictId===item.id)row.remove();};
 const refresh=async()=>{const errors=[];try{await changed?.();}catch(error){errors.push(error.message);}try{await load();}catch(error){errors.push(error.message);}return errors.length?'版本已保存，界面刷新未完成：'+errors.join('；'):'';};
 for(const [resolution,label]of [['use_remote','全部采用云端'],['use_local','全部采用本地']]){
  const button=el('button',label);button.type='button';button.dataset.batchResolution=resolution;button.disabled=true;batch.append(button);
  button.onclick=async()=>{
   if(busy)return;const selected=items.filter(item=>eligible(item,resolution)),skipped=items.length-selected.length;if(!selected.length)return;setBusy(true);let completed=0;const failed=[];
   try{
    if(!await canResolve())throw Error('请先保存当前编辑，再处理同步冲突');
    for(const [index,item]of selected.entries()){
     status.textContent='正在处理 '+(index+1)+' / '+selected.length+'：'+(item.displayName||item.logicalPath||item.id);
     try{if(!await canResolve())throw Error('请先保存当前编辑，再处理同步冲突');await api('resolve',{conflictId:item.id,expectedVersion:item.version,resolution,preserveLocalChanges:true});completed++;removeResolved(item);}catch(error){failed.push((item.displayName||item.logicalPath||item.id)+'：'+(error.message||'未处理'));}
    }
    const refreshError=completed?await refresh():'';if(dialog.isConnected){status.textContent='已处理 '+completed+' 项'+(failed.length?'；失败 '+failed.length+' 项，双方内容保留：'+failed.join('；'):'')+(skipped?'；'+skipped+' 项删除或其他冲突需单独处理':'')+(refreshError?'；'+refreshError:'');}
   }catch(error){if(dialog.isConnected)status.textContent='已处理 '+completed+' 项；'+error.message;}
   finally{setBusy(false);if(!dialog.open){const notice=createNutstoreNotice({owner});notice.show(status.textContent,failed.length?'error':'success');setTimeout(()=>notice.remove?.(),10000);dialog.onclose();}}
  };
 }
 if(historyEnabled){const history=el('details'),body=el('section');history.append(el('summary','查看同步保留历史（可恢复原文件）'),body);dialog.append(history);history.ontoggle=async()=>{if(!history.open)return;body.textContent='正在读取历史…';try{const result=await api('history');body.replaceChildren();for(const item of result.items||[]){const row=el('section'),view=el('button','预览历史'),restore=el('button','设为当前版本'),text=el('pre');let version;restore.hidden=true;row.append(el('strong',item.displayName||item.logicalPath),el('small',item.modifiedAt||'修改时间未知'),view,restore,text);body.append(row);view.onclick=async()=>{try{const result=await api('history-preview',item);text.textContent=result.sides.map(s=>s.text||'此文件只提供版本信息').join('\n');version=result.version;restore.hidden=false;}catch(e){status.textContent=e.message;}};restore.onclick=()=>{const confirm=el('button','确认恢复（当前内容也保留为历史）');row.append(confirm);confirm.onclick=async()=>{if(busy)return;busy=true;try{if(!await canResolve())throw Error('请先保存当前编辑');await api('history-restore',{logicalPath:item.logicalPath,hash:item.hash,expectedVersion:version});restore.hidden=true;confirm.remove();status.textContent='历史已恢复，替换前内容也已保留';await changed?.();}catch(e){status.textContent=e.message;}finally{busy=false;}};};}if(!result.items?.length)body.textContent='本机尚无冲突保留历史；笔记本文档历史仍在各文档的历史入口。';}catch(e){body.textContent=e.message;}};}
 async function load(){
  status.textContent='正在读取冲突…';const result=await api('conflicts');if(!dialog.isConnected)return;
  items=(Array.isArray(result)?result:result.items||[]).filter(item=>!resolved.has(JSON.stringify([item.id,item.version])));list.replaceChildren();status.textContent=items.length?'发现 '+items.length+' 项待处理冲突':'没有未解决的冲突';
  for(const item of items){
   const row=el('section'),choices=el('div'),confirm=el('div'),preview=el('details'),previewBody=el('div');row.className='nutstore-progress-file';choices.className='sync-conflict-actions';confirm.className='sync-conflict-confirm';row.append(el('strong',item.displayName||item.name||item.logicalPath),el('small',item.logicalPath),el('p',item.message||({both_modified:'本地和云端均有修改',remote_branches:'云端有多个并发版本',delete_modify:'一端已删除，另一端仍有内容',delete_confirmation:'一端已删除，需要确认是否同步删除'}[item.reason]||item.reason)||'本地和云端都有未核对修改'));
   row.append(el('small','本地：'+(item.local?.deleted?'已删除':size(item.local?.size))+' · 云端：'+(item.remote?.deleted?'删除记录':size(item.remote?.size))+(item.remote?.branches?.length?' · '+item.remote.branches.length+' 个并发版本':'')));
   row.dataset.conflictId=item.id;const allowed=item.resolutions||['use_remote','use_local'];
   preview.className='sync-conflict-preview';preview.append(el('summary','预览双方内容与时间'),previewBody);let previewLoaded=false,previewLoading=false;preview.ontoggle=async()=>{if(!preview.open||previewLoaded||previewLoading)return;previewLoading=true;previewBody.textContent='正在读取版本预览…';try{const result=await api('preview',{conflictId:item.id,expectedVersion:item.version});previewBody.replaceChildren();for(const side of result.sides||[]){const part=el('article');part.append(el('h4',side.label||'版本'),el('strong',side.name||item.displayName||item.logicalPath),el('small','修改：'+(side.modifiedAt||'无法确认')+' · 创建：'+(side.createdAt||'无法确认')));part.append(el('pre',side.deleted?'已删除（历史内容仍保留）':side.text||'此文件不提供文字预览，请核对类型、大小和历史版本'));if(side.media&&['image','audio','video'].includes(side.media.kind)&&/^data:(?:image\/(?:png|jpeg|gif|webp)|audio\/(?:mpeg|wav)|video\/(?:mp4|webm));base64,[A-Za-z0-9+/=]+$/.test(side.media.url)){const media=el(side.media.kind==='image'?'img':side.media.kind);const [head,data]=side.media.url.split(','),bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:head.slice(5,-7)}));mediaUrls.push(url);media.src=url;media.alt=side.name||'版本预览';media.controls=true;media.preload='metadata';part.append(media);}previewBody.append(part);}previewLoaded=true;}catch(error){previewBody.textContent=error.message||'预览未读取，未处理冲突';}finally{previewLoading=false;}};row.append(preview);
   for(const [resolution,label]of [['use_remote','采用云端'],['use_local','采用本地'],['delete_both','同步删除'],['restore_live','保留并恢复']]){
    if(!allowed.includes(resolution))continue;const choice=el('button',label);choice.type='button';choice.dataset.resolution=resolution;
    const resolveChoice=async()=>{if(busy)return;setBusy(true);status.textContent='正在保留版本并核对处理结果…';
      try{if(!await canResolve())throw Error('请先保存当前编辑，再处理同步冲突');await api('resolve',{conflictId:item.id,expectedVersion:item.version,resolution,preserveLocalChanges:['use_local','use_remote'].includes(resolution)});removeResolved(item);const refreshError=await refresh();if(dialog.isConnected&&refreshError)status.textContent=refreshError;}
      catch(error){if(dialog.isConnected)status.textContent=error.message||'冲突未解决，双方资料保留';}
      finally{setBusy(false);if(!dialog.open)dialog.onclose();}
    };
    choice.onclick=()=>{
     if(busy)return;
     if(resolution==='use_remote'||resolution==='use_local'){confirm.replaceChildren();void resolveChoice();return;}
     const submit=el('button','确认处理'),cancel=el('button','取消');submit.type=cancel.type='button';submit.dataset.confirmResolution=resolution;
     confirm.replaceChildren(el('p',resolution==='delete_both'?'确认同步删除？其他设备下次同步时也会删除，历史内容仍可恢复。':'保留仍存在的文件；其他设备下次同步时恢复为此版本，双方历史保留。'),submit,cancel);cancel.onclick=()=>confirm.replaceChildren();submit.onclick=resolveChoice;
    };choices.append(choice);
   }
   row.append(choices,confirm);list.append(row);
  }
  setBusy(busy);
 }
 void load().catch(error=>{if(dialog.isConnected)status.textContent=error.message;});return dialog;
}

export function createNutstoreNotice({owner=document.body,onDetails,onConflicts}){
 styles();
 const box=el('aside'),message=el('span'),details=el('button','同步详情'),conflicts=el('button','处理冲突'),close=el('button','×');
 box.className='nutstore-notice';box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.hidden=true;close.setAttribute('aria-label','收起同步提示');for(const b of [details,conflicts,close])b.type='button';box.append(message,details,conflicts,close);owner.append(box);let timer;
 close.onclick=()=>{clearTimeout(timer);box.hidden=true;};
 const invoke=fn=>Promise.resolve().then(()=>fn?.()).catch(error=>show(error.message,'error'));
 details.onclick=()=>void invoke(onDetails);conflicts.onclick=()=>void invoke(onConflicts);
 function show(text,kind='progress'){clearTimeout(timer);message.textContent=text;box.dataset.kind=kind;box.hidden=false;conflicts.hidden=kind!=='conflict'||!onConflicts;details.hidden=!onDetails;if(kind==='success')timer=setTimeout(()=>box.hidden=true,2000);}
 return {show,remove(){clearTimeout(timer);box.remove();}};
}

export function watchNutstoreStatus({api,notice,intervalMs=3000}){
 let timer,closed=false,previous=null,lastConflict='',lastFailure='',lastProgress='';
 const active=s=>['scanning','upload','download','delete_remote','delete_local','applying'].includes(s.phase);
 async function poll(){
  if(closed)return;
  try{const state=await api('status');if(closed)return;
   const conflict=state.conflictCount?JSON.stringify([state.conflictCount,state.conflictRevision||'']):'';
   const failure=state.lastErrorCode?JSON.stringify([state.lastErrorCode,state.retryAt||'']):'';
   const progress=active(state)?JSON.stringify([state.phase,state.progress?.completed||0,state.progress?.total||0]):'';
   if(conflict&&conflict!==lastConflict)notice.show('坚果云有 '+state.conflictCount+' 项冲突，双方内容已保留，请核对处理。','conflict');
   else if(!conflict&&failure&&failure!==lastFailure)notice.show('坚果云同步未完成：'+(state.lastErrorMessage||state.lastErrorCode)+(state.retryAt?'，等待服务恢复后重试':''),'error');
   else if(!conflict&&!failure&&progress&&progress!==lastProgress)notice.show('坚果云同步中 · '+(state.progress?.completed||0)+' / '+(state.progress?.total||0)+' 项','progress');
   else if(!conflict&&!failure&&previous&&state.phase==='completed'&&state.lastSuccessfulSyncAt!==previous.lastSuccessfulSyncAt)notice.show('坚果云同步已完成，文件已校验。','success');
   else if(previous&&active(previous)&&state.paused)notice.show('坚果云同步已暂停，已完成的版本保留。','paused');
   previous=state;lastConflict=conflict;lastFailure=failure;lastProgress=progress;
  }catch(error){if(!closed&&error.code==='PLUGIN_DISABLED'){stop();return;}}
  if(!closed)timer=setTimeout(poll,intervalMs);
 }
 function stop(){closed=true;clearTimeout(timer);notice.remove();}
 void poll();return stop;
}
