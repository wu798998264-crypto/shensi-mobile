import {installWorkspacePermissions} from './workspace-permissions.mjs';
import {createDetachedWindowManager} from './detached-windows.mjs';
import {repairProductShortcuts} from './product-shortcuts.mjs';
import {createYunxVideoParser as createVideoParser} from './yunx-video-parser.mjs';
import {createChushouTranscriber} from './chushou-transcriber.mjs';
import * as electron from 'electron';
import { app, BrowserWindow, dialog, shell, safeStorage, ipcMain, session, Tray, Menu, nativeImage, clipboard } from 'electron';
import {createImageFileActions} from './image-files.mjs';
import {createExportFileSaver} from './export-files.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {activateNativeExtensions} from '../../packages/core/src/native-extensions.mjs';
import { installWindowControls } from './window-controls.mjs';
import {desktopStorageDefaults,configureBundledMedia,assertConfiguredStorageAvailable,readDesktopRuntimeConfig,desktopBindingImportSource,adoptDesktopRuntimeBinding} from './runtime-paths.mjs';
import {nodeRuntimeExecutable} from '../../packages/official/legacy/server/node-runtime.mjs';
import {createSystemTray,prepareWorkspaceQuit} from './system-tray.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
app.setName('神思');
if(process.platform==='win32')app.setAppUserModelId('com.shensi.notes');
const defaults=desktopStorageDefaults({root,isPackaged:app.isPackaged,localAppData:process.env.LOCALAPPDATA,appData:app.getPath('appData')});
const configFile=process.env.SHENSI_CORE_CONFIG_FILE||defaults.configFile;
let runtimeConfig={},storageError,configRead,bindingImport;
try{
 const source=desktopBindingImportSource(process.argv);
 if(source){
  if(!app.isPackaged||['SHENSI_CORE_CONFIG_FILE','SHENSI_CORE_DATA_ROOT','SHENSI_CORE_DESKTOP_PROFILE','SHENSI_CORE_PORT'].some(key=>process.env[key]))throw Error('原目录接入只能用于未覆盖启动设置的正式桌面版，未修改配置');
  bindingImport=await adoptDesktopRuntimeBinding(source,configFile);
 }
 runtimeConfig=await readDesktopRuntimeConfig(configFile,{onRead:value=>{configRead=value;}});
}catch(error){storageError=error;}
if(!storageError&&app.isPackaged)try{await assertConfiguredStorageAvailable({...runtimeConfig,...(process.env.SHENSI_CORE_DATA_ROOT?{dataRoot:process.env.SHENSI_CORE_DATA_ROOT}:{}),...(process.env.SHENSI_CORE_DESKTOP_PROFILE?{desktopProfile:process.env.SHENSI_CORE_DESKTOP_PROFILE}:{})});}catch(error){storageError=error;}
const desktopProfile=process.env.SHENSI_CORE_DESKTOP_PROFILE||runtimeConfig.desktopProfile||defaults.desktopProfile;
if(!storageError){await mkdir(desktopProfile,{recursive:true});app.setPath('userData',desktopProfile);}
configureBundledMedia({root,resourcesPath:process.resourcesPath,isPackaged:app.isPackaged});
process.env.SHENSI_NODE_EXECUTABLE=nodeRuntimeExecutable({root,resourcesPath:app.isPackaged?process.resourcesPath:undefined});
let host,win,detachedManager,doubaoWindows,vaultWindows,publisherWindows,syncFetch,systemTray;
const openDetachedWindow=(target,source)=>detachedManager.open(target,source);
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
else {
  app.on('second-instance',()=>systemTray?.show());
  app.whenReady().then(async()=>{
  try {
    if(storageError)throw storageError;
    if(app.isPackaged&&process.platform==='win32')await repairProductShortcuts({shell,desktop:app.getPath('desktop'),startMenu:join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs'),executable:process.execPath,localAppData:process.env.LOCALAPPDATA}).catch(error=>console.warn('启动入口修复：'+error.message));
    const nativeExtensions=await activateNativeExtensions({root,dataRoot:process.env.SHENSI_CORE_DATA_ROOT||runtimeConfig.dataRoot||defaults.dataRoot});
    const [{startServer},{createDoubaoWindows},{createCredentialVaultWindows},{createNovelPublisherWindows},{createNutstoreFetch},{createEmbeddedBrowser}]=await Promise.all([
      import('./server.mjs'),import('./doubao-windows.mjs'),import('./credential-vault-windows.mjs'),import('./novel-publisher-windows.mjs'),import('./nutstore-network.mjs'),import('../../packages/thirdparty/browser/runtime.mjs')
    ]);
    systemTray=createSystemTray({Tray,Menu,nativeImage,logoPath:join(root,'packages/ui/tray-icon.png'),version:app.getVersion(),locale:app.getLocale(),getWindow:()=>win,prepareQuit:async()=>{const saved=await prepareWorkspaceQuit([win,...(detachedManager?.windows||[])]);if(saved===false)return false;await host?.prepareBrowserQuit();return saved;},quit:()=>app.quit(),onError:error=>dialog.showErrorBox('暂未退出神思',error.message)});
    doubaoWindows=createDoubaoWindows({BrowserWindow});vaultWindows=createCredentialVaultWindows({BrowserWindow});publisherWindows=createNovelPublisherWindows({BrowserWindow,session});syncFetch=createNutstoreFetch({session});
    const startupBinding={configFile,configRead,...bindingImport?{bindingImport}:{},isPackaged:app.isPackaged,configuredDataRoot:runtimeConfig.dataRoot||null,configuredDesktopProfile:runtimeConfig.desktopProfile||null,configuredPort:runtimeConfig.port||null,effectiveDataRoot:process.env.SHENSI_CORE_DATA_ROOT||runtimeConfig.dataRoot||defaults.dataRoot,effectiveDesktopProfile:desktopProfile,effectivePort:Number(process.env.SHENSI_CORE_PORT)||Number(runtimeConfig.port)||47932};
    // Paths only; never persist environment variables, credentials or content.
    await writeFile(join(desktopProfile,'notes-startup-binding.json'),JSON.stringify({at:new Date().toISOString(),...startupBinding},null,2));
    const {createElectronReleaseFetch}=await import('../../packages/core/src/release-download.cjs');
    const releaseFetch=createElectronReleaseFetch(electron.net,session.fromPartition('shensi-updates',{cache:false}));
    host=await startServer({updateOptions:{fetchImpl:releaseFetch},port:startupBinding.effectivePort,dataRoot:startupBinding.effectiveDataRoot,configFile,desktop:{startupBinding,browserOwner:()=>win,createBrowser:options=>createEmbeddedBrowser({electron,...options,getHostOrigin:()=>host?.origin}),chushouTranscriber:createChushouTranscriber({BrowserWindow,getOwner:()=>win}),publisher:publisherWindows,vault:vaultWindows,electronExecutable:process.execPath,syncFetch,doubao:doubaoWindows,videoParser:createVideoParser({BrowserWindow,getOwner:()=>win}),
      confirmPublisherRemoval:async account=>{const options={type:'warning',buttons:['取消','移除本插件账号'],defaultId:0,cancelId:0,message:'移除 '+account.platformName+' · '+(account.penName||account.authorLabel||account.note||'未完成登录空间')+'？',detail:'请先保存此账号网页中未保存的编辑。仅移除小说发布插件的本地账号及登录会话，不注销网站账号、不删除网站作品、不影响其他账号。'};const result=win&&!win.isDestroyed()?await dialog.showMessageBox(win,options):await dialog.showMessageBox(options);return result.response===1;},
      openFolder:async path=>{const error=await shell.openPath(path);if(error)throw new Error(error);},
      ...createImageFileActions({dialog,nativeImage,clipboard,getWindow:()=>BrowserWindow.getFocusedWindow()||win,directory:app.getPath('pictures')}),
      saveExportFile:createExportFileSaver({dialog,getWindow:()=>BrowserWindow.getFocusedWindow()||win,directory:app.getPath('documents')}),
      openExternal:async url=>shell.openExternal(url),
      chooseBrowserExecutable:async()=>{const options={title:'选择外部浏览器程序',properties:['openFile'],filters:[{name:'浏览器程序',extensions:process.platform==='darwin'?['app']:['exe']}]},chosen=win&&!win.isDestroyed()?await dialog.showOpenDialog(win,options):await dialog.showOpenDialog(options);return chosen.canceled?'':chosen.filePaths[0];},
      encryptSecret:async value=>{if(!safeStorage.isEncryptionAvailable())throw Error('本机安全凭据存储不可用，未保存密钥');return safeStorage.encryptString(value).toString('base64');},
      decryptSecret:async value=>safeStorage.decryptString(Buffer.from(value,'base64')),
      chooseFolder:async()=>{const result=await dialog.showOpenDialog(win,{properties:['openDirectory'],title:'选择目录'});return result.canceled?'':result.filePaths[0];},
      saveTextFile:async({title,defaultName,text})=>{const name=String(defaultName||'报告.md').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,180)||'报告.md',options={title:String(title||'另存为').slice(0,120),defaultPath:join(app.getPath('documents'),name),filters:[{name:'Markdown',extensions:['md']},{name:'文本文件',extensions:['txt']}]},result=win&&!win.isDestroyed()?await dialog.showSaveDialog(win,options):await dialog.showSaveDialog(options);if(result.canceled||!result.filePath)return {saved:false};await writeFile(result.filePath,String(text),'utf8');return {saved:true,path:result.filePath};},
      restart:()=>setTimeout(()=>{app.relaunch();app.quit();},350)
    }});
    detachedManager=createDetachedWindowManager({BrowserWindow,ipcMain,host,preload:join(root,'apps/desktop/preload.cjs'),getMainWindow:()=>win,confirmClose:async child=>{const answer=await dialog.showMessageBox(child,{type:'warning',buttons:['继续编辑','关闭并保留草稿'],defaultId:0,cancelId:0,message:'此窗口有未保存内容。',detail:'正文草稿已保留；未保存的设置预览会取消。'});if(answer.response===1)child.destroy();}});
    win=new BrowserWindow({width:1440,height:940,minWidth:950,minHeight:680,title:'神思',icon:join(root,'packages/ui/tray-icon.png'),backgroundColor:'#fafafa',frame:false,show:false,skipTaskbar:false,autoHideMenuBar:true,webPreferences:{preload:join(root,'apps/desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
    if(process.platform==='win32')win.setAppDetails({appId:'com.shensi.notes',relaunchDisplayName:'神思',relaunchCommand:`"${process.execPath}"${app.isPackaged?'':` "${join(root,'apps/desktop/main.mjs')}"`}`,...(app.isPackaged?{appIconPath:process.execPath}: {})});
    systemTray.bindWindow(win);
    installWindowControls({ipcMain,window:win,origin:host.origin,onBrowserCommand:host.browserCommand,closeBehavior:'hide-to-tray',subscribeWorkspace:host.service.subscribe,onOpenWindow:openDetachedWindow,onWorkspaceReady:window=>{detachedManager.ready(window);systemTray.workspaceReady(window);},onReturnedTabs:detachedManager.returnedTabs,onAcknowledgeTabReturn:detachedManager.acknowledge});
    if(process.env.SHENSI_CORE_ACCEPTANCE==='1')win.on('page-title-updated',event=>{event.preventDefault();win.setTitle('神思 · 合成验收');});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==host.origin)event.preventDefault();});
    installWorkspacePermissions(win.webContents.session,host.origin);
    await win.loadURL(host.origin);
    await nativeExtensions.healthy();
    systemTray.show();
    console.log(JSON.stringify({event:'core-desktop-ready',url:host.origin,electron:process.versions.electron,plugins:[]}));
    win.webContents.on('will-prevent-unload',async event=>{
      const result=await dialog.showMessageBox(win,{type:'warning',buttons:['继续编辑','关闭并保留正文草稿'],defaultId:0,cancelId:0,message:'尚有未保存的更改。',detail:'返回可保存设置或检查正文。关闭会取消未保存的设置预览；正文草稿将于下次打开时提供恢复。'});
      if(result.response===1)win.destroy();else systemTray?.cancelQuit();
    });
  }catch(error){console.error(JSON.stringify({event:'core-desktop-start-failed',code:error.code||error.name,message:error.message}));dialog.showErrorBox('神思启动失败',error.message);app.quit();}
  });
  app.on('window-all-closed',async()=>{
    // Recovery can open and close a hidden account window before the workspace
    // exists. Its completion must not quit the application during startup.
    if(!win)return;
    await host?.close();await syncFetch?.close();app.quit();
  });
  // Account windows hide on ordinary close. They must not veto app.quit and
  // leave an old backend alive when the user explicitly restarts the desktop.
  let accountSessionsClosed=false,accountSessionsClosing=false;
  app.on('before-quit',event=>{
    systemTray?.beginQuit();
    if(accountSessionsClosed)return;event.preventDefault();if(accountSessionsClosing)return;accountSessionsClosing=true;
    void Promise.all([doubaoWindows?.closeAll(),vaultWindows?.closeAll(),publisherWindows?.closeAll()]).finally(()=>{accountSessionsClosed=true;app.quit();});
  });
  app.on('will-quit',()=>systemTray?.dispose());
}
