import {uiGlyph} from './ui-glyph.js';
export function speechChunks(text,limit=180){
 const parts=[];let rest=String(text).trim();while(rest){let end=Math.min(limit,rest.length);if(end<rest.length){const prefix=rest.slice(0,end),cut=Math.max(...['。','！','？','\n','. ','! ','? ','; ',' '].map(s=>prefix.lastIndexOf(s)));if(cut>=Math.floor(limit/3))end=cut+1;if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;}
  const part=rest.slice(0,end).trim();if(part)parts.push(part);rest=rest.slice(end).trim();}return parts;
}
export async function mountVoiceSettings(target,{api,toast}){
 const call=(action,body)=>api('/api/official/voice/'+action,body),s=await call('status');if(!target.isConnected)return;
 target.innerHTML='<h3>本机离线语音</h3><p>首次按本机配置设置默认状态，之后保留你的选择。模型首次下载，语音和朗读内容仅在本机处理。</p><label class="chat-voice-option"><span>离线语音输入</span><input type="checkbox" data-voice-setting="asr"></label><label class="chat-voice-option"><span>离线朗读</span><input type="checkbox" data-voice-setting="tts"></label><small data-voice-hardware></small><p role="status"></p>';
 target.querySelector('[data-voice-hardware]').textContent=`本机：${s.hardware.memoryGiB} GB 内存，${s.hardware.threads} 个逻辑处理器。建议语音输入 4 GB / 2 线程，朗读 8 GB / 4 线程；可自行调整。`;
 for(const el of target.querySelectorAll('[data-voice-setting]')){el.checked=s[el.dataset.voiceSetting];el.onchange=async()=>{const old=!el.checked;el.disabled=true;try{await call('configure',{[el.dataset.voiceSetting]:el.checked});document.dispatchEvent(new Event('shensi:voice-settings'));target.querySelector('[role=status]').textContent='本机语音设置已保存';}catch(e){el.checked=old;toast(e.message);}finally{el.disabled=false;}};}
}
export function createChatVoiceUI({api,toast,key,input,append}){
 let host,status,record,play,revision=0,statusAt=0,statusFlight;
 const call=(action,body)=>api('/api/official/voice/'+action,body),requestId=()=>crypto.randomUUID();
 function paint(){if(!host?.isConnected)return;const mic=host.querySelector('[data-chat-microphone]');if(mic){mic.disabled=!!input()?.disabled||!status?.asr;mic.innerHTML=uiGlyph(record?'E71A':'E720');mic.title=record?'停止录音或取消识别':status?.asr?'离线语音输入':'请在对话控制设置中启用离线语音输入';mic.setAttribute('aria-label',mic.title);mic.setAttribute('aria-pressed',String(!!record));}
  for(const b of host.querySelectorAll('[data-chat-speak]')){const active=play?.messageId===b.dataset.chatSpeak;b.disabled=!status?.tts;b.innerHTML=uiGlyph(active?'E71A':'E768');b.title=active?'停止朗读':status?.tts?'离线朗读':'请在对话控制设置中启用离线朗读';b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(active));}
  const output=host.querySelector('[data-chat-voice-status]');if(output)output.textContent=record?.label||play?.label||'';
 }
 async function refresh(){if(statusFlight)return statusFlight;statusFlight=call('status').then(s=>{status=s;statusAt=Date.now();if(record&&!s.asr)cancelRecord();if(play&&!s.tts)stopPlayback();paint();}).catch(()=>{}).finally(()=>statusFlight=null);return statusFlight;}
 function cancelRecord(){const job=record;if(!job)return;record=null;job.cancelled=true;clearTimeout(job.timer);job.stream?.getTracks().forEach(t=>t.stop());if(job.recorder?.state==='recording')job.recorder.stop();void call('stop',{requestId:job.id}).catch(()=>{});paint();}
 function stopPlayback(){const job=play;if(!job)return;play=null;job.cancelled=true;job.audio?.pause();job.release?.();if(job.url)URL.revokeObjectURL(job.url);void call('stop',{requestId:job.id}).catch(()=>{});paint();}
 const valid=job=>!job.cancelled&&job.key===key()&&host?.isConnected;
 async function microphone(){
  if(record){if(record.recorder?.state==='recording'){record.label='正在离线识别…';record.recorder.stop();record.stream.getTracks().forEach(t=>t.stop());clearTimeout(record.timer);paint();}else cancelRecord();return;}
  const intent=++revision;await refresh();if(intent!==revision||!status?.asr)return;stopPlayback();const job={id:requestId(),key:key(),label:'准备离线识别，首次需要下载模型…'};record=job;paint();
  try{await call('prepare',{kind:'asr',requestId:job.id});if(!valid(job)||record!==job)return;
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});job.stream=stream;if(!valid(job)||record!==job){stream.getTracks().forEach(t=>t.stop());return;}
   const chunks=[],recorder=new MediaRecorder(stream);job.recorder=recorder;recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   recorder.onerror=()=>{cancelRecord();toast('录音失败，请检查麦克风权限和设备');};
   recorder.onstop=async()=>{clearTimeout(job.timer);stream.getTracks().forEach(t=>t.stop());if(!valid(job)||record!==job)return;job.label='正在离线识别…';paint();try{const blob=new Blob(chunks,{type:recorder.mimeType}),audio=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});const result=await call('transcribe',{requestId:job.id,audio});if(valid(job)&&record===job)await append(result.text,job.key);}catch(e){if(valid(job))toast(e.message);}finally{if(record===job)record=null;paint();}};
   recorder.start();job.label='正在录音，再点话筒结束（最长60秒）';job.timer=setTimeout(()=>{if(record===job)void microphone();},60000);paint();
  }catch(e){job.stream?.getTracks().forEach(t=>t.stop());if(valid(job))toast(e.name==='NotAllowedError'?'麦克风未获授权，请在系统设置中允许神思使用麦克风':e.message);if(record===job)record=null;paint();}
 }
 async function speak(messageId){
  if(play?.messageId===messageId){stopPlayback();return;}const intent=++revision;stopPlayback();cancelRecord();await refresh();if(intent!==revision||!status?.tts)return;
  const field=[...host.querySelectorAll('[data-message-text]')].find(e=>e.dataset.messageText===messageId),parts=speechChunks(field?.value||'');if(!parts.length)return;
  const job={id:requestId(),key:key(),messageId,label:'准备离线朗读，首次需要下载模型…'};play=job;paint();
  try{await call('prepare',{kind:'tts',requestId:job.id});if(!valid(job)||play!==job)return;
   let pending=call('speak',{requestId:job.id,text:parts[0]});
   for(let i=0;i<parts.length;i++){const result=await pending;if(!valid(job)||play!==job)return;const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));job.url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));job.audio=new Audio(job.url);job.label=`正在朗读 ${i+1} / ${parts.length}`;paint();
    // Prepare the next sentence while the current audio is playing, without loading two models at once.
    pending=i+1<parts.length?call('speak',{requestId:job.id,text:parts[i+1]}):null;pending?.catch(()=>{});
    await new Promise((resolve,reject)=>{job.release=resolve;job.audio.onended=resolve;job.audio.onerror=()=>reject(Error('音频播放失败，请检查输出设备'));job.audio.play().catch(reject);});URL.revokeObjectURL(job.url);job.url=null;if(!valid(job)||play!==job)return;
   }
  }catch(e){if(valid(job))toast(e.message);}finally{if(play===job)stopPlayback();}
 }
 function click(event){const b=event.target.closest('[data-chat-microphone],[data-chat-speak]');if(!b)return;event.preventDefault();event.stopImmediatePropagation();if(b.disabled)return;void (b.hasAttribute('data-chat-microphone')?microphone():speak(b.dataset.chatSpeak)).catch(e=>toast(e.message));}
 function cancel(){revision++;cancelRecord();stopPlayback();}
 function bind(body){if(record&&record.key!==key())cancelRecord();if(play&&play.key!==key())stopPlayback();if(host!==body){host?.removeEventListener('click',click,true);host?.removeEventListener('submit',cancel,true);host=body;host.addEventListener('click',click,true);host.addEventListener('submit',cancel,true);}paint();if(Date.now()-statusAt>10000)void refresh();}
 document.addEventListener('shensi:voice-settings',()=>void refresh());window.addEventListener('pagehide',cancel);
 return {bind,cancel,close:()=>{cancel();host?.removeEventListener('click',click,true);host?.removeEventListener('submit',cancel,true);host=null;}};
}
