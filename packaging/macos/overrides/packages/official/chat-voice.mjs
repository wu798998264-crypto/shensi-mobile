import {cpus,totalmem,freemem} from 'node:os';
import {join,relative} from 'node:path';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {jsonStore,failure} from './store.mjs';
import {createVoiceRuntime,voiceProcess} from './chat-voice-runtime.mjs';
const GiB=1024**3;
export function voiceHardware({platform=process.platform,arch=process.arch,threads=cpus().length,memory=totalmem(),available=freemem()}={}){
 const supported=platform==='win32'&&arch==='x64'||platform==='darwin'&&['x64','arm64'].includes(arch);
 return {supported,threads,memoryGiB:Math.round(memory/GiB*10)/10,availableGiB:Math.round(available/GiB*10)/10,recommended:{asr:supported&&threads>=2&&memory>=3.8*GiB}};
}
export function createChatVoice({dataRoot,requirePlugin,root=join(dataRoot,'machine','chat-voice'),execute=voiceProcess,hardware=voiceHardware,runtime=createVoiceRuntime({root:join(root,'models'),execute})}){
 const settings=jsonStore(join(root,'settings.json'),{}),cancelled=new Set();let active,closed=false,settingsReady;
 async function savedSettings(){if(!settingsReady)settingsReady=settings.update(s=>({asr:typeof s.asr==='boolean'?s.asr:hardware().recommended.asr})).catch(e=>{settingsReady=null;throw e;});return settingsReady;}
 async function status(){const saved=await savedSettings();return {asr:saved.asr,hardware:hardware(),offline:true,downloadBytes:runtime.downloadBytes,progress:active?{requestId:active.id,...active.progress,elapsedMs:Date.now()-active.started}:null};}
 const stop=id=>{if(id){cancelled.add(id);if(cancelled.size>256)cancelled.delete(cancelled.values().next().value);}if(active&&(!id||active.id===id))active.controller.abort();return {stopped:true};};
 async function run(id,operation){
  if(closed)throw failure('语音服务已关闭');if(!/^[a-zA-Z0-9-]{8,80}$/.test(id||''))throw failure('无效语音请求');
  if(cancelled.has(id))throw failure('语音操作已停止','VOICE_STOPPED');
  if(active)throw failure('本机还有一项语音操作，请先停止或等待完成','VOICE_BUSY');
  const s=await status();if(!s.asr)throw failure('请在对话控制设置中启用离线语音输入','VOICE_DISABLED');if(!s.hardware.supported)throw failure('当前平台尚未提供本地语音运行库','VOICE_PLATFORM');
  if(closed||cancelled.has(id))throw failure('语音操作已停止','VOICE_STOPPED');
  if(active)throw failure('本机还有一项语音操作，请先停止或等待完成','VOICE_BUSY');
  const job={id,controller:new AbortController(),started:Date.now(),progress:{stage:'checking'}};active=job;
  try{return await operation(job.controller.signal,p=>{if(active===job)job.progress=p;});}finally{if(active===job)active=null;}
 }
 async function scratch(operation){await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'audio-'));try{return await operation(dir);}finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}}
 async function handle(action,body={}){
  if(action==='status')return status();
  if(action==='configure'){for(const k of Object.keys(body))if(k!=='asr'||typeof body[k]!=='boolean')throw failure('无效语音设置');await savedSettings();settingsReady=settings.update(s=>({asr:body.asr??s.asr})).catch(e=>{settingsReady=null;throw e;});await settingsReady;if(active&&body.asr===false)stop(active.id);return status();}
  if(action==='stop')return stop(body.requestId);
  if(action==='speak'||action==='prepare'&&body.kind!=='asr')throw failure('对话朗读已移除，请使用离线语音输入','VOICE_UNSUPPORTED');
  await requirePlugin('official.conversation-control');
  if(action==='prepare')return run(body.requestId,async(signal,onProgress)=>{await runtime.prepare('asr',signal,onProgress);return {ready:true};});
  if(action==='transcribe')return run(body.requestId,async(signal,onProgress)=>{
   if(typeof body.audio!=='string'||body.audio.length>6*1024*1024||!body.audio.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio))throw failure('录音为空或过大，请重新录制，单次最长60秒');
   const {runtime:bin,model}=await runtime.prepare('asr',signal,onProgress);onProgress({stage:'converting'});return scratch(async dir=>{
    await writeFile(join(dir,'input'),Buffer.from(body.audio,'base64'));const ffmpeg=process.env.SHENSI_FFMPEG_PATH,ffprobe=process.env.SHENSI_FFPROBE_PATH;if(!ffmpeg||!ffprobe)throw failure('本地音频组件缺失，请修复安装');
    await execute(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i','input','-t','62','-ac','1','-ar','16000','-c:a','pcm_s16le','audio.wav'],{cwd:dir,signal,timeoutMs:20000});
    const info=await execute(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-of','json','audio.wav'],{cwd:dir,signal,timeoutMs:10000});const duration=Number(JSON.parse(info.out).format?.duration);if(!Number.isFinite(duration)||duration<=0||duration>=62)throw failure('录音时长无效，单次最长60秒');onProgress({stage:'recognizing'});
    // Only relative ASCII paths reach the native ASR CLI on Windows.
    const rel=p=>relative(root,p).replaceAll('\\','/');
    const result=await execute(join(bin,'bin',process.platform==='win32'?'sherpa-onnx-offline.exe':'sherpa-onnx-offline'),['--tokens='+rel(join(model,'tokens.txt')),'--sense-voice-model='+rel(join(model,'model.int8.onnx')),'--sense-voice-use-itn=true','--num-threads=2',rel(join(dir,'audio.wav'))],{cwd:root,signal,timeoutMs:60000});
    const raw=JSON.parse(result.out.trim()),text=String(raw.text||'').replace(/<\|[^|]+\|>/g,'').trim();if(!text)throw failure('没有识别出清晰语音，请重录');return {text,duration,offline:true,audioUploaded:false};
   });
  });
  throw failure('未知语音操作');
 }
 return {handle,close:()=>{closed=true;stop();}};
}
