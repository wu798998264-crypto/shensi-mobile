// Browser previews may deny the async API even for a user's copy click.
// The fallback still uses the browser's copy permission, never a server API.
export async function copyText(text){
 const value=String(text??'');
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return;}}catch{}
 const active=document.activeElement,selection=document.getSelection(),ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[];
 let caret;try{if(typeof active?.selectionStart==='number')caret=[active.selectionStart,active.selectionEnd,active.selectionDirection];}catch{}
 const input=document.createElement('textarea');input.value=value;input.readOnly=true;input.tabIndex=-1;input.setAttribute('aria-label','复制文本');input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
 (active?.closest?.('dialog[open]')||document.body).append(input);
 try{
  input.focus({preventScroll:true});input.select();input.setSelectionRange(0,value.length);
  if(!document.execCommand('copy'))throw Error('copy rejected');
 }catch{throw Error('未能写入剪贴板，请选中回复文字后按 Ctrl+C（Mac 为 ⌘C）。');}
 finally{
  input.remove();if(active?.isConnected)active.focus({preventScroll:true});
  if(selection){selection.removeAllRanges();for(const range of ranges)if(range.commonAncestorContainer.isConnected)selection.addRange(range);}
  if(caret&&active?.isConnected)try{active.setSelectionRange(...caret);}catch{}
 }
}
