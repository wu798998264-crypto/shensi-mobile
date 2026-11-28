import {randomUUID} from 'node:crypto';

// Only Antigravity: keep MCP results inline without granting native file access.
// Cache references are per turn and never accept a filesystem path or URL.
export function antigravityToolTransport(runtime,{signal}={}){
 const cache=new Map();let cachedCharacters=0;
 const text=text=>({type:'inputText',text:typeof text==='string'?text:JSON.stringify(text)});
 const page=(id,index)=>{
  const pages=cache.get(id);
  if(!pages||!Number.isSafeInteger(index)||index<0||index>=pages.length)throw Error('本轮工具结果页不存在，请使用刚返回的 resultId 和 page');
  return {success:true,contentItems:[text({resultId:id,page:index,pages:pages.length,nextPage:index+1<pages.length?index+1:null,content:pages[index]})]};
 };
 const tools=[...runtime.dynamicTools,{name:'tool_result',tools:[{name:'read',description:'按页读取本轮神思工具返回的大文本；不访问文件、不重复执行原操作。按序拼接 content 得到原文。',inputSchema:{type:'object',properties:{resultId:{type:'string'},page:{type:'integer',minimum:0}},required:['resultId','page'],additionalProperties:false}}]}];
 return {dynamicTools:tools,invoke:async call=>{
  signal?.throwIfAborted();
  if(call.namespace==='tool_result'){
   if(call.tool!=='read'||Object.keys(call.arguments||{}).some(k=>!['resultId','page'].includes(k)))throw Error('工具结果分页参数无效');
   return page(call.arguments?.resultId,call.arguments?.page);
  }
  const result=await runtime.invoke(call),contentItems=[];
  for(const item of result.contentItems||[]){
   // Large-image offload is still unresolved in agy 1.5.18. Preserve the
   // native image and permission boundary; never silently shrink or fake vision.
   if(item.type==='inputImage'){contentItems.push(item);continue;}
   const source=item.text||'';
   if(source.length<=3000){contentItems.push(item);continue;}
   if(cachedCharacters+source.length>16*1024*1024)throw Error('本轮工具分页缓存超过16Mi字符，请缩小读取范围；未截断结果');
   const pages=[];let offset=0;
   while(offset<source.length){let end=Math.min(source.length,offset+3000);if(end<source.length&&/[\uD800-\uDBFF]/.test(source[end-1]))end--;pages.push(source.slice(offset,end));offset=end;}
   const resultId=randomUUID();cache.set(resultId,pages);cachedCharacters+=source.length;
   const info={resultId,pages:pages.length,totalCharacters:source.length,instruction:'大结果已完整保存在本轮内存中。调用 tool_result.read(resultId,page) 按需读取并拼接；无需本地文件权限，不要重新执行原工具。'};
   // Appending cards only requires layout and the live stamp. Full fields remain paged.
   if(call.namespace==='board'&&call.tool==='read')try{const value=JSON.parse(source);if(value.document?.canvas)info.boardSummary={notebookId:value.notebookId,documentId:value.documentId,stateStamp:value.stateStamp,title:value.document.title,nodes:value.document.canvas.nodes.map(n=>({id:n.id,kind:n.kind,type:n.type,name:n.name,x:n.x,y:n.y,width:n.width,height:n.height,textCharacters:(n.text||'').length})),note:'仅布局摘要；正文、连线和生成草稿需读取完整分页，原始基线由宿主保留。'};}catch{}
   const summary=text(info);if(summary.text.length>3000)delete info.boardSummary;
   contentItems.push(text(info));
  }
  return {...result,contentItems};
 }};
}
