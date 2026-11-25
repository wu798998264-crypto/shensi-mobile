import {mkdir,rename,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import specs from './chat-voice-payloads.json' with {type:'json'};
export const voicePackageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const voiceResourceRoot=process.resourcesPath&&resolve(voicePackageRoot,'..')===resolve(process.resourcesPath)?process.resourcesPath:join(voicePackageRoot,'resources');
export const hashFile=async(p,signal)=>{signal?.throwIfAborted();const h=createHash('sha256');for await(const b of createReadStream(p)){signal?.throwIfAborted();h.update(b);}return h.digest('hex');};
export function voiceProcess(command,args,{cwd,signal,timeoutMs=120000}={}){
 signal?.throwIfAborted();return new Promise((accept,reject)=>{
  let timedOut=false;const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);let out='',err='',aborted=false;
  const abort=()=>{aborted=true;child.kill();};signal?.addEventListener('abort',abort,{once:true});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',v=>{out=(out+v).slice(-16*1024*1024);});child.stderr.on('data',v=>{err=(err+v).slice(-12000);});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  child.once('error',e=>{cleanup();reject(e);});child.once('close',code=>{cleanup();if(aborted)reject(Object.assign(Error('语音操作已停止'),{name:'AbortError'}));else if(timedOut)reject(Object.assign(Error('离线语音处理超时，请重试较短的录音'),{code:'VOICE_TIMEOUT'}));else if(code!==0)reject(Error('离线语音运行失败：'+(err.slice(-1200)||'程序异常退出')));else accept({out,err});});
 });
}
export function createVoiceRuntime({root,execute=voiceProcess,platform=process.platform}){
 const memo=new Map();
 async function verify(s,signal){const folder=join(root,s.folder);for(const [p,sha]of Object.entries(s.files)){if(await hashFile(join(folder,p),signal)!==sha)throw Error('离线语音文件校验失败');}return folder;}
 async function prepare(key,signal,onProgress){
  signal?.throwIfAborted();if(memo.has(key))return memo.get(key);const promise=(async()=>{
   const s=specs[key],emit=(stage,details={})=>onProgress({stage,component:key==='asr'?'识别模型':'识别运行组件',part:key==='asr'?2:1,parts:2,...details});
   emit('checking');
   // Preserve already downloaded 0.0.49 runtimes; only new installs fetch the smaller ASR-only build.
   for(const candidate of [s,s.legacy].filter(Boolean)){try{return await verify(candidate,signal);}catch{signal?.throwIfAborted();}}
   await mkdir(root,{recursive:true});const archive=join(root,s.archive);
   let valid=false;try{valid=await hashFile(archive,signal)===s.sha256;}catch{signal?.throwIfAborted();}
   if(!valid){
    const temp=archive+'.'+randomUUID()+'.part',started=Date.now();let tracking=true;
    const tick=async()=>{const downloaded=Math.min(s.bytes,(await stat(temp).catch(()=>({size:0}))).size),seconds=Math.max(1,(Date.now()-started)/1000);if(tracking)emit('downloading',{downloadedBytes:downloaded,totalBytes:s.bytes,percent:downloaded/s.bytes*100,bytesPerSecond:downloaded/seconds});};
    await tick();const timer=setInterval(()=>void tick(),300);
    try{
     try{await execute(platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32/curl.exe'):'/usr/bin/curl',['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','900','--speed-time','60','--speed-limit','1024','--output',temp,s.url],{signal,timeoutMs:920000});}
     catch(error){signal?.throwIfAborted();throw Object.assign(Error(s.label+'下载失败或连接超时，请检查网络后重试'),{code:'VOICE_DOWNLOAD_FAILED',cause:error});}
     await tick();tracking=false;clearInterval(timer);emit('verifying');
     if(await hashFile(temp,signal)!==s.sha256)throw Error('离线语音下载校验未通过，请重试');await rename(temp,archive);
    }finally{tracking=false;clearInterval(timer);await rm(temp,{force:true}).catch(()=>{});}
   }
   const stage=join(root,'stage-'+randomUUID());await mkdir(stage);
   try{
    signal?.throwIfAborted();emit('extracting');
    // Extract only fixed upstream entries from a SHA-256 pinned archive. No user paths or globbing.
    await execute(platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32/tar.exe'):'/usr/bin/tar',['-xjf',archive,'-C',stage,...Object.keys(s.files).map(p=>s.folder+'/'+p)],{signal,timeoutMs:180000});
    emit('verifying');for(const [p,sha]of Object.entries(s.files))if(await hashFile(join(stage,s.folder,p),signal)!==sha)throw Error('离线语音解包校验失败');
    const folder=join(root,s.folder);try{await rename(folder,folder+'.invalid-'+randomUUID());}catch(e){if(e.code!=='ENOENT')throw e;}await rename(join(stage,s.folder),folder);await rm(archive,{force:true}).catch(()=>{});return folder;
   }finally{await rm(stage,{recursive:true,force:true});}
  })();memo.set(key,promise);try{return await promise;}catch(e){memo.delete(key);throw e;}
 }
 return {downloadBytes:specs[platform==='win32'?'win':'mac'].bytes+specs.asr.bytes,async prepare(kind,signal,onProgress=()=>{}){if(kind!=='asr')throw Error('仅支持离线语音输入');const runtime=await prepare(platform==='win32'?'win':'mac',signal,onProgress),model=await prepare('asr',signal,onProgress);signal?.throwIfAborted();onProgress({stage:'ready',percent:100});return {runtime,model};}};
}
