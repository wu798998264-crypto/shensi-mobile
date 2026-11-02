import {importFileInfo,validateMediaReceipt,MEDIA_CHUNK_BYTES,MAX_IMPORT_FILES} from '../../../packages/mobile/media-contract.mjs';
import {createMediaTransfer,encodeMediaChunk as encode} from '../../../packages/mobile/media-transfer.mjs';
import {notebookNodeMedia} from '../../../packages/core/src/notebook-media-paths.mjs';

export function pickWhiteboardFiles(){
 return new Promise((resolve,reject)=>{
  const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg,.txt,.md';input.hidden=true;input.setAttribute('aria-label','选择白板素材');document.body.append(input);
  const finish=files=>{input.remove();resolve(files);};input.onchange=()=>finish([...input.files]);input.oncancel=()=>finish([]);try{input.click();}catch(e){input.remove();reject(e);}
 });
}
export function createMobileMediaImporter({transport,pickFiles=pickWhiteboardFiles,convertUrl=value=>value}={}){
 let busy=false;
 return {
  ...createMediaTransfer(transport),
  resolve:async(node,state)=>{const receipt=notebookNodeMedia(node,state),found=await transport.resolve({id:receipt.id});return convertUrl(found.url);},
  async upload({notebookId,documentId,documents,expectedRevision,onProgress=()=>{}}){
   if(busy)throw Error('正在导入素材，请勿重复点击');busy=true;let pendingId;
   try{
    const files=await pickFiles();if(!files.length)return {cancelled:true,count:0};if(files.length>MAX_IMPORT_FILES)throw Error('单次最多导入20个文件');
    const infos=files.map(file=>importFileInfo({name:file.name,bytes:file.size})),items=[],operationId='import-'+crypto.randomUUID();
    // Capture the target/version before the picker. Never silently import into a newly selected board.
    const before=await documents.load(notebookId),doc=before.state?.documents[documentId];if(before.revision!==expectedRevision)throw Error('选择文件期间白板已变化，请重新打开后导入');if(!doc?.canvas||doc.locked||doc.coreLocked||doc.readOnly||doc.deleted)throw Error('白板不可写，请先解除锁定');
    for(let i=0;i<files.length;i++){
     const file=files[i],info=infos[i],id='asset-'+crypto.randomUUID();onProgress(`正在导入 ${i+1}/${files.length} · ${info.name}`);
     if(info.kind==='text'){const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(text.includes('\0'))throw Error(info.name+' 不是有效UTF-8文本');items.push({id,type:'text',name:info.name,text});continue;}
     const started=await transport.begin(info);pendingId=started.id;
     for(let offset=0;offset<file.size;offset+=MEDIA_CHUNK_BYTES){const bytes=new Uint8Array(await file.slice(offset,offset+MEDIA_CHUNK_BYTES).arrayBuffer());const result=await transport.write({id:pendingId,offset,base64:encode(bytes)});if(result.written!==offset+bytes.length)throw Error('附件分块回读不一致');onProgress(`正在导入 ${i+1}/${files.length} · ${Math.round(result.written/info.bytes*100)}%`);}
     const saved=validateMediaReceipt(await transport.finish({id:pendingId}));if(saved.name!==info.name||saved.bytes!==info.bytes||saved.kind!==info.kind)throw Error('附件保存回执不一致');pendingId=null;items.push({id,type:'file',media:saved});
    }
    await documents.appendWhiteboardImports(notebookId,{documentId,items,expectedRevision,operationId});
    const saved=await documents.load(notebookId),ids=new Set(saved.state?.documents[documentId]?.canvas?.nodes?.map(n=>n.id));if(items.some(item=>!ids.has(item.id)))throw Error('素材卡片保存回读不符，请先重新读取，勿重复导入');
    return {count:items.length,cancelled:false};
   }catch(error){if(pendingId)await transport.abort({id:pendingId}).catch(()=>{});throw error;}finally{busy=false;}
  }
 };
}
