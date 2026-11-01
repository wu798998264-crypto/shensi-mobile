import {syncDigest} from '../core/src/sync-revision-journal.mjs';
// Shared protocol: publish complete immutable media before the notebook index.
export async function uploadCloudMedia(files,snapshot,media,onProgress){
 if(snapshot.format!=='shensi-notebook-snapshot-v2')return;
 if(!media)throw Error('当前入口未加载完整媒体同步');
 snapshot.cloudMedia=[];const existing=(await files.listAll()).items;
 for(const receipt of snapshot.media){
  const source=await media.source(receipt),prior=existing.find(f=>f.kind==='media'&&f.name===receipt.id&&f.sha256===receipt.sha256&&f.bytes===receipt.bytes);
  const result=prior?{fileId:prior.id}:await files.upload({key:'media-'+await syncDigest(new TextEncoder().encode(receipt.id+':'+receipt.sha256)),name:receipt.id,kind:'media',source,baseRevision:null,onProgress});
  if(result.conflict)throw Error('云端附件存在不同版本，未发布笔记本索引');snapshot.cloudMedia.push({id:receipt.id,fileId:result.fileId});
 }
}
export async function downloadCloudMedia(files,snapshot,media,onProgress){
 if(snapshot.format!=='shensi-notebook-snapshot-v2')return;
 if(!media||!Array.isArray(snapshot.cloudMedia)||snapshot.cloudMedia.length!==snapshot.media.length)throw Error('云端完整媒体映射缺失，未导入残缺白板');
 const seen=new Set();for(const receipt of snapshot.media){
  const refs=snapshot.cloudMedia.filter(ref=>ref?.id===receipt.id);if(refs.length!==1||typeof refs[0].fileId!=='string'||seen.has(refs[0].fileId))throw Error('云端附件映射重复或缺失');seen.add(refs[0].fileId);
  await files.download({fileId:refs[0].fileId,onProgress,sink:media.sink(receipt)});
 }
}
