// The desktop and mobile editors share parsing and lossless source conversion.
import {renderDocumentMarkdown} from '../core/legacy/document-markdown.js';
import {documentDomToMarkdown} from '../core/legacy/document-markdown-serialize.js';
export const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeLink=value=>{try{const u=new URL(value);return ['https:','http:','mailto:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const clearTransactions=new WeakMap();
export const renderMarkdown=source=>renderDocumentMarkdown(source,{mobile:true})||'<p><br></p>';
export const editorMarkdown=editor=>documentDomToMarkdown(editor);
export function editRichText(editor,command){
 if(!editor||editor.contentEditable!=='true')return false;
 const doc=editor.ownerDocument,selection=doc.getSelection();let range=selection?.rangeCount?selection.getRangeAt(0):null;
 if(!range||!editor.contains(range.commonAncestorContainer)){range=doc.createRange();range.selectNodeContents(editor);range.collapse(false);}
 editor.focus();selection.removeAllRanges();selection.addRange(range);
 const commands={bold:'bold',italic:'italic',strike:'strikeThrough',list:'insertUnorderedList',undo:'undo',redo:'redo'};
 doc.execCommand('styleWithCSS',false,false);
 if(commands[command]){
  const transactions=clearTransactions.get(editor)||[],transaction=[...transactions].reverse().find(t=>editor.innerHTML===(command==='undo'?t.after:command==='redo'?t.before:null));
  if(transaction)for(let n=0;n<transaction.steps;n++)doc.execCommand(commands[command],false);
  else doc.execCommand(commands[command],false);
 }
 else if(command==='clear'){
  const before=editor.innerHTML;let steps=0;
  const execute=(name,value)=>{const previous=editor.innerHTML,applied=doc.execCommand(name,false,value);if(editor.innerHTML!==previous||name==='insertHTML'&&applied)steps++;};
  // A collapsed caret means the whole document; explicit ranges stay scoped.
  // Native removeFormat alone leaves headings, links and lists behind.
  if(range.collapsed){range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);}
  const beforeRange=doc.createRange(),afterRange=doc.createRange();beforeRange.selectNodeContents(editor);beforeRange.setEnd(range.startContainer,range.startOffset);afterRange.selectNodeContents(editor);afterRange.setStart(range.endContainer,range.endOffset);
  const entire=!beforeRange.toString()&&!afterRange.toString();if(entire){range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);}
  const fragment=range.cloneContents(),blocks=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','LI','PRE']);
  const plain=node=>node.nodeType===3?node.nodeValue:node.nodeType===11?[...node.childNodes].map(plain).join(''):node.nodeType!==1?'':node.tagName==='BR'?'\n':['SCRIPT','STYLE','IFRAME','OBJECT'].includes(node.tagName)?'':(blocks.has(node.tagName)?'\n':'')+[...node.childNodes].map(plain).join('')+(blocks.has(node.tagName)?'\n':'');
  const text=plain(fragment).replace(/\n{3,}/g,'\n\n').replace(/^\n+|\n+$/g,'').replace(/^[☐☑]\s*/gm,'');
  const whole=range.startContainer===editor&&range.startOffset===0&&range.endContainer===editor&&range.endOffset===editor.childNodes.length;
  // insertHTML is one undoable edit; formatBlock normalizes enclosing headings
  // for a full document while partial selections keep unselected text intact.
  if(whole){
   // Chromium otherwise retains the enclosing heading/list even when a full
   // selection is replaced with <p>. Normalize all selected block ancestors.
   execute('formatBlock','p');
   for(let n=0;n<12&&editor.querySelector('ul,ol');n++){
    const prior=editor.innerHTML;range=doc.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);execute('outdent');if(editor.innerHTML===prior)break;
   }
   range=doc.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
   execute('insertHTML',text.split(/\n\n/).map(p=>'<p>'+escapeText(p).replaceAll('\n','<br>')+'</p>').join('')||'<p><br></p>');
  }
  else {execute('removeFormat');execute('unlink');execute('insertHTML',escapeText(text).replaceAll('\n','<br>'));}
  if(steps&&editor.innerHTML!==before)clearTransactions.set(editor,[...(clearTransactions.get(editor)||[]),{before,after:editor.innerHTML,steps}].slice(-40));
 }
 else if(command==='heading'||command==='quote')doc.execCommand('formatBlock',false,command==='heading'?'h2':'blockquote');
 else if(command==='task')doc.execCommand('insertHTML',false,'<ul><li data-task="false">☐ '+escapeText(range.toString()||'待办事项')+'</li></ul>');
 else if(command==='code')doc.execCommand('insertHTML',false,'<code>'+escapeText(range.toString()||'代码')+'</code>');
 else if(command==='link'){const url=doc.defaultView.prompt('链接地址 / Link URL','https://');if(url===null)return false;const safe=safeLink(url);if(!safe)return false;doc.execCommand('insertHTML',false,'<a href="'+escapeText(safe)+'">'+escapeText(range.toString()||safe)+'</a>');}
 else return false;
 editor.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));return true;
}
export function bindRichText(editor,onInput){
 editor.addEventListener('input',onInput);
 editor.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();editRichText(editor,event.shiftKey?'redo':'undo');}});
 editor.addEventListener('paste',event=>{event.preventDefault();editor.ownerDocument.execCommand('insertText',false,event.clipboardData?.getData('text/plain')||'');});
 editor.addEventListener('drop',event=>event.preventDefault());
 editor.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
}
