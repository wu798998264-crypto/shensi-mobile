// A transport returning text is not proof of task completion. Keep the reply
// and the existing checkpoint when the agent explicitly reports a blocker.
export function chatCompletion(response,requestText=''){
 const report=response?.completion;
 if(report?.status==='blocked')return {status:'interrupted',errorCode:'CHAT_TASK_INCOMPLETE',error:String(report.summary||'任务尚未完成，已保留进度，请补充所需条件后继续。').replace(/\b(?:sk|ds|api)[-_][A-Za-z0-9_-]{12,}\b/gi,'[已隐藏]').replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').slice(0,2000)};
 // Compatibility for runners that have not emitted the structured report:
 // only an explicit non-completion admission on an action request qualifies.
 const text=String(response?.text??response?.content??response??'');
 if(!report&&!response?.receipts?.length&&/(?:帮我|请|把|将).*(?:改编|剧本|生成|下载|执行|制作|保存|转换)/su.test(requestText)&&/(?:任务|剧本|改编|工作)(?:[^。\n]{0,12})(?:尚未完成|未开始|还没开始|无法继续)|(?:无法|不能)继续(?:执行|完成)(?:本次|当前|原)?任务/u.test(text))return {status:'interrupted',errorCode:'CHAT_TASK_INCOMPLETE',error:'回复表明原任务尚未完成，已保留本轮记录。请继续原任务，不要重发已提交的生成。'};
 return {status:'complete',errorCode:'',error:''};
}
