import {cpus,totalmem,freemem} from 'node:os';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {jsonStore,failure} from './store.mjs';
import {createVoiceRuntime,voiceProcess,voiceResourceRoot} from './chat-voice-runtime.mjs';
const GiB=1024**3;
export function voiceHardware({platform=process.platform,arch=process.arch,threads=cpus().length,memory=totalmem(),available=freemem()}={}){
 const supported=platform==='win32'&&arch==='x64'||platform==='darwin'&&['x64','arm64'].includes(arch);
 return {supported,threads,memoryGiB:Math.round(memory/GiB*10)/10,availableGiB:Math.round(available/GiB*10)/10,recommended:{asr:supported&&threads>=2&&memory>=3.8*GiB,tts:supported&&threads>=4&&memory>=7.6*GiB}};
}
export function createChatVoice({dataRoot,requirePlugin,root=join(dataRoot,'machine','chat-voice'),resourceRoot=voiceResourceRoot,execute=voiceProcess,hardware=voiceHardware,runtime=createVoiceRuntime({root:join(root,'models'),execute})}){
 const settings=jsonStore(join(root,'settings.json'),{}),cancelled=new Set();let active,closed=false;
 async function status(){const hw=hardware(),saved=await settings.update(s=>{for(const k of ['asr','tts'])if(typeof s[k]!=='boolean')s[k]=hw.recommended[k];return s;});return {asr:saved.asr,tts:saved.tts,hardware:hw,offline:true};}
 const stop=id=>{if(id){cancelled.add(id);if(cancelled.size>256)cancelled.delete(cancelled.values().next().value);}if(active&&(!id||active.id===id))active.controller.abort();return {stopped:true};};
 async function run(kind,id,operation){
  if(closed)throw failure('语音服务已关闭');if(!/^[a-zA-Z0-9-]{8,80}$/.test(id||''))throw failure('无效语音请求');
  if(cancelled.has(id))throw failure('语音操作已停止','VOICE_STOPPED');
  if(active)throw failure('本机还有一项语音操作，请先停止或等待完成','VOICE_BUSY');
  const s=await status();if(!s[kind])throw failure('请在对话控制设置中启用'+(kind==='asr'?'离线语音输入':'离线朗读'),'VOICE_DISABLED');if(!s.hardware.supported)throw failure('当前平台尚未提供本地语音运行库','VOICE_PLATFORM');
  if(closed||cancelled.has(id))throw failure('语音操作已停止','VOICE_STOPPED');
  if(active)throw failure('本机还有一项语音操作，请先停止或等待完成','VOICE_BUSY');
  const job={id,kind,controller:new AbortController()};active=job;
  try{return await operation(job.controller.signal);}finally{if(active===job)active=null;}
 }
 async function scratch(operation){await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'audio-'));try{return await operation(dir);}finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}}
 async function handle(action,body={}){
  if(action==='status')return status();
  if(action==='configure'){for(const k of Object.keys(body))if(!['asr','tts'].includes(k)||typeof body[k]!=='boolean')throw failure('无效语音设置');await settings.update(s=>({...s,...body}));if(active&&body[active.kind]===false)stop(active.id);return status();}
  if(action==='stop')return stop(body.requestId);
  await requirePlugin('official.conversation-control');
  if(action==='prepare')return run(body.kind,body.requestId,async signal=>{if(!['asr','tts'].includes(body.kind))throw failure('无效语音类型');await runtime.prepare(body.kind,signal);return {ready:true};});
  if(action==='transcribe')return run('asr',body.requestId,async signal=>{
   if(typeof body.audio!=='string'||body.audio.length>6*1024*1024||!body.audio.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio))throw failure('录音为空或过大，请重新录制，单次最长60秒');
   const {runtime:bin,model}=await runtime.prepare('asr',signal);return scratch(async dir=>{
    await writeFile(join(dir,'input'),Buffer.from(body.audio,'base64'));const ffmpeg=process.env.SHENSI_FFMPEG_PATH,ffprobe=process.env.SHENSI_FFPROBE_PATH;if(!ffmpeg||!ffprobe)throw failure('本地音频组件缺失，请修复安装');
    await execute(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i','input','-t','62','-ac','1','-ar','16000','-c:a','pcm_s16le','audio.wav'],{cwd:dir,signal});
    const info=await execute(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-of','json','audio.wav'],{cwd:dir,signal});const duration=Number(JSON.parse(info.out).format?.duration);if(!Number.isFinite(duration)||duration<=0||duration>=62)throw failure('录音时长无效，单次最长60秒');
    // Only relative ASCII paths reach the native ASR CLI on Windows.
    const rel=p=>relative(root,p).replaceAll('\\','/');
    const result=await execute(join(bin,'bin',process.platform==='win32'?'sherpa-onnx-offline.exe':'sherpa-onnx-offline'),['--tokens='+rel(join(model,'tokens.txt')),'--sense-voice-model='+rel(join(model,'model.int8.onnx')),'--sense-voice-use-itn=true','--num-threads=2',rel(join(dir,'audio.wav'))],{cwd:root,signal});
    const raw=JSON.parse(result.out.trim()),text=String(raw.text||'').replace(/<\|[^|]+\|>/g,'').trim();if(!text)throw failure('没有识别出清晰语音，请重录');return {text,duration,offline:true,audioUploaded:false};
   });
  });
  if(action==='speak')return run('tts',body.requestId,async signal=>{
   if(typeof body.text!=='string'||!body.text.trim()||body.text.length>300)throw failure('朗读段落为空或过长');const assets=await runtime.prepare('tts',signal);
   return scratch(async dir=>{await writeFile(join(dir,'request.json'),JSON.stringify({text:body.text}));const python=join(resourceRoot,'chushou-runtime',process.platform==='win32'?'python.exe':'bin/python3');
    const result=await execute(python,['-I','-B','-X','utf8',fileURLToPath(new URL('./chat-voice-tts.py',import.meta.url)),assets.runtime,relative(root,assets.model),join(dir,'request.json'),join(dir,'speech.wav')],{cwd:root,signal,timeoutMs:180000});
    const audio=await readFile(join(dir,'speech.wav'));if(audio.length<44||audio.subarray(0,4).toString()!=='RIFF')throw failure('本地朗读未生成有效音频');return {audio:audio.toString('base64'),...JSON.parse(result.out.trim()),offline:true};
   });
  });
  throw failure('未知语音操作');
 }
 return {handle,close:()=>{closed=true;stop();}};
}
