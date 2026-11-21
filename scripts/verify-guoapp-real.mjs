// Explicit real-download acceptance: one previously requested public episode.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,stat} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]||'.'),evidence=resolve(process.argv[3]||'docs/migration/evidence/guoapp-20261117'),resourceRoot=process.argv[4]?resolve(process.argv[4]):join(root,'resources');
const {createCoreService}=await import(pathToFileURL(join(root,'packages/core/src/service.mjs'))),{createChushouExecutor}=await import(pathToFileURL(join(root,'packages/official/chushou-executor.mjs'))),{configureBundledMedia}=await import(pathToFileURL(join(root,'apps/desktop/runtime-paths.mjs')));
const {appendAgentMedia}=await import(pathToFileURL(join(root,'packages/official/board-media-tools.mjs')));
await mkdir(evidence,{recursive:true});
let dataRoot;
if(process.argv[5]){
 const previous=JSON.parse(await readFile(resolve(process.argv[5]),'utf8'));
 dataRoot=resolve(previous.dataRoot);
 assert(previous.passed===false&&previous.stage==='download'&&previous.platform===process.platform&&previous.arch===process.arch);
 const priorRoot=resolve(previous.packageRoot);
 if(priorRoot!==root){
  // Packaged manifests omit development scripts and dependencies.
  const [priorPackage,currentPackage]=await Promise.all([priorRoot,root].map(async dir=>JSON.parse(await readFile(join(dir,'package.json'),'utf8'))));
  for(const field of ['name','productName','version','main']){
   assert(currentPackage[field]);assert.equal(priorPackage[field],currentPackage[field],'匿名设备复用需要相同产品及版本');
  }
  for(const relative of ['resources/skills/chushou/scripts/download_drama.py','resources/skills/chushou/scripts/hongguo_provider.py','resources/skills/chushou/scripts/hongguo_vendor/guoapp.js','resources/skills/chushou/scripts/hongguo_vendor/guoapp-host.cjs','resources/skills/chushou/scripts/hongguo_vendor/guoapp-http.cjs']){
   const [oldBytes,newBytes]=await Promise.all([readFile(join(priorRoot,relative)),readFile(join(root,relative))]);
   assert(oldBytes.equals(newBytes),'匿名设备只能用于同一版本、相同红果接口的候选构建：'+relative);
  }
 }
 assert(/^guoapp-real-[A-Za-z0-9]+$/.test(basename(dataRoot))&&dirname(dataRoot)===resolve(tmpdir()),'仅可复用本机上次隔离验收的匿名设备');
 assert((await stat(join(dataRoot,'machine/chushou/runtime/hongguo/device.json'))).isFile());
}else dataRoot=await mkdtemp(join(tmpdir(),'guoapp-real-'));
const service=await createCoreService({dataRoot});configureBundledMedia({root,resourcesPath:resourceRoot,isPackaged:true});
const book=await service.create('红果下载验收'),state=await service.load(book.id),doc=await service.createDocument(book.id,{kind:'whiteboard',expectedStateStamp:state.stateStamp}),scope={id:book.id,documentId:doc.documentId,pluginId:'official.conversation-control',conversationId:'guoapp-real'};
const taskDir=join(dataRoot,'machine/chushou/jobs',createHash('sha256').update(JSON.stringify([scope.pluginId,scope.id,scope.conversationId])).digest('hex').slice(0,24));
await mkdir(taskDir,{recursive:true});const initialEntries=await readdir(taskDir);assert.equal(initialEntries.length,0,'本次任务目录必须为空');
const executor=createChushouExecutor({service,resourceRoot}),signal=AbortSignal.timeout(300000),start=Date.now(),report={passed:false,platform:process.platform,arch:process.arch,packageRoot:root,realDownload:true,paidGeneration:0,dataRoot,startedAt:new Date().toISOString(),initialDirectoryEntries:initialEntries.length,existingTestDevice:!!process.argv[5],taskDir};
const run=(tool,args,id)=>executor.invoke(tool,args,{scope,signal,operationId:id});
try{
 const selection=process.env.SHENSI_TEST_HONGGUO_FIXTURE||'beast';
 assert(['beast','villain'].includes(selection),'未知的实网验收剧目');
 const [title,seriesId,firstVideoId]=selection==='villain'
  ? ['女主不追主角，却倒追我反派','7704683516834892825','7704685770241477657']
  : ['困兽之战','7690184933037329432','7690261304497458201'];
 const source=process.env.SHENSI_TEST_HONGGUO_SHARE_URL||seriesId;
 report.title=title;
 report.stage='inspect';report.sourceType=source===seriesId?'series_id':'share_link';
 const inspected=await run('run',{action:'drama_inspect',parameters:{source}},'guoapp-inspect');
 const catalog=inspected.result;
 assert.equal(catalog.series_id,seriesId);assert.equal(catalog.title,title);
 assert(Array.isArray(catalog.episodes)&&catalog.episodes.length>0);assert.equal(catalog.total_episodes,catalog.episodes.length);
 const first=catalog.episodes.filter(e=>e.episode===1);assert.equal(first.length,1);assert.equal(first[0].video_id,firstVideoId);
 Object.assign(report,{inspectMs:Date.now()-start,totalEpisodes:catalog.total_episodes,episode:1,videoId:firstVideoId,seriesId,stage:'download'});
 const began=Date.now(),result=await run('run',{action:'drama_download',parameters:{source,episodes:'1'}},'guoapp-download');assert.equal(result.status,'complete');assert.equal(result.result.status,'downloaded');assert(!result.replayed);assert(result.result.episodes.every(e=>e.status==='downloaded'));assert.equal(result.result.completed_episodes,1);assert.equal(result.result.metadata.validation,'full_video_and_available_audio_decode');assert.equal(result.result.metadata.has_audio,true,'指定首集应含音轨');report.downloadAndValidationMs=Date.now()-began;report.firstResultStatus=result.result.status;report.firstResultReplayed=false;console.log('New network download completed; full decode passed. Importing to whiteboard.');
 assert.equal(result.result.series_id,seriesId);assert.deepEqual(result.result.episodes.map(e=>[e.episode,e.video_id]),[[1,firstVideoId]]);
 report.stage='import';
 const video=result.files.find(f=>f.name==='source.mp4'),videoReference=result.result.episodes[0].video;
 assert(video);assert.equal(videoReference,'artifact:'+video.fileId);
 const t=Date.now(),imported=await run('import_media',{fileId:videoReference},'guoapp-import');
 assert.deepEqual(await run('import_media',{fileId:video.fileId},'guoapp-import-check'),imported);
 report.episodeReferenceImported=true;
 const current=await service.load(book.id);
 await appendAgentMedia(service,{...scope,operationId:'guoapp-land',signal},{expectedStateStamp:current.stateStamp,nodes:[{id:'guoapp-video',type:'file',kind:'video',name:title+' · 第1集',file:imported.relativePath,x:0,y:0,width:320,height:180}],edges:[]});
 const reopened=await createCoreService({dataRoot}),readback=await reopened.load(book.id);assert.equal(readback.state.documents[doc.documentId].canvas.nodes[0].file,imported.relativePath);const asset=await reopened.assetInfo(book.id,imported.relativePath,doc.documentId);assert.equal(createHash('sha256').update(await readFile(asset.absolutePath)).digest('hex'),video.sha256);report.importAndReadbackMs=Date.now()-t;
 report.stage='replay';assert((await run('run',{action:'drama_download',parameters:{source,episodes:'1'}},'guoapp-download')).replayed);
 const manifests=result.files.filter(file=>file.name==='manifest.json');assert.equal(manifests.length,1);
 const manifestPath=resolve(taskDir,manifests[0].fileId);assert.equal(manifestPath,join(dirname(resolve(taskDir,video.fileId)),'manifest.json'));
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 assert.equal(manifest.status,'downloaded');assert.equal(manifest.series_id,seriesId);assert.equal(manifest.video_id,firstVideoId);assert.equal(manifest.episode,1);
 assert.equal(manifest.transport?.mode,'direct_http');assert(manifest.transport.bytes>1000000);assert(Date.parse(manifest.created_at)>=start);
 assert.equal(manifest.sha256,video.sha256);assert.equal(manifest.bytes,video.size);
 report.downloadReceipts=[{createdAt:manifest.created_at,transport:manifest.transport,bytes:manifest.bytes,sha256:manifest.sha256,sourceManifest:manifestPath}];
 Object.assign(report,{stage:'complete',passed:true,completedAt:new Date().toISOString(),fileCreatedAt:(await stat(asset.absolutePath)).birthtime.toISOString(),totalMs:Date.now()-start,bytes:video.size,sha256:video.sha256,metadata:result.result.metadata,output:asset.absolutePath,replayedWithoutNewDownload:true,notebookId:book.id,documentId:doc.documentId});
}catch(e){report.error=String(e.message).replace(/https?:\/\/\S+/g,'[URL]');report.totalMs=Date.now()-start;report.failedAt=new Date().toISOString();throw new Error(report.error);}finally{await writeFile(join(evidence,'real-'+process.platform+'-'+process.arch+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
