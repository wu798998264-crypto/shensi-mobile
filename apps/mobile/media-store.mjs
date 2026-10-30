import {mkdir,open,rename,readFile,stat,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {importFileInfo,validMediaSignature,validateMediaReceipt,MEDIA_CHUNK_BYTES,mediaFailure} from '../../packages/mobile/media-contract.mjs';

export function createMobileMediaStore(directory){
 const root=resolve(directory),sessions=new Map(),queue=new Map();
 const serial=(id,fn)=>{const p=(queue.get(id)||Promise.resolve()).catch(()=>{}).then(fn);queue.set(id,p);p.finally(()=>{if(queue.get(id)===p)queue.delete(id);}).catch(()=>{});return p;};
 const validId=id=>{if(typeof id!=='string'||!/^m-[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg)$/.test(id))throw mediaFailure('无效附件身份');return id;};
 const file=id=>join(root,validId(id));
 async function receipt(id){const result=validateMediaReceipt(JSON.parse(await readFile(file(id)+'.json','utf8')));if(result.id!==id||(await stat(file(id))).size!==result.bytes)throw mediaFailure('附件缺失或大小不符');return result;}
 return {
  async begin(input){const info=importFileInfo(input);if(info.kind==='text')throw mediaFailure('文本必须走文档事务入口');if(sessions.size>=20)throw mediaFailure('导入任务过多，请完成当前导入');await mkdir(root,{recursive:true});const id='m-'+randomUUID()+'.'+info.ext,handle=await open(file(id)+'.part','wx',0o600);await handle.close();sessions.set(id,{...info,id,written:0});return {id,chunkBytes:MEDIA_CHUNK_BYTES};},
  write:input=>serial(validId(input.id),async()=>{
   const s=sessions.get(input.id);if(!s)throw mediaFailure('导入会话已失效，请重新选择文件');if(input.offset!==s.written)throw mediaFailure('文件分块顺序不符，未重复写入');
   if(typeof input.base64!=='string'||input.base64.length>Math.ceil(MEDIA_CHUNK_BYTES/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw mediaFailure('无效文件分块');const bytes=Buffer.from(input.base64,'base64');if(!bytes.length||bytes.length>MEDIA_CHUNK_BYTES||s.written+bytes.length>s.bytes)throw mediaFailure('文件大小超出声明范围');
   if(!s.written&&!validMediaSignature(bytes,s.ext))throw mediaFailure('文件内容与扩展名不一致：'+s.name);
   const h=await open(file(s.id)+'.part','r+');try{let n=0;while(n<bytes.length){const written=await h.write(bytes,n,bytes.length-n,s.written+n);if(!written.bytesWritten)throw mediaFailure('附件写入中断');n+=written.bytesWritten;}}finally{await h.close();}
   s.written+=bytes.length;return {written:s.written};
  }),
  finish:input=>serial(validId(input.id),async()=>{
   const s=sessions.get(input.id);if(!s)return receipt(input.id);if(s.written!==s.bytes)throw mediaFailure('文件尚未完整写入');
   const tmp=file(s.id)+'.part';if((await stat(tmp)).size!==s.bytes)throw mediaFailure('附件落盘长度不一致');const hash=createHash('sha256');for await(const chunk of createReadStream(tmp))hash.update(chunk);const result=validateMediaReceipt({...s,sha256:hash.digest('hex')});
   const h=await open(tmp,'r+');try{await h.sync();}finally{await h.close();}await rename(tmp,file(s.id));const meta=await open(file(s.id)+'.json.part','wx',0o600);try{await meta.writeFile(JSON.stringify(result));await meta.sync();}finally{await meta.close();}await rename(file(s.id)+'.json.part',file(s.id)+'.json');sessions.delete(s.id);return receipt(s.id);
  }),
  abort:input=>serial(validId(input.id),async()=>{const s=sessions.get(input.id);if(s){await unlink(file(s.id)+'.part').catch(e=>{if(e.code!=='ENOENT')throw e;});sessions.delete(s.id);}return {cancelled:!!s};}),
  receipt,
  async serve(req,res,id){
   const meta=await receipt(id);let start=0,end=meta.bytes-1,status=200;
   if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||!m[1]&&!m[2]){res.writeHead(416,{'Content-Range':'bytes */'+meta.bytes});res.end();return;}
    if(!m[1])start=Math.max(0,meta.bytes-Number(m[2]));else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=meta.bytes){res.writeHead(416,{'Content-Range':'bytes */'+meta.bytes});res.end();return;}status=206;
   }
   res.writeHead(status,{'Content-Type':meta.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',...(status===206?{'Content-Range':`bytes ${start}-${end}/${meta.bytes}`}:{})});
   if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file(id),{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
 };
}
