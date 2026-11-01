export const MEDIA_CHUNK_BYTES=256*1024,MAX_MEDIA_BYTES=256*1024*1024,MAX_TEXT_BYTES=2*1024*1024,MAX_IMPORT_FILES=20;
const formats={png:['image','image/png'],jpg:['image','image/jpeg'],jpeg:['image','image/jpeg'],webp:['image','image/webp'],gif:['image','image/gif'],mp4:['video','video/mp4'],mov:['video','video/quicktime'],webm:['video','video/webm'],mp3:['audio','audio/mpeg'],wav:['audio','audio/wav'],m4a:['audio','audio/mp4'],ogg:['audio','audio/ogg'],txt:['text','text/plain'],md:['text','text/markdown']};
export const mediaFailure=message=>Object.assign(Error(message),{code:'MOBILE_MEDIA_INVALID'});
export function importFileInfo({name,size,bytes=size}={}){
 if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\x00-\x1f]/.test(name))throw mediaFailure('文件名无效或过长');
 const ext=name.split('.').pop().toLowerCase(),format=formats[ext];if(!format)throw mediaFailure('不支持此文件格式：'+name+'。请选择 PNG/JPG/WebP/GIF、MP4/MOV/WebM、MP3/WAV/M4A/OGG 或 TXT/MD。');
 const [kind,mime]=format,limit=kind==='text'?MAX_TEXT_BYTES:MAX_MEDIA_BYTES;if(!Number.isSafeInteger(bytes)||bytes<1||bytes>limit)throw mediaFailure(name+'：文件为空或超过 '+(limit/1024/1024)+' MiB 上限');return {name,bytes,ext,kind,mime};
}
export function validMediaSignature(bytes,ext){
 const b=new Uint8Array(bytes),ascii=(a,n)=>String.fromCharCode(...b.slice(a,a+n)),starts=(...v)=>v.every((x,i)=>b[i]===x);
 if(ext==='png')return starts(137,80,78,71,13,10,26,10);
 if(ext==='jpg'||ext==='jpeg')return starts(255,216,255);
 if(ext==='gif')return ['GIF87a','GIF89a'].includes(ascii(0,6));
 if(ext==='webp')return ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP';
 if(ext==='wav')return ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE';
 if(['mp4','mov','m4a'].includes(ext))return ascii(4,4)==='ftyp';
 if(ext==='webm')return starts(26,69,223,163);
 if(ext==='ogg')return ascii(0,4)==='OggS';
 if(ext==='mp3')return ascii(0,3)==='ID3'||b[0]===255&&(b[1]&224)===224;
 return false;
}
export function validateMediaReceipt(value){
 if(!value||typeof value.id!=='string'||!/^m-[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg)$/.test(value.id)||!/^([a-f0-9]{64})$/.test(value.sha256||''))throw mediaFailure('附件保存回执无效');
 const info=importFileInfo(value);if(info.kind==='text'||value.kind!==info.kind||value.mime!==info.mime||!value.id.endsWith('.'+info.ext))throw mediaFailure('附件类型回执不一致');return {id:value.id,name:info.name,kind:info.kind,mime:info.mime,bytes:info.bytes,sha256:value.sha256};
}
// Stable managed alias; historical mobile receipts keep their original IDs.
export const desktopMediaPath=receipt=>'附件/云同步/'+validateMediaReceipt(receipt).id;
