// Local scheduling records are conservative reservations, never an assertion
// about the provider's remaining balance. Only an owned explicit rejection can
// release an attempted slot or transfer a request to another account.
export const doubaoQuotaDay=(value=Date.now())=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
// Unknown provider recovery is a local recheck delay, never a quota reset.
export const DOUBAO_QUOTA_RECHECK_MS=15*60*1000;
const terminal=new Set(['complete','failed','stopped']);
// Only parse the explicit provider recovery timestamp, never infer an account
// balance or treat a hypothetical quota sentence as an observed rejection.
export function doubaoQuotaResetAt(message,at=Date.now()){
 const text=String(message||''),observedTime=new Date(at).getTime();if(!Number.isFinite(observedTime)||/(?:如果|假设|例如).{0,30}(?:恢复|刷新|重置)/.test(text))return '';
 const relative=/(\d{1,3})\s*(小时|分钟|分|秒)\s*后\s*(?:恢复|刷新|重置)/.exec(text);if(relative){const n=Number(relative[1]),ms={小时:3600000,分钟:60000,分:60000,秒:1000}[relative[2]];return n>0&&n*ms<=370*86400000?new Date(observedTime+n*ms).toISOString():'';}
 const daily=/(今日|今天|明日|明天)\s*(\d{1,2})(?:[:：](\d{2})|点(?:\s*(\d{1,2})分)?)\s*(?:恢复|刷新|重置)/.exec(text);if(daily){const local=new Date(observedTime+8*3600000),hour=Number(daily[2]),minute=Number(daily[3]||daily[4]||0);if(hour>23||minute>59)return '';const value=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+(daily[1].startsWith('明')?1:0),hour-8,minute);return value>observedTime?new Date(value).toISOString():'';}
 const match=/(?:预计|将于|于)?\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})[:：](\d{2})\s*(?:恢复|刷新|重置)/.exec(text);if(!match)return '';
 const observed=new Date(at).getTime();if(!Number.isFinite(observed))return '';
 const [,year,month,day,hour,minute]=match,local=new Date(observed+8*3600000),baseYear=Number(year||local.getUTCFullYear());
 const stamp=y=>Date.UTC(y,Number(month)-1,Number(day),Number(hour)-8,Number(minute));let value=stamp(baseYear);
 if(!year&&value<observed&&local.getUTCMonth()===11&&Number(month)===1)value=stamp(baseYear+1);
 const parsed=new Date(value+8*3600000);if(parsed.getUTCMonth()+1!==Number(month)||parsed.getUTCDate()!==Number(day)||parsed.getUTCHours()!==Number(hour)||parsed.getUTCMinutes()!==Number(minute)||value<=observed||value-observed>370*86400000)return '';
 return new Date(value).toISOString();
}
// resetAt is the provider's statement, not our scheduling clock. A cooldown
// expiry only permits another attempt; it never asserts restored credit.
export const doubaoExhaustionRecord=(at,resetAt='')=>({day:doubaoQuotaDay(at),at,...resetAt?{resetAt,cooldownUntil:resetAt,recoverySource:'provider'}:{nextCheckAt:new Date(Date.parse(at)+DOUBAO_QUOTA_RECHECK_MS).toISOString(),recoverySource:'unknown'}});
const rejectionTime=record=>Date.parse(record?.at||record?.rejectedAt||(/^\d{4}-\d{2}-\d{2}$/.test(record?.day||'')?record.day+'T23:59:59.999+08:00':''));
export function doubaoQuotaRecovery(state,accountId,kind){
 const records=[state.accounts?.find(a=>a.id===accountId)?.exhausted?.[kind]];
 // Read old journals without modifying their history or replaying them.
 for(const t of state.tasks||[]){if(t.kind!==kind)continue;
  if(t.accountId===accountId&&t.status==='failed'&&t.code==='DOUBAO_QUOTA_EXHAUSTED'&&t.submittedAt&&t.userId&&t.remoteMayBeRunning===false)records.push({at:t.failedAt||t.updatedAt||t.submittedAt,resetAt:t.quotaResetAt,message:t.message});
  records.push(...(t.attempts||[]).filter(a=>a.accountId===accountId&&a.reason==='quota_exhausted'&&a.acceptedGeneration===false&&a.userId));
 }
 const latest=records.filter(r=>Number.isFinite(rejectionTime(r))).sort((a,b)=>rejectionTime(b)-rejectionTime(a)||Number(!!b.resetAt)-Number(!!a.resetAt))[0];if(!latest)return {resetAt:'',nextCheckAt:'',exhaustedAt:'',source:'none'};
 const at=rejectionTime(latest),resetAt=latest.resetAt||doubaoQuotaResetAt(latest.providerMessage||latest.message,at),verified=Date.parse(resetAt)>at?new Date(resetAt).toISOString():'';
 return {resetAt:verified,nextCheckAt:verified||new Date(at+DOUBAO_QUOTA_RECHECK_MS).toISOString(),exhaustedAt:new Date(at).toISOString(),source:verified?'provider':'unknown'};
}
export const doubaoCooldownUntil=(state,accountId,kind)=>doubaoQuotaRecovery(state,accountId,kind).nextCheckAt;
export function doubaoQuotaExhausted(state,accountId,kind,day=doubaoQuotaDay(),at=Date.now()){
 return Date.parse(doubaoCooldownUntil(state,accountId,kind))>new Date(at).getTime();
}
export function doubaoAccountUsage(state,accountId,day=doubaoQuotaDay(),at=Date.now()){
 const kinds={};for(const kind of ['text','image','video']){
  const receipts=[];for(const t of state.tasks||[]){if(t.kind!==kind)continue;
   if(t.accountId===accountId&&t.submittedAt&&t.userId)receipts.push(t.submittedAt);
   for(const a of t.attempts||[])if(a.accountId===accountId&&a.submittedAt&&a.userId)receipts.push(a.submittedAt);
  }
  const today=receipts.filter(t=>doubaoQuotaDay(t)===day),recovery=doubaoQuotaRecovery(state,accountId,kind),cooldownUntil=recovery.nextCheckAt;
  kinds[kind]={todayCount:today.length,usedToday:today.length>0,lastUsedAt:receipts.sort().at(-1)||'',exhausted:Date.parse(cooldownUntil)>new Date(at).getTime(),cooldownUntil,...recovery,needsQuotaCheck:!!recovery.exhaustedAt&&Date.parse(cooldownUntil)<=new Date(at).getTime()};
 }
 return {day,kinds,usedToday:Object.values(kinds).some(k=>k.usedToday)};
}
// A transient probe without a profile menu is not evidence of logout. Older
// workspaces have no authenticatedAt, but a completed owned trial is evidence
// that this exact account space was authenticated. Prepare still checks the
// live page before every send. Verification remains a report, not an entry gate.
export const doubaoAccountReady=a=>!!a&&!a.deletedAt&&!a.deleting&&a.enabled===true&&a.loginState!=='signed_out'&&
 (a.loginState==='authenticated'||!!a.authenticatedAt||Object.values(a.verified||{}).some(v=>!!v?.taskId));
export function doubaoVideoSlots(state,accountId,day=doubaoQuotaDay(),excludeId){
 return state.tasks.filter(t=>t.id!==excludeId&&t.accountId===accountId&&t.kind==='video'&&(Number(t.durationSeconds)===15||!t.durationSeconds&&matchesDoubaoDuration({durationSeconds:15},t.confirmationDetails))&&
  (t.usageDay||(t.submittedAt?doubaoQuotaDay(t.submittedAt):''))===day&&
  (!!t.submittedAt||!!t.reservedAt&&!terminal.has(t.status))).length;
}
export function selectDoubaoAccount(state,task,day=doubaoQuotaDay(),at=Date.now()){
 const own=state.accounts?.find(a=>a.id===task.accountId);
 // Existing journals and explicit connection trials retain their exact account.
 if(!task.allowAccountRotation)return doubaoQuotaExhausted(state,task.accountId,task.kind,day,at)?undefined:task.accountId;
 const others=(state.accounts||[]).filter(a=>a.id!==task.accountId).map(a=>({a,usage:doubaoAccountUsage(state,a.id,day,at).kinds[task.kind]}));
 // Continue the current account until an explicit rejection; prefer unused
 // accounts at handoff, then least recently used. No guessed daily cap.
 others.sort((a,b)=>Number(a.usage.usedToday)-Number(b.usage.usedToday)||a.usage.lastUsedAt.localeCompare(b.usage.lastUsedAt));
 const accounts=[own,...others.map(v=>v.a)].filter(Boolean);
 const eligible=accounts.filter(a=>doubaoAccountReady(a)&&(a.id===task.accountId||a.loginState==='authenticated')&&
  // Task-owned pages can queue behind a known send in progress. The per-account
  // drain still waits for its receipt before preparing the next request.
  !state.tasks.some(t=>t.id!==task.id&&t.accountId===a.id&&(['unknown_submission','blocked','confirmation_required'].includes(t.status)||t.status==='submit_intent'&&!(task.isolatedPage&&t.isolatedPage)||t.status==='stopped'&&(t.remoteMayBeRunning||t.abandonPendingAt)&&!t.accountSlotReleasedAt))&&
  !doubaoQuotaExhausted(state,a.id,task.kind,day,at));
 // Pool requests may use another idle owned account immediately. Preserve the
 // current account on equal load, and never move already submitted work.
 const load=a=>state.tasks.filter(t=>t.id!==task.id&&t.accountId===a.id&&!terminal.has(t.status)&&t.status!=='quota_waiting').length;
 if(!task.submittedAt&&!task.remoteMayBeRunning)eligible.sort((a,b)=>load(a)-load(b));
 return eligible[0]?.id;
}
export const doubaoNoReadyAccountMessage='当前没有可接替此任务的账号：请检查登录、网页恢复时间或未决任务；未重新发送。';
export function doubaoWaitingState(state,task,at=Date.now()){
 const accounts=(state.accounts||[]).filter(a=>!a.deletedAt&&!a.deleting&&a.enabled&&(task.allowAccountRotation||a.id===task.accountId));
 const all=task.allowAccountRotation===true&&accounts.length>0&&accounts.every(a=>doubaoAccountReady(a)&&doubaoQuotaExhausted(state,a.id,task.kind,doubaoQuotaDay(at),at));
 return {status:'quota_waiting',remoteMayBeRunning:false,code:all?'DOUBAO_ALL_QUOTAS_EXHAUSTED':'DOUBAO_NO_READY_ACCOUNT',message:all?'所有可调度账号的'+({text:'文本',image:'图片',video:'视频'}[task.kind])+'额度均已明确耗尽。可新增账号或取消本任务；恢复时间以各账号网页提示为准，未公布时等待核验。':doubaoNoReadyAccountMessage};
}
export function doubaoQuotaNotices(state,at=Date.now()){
 return (state.tasks||[]).filter(t=>t.status==='quota_waiting'&&!t.submittedAt&&!t.remoteMayBeRunning&&doubaoWaitingState(state,t,at).code==='DOUBAO_ALL_QUOTAS_EXHAUSTED').map(t=>{
  const cooling=(state.accounts||[]).filter(a=>doubaoAccountReady(a)&&(t.allowAccountRotation||a.id===t.accountId)).map(a=>({id:a.id,until:doubaoCooldownUntil(state,a.id,t.kind)}));
  return {taskId:t.id,kind:t.kind,key:[t.id,...cooling.map(a=>a.id+'@'+a.until)].join('|'),cooldownUntil:cooling.map(a=>a.until).sort()[0]};
 });
}
export function canTransferDoubaoQuota(task,seen){
 const confirmationsResolved=task.confirmationRounds?.length?task.confirmationRounds.every(r=>!r.intentAt||r.sentAt||r.acknowledgedAt):!task.confirmationIntentAt||!!task.confirmationSentAt;
 return task.allowAccountRotation===true&&(!seen.gate||seen.gate==='quota_or_rate_limit')&&seen.quota?.exhausted===true&&seen.quota?.rejected===true&&seen.quota.kind===task.kind&&
  seen.ack===true&&!!seen.userId&&(!task.userId||seen.userId===task.userId)&&!seen.waiting&&!seen.stopping&&!seen.artifacts?.length&&
  !seen.confirmation&&confirmationsResolved;
}
export function matchesDoubaoDuration(task,details){
 if(Number(task.durationSeconds)!==15)return true;
 const durations=[...String(details?.summary||'').matchAll(/(\d+(?:\.\d+)?)\s*(?:秒|s\b)/gi)].map(m=>Number(m[1]));
 return durations.length>0&&durations.every(n=>n===15);
}
export function doubaoTaskAccountDetails(task,accounts=[]){
 const account=accounts.find(a=>a.id===task.accountId),accountName=account?account.accountName||'':task.accountName||'',accountRemark=account?account.remark??account.name??'':task.accountRemark||'';
 return {accountName,accountRemark,accountLabel:accountRemark&&accountRemark!=='新账号'?accountRemark:accountName||(!account&&task.accountLabel)||'豆包账号 · '+String(task.accountId||'未知').slice(-8)};
}
