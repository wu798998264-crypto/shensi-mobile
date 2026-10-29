// Public, read-only deployment inspection. Never sends sessions or user files.
import {mkdir,writeFile} from 'node:fs/promises';
import {ACCOUNT_ISSUER} from '../packages/mobile/account-client.mjs';
const checks=[];
const paths=['/health','/v1/billing/config','/v1/plugins/config','/v1/plugins/catalog?platform=android','/v1/plugins/catalog?platform=ios'];
await Promise.all(paths.map(async path=>{
 const result={path};
 try{
  const response=await fetch(ACCOUNT_ISSUER+path,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  result.status=response.status;
  const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_RESPONSE');
  let size=0,body='';const decoder=new TextDecoder();
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024*1024){await reader.cancel();throw Error('RESPONSE_LIMIT');}body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();
  let value;try{value=JSON.parse(body);}catch{throw Error('INVALID_JSON');}
  result.json=true;
  if(path==='/health')result.ready=value.ready===true;
  if(path==='/v1/billing/config')Object.assign(result,{paymentEnabled:value.paymentEnabled===true,cloudSyncEnabled:typeof value.cloudSyncEnabled==='boolean'?value.cloudSyncEnabled:null,generationEnabled:value.generationEnabled===true});
  if(path==='/v1/plugins/config')Object.assign(result,{marketplace:value.mode==='plugin-marketplace',publishReady:value.publishReady===true,platforms:Array.isArray(value.platforms)?value.platforms.filter(v=>['desktop','android','ios','mobile'].includes(v)):[],partitions:Array.isArray(value.partitions)?value.partitions.filter(v=>['desktop','mobile'].includes(v)):[]});
  if(path.includes('/catalog?')){const expected=new URLSearchParams(path.split('?')[1]).get('platform');Object.assign(result,{marketplace:value.mode==='plugin-marketplace',platform:value.platform===expected?expected:null,partitionConfirmed:value.platform===expected,total:Number.isSafeInteger(value.total)?value.total:null,returnedItems:Array.isArray(value.items)?value.items.length:null});}
 }catch(error){result.error=error.name==='TimeoutError'?'TIMEOUT':['EMPTY_RESPONSE','RESPONSE_LIMIT','INVALID_JSON'].includes(error.message)?error.message:'UNREACHABLE';}
 checks.push(result);
}));
checks.sort((a,b)=>paths.indexOf(a.path)-paths.indexOf(b.path));
const result={capturedAt:new Date().toISOString(),issuer:ACCOUNT_ISSUER,readOnly:true,credentialsSent:false,userFilesSent:false,remoteMutation:false,checks};
const output=process.argv[2]||'docs/migration/evidence/mobile-service-parity/public-readiness.json';
await mkdir(new URL('.',new URL(output,'file:///'+process.cwd().replaceAll('\\','/')+'/')),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
