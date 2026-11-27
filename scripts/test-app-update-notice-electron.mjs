import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const {NOTES_UPDATE_REPOSITORY:repository}=await import(pathToFileURL(resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.','packages/core/src/update-service.mjs')));
if(!process.versions.electron){
 const {default:electron}=await import('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,[fileURLToPath(import.meta.url)],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);const timer=setTimeout(()=>child.kill(),150000);process.exitCode=(await once(child,'exit'))[0]??1;clearTimeout(timer);
}else{
 const {app,BrowserWindow}=await import('electron'),{startServer}=await import(pathToFileURL(resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.','apps/desktop/server.mjs')));
 const root=await mkdtemp(join(tmpdir(),'shensi-update-ui-')),dataRoot=join(root,'data'),directory=resolve(process.env.SHENSI_TEST_EVIDENCE_DIR||'docs/migration/evidence/app-update-notice-20261103'),checks=[];
 app.setPath('userData',join(root,'profile'));app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{let host,windows=[],passed=false;const errors=[];try{
  const bytes=Buffer.from('synthetic non-executable installer'),hash=createHash('sha256').update(bytes).digest('hex'),url='https://github.com/'+repository+'/releases/download/v0.3.0/ShensiNotes.exe';let checksMade=0,downloads=0,revealed='';
  const updateOptions={currentVersion:'0.2.0',feed:'https://updates.example/manifest',platform:'win32',arch:'x64',fetchImpl:async target=>{if(target==='https://updates.example/manifest'){checksMade++;return Response.json({appId:'shensi-notes',version:'0.3.0',downloads:[{url,platform:'win32',arch:'x64',sha256:hash,sizeBytes:bytes.length}]});}assert.equal(target,url);downloads++;return new Response(bytes);}};
  host=await startServer({dataRoot,updateOptions,desktop:{openFolder:async path=>{revealed=path;}}});
  const open=async()=>{const win=new BrowserWindow({show:false,width:1280,height:860,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});windows.push(win);win.webContents.on('console-message',e=>{if(e.level===3||e.level==='error')errors.push(e.message);});await win.loadURL(host.origin);return win;};
  const wait=async(fn,label)=>{const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,35));}throw Error('等待超时：'+label);},win=await open(),js=code=>win.webContents.executeJavaScript(code);
  await wait(()=>js("!!document.querySelector('.help-button.has-app-update')"),'自动红点');assert.equal(await js("document.querySelector('#about-screen').hidden"),true);assert.equal(downloads,0);
  const badge=await js("(()=>{const s=getComputedStyle(document.querySelector('.help-button'),'::after');return {color:s.backgroundColor,width:s.width,top:s.top,right:s.right};})()");assert.deepEqual(badge,{color:'rgb(229, 72, 77)',width:'7px',top:'1px',right:'1px'});checks.push('启动静默检查后只有问号右上角红点，无自动弹窗或下载');
  const second=await open();await wait(()=>second.webContents.executeJavaScript("!!document.querySelector('.help-button.has-app-update')"),'第二窗口红点');assert.equal(checksMade,1);checks.push('多窗口共享检查状态，打开第二窗口不重复访问更新服务');
  await js("document.querySelector('[data-action=new-note]').click()");await wait(()=>js("!!document.querySelector('.editor')"),'创建合成文档');assert(await js("!!document.querySelector('.help-button.has-app-update')"));checks.push('切换/重绘工作区后红点保留，不干扰文档新建');
  await js("document.querySelector('[data-action=help]').click()");await wait(()=>js("!document.querySelector('#about-screen').hidden"),'软件信息');assert.equal(await js("document.querySelector('[data-about-action=check-update]').textContent"),'更新版本');
  await mkdir(directory,{recursive:true});await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await new Promise(r=>setTimeout(r,120));await writeFile(join(directory,'available.png'),(await win.webContents.capturePage()).toPNG());
  await js("document.querySelector('[data-about-action=check-update]').click();document.querySelector('[data-about-action=check-update]').click()");await wait(()=>js("!document.querySelector('[data-about-action=open-update-folder]').hidden"),'下载校验完成');assert.equal(downloads,1);assert(await js("!!document.querySelector('.help-button.has-app-update')"));assert((await js("document.querySelector('.about-page-status').textContent")).includes('完整性校验'));
  const file=(await readdir(join(dataRoot,'machine','updates'))).find(f=>f.endsWith('.exe'));assert.deepEqual(await readFile(join(dataRoot,'machine','updates',file)),bytes);await js("document.querySelector('[data-about-action=open-update-folder]').click()");await wait(()=>revealed,'打开下载目录');assert.equal(revealed,join(dataRoot,'machine','updates'));checks.push('问号内按钮为更新版本；手动点击下载真实合成文件并校验，重复点击不重复下载、不启动安装');
  for(const w of windows)w.destroy();windows=[];await host.close();host=null;
  host=await startServer({dataRoot,updateOptions:{...updateOptions,currentVersion:'0.3.0'}});const upgraded=await open();await wait(()=>upgraded.webContents.executeJavaScript('globalThis.shensiWorkspaceReady===true'),'新版启动');await wait(()=>checksMade===2,'新版检查');assert.equal(await upgraded.webContents.executeJavaScript("!!document.querySelector('.help-button.has-app-update')"),false);await upgraded.webContents.executeJavaScript("document.querySelector('[data-action=help]').click()");await wait(()=>upgraded.webContents.executeJavaScript("!document.querySelector('#about-screen').hidden"),'新版软件信息');assert.equal(await upgraded.webContents.executeJavaScript("document.querySelector('[data-about-action=check-update]').textContent"),'检查更新');checks.push('同资料目录按新版身份重启后无红点，恢复检查更新按钮；非真实覆盖安装');
  assert.deepEqual(errors,[]);passed=true;checks.forEach(c=>console.log('PASS '+c));
 }catch(error){errors.push(error.stack);console.error(error);process.exitCode=1;}
 finally{for(const w of windows)if(!w.isDestroyed())w.destroy();await host?.close();await mkdir(directory,{recursive:true});await writeFile(join(directory,'electron.json'),JSON.stringify({passed,syntheticOnly:true,realNetworkCalls:0,installedAcceptance:false,installerExecuted:false,checks,errors},null,2));app.exit(process.exitCode||0);}}).catch(e=>{console.error(e);app.exit(1);});
}
