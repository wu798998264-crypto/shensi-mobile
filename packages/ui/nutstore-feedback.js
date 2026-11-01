const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const size=n=>Number.isFinite(n)?(n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB'):'未读取';
function styles(){if(document.querySelector('link[data-nutstore-feedback]'))return;const link=el('link');link.rel='stylesheet';link.dataset.nutstoreFeedback='';link.href=new URL('./nutstore-feedback.css',import.meta.url).href;document.head.append(link);}

// Same controls in desktop and Android. Text content is never interpreted as
// HTML; viewing/dismissing a notice does not resolve or delete anything.
export function openNutstoreConflicts({api,owner=document.body,changed,canResolve=async()=>true}){
 styles();
 const existing=document.querySelector('dialog[data-nutstore-conflicts]');if(existing?.open){existing.focus();return existing;}
 const dialog=el('dialog'),header=el('header'),close=el('button','×'),status=el('p'),list=el('section');
 dialog.className='nutstore-progress service-dialog';dialog.dataset.nutstoreConflicts='';dialog.setAttribute('aria-label','坚果云冲突处理');close.type='button';close.setAttribute('aria-label','关闭冲突处理');status.setAttribute('role','status');
 header.append(el('h3','坚果云冲突处理'),close);dialog.append(header,el('p','先核对双方版本。关闭或稍后处理不会覆盖文件，冲突仍会保留。'),status,list);owner.append(dialog);dialog.showModal();close.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();let busy=false;
 async function load(){
  status.textContent='正在读取冲突…';const result=await api('conflicts');if(!dialog.isConnected)return;
  const items=Array.isArray(result)?result:result.items;list.replaceChildren();status.textContent=items.length?'发现 '+items.length+' 项待处理冲突':'没有未解决的冲突';
  for(const item of items){
   const row=el('section'),choices=el('div'),confirm=el('div');row.className='nutstore-progress-file';row.append(el('strong',item.logicalPath),el('p',item.reason||'本地和云端都有未核对修改'));
   row.append(el('small','本地：'+(item.local?.deleted?'已删除':size(item.local?.size))+' · 云端：'+(item.remote?.deleted?'删除记录':size(item.remote?.size))+(item.remote?.branches?.length?' · '+item.remote.branches.length+' 个并发版本':'')));
   const allowed=item.resolutions||(item.remote?.branches?.length>1?['keep_both','use_local']:['keep_both','use_local','use_remote']);
   for(const [resolution,label]of [['keep_both','保留双方'],['use_local','采用本地'],['use_remote','采用云端']]){
    if(!allowed.includes(resolution))continue;const choice=el('button',label);choice.type='button';choice.dataset.resolution=resolution;
    choice.onclick=()=>{
     if(busy)return;const submit=el('button','确认处理'),cancel=el('button','取消');submit.type=cancel.type='button';submit.dataset.confirmResolution=resolution;
     confirm.replaceChildren(el('p',resolution==='keep_both'?'将保存冲突副本及历史，再继续同步。不会把两份正文自动拼接。':'将按所选版本继续同步。请确认已核对内容，旧版本保留在历史或回收站。'),submit,cancel);cancel.onclick=()=>confirm.replaceChildren();
     submit.onclick=async()=>{if(busy)return;busy=true;const buttons=[...list.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='正在保留版本并核对处理结果…';
      try{if(!await canResolve())throw Error('请先保存当前编辑，再处理同步冲突');await api('resolve',{conflictId:item.id,expectedVersion:item.version,resolution});await changed?.();if(dialog.isConnected)await load();}
      catch(error){if(dialog.isConnected)status.textContent=error.message||'冲突未解决，双方资料保留';}
      finally{busy=false;buttons.forEach(b=>b.disabled=false);}
     };
    };choices.append(choice);
   }
   row.append(choices,confirm);list.append(row);
  }
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
