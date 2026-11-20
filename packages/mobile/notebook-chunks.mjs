import {CLOUD_NOTEBOOK_LIMIT} from '../core/src/notebook-snapshot.mjs';
import {syncDigest} from '../core/src/sync-revision-journal.mjs';

const CHUNK=4*1024*1024,FORMAT='shensi-notebook-chunks-v1',encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const notebookId=path=>{const match=/^notebooks\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\.json$/.exec(path);if(!match)throw Error('笔记本分块身份无效');return match[1];};
const chunkPath=(id,hash,index)=>'notebook-chunks/'+id+'/'+hash+'/'+String(index).padStart(6,'0');

// Small existing snapshots keep their wire format. Large snapshots publish an
// immutable manifest only after all bounded chunks have been read back by IO.
export async function prepareNotebookEntry(repository,entry,onProgress){
 const id=notebookId(entry.logicalPath);
 if(!(entry.bytes instanceof Uint8Array)||entry.bytes.length!==entry.size||entry.size>CLOUD_NOTEBOOK_LIMIT||await syncDigest(entry.bytes)!==entry.hash)throw Error('完整笔记本内容或摘要无效');
 if(entry.size<=CHUNK)return entry;
 const inventory=new Map((await repository.inventory()).map(item=>[item.logicalPath,item])),chunks=[];
 for(let at=0,index=0;at<entry.size;at+=CHUNK,index++){
  const bytes=entry.bytes.slice(at,at+CHUNK),hash=await syncDigest(bytes),logicalPath=chunkPath(id,entry.hash,index),prior=inventory.get(logicalPath);
  if(prior){if(prior.deleted||prior.conflicted||prior.hash!==hash||prior.size!==bytes.length)throw Error('云端笔记本分块冲突，未发布索引');}
  else await repository.upload({entry:{logicalPath,bytes,hash,size:bytes.length,contentType:'application/octet-stream'},expectedRemoteExists:false,onProgress});
  chunks.push({hash,size:bytes.length});
 }
 const bytes=encoder.encode(JSON.stringify({format:FORMAT,notebookId:id,bytes:entry.size,sha256:entry.hash,chunkBytes:CHUNK,chunks}));
 return {...entry,bytes,size:bytes.length,hash:await syncDigest(bytes)};
}

export async function readNotebookBytes(repository,entry,onProgress){
 const id=notebookId(entry.logicalPath);
 if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>8*1024*1024)throw Error('云端笔记本索引大小无效');
 const bytes=await repository.download({entry,onProgress});
 if(bytes.length!==entry.size||await syncDigest(bytes)!==entry.hash)throw Error('云端笔记本索引摘要不符');
 const manifest=JSON.parse(decoder.decode(bytes));
 if(manifest?.format!==FORMAT)return bytes;
 if(manifest.notebookId!==id||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<=CHUNK||manifest.bytes>CLOUD_NOTEBOOK_LIMIT||!digest(manifest.sha256)||manifest.chunkBytes!==CHUNK||!Array.isArray(manifest.chunks)||manifest.chunks.length!==Math.ceil(manifest.bytes/CHUNK))throw Error('云端笔记本分块清单无效');
 for(let index=0;index<manifest.chunks.length;index++){const part=manifest.chunks[index];if(!digest(part?.hash)||part.size!==Math.min(CHUNK,manifest.bytes-index*CHUNK))throw Error('云端笔记本分块清单无效');}
 const inventory=new Map((await repository.inventory()).map(item=>[item.logicalPath,item])),result=new Uint8Array(manifest.bytes);
 for(let index=0;index<manifest.chunks.length;index++){
  const part=manifest.chunks[index],remote=inventory.get(chunkPath(id,manifest.sha256,index));
  if(!remote||remote.deleted||remote.conflicted||remote.hash!==part.hash||remote.size!==part.size)throw Error('云端笔记本分块缺失或冲突，未修改本地');
  const chunk=await repository.download({entry:remote,onProgress});if(chunk.length!==part.size||await syncDigest(chunk)!==part.hash)throw Error('云端笔记本分块摘要不符，未修改本地');result.set(chunk,index*CHUNK);
 }
 if(await syncDigest(result)!==manifest.sha256)throw Error('完整笔记本摘要不符，未修改本地');
 return result;
}
