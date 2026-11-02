export const notebookSyncScopeText='同一笔记本保留一个当前版本。同步本机已有笔记本的正文、白板、提示词与参考顺序、受管理的图音视频及完整历史；先核对云端再上传，冲突和删除需确认。云端新笔记本首次下载仍需手动选择；暂不含PDF等普通附件、工作区附件、插件配置和账号凭据。';

export function mountNotebookAutoSwitch(parent,{status,configure,onError=()=>{}}){
 const label=document.createElement('label'),check=document.createElement('input'),hint=document.createElement('small');
 check.type='checkbox';check.setAttribute('aria-label','双端笔记本自动同步');label.className='setting-inline';label.append(check,document.createTextNode('自动同步（应用运行时）'));parent.append(label,hint);
 async function refresh(){try{const state=await status();check.checked=!!state.enabled;check.disabled=!state.available;hint.textContent=state.enabled?'已开启；编辑时暂停，离线后恢复重试，冲突不会强制覆盖。':'仅对当前设备和账号生效。';}catch(e){check.disabled=true;hint.textContent=e.message;}}
 check.onchange=async()=>{check.disabled=true;try{await configure(check.checked);document.dispatchEvent(new Event('shensi:auto-sync-changed'));}catch(e){onError(e);hint.textContent=e.message;}finally{await refresh();}};
 void refresh();return {refresh};
}

// One foreground pump serializes BOTH providers. No background Android service
// is claimed: on resume/online the next safe idle cycle continues the journal.
export function startNotebookAutoSync({clients,canRun,changed,onError=()=>{},interval=60000}){
 let timer,closed=false,running=false,lastError='';
 const safe=()=>!closed&&!document.hidden&&navigator.onLine!==false&&canRun()&&!document.querySelector('dialog[open]');
 async function run(){
  clearTimeout(timer);if(closed||running)return;running=true;
  try{if(!safe())return;for(const client of clients){if(!safe())break;try{
   const status=await client.status();if(!status.enabled)continue;if(!safe())break;
   const result=await client.tick();const failed=result?.results?.filter(row=>row.status!=='completed')||[];
   if(failed.length){const message=failed.map(row=>row.error||'存在待确认的同步冲突').join('；');if(message!==lastError){lastError=message;onError(Error(message));}}
   else if(!result?.skipped)lastError='';
   if(safe()&&result?.results?.some(row=>!row.deferred&&row.status==='completed'))await changed?.();
  }catch(error){if(error.message!==lastError){lastError=error.message;onError(error);}}}}
  finally{running=false;if(!closed)timer=setTimeout(run,interval);}
 }
 const wake=()=>{if(!running){clearTimeout(timer);timer=setTimeout(run,1500);}};
 for(const type of ['online','pageshow'])window.addEventListener(type,wake);
 document.addEventListener('visibilitychange',wake);document.addEventListener('shensi:auto-sync-changed',wake);
 timer=setTimeout(run,1500);
 return ()=>{closed=true;clearTimeout(timer);for(const type of ['online','pageshow'])window.removeEventListener(type,wake);document.removeEventListener('visibilitychange',wake);document.removeEventListener('shensi:auto-sync-changed',wake);};
}
