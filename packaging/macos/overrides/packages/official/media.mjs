import {profileSupports,profileHasMedia} from '../ui/model-capabilities.js';
import {queueAbandonRefusal,mediaNeedsAutomaticRelease,mediaResultNeedsAttention,mediaRecallable,mediaOriginalResultPending} from '../ui/media-task-policy.js';
import {mediaTargetDocument} from '../core/src/map-media-target.js';
import {createAccountCredits} from './account-credits.mjs';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {jsonStore,failure,identity} from './store.mjs';
import * as jobs from './legacy/server/generation-job-store.mjs';
import {saveGenerationRuntimeBindings,resolveTrustedGenerationSettings} from './legacy/server/generation-runtime-store.mjs';
import {canonicalMediaProfileSignature} from './legacy/server/media-profile-signature.mjs';
import {launchMediaGenerationWorker,terminateMediaGenerationWorker,deferDreaminaQueueAtStartup,resumeDreaminaQueue} from './legacy/server/media-worker-manager.mjs';
import {readDreaminaBrokerLease} from './legacy/server/dreamina-broker-lease.mjs';
import {listDreaminaProfileAccountStatuses,openDreaminaProfilePage} from './legacy/server/dreamina-profile-oauth.mjs';
import {resolveMediaProviderDriver} from './legacy/server/media-provider-drivers.mjs';
import {imageModelCapabilities,videoModelCapabilities} from './legacy/model-presets.js';
import {canvasModels} from '../ui/dreamina-canvas-models.js';
import {composeMediaCompilerSource,MEDIA_PROVIDER_PROMPT_MAX_CHARACTERS} from './legacy/media-prompt.js';
import {adaptiveWhiteboardAspectRatio} from '../core/legacy/whiteboard.js';
import {probeVideoValidationRuntime} from './legacy/server/workspace.mjs';
import {compileReferencePrompt,compileVideoReferencePrompt,compileApiReferencePrompt} from '../ui/generation-references.js';
import {assertOpenAIVideoReferences} from './legacy/server/api-video-references.mjs';
import {selectGenerationModel} from './generation-models.mjs';
import {dreaminaIdentityBlockedBeforeSubmission} from './legacy/server/dreamina-pre-submit-proof.mjs';
import {acceptedVideoObservationDue,acceptedLibTvImageObservationDue,acceptedCanvasAudioObservationDue} from './video-observation-policy.mjs';
import {preSubmitRejectionPatch} from './legacy/server/media-pre-submit-rejection.mjs';
import {createMediaRejectionLog} from './media-rejection-log.mjs';
import {validateGenerationReferences} from './generation-reference-contract.mjs';
import {localH3Timing} from './local-h3-timing.mjs';
import {referenceMediaMetadata} from './reference-media-metadata.mjs';
import {defaultVideoResolution} from '../ui/generation-parameters.js';
import {videoTimingValidation} from './legacy/video-timing-contract.js';
import {dreaminaImageOptionError} from './legacy/dreamina-image-options.js';
import {assertLibTvSource} from './legacy/server/libtv-video-postprocess.mjs';
import {resolveLibTvContext} from './libtv-context.mjs';
import {dreaminaWebContext,dreaminaWebRecoveryEligible} from './legacy/server/dreamina-web-result.mjs';
const appRoot=fileURLToPath(new URL('./',import.meta.url));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createMediaService({service,models,requirePlugin,budget,launchWorker=launchMediaGenerationWorker,terminateWorker=terminateMediaGenerationWorker,creditReader=listDreaminaProfileAccountStatuses,libTvReader,webImageReader,webImageContext=dreaminaWebContext,automatic=true,recoverOnStart=true}){
 const accountCredits=createAccountCredits({models,creditReader,libTvReader,cwd:service.dataRoot});
 const rejectionLog=createMediaRejectionLog(service);
 const ledger=jsonStore(join(service.dataRoot,'plugins','media-targets.json'),{});let busy=false,closed=false,epoch=0,ticking;const applying=new Set(),stopEvents=[],videoObservations=new Map(),originalResultRecoveries=new Map(),webRecoveries=new Map();
 const publicJob=(job,record)=>({...jobs.publicGenerationJob(record?.stoppedAt&&!job.appliedAt?{...job,resultSuppressed:true,desiredAction:'cancel'}:job),...(record?{notebookId:record.id,profileId:record.profileId||job.profileId}:{}),...(job.autoFailedAt?{status:'failed',autoFailedAt:job.autoFailedAt,autoFailureReason:job.autoFailureReason,message:(job.autoFailureReason||'生成未取得明确结果')+'；本地任务已结束，原记录保留。'}:{})});
 const recordFailure=(jobId,record,error)=>({id:jobId,notebookId:record.id,channel:record.channel,status:record.stoppedAt?'failed':'reconciliation_required',stoppedAt:record.stoppedAt,queueDismissedAt:record.queueDismissedAt,recallArchivedAt:record.recallArchivedAt,autoFailedAt:record.stoppedAt,autoFailureReason:record.failureReason,abandonPendingAt:record.stoppedAt&&!record.queueDismissedAt?record.stoppedAt:'',submissionState:'unknown',runtimeNeedsAttention:true,providerErrorCode:error.code||'MEDIA_RECORD_UNREADABLE',error:error.code==='GENERATION_JOB_MISSING'?'任务记录缺失或损坏；未重发原任务，请恢复记录后再核验。':error.code==='MEDIA_JOB_TARGET_MISMATCH'?'任务记录与当前目标不匹配，已隔离；未读取或回写其他目标。':'任务记录暂时无法读取；原任务未重发，请稍后核验。',createdAt:record.createdAt||'',updatedAt:record.createdAt||'',target:{documentId:record.documentId,nodeId:record.nodeId},availableActions:{stop:false,resumeOriginal:false}});
 async function trusted(profileId,channel,model,context,submission){
  if(submission?.unlimitedGeneration===true||submission?.unlimitedGeneration==='true')throw failure('无限生成入口已取消；请重新选择模型和数量后提交，原草稿未按普通计费生成。','UNLIMITED_GENERATION_REMOVED');
  const profile=selectGenerationModel(await models.resolve(profileId,channel,context),channel,model);if(submission){const invalid=dreaminaImageOptionError({...profile,channel,imageCount:submission.imageCount??1,unlimitedGeneration:submission.unlimitedGeneration});if(invalid)throw failure(invalid.message,invalid.code);}await saveGenerationRuntimeBindings({bindings:[{...profile,profileId}]});return resolveTrustedGenerationSettings({channel,settings:profile});}
 // Recovery never converts a persisted task to another CLI or overwrites its binding.
 const originalSettings=async(record,job,context)=>{const old=job.request?.settings;if(old?.adapter==='cli'&&['即梦','LibTV'].includes(old.provider)){if(!context?.allowInactiveProvider)await models.assertAvailable(record.profileId);return resolveTrustedGenerationSettings({channel:record.channel,settings:old});}return trusted(record.profileId,record.channel,record.model||old?.model,context);};
 const origin=r=>r.pluginId||'official.whiteboard-generation';
 const pluginOf=body=>{const pluginId=origin(body);if(!['official.document-chat','official.whiteboard-generation'].includes(pluginId))throw failure('无效媒体来源');return pluginId;};
 const matches=(r,filter)=>Object.entries(filter).every(([key,value])=>value===undefined||(key==='pluginId'?origin(r):r[key])===value);
 async function scope(body){identity(body.id);const loaded=await service.load(body.id),doc=mediaTargetDocument(loaded.state,body.documentId);if(body.pluginId==='official.document-chat'){if(!doc||doc.canvas)throw failure('请选择当前笔记本中的真实文档');return {loaded,doc,node:null};}const node=doc?.canvas?.nodes.find(n=>n.id===body.nodeId);if(!node)throw failure('请选择当前白板中的卡片');return {loaded,doc,node};}
 async function submit(body){
  let creationStarted=false;
  try{
  body.signal?.throwIfAborted();
  jobs.normalizedMediaSubmissionId(identity(body.submissionId)); // Validate before reserving budget or persisting a target.
  await tick();
  const startedEpoch=epoch,stopRevision=stopEvents.length,pluginId=pluginOf(body);await requirePlugin(pluginId);const {doc,node}=await scope({...body,pluginId}),channel=body.channel;
  if(!['image','video','audio'].includes(channel))throw failure('请选择图片、视频或音频类型');
  if(channel==='video'&&body.generationMode==='long_video')throw failure('当前连接尚未接通官网的超长视频模式，未提交任务；草稿已保留','COMPOSITE_VIDEO_NOT_MIGRATED');
  const settings=await trusted(body.profileId,channel,body.model,undefined,body);
  const libTvOperation=body.libTvOperation||'';let libTvSourceJobId='',libTvSource=null;
  if(libTvOperation){
   if(channel!=='video'||settings.provider!=='LibTV'||settings.adapter!=='cli'||!['hd','final'].includes(libTvOperation))throw failure('此配置不支持所选视频后处理','LIBTV_POSTPROCESS_INVALID');
   const sourceNode=doc.canvas?.nodes.find(n=>n.id===(body.libTvSourceNodeId||node?.id));
   if(!sourceNode?.coreMediaJobId)throw failure('请选择本白板中已完成的 LibTV 视频卡片','LIBTV_POSTPROCESS_SOURCE_REQUIRED');
   const {job:source,record}=await owned(sourceNode.coreMediaJobId);
   if(record.id!==body.id||record.documentId!==body.documentId||record.nodeId!==sourceNode.id)throw failure('原视频任务与卡片不一致','LIBTV_POSTPROCESS_INVALID');
   assertLibTvSource(source,{profileId:body.profileId,target:{workspacePath:join(service.dataRoot,'笔记',body.id),documentId:body.documentId},request:{libTvOperation}});
   libTvSource=source;
   if((body.references||[]).length||body.includeTargetReference)throw failure('视频后处理使用源视频原参数，请先移除生成栏的额外参考；未提交任务','LIBTV_POSTPROCESS_EXTRA_REFERENCES');
   libTvSourceJobId=source.id;
  }
  if(channel==='video'&&settings.provider==='本地 H3')localH3Timing(body.durationSeconds??settings.durationSeconds??4);
  if(channel!=='image'&&!resolveMediaProviderDriver({channel,settings}))throw failure('此配置尚无对应媒体驱动','DRIVER_NOT_REGISTERED');
  if(channel==='video'){const probe=await probeVideoValidationRuntime({appRoot});if(!probe.available)throw failure(probe.message||'本机缺少视频校验工具','VIDEO_VALIDATION_UNAVAILABLE');}
  const references=Array.isArray(body.references)?[...body.references]:[],referenceMedia=[],textSources=[];if(body.includeTargetReference===true&&node&&!references.includes(node.id))references.push(node.id);
  if(!node&&references.length)throw failure('文档媒体引用请通过对话附件和文档读取工具明确提供');
  if(new Set(references).size!==references.length)throw failure('参考顺序无效');
  validateGenerationReferences({settings,channel,referenceCount:references.length,generationMode:body.generationMode});
  for(const id of references){const ref=doc.canvas.nodes.find(n=>n.id===id);if(!ref)throw failure('参考卡片已不存在');if(ref.file){const info=await referenceMediaMetadata(service,body.id,ref,body.documentId);referenceMedia.push({id,relativePath:ref.file,name:ref.name||basename(ref.file),...info,referenceRole:'upstream'});}else{let text=String(ref.text||ref.webSnapshot?.content||'');if(ref.reference?.documentId){const live=await service.load(ref.reference.notebookId||body.id),source=live.state.documents[ref.reference.documentId];if(!source)throw failure('引用源文档已删除');text=String(source.markdown||'');}if(text)textSources.push('【用户引用原文：'+String(ref.name||id)+'】\n'+text);}}
  if(channel==='video'&&resolveMediaProviderDriver({channel,settings})?.id==='openai-videos')assertOpenAIVideoReferences(settings,referenceMedia);
  if(channel==='image'&&settings.adapter==='api'&&settings.provider==='自定义兼容接口'&&referenceMedia.some(r=>!r.mimeType.startsWith('image/')))throw failure('当前图片 API 参考上传仅支持图片；存在其他类型附件，未丢弃参考、未提交生成','API_REFERENCE_UNSUPPORTED');
  const displayPrompt=String(body.prompt||''),compiler=settings.dreaminaCanvasMode==='canvas'?compileVideoReferencePrompt:settings.adapter==='api'&&['image','video'].includes(channel)?compileApiReferencePrompt:channel==='video'&&settings.adapter==='cli'&&['即梦','LibTV'].includes(settings.provider)?compileVideoReferencePrompt:compileReferencePrompt,compiled=compiler(displayPrompt,references.map(id=>doc.canvas.nodes.find(n=>n.id===id)),{mentions:body.promptMentions,sequence:body.promptReferenceSequence});
  validateGenerationReferences({settings,channel,referenceCount:references.length,referenceMedia,generationMode:body.generationMode});
  if(compiled.promptReferenceSequence.length>300)throw failure('重点引用次数超过 300，请拆分任务；未提交生成');
  const prompt=composeMediaCompilerSource([compiled.prompt,...textSources]);if(prompt.length>MEDIA_PROVIDER_PROMPT_MAX_CHARACTERS)throw failure('提示词和引用全文超过厂商安全上限，请拆分任务；未截断、未提交生成');
  const imageCount=Number(body.imageCount??1);if(channel==='image'&&![1,2,3,4].includes(imageCount))throw failure('图片数量请选择 1 至 4 张','IMAGE_COUNT_INVALID');
  // Apply the same new-task default to non-UI callers. Re-observing an existing
  // submission keeps its persisted resolution; it must not become a new order.
  let resolution=body.resolution||settings.resolution;
  if(channel==='video'&&!body.resolution){
   const prior=(await ledger.read())[identity(body.submissionId)];
   resolution=prior?.jobId?(await jobs.getGenerationJob({jobId:prior.jobId})).request.resolution:defaultVideoResolution(settings.canvasVideoCapabilities||settings.libTvVideoCapabilities||videoModelCapabilities(settings.provider,settings.model),body.generationMode);
  }
  const duration=Number(channel==='audio'&&settings.dreaminaCanvasMode==='canvas'?(body.durationSeconds??settings.durationSeconds??30):channel==='video'?(body.durationSeconds??settings.durationSeconds??0):(body.durationSeconds||settings.durationSeconds))||0;
  if(channel==='video'&&!libTvOperation){const timing=videoTimingValidation({...settings,durationSeconds:duration,resolution,generationMode:body.generationMode},referenceMedia,settings.canvasVideoCapabilities||settings.libTvVideoCapabilities||videoModelCapabilities(settings.provider,settings.model,settings.dynamicModels||[]));if(!timing.ok)throw failure(timing.message,timing.code);}
  const ratioCapabilities=settings.provider==='即梦'&&settings.adapter==='cli'&&settings.dreaminaCanvasMode==='canvas'?canvasModels(channel).find(m=>m.slug===settings.model)?.capabilities:(channel==='image'?imageModelCapabilities:videoModelCapabilities)(settings.provider,settings.model);
  const submissionId=identity(body.submissionId),request={prompt,displayPrompt,settings,referenceOrder:references,referenceMedia,aspectRatio:body.aspectRatio==='auto'?adaptiveWhiteboardAspectRatio({upstream:references.map(id=>doc.canvas.nodes.find(n=>n.id===id)),prompt,channel,allowedRatios:ratioCapabilities?.aspectRatios}):body.aspectRatio||settings.aspectRatio,resolution,duration,voiceId:body.voiceId||settings.voice||'',generationMode:body.generationMode||'',imageCount:Number(body.imageCount)||1,videoCount:Number(body.videoCount)||1,generateAudio:body.generateAudio!==false&&body.generateAudio!=='false',quality:String(body.quality||''),background:String(body.background||''),audioType:String(body.audioType||''),language:String(body.language||''),speed:Number(body.speed)||1,format:String(body.format||''),sampleRate:Number(body.sampleRate)||0,multiframeTransitions:Array.isArray(body.multiframeTransitions)?body.multiframeTransitions:[],promptReferenceSequence:compiled.promptReferenceSequence};
  if(libTvOperation)Object.assign(request,{prompt:libTvOperation==='hd'?'视频高清超分':'样片转正片',libTvOperation,libTvSourceJobId,libTvSourceNodeId:body.libTvSourceNodeId||node.id,libTvHdModel:String(body.libTvHdModel||'').trim().slice(0,200),duration:Number(libTvSource.request.duration)||0,aspectRatio:libTvSource.request.aspectRatio,resolution:libTvOperation==='final'?'1080p':libTvSource.request.resolution,videoCount:1,generationMode:''});
  const libTvContext=await resolveLibTvContext(service,body,doc,settings);if(libTvContext)request.libTvContext=libTvContext;
  if(channel==='image'){
   request.imageCount=imageCount;const prior=(await ledger.read())[body.submissionId];
   if(!prior?.jobId||((await jobs.getGenerationJob({jobId:prior.jobId})).request?.imageOutputContract==='independent-v1'))request.imageOutputContract='independent-v1';
  }
  if(compiled.providerPromptReferenceTokens)Object.assign(request,{providerPromptReferenceTokens:compiled.providerPromptReferenceTokens,preserveReferenceTokens:true});
  if(compiler===compileApiReferencePrompt)request.apiReferenceContract='ordered-media-v1';
  const fingerprint=hash({...request,displayPrompt:undefined,settings:{...settings,apiKey:undefined}}),anchorId='anchor-'+hash(submissionId).slice(0,40),artifactId='artifact-'+hash(submissionId).slice(0,40);
  body.signal?.throwIfAborted();await budget?.reserveMedia({...body,pluginId,submissionId,fingerprint,imageCount:request.imageCount});
  await ledger.update(s=>{
   if(body.signal?.aborted)throw failure('任务已停止','ABORTED');const old=s[submissionId];
   if(old&&(old.fingerprint!==fingerprint||old.id!==body.id||old.documentId!==body.documentId||old.nodeId!==node?.id||origin(old)!==pluginId||old.conversationId!==body.conversationId))throw failure('同一提交编号对应不同内容或目标','MEDIA_SUBMISSION_ID_CONFLICT');
   if(old?.stoppedAt)throw failure('此提交已停止，不会重新投单','MEDIA_SUBMISSION_STOPPED');
   s[submissionId]??={id:body.id,pluginId,conversationId:body.conversationId,requestId:body.requestId,runnerProfileId:body.runnerProfileId,documentId:body.documentId,...(node?{nodeId:node.id,baseNode:structuredClone(node)}:{anchorId,artifactId,baseDocument:{markdown:doc.markdown,html:doc.html}}),fingerprint,profileId:body.profileId,model:settings.model,channel,createdAt:new Date().toISOString()};return s;
  });
  const target={workspacePath:join(service.dataRoot,'笔记',body.id),workspaceKind:'notebook',documentId:body.documentId,documentTitle:doc.title,conversationId:body.conversationId,...(node?{nodeId:node.id,nodeName:node.name,documentKind:'whiteboard',targetType:'whiteboard-node'}:{documentKind:'document',targetType:'document-artifact',anchorId,artifactId})};
  creationStarted=true;
  const job=await jobs.createMediaGenerationJob({channel,submissionId,canonicalProfileSignature:canonicalMediaProfileSignature(channel,settings),target,request});
  await ledger.update(s=>{s[submissionId].jobId=job.id;return s;});
  try{await requirePlugin(pluginId);await models.assertAvailable?.(body.profileId);const {record}=await owned(job.id);if(startedEpoch!==epoch||closed||body.signal?.aborted||record.stoppedAt||stopEvents.slice(stopRevision).some(selected=>selected(record)))throw failure('插件已停止，未启动生成');}catch(error){await stopOwned(job,(await owned(job.id)).record).catch(()=>{});throw error;}
  if(!job.reused)launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});
  return {job:publicJob(job)};
  }catch(error){if(!creationStarted){error.submissionOutcomeKnown=false;try{
   // A later rejected attempt must not relabel an already reserved submission
   // as unsubmitted, or unlock it when its original receipt is still unknown.
   const existing=body.submissionId&&(await ledger.read())[body.submissionId];
   if(!existing){error.submissionOutcomeKnown=true;await rejectionLog.record(body,error);}
  }catch{/* Unreadable ledger is uncertain; preserve the primary error and lock. */}}throw error;}
 }
 async function owned(jobId,record){record??=Object.values(await ledger.read()).find(r=>r.jobId===jobId);if(!record)throw failure('当前应用没有此任务','MEDIA_JOB_NOT_OWNED');let job=await jobs.getGenerationJob({jobId});if(!job.target?.workspacePath||resolve(job.target.workspacePath)!==resolve(join(service.dataRoot,'笔记',record.id))||job.target.documentId!==record.documentId||(job.target.nodeId||undefined)!==record.nodeId||record.anchorId&&job.target.anchorId!==record.anchorId||record.artifactId&&job.target.artifactId!==record.artifactId)throw failure('任务目标不匹配','MEDIA_JOB_TARGET_MISMATCH');if(preSubmitRejectionPatch(job))job=jobs.publicGenerationJob(await jobs.finalizeUnsubmittedMediaRejection({jobId}));return {record,job};}
 async function apply(jobId){
  const startedEpoch=epoch,stopRevision=stopEvents.length,{record,job}=await owned(jobId);await requirePlugin(origin(record));
  const partial=job.status!=='complete'&&job.incrementalImages===true&&job.channel==='image'&&job.result?.attachments?.length;
  if((job.status!=='complete'&&!partial)||job.resultSuppressed||job.desiredAction==='cancel'||record.stoppedAt||record.recallArchivedAt&&!record.recallRequestedAt)return null;
  if([...applying].some(c=>c.record.jobId===jobId))return null;
  // Durable local results do not require the original model/account to remain enabled.
  if(startedEpoch!==epoch||closed||stopEvents.slice(stopRevision).some(selected=>selected(record)))throw failure('插件已停止');
  if([...applying].some(c=>c.record.jobId===jobId))return null;
  const controller=new AbortController();let settled;controller.done=new Promise(r=>settled=r);Object.assign(controller,{profileId:record.profileId,record});applying.add(controller);
  const attachments=job.result?.attachments||[job.result?.attachment].filter(Boolean);
  try{
   if(!partial)await jobs.markGenerationJobCardApplyPending({jobId,state:'applying',errorCode:'',nextAttemptAt:'',retryPausedAt:''});controller.signal.throwIfAborted();
   if(record.recallArchivedAt){const result=await service.saveMediaRecall(record.id,{...record,jobId,channel:job.channel,result:job.result,recallState:'recalled',signal:controller.signal});await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===jobId)r.recallRequestedAt='';return s;});await jobs.updateMediaGenerationJob({jobId,patch:{recalledAt:new Date().toISOString(),recallRequestedAt:'',cardApplyError:'',cardApplyRetryPausedAt:new Date().toISOString()}});return result;}
   if(partial&&!record.nodeId)return null;
   const result=await service[record.nodeId?'applyMediaResult':'applyDocumentMediaResult'](record.id,{...record,jobId,attachments,channel:job.channel,incremental:job.incrementalImages===true,signal:controller.signal});let cardReadback;
   if(record.nodeId){const node=mediaTargetDocument(result.state,record.documentId).canvas.nodes.find(n=>n.id===record.nodeId);if(node?.coreMediaJobId!==jobId||!attachments.some(a=>a.relativePath===node.file))throw failure('原成品已保存，但当前卡片已改用其他内容；未覆盖当前卡片','MEDIA_CARD_CONFLICT');cardReadback={nodeId:node.id,relativePath:node.file,generationJobId:node.coreMediaJobId,documentId:record.documentId,resultAssetId:jobId+'-0',verified:true};}
   if(partial){await jobs.updateMediaGenerationJob({jobId,patch:{partialAppliedCount:attachments.length,partialAppliedAt:new Date().toISOString(),partialApplyError:'',partialApplyAttempts:0}});return result;}
   await jobs.markGenerationJobApplied({jobId,resultAssetId:jobId+'-0',...(cardReadback?{cardReadback}:{})});if(record.recallRequestedAt){await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===jobId)r.recallRequestedAt='';return s;});await jobs.updateMediaGenerationJob({jobId,patch:{recallRequestedAt:''}});}return result;
  }catch(error){
   if(partial){const paused=['MEDIA_CARD_MISSING','MEDIA_CARD_CONFLICT','MEDIA_READBACK_FAILED'].includes(error.code);await jobs.updateMediaGenerationJob({jobId,patch:{partialApplyError:error.message,partialApplyAttempts:paused?5:Number(job.partialApplyAttempts||0)+1}});throw error;}
   const attempts=(Number(job.cardApplyAttempts)||0)+1,paused=attempts>=5||['MEDIA_CARD_MISSING','MEDIA_CARD_CONFLICT','MEDIA_DOCUMENT_MISSING','MEDIA_DOCUMENT_CONFLICT','MEDIA_READBACK_FAILED'].includes(error.code),now=Date.now();
   await jobs.markGenerationJobCardApplyPending({jobId,state:paused?'failed':'pending',error:error.message+(paused?'（自动回写已暂停，成品保留，不会重新生成。）':''),errorCode:error.code||'MEDIA_CARD_APPLY_FAILED',nextAttemptAt:paused?'':new Date(now+Math.min(60000,2000*2**Math.min(attempts,5))).toISOString(),retryPausedAt:paused?new Date(now).toISOString():''});if(record.recallRequestedAt){await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===jobId)r.recallRequestedAt='';return s;});await jobs.updateMediaGenerationJob({jobId,patch:{recallRequestedAt:'',cardApplyRetryPausedAt:new Date(now).toISOString()}});}throw error;
  }finally{applying.delete(controller);settled();}
 }
 async function list(body={}){
  const pluginId=pluginOf(body);await requirePlugin(pluginId);
  // One fresh ownership snapshot per list, never a persistent cache. Mutating
  // operations still reread their owner; every listed job keeps target checks.
  const owners=new Map(),submissions=new Map(),result=[];
  for(const [submissionId,record] of Object.entries(await ledger.read())){
   if(!record.jobId)continue;if(!owners.has(record.jobId))owners.set(record.jobId,record);
   if(origin(record)!==pluginId||!matches(record,{id:body.id,documentId:body.documentId,conversationId:body.conversationId}))continue;
   if(!submissions.has(record.jobId))submissions.set(record.jobId,[]);submissions.get(record.jobId).push(submissionId);
  }
  for(const [jobId,submissionIds] of submissions){const owner=owners.get(jobId);try{const {job,record}=await owned(jobId,owner);result.push({...publicJob(job,record),submissionIds});}catch(error){result.push({...recordFailure(jobId,owner,error),submissionIds});}}
  if(result.some(j=>j.dreaminaQueuePolicy)){const queue=new Map((await jobs.listDreaminaQueueJobs()).map(job=>[job.id,job]));for(const item of result){const q=queue.get(item.id);if(q?.status===item.status)for(const key of ['queuePosition','queueReorderable','queueStage','queueState','queueTone','queueProfileName'])item[key]=q[key];}}
  result.push(...await rejectionLog.list({...body,pluginId}));return {jobs:result.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))};
 }
 function tick(){if(closed)return Promise.resolve();if(!ticking)ticking=runTick().finally(()=>{ticking=null;});return ticking;}
 function recoverWebImages(job,record,{force=false}={}){
  if(!webImageReader||!dreaminaWebRecoveryEligible(job,record))return;
  if(webRecoveries.has(job.id))return webRecoveries.get(job.id).done;
  if(webRecoveries.size)return;
  if(!force&&Date.now()-Date.parse(job.webResultCheckedAt||0)<(job.webResultError?300000:60000))return;
  const controller=new AbortController(),startEpoch=epoch,stopRevision=stopEvents.length;controller.record=record;webRecoveries.set(job.id,controller);
  controller.done=(async()=>{try{
   await requirePlugin(origin(record));await jobs.updateMediaGenerationJob({jobId:job.id,patch:{webResultCheckedAt:new Date().toISOString()}});
   const result=await webImageReader(webImageContext(job),{signal:controller.signal});
   if(!result?.items?.length||controller.signal.aborted||closed||startEpoch!==epoch||stopEvents.slice(stopRevision).some(match=>match(record)))return;
   const fresh=await owned(job.id);if(!dreaminaWebRecoveryEligible(fresh.job,fresh.record))return;
   if(result.items.length<=Number(fresh.job.partialAppliedCount||0))return;
   await jobs.updateMediaGenerationJob({jobId:job.id,patch:{webResultError:'',webResultErrorCode:'',webResultAvailableCount:result.items.length,nextPollAt:''}});
   if(fresh.job.status==='retry_required'){
    // Normal recover keeps the same task and enforces worker/account locks.
    await action('recover',{jobId:job.id,id:record.id,documentId:record.documentId,pluginId:origin(record)},true);
   }else{launchWorker({appRoot,jobId:job.id,settings:{}});}
  }catch(error){if(!controller.signal.aborted&&!closed)await jobs.updateMediaGenerationJob({jobId:job.id,patch:{webResultError:error.message,webResultErrorCode:error.code||'DREAMINA_WEB_RESULT_UNAVAILABLE'}}).catch(()=>{});}
  finally{webRecoveries.delete(job.id);}})();
  return controller.done;
 }
 async function runTick(){if(closed||busy)return;busy=true;try{const records=Object.values(await ledger.read()),seen=new Set();for(const r of records){if(!r.jobId||seen.has(r.jobId))continue;seen.add(r.jobId);try{const {job}=await owned(r.jobId,r);
    recoverWebImages(job,r);
    // A saved user stop is also a local abandonment. Finish it after restart
    // or a slow worker exit without asking the user to click a second button.
    if(job.abandonPendingAt||(job.userStoppedAt||r.stoppedAt)&&!job.queueDismissedAt&&!job.appliedAt){await abandonLocal(job,r,{explicitStop:true});continue;}
    if(r.nodeId&&!r.stoppedAt&&!r.recallArchivedAt&&!job.resultSuppressed&&job.desiredAction!=='cancel'&&job.incrementalImages&&job.status!=='complete'&&job.result?.attachments?.length>Number(job.partialAppliedCount||0)&&Number(job.partialApplyAttempts||0)<5)await apply(job.id);
    if(mediaNeedsAutomaticRelease(job)){await abandonLocal(job,r,{explicitStop:true,automaticFailure:!['cancelled','stopped','superseded'].includes(job.status)});continue;}
    if(r.recallArchivedAt&&!r.recallRequestedAt)continue;
    // Recovery labels can survive a successful download. A complete local
    // result still gets its first guarded card write; genuine write conflicts
    // and explicit pauses retain the existing manual-recovery protection.
    const readyForCard=job.status==='complete'&&(job.result?.attachment||job.result?.attachments?.length)&&!job.cardApplyError&&!job.cardApplyRetryPausedAt;
    if(mediaResultNeedsAttention(job)&&!r.recallRequestedAt&&!readyForCard){if(!job.deliveryDetachedAt)await jobs.updateMediaGenerationJob({jobId:job.id,patch:{deliveryDetachedAt:new Date().toISOString(),cardApplyRetryPausedAt:new Date().toISOString()}});continue;}
    if(r.recallRequestedAt&&['failed','retry_required'].includes(job.status)){
     await ledger.update(s=>{for(const record of Object.values(s))if(record.jobId===job.id)record.recallRequestedAt='';return s;});
     await jobs.updateMediaGenerationJob({jobId:job.id,patch:{recallRequestedAt:'',cardApplyRetryPausedAt:new Date().toISOString()}});continue;
    }
    if(r.stoppedAt)continue;
    if(job.status==='complete'&&!job.appliedAt&&!job.resultSuppressed&&!job.cardApplyRetryPausedAt&&(!job.cardApplyNextAttemptAt||Date.parse(job.cardApplyNextAttemptAt)<=Date.now()))await apply(job.id);
    // A short-lived authorized launcher can exit before its continuation timer.
    // The persistent host owns this ledger and observes the SAME accepted ID.
    // LibTV images also resume read/download for a known accepted task only.
    // No queued/unsubmitted, blocked, cancelled or unknown job is admitted.
    else if(acceptedVideoObservationDue(job,r)||acceptedLibTvImageObservationDue(job,r)||acceptedCanvasAudioObservationDue(job,r)){
     const prior=videoObservations.get(job.id),now=Date.now();
     if(!prior||prior.due!==job.nextPollAt||now-prior.at>=20000){
      const observationEpoch=epoch;
      await requirePlugin(origin(r));await models.assertAvailable(r.profileId);
      const fresh=await owned(job.id);
      if(!closed&&observationEpoch===epoch&&(acceptedVideoObservationDue(fresh.job,fresh.record)||acceptedLibTvImageObservationDue(fresh.job,fresh.record)||acceptedCanvasAudioObservationDue(fresh.job,fresh.record))){
       launchWorker({appRoot,jobId:job.id,settings:{}});videoObservations.set(job.id,{due:fresh.job.nextPollAt,at:now});
      }
     }
    }
    // H3's worker makes one durable observation then exits. Continue only a
    // known local task, using its original ID. This never submits a new task
    // and does not change the protected image/Dreamina continuation policy.
    else if(job.channel==='video'&&job.request?.settings?.provider==='本地 H3'&&job.providerTaskId&&['polling','running','downloading','cancel_requested'].includes(job.status)&&(!job.nextPollAt||Date.parse(job.nextPollAt)<=Date.now())){await requirePlugin(origin(r));await models.assertAvailable(r.profileId);launchWorker({appRoot,jobId:job.id,settings:{}});}
   }catch(error){if(!r.queueDismissedAt&&(error.code==='GENERATION_JOB_MISSING'||error instanceof SyntaxError))await releaseUnreadable(r,error).catch(()=>{});}}}finally{busy=false;}}
 async function recover(){await deferDreaminaQueueAtStartup();await tick();const seen=new Set();for(const r of Object.values(await ledger.read())){if(!r.jobId||r.stoppedAt||r.recallArchivedAt&&!r.recallRequestedAt||seen.has(r.jobId))continue;seen.add(r.jobId);try{const {job}=await owned(r.jobId,r);if(['complete','cancelled','superseded','failed'].includes(job.status)||mediaNeedsAutomaticRelease(job))continue;await requirePlugin(origin(r));const settings=await originalSettings(r,job);launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});}catch{/* Isolate a missing/corrupt record; never recreate it or block other tasks. */}}await tick();}
 async function stopOwned(job,record){if(job.dreaminaQueuePolicy){const stopped=await jobs.stopDreaminaQueueJob({jobId:job.id});const worker=await terminateWorker({jobId:job.id,pid:stopped.workerPid}),lease=await readDreaminaBrokerLease();if(worker.exited!==true||lease?.jobId===job.id)throw failure('停止意图已保存，凭证锁尚未确认释放，请稍后再次停止','STOP_PENDING');const final=await jobs.updateMediaGenerationJob({jobId:job.id,patch:{forceReleaseCompletedAt:new Date().toISOString()}});return {job:publicJob(final),worker,lockReleased:true};}const stopped=await jobs.requestMediaGenerationCancel({jobId:job.id});if(stopped.status!=='cancelled'){const settings=await originalSettings(record,job,{allowInactiveProvider:true});launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});}return {job:publicJob(stopped)};}
 async function stopAll(profileIds,filter={}){
  const ids=profileIds?new Set(profileIds):null;if(!ids&&!Object.keys(filter).length)epoch++;
  const selected=r=>(!ids||ids.has(r.profileId)||ids.has(r.runnerProfileId))&&matches(r,filter);
  stopEvents.push(selected);const pending=[...applying,...webRecoveries.values()].filter(c=>selected(c.record));for(const controller of pending)controller.abort();
  const records=await ledger.update(s=>{for(const r of Object.values(s))if(selected(r))r.stoppedAt=new Date().toISOString();return s;});
  const outcomes=[],seen=new Set();for(const record of Object.values(records)){
   if(!record.jobId||!selected(record)||seen.has(record.jobId))continue;seen.add(record.jobId);
   try{const {job}=await owned(record.jobId,record);
   if(job.appliedAt||['failed','superseded'].includes(job.status)||job.status==='cancelled'&&(!job.dreaminaQueuePolicy||job.forceReleaseCompletedAt))continue;
   const result=job.status==='complete'&&!job.dreaminaQueuePolicy?{job:publicJob(job,record)}:await stopOwned(job,record);outcomes.push({jobId:job.id,status:result.job.status});}catch(error){outcomes.push({jobId:record.jobId,pending:true,code:error.code||'STOP_UNCONFIRMED'});}
  }await Promise.allSettled(pending.map(c=>c.done));return {outcomes,pending:outcomes.some(r=>r.pending)};
 }
 async function releaseUnreadable(record,error){
  // A damaged task file must not leave an un-clearable owner. Only the exact
  // owned worker can be stopped; a target mismatch never enters this path.
  const at=new Date().toISOString();await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===record.jobId){r.stoppedAt||=at;r.failureReason||=error.message;}return s;});
  const worker=await terminateWorker({jobId:record.jobId}),lease=await readDreaminaBrokerLease(),pending=worker.exited!==true||lease?.jobId===record.jobId;
  if(!pending)await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===record.jobId)r.queueDismissedAt||=at;return s;});
  const live=Object.values(await ledger.read()).find(r=>r.jobId===record.jobId);return {job:recordFailure(record.jobId,live,error),localStopped:!pending,pending,warning:'原损坏记录保留，未重新提交；远端状态仍需核对。'};
 }
 async function abandonLocal(job,record,{explicitStop=false,automaticFailure=false,...body}={}){
  if(!explicitStop){const reason=queueAbandonRefusal(job,body);if(reason)throw failure(reason,'MEDIA_QUEUE_CHANGED');}
  if(job.queueDismissedAt)return {job:publicJob(job,record),localStopped:true};
  const stopped=await jobs.abandonMediaQueueJob({jobId:job.id,expectedUpdatedAt:body.expectedUpdatedAt,onlyFailed:body.onlyFailed,explicitStop,automaticFailure});
  if(!job.userAbandonedAt)stopEvents.push(r=>r.jobId===job.id);const pending=[...applying,...webRecoveries.values()].filter(c=>c.record.jobId===job.id);for(const c of pending)c.abort();
  await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)r.stoppedAt=stopped.userAbandonedAt;return s;});
  const worker=await terminateWorker({jobId:job.id,pid:stopped.workerPid});await Promise.allSettled(pending.map(c=>c.done));
  const lease=await readDreaminaBrokerLease();
  if(worker.exited!==true||lease?.jobId===job.id)return {job:publicJob(stopped,record),localStopped:false,pending:true,warning:'停止意图已保存，正在自动释放本地执行器；无需再次放弃任务。'};
  const now=new Date().toISOString(),final=await jobs.updateMediaGenerationJob({jobId:job.id,patch:{abandonPendingAt:'',queueDismissedAt:now,forceReleaseCompletedAt:now}});
  return {job:publicJob(final,record),localStopped:true,warning:final.localTrackingStopWarning};
 }
 async function action(action,body,webReady=false){
  const pluginId=pluginOf(body);await requirePlugin(pluginId);if(action==='submit')return submit(body);if(action==='list'){await tick();return list(body);}
  if(action==='credits')return accountCredits(body);
  if(action==='abandon'&&body.jobId?.startsWith('validation-')){const result=await rejectionLog.dismiss(body);if(!result)throw failure('校验记录不存在','MEDIA_JOB_NOT_OWNED');return result;}
  let ownedTask;try{ownedTask=await owned(body.jobId);}catch(error){if(!['stop','abandon'].includes(action)||error.code!=='GENERATION_JOB_MISSING'&&!(error instanceof SyntaxError))throw error;const record=Object.values(await ledger.read()).find(r=>r.jobId===body.jobId);if(!record||origin(record)!==pluginId||!matches(record,{id:body.id,documentId:body.documentId,conversationId:body.conversationId}))throw failure('任务不属于当前范围','MEDIA_JOB_NOT_OWNED');if(action==='abandon'){const reason=queueAbandonRefusal(recordFailure(body.jobId,record,error),body);if(reason)throw failure(reason,'MEDIA_QUEUE_CHANGED');}return releaseUnreadable(record,error);}const {job,record}=ownedTask;
  if(origin(record)!==pluginId||!matches(record,{id:body.id,documentId:body.documentId,conversationId:body.conversationId}))throw failure('任务不属于当前对话插件','MEDIA_JOB_NOT_OWNED');
  if(action==='open-original'){
   const provider=job.request?.settings?.provider,profile=job.request?.settings?.dreaminaCliProfile;
   if(['即梦','dreamina'].includes(provider)&&profile)return openDreaminaProfilePage({requestedProfileId:profile});
   // Use only persisted webpage receipts, never API endpoints or signed asset
   // URLs (which can contain credentials). Not every API exposes a task page.
   const value=job.providerTaskUrl||job.providerPageUrl||job.originalPageUrl;
   let url;try{url=new URL(value);}catch{}
   if(!url||!['https:','http:'].includes(url.protocol)||url.username||url.password||/[?&](?:token|key|signature|credential|authorization)=/i.test(url.search))throw failure('此配置未提供原任务网页链接；请到对应供应商后台按任务编号 '+(job.providerTaskId||job.id)+' 手动查找','MEDIA_ORIGINAL_PAGE_MISSING');
   return {url:url.href};
  }
  if(action==='recover'){
   if(record.recallArchivedAt||!mediaRecallable(job))throw failure('原任务已停止或不可找回','MEDIA_RECALL_CANCELLED');
   if(!webReady)recoverWebImages(job,record,{force:true});
   if((mediaOriginalResultPending(job)&&!job.result?.attachment&&!job.result?.attachments?.length)||(job.incrementalImages&&job.result?.attachments?.length<Number(job.request?.imageCount))){
    if(originalResultRecoveries.has(job.id))return originalResultRecoveries.get(job.id);
    const recovery=(async()=>{const settings=await originalSettings(record,job),fresh=await owned(job.id);
     if(!mediaRecallable(fresh.job)||fresh.record.stoppedAt||fresh.record.recallArchivedAt)throw failure('原任务已停止找回','MEDIA_RECALL_CANCELLED');
     if(['polling','running','downloading'].includes(fresh.job.status))return {job:publicJob(fresh.job,record),pending:true};
     await jobs.requestMediaGenerationResume({jobId:job.id,allowNewSubmission:false});
     const now=new Date().toISOString();await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)r.recallRequestedAt=now;return s;});
     const resumed=await jobs.updateMediaGenerationJob({jobId:job.id,patch:{resultRecoveryStartedAt:now,resultRecoveryExpiresAt:'',resultRecoveryAttempts:0,automaticRecoveryStoppedAt:'',recallRequestedAt:now,cardApplyRetryPausedAt:'',cardApplyNextAttemptAt:'',cardApplyError:'',deliveryDetachedAt:'',error:''}});
     launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});return {job:publicJob(resumed,record),pending:true};
    })();originalResultRecoveries.set(job.id,recovery);try{return await recovery;}finally{originalResultRecoveries.delete(job.id);}
   }
   if(job.result?.attachments?.length||job.result?.attachment){await Promise.allSettled([...applying].filter(c=>c.record.jobId===job.id).map(c=>c.done));if((await owned(job.id)).job.appliedAt)return {delivered:true};await jobs.updateMediaGenerationJob({jobId:job.id,patch:{status:'complete'}});const result=await apply(job.id);if(!result)throw failure('成品尚未完成回写，请稍后重试','MEDIA_RESULT_NOT_READY');return {result,delivered:true};}
   if(!job.providerTaskId||!['completed','succeeded'].includes(job.providerStatus))throw failure('缺少原任务完成凭据，未重新生成；请打开原网页核对','MEDIA_RESULT_NOT_READY');
   const exit=await terminateWorker({jobId:job.id,pid:job.workerPid}),lease=await readDreaminaBrokerLease();if(exit.exited!==true||lease?.jobId===job.id)throw failure('原下载执行器尚未退出，请稍后找回','STOP_PENDING');
   const settings=await originalSettings(record,job),fresh=await owned(job.id);if(!mediaRecallable(fresh.job)||fresh.record.stoppedAt||fresh.record.recallArchivedAt)throw failure('原任务已停止找回','MEDIA_RECALL_CANCELLED');
   const now=new Date().toISOString();await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)r.recallRequestedAt=now;return s;});
   await jobs.updateMediaGenerationJob({jobId:job.id,patch:{status:'downloading',sourceCompletedAt:job.sourceCompletedAt||job.completedAt||now,recallRequestedAt:now,nextPollAt:'',cardApplyRetryPausedAt:'',cardApplyError:'',error:''}});
   launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});return {pending:true};
  }
  if(action==='detach'||action==='recall'){
   if(!mediaRecallable(job))throw failure('此任务不能召回，未恢复或重新提交','MEDIA_RECALL_CANCELLED');
   const now=new Date().toISOString();
   await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)r.recallArchivedAt||=now;return s;});
   await jobs.updateMediaGenerationJob({jobId:job.id,patch:{recallArchivedAt:now,deliveryDetachedAt:now,cardApplyRetryPausedAt:now}});
   const pending=[...applying,...webRecoveries.values()].filter(c=>c.record.jobId===job.id);for(const c of pending)c.abort();await Promise.allSettled(pending.map(c=>c.done));
   const exit=await terminateWorker({jobId:job.id,pid:job.workerPid}),lease=await readDreaminaBrokerLease();if(exit.exited!==true||lease?.jobId===job.id)throw failure('原执行器正在退出，尚未安全释放；请稍后重试','STOP_PENDING');
   const fresh=await owned(job.id);if(fresh.record.stoppedAt||fresh.job.resultSuppressed)throw failure('此任务已停止召回','MEDIA_RECALL_CANCELLED');
   if(action==='recall'&&!fresh.job.result?.attachment&&!fresh.job.result?.attachments?.length&&!fresh.job.result?.text){
    if(!fresh.job.providerTaskId||!['completed','succeeded'].includes(fresh.job.providerStatus))throw failure('原成品缺少可靠的远端完成记录，未重新提交','MEDIA_RESULT_NOT_READY');
    const settings=await originalSettings(record,job);
    await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)r.recallRequestedAt=now;return s;});
    await jobs.updateMediaGenerationJob({jobId:job.id,patch:{status:'downloading',recallRequestedAt:now,nextPollAt:'',cardApplyRetryPausedAt:'',cardApplyError:''}});
    launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});return {job:publicJob((await owned(job.id)).job),pending:true};
   }
   if(action==='recall'){
    await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)r.recallRequestedAt=now;return s;});
    const incomplete=job.incrementalImages&&job.result?.attachments?.length<Number(job.request?.imageCount);
    await jobs.updateMediaGenerationJob({jobId:job.id,patch:{...incomplete?{}:{status:'complete'},recallRequestedAt:now,cardApplyError:''}});
    const result=await apply(job.id);if(!result)throw failure('原成品尚未写入历史，请稍后重试','MEDIA_RESULT_NOT_READY');return {job:publicJob((await owned(job.id)).job,(await owned(job.id)).record),result,delivered:true,destination:'history'};
   }
   return {job:publicJob(fresh.job,fresh.record)};
  }
  if(action==='abandon'||action==='stop')return abandonLocal(job,record,{...body,explicitStop:action==='stop'});
  if(action==='apply')return {result:await apply(body.jobId)};
  if(action==='reorder'){if(body.targetJobId)await owned(body.targetJobId);await jobs.reorderDreaminaQueue({jobId:job.id,targetJobId:body.targetJobId,placement:body.placement,direction:body.direction});return list(body);}
  if(action==='resume'){const settings=await originalSettings(record,job);if(dreaminaIdentityBlockedBeforeSubmission(job))await jobs.repairUnsubmittedDreaminaIdentity({jobId:job.id,settings});const resumed=await jobs.requestMediaGenerationResume({jobId:job.id,allowNewSubmission:false});await ledger.update(s=>{for(const r of Object.values(s))if(r.jobId===job.id)delete r.stoppedAt;return s;});launchWorker({appRoot,jobId:job.id,settings:{apiKey:settings.apiKey||''}});return {job:publicJob(resumed)};}
  throw failure('未提供的媒体任务操作');
 }
 // Controlled acceptance can use the normal submit/apply path without
 // recovering unrelated original jobs. Desktop defaults stay unchanged.
 const timer=automatic?setInterval(()=>void tick().catch(()=>{}),2000):null;timer?.unref();if(recoverOnStart)void recover().catch(()=>{});
 return {action,list,stopAll,stopScope:filter=>stopAll(null,filter),stopProfiles:ids=>stopAll(ids),close:async()=>{closed=true;clearInterval(timer);const pending=[...applying,...webRecoveries.values()];for(const c of pending)c.abort();await Promise.allSettled(pending.map(c=>c.done));},tick};
}
