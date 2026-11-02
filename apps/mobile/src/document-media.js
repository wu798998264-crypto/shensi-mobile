import {notebookNodeMedia} from '../../../packages/core/src/notebook-media-paths.mjs';
// Never hand an arbitrary Markdown URL to the WebView. The native managed
// media resolver is the only source; the original syntax survives editing.
export function hydrateDocumentMedia(article,state,media){
 for(const holder of article.querySelectorAll('[data-mobile-media]')){
  const file=holder.dataset.mobileMedia;
  Promise.resolve().then(async()=>{
   const receipt=notebookNodeMedia({file},state);if(!media?.resolve)throw Error('附件尚未下载');
   const url=await media.resolve({file},state);if(!holder.isConnected)return;
   const view=document.createElement(receipt.kind==='image'?'img':receipt.kind);view.src=url;view.style.maxWidth='100%';
   if(receipt.kind==='image')view.alt=receipt.name;else {view.controls=true;view.preload='metadata';if(receipt.kind==='video')view.playsInline=true;}
   view.addEventListener('error',()=>{if(!holder.querySelector('[role=status]')){const message=document.createElement('small');message.setAttribute('role','status');message.textContent='媒体无法解码，原文件和引用保留。';holder.append(message);}});
   holder.replaceChildren(view);
  }).catch(()=>{if(holder.isConnected)holder.textContent='附件待同步 · '+file;});
 }
}
