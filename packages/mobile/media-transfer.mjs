import {validateMediaReceipt,MEDIA_CHUNK_BYTES} from './media-contract.mjs';
export function encodeMediaChunk(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
// Both desktop and native mobile use the same bounded, verified transfer.
export function createMediaTransfer(transport){return {
 async source(value){
  const expected=validateMediaReceipt(value),actual=validateMediaReceipt(await transport.describe({id:expected.id}));if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('附件内容或身份已变化，未上传');
  return {bytes:expected.bytes,sha256:expected.sha256,async read(start,end){
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>expected.bytes||end-start>4*1024*1024)throw Error('附件读取范围无效');
   const result=new Uint8Array(end-start);for(let offset=start;offset<end;offset+=MEDIA_CHUNK_BYTES){const length=Math.min(MEDIA_CHUNK_BYTES,end-offset),part=await transport.read({id:expected.id,offset,length,sha256:expected.sha256});if(part.id!==expected.id||part.offset!==offset||part.bytes!==length||part.sha256!==expected.sha256||typeof part.base64!=='string'||part.base64.length>Math.ceil(length/3)*4)throw Error('附件分块回执不符');const bytes=Uint8Array.from(atob(part.base64),c=>c.charCodeAt(0));if(bytes.length!==length)throw Error('附件读取不完整');result.set(bytes,offset-start);}return result;
  }};
 },
 sink(value){
  const expected=validateMediaReceipt(value);let started=null,written=0,index=0;
  return {
   async begin(manifest){if(started)throw Error('附件下载已开始');if(manifest.file?.sha256!==expected.sha256||manifest.file?.bytes!==expected.bytes)throw Error('云端附件与笔记本引用不符');started=await transport.begin({...expected,expected});if(started.id!==expected.id)throw Error('附件保存身份不符，历史引用保持原样');},
   async write(chunkIndex,bytes){if(!started||chunkIndex!==index||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>4*1024*1024||written+bytes.length>expected.bytes)throw Error('附件下载顺序或大小不符');for(let at=0;at<bytes.length;at+=MEDIA_CHUNK_BYTES){const part=bytes.subarray(at,at+MEDIA_CHUNK_BYTES);if(!started.existing){const r=await transport.write({id:started.id,offset:written,base64:encodeMediaChunk(part)});if(r.written!==written+part.length)throw Error('附件落盘回执不符');}written+=part.length;}index++;},
   async finish(receipt){if(!started||written!==expected.bytes||receipt.bytes!==expected.bytes||receipt.sha256!==expected.sha256)throw Error('附件尚未完整下载');const actual=validateMediaReceipt(started.existing?await transport.describe({id:started.id}):await transport.finish({id:started.id}));if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('附件整文件校验失败');return {verified:true,receipt:actual};},
   async abort(){if(started&&!started.existing)await transport.abort({id:started.id});started=null;}
  };
 }
};}
