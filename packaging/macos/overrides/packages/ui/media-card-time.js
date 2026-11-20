import {visibleMediaTask,mediaRecallable} from './media-task-policy.js';
import {cardAwaitingMoreImages} from './media-card-job.js';

export function formatMediaTime(ms){
 if(!Number.isFinite(ms))return '—:—';
 const seconds=Math.floor(Math.max(0,ms)/1000),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
 return (hours?hours+':':'')+String(hours?minutes%60:minutes).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
export function formatGenerationDuration(ms){
 const seconds=Math.floor(Math.max(0,ms)/1000);
 return seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+String(seconds%60).padStart(2,'0')+'秒';
}
// UI-only timing. Never change a task's state or write to the document.
export function mediaCardTime(job,now,frozenEnd){
 const start=[job.startedAt,job.createdAt].map(v=>Date.parse(v||'')).find(Number.isFinite);
 // A browser result can be complete remotely while its download/writeback is
 // awaiting recovery. Do not count that local delay as provider generation.
 const sourceEnd=Date.parse(job.sourceCompletedAt||'');
 // A duplicate-submit fence is not proof that generation is still running.
 const ended=!cardAwaitingMoreImages(job)&&(!!job.userAbandonedAt||Number.isFinite(sourceEnd)||mediaRecallable(job)||['complete','failed'].includes(job.status)||!visibleMediaTask(job));
 const knownEnd=Number.isFinite(sourceEnd)?sourceEnd:[job.autoFailedAt&&job.failedAt,job.userStoppedAt,job.userAbandonedAt,job.completedAt,job.cancelledAt,job.failedAt,job.supersededAt,job.appliedAt].map(v=>Date.parse(v||'')).find(Number.isFinite);
 const updated=Date.parse(job.updatedAt||'');
 const end=ended?(knownEnd??frozenEnd??(Number.isFinite(updated)?updated:now)):undefined;
 // A recoverable pause is not a terminal end: never persist it in frozenEnds.
 const paused=(!!job.observationPausedAt||job.source==='doubao-browser'&&job.status==='retry_required')&&!ended;
 const pauseEnd=paused?[job.observationPausedAt,job.pausedAt,job.updatedAt,job.createdAt].map(v=>Date.parse(v||'')).find(Number.isFinite):undefined;
 if(paused){const elapsed=Number.isFinite(start)&&Number.isFinite(pauseEnd)?Math.max(0,pauseEnd-start):NaN;return {text:'等待已暂停'+(Number.isFinite(elapsed)?' · 已等待：'+formatGenerationDuration(elapsed):''),end:undefined};}
 const elapsed=Number.isFinite(start)?Math.max(0,(end??now)-start):Number.isFinite(job.elapsedMs)?job.elapsedMs:NaN;
 return {text:Number.isFinite(elapsed)?'生成用时：'+formatGenerationDuration(elapsed):'生成用时：待计时',end};
}
