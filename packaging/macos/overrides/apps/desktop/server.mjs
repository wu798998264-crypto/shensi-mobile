import { createServer } from 'node:http';
import {editingResponse} from '../../packages/ui/workspace-view.js';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { randomBytes,randomInt } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCoreService } from '../../packages/core/src/service.mjs';
import {createAssetCatalog} from '../../packages/core/src/asset-catalog.mjs';
import {createSettingsService,configuredDataRoot,defaultRuntimeConfig} from '../../packages/core/src/settings-service.mjs';
import {previewDesktopSecrets} from './preview-secrets.mjs';
import {createPluginHost} from '../../packages/core/src/plugins.mjs';
import {calendarPackage} from '../../packages/thirdparty/calendar/package.mjs';
import {createPluginMarketplaceClient,usesMarketplaceUpdates} from '../../packages/core/src/plugin-marketplace.mjs';
import {createOfficialHost} from '../../packages/official/host.mjs';
import {createNotesUpdateService,NOTES_PACKAGE_VERSION} from '../../packages/core/src/update-service.mjs';
import {checkPluginUpdate,installNativeExtensionUpdate} from '../../packages/core/src/plugin-updates.mjs';
import {createPluginUpdateService} from '../../packages/core/src/plugin-update-service.mjs';
import {createPublicExtensionCatalog,publicExtensionId} from '../../packages/core/src/public-extension-catalog.mjs';
import {createConsoleService} from '../../packages/core/src/whiteboard-content.mjs';
import {configureBundledMedia} from './runtime-paths.mjs';
import {exportDocuments} from '../../packages/core/src/document-export.mjs';
import {documentImageAction} from './image-files.mjs';
import {nativeExtensionRuntime,nativeExtensionBytes} from '../../packages/core/src/native-extensions.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const uiRoot=join(root,'packages/ui');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
export async function startServer({port=0,dataRoot,configFile,desktop={},officialOptions={},marketplaceOptions={},updateOptions={},pluginUpdateOptions={}}={}) {
  configureBundledMedia({root,resourcesPath:process.resourcesPath});
  const service=await createCoreService({dataRoot:dataRoot||await configuredDataRoot(configFile)});
  const updates=createNotesUpdateService({dataRoot:service.dataRoot,...updateOptions});
  const assets=createAssetCatalog(service);
  const settings=createSettingsService({service,configFile,desktop});
  const withOfficial=process.env.SHENSI_CORE_BUNDLED_PLUGINS!=='0';
  const plugins=createPluginHost({service,platform:marketplaceOptions.platform||'desktop',bundledPackages:withOfficial?[await calendarPackage()]:[]});
  await plugins.installBundled();
  const consoles=createConsoleService(service);
  const official=withOfficial?createOfficialHost({service,desktop,consoleService:consoles,extensions:plugins,...officialOptions}):null;
  if(official){plugins.setModelService(official.models);await official.startRuntime();}
  const rawPlugins=async()=>{const runtime=nativeExtensionRuntime(),native=runtime?.dataRoot===service.dataRoot?await runtime.snapshot():null;return [...official?await official.list():[],...await plugins.list()].map(p=>{const active=native?.active[p.id],pending=native?.pending[p.id],installed=native?.installed[p.id],removed=p.installed===false&&p.nativeUninstalledVersion;return {...p,...active?{version:active.version,updateChannel:{...p.updateChannel,currentVersion:active.version}}:{},...installed&&!removed?{nativeInstalledVersion:installed.version,nativeUpdateError:native.lastError}:{},...pending&&!removed?{pendingVersion:pending.version,restartRequired:true}:{},...removed?{nativeAvailableVersion:pending?.version||installed?.version||active?.version||''}:{}};});};
  const allPlugins=async()=>pluginUpdates?pluginUpdates.decorate(await rawPlugins()):rawPlugins();
  const pluginSummaries=rows=>rows.map(p=>{if(!p.package?.files)return p;const {files,...metadata}=p.package;return {...p,package:metadata};});
  let pluginUpdates;
  const publicCatalog=marketplaceOptions.publicCatalog||(!marketplaceOptions.fetchImpl&&!pluginUpdateOptions.fetchImpl?createPublicExtensionCatalog():null);
  const marketplace=createPluginMarketplaceClient({service,models:official?.models,plugins,allPlugins,publicCatalog,beforeReplace:id=>official?.stopExternalProvider(id),afterReplace:id=>official?.models.unblockProvider(id),...marketplaceOptions});
  pluginUpdates=createPluginUpdateService({dataRoot:service.dataRoot,list:rawPlugins,check:async p=>{if(publicCatalog&&publicExtensionId(p.id))try{const result=await publicCatalog.check(p);if(result?.status!=='unavailable')return result;}catch{}return usesMarketplaceUpdates(p)?marketplace.handle('check-update',{pluginId:p.id}):checkPluginUpdate(p,pluginUpdateOptions);}});
  let activeApi=0,activeTaskStarts=0,migrationPending=false;const eventStreams=new Set(),latestChanges=new Map();const unsubscribeChanges=service.subscribe(change=>latestChanges.set(change.id,change));
  if(!(await service.list()).length)await service.create();
  await service.skillDocumentation.ensure();
  await service.skillDocumentation.mergeDuplicateLibraries();
  for(const record of await plugins.list())if(record.enabled&&record.package?.format==='shensi-skill-plugin-v1')await service.skillDocumentation.sync({sourceId:record.id,pluginId:record.id,name:record.name,version:record.version,files:record.package.files,skills:record.package.skills,titles:Object.fromEntries(record.package.skills.map(s=>[s.entry,s.name]))});
  let historyCleanupFlight=null,historyCleanupStatus={};
  const cleanupHistory=()=>historyCleanupFlight??=(async()=>{try{const record=await settings.readPreferences(),result=await service.cleanupHistory({months:record.preferences?.historyRetentionMonths??3});historyCleanupStatus={...result,checkedAt:new Date().toISOString()};return historyCleanupStatus;}catch(error){historyCleanupStatus={error:error.message,checkedAt:new Date().toISOString()};throw error;}finally{historyCleanupFlight=null;}})();
  // Opening the workspace must not wait for every notebook's complete history.
  // Retention still runs after startup and hourly through the same transaction.
  const startupHistoryTimer=setTimeout(()=>{void cleanupHistory().catch(error=>console.error('历史清理失败：'+error.message));},15000);startupHistoryTimer.unref();
  const historyTimer=setInterval(()=>{void cleanupHistory().catch(error=>console.error('历史清理失败：'+error.message));},60*60*1000);historyTimer.unref();
  const token=randomBytes(32).toString('hex');let origin='';
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(res.editingView?editingResponse(value):value));};
  const server=createServer(async(req,res)=>{
    res.editingView=req.headers['x-shensi-view']==='editing';
    let counted=false,taskStartCounted=false;
    try {
      if(req.headers.host!==new URL(origin).host){send(res,403,{message:'Invalid host'});return;}
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      const splitPane=new URL(req.url,origin).pathname==='/'&&new URL(req.url,origin).searchParams.get('pane')==='1';
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors "+(splitPane?"'self'":"'none'")+"; form-action 'self'");
      const url=new URL(req.url,origin),p=url.pathname;
      if(p.startsWith('/api/')) {
        if(req.headers['x-shensi-token']!==token && !(['/api/asset','/api/recycle/asset','/api/official/chat/music-audio'].includes(p) && req.method==='GET' && url.searchParams.get('token')===token)){send(res,403,{message:'Session denied'});return;}
        if(req.headers.origin && req.headers.origin!==origin){send(res,403,{message:'Origin denied'});return;}
        if((migrationPending||settings.migrationComplete)&&!['/api/settings/info','/api/settings/restart'].includes(p))return send(res,423,{message:'数据已准备迁移，请重启应用后继续编辑',code:'RESTART_REQUIRED'});
        if(p==='/api/workspace-events'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(': connected\n\n');eventStreams.add(res);const unsubscribe=service.subscribe(event=>res.write('data: '+JSON.stringify(event)+'\n\n'));const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),25000);res.on('close',()=>{clearInterval(heartbeat);unsubscribe();eventStreams.delete(res);});return;}
        activeApi++;counted=true;
        if(req.method==='POST'&&(/^\/api\/official\/(?:chat\/(?:submit|send|supplement)|selection\/start|works\/tools\/run|depth\/run|media\/submit)$/.test(p)||p==='/api/plugins/execute')){activeTaskStarts++;taskStartCounted=true;}
        let body={};
        if(req.method==='POST') {let total=0,chunks=[];for await(const chunk of req){total+=chunk.length;if(total>80*1024*1024)throw Object.assign(new Error('文件超过 80 MB 限制'),{code:'TOO_LARGE'});chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}
        const id=url.searchParams.get('id')||body.id;
        if(p==='/api/workspace-revision'&&req.method==='GET')return send(res,200,{event:latestChanges.get(id)||null});
        if(p==='/api/workspace-state-stamp'&&req.method==='GET')return send(res,200,await service.stateStamp(id));
        if(p==='/api/open-link' && req.method==='POST'){
          const invalid=()=>Object.assign(new Error('链接地址无效：请使用完整的 HTTP、HTTPS 网址或邮件链接，且不能包含账号密码'),{code:'INVALID_LINK'});
          let target;try{if(typeof body.url!=='string'||!body.url.trim())throw invalid();target=new URL(body.url.trim());}catch{throw invalid();}
          if(!['https:','http:','mailto:'].includes(target.protocol)||target.username||target.password)throw invalid();
          if(desktop.openExternal)await desktop.openExternal(target.href);
          return send(res,200,{opened:!!desktop.openExternal,url:target.href});
        }
        if(p==='/api/bootstrap' && req.method==='GET')return send(res,200,{libraries:await service.list(),plugins:pluginSummaries(await allPlugins()),version:NOTES_PACKAGE_VERSION,capabilities:['explicit-history','create-document','template-plugins',...withOfficial?['official-plugins']:[]],dataRoot:service.dataRoot,...await settings.readPreferences()});
        if(p.startsWith('/api/official/')&&p!=='/api/official/chat/music-audio'&&official)return send(res,200,await official.handle(p.slice('/api/official'.length),req.method==='GET'?Object.fromEntries(url.searchParams):body));
        if(p==='/api/plugins' && req.method==='GET'){const rows=await allPlugins();return send(res,200,{plugins:url.searchParams.get('summary')==='1'?pluginSummaries(rows):rows});}
        if(p.startsWith('/api/plugins/marketplace/'))return send(res,200,await marketplace.handle(p.slice('/api/plugins/marketplace/'.length),req.method==='GET'?Object.fromEntries(url.searchParams):body));
        if(p==='/api/plugins/check-update' && req.method==='POST')return send(res,200,await pluginUpdates.check(body.pluginId));
        if(p==='/api/plugins/install-update' && req.method==='POST'){
          const activeRuntime=nativeExtensionRuntime(),runtime=activeRuntime?.dataRoot===service.dataRoot?activeRuntime:null;
          const plugin=(await allPlugins()).find(p=>p.id===body.pluginId)||(body.pluginId==='thirdparty.calendar'?{id:body.pluginId,version:'0.1.0',category:'third-party',available:true,installed:false}:null);
          if(publicCatalog&&publicExtensionId(plugin?.id)){const result=await publicCatalog.install(plugin,body,{runtime,plugins});if(plugin.available&&plugin.id!=='thirdparty.calendar')await official?.update(body.pluginId==='thirdparty.local-h3'?{pluginId:body.pluginId,enabled:false}:{pluginId:body.pluginId,install:true,enabled:true});return send(res,200,result);}
          if(!runtime)throw Error('请在已更新的神思桌面版中安装此扩展');
          return send(res,200,await installNativeExtensionUpdate(plugin,body,{...pluginUpdateOptions,runtime}));
        }
        if(p==='/api/plugins/extensions' && req.method==='GET')return send(res,200,await plugins.extensions());
        if(p==='/api/plugins/install' && req.method==='POST'){
          if(body.package?.format==='shensi-native-extension-v1'){
            const runtime=nativeExtensionRuntime();if(!runtime||runtime.dataRoot!==service.dataRoot)throw Error('请在已更新的神思桌面版中安装此扩展');
            const result=await runtime.install(body),plugin=official&&(await official.list()).find(p=>p.id===body.package.id);if(plugin?.available)await official.update(plugin.id==='thirdparty.local-h3'?{pluginId:plugin.id,enabled:false}:{pluginId:plugin.id,install:true,enabled:true});return send(res,200,result);
          }
          return send(res,200,body.package?.format==='shensi-managed-plugin-v1'&&official?await official.installManagedPackage(body):await plugins.install({package:body.package,category:body.category,grantFullAccess:body.grantFullAccess,replace:body.replace,expectedVersion:body.expectedVersion}));
        }
        if(p==='/api/plugins/update' && req.method==='POST'){if(body.pluginId==='thirdparty.credential-vault')body.pluginId='thirdparty.browser';if(plugins.isBundled(body.pluginId))return send(res,200,{...await plugins.update(body),plugins:await allPlugins()});const builtin=official&&(await official.list()).some(p=>p.id===body.pluginId);if(!builtin&&official&&(body.enabled===false||body.uninstall||body.settings))await official.stopExternalProvider(body.pluginId);const result=builtin?await official.update(body):await plugins.update(body);if(!builtin&&official&&body.enabled!==false&&!body.uninstall)official.models.unblockProvider(body.pluginId);return send(res,200,{...result,plugins:await allPlugins()});}
        if(p==='/api/plugins/execute' && req.method==='POST')return send(res,200,await plugins.execute(body));
        if(p==='/api/settings/preferences' && req.method==='GET')return send(res,200,await settings.readPreferences());
        if(p==='/api/settings/check-update' && req.method==='POST')return send(res,200,await updates.check({automatic:body.automatic===true}));
        if(p==='/api/settings/update-status' && req.method==='GET')return send(res,200,updates.snapshot());
        if(p==='/api/settings/download-update' && req.method==='POST')return send(res,200,body.background?updates.startDownload():await updates.download());
        if(p==='/api/settings/open-update-folder' && req.method==='POST')return send(res,200,await updates.reveal(desktop.openFolder));
        if(p==='/api/settings/preferences' && req.method==='POST')return send(res,200,await settings.savePreferences(body));
        if(p==='/api/settings/info' && req.method==='GET')return send(res,200,{...await settings.info(id),version:NOTES_PACKAGE_VERSION,plugins:await allPlugins()});
        if(p==='/api/settings/open-folder' && req.method==='POST')return send(res,200,await settings.openFolder(body));
        if(p==='/api/settings/choose-folder' && req.method==='POST')return send(res,200,await settings.chooseFolder());
        if(p==='/api/save-text-file' && req.method==='POST'){
          const text=String(body.text??'');if(Buffer.byteLength(text,'utf8')>16*1024*1024)throw Object.assign(new Error('另存内容不能超过 16 MB'),{code:'TOO_LARGE'});
          const request={title:String(body.title||'另存为').slice(0,120),defaultName:String(body.defaultName||'报告.md').slice(0,240),text};
          return send(res,200,desktop.saveTextFile?await desktop.saveTextFile(request):{saved:false,unsupported:true});
        }
        if(p==='/api/settings/import-preview' && req.method==='POST')return send(res,200,await settings.previewImport(body));
        if(p==='/api/settings/import-apply' && req.method==='POST')return send(res,200,await settings.applyImport(body));
        if(p==='/api/settings/migration-preview' && req.method==='POST')return send(res,200,await settings.previewMigration(body));
        if(p==='/api/settings/migration-apply' && req.method==='POST'){
          if(activeApi>1)return send(res,409,{message:'仍有保存或读取正在进行，请稍后重新预览',code:'BUSY'});
          migrationPending=true;try{return send(res,200,await settings.applyMigration(body));}finally{migrationPending=false;}
        }
        if(p==='/api/settings/restart' && req.method==='POST')return send(res,200,settings.restart());
        if(p==='/api/library' && req.method==='POST')return send(res,200,await service.create(body.name));
        if(p==='/api/directory/recycle'&&req.method==='POST')return send(res,200,await service.recycleDirectory(id,body));
        if(p==='/api/library/trash'&&req.method==='GET')return send(res,200,{entries:await service.notebookRecycle.list()});
        if(p==='/api/library/archive'&&req.method==='POST'){
          if(activeTaskStarts)throw Object.assign(Error('仍有任务正在提交，请稍后重试'),{code:'BUSY'});
          const result=await service.notebookRecycle.archive(id,{expectedStateStamp:body.expectedStateStamp,assertIdle:notebookId=>official?.assertNotebookIdle(notebookId)});
          if(!(await service.list()).length)await service.create();
          return send(res,200,{...result,libraries:await service.list()});
        }
        if(p==='/api/library/trash/restore'&&req.method==='POST')return send(res,200,{...await service.notebookRecycle.restore(body.trashId),libraries:await service.list()});
        if(p==='/api/library/trash/permanent'&&req.method==='POST')return send(res,200,await service.notebookRecycle.permanent(body.trashId));
        if(p==='/api/skills'&&req.method==='GET')return send(res,200,await service.skills.catalog());
        if(p==='/api/skills/read'&&req.method==='POST')return send(res,200,await service.skills.read(body));
        if(p==='/api/settings/skills'&&req.method==='POST')return send(res,200,await service.skills.configure(body));
        if(p==='/api/references' && req.method==='GET')return send(res,200,await service.referenceIndex());
        if(p==='/api/state' && req.method==='GET')return send(res,200,await service.load(id));
        if(p==='/api/state' && req.method==='POST')return send(res,200,await service.save(id,body));
        if(p==='/api/state/resolve-local' && req.method==='POST')return send(res,200,await service.resolveLocalDraft(id,body));
        if(p==='/api/documents/export'&&req.method==='POST'){
          const exported=await exportDocuments(service,body);
          if(body.saveToFile===true&&desktop.saveExportFile){const {base64,...metadata}=exported;return send(res,200,{...metadata,...await desktop.saveExportFile(exported)});}
          return send(res,200,exported);
        }
        if(p==='/api/documents/move'&&req.method==='POST'){if(activeTaskStarts)throw Error('仍有生成任务正在提交，请稍后移动');await official?.assertNotebookIdle(id);if(body.targetId!==id)await official?.assertNotebookIdle(body.targetId);return send(res,200,await service.moveDocuments(body));}
        if(p==='/api/document' && req.method==='POST')return send(res,200,await service.createDocument(id,body));
        if(p==='/api/board/content' && req.method==='POST')return send(res,200,await consoles.content(body));
        if(p==='/api/board/content/edit' && req.method==='POST')return send(res,200,await consoles.handle('edit',body));
        if(p==='/api/board/content/version' && req.method==='POST')return send(res,200,await consoles.handle('version',body));
        if(p==='/api/directory-history/save' && req.method==='POST')return send(res,200,await service.saveDirectoryVersion(id,body));
        if(p==='/api/directory-history/restore' && req.method==='POST')return send(res,200,await service.restoreDirectoryVersion(id,body));
        if(p==='/api/history/save' && req.method==='POST')return send(res,200,await service.saveVersion(id,body));
        if(p==='/api/history/delete' && req.method==='POST')return send(res,200,await service.deleteHistory(id,body));
        if(p==='/api/history/cleanup' && req.method==='POST')return send(res,200,await cleanupHistory());
        if(p==='/api/board/media/edit' && req.method==='POST')return send(res,200,await service.editMedia(id,body));
        if(p==='/api/board/assets' && req.method==='GET')return send(res,200,await assets.list());
        if(p==='/api/board/assets/import' && req.method==='POST')return send(res,200,await assets.importAsset(body));
        if(p==='/api/board/assets/replace' && req.method==='POST')return send(res,200,await assets.replace(body));
        if(p==='/api/board/assets/remove' && req.method==='POST')return send(res,200,await assets.remove(body));
        if(p==='/api/board/assets/land' && req.method==='POST')return send(res,200,await assets.land(body));
        if(p==='/api/board/assets/trash' && req.method==='POST')return send(res,200,await assets.setTrash(body));
        if(p==='/api/text/apply-ai' && req.method==='POST')return send(res,200,await service.applyTextEdit(id,body));
        if(p==='/api/restore' && req.method==='POST')return send(res,200,await service.restore(id,body));
        if(p==='/api/draft')return send(res,200,await service.draft(id,url.searchParams.get('clientId')||body.clientId,req.method==='POST'?body.payload:undefined));
        if(p==='/api/markdown' && req.method==='POST')return send(res,200,{html:service.markdown(String(body.markdown??''))});
        if(p==='/api/attachment' && req.method==='POST')return send(res,200,await service.asset(id,body));
        if(p==='/api/document-image' && req.method==='POST')return send(res,200,await documentImageAction({service,desktop,body}));
        if(['/api/asset','/api/recycle/asset','/api/official/chat/music-audio'].includes(p) && req.method==='GET'){
          const info=p==='/api/official/chat/music-audio'?await official.handle('/chat/music-audio',Object.fromEntries(url.searchParams)):p==='/api/recycle/asset'?await official.handle('/recycle/media',{trashId:url.searchParams.get('trashId'),fileId:url.searchParams.get('fileId')}):await service.assetInfo(id,url.searchParams.get('path'),url.searchParams.get('documentId'));
          const fileStat=await stat(info.absolutePath,{bigint:true});
          const etag='W/"'+fileStat.size+'-'+fileStat.mtimeNs+'-'+fileStat.ctimeNs+'"';
          res.setHeader('Cache-Control','private, no-cache');res.setHeader('ETag',etag);
          if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}
          const streamFile=options=>{const stream=createReadStream(info.absolutePath,options);res.once('close',()=>stream.destroy());stream.once('error',()=>res.destroy());stream.pipe(res);};
          const size=info.size,match=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
          if(match){const start=Number(match[1]),end=Math.min(Number(match[2]||size-1),size-1);if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}res.writeHead(206,{'Content-Type':info.mimeType,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});streamFile({start,end});}
          else{res.writeHead(200,{'Content-Type':info.mimeType,'Content-Length':size,'Accept-Ranges':'bytes'});streamFile();}return;
        }
        return send(res,404,{message:'未提供的本体操作'});
      }
      if(!['GET','HEAD'].includes(req.method))return send(res,405,{message:'Method denied'});
      let file;
      if(p==='/shared/skill-layout.js')file=join(root,'packages/shared/skill-layout.js');
      else if(p.startsWith('/legacy/')||p.startsWith('/core/legacy/')) {
        const name=p.replace(/^\/(core\/)?legacy\//,'');
        if(!['recycle-state.js','document-tabs.js','document-sanitize.js','document-markdown-serialize.js','document-find-replace.js','markdown-table.js','custom-theme.js','trash.js','history-diff.js','image-card-editor.js','whiteboard.js','whiteboard-rich-prompt.js','novel-cover-design.js'].includes(name))return send(res,404,{message:'Module not exposed'});
        file=join(root,'packages/core/legacy',name);
      }else{file=resolve(uiRoot,'.'+decodeURIComponent(p==='/'?'/index.html':p));if(!file.startsWith(uiRoot+sep))return send(res,403,{message:'Path denied'});}
      let bytes=nativeExtensionBytes(file)||await readFile(file);
      if(p==='/')bytes=Buffer.from(bytes.toString().replace('SESSION_TOKEN',token));
      res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){send(res,['WORKSPACE_STATE_CONFLICT','SETTINGS_CONFLICT'].includes(error.code)?409:error.code==='ENOENT'?404:400,{message:error.message,code:error.code||'CORE_ERROR',...(typeof error.submissionOutcomeKnown==='boolean'?{submissionOutcomeKnown:error.submissionOutcomeKnown}:{})});}finally{if(counted)activeApi--;if(taskStartCounted)activeTaskStarts--;}
  });
  const listen=at=>new Promise((resolve,reject)=>{const ready=()=>{server.removeListener('error',failed);resolve();},failed=error=>{server.removeListener('listening',ready);reject(error);};server.once('error',failed);server.once('listening',ready);server.listen(at,'127.0.0.1');});
  if(port)await listen(port);else{let bound=false;for(let attempt=0;attempt<20;attempt++)try{await listen(randomInt(49152,65536));bound=true;break;}catch(error){if(error.code!=='EADDRINUSE')throw error;}if(!bound)throw Error('无法分配本机预览端口');}origin=`http://127.0.0.1:${server.address().port}`;
  if(desktop.restart)pluginUpdates.start();
  return {server,origin,token,service,browserCommand:(action,body,owner)=>official.browserCommand(action,body,owner),prepareBrowserQuit:()=>official.prepareBrowserQuit(),workReport:body=>{if(!official)throw Error('作品模式不可用');return official.handle('/works/tools/result',body);},plugins:allPlugins,pluginIds:async()=>(await allPlugins()).map(p=>p.id),close:async()=>{clearTimeout(startupHistoryTimer);clearInterval(historyTimer);await pluginUpdates.close();await updates.close();await historyCleanupFlight;unsubscribeChanges();for(const stream of eventStreams)stream.end();await official?.close();await plugins.close();return new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const configFile=process.env.SHENSI_CORE_CONFIG_FILE||defaultRuntimeConfig,dataRoot=process.env.SHENSI_CORE_DATA_ROOT||await configuredDataRoot(configFile);
  const desktop=await previewDesktopSecrets({configFile,dataRoot,desktopProfile:process.env.SHENSI_CORE_DESKTOP_PROFILE});
  const host=await startServer({port:Number(process.env.SHENSI_CORE_PORT)||0,dataRoot,configFile,desktop});
  console.log(JSON.stringify({url:host.origin,dataRoot:host.service.dataRoot,plugins:await host.pluginIds()}));
}
