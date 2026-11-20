import {visibleMediaTask,mediaRecallable,mediaHasSavedResult,mediaFailureEvidence,mediaWaitingParameters,mediaOriginalResultPending} from './media-task-policy.js';
// A card's current attempt is defined by submission order, never by whether an
// older attempt is still visible in the queue. Keep uncertain old jobs in the
// queue without letting them repaint a newer result's clock or stop button.
export function currentMediaCardJobs(jobs=[],nodes=[]){
 const current=new Map(),bound=new Map(nodes.map(n=>[n.id,n.coreMediaJobId||n.generation?.jobId]));
 const created=j=>Date.parse(j.createdAt||'')||0;
 for(const job of jobs){
  const id=job.target?.nodeId;if(!id)continue;const previous=current.get(id);
  if(!previous||created(job)>created(previous)||created(job)===created(previous)&&job.id===bound.get(id))current.set(id,job);
 }
 // Copies inherit a completed receipt's timing, with their own acknowledgement
 // identity. They never inherit its provider ID, actions or running state.
 const byId=new Map(jobs.map(job=>[job.id,job]));
 for(const node of nodes){
  if(current.has(node.id)||node.coreMediaJobId)continue;
  const source=byId.get(node.coreCopiedFrom?.mediaJobId);
  if(!source?.appliedAt||source.status!=='complete'||source.resultSuppressed)continue;
  const timing={};for(const key of ['createdAt','startedAt','sourceCompletedAt','completedAt','appliedAt','updatedAt','elapsedMs'])if(source[key]!==undefined)timing[key]=source[key];
  current.set(node.id,{...timing,id:source.id+':copy:'+node.id,status:'complete',target:{nodeId:node.id}});
 }
 return current;
}
export const mediaCardCanStop=job=>!job.abandonPendingAt&&!job.userAbandonedAt&&!job.stoppedAt&&visibleMediaTask(job)&&(mediaRecallable(job)||!['complete','failed','cancelled','stopped','cancel_requested','superseded'].includes(job.status)&&job.availableActions?.stop===true);
// Automatic queue cleanup must not erase the last attempt's failure receipt.
export const mediaCardHidden=job=>!!job.cardDismissedAt||!!job.recallArchivedAt||!!job.userStoppedAt&&(!job.autoFailedAt||job.source==='doubao-browser')||!job.autoFailedAt&&!!(job.userAbandonedAt||job.queueDismissedAt||job.stoppedAt);

// Board commits and provider polls arrive independently. Project only the
// selected attempt's durable writeback onto the card, never onto the queue.
export function cardJobAfterWriteback(job,node,receipt,assets){
 if(!job||job.appliedAt||mediaCardHidden(job)||node.coreMediaJobId!==job.id)return job;
 if(receipt?.jobId!==job.id||receipt.nodeId!==node.id||receipt.documentId!==job.target?.documentId)return job;
 let appliedAt=receipt.createdAt;
 if(receipt.incremental){
  const count=Number(job.request?.imageCount??job.imageCount);
  if(!Number.isInteger(count)||count<1||receipt.attachments?.length!==count)return job;
  if(count>1)appliedAt=assets?.find(asset=>asset.id===job.id+'-'+(count-1)&&asset.generationJobId===job.id&&asset.sourceNodeId===node.id)?.createdAt;
 }
 if(!Number.isFinite(Date.parse(appliedAt)))return job;
 return {...job,status:'complete',appliedAt,confirmationWaiting:false,availableActions:{}};
}

export function cardAwaitingMoreImages(job){
 const count=job.result?.attachments?.length||job.partialAppliedCount||0;
 return job.incrementalImages===true&&job.channel==='image'&&count>0&&count<Number(job.request?.imageCount)
  &&['running','polling','downloading'].includes(job.status)&&!job.appliedAt&&!job.recoveryState&&!job.observationPausedAt
  &&job.desiredAction!=='cancel'&&!mediaCardHidden(job)&&!mediaFailureEvidence(job);
}

// Card receipts outlive queue occupancy. Recovery never becomes a new order.
export function mediaCardOutcome(job){
 if(!job||mediaCardHidden(job)||job.appliedAt||mediaWaitingParameters(job)||cardAwaitingMoreImages(job))return '';
 if(mediaRecallable(job)){if(job.recoveryState==='running'||mediaOriginalResultPending(job)&&['polling','running','downloading'].includes(job.status))return 'recovering';if(job.recoveryError)return 'recovery-failed';if(mediaHasSavedResult(job)||job.status==='complete'||mediaOriginalResultPending(job))return 'recoverable';}
 if(mediaFailureEvidence(job))return 'failed';
 return '';
}
export function mediaCardFailureReason(job){
 const detail=job.providerRawError&&/^(?:供应商生成失败|生成失败|generation failed)$/i.test(job.failureReason?.trim())?job.providerRawError:job.failureReason;
 const reason=job.recoveryError||job.cardApplyError||job.webResultError||detail||job.autoFailureReason||job.providerRawError||job.error||job.runtimeAttentionReason||job.message||(mediaRecallable(job)?'原成品尚未回写，可点击找回。':'未取得有效生成结果，请检查配置后重试。');
 const prefix=job.accountLabel?'账号「'+job.accountLabel+'」':job.request?.settings?.name?'配置「'+job.request.settings.name+'」（'+(job.request.settings.adapter==='cli'?'CLI':job.request.settings.adapter==='api'?'API':job.request.settings.provider||'生成')+'）':'';
 return prefix&&!reason.startsWith(prefix)?prefix+'：'+reason:reason;
}
