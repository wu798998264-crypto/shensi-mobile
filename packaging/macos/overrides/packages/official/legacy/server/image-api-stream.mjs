// Images API SSE, not Responses tool events. Only completed images are outputs;
// partial previews and a bare [DONE] never count as a delivered image.
export const usesImageApiStream=model=>/^(?:openai\/)?gpt-image-2\.[56](?:-|$)/i.test(String(model||''));
const incomplete=message=>Object.assign(Error(message||'图片流中断，未收到完整成图；请核对原任务，未自动补单'),{code:'IMAGE_STREAM_INCOMPLETE',providerErrorCode:'IMAGE_STREAM_INCOMPLETE',submissionOutcomeKnown:false});
export async function readImageApiStream(response,{expectedCount=1,parseJson,providerError}={}){
 if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream'))return parseJson(response);
 const decoder=new TextDecoder(),items=new Map();let pending='',received=0,done=false;
 const frame=block=>{
  const lines=block.split(/\r?\n/),data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!data)return;if(data==='[DONE]'){done=true;return;}
  let value;try{value=JSON.parse(data);}catch{throw incomplete('图片流返回了无法解析的数据，未自动补单');}
  const type=value.type||lines.find(l=>l.startsWith('event:'))?.slice(6).trim();
  if(value.error||type==='error'||/\.(?:failed|incomplete)$/.test(type||'')){
   const error=value.error||value.response?.error||value;
   const result=providerError('图片服务返回错误：'+(error.message||'生成未完成'),{status:502,headers:response.headers},error.code||'IMAGE_STREAM_FAILED');
   if(/timeout|incomplete|disconnect/i.test(error.code||'')){result.submissionOutcomeKnown=false;result.retryable=false;}
   throw result;
  }
  if(!['image_generation.completed','image_edit.completed'].includes(type))return;
  if(done)throw incomplete('图片完成标记之后仍返回新结果，未采用歧义内容');
  if(!value.b64_json&&!value.url)throw incomplete('图片完成回执缺少成图');
  const index=value.output_index??value.image_index??items.size;
  if(!Number.isInteger(index)||index<0||index>=expectedCount)throw incomplete('图片返回数量或序号与请求不符');
  if(items.has(index)&&JSON.stringify(items.get(index))!==JSON.stringify(value))throw incomplete('同一图片序号返回不同内容');
  items.set(index,value);
 };
 try{
  for await(const chunk of response.body){
   received+=chunk.byteLength;if(received>192*1024*1024)throw incomplete('图片流超过可接收大小，未自动补单');
   pending+=decoder.decode(chunk,{stream:true});
   let match;while((match=/\r?\n\r?\n/.exec(pending))){frame(pending.slice(0,match.index));pending=pending.slice(match.index+match[0].length);}
  }
  pending+=decoder.decode();if(pending.trim())frame(pending);
 }catch(error){if(error.providerErrorCode)throw error;throw incomplete();}
 if(items.size!==expectedCount)throw incomplete();
 return {data:[...items.entries()].sort(([a],[b])=>a-b).map(([,v])=>v)};
}
