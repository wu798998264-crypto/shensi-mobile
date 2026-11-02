import {validateMediaReceipt,desktopMediaPath} from '../../mobile/media-contract.mjs';

// Only managed media folders are transferable. Never materialize notebook
// metadata, executable files, absolute paths or Windows aliases from the cloud.
function managedRelativePath(value){
 if(typeof value!=='string'||value.length>900||! /^(?:附件|08_资料库\/附件)\//.test(value)||/[\\:<>"|?*\x00-\x1f]/.test(value))throw Error('白板历史素材路径未映射或不安全');
 const parts=value.split('/');
 if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))throw Error('白板历史素材路径未映射或不安全');
 return value;
}
export function notebookMediaPath(value){managedRelativePath(value);if(! /\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(value))throw Error('白板历史素材路径未映射或不安全');return value;}
const fileFields=new Set(['file','relativePath','thumbnailRelativePath','assetPath','coreMediaGeometryFile']);
const derivedPaths=new Set(['mediaBatchDirectory','mediaBatchIndexPath','whiteboardMediaDirectory','whiteboardMediaIndexPath']);
export function documentMediaPaths(doc){
 const paths=new Set(),markdown=String(doc?.markdown||'');
 for(const match of markdown.matchAll(/!\[\[([^\]\n]+)\]\]|!\[[^\]\n]*\]\(([^)\n]+)\)/g))paths.add(notebookMediaPath(match[1]||match[2]));
 const html=String(doc?.html||'')+String(doc?.coreRichText?.html||'');
 if(/<(?:source|iframe|object)\b/i.test(html)||/\]\((?:\.\/)?(?:attachments|assets|\.shensi)\//i.test(markdown))throw Error('文档含未接通的附件引用，不能只同步索引');
 const decode=value=>value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|quot|apos|lt|gt);/gi,(_,hex,dec,named)=>hex||dec?String.fromCodePoint(parseInt(hex||dec,hex?16:10)):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'})[named.toLowerCase()]);
 for(const match of html.matchAll(/<(?:img|audio|video)\b[^>]*>/gi)){
  const tag=match[0],attr=tag.match(/\bdata-attachment-path\s*=\s*(["'])(.*?)\1/i),src=tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
  const path=notebookMediaPath(decode(attr?.[2]||src?.[2]||''));
  if(src&&notebookMediaPath(decode(src[2]))!==path)throw Error('文档媒体路径不一致，未上传');
  // Mobile edits use Markdown: HTML-only media must not disappear on save.
  if(!paths.has(path))throw Error('文档媒体缺少对应Markdown引用，未同步以免手机编辑丢失附件');
 }
 return [...paths];
}
export function notebookMediaReferences(state){
 const paths=new Set(),receipts=new Map();let count=0;
 function visit(value,depth=0){
  if(!value||typeof value!=='object')return;
  if(depth>40||++count>200000)throw Error('白板附件结构过大或嵌套过深');
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  if(value.localMedia){const receipt=validateMediaReceipt(value.localMedia),prior=receipts.get(receipt.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(receipt))throw Error('同一附件身份指向不同内容，未修改历史');receipts.set(receipt.id,receipt);if(value.file&&value.file!==desktopMediaPath(receipt))throw Error('手机附件路径与原始身份不符');}
  for(const [key,item]of Object.entries(value)){
   if(key==='localMedia')continue;
   if(derivedPaths.has(key)&&item){managedRelativePath(item);continue;}
   if(/^(?:api[-_]?key|authorization|cookie|password|access[-_]?token|refresh[-_]?token|credentials|secret)$/i.test(key)&&item)throw Error('白板字段含账号凭据，不能进入资料同步');
   if(fileFields.has(key)&&item){const path=notebookMediaPath(item);if(!(key==='file'&&value.localMedia))paths.add(path);}
   else if(typeof item==='string'&&item&&/(?:path|file|url|uri|src)$/i.test(key)&&!derivedPaths.has(key))throw Error('白板含尚未映射的引用路径，未上传残缺引用');
   else visit(item,depth+1);
  }
 }
 const inspect=doc=>{for(const path of documentMediaPaths(doc))paths.add(path);if(doc?.coreMediaArtifacts)visit(doc.coreMediaArtifacts);if(doc?.canvas)visit(doc.canvas);};
 for(const doc of Object.values(state.documents||{}))inspect(doc);
 for(const versions of Object.values(state.histories||{}))for(const version of versions)inspect(version.document);
 for(const item of state.coreRestoreLog||[])inspect(item.document);
 for(const item of state.trash||[]){for(const doc of Object.values(item.documents||{[item.id]:item.document}))inspect(doc);for(const versions of Object.values(item.histories||{}))for(const version of versions)inspect(version.document);}
 return {paths:[...paths].sort(),receipts:[...receipts.values()]};
}
export function validateNotebookMediaPaths(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>10000)throw Error('白板附件路径清单无效');
 const folded=new Set();
 for(const [path,receipt]of Object.entries(value)){notebookMediaPath(path);const key=path.toLowerCase();if(folded.has(key))throw Error('白板附件路径大小写冲突');folded.add(key);validateMediaReceipt(receipt);if(path.split('.').at(-1).toLowerCase()!==receipt.id.split('.').at(-1))throw Error('白板附件路径格式与回执不符');}
 return value;
}
export function notebookNodeMedia(node,state){
 const receipt=node?.localMedia||state?.coreSyncMediaPaths?.[node?.file||node?.attachment?.relativePath];
 return validateMediaReceipt(receipt);
}
