import {nutstoreRetryAfter,pacedNutstoreFetch} from './nutstore-request-gate.mjs';
const fault=(message,code='NUTSTORE_DELTA_INVALID')=>Object.assign(Error(message),{code});
export async function readNutstoreBytes(response,limit,tooLarge){
 const stream=response.body;
 if(Number(response.headers.get('content-length'))>limit){
  await stream?.cancel().catch(()=>{});
  throw tooLarge();
 }
 if(!stream)return new Uint8Array();
 const reader=stream.getReader(),parts=[];
 let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>limit)throw tooLarge();
   parts.push(value);
  }
 }catch(error){
  await reader.cancel().catch(()=>{});
  throw error;
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);
 let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return bytes;
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const decode=value=>value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[v]);
const scalar=(source,name)=>{const values=[...source.matchAll(new RegExp('<(?:[\\w-]+:)?'+name+'(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w-]+:)?'+name+'>','g'))];if(values.length!==1)throw fault('坚果云增量响应缺少唯一字段：'+name);return decode(values[0][1]);};
// This wire format contains only elements/scalars (no DTD, comments or CDATA).
// Reject truncated/misnested XML rather than accepting an empty change list.
function validateEnvelope(xml){
 const source=xml.replace(/^\s*<\?xml\s[^?]*\?>/,'').trim(),stack=[];let roots=0,end=0;
 const children={response:['reset','cursor','hasMore','delta'],delta:['entry'],entry:['path','size','isDeleted','isDir','modified','revision']};
 for(const match of source.matchAll(/<([^<>]+)>/g)){
  const between=source.slice(end,match.index);if(between.includes('<')||(!stack.length||children[stack.at(-1)?.split(':').at(-1)])&&between.trim())throw fault('坚果云增量XML结构无效');end=match.index+match[0].length;
  const tag=match[1],close=/^\//.test(tag),empty=/\/$/.test(tag),name=tag.match(/^\/?([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=\s|\/|$)/)?.[1];
  if(!name)throw fault('坚果云增量XML标签无效');
  if(close){if(tag!=='/'+name||stack.pop()!==name)throw fault('坚果云增量XML未闭合');continue;}
  if(stack.length){if(!children[stack.at(-1).split(':').at(-1)]?.includes(name.split(':').at(-1)))throw fault('坚果云增量XML层级无效');}
  else if(++roots!==1||name.split(':').at(-1)!=='response')throw fault('坚果云增量XML根节点无效');
  if(!empty)stack.push(name);
 }
 if(stack.length||roots!==1||source.slice(end).trim())throw fault('坚果云增量XML不完整');
}
export function parseNutstoreDelta(xml,{latest=false}={}){
 if(typeof xml!=='string'||xml.length>4*1024*1024||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)||/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml)||!/<(?:[\w-]+:)?response\b/.test(xml))throw fault('坚果云增量响应无效');
 validateEnvelope(xml);
 const cursor=scalar(xml,'cursor');if(!cursor||cursor.length>4096||/[\x00-\x1f]/.test(cursor))throw fault('坚果云增量游标无效');
 if(latest)return {cursor};
 const boolean=(source,name)=>{const value=scalar(source,name);if(!['true','false'].includes(value))throw fault('坚果云增量布尔字段无效');return value==='true';};
 const entries=[];for(const match of xml.matchAll(/<(?:[\w-]+:)?entry(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?entry>/g)){
  const path=scalar(match[1],'path');if(!path||path.length>4096||/[\x00-\x1f\\]/.test(path)||path.split('/').some(v=>v==='.'||v==='..'))throw fault('坚果云增量路径无效');
  entries.push({path,isDir:boolean(match[1],'isDir'),isDeleted:boolean(match[1],'isDeleted')});
 }
 if((xml.match(/<(?:[\w-]+:)?entry\b/g)||[]).length!==entries.length||!/<(?:[\w-]+:)?delta(?:\s[^>]*)?(?:\s*\/?>)/.test(xml))throw fault('坚果云增量条目不完整');
 return {cursor,reset:boolean(xml,'reset'),hasMore:boolean(xml,'hasMore'),entries};
}
// Fixed same-provider endpoint observed in the official plugin and verified
// against the saved connection. Never forward Basic auth across redirects.
export function createNutstoreDeltaClient({account,password,fetchImpl=fetch}){
 if(fetchImpl===globalThis.fetch)fetchImpl=pacedNutstoreFetch(fetchImpl);
 const auth='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(account+':'+password)));
 async function request(operation,folder,cursor){
  if(typeof folder!=='string'||!folder||folder.includes('/')||folder.length>2048)throw fault('增量扫描根目录无效');
  const response=await fetchImpl('https://dav.jianguoyun.com/nsdav/'+operation,{method:'POST',redirect:'error',credentials:'omit',headers:{Authorization:auth,'Content-Type':'application/xml'},body:'<?xml version="1.0" encoding="utf-8"?><s:delta xmlns:s="http://ns.jianguoyun.com"><s:folderName>'+escape(folder)+'</s:folderName>'+(cursor===undefined?'':'<s:cursor>'+escape(cursor)+'</s:cursor>')+'</s:delta>',signal:AbortSignal.timeout(30000)});
  if(response.status!==200){await response.body?.cancel().catch(()=>{});const limited=[429,503].includes(response.status);throw Object.assign(fault('坚果云增量读取失败（HTTP '+response.status+'）',response.status===401?'WAITING_CREDENTIALS':limited?'RETRY_WAIT':'WEBDAV_HTTP_'+response.status),{status:response.status,...limited?{retryAfterMs:nutstoreRetryAfter(response.headers.get('retry-after'))}:{}});}
  const bytes=await readNutstoreBytes(response,4*1024*1024,()=>fault('坚果云增量清单过大，未采用截断内容'));
  return parseNutstoreDelta(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{latest:operation==='latestDeltaCursor'});
 }
 return {latest:folder=>request('latestDeltaCursor',folder),changes:(folder,cursor)=>request('delta',folder,cursor)};
}
