import {renderMarkdown} from '../../../packages/mobile/rich-text.mjs';
import {mobileShellIcon as icon} from './shell-icons.js';
const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
// Desktop uploads use type=file + kind, generated cards use type=image/video/audio.
export const whiteboardCardKind=node=>['image','video','audio'].includes(node.type)?node.type:node.type==='file'&&['image','video','audio'].includes(node.kind)?node.kind:node.type==='text'?'text':'unsupported';
const kind=whiteboardCardKind;
export function mountWhiteboardAlbum(root,{document:doc,readOnly=false,resolveMedia,saveText,onError}){
 const nodes=doc.canvas?.nodes||[],album=el('section'),filters=el('nav'),grid=el('section');album.className='m3-album mobile-board-album';filters.className='mobile-album-filters m3-filters';filters.setAttribute('aria-label','白板素材分类');grid.className='mobile-album m3-album-grid';
 album.append(el('small','同步白板 · 素材相册'),el('h2',doc.title||'白板'),filters,grid);root.append(album);
 const hint=el('p','点击卡片全屏查看；文本可编辑。媒体预览以本机已同步附件为准。');hint.className='hint';album.append(hint);
 let active='all';
 async function media(node,full=false){
  const type=kind(node);if(!['image','video','audio'].includes(type))throw Error('此卡片格式暂不支持手机预览，原内容已保留。');
  const target=el(type==='image'?'img':type);target.className='mobile-album-media';
  if(type==='image')target.alt=node.name||'白板图片';else{target.controls=full;target.preload='metadata';if(type==='video')target.playsInline=true;}
  // Only the native managed-media resolver may provide a URL. Do not use
  // arbitrary document URLs or local filesystem paths directly in WebView.
  if(!resolveMedia)throw Error('此媒体尚未下载到手机；请先同步附件。');
  target.src=await resolveMedia(node);return target;
 }
 function button(label,key,fn){const b=el('button');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon(key);b.onclick=fn;return b;}
 async function preview(node){
  const d=el('dialog'),head=el('header'),body=el('section'),controls=el('div'),type=kind(node);d.className='mobile-album-fullscreen';d.setAttribute('aria-label','白板卡片全屏预览');head.className='m5-viewer-head';body.className='m5-viewer-content';head.append(el('strong',node.name||({text:'文本卡片',image:'图片卡片',video:'视频卡片',audio:'音频卡片'})[type]));
  let editing=false,busy=false,input;
  const close=button('关闭预览','close',()=>{if(editing){onError(Error('请先切换预览保存文本卡片。'));return;}d.close();});
  const draw=async()=>{body.replaceChildren();if(type==='text'){const article=el('article');article.innerHTML=renderMarkdown(node.text||'');body.append(article);}else{const player=await media(node,true);const failed=()=>{if(body.querySelector('.mobile-media-error'))return;const message=el('p',player.error?.code===4?'当前设备不支持此媒体编码，原文件已保留。视频可使用 H.264 编码的 MP4 或 WebM。':'媒体暂时无法读取或解码，原文件已保留，请重新打开重试。');message.className='hint mobile-media-error';message.setAttribute('role','alert');body.append(message);};player.addEventListener('error',failed);body.append(player);if(player.error)failed();if(type!=='image')await player.play().catch(()=>{if(player.error)failed();});}};
  if(type==='text'&&!readOnly){const toggle=button('编辑文本卡片','edit',async()=>{if(busy)return;if(!editing){input=el('textarea');input.setAttribute('aria-label','文本卡片正文');input.value=node.text||'';body.replaceChildren(input);editing=true;toggle.innerHTML=icon('read');toggle.setAttribute('aria-label','保存并预览文本卡片');input.focus();return;}busy=true;toggle.disabled=true;try{await saveText(node.id,input.value);node.text=input.value;editing=false;await draw();toggle.innerHTML=icon('edit');toggle.setAttribute('aria-label','编辑文本卡片');render();}catch(e){onError(e);}finally{busy=false;toggle.disabled=false;}});controls.append(toggle);}
  controls.append(close);head.append(controls);d.append(head,body);d.oncancel=e=>{if(editing||busy){e.preventDefault();onError(Error('请先保存文本卡片。'));}};d.addEventListener('close',()=>{d.querySelectorAll('video,audio').forEach(p=>{p.pause();p.removeAttribute('src');p.load();});d.remove();});root.append(d);d.showModal();try{await draw();}catch(error){body.append(el('p',error.message));}
 }
 function render(){
  grid.replaceChildren();filters.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.kind===active));b.classList.toggle('active',b.dataset.kind===active);});
  for(const node of nodes.filter(n=>active==='all'||kind(n)===active)){
   const card=el('button');card.type='button';card.className='mobile-album-card m3-asset';card.dataset.node=node.id;card.onclick=()=>preview(node);
   const type=kind(node),label=({text:'文本',image:'图片',video:'视频',audio:'音频',unsupported:'其他'})[type],name=node.name||label+'卡片',thumbnail=el('div'),meta=el('small',label+' · '+(type==='text'?'保存在本机':resolveMedia?'点击全屏查看':'附件待同步'));thumbnail.className='mobile-album-thumbnail';card.setAttribute('aria-label','全屏查看 '+name);
   if(type==='text'){thumbnail.append(el('p',(node.text||'').slice(0,250)));}else if(type==='image'){
    const placeholder=el('span','正在读取预览…');placeholder.className='mobile-album-placeholder';thumbnail.append(placeholder);media(node).then(view=>{if(card.isConnected){placeholder.replaceWith(view);meta.textContent=label+' · 可预览';}}).catch(()=>{placeholder.textContent='附件待同步';meta.textContent=label+' · 附件待同步';});
   }else{const symbol=el('span',type==='video'?'▷':type==='audio'?'♫':'◇');symbol.className='m3-media-symbol';symbol.setAttribute('aria-hidden','true');thumbnail.append(symbol);}
   card.append(thumbnail,el('b',name),meta);grid.append(card);
  }
  if(!grid.childElementCount)grid.append(el('p',nodes.length?'暂无此类卡片':'白板为空，可从电脑同步卡片，或上传手机素材。'));
 }
 for(const [id,label]of [['all','全部'],['text','文本'],['image','图片'],['video','视频'],['audio','音频']]){const b=el('button',label);b.type='button';b.dataset.kind=id;b.onclick=()=>{active=id;render();};filters.append(b);}render();
}
