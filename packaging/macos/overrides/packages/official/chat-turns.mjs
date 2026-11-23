// A sent attachment belongs to a request, never to the next composer draft.
const attachmentKey=a=>JSON.stringify([a.notebookId,a.documentId,a.relativePath]);
export function takeAttachments(conversation,attachments){
 const sent=new Set(attachments.map(attachmentKey));
 conversation.attachments=(conversation.attachments||[]).filter(a=>!sent.has(attachmentKey(a)));
}
export function updateTurn(conversation,requestId,patch){
 const message=conversation.messages.find(m=>m.role==='user'&&m.requestId===requestId);
 if(message?.run)Object.assign(message.run,patch);
}
// Persist only actionable, sanitized diagnostics, never raw requests/responses.
export function turnErrorDetails(error){
 const details={};
 for(const key of ['providerHttpStatus','retryAfterSeconds'])if(Number.isFinite(error[key]))details[key]=error[key];
 for(const key of ['providerCode','providerParam','providerDetail','networkCode','retryAt'])if(error[key])details[key]=String(error[key]).replace(/\b(?:sk|ds|api)[-_][A-Za-z0-9_-]{12,}\b/gi,'[已隐藏]').replace(/Bearer\s+[^\s"',;]+/gi,'Bearer [已隐藏]').slice(0,key==='providerDetail'?600:100);
 if(error.requestDiagnostics)details.requestDiagnostics=Object.fromEntries(['bodyBytes','inlineImageCount'].filter(k=>Number.isFinite(error.requestDiagnostics[k])).map(k=>[k,error.requestDiagnostics[k]]));
 const mismatch=error.toolOutputMismatch;
 if(mismatch&&['receipt_missing','arguments_mismatch','call_mismatch','content_mismatch'].includes(mismatch.reason))details.toolOutputMismatch={reason:mismatch.reason,...Object.fromEntries(['namespace','tool'].filter(k=>typeof mismatch[k]==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(mismatch[k])).map(k=>[k,mismatch[k]]))};
 return details;
}
// Restore only user-visible execution evidence, never provider reasoning or
// raw tool payloads. The next turn must read the actual saved objects.
export function priorTurnProgress(conversation,currentRequestId){
 const turns=conversation.messages.filter(m=>m.role==='user'&&m.requestId!==currentRequestId&&m.run);
 return {omittedTurns:Math.max(0,turns.length-6),turns:turns.slice(-6).map(m=>{
  const events=m.run.events||[],significant=events.filter(e=>['progress','text_delta','document_saved','media_submitted','tool_failure'].includes(e.phase));
  return {requestId:m.requestId,status:m.run.status,error:m.run.error||'',checkpoint:m.run.checkpoint||null,
   omittedEvents:Math.max(0,significant.length-8),events:significant.slice(-8).map(e=>({phase:e.phase,...(e.receipt?{receipt:e.receipt}:{}),...(e.phase==='tool_failure'?{name:e.name,error:e.error,code:e.code}:{}),...(e.text?{text:e.text.slice(-2000),truncated:e.text.length>2000}:{})})),
   lastTools:events.filter(e=>e.phase==='completed').slice(-5).map(e=>({name:e.name,success:e.success}))};
 })};
}
// Old builds labelled a restart-interrupted turn as failed and retained the
// previous provider's code. Only the app's exact interruption marker qualifies.
export function turnFailure(conversation,turn){
 const run=turn?.run;if(!run)return null;
 const current=conversation?.requestId===turn.requestId;
 // One conversation executes serially. A prior still-running turn after a
 // newer request is an abandoned local execution, never a provider failure.
 if(run.status==='running'&&(!current||conversation.status==='interrupted'))return {status:'interrupted',error:'上次请求已中断，结果未知。未自动重发。',errorCode:'CHAT_REQUEST_INTERRUPTED'};
 if(!['failed','stopped','interrupted'].includes(run.status))return null;
 const error=run.error||(current?conversation.error:'')||'';
 const restart=error==='上次请求已中断，结果未知。未自动重发。',interrupted=run.status==='interrupted'||restart;
 return {status:interrupted?'interrupted':run.status,error,errorCode:interrupted?(restart?'CHAT_REQUEST_INTERRUPTED':run.errorCode||'CHAT_REQUEST_INTERRUPTED'):run.errorCode||(current?conversation.errorCode:'')||''};
}
