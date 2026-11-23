import {createHash,randomUUID} from 'node:crypto';
// This is a transport bound, not a model context-window declaration. A model
// with a smaller window must reject the complete request, never receive an
// apparently successful read with its middle silently removed.
export const MAX_AGENT_TOOL_OUTPUT_BYTES = 8_000_000;

// Codex's tool_output_token_limit controls individual outputs retained in
// history. Use at least one token per allowed UTF-8 byte, including the JSON
// envelope, so supported host results stay below that truncation budget.
// This override belongs to the task thread; it never edits global config.toml.
export const AGENT_TOOL_OUTPUT_TOKEN_LIMIT = MAX_AGENT_TOOL_OUTPUT_BYTES;

export const completeAgentToolOutput = (result) => {
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (bytes > MAX_AGENT_TOOL_OUTPUT_BYTES) {
    throw Object.assign(new Error(`工具完整结果为 ${bytes} 字节，超过单次读取上限 ${MAX_AGENT_TOOL_OUTPUT_BYTES} 字节；任务已停止，未截断正文，也未将部分内容当作全文。请缩小资料范围。`), {
      code: "AGENT_TOOL_OUTPUT_TOO_LARGE", safeToFallback: false,
    });
  }
  return result;
};

const sorted=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(sorted):Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,sorted(value[key])])):value;
const canonical=value=>JSON.stringify(sorted(value));
const digest=value=>createHash('sha256').update(canonical(payload(value))).digest('hex');
const payload=value=>{
  const parsed=typeof value==='string'?JSON.parse(value):value;
  const candidate=parsed?.contentItems||parsed?.content||parsed;
  const items=Array.isArray(candidate)?candidate:null;
  if(items?.some(item=>['inputImage','input_image'].includes(item.type)))return items.map(item=>['inputImage','input_image'].includes(item.type)?{type:'image',url:item.imageUrl||item.image_url}:{type:'text',text:item.text});
  if(items?.length===1&&typeof items[0]?.text==='string')return payload(items[0].text);
  return parsed;
};
// Verify at the final provider boundary too. A future Codex default or token
// estimator must not turn a successful host read into an abbreviated result.
export function createAgentToolOutputVerifier(){
  const receipts=new Map(),textResults=new Map(),key=({namespace,tool,arguments:args={}})=>canonical([namespace,tool,args]);
  return {
    capture(call,result){completeAgentToolOutput(result);const id=key(call),values=receipts.get(id)||new Set();values.add(digest(result));receipts.set(id,values);return result;},
    // Keep the authoritative text in this task. The model gets it in full at
    // the provider boundary, even if Codex reformats its local history.
    relay(call,result){
      const items=result?.contentItems;
      if(items?.length!==1||items[0].type!=='inputText'||typeof items[0].text!=='string')return this.capture(call,result);
      completeAgentToolOutput(result);
      const token=randomUUID(),text=items[0].text;
      textResults.set(token,{call:key(call),callId:call.callId,text});
      return {...result,contentItems:[{type:'inputText',text:JSON.stringify({shensiToolReceipt:token})}]};
    },
    verify(call,output){
      let marker,reason='content_mismatch';
      try{marker=payload(output);}catch{}
      if(marker&&typeof marker==='object'&&Object.keys(marker).length===1&&typeof marker.shensiToolReceipt==='string'){
        const entry=textResults.get(marker.shensiToolReceipt);
        if(entry&&entry.call===key(call)&&(!entry.callId||entry.callId===call.callId))return entry.text;
        reason=!entry?'receipt_missing':entry.call!==key(call)?'arguments_mismatch':'call_mismatch';
      }
      let actual;try{actual=digest(output);}catch{}
      if(!receipts.get(key(call))?.has(actual)){
        const detail={receipt_missing:'工具回执在当前任务中不存在',arguments_mismatch:'工具回执与本次调用参数不匹配',call_mismatch:'工具回执属于另一笔调用',content_mismatch:'工具返回内容与宿主全文不一致'}[reason];
        throw Object.assign(new Error(detail+'，任务已停止；未将未校验内容发送给模型。'),{code:'AGENT_TOOL_OUTPUT_CHANGED',statusCode:422,safeToFallback:false,toolOutputMismatch:{reason,namespace:String(call.namespace||''),tool:String(call.tool||'')}});
      }
      return output;
    },
  };
}
