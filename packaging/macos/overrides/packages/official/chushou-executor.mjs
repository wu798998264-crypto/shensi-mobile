import {readFile,writeFile,mkdir,readdir,stat,realpath,rename,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,relative,isAbsolute,extname,basename,delimiter,dirname,toNamespacedPath} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {failure} from './store.mjs';
import {transcribeFunAsr} from './chushou-funasr-client.mjs';
import {createLocalAsr} from './chushou-local-asr.mjs';
import {agentImagePreview} from './agent-image-preview.mjs';
import {extractDocxBodyText} from './legacy/server/document-extraction.mjs';
import {downloadChushouYunx} from './chushou-yunx.mjs';

const bundle=fileURLToPath(new URL('../../resources/skills/chushou/',import.meta.url));
const app=fileURLToPath(new URL('../../',import.meta.url));
const hash=v=>createHash('sha256').update(v).digest('hex');
const within=(root,path)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(r);};
const exists=async p=>stat(p).then(s=>s.isFile()).catch(()=>false);
const clean=s=>String(s).replace(/https?:\/\/[^\s<>"']+/g,'[URL]').replace(/\b(?:sk-[\w-]+|Bearer\s+\S+)/gi,'[redacted]').slice(-6000);
const text=v=>typeof v==='string'&&v.trim()&&v.length<=20000;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const actions={
 download_music:{script:'native music parser',fields:['source'],required:['source']},
 download_video:{script:'download_video.py',fields:['source','episodes','allEpisodes','quality'],required:['source']},
 drama_search:{script:'download_drama.py',fields:['keyword','cursor'],required:['keyword']},
 drama_inspect:{script:'download_drama.py',fields:['source'],required:['source']},
 drama_download:{script:'download_drama.py',fields:['source','episodes','allEpisodes','quality'],required:['source']},
 inspect_video:{script:'inspect_video.py',fields:['file','attachmentIndex','interval','timestamps','noAudio']},
 inspect_motion:{script:'inspect_motion.py',fields:['analysis','ranges'],required:['analysis','ranges']},
 import_source:{script:'native host adapter',fields:['attachmentIndex','nodeId','documentId']},
 extract_text:{script:'native document adapter',fields:['file'],required:['file']},
 save_text:{script:'native host adapter',fields:['name','text'],required:['name','text']},
 checkpoint:{script:'native host adapter',fields:['line','stage','files','note'],required:['line','stage','files']},
 clip_media:{script:'native FFmpeg adapter',fields:['file','start','end','kind'],required:['file','start','end','kind']},
 transcribe_website:{script:'Transcriber desktop adapter',fields:['files','model','language'],required:['files']},
 transcribe_local:{script:'local SenseVoice CPU adapter; no audio upload',fields:['files','language'],required:['files']},
 canvas_bundle:{script:'canvas_bundle.py',fields:['plan','platform','bindings'],required:['plan']},
 compile_transcripts:{script:'compile_drama_transcripts.py',fields:['downloadManifest','transcripts','requireComplete'],required:['downloadManifest','transcripts']},
 build_documents:{script:'build_drama_documents.py',fields:['manifest','docx','requireComplete'],required:['manifest']},
 capture_novel:{script:'capture_novel.mjs',fields:['command','request'],required:['command']},
 transcribe_media:{script:'shensi_transcription.py (native host adapter)',fields:['files'],required:['files']},
 runtime_check:{script:'chushou_runtime.py',fields:[]},
 runtime_install:{script:'chushou_runtime.py',fields:[]}
};
export const chushouTools={type:'namespace',name:'chushou',description:'内置触手的后台脚本能力；仅访问本会话产物与明确附件，网站转写按需打开专用窗口，不提交生成',tools:[
 {type:'function',name:'catalog',description:'先读动作、字段、脚本及原生替代入口',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {type:'function',name:'read',description:'按需读取本包文本资源（分页）',inputSchema:{type:'object',properties:{path:{type:'string'},offset:{type:'integer'}},required:['path'],additionalProperties:false}},
 {type:'function',name:'run',description:'实际后台执行指定白名单动作；失败可从files取得jobId，使用相同参数及resumeJobId继续，不重做已核验结果；不接收shell命令',inputSchema:{type:'object',properties:{action:{enum:Object.keys(actions)},parameters:{type:'object'},resumeJobId:{type:'string'}},required:['action','parameters'],additionalProperties:false}},
 {type:'function',name:'files',description:'列出本会话已持久化脚本产物及状态',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {type:'function',name:'read_file',description:'读取产物文本；媒体返回文件身份，不把base64当文本',inputSchema:{type:'object',properties:{fileId:{type:'string'},offset:{type:'integer'}},required:['fileId'],additionalProperties:false}},
 {type:'function',name:'view_image',description:'通过原生视觉通道查看本会话抽帧/联系表；大图默认1600像素预览，核对字幕/细节用original=true读取原图。不能凭文件名猜画面，不接收任意路径',inputSchema:{type:'object',properties:{fileId:{type:'string'},original:{type:'boolean'}},required:['fileId'],additionalProperties:false}},
 {type:'function',name:'import_media',description:'核验产物并导入本笔记本真实附件，返回relativePath；随后board.append_media落板',inputSchema:{type:'object',properties:{fileId:{type:'string'},documentId:{type:'string'}},required:['fileId'],additionalProperties:false}},
 {type:'function',name:'import_file',description:'将本会话TXT/Word/JSON/素材包等成品导入附件库以便文档链接交付，不运行文件',inputSchema:{type:'object',properties:{fileId:{type:'string'},documentId:{type:'string'}},required:['fileId'],additionalProperties:false}}
]};

// A child process owns its entire tree. Only that tree is stopped on cancellation.
async function execute(command,args,{cwd,env,signal,timeoutMs=600000}={}){
 signal?.throwIfAborted();
 return new Promise((accept,reject)=>{
  const child=spawn(command,args,{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let out='',err='',size=0,stopping=false,reason;
  const stop=why=>{if(stopping)return;stopping=true;reason=why;if(!child.pid)return;
   if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();}}
  };
  const abort=()=>stop(failure('触手任务已停止','ABORTED'));
  const timer=setTimeout(()=>stop(failure('触手脚本执行超时，已停止本次进程','CHUSHOU_TIMEOUT')),timeoutMs);timer.unref();
  const collect=(type,data)=>{size+=data.length;if(size>4*1024*1024){stop(failure('脚本输出过大，已停止','CHUSHOU_OUTPUT_LIMIT'));return;}if(type==='out')out+=data.toString('utf8');else err+=data.toString('utf8');};
  child.stdout.on('data',d=>collect('out',d));child.stderr.on('data',d=>collect('err',d));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const clear=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  child.on('error',e=>{clear();reject(reason||e);});child.on('close',code=>{clear();if(reason)reject(reason);else accept({code,out,err});});
 });
}
async function pythonCommand(override,resourceRoot,env,signal){
 // Windows releases own their interpreter. Never borrow the author's Python,
 // Codex cache or user site, and never hide a broken explicit override.
 const candidates=[[override||join(resourceRoot,'chushou-runtime',process.platform==='win32'?'python.exe':'bin/python3'),[]]];
 for(const [command,prefix] of candidates){try{const r=await execute(command,[...prefix,'-I','-c','import sys; assert sys.version_info >= (3,11); print("ready")'],{env,signal,timeoutMs:15000});if(r.code===0&&r.out.trim()==='ready')return {command,prefix};}catch(e){signal?.throwIfAborted();}}
 throw failure(override?'指定的触手 Python 不可用（需要3.11+）；未改用其他环境，未启动下载。':'当前安装的触手独立运行库不完整，请更新或修复神思；无需另装系统 Python，未启动下载。','CHUSHOU_PYTHON_MISSING');
}
async function shaFile(path){const h=createHash('sha256');for await(const part of createReadStream(path))h.update(part);return h.digest('hex');}
export function createChushouExecutor({service,python=process.env.CHUSHOU_PYTHON,resourceRoot=process.resourcesPath&&resolve(app,'..')===resolve(process.resourcesPath)?process.resourcesPath:join(app,'resources'),runProcess=execute,transcribe=transcribeFunAsr,websiteTranscriber,videoParser,allowLocalTestNetwork=false}={}){
 const active=new Map();let transcriptionLane=Promise.resolve();
 const localAsr=createLocalAsr({root:join(service.dataRoot,'machine/chushou/local-asr'),resourceRoot,bundle,execute:runProcess});
 function context(scope){return join(service.dataRoot,'machine/chushou/jobs',hash(JSON.stringify([scope.pluginId,scope.id,scope.conversationId])).slice(0,24));}
 async function safeFile(root,fileId){
  if(typeof fileId==='string')fileId=fileId.replace(/^artifact:/,'');
  if(typeof fileId!=='string'||isAbsolute(fileId)||/[:\\\u0000-\u001f]/.test(fileId)||fileId.split('/').some(p=>!p||p==='.'||p==='..'))throw failure('触手产物身份无效');
  const path=await realpath(join(root,fileId));if(!within(await realpath(root),path)||(await stat(path)).isFile()!==true)throw failure('产物超出当前会话');return path;
 }
 async function outputFiles(root,dir){const files=[];async function walk(path){for(const e of await readdir(path,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=join(path,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()){const s=await stat(p);files.push({fileId:relative(root,p).replaceAll('\\','/'),name:e.name,size:s.size,sha256:await shaFile(p)});if(files.length>10000)throw failure('产物条目过多');}}}await walk(dir);return files;}
 async function readReceipt(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
 async function persist(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,path);}
 async function run(scope,action,p,operationId,{signal,onEvent,requestApproval,attachments=[],resumeJobId}){
  const spec=actions[action];if(!spec||!object(p)||Object.keys(p).some(k=>!spec.fields.includes(k))||spec.required?.some(k=>p[k]===undefined))throw failure('触手动作或参数无效；先读 chushou.catalog');
  if(resumeJobId!==undefined&&!/^[a-f0-9]{24}$/.test(resumeJobId))throw failure('恢复任务身份无效');
  const root=context(scope),jobId=resumeJobId||hash(operationId).slice(0,24),dir=join(root,jobId),output=join(dir,'output'),receipt=join(dir,'receipt.json'),requestHash=hash(JSON.stringify([action,p]));
  const saved=await readReceipt(receipt);
  if(resumeJobId&&!saved)throw failure('当前会话没有该恢复任务');
  if(saved&&saved.requestHash!==requestHash)throw failure('触手操作身份冲突');
  if(saved?.status==='complete'){
   for(const f of saved.files){const path=await safeFile(root,f.fileId);if(await shaFile(path)!==f.sha256)throw failure('已完成产物内容发生变化，不复用旧回执');}
   return {...saved,replayed:true};
  }
  const key=root+'/'+jobId;if(active.has(key))return active.get(key);
  const pending=(async()=>{
   await mkdir(output,{recursive:true});signal?.throwIfAborted();
   const environment=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','PROGRAMFILES','APPDATA'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
   // This public-only child already excludes inherited proxies. Python falls
   // back to Windows registry proxies when that environment is empty; keep the
   // intended direct route explicit without weakening per-socket SSRF checks.
   environment.NO_PROXY='*';
   const ffmpeg=process.env.SHENSI_FFMPEG_PATH||join(resourceRoot,'ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),ffprobe=process.env.SHENSI_FFPROBE_PATH||join(resourceRoot,'ffmpeg',process.platform==='win32'?'ffprobe.exe':'ffprobe');
   environment.PATH=[dirname(ffmpeg),dirname(ffprobe),join(resourceRoot,'node'),environment.PATH||environment.Path||''].join(delimiter);delete environment.Path;
   Object.assign(environment,{CHUSHOU_BUNDLED_PACKAGES:join(resourceRoot,'chushou-runtime/packages'),SHENSI_FFMPEG_PATH:ffmpeg,SHENSI_FFPROBE_PATH:ffprobe,SHENSI_NODE_PATH:join(resourceRoot,'node',process.platform==='win32'?'node.exe':'node')});
   Object.assign(environment,{PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',CHUSHOU_HOST_MODE:'1',CHUSHOU_PUBLIC_NETWORK_ONLY:allowLocalTestNetwork?'0':'1',CHUSHOU_RUNTIME_ROOT:join(service.dataRoot,'machine/chushou/runtime'),CHUSHOU_NO_AUTO_INSTALL:action==='runtime_install'?'0':'1'});
   const file=v=>safeFile(root,v);
   const trustedFile=async(v,allowed)=>{
    const path=await file(v),fileId=String(v).replace(/^artifact:/,''),r=await readReceipt(join(root,fileId.split('/')[0],'receipt.json'));
    const record=r?.files?.find(f=>f.fileId===fileId);
    if(!allowed.includes(r?.action)||!record||record.sha256!==await shaFile(path))throw failure('来源清单不是已核验的对应脚本产物，不读取其中路径');
    return path;
   };
   async function stageSource({attachmentIndex,nodeId,documentId}={}){
    let info;
    if(attachmentIndex!==undefined){
     if(nodeId||!Number.isSafeInteger(attachmentIndex)||!attachments[attachmentIndex])throw failure('请选择本轮一个真实附件');
     const a=attachments[attachmentIndex];info=await service.assetInfo(a.notebookId,a.relativePath,a.documentId);
    }else{
     if(typeof nodeId!=='string')throw failure('请选择附件或当前笔记本的媒体节点');
     const docId=documentId||scope.documentId,loaded=await service.load(scope.id),node=loaded.state.documents[docId]?.canvas?.nodes?.find(n=>n.id===nodeId);
     if(!node?.file)throw failure('所选节点没有真实附件');info=await service.assetInfo(scope.id,node.file,docId);
    }
    const before=await shaFile(info.absolutePath),extension=extname(info.absolutePath).toLowerCase();
    if(!/^\.(?:mp4|mov|mkv|webm|avi|mp3|wav|m4a|aac|ogg|flac|png|jpg|jpeg|txt|md|srt|vtt|json|docx)$/.test(extension))throw failure('此附件类型不能作为触手输入');
    const target=join(output,'source-'+before+extension),temp=target+'.tmp';
    await copyFile(info.absolutePath,temp);signal?.throwIfAborted();
    if(await shaFile(temp)!==before)throw failure('来源在读取期间改变，请重新选择最新附件');
    await rename(temp,target);return target;
   }
   const json=async(name,data)=>{const path=join(dir,name+'.json');await writeFile(path,JSON.stringify(data));return path;};
   const source=async()=>{if(!text(p.source))throw failure('请提供视频分享链接或整剧ID');const path=join(dir,'source.txt');await writeFile(path,p.source);return ['--source-file',path];};
   const ffargs=async()=>{if(!await exists(ffmpeg)||!await exists(ffprobe))throw failure('当前安装缺少 FFmpeg/ffprobe，未开始媒体处理','CHUSHOU_FFMPEG_MISSING');return ['--ffmpeg',ffmpeg,'--ffprobe',ffprobe];};
   const selection=()=>{if(p.episodes!==undefined&&p.allEpisodes)throw failure('选集与全集不能同时指定');if(p.episodes!==undefined&&!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(p.episodes))throw failure('集数格式需如 1,3-5');if(p.quality&&!['360p','480p','540p','720p','1080p'].includes(p.quality))throw failure('不支持的清晰度');return [...(p.episodes?['--episodes',p.episodes]:p.allEpisodes===true?['--all-episodes']:[]),...(p.quality?['--quality',p.quality]:[])];};
   // Inline manifests may refer only to artifacts. No absolute paths from the model.
   const localKeys=new Set(['path','source','source_file','raw_file','review_file','punct_file','transcript_file','download_manifest','catalog','video','output_path']);
   async function manifest(value,key=''){
    if(Array.isArray(value))return Promise.all(value.map(v=>manifest(v,key)));
    if(object(value)){const result={};for(const [k,v]of Object.entries(value))result[k]=await manifest(v,k);return result;}
    if(typeof value==='string'&&key==='download_manifest')return trustedFile(value,['drama_download','download_video']);
    if(typeof value==='string'&&localKeys.has(key))return file(value);
    return value;
   }
   let argv=[],result,files=[],status='running';
   await persist(receipt,{jobId,action,requestHash,status,files});
   await onEvent?.({phase:'progress',text:'触手后台：'+action});
   try{
    if(action==='import_source'){const path=await stageSource(p);result={path,sha256:await shaFile(path),source:'explicit attachment or board node'};}
    else if(action==='extract_text'){
     const input=await file(p.file),extension=extname(input).toLowerCase();
     if(!['.docx','.txt','.md','.json','.srt','.vtt'].includes(extension))throw failure('正文提取仅支持DOCX和UTF-8文本；图片/PDF不冒充已识别');
     if((await stat(input)).size>32*1024*1024)throw failure('文稿附件超过32MB，请拆分；未截断');
     const bytes=await readFile(input),body=extension==='.docx'?extractDocxBodyText(bytes):new TextDecoder('utf-8',{fatal:true}).decode(bytes);
     if(!body.trim()||Buffer.byteLength(body)>8*1024*1024)throw failure('正文为空或超过8MB，请拆分；未截断');
     const path=join(output,'body.txt');await writeFile(path,body);
     result={path,sourceFileId:p.file,sourceSha256:hash(bytes),sha256:await shaFile(path),characters:body.length,extraction:extension==='.docx'?'main_body_text_only_no_images':'utf8'};await persist(join(output,'source.json'),result);
    }
    else if(action==='save_text'){
     if(typeof p.name!=='string'||!/^[-\p{L}\p{N}_ .]{1,100}\.(?:txt|md|json|srt|vtt)$/u.test(p.name)||/[. ]$/.test(p.name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(p.name)||typeof p.text!=='string'||Buffer.byteLength(p.text)>1024*1024)throw failure('产物需为安全文本文件名，正文上限1MB');
     if(p.name.endsWith('.json'))JSON.parse(p.text);
     const path=join(output,p.name);await writeFile(path,p.text);result={path,sha256:await shaFile(path),immutable:true};
    }
    else if(action==='checkpoint'){
     if(!['replication','drama','novel','original'].includes(p.line)||!['sources','analysis','outline','approve_outline','scripts','prompts','approve_prompts','samples','approve_style','assets','approve_assets','bound','verified'].includes(p.stage)||!Array.isArray(p.files)||!p.files.length||p.files.length>200||p.note!==undefined&&!text(p.note))throw failure('流程阶段、来源文件或说明无效');
     const refs=[];for(const fileId of p.files){const path=await file(fileId);refs.push({fileId,sha256:await shaFile(path)});}
     const approval=p.stage.startsWith('approve_');
     if(approval&&(typeof requestApproval!=='function'||(await requestApproval({kind:'chushou-checkpoint',title:'确认触手当前阶段',description:[p.line+' · '+p.stage,p.note||'',...refs.map(f=>f.fileId+' SHA256 '+f.sha256)].join('\n')}))?.answer!=='allow'))throw failure('当前版本尚未获用户确认，已保留原稿','USER_DENIED');
     // Bind approval to actual bytes; a concurrent rewrite cannot inherit it.
     for(const ref of refs)if(await shaFile(await file(ref.fileId))!==ref.sha256)throw failure('等待确认时稿件已变化，请读取新版本再确认');
     result={line:p.line,stage:p.stage,files:refs,note:p.note||'',userApproved:approval,createdAt:new Date().toISOString()};await persist(join(output,'checkpoint.json'),result);
    }
    else if(action==='download_video'||action==='download_music'){
     if(!text(p.source))throw failure('请提供视频或网盘分享链接');await ffargs();
     result=await downloadChushouYunx({source:p.source,mode:action==='download_music'?'music':'video',output,videoParser,allowLocalTestNetwork,signal,onEvent,requestApproval,execute,ffmpeg,environment,shaFile,persist});
    }
    else if(action==='drama_search'){if(!text(p.keyword))throw failure('请输入剧名');argv=['search','--keyword',p.keyword,'--cursor',String(p.cursor||'')];}
    else if(action==='drama_inspect')argv=['inspect',...await source()];
    else if(action==='drama_download'){if(!p.episodes&&p.allEpisodes!==true)throw failure('下载短剧必须明确集数或全集');argv=['download',...await source(),'--out-dir',output,...selection(),...await ffargs()];}
    else if(action==='inspect_video'){
     let input;if(p.file&&p.attachmentIndex!==undefined)throw failure('只能指定一个媒体来源');
     if(p.attachmentIndex!==undefined)input=await stageSource({attachmentIndex:p.attachmentIndex});else input=await file(p.file);
     if(p.interval!==undefined&&(!Number.isFinite(p.interval)||p.interval<0.05))throw failure('抽帧间隔不能低于0.05秒');
     if(p.timestamps!==undefined&&!/^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)*$/.test(p.timestamps))throw failure('抽帧时间格式无效');
     argv=['--video',input,'--out-dir',output,...await ffargs(),...(p.interval?['--interval',String(p.interval)]:[]),...(p.timestamps?['--timestamps',p.timestamps]:[]),...(p.noAudio?['--no-audio']:[])];
    }else if(action==='inspect_motion'){
     const analysis=JSON.parse(await readFile(await trustedFile(p.analysis,['inspect_video','inspect_motion']),'utf8'));
     if(!within(await realpath(root),await realpath(analysis.source)))throw failure('动作分析原片不在当前会话产物内；先下载或导入原片');
     await ffargs();analysis.tools={ffmpeg,ffprobe};
     if(!Array.isArray(p.ranges)||!p.ranges.length||p.ranges.length>50||p.ranges.some(v=>typeof v!=='string'||!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(v)))throw failure('动作区间格式需为 起点:终点:帧率');
     argv=['--analysis-file',await json('analysis-input',analysis),'--out-dir',output,...p.ranges.flatMap(v=>['--range',v])];
    }else if(action==='canvas_bundle'){
     if(!object(p.plan))throw failure('素材计划无效');const plan=structuredClone(p.plan);for(const a of plan.assets||[])a.path=await file(a.path);
     if(p.platform&&!['generic','shensi','jimeng','libtv'].includes(p.platform))throw failure('未知素材包平台');
     argv=['--plan',await json('plan',plan),'--out-dir',output,'--platform',p.platform||'generic',...(p.bindings?['--bindings',await json('bindings',p.bindings)]:[])];
    }else if(action==='compile_transcripts')argv=['--download-manifest',await trustedFile(p.downloadManifest,['drama_download','download_video']),'--transcript-map',await json('transcripts',await manifest(p.transcripts)),'--out',join(output,'transcripts.txt'),...(p.requireComplete?['--require-complete']:[])];
    else if(action==='build_documents')argv=['--manifest',await json('documents',await manifest(p.manifest)),'--out-dir',output,...(p.docx?['--docx']:[]),...(p.requireComplete?['--require-complete']:[])];
    else if(action==='capture_novel'){
     if(!['sources','search','directory','export'].includes(p.command)||p.request!==undefined&&!object(p.request))throw failure('小说动作或请求无效');
     argv=[p.command,'--request-file',await json('novel-request',p.request||{}),'--out-dir',output];
    }else if(action==='clip_media'){
     const input=await file(p.file);await ffargs();
     if(!['audio','video'].includes(p.kind)||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<0||p.end<=p.start)throw failure('裁切区间必须为有效的起止秒数');
     const probe=await runProcess(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',input],{env:environment,cwd:dir,signal});
     if(probe.code!==0)throw failure('无法核验裁切源文件');const metadata=JSON.parse(probe.out),duration=Number(metadata.format?.duration);
     if(!Number.isFinite(duration)||p.end>duration+0.001)throw failure('裁切区间超出真实媒体时长');
     const path=join(output,p.kind==='audio'?'clip.wav':'clip.mp4'),converted=await runProcess(ffmpeg,['-nostdin','-v','error','-y','-protocol_whitelist','file,pipe','-i',input,'-ss',String(p.start),'-t',String(p.end-p.start),...(p.kind==='audio'?['-map','0:a:0','-vn','-c:a','pcm_s16le']:['-map','0:v:0','-map','0:a:0?','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart']),path],{env:environment,cwd:dir,signal,timeoutMs:1800000});
     if(converted.code!==0)throw failure('媒体裁切失败：'+clean(converted.err));
     const decoded=await runProcess(ffmpeg,['-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',path,'-f','null','-'],{env:environment,cwd:dir,signal,timeoutMs:1800000});
     if(decoded.code!==0)throw failure('裁切结果未通过完整解码');
     result={path,sourceFileId:p.file,sourceSha256:await shaFile(input),start:p.start,end:p.end,sha256:await shaFile(path),validation:'full_decode'};await persist(join(output,'clip-source.json'),result);
    }else if(['transcribe_media','transcribe_website','transcribe_local'].includes(action)){
     if(!Array.isArray(p.files)||!p.files.length||p.files.length>100||p.files.some(f=>typeof f!=='string'))throw failure('请选择1至100个本会话音视频产物');
     const inputs=await Promise.all(p.files.map(file));await ffargs();
     const website=action==='transcribe_website',local=action==='transcribe_local';
     if(website&&!websiteTranscriber)throw failure('网站转写需要新版桌面运行环境；未改用云端上传','CHUSHOU_WEBSITE_UNAVAILABLE');
     if(!local&&(typeof requestApproval!=='function'||(await requestApproval(website?{kind:'chushou-website',title:'在 Transcriber 网站处理所选媒体',description:'仅载入本次 '+inputs.length+' 个媒体；网站声称本机推理，但无法保证媒体不会网络传输。首次需下载模型，广告、验证码或权限提示由你处理；不绕过、不改用其他云端服务。'}:{kind:'chushou-transcription',title:'确认上传音轨识别',description:'将所选 '+inputs.length+' 个音视频的音轨上传到 Fun-ASR 官方公开体验服务逐个识别；可能排队或限流，不调用收费模型。不发送浏览器凭据。'}))?.answer!=='allow'))throw failure('未确认'+(website?'网站媒体处理':'外部音频上传'),'USER_DENIED');
     const batch=async()=>{const items=[];for(const [index,input]of inputs.entries()){
      signal?.throwIfAborted();const sourceSha256=await shaFile(input),name=String(index+1).padStart(3,'0'),savedPath=join(output,name+'.json'),old=await readReceipt(savedPath);
      if(old?.status==='complete'&&old.sourceSha256===sourceSha256&&old.transcriptSha256===await shaFile(old.transcript_file).catch(()=>'')&&old.exportSha256===await shaFile(old.export_file).catch(()=>'')){items.push({...old,reused:true});continue;}
      const audioPath=join(output,jobId+'-'+name+'.wav');
      const prepared=await runProcess(ffmpeg,['-nostdin','-v','error','-y','-protocol_whitelist','file,pipe','-i',input,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',audioPath],{env:environment,cwd:dir,signal,timeoutMs:1800000});
      if(prepared.code!==0)throw failure('音轨提取失败：'+clean(prepared.err));
      const progress=event=>{void onEvent?.({phase:'progress',text:'转写 '+name+'：'+event.stage});};
      const recognized=local?await localAsr.transcribe({audioPath,directory:join(output,name+'-local'),signal,env:environment,ffmpeg,ffprobe,onProgress:progress,persist,language:p.language||'auto'}):website?await websiteTranscriber.transcribe({audioPath,directory:output,jobId:hash(key+'/'+name).slice(0,24),model:p.model,language:p.language,signal,onProgress:progress,requestApproval}):await transcribe({audioPath,signal,onProgress:progress});
      if(typeof recognized.text!=='string'||!recognized.text.trim())throw failure('识别未返回真实正文，不标记完成','CHUSHOU_EMPTY_TRANSCRIPT');
      signal?.throwIfAborted();const path=join(output,name+'.txt');await writeFile(path,recognized.text);
      const exportPath=join(output,name+'.export.json'),job={id:jobId+'-'+name,status:'completed',sourceSha256,model:recognized.model};
      await persist(exportPath,{job,text:recognized.text,...recognized.backend?{backend:recognized.backend}:{},...recognized.structured?{structured:recognized.structured}:{}});
      const item={status:'complete',sourceFileId:p.files[index],sourceSha256,transcript_file:path,transcriptSha256:await shaFile(path),export_file:exportPath,exportSha256:await shaFile(exportPath),jobId:job.id,characters:recognized.text.length,model:recognized.model,eventId:recognized.eventId,backend:local?'Local SenseVoice':website?'Transcriber browser':'Fun-ASR cloud'};await persist(savedPath,item);items.push(item);
     }return {status:'complete',items};};
     const batchJob=transcriptionLane.catch(()=>{}).then(batch);transcriptionLane=batchJob;
     // A cancelled queued batch must settle now, not after somebody else's long
     // recognition. Its queued callback still checks the signal before any work.
     let cancel;
     try{result=await new Promise((accept,reject)=>{cancel=()=>reject(failure('触手转写已停止','ABORTED'));signal?.addEventListener('abort',cancel,{once:true});batchJob.then(accept,reject);if(signal?.aborted)cancel();});}
     finally{signal?.removeEventListener('abort',cancel);}
    }else if(action==='runtime_install'){
     if(typeof requestApproval!=='function'||(await requestApproval({kind:'chushou-runtime',title:'准备触手下载依赖',description:'从 PyPI 安装固定清单的依赖到神思本机数据目录；不修改系统 Python，不复制账号凭据。'}))?.answer!=='allow')throw failure('未确认安装下载依赖','USER_DENIED');argv=['--install'];
    }else{await ffargs();argv=['--check'];}
    signal?.throwIfAborted();
    if(result===undefined){let r;
     if(action==='capture_novel')r=await runProcess(process.execPath,[join(bundle,'scripts',spec.script),...argv],{cwd:dir,env:{...environment,ELECTRON_RUN_AS_NODE:'1'},signal});
     else{const py=await pythonCommand(python,resourceRoot,environment,signal);r=await runProcess(py.command,[...py.prefix,'-I','-B','-X','utf8',join(bundle,'scripts/host_entry.py'),spec.script,...argv],{cwd:dir,env:environment,signal});}
     try{result=JSON.parse(r.out||r.err);}catch{result={};}
     if(r.code!==0){
      const episodes=Array.isArray(result.episodes)?result.episodes.filter(e=>e?.status==='failed'&&e.error).slice(0,5).map(e=>'第'+String(e.episode)+'集：'+String(e.error)).join('\n'):'';
      let inspection='';
      if(action==='inspect_video'&&typeof result.analysis==='string')try{
       // The script may create a run subdirectory when resuming. Read only
       // this job's actual report, never a path elsewhere supplied by stdout.
       const reportRoot=await realpath(root),reportPath=await safeFile(root,relative(reportRoot,await realpath(result.analysis)).replaceAll('\\','/'));
       if(basename(reportPath)==='analysis.json'&&within(await realpath(output),reportPath)&&(await stat(reportPath)).size<=4*1024*1024){
        const report=JSON.parse(await readFile(reportPath,'utf8'));
        const errors=Array.isArray(report.errors)?report.errors.filter(e=>object(e)&&typeof e.message==='string'):[];
        if(errors.length)inspection='视频分析部分失败，已保留 '+(Array.isArray(report.frames)?report.frames.length:0)+' 帧；'+errors.length+' 项错误：\n'+errors.slice(0,5).map(e=>(e.step==='frame'?'抽帧'+(Number.isFinite(e.timestamp_seconds)?' '+e.timestamp_seconds+' 秒':''):e.step==='audio'?'提取音轨':'分析')+'：'+e.message.replaceAll(root,'[任务目录]').replaceAll(reportRoot,'[任务目录]').replaceAll(reportRoot.replaceAll('\\','/'),'[任务目录]')).join('\n');
       }
      }catch{/* Preserve the original script failure if its report is absent or invalid. */}
      const reason=clean(result.error||episodes||inspection||r.err||r.out||'触手脚本失败')+' (exit '+r.code+')';
      // Reuse the desktop parser, never reinterpret privacy/DRM/validation
      // failures as permission to try another site or session.
      let publicSource='';
      try{const u=new URL(String(p.source).match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[，。！？、；：）】}>]+$/u,''));if(!u.username&&!u.password&&!u.search&&!u.hash)publicSource=u.href;}catch{}
      const eligible=action==='download_video'&&videoParser&&publicSource&&!/private network|loopback|DRM|protected|private video|members.only|paywall|login required|sign in|captcha|完整|decode|truncat/i.test(reason)&&/403|Fresh cookies|Unsupported URL|Unable to extract|No video formats/i.test(reason);
      if(!eligible)throw failure(reason,'CHUSHOU_SCRIPT_FAILED');
      const browserJobId='video-'+randomUUID(),directory=join(output,browserJobId);await mkdir(directory);
      await onEvent?.({phase:'progress',text:'直接提取未成功，正在使用桌面视频解析备用线路'});
      try{
       const onProgress=e=>void onEvent?.({phase:'progress',text:clean(e.message||'备用线路下载中')});
       let parsed;
       try{parsed=await videoParser.parse({jobId:browserJobId,sourceText:publicSource,signal,onProgress});}
       catch(error){
        if(error.code!=='VIDEO_VERIFICATION_REQUIRED'||typeof requestApproval!=='function')throw error;
        videoParser.open({jobId:browserJobId});
        if((await requestApproval({kind:'chushou-video-verification',title:'请处理视频解析验证',description:'请在独立解析窗口处理网站提示后继续；不复制其他账号会话，不自动绕过验证。'}))?.answer!=='allow')throw error;
        signal?.throwIfAborted();parsed=await videoParser.parse({jobId:browserJobId,sourceText:publicSource,signal,onProgress,resume:true});
       }
       const option=parsed.options?.find(o=>o.kind==='video'&&o.formats?.includes('source'));
       if(!option)throw failure('备用线路没有可下载的原视频','CHUSHOU_VIDEO_FALLBACK_FAILED');
       const downloaded=await videoParser.download({jobId:browserJobId,optionId:option.id,format:'source',directory,signal,onProgress});
       const actual=await realpath(downloaded.path);
       if(!within(await realpath(directory),actual)||!['mp4','webm'].includes(downloaded.extension))throw failure('备用线路产物路径或容器不符合导入要求');
       const sha256=await shaFile(actual);if(sha256!==downloaded.sha256)throw failure('备用线路下载后文件发生变化，未采用');
       const checked=await execute(ffmpeg,['-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',toNamespacedPath(actual),'-map','0:v:0','-map','0:a?','-f','null','-'],{env:environment,cwd:dir,signal,timeoutMs:600000});
       if(checked.code!==0)throw failure('备用线路视频未通过完整解码：'+clean(checked.err));
       const video=join(directory,'source.'+downloaded.extension);await rename(actual,video);
       result={status:'downloaded',video,source_url:p.source,download_mode:'desktop_video_parser',sha256,bytes:(await stat(video)).size,metadata:{duration_seconds:downloaded.durationMs/1000,width:downloaded.width,height:downloaded.height,validation:'full_video_and_available_audio_decode'},directFailure:reason};
       await persist(join(directory,'manifest.json'),result);
      }catch(error){signal?.throwIfAborted();throw failure(reason+'\n备用线路：'+clean(error.message),error.code||'CHUSHOU_VIDEO_FALLBACK_FAILED');}
      finally{videoParser.stop(browserJobId);}
     }
    }
    signal?.throwIfAborted();files=await outputFiles(root,output);
    // Python resolves the task root, including Windows short names and macOS /var.
    const canonicalRoot=await realpath(root),paths=new Map();
    for(const {fileId} of files){
     paths.set(join(root,fileId),fileId);
     paths.set(join(canonicalRoot,fileId),fileId);
    }
    function publicResult(v){if(Array.isArray(v))return v.map(publicResult);if(object(v))return Object.fromEntries(Object.entries(v).filter(([k])=>!['key','token','authorization','cookie','tools','packages','ffmpeg'].includes(k)).map(([k,v])=>[k,publicResult(v)]));if(typeof v==='string'){if(paths.has(v))return 'artifact:'+paths.get(v);if(isAbsolute(v))return '[local path]';return v;}return v;}
    const value={jobId,action,requestHash,status:'complete',result:publicResult(result),files,completedAt:new Date().toISOString()};await persist(receipt,value);return value;
   }catch(e){try{files=await outputFiles(root,output);}catch{}await persist(receipt,{jobId,action,requestHash,status:signal?.aborted?'cancelled':'failed',error:clean(e.message),code:e.code||'CHUSHOU_FAILED',files});throw e;}
  })().finally(()=>active.delete(key));active.set(key,pending);return pending;
 }
 async function invoke(tool,args,{scope,operationId,signal,onEvent,requestApproval,attachments}){
  signal?.throwIfAborted();
  if(tool==='catalog'){const manifest=JSON.parse(await readFile(join(bundle,'bundle-manifest.json'),'utf8'));return {actions,capabilities:{localTranscription:process.platform==='win32'&&process.arch==='x64',localTranscriptionDetails:'SenseVoice CPU; first-use pinned public model download; no audio upload; original transcript requires proofreading',websiteTranscription:!!websiteTranscriber,website:'https://transcriber.tools.ryusei.io/en',cloudTranscription:'explicit approval required'},files:manifest.files.map(f=>f.path),nativeReplacements:{'shensi_bridge.py':'documents/board/console/media', 'text_console.py':'console', 'restore_video_result_drafts.py':'board.read + existing persisted drafts', 'sync_completed_video_results.py':'media.tasks (existing worker owns results)', 'shensi_canvas_probe.py':'current bound host; no other instance scanning','shensi_transcription.py':'chushou.run transcribe_media; explicit audio upload approval'},notExposed:{'migrate_shensi_notebook.py':'administrative migration, not a normal conversation action'},inputs:'file/analysis/path: artifact fileId; import_source stages this turn attachmentIndex or a board nodeId; inspect_video also accepts attachmentIndex',output:'managed files only; import_media then board.append_media; import_file for downloadable documents; no generation'};}
  if(tool==='read'){const manifest=JSON.parse(await readFile(join(bundle,'bundle-manifest.json'),'utf8'));if(!manifest.files.some(f=>f.path===args.path))throw failure('不是内置触手资源');return page(await readFile(join(bundle,args.path),'utf8'),args.offset);}
  if(tool==='run')return run(scope,args.action,args.parameters,operationId,{signal,onEvent,requestApproval,attachments,resumeJobId:args.resumeJobId});
  const root=context(scope);
  if(tool==='files'){let dirs;try{dirs=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {jobs:[]};throw e;}const jobs=[];for(const d of dirs.filter(d=>d.isDirectory()&&!d.isSymbolicLink())){const r=await readReceipt(join(root,d.name,'receipt.json'));if(r)jobs.push({...r,jobId:d.name});}return {jobs};}
  const path=await safeFile(root,args.fileId),extension=extname(path).toLowerCase();
  if(tool==='view_image'){
   const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[extension],s=await stat(path);
   if(!mime)throw failure('只可查看本会话PNG/JPEG抽帧或联系表');
   if(s.size>32*1024*1024)throw failure('视觉源图超过32MB，请缩小分析副本；原图未修改');
   const bytes=await readFile(path),valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!valid)throw failure('图片内容与扩展名不符，未发送给模型');
   const image=await agentImagePreview(bytes,mime,{original:args.original,signal,ffmpeg:process.env.SHENSI_FFMPEG_PATH||join(resourceRoot,'ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg')});
   if(image.bytes.length>5*1024*1024)throw failure('视觉传输超过5MB，请缩小分析副本；原图未修改');
   return {success:true,contentItems:[{type:'inputText',text:JSON.stringify({fileId:args.fileId,size:s.size,sha256:hash(bytes),channel:'native_image',view:image.view,instruction:'实际抽帧画面；来源关系不是生成参考授权。'})},{type:'inputImage',imageUrl:'data:'+image.mimeType+';base64,'+image.bytes.toString('base64')}]};
  }
  if(tool==='read_file'){const s=await stat(path);if(!['.json','.txt','.md','.log','.srt','.vtt'].includes(extension))return {fileId:args.fileId,size:s.size,sha256:await shaFile(path),binary:true};if(s.size>8*1024*1024)throw failure('文本产物超过8MB');return page(await readFile(path,'utf8'),args.offset);}
  if(tool==='import_media'||tool==='import_file'){
   const mime={'.mp4':'video/mp4','.webm':'video/webm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wav':'audio/wav','.mp3':'audio/mpeg',...(tool==='import_file'?{'.txt':'text/plain','.md':'text/markdown','.json':'application/json','.srt':'text/plain','.vtt':'text/vtt','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.zip':'application/zip'}:{})}[extension];if(!mime)throw failure('此产物不是可导入的媒体或文稿');
   const documentId=args.documentId||scope.documentId,sha256=await shaFile(path),identity=hash(JSON.stringify([scope.id,documentId,sha256])),record=join(root,'imports',identity+'.json'),key=root+'/import/'+identity;
   if(active.has(key))return active.get(key);
   const pending=(async()=>{const previous=await readReceipt(record);if(previous){const info=await service.assetInfo(scope.id,previous.relativePath,documentId);if(await shaFile(info.absolutePath)!==sha256)throw failure('已导入附件内容已改变');return previous;}
    signal?.throwIfAborted();const result=await service.assetMediaStream(scope.id,{stream:createReadStream(path),name:basename(path),mimeType:mime,whiteboardDocumentId:documentId,...(/^(image|video|audio)\//.test(mime)?{whiteboardMediaKind:mime.split('/')[0]}:{}),signal});
    await mkdir(join(root,'imports'),{recursive:true});await persist(record,result);signal?.throwIfAborted();return result;
   })().finally(()=>active.delete(key));active.set(key,pending);return pending;
  }
  throw failure('未知触手工具');
 }
 return {invoke};
}
function page(text,offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset>text.length)throw failure('文本偏移无效');return {text:text.slice(offset,offset+24000),offset,total:text.length,nextOffset:offset+24000<text.length?offset+24000:null};}
