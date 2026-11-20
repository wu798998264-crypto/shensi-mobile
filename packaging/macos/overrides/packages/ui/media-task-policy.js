const ended=new Set(['cancelled','stopped','superseded']);
const uncertain=new Set(['unknown','uncertain','submitting','recovery_unavailable']);
export const mediaTaskUncertain=job=>!!job.billingRisk||uncertain.has(job.submissionState)||job.remoteMayBeRunning===true;
export const mediaHasSavedResult=job=>!!(typeof job.result?.text==='string'&&job.result.text.trim()||job.result?.attachment||job.result?.attachments?.length||job.sourceCompletedAt||job.providerTaskId&&['completed','succeeded'].includes(job.providerStatus));
export const mediaOriginalResultPending=job=>!!job?.providerTaskId&&!ended.has(job.status)&&!['failed','error','rejected','cancelled','canceled','stopped'].includes(String(job.providerStatus||'').toLowerCase())&&['即梦','dreamina'].includes(job.request?.settings?.provider)&&(job.resultReconciliationPending===true||job.providerErrorCode==='DREAMINA_RESULT_PENDING');
export const mediaWaitingParameters=job=>!job.autoFailedAt&&!job.stoppedAt&&!job.userAbandonedAt&&(job.confirmationWaiting===true||job.availableActions?.confirmParameters===true||job.status==='confirmation_required');
// A queue response can lag behind the durable card writeback. The card's
// receipt is authoritative for presentation, so a matching ID leaves the
// active queue even when the response still says polling.
export const mediaQueueResolvedByCard=(job,appliedJobIds)=>!!job?.appliedAt||!!appliedJobIds?.has?.(job?.id);
// A local spinner or a submitted receipt alone does not prove rendering.
export function mediaStopNeedsConfirmation(job){
 if(!job||job.source==='local-submission'||job.appliedAt||mediaWaitingParameters(job)||mediaFailureEvidence(job)||mediaHasSavedResult(job))return false;
 const phase=String(job.generationState||job.providerStatus||'').toLowerCase();
 if(['queued','pending','waiting','scheduled','not_submitted'].includes(phase))return false;
 return !!job.generationStartedAt||['generating','running','rendering','processing','in_progress'].includes(phase);
}
const failedStates=new Set(['failed','retry_required','blocked','unknown_submission','reconciliation_required','waiting_credentials','waiting_storage']);
// Trust terminal receipts even when a stale local label still says polling.
export const mediaFailureEvidence=job=>failedStates.has(job.status)||ended.has(job.status)||job.runtimeNeedsAttention===true||!!job.autoFailedAt||!!job.failedAt||['failed','error','rejected','cancelled','canceled','stopped'].includes(String(job.providerStatus||'').toLowerCase());
export const mediaRecallable=job=>!job.appliedAt&&!job.userStoppedAt&&(job.canRecoverOriginal===true||!job.stoppedAt&&!job.resultSuppressed&&!job.userAbandonedAt&&!job.queueDismissedAt&&(mediaHasSavedResult(job)||job.status==='complete'||mediaOriginalResultPending(job)));
export const mediaResultNeedsAttention=job=>!job.appliedAt&&!job.resultSuppressed&&!job.queueDismissedAt&&!job.userAbandonedAt&&(mediaHasSavedResult(job)||mediaOriginalResultPending(job))&&!!(job.recoveryState||job.recoveryError||job.cardApplyError||job.runtimeNeedsAttention||failedStates.has(job.status));
// Failure ends local scheduling, not the remote receipt or saved output. A live
// submit/poll is not failed merely because its billing outcome is uncertain.
export const mediaNeedsAutomaticRelease=job=>!job.appliedAt&&!job.queueDismissedAt&&!mediaWaitingParameters(job)&&!mediaHasSavedResult(job)&&!mediaOriginalResultPending(job)&&mediaFailureEvidence(job);
export function visibleMediaTask(job){
 if(job.abandonPendingAt||job.forceReleasePendingAt&&!job.forceReleaseCompletedAt)return false;
 if(job.queueDismissedAt||job.cardDismissedAt||job.userAbandonedAt||job.resultSuppressed||job.recallArchivedAt)return false;
 if(ended.has(job.status)||job.appliedAt)return false;
 if(mediaWaitingParameters(job)||mediaResultNeedsAttention(job))return true;
 if(mediaNeedsAutomaticRelease(job))return false;
 return true;
}
// Queue history is not an active task and must not affect clocks/submit locks.
export const visibleMediaQueueTask=visibleMediaTask;
export const mediaQueueCanReorder=job=>job.queueReorderable===true&&job.queuePosition>0&&job.status==='queued'&&!job.providerTaskId&&!job.dreaminaDispatching&&!mediaWaitingParameters(job)&&!mediaFailureEvidence(job)&&visibleMediaQueueTask(job);
export const blockedMediaTask=mediaResultNeedsAttention;

// Same presentation groups as the original task feed. Scheduling is owned by
// the provider queue, never by this sort or a color in the renderer.
export function mediaQueueGroup(job){
 if(mediaWaitingParameters(job))return 'queued';
 if(mediaResultNeedsAttention(job))return 'attention';
 if(job.status==='cancel_requested')return 'running';
 if(job.status==='queued'&&(!job.providerTaskId||job.source==='doubao-browser'||job.source==='text-reader')&&!job.dreaminaDispatching)return 'queued';
 return 'running';
}
export const clearableMediaQueueTask=job=>!job.appliedAt&&!job.queueDismissedAt&&!job.validationRejectedAt&&!job.preSubmitRejectedAt&&!(job.accountSlotReleasedAt&&ended.has(job.status))&&!mediaWaitingParameters(job)&&(mediaResultNeedsAttention(job)||mediaFailureEvidence(job)||!!job.abandonPendingAt||!!job.forceReleasePendingAt&&!job.forceReleaseCompletedAt);
export function sortMediaQueue(jobs){
 const ranks={running:0,queued:1,attention:2};
 return [...jobs].sort((a,b)=>ranks[mediaQueueGroup(a)]-ranks[mediaQueueGroup(b)]||
  (mediaQueueGroup(a)==='queued'?((a.queuePosition||Infinity)-(b.queuePosition||Infinity)):0)||
  (Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)||String(a.id).localeCompare(String(b.id)));
}
export function queueAbandonRefusal(job,{confirmed,expectedUpdatedAt,onlyFailed=false}={}){
 if(confirmed!==true)return '请先确认放弃任务；远端可能仍在运行或产生费用。';
 if(job.queueDismissedAt)return '';
 if(!job.abandonPendingAt&&(!expectedUpdatedAt||job.updatedAt!==expectedUpdatedAt))return '任务状态已变化，请刷新后再操作。';
 if(onlyFailed&&!clearableMediaQueueTask(job))return '任务已不再是失败或阻塞项，本次已跳过。';
 return '';
}
