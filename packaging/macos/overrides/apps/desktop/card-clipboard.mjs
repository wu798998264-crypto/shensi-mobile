import {mkdtemp,writeFile,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

// Expose only our opaque marker, never unrelated clipboard text or file paths.
export const readCardClipboard=clipboard=>({token:/data-shensi-cards="([a-z0-9-]{10,80})"/i.exec(clipboard.readHTML())?.[1]||''});

// Resolve saved card ids, never caller-supplied absolute file paths.
export async function copyBoardCards({service,desktop,body}){
 if(!desktop.copyCardFiles)return {unsupported:true};
 const {state,stateStamp}=await service.load(body.id);
 if(stateStamp!==body.expectedStateStamp)throw Error('卡片内容已变化，请重新复制');
 const canvas=state.documents[body.documentId]?.canvas,ids=body.nodeIds;
 if(!canvas||!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length||!/^[a-z0-9-]{10,80}$/i.test(body.token||''))throw Error('复制卡片参数无效');
 const nodes=ids.map(id=>canvas.nodes.find(n=>n.id===id));if(nodes.some(n=>!n))throw Error('原卡片已不存在');
 const entries=[];
 for(const node of nodes){
  if(node.file){const info=await service.assetInfo(body.id,node.file,body.documentId);entries.push({path:info.absolutePath,name:node.name||basename(info.absolutePath),mimeType:info.mimeType});}
  else entries.push({name:(node.name||'文本')+'.md',text:String(node.text||'')});
 }
 const text=nodes.map(n=>n.text||(!n.file?n.name:'')||'').filter(Boolean).join('\n\n');
 return desktop.copyCardFiles({entries,text,html:'<span data-shensi-cards="'+body.token+'">'+escape(text)+'</span>'});
}

function windowsHtml(html){
 const before='<html><body><!--StartFragment-->',after='<!--EndFragment--></body></html>';
 const header=(start,end,fragment,finish)=>`Version:0.9\r\nStartHTML:${String(start).padStart(10,'0')}\r\nEndHTML:${String(end).padStart(10,'0')}\r\nStartFragment:${String(fragment).padStart(10,'0')}\r\nEndFragment:${String(finish).padStart(10,'0')}\r\n`;
 const start=Buffer.byteLength(header(0,0,0,0)),fragment=start+Buffer.byteLength(before),finish=fragment+Buffer.byteLength(html);
 return header(start,finish+Buffer.byteLength(after),fragment,finish)+before+html+after;
}

export function createCardClipboard({nativeImage,platform=process.platform,execute=run}){
 return async({entries,text,html})=>{
  if(!['win32','darwin'].includes(platform))throw Error('当前系统暂不支持卡片文件复制，请使用导出');
  // Stable copies let a later cut/delete leave the OS clipboard usable. The OS
  // temp directory owns their lifetime; never unlink files still on a clipboard.
  const root=await mkdtemp(join(tmpdir(),'shensi-card-copy-')),paths=[];
  for(const [index,entry]of entries.entries()){
   let name=basename(entry.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,160)||'卡片';
   // Card titles are labels: dots or a renamed suffix must not hide the real
   // file type from Explorer and browser paste handlers (which infer MIME).
   const extension=entry.path?extname(entry.path):'';
   if(extension&&extname(name).toLowerCase()!==extension.toLowerCase())name=name.replace(/\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|svg|mp4|mov|mkv|webm|mp3|m4a|wav|ogg|flac)$/i,'')+extension;
   const path=join(root,String(index+1).padStart(2,'0')+'-'+name);
   if(entry.path)await copyFile(entry.path,path);else await writeFile(path,entry.text,'utf8');paths.push(path);
  }
  let imagePath='';
  if(entries.length===1&&entries[0].mimeType?.startsWith('image/')){
   const image=nativeImage.createFromBuffer(await readFile(paths[0]));if(!image.isEmpty()){imagePath=join(root,'clipboard-preview.png');await writeFile(imagePath,image.toPNG());}
  }
  const payloadPath=join(root,'clipboard.json');await writeFile(payloadPath,JSON.stringify({paths,text,html,windowsHtml:windowsHtml(html),imagePath}));
  try{if(platform==='win32'){
   const path64=Buffer.from(payloadPath).toString('base64');
   const script=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$cardPayload=Get-Content -Raw -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'))) -Encoding UTF8 | ConvertFrom-Json
$cardData=New-Object Windows.Forms.DataObject
$cardFiles=New-Object Collections.Specialized.StringCollection
foreach($cardPath in $cardPayload.paths){if(-not [IO.File]::Exists($cardPath)){throw '复制文件已不存在'};[void]$cardFiles.Add($cardPath)}
$cardData.SetFileDropList($cardFiles)
$cardData.SetData('Preferred DropEffect',(New-Object IO.MemoryStream(,[BitConverter]::GetBytes([int]1))))
if($cardPayload.text){$cardData.SetText([string]$cardPayload.text,[Windows.Forms.TextDataFormat]::UnicodeText)}
$cardData.SetData('HTML Format',(New-Object IO.MemoryStream(,[Text.Encoding]::UTF8.GetBytes([string]$cardPayload.windowsHtml))))
$cardImage=$null
try{if($cardPayload.imagePath){$cardImage=[Drawing.Image]::FromFile($cardPayload.imagePath);$cardData.SetImage($cardImage)};[Windows.Forms.Clipboard]::SetDataObject($cardData,$true,10,100)}finally{if($cardImage){$cardImage.Dispose()}}`;
   await execute('powershell.exe',['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:100000});
  }else{
   const script=`ObjC.import('AppKit');ObjC.import('Foundation');function run(argv){var p=JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(argv[0],$.NSUTF8StringEncoding,null))),items=$.NSMutableArray.alloc.init; p.paths.forEach(function(path,index){var item=$.NSPasteboardItem.alloc.init;item.setStringForType($.NSURL.fileURLWithPath(path).absoluteString,$.NSPasteboardTypeFileURL);if(index===0){item.setStringForType(p.text,$.NSPasteboardTypeString);item.setStringForType(p.html,$.NSPasteboardTypeHTML);if(p.imagePath)item.setDataForType($.NSData.dataWithContentsOfFile(p.imagePath),$.NSPasteboardTypePNG);}items.addObject(item);});var board=$.NSPasteboard.generalPasteboard;board.clearContents;if(!board.writeObjects(items))throw Error('Clipboard write failed');}`;
   await execute('/usr/bin/osascript',['-l','JavaScript','-e',script,payloadPath],{timeout:15000,maxBuffer:100000});
  }}catch{throw Error('系统剪贴板暂时被占用或文件复制失败，请重试；原卡片已保留');}
  return {copied:true,fileCount:paths.length};
 };
}
