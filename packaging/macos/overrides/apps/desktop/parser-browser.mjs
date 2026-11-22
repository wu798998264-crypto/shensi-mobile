import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {lookup} from 'node:dns/promises';
import {remoteUrl,publicAddress} from './video-transfer.mjs';
import {captureMusicFile} from './music-file-transfer.mjs';

const pageGate=`(()=>{const text=(document.body?.innerText||'').slice(0,12000);return /verify you are human|security verification|验证您是真人|请完成人机验证|安全验证|人机验证|人工验证|captcha|cloudflare/i.test(text)?'verification':/登录后查看|登录后继续|请先登录/.test(text)?'login':''})()`;
const failure=(message,code)=>Object.assign(Error(message),{code});
function extractionGate(result){try{const value=typeof result==='string'?JSON.parse(result):result;return value?.ok===false?value.reason:'';}catch{return '';}}

// Only bundled parser code can supply scripts. Website content stays in a sandbox
// with an ephemeral partition, without access to any logged-in browser profile.
export function createParserBrowser({BrowserWindow,allowTestLoopback=false}={}){
 const windows=new Set(),sessions=new Map(),musicWindows=new Map();
 async function extract({url,ready,inspectPage,extract,scripts=[],timeout=40000,key=randomUUID(),manualVerification,musicFile,onProgress=()=>{}},{signal}={}){
  if(!BrowserWindow)throw Object.assign(Error('此网站需要桌面解析浏览器，请在桌面软件中重试'),{code:'PARSER_BROWSER_REQUIRED'});
  remoteUrl(url,{allowTestLoopback});signal?.throwIfAborted();
  if(!/^[a-z0-9-]{1,80}$/i.test(key))throw Error('解析浏览器身份无效');
  const parked=inspectPage?musicWindows.get(key):undefined;
  if(parked)musicWindows.delete(key);
  const reuse=parked&&!parked.isDestroyed();
  const win=reuse?parked:new BrowserWindow({show:false,width:1280,height:900,webPreferences:{partition:'parser-'+key,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const wc=win.webContents,session=wc.session;
  sessions.set(key,session);
  let succeeded=false;
  let terminalError,timer,waiting=false,verificationDeadline,checkingDeadline,visibleGate='',capture,approvedDownloadUrl,showingDownload=false;
  const normalTimeout=Math.min(60000,Math.max(1000,Number(timeout)||40000)),verificationTimeout=Math.min(600000,Math.max(1000,Number(manualVerification?.timeoutMs)||600000));
  const title=String(manualVerification?.title||'神思 · 网站验证');
  windows.add(win);const close=()=>{windows.delete(win);if(!win.isDestroyed())win.destroy();};signal?.addEventListener('abort',close,{once:true});
  const check=()=>{signal?.throwIfAborted();if(terminalError)throw terminalError;if(win.isDestroyed())throw failure('验证页面已关闭，本次解析下载已取消','PARSER_BROWSER_CLOSED');};
  const notify=(value,message)=>{try{Promise.resolve(onProgress({message,manualVerification:{id:key,waiting:value}})).catch(()=>{});}catch{}};
  const arm=(ms,error)=>{clearTimeout(timer);timer=setTimeout(()=>{terminalError=error;close();},ms);};
  const beginVerification=(gate='verification',userInput=false)=>{
   if(!manualVerification)throw failure('网站要求人工验证，未自动绕过；请稍后重新解析','PARSER_VERIFICATION_REQUIRED');
   if(waiting&&visibleGate===gate)return;
   const automatic=gate==='checking';
   if(automatic)checkingDeadline??=Date.now()+Math.min(45000,verificationTimeout);
   else verificationDeadline??=Date.now()+verificationTimeout;
   const first=!waiting;
   waiting=true;visibleGate=gate;
   const deadline=automatic?checkingDeadline:verificationDeadline;
   arm(Math.max(1,deadline-Date.now()),automatic?failure('歌曲宝的安全检查未放行，尚未取得歌曲页面','PARSER_SITE_CHECK_TIMEOUT'):failure('等待人工验证超时，本次下载已停止；请重新发起任务','PARSER_VERIFICATION_TIMEOUT'));
   if(first){
    win.setTitle(title);
    if(win.isMinimized())win.restore();
    win.show();
    if(!win.isVisible())win.show();
    win.moveTop();win.focus();
   }
   notify(true,automatic?'音乐站仍在安全检查，已打开原网页。如网站提示操作，请在该页完成，任务会自动继续':userInput?'已收到网页操作，正在等待歌曲宝返回结果':'音乐站需要人工验证，请在弹出的页面手动完成；完成后会自动继续下载和任务');
  };
  const endVerification=completed=>{if(!waiting)return;waiting=false;if(!win.isDestroyed())win.hide();notify(false,completed?'验证通过，正在继续原任务':'人工验证等待已结束');};
  const downloadTitle='神思 · 歌曲宝普通下载';
  const setTitle=event=>{if(waiting||showingDownload){event.preventDefault();win.setTitle(waiting?title:downloadTitle);}};
  win.on('page-title-updated',setTitle);
  const log=stage=>{if(process.env.SHENSI_PARSER_DIAGNOSTICS==='1')console.log('parser-browser: '+stage);};
  let onClosed;
  const closed=new Promise((_,reject)=>{onClosed=()=>reject(signal?.reason||terminalError||failure('验证页面已关闭，本次解析下载已取消','PARSER_BROWSER_CLOSED'));win.once('closed',onClosed);});
  let accessDenied=false,arrived=false;
  const navigation=(_event,address,status)=>{
   accessDenied=status===403;
   try{
    const actual=new URL(address),expected=new URL(url);
    const correctHost=actual.origin===expected.origin||(allowTestLoopback&&actual.hostname==='127.0.0.1');
    arrived=correctHost&&actual.pathname.replace(/\/$/,'')===expected.pathname.replace(/\/$/,'');
   }catch{arrived=false;}
  };
  const userInteraction=(_event,input)=>{if(waiting&&visibleGate==='checking'&&['mouseDown','keyDown'].includes(input.type))beginVerification('verification',true);};
  arm(normalTimeout+5000,failure('解析网页等待超时，请检查链接或稍后重试','PARSER_BROWSER_NO_RESULT'));log('created');
  async function readPage(){
   const cache=new Map(),proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;wc.setAudioMuted(true);
   wc.setWindowOpenHandler(({url})=>{
    if(approvedDownloadUrl&&url===approvedDownloadUrl){
     approvedDownloadUrl=undefined;
     setImmediate(()=>{if(!win.isDestroyed()&&!signal?.aborted&&capture?.awaitingFile())wc.downloadURL(url);});
    }
    return {action:'deny'};
   });
   wc.session.setPermissionRequestHandler((_w,_p,reply)=>reply(false));
   if(musicFile)capture=await captureMusicFile(wc,musicFile,{allowTestLoopback,signal,onProgress,onStart:()=>{
    arm(300000,failure('歌曲宝文件传输超时','MUSIC_TRANSFER_TIMEOUT'));
   }});
   if(!reuse&&!allowTestLoopback){
    if(inspectPage)await wc.session.setProxy({mode:'system'});
    else if(proxy)await wc.session.setProxy({proxyRules:proxy});
   }
   wc.session.webRequest.onBeforeRequest({urls:['<all_urls>']},(request,reply)=>{
    if(/^(data|blob):/.test(request.url))return reply({cancel:false});
    try{const u=remoteUrl(request.url,{allowTestLoopback});if(allowTestLoopback)return reply({cancel:false});let check=cache.get(u.hostname);if(!check){check=lookup(u.hostname,{all:true}).then(list=>list.length>0&&list.every(a=>publicAddress(a.address)||proxy&&/^198\.(18|19)\./.test(a.address))).catch(()=>false);cache.set(u.hostname,check);}void check.then(ok=>reply({cancel:!ok}));}catch{reply({cancel:true});}
   });
   if(!reuse)await win.loadURL('about:blank');log('blank-ready');
   if(scripts.length){
    wc.debugger.attach('1.3');await wc.debugger.sendCommand('Page.enable');
    for(const script of scripts)if(typeof script==='string')await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:script});
   }
   if(inspectPage){
    // A provider's HTTP 403 document belongs to the user. Resume page
    // automation only after the provider itself serves a successful navigation.
    wc.on('did-navigate',navigation);
    wc.on('before-mouse-event',userInteraction);wc.on('before-input-event',userInteraction);
   }
   let navigationError;void win.loadURL(url).then(()=>log('loaded')).catch(e=>navigationError=e);log('navigating');
   const deadline=Date.now()+normalTimeout;let reason,checkingSince;
   while(waiting||Date.now()<deadline){check();
    let state,downloadReady=false;
    try{
     if(inspectPage&&accessDenied){reason='checking';state=false;}
     else if(inspectPage&&!arrived){reason='';state=false;}
     else if(inspectPage){const snapshot=await wc.executeJavaScript(inspectPage);reason=snapshot.gate;state=snapshot.ready;downloadReady=snapshot.downloadReady;}
     else reason=await wc.executeJavaScript(pageGate);
    }catch{await pause(250,undefined,{signal});continue;}check();
    if(inspectPage&&reason==='login')throw failure('音乐站要求登录后继续','PARSER_LOGIN_REQUIRED');
    if(reason==='checking'){
     if(!checkingSince){checkingSince=Date.now();onProgress({message:'音乐站正在进行安全检查，完成后自动继续'});}
     if(manualVerification&&!waiting&&Date.now()-checkingSince>=8000)beginVerification('checking');
     await pause(250,undefined,{signal});continue;
    }
    checkingSince=undefined;
    if(reason==='verification')beginVerification();
    else{
     if(!inspectPage){try{state=await wc.executeJavaScript(ready);}catch{}}check();
     if(state===true||state==='true'){
      if(capture){
       endVerification(true);
       if(downloadReady&&!showingDownload){
        showingDownload=true;win.setTitle(downloadTitle);win.show();if(!win.isVisible())win.show();win.focus();
        onProgress({message:'歌曲宝普通下载正在排队，请保持原网页打开，完成后自动返回白板'});
       }
       arm(normalTimeout+5000,failure('歌曲宝未开始普通下载','MUSIC_DOWNLOAD_TIMEOUT'));
      }
      let result;
      try{
       const action=wc.executeJavaScript(extract);
       result=capture?await Promise.race([action,capture.completed]):await action;
      }catch(error){if(inspectPage&&!win.isDestroyed()&&wc.isLoadingMainFrame())continue;throw error;}check();
      if(capture&&typeof result==='number')return capture.commit(result);
      if(capture&&result?.ok&&result.confirmUrl){
       approvedDownloadUrl=capture.expect(result.confirmUrl);
       const confirm=`(()=>{const a=[...document.querySelectorAll('a[data-normal-download]')].find(el=>el.getClientRects().length&&el.href===${JSON.stringify(approvedDownloadUrl)});if(!a||a.closest('[hidden],[inert],[aria-disabled=true],[aria-busy=true]'))return false;a.click();return true})()`;
       if(await Promise.race([wc.executeJavaScript(confirm),capture.completed])===false)throw failure('普通下载链接已变化，请重新选择','MUSIC_DOWNLOAD_CHANGED');
       return capture.commit(await capture.completed);
      }
      if(capture&&result?.ok&&result.pending)throw failure('歌曲宝未提供可确认的普通下载文件','MUSIC_DOWNLOAD_NO_FILE');
      if(capture&&result?.ok&&result.href){
       wc.downloadURL(capture.expect(result.href));
       return capture.commit(await capture.completed);
      }
      // A challenge can arrive between the readiness check and extraction.
      const gate=extractionGate(result);
      if(gate==='human-verification')beginVerification();
      else if(inspectPage&&gate==='checking'){await pause(250,undefined,{signal});continue;}
      else if(inspectPage&&gate==='login')throw failure('音乐站要求登录后继续','PARSER_LOGIN_REQUIRED');
      else{endVerification(true);return typeof result==='string'?result:JSON.stringify(result);}
     }
    }
    await pause(250,undefined,{signal});
   }
   check();
   if(reason==='checking')throw failure('音乐站安全检查超时，请稍后重试','PARSER_SITE_CHECK_TIMEOUT');
   throw Object.assign(Error(reason==='verification'?'网站要求人工验证，未自动绕过；请稍后重新解析':reason==='login'?'网站要求登录后查看，当前公开链接不可直接下载':navigationError?'解析网页加载失败：'+(navigationError.code||navigationError.message):'网页未返回可下载的公开内容（等待 '+Math.round(timeout/1000)+' 秒）；请检查链接是否有效或稍后重新解析'),{code:reason==='verification'?'PARSER_VERIFICATION_REQUIRED':reason==='login'?'PARSER_LOGIN_REQUIRED':'PARSER_BROWSER_NO_RESULT'});
  }
  try{const result=await Promise.race([readPage(),closed]);succeeded=true;return result;}
  catch(error){check();throw error;}
  finally{
   clearTimeout(timer);signal?.removeEventListener('abort',close);endVerification(false);
   win.removeListener('closed',onClosed);win.removeListener('page-title-updated',setTitle);
   wc.removeListener('did-navigate',navigation);wc.removeListener('before-mouse-event',userInteraction);wc.removeListener('before-input-event',userInteraction);
   try{await capture?.close();}finally{
    if(inspectPage&&succeeded&&!signal?.aborted&&!win.isDestroyed()&&sessions.get(key)===session&&!musicWindows.has(key)){
     win.hide();musicWindows.set(key,win);
    }else close();
   }
  }
 }
 const reset=key=>{const session=sessions.get(key);sessions.delete(key);const win=musicWindows.get(key);musicWindows.delete(key);if(win){windows.delete(win);if(!win.isDestroyed())win.destroy();}void session?.clearStorageData().catch(()=>{});};
 return {extract,reset,close(){for(const win of windows)if(!win.isDestroyed())win.destroy();windows.clear();for(const key of sessions.keys())reset(key);}};
}
