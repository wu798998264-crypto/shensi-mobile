import {uiGlyph} from './ui-glyph.js';
export function voiceProgressLabel(p={}){
 const elapsed=Math.max(0,Math.floor((p.elapsedMs||0)/1000)),time=elapsed>=60?Math.floor(elapsed/60)+'分'+elapsed%60+'秒':elapsed+'秒';
 if(p.stage==='downloading'){
  const done=Math.max(0,p.downloadedBytes||0),total=Math.max(1,p.totalBytes||1),speed=Math.max(0,p.bytesPerSecond||0);
  const eta=speed>0&&elapsed>=5&&done>=1e6?Math.ceil(Math.max(0,total-done)/speed):null;
  return '下载'+p.component+'（'+p.part+'/'+p.parts+'）'+Math.min(100,done/total*100).toFixed(0)+'% · '+(done/1e6).toFixed(1)+' / '+(total/1e6).toFixed(1)+' MB · '+(speed>0?(speed/1e6).toFixed(2)+' MB/s':'等待网络响应')+' · 已用'+time+(eta>0?' · 预计剩余'+(eta>=60?Math.ceil(eta/60)+'分钟':eta+'秒'):'');
 }
 const names={checking:'正在检查已有模型',extracting:'正在解包',verifying:'正在校验',ready:'识别模型已就绪',converting:'正在处理录音',recognizing:'正在离线识别'};
 return (names[p.stage]||'正在准备离线识别')+(p.component?' · '+p.component:'')+' · 已用'+time;
}
export async function mountVoiceSettings(target,{api,toast}){
 const call=(action,body)=>api('/api/official/voice/'+action,body),s=await call('status');if(!target.isConnected)return;
 target.innerHTML='<h3>本机离线语音输入</h3><p data-voice-description></p><label class="chat-voice-option"><span>离线语音输入转文字</span><input type="checkbox" data-voice-setting="asr"></label><small data-voice-hardware></small><p role="status"></p>';
 target.querySelector('[data-voice-description]').textContent='首次使用需下载约'+Math.ceil((s.downloadBytes||189000000)/1e6)+' MB识别模型与运行组件，准备过程显示进度。之后在本机离线识别，录音不上传。首次按本机配置设置开关，之后保留你的选择。';
 target.querySelector('[data-voice-hardware]').textContent='本机：'+s.hardware.memoryGiB+' GB内存，'+s.hardware.threads+'个逻辑处理器。建议4 GB内存 / 2线程，可自行开启或关闭。';
 const el=target.querySelector('[data-voice-setting=asr]');el.checked=s.asr;el.onchange=async()=>{const old=!el.checked;el.disabled=true;try{await call('configure',{asr:el.checked});document.dispatchEvent(new Event('shensi:voice-settings'));target.querySelector('[role=status]').textContent='本机语音设置已保存';}catch(e){el.checked=old;toast(e.message);}finally{el.disabled=false;}};
}
export function createChatVoiceUI({api,toast,key,input,append}){
 let host,status,record,revision=0,statusAt=0,statusFlight,listening=false;
 const call=(action,body)=>api('/api/official/voice/'+action,body),requestId=()=>crypto.randomUUID();
 function paint(){
  if(!host?.isConnected)return;
  const mic=host.querySelector('[data-chat-microphone]');if(mic){mic.disabled=!record&&(!!input()?.disabled||!status?.asr);mic.innerHTML=uiGlyph('E720');mic.title=record?.phase==='recording'?'结束录音并转文字':record?'取消本次语音输入':status?.asr?'离线语音输入':'请在对话控制设置中启用离线语音输入';mic.setAttribute('aria-label',mic.title);mic.setAttribute('aria-pressed',String(!!record));mic.dataset.voicePhase=record?.phase||'';}
  const output=host.querySelector('[data-chat-voice-status]');if(!output)return;output.replaceChildren();output.removeAttribute('title');
  if(!record)return;
  const label=document.createElement('span'),elapsed=Math.floor((Date.now()-record.started)/1000),p=record.progress;output.title=record.preparing||record.phase==='recognizing'?voiceProgressLabel(p||{stage:record.phase==='recognizing'?'recognizing':undefined,elapsedMs:Date.now()-record.started}):record.label+' · '+elapsed+'秒';
  label.textContent=record.preparing?(p?.stage==='downloading'?Math.max(0,Math.min(100,p.percent||0)).toFixed(0)+'% · '+p.component:({checking:'检查模型',extracting:'解包模型',verifying:'校验模型',ready:'模型已就绪'}[p?.stage]||'准备识别模型')):record.phase==='recognizing'?(p?.stage==='converting'?'处理录音':'离线识别')+' · 已用'+elapsed+'秒':record.phase==='recording'?'正在录音 · '+elapsed+'秒':record.label;output.append(label);
  if(record.preparing||record.phase==='recognizing'){const bar=document.createElement('progress');bar.max=100;bar.setAttribute('aria-label',record.preparing?'离线识别模型准备进度':'录音转文字进度');bar.dataset.voiceProgress='';const p=record.progress;if(p?.stage==='downloading')bar.value=Math.max(0,Math.min(100,p.percent||0));else if(p?.stage==='ready'&&record.preparing)bar.value=100;output.append(bar);}
 }
 async function refresh(){if(statusFlight)return statusFlight;statusFlight=call('status').then(s=>{status=s;statusAt=Date.now();if(record&&!s.asr)cancelRecord();if(record&&(record.preparing||record.phase==='recognizing')&&s.progress?.requestId===record.id)record.progress=s.progress;paint();}).catch(()=>{}).finally(()=>statusFlight=null);return statusFlight;}
 function clearJob(job){clearTimeout(job.timer);clearTimeout(job.poll);clearTimeout(job.finishTimer);clearInterval(job.clock);job.stream?.getTracks().forEach(t=>t.stop());}
 function cancelRecord(){const job=record;if(!job)return;record=null;job.cancelled=true;clearJob(job);job.rejectWait?.(Object.assign(Error('语音输入已取消'),{name:'AbortError'}));if(job.recorder?.state==='recording')job.recorder.stop();void call('stop',{requestId:job.id}).catch(()=>{});paint();}
 async function bounded(job,pending,ms,message){let timer;try{return await Promise.race([pending,new Promise((_,reject)=>{job.rejectWait=reject;timer=setTimeout(()=>{void call('stop',{requestId:job.id}).catch(()=>{});reject(Error(message));},ms);})]);}finally{clearTimeout(timer);job.rejectWait=null;}}
 const valid=job=>!job.cancelled&&job.key===key()&&host?.isConnected;
 async function watchPreparation(job){await refresh();if(valid(job)&&record===job&&(job.preparing||job.phase==='recognizing')){paint();job.poll=setTimeout(()=>void watchPreparation(job),400);}}
 function finishRecording(job){if(job.phase!=='recording')return;job.phase='finalizing';job.started=Date.now();job.label='正在结束录音…';clearTimeout(job.timer);job.finishTimer=setTimeout(()=>{if(record===job&&job.phase==='finalizing'){cancelRecord();toast('录音设备未能结束，请重新录制');}},5000);try{job.recorder.stop();}catch(error){cancelRecord();toast(error.message);}paint();}
 async function microphone(){
  if(record){if(record.phase==='recording')finishRecording(record);else cancelRecord();return;}
  const intent=++revision;await refresh();if(intent!==revision||!status?.asr)return;
  const job={id:requestId(),key:key(),label:'准备离线识别…',phase:'preparing',preparing:true,started:Date.now()};record=job;job.clock=setInterval(paint,500);paint();void watchPreparation(job);
  try{
   await call('prepare',{kind:'asr',requestId:job.id});job.preparing=false;clearTimeout(job.poll);if(!valid(job)||record!==job)return;
   job.phase='permission';job.label='正在请求麦克风权限…';paint();
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});job.stream=stream;if(!valid(job)||record!==job){stream.getTracks().forEach(t=>t.stop());return;}
   const chunks=[],recorder=new MediaRecorder(stream);job.recorder=recorder;recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   recorder.onerror=()=>{cancelRecord();toast('录音失败，请检查麦克风权限和设备');};
   recorder.onstop=async()=>{clearTimeout(job.timer);clearTimeout(job.finishTimer);stream.getTracks().forEach(t=>t.stop());if(!valid(job)||record!==job)return;job.phase='recognizing';job.started=Date.now();job.progress=null;job.label='正在离线识别…';paint();void watchPreparation(job);try{const blob=new Blob(chunks,{type:recorder.mimeType});if(!blob.size)throw Error('没有收到录音，请检查麦克风后重试');const audio=await bounded(job,blob.arrayBuffer(),10000,'读取录音超时，请重新录制');if(!valid(job)||record!==job)return;const bytes=new Uint8Array(audio);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const result=await bounded(job,call('transcribe',{requestId:job.id,audio:btoa(binary)}),95000,'录音识别超时，已停止本次识别，请尝试较短的录音');if(valid(job)&&record===job){record=null;clearJob(job);paint();await append(result.text,job.key);}}catch(e){if(valid(job))toast(e.message);}finally{clearJob(job);if(record===job)record=null;paint();}};
   recorder.start(250);job.phase='recording';job.started=Date.now();job.label='正在录音（最长60秒）';job.timer=setTimeout(()=>{if(record===job)finishRecording(job);},60000);paint();
  }catch(e){clearJob(job);if(valid(job))toast(e.name==='NotAllowedError'?'麦克风未获授权，请在系统设置中允许神思使用麦克风':e.message);if(record===job)record=null;paint();}
 }
 function click(event){const b=event.target.closest('[data-chat-microphone]');if(!b)return;event.preventDefault();event.stopImmediatePropagation();if(!b.disabled)void microphone().catch(e=>toast(e.message));}
 function cancel(){revision++;cancelRecord();}
 function bind(body){if(!listening){document.addEventListener('shensi:voice-settings',onSettings);window.addEventListener('pagehide',cancel);listening=true;}if(record&&record.key!==key())cancelRecord();if(host!==body){host?.removeEventListener('click',click,true);host?.removeEventListener('submit',cancel,true);host=body;host.addEventListener('click',click,true);host.addEventListener('submit',cancel,true);}paint();if(Date.now()-statusAt>10000)void refresh();}
 const onSettings=()=>void refresh();
 return {bind,cancel,close:()=>{cancel();host?.removeEventListener('click',click,true);host?.removeEventListener('submit',cancel,true);document.removeEventListener('shensi:voice-settings',onSettings);window.removeEventListener('pagehide',cancel);listening=false;host=null;}};
}
