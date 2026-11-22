import {mkdtemp,copyFile,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {remoteUrl,transferFile} from './video-transfer.mjs';

// Capture the real browser download from the selected song's page. Chromium
// keeps its own request/session; no provider cookies leave the partition.
export async function captureMusicFile(wc,path,{allowTestLoopback,signal,onProgress,onStart}){
 const session=wc.session,limit=1024**3;
 const staging=await mkdtemp(join(tmpdir(),'shensi-audio-')),temporary=join(staging,'song.mp3');
 if(signal?.aborted||wc.isDestroyed()){
  await rm(staging,{recursive:true,force:true});
  signal?.throwIfAborted();
  throw Error('歌曲下载窗口已关闭');
 }
 const partial=path+'.'+staging.slice(-6)+'.tmp';
 let expectedUrl='',active,accepted=false,closed=false,resolveDownload,rejectDownload,stallTimer,recovery,finishedFile=temporary;
 const recoveryController=new AbortController();
 const completed=new Promise((resolve,reject)=>{resolveDownload=resolve;rejectDownload=reject;});
 completed.catch(()=>{});
 const receive=(event,item,source)=>{
  if(source!==wc)return;
  const chain=item.getURLChain();
  if(!expectedUrl||accepted||closed||(chain[0]||item.getURL())!==expectedUrl){event.preventDefault();return;}
  try{
   for(const url of [...chain,item.getURL()])remoteUrl(url,{allowTestLoopback});
   const mime=item.getMimeType().split(';')[0].toLowerCase();
   if(!/^(audio\/|application\/(?:octet-stream|ogg)$)/.test(mime))throw Error('歌曲宝返回的下载项不是音频文件');
   if(item.getTotalBytes()>limit)throw Error('歌曲超过下载大小限制');
   item.setSavePath(temporary);
  }catch(error){event.preventDefault();rejectDownload(error);return;}
  accepted=true;active=item;onStart();let lastBytes=0,stalled=false;
  const retryPublicFile=(stopItem=true)=>{
   if(closed||stalled||signal?.aborted)return;
   stalled=true;clearTimeout(stallTimer);
   const url=item.getURL(),total=item.getTotalBytes(),referer=wc.getURL();
   if(stopItem)item.cancel();
   onProgress({message:'浏览器传输中断，正在重新读取歌曲宝已确认的文件'});
   const dst=join(staging,'confirmed-source');
   const abort=signal?AbortSignal.any([signal,recoveryController.signal]):recoveryController.signal;
   recovery=transferFile(url,dst,{referer,signal:abort,onProgress,useSystemProxy:true,allowTestLoopback}).then(async result=>{
    if(total>0&&result.size!==total)throw Error('歌曲宝重传文件大小与确认项不符');
    abort.throwIfAborted();finishedFile=dst;resolveDownload(result.size);
   }).catch(rejectDownload);
  };
  const watch=()=>{clearTimeout(stallTimer);stallTimer=setTimeout(retryPublicFile,25000);};
  watch();
  item.on('updated',(_event,state)=>{
   if(closed||stalled)return;
   if(state==='interrupted'){retryPublicFile();return;}
   const bytes=item.getReceivedBytes();
   if(bytes>limit){item.cancel();return;}
   if(bytes>lastBytes){lastBytes=bytes;watch();}
   onProgress({message:'正在下载所选歌曲',bytes,total:item.getTotalBytes()});
  });
  item.once('done',(_event,state)=>{
   clearTimeout(stallTimer);
   if(stalled){active=null;return;}
   if(state==='interrupted'&&!closed){retryPublicFile(false);active=null;return;}
   const bytes=item.getReceivedBytes(),total=item.getTotalBytes();active=null;
   if(state!=='completed'||bytes<=0||bytes>limit||(total>0&&bytes!==total)){
    rejectDownload(Error('歌曲宝文件传输未完成'));return;
   }
   resolveDownload(bytes);
  });
 };
 session.on('will-download',receive);
 return {
  awaitingFile(){return !closed&&!accepted;},
  expect(url){expectedUrl=remoteUrl(url,{allowTestLoopback}).href;return expectedUrl;},
  completed,
  async commit(bytes){
   signal?.throwIfAborted();
   if(closed||(await stat(finishedFile)).size!==bytes)throw Error('歌曲下载文件不完整');
   signal?.throwIfAborted();
   try{await rename(finishedFile,path);}catch(error){
    if(error.code!=='EXDEV')throw error;
    await copyFile(finishedFile,partial);signal?.throwIfAborted();await rename(partial,path);
   }
   return JSON.stringify({ok:true,nativeDownload:true});
  },
  async close(){
   closed=true;clearTimeout(stallTimer);recoveryController.abort();session.removeListener('will-download',receive);active?.cancel();
   await recovery;
   await rm(partial,{force:true});
   await rm(staging,{recursive:true,force:true,maxRetries:3,retryDelay:80});
  }
 };
}
