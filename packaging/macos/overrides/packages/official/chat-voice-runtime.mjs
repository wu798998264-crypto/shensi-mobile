import {readFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import specs from './chat-voice-payloads.json' with {type:'json'};
export const voicePackageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const voiceResourceRoot=process.resourcesPath&&resolve(voicePackageRoot,'..')===resolve(process.resourcesPath)?process.resourcesPath:join(voicePackageRoot,'resources');
export const hashFile=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
export function voiceProcess(command,args,{cwd,signal,timeoutMs=120000}={}){
 signal?.throwIfAborted();return new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill(),timeoutMs);let out='',err='',aborted=false;
  const abort=()=>{aborted=true;child.kill();};signal?.addEventListener('abort',abort,{once:true});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',v=>{out=(out+v).slice(-16*1024*1024);});child.stderr.on('data',v=>{err=(err+v).slice(-12000);});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  child.once('error',e=>{cleanup();reject(e);});child.once('close',code=>{cleanup();if(aborted)reject(Object.assign(Error('语音操作已停止'),{name:'AbortError'}));else if(code!==0)reject(Error('离线语音运行失败：'+(err.slice(-1200)||'程序超时或异常退出')));else accept({out,err});});
 });
}
export function createVoiceRuntime({root,execute=voiceProcess,platform=process.platform}){
 const memo=new Map();
 async function verify(key){const s=specs[key],folder=join(root,s.folder);for(const [p,sha]of Object.entries(s.files)){if(await hashFile(join(folder,p))!==sha)throw Error('离线语音文件校验失败');}return folder;}
 async function prepare(key,signal){
  signal?.throwIfAborted();if(memo.has(key))return memo.get(key);const promise=(async()=>{
   try{return await verify(key);}catch{}
   const s=specs[key];await mkdir(root,{recursive:true});const archive=join(root,s.archive);
   let valid=false;try{valid=await hashFile(archive)===s.sha256;}catch{}
   if(!valid){const temp=archive+'.'+randomUUID()+'.part';try{await execute(platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32/curl.exe'):'/usr/bin/curl',['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','900','--output',temp,s.url],{signal,timeoutMs:920000});if(await hashFile(temp)!==s.sha256)throw Error('离线语音下载校验未通过，请重试');await rename(temp,archive);}finally{await rm(temp,{force:true}).catch(()=>{});}}
   const stage=join(root,'stage-'+randomUUID());await mkdir(stage);
   try{
    // Extract only fixed upstream entries from a SHA-256 pinned archive. No user paths or globbing.
    await execute(platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32/tar.exe'):'/usr/bin/tar',['-xjf',archive,'-C',stage,...Object.keys(s.files).map(p=>s.folder+'/'+p)],{signal,timeoutMs:180000});
    for(const [p,sha]of Object.entries(s.files))if(await hashFile(join(stage,s.folder,p))!==sha)throw Error('离线语音解包校验失败');
    const folder=join(root,s.folder);try{await rename(folder,folder+'.invalid-'+randomUUID());}catch(e){if(e.code!=='ENOENT')throw e;}await rename(join(stage,s.folder),folder);return folder;
   }finally{await rm(stage,{recursive:true,force:true});}
  })();memo.set(key,promise);try{return await promise;}catch(e){memo.delete(key);throw e;}
 }
 return {async prepare(kind,signal){const runtime=await prepare(platform==='win32'?'win':'mac',signal),model=await prepare(kind,signal);return {runtime,model};}};
}
