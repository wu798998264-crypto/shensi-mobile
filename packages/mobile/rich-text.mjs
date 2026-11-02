// A small, shared editor contract. Source is Markdown, never executable HTML.
export const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeLink=value=>{try{const u=new URL(value);return ['https:','http:','mailto:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const clearTransactions=new WeakMap();
function inline(source){
 const tokens=[],hold=html=>'\u0000'+(tokens.push(html)-1)+'\u0000';
 let text=String(source).replace(/\u0000/g,'').replace(/\\([\\`*_[\]~<>])/g,(_,c)=>hold(escapeText(c)));
 text=text.replace(/`([^`\n]+)`/g,(_,c)=>hold('<code>'+escapeText(c)+'</code>'));
 text=text.replace(/!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(([^)\n]+)\)/g,(source,wiki,label,path)=>{
  const file=wiki||path,ext=file.split('.').pop().toLowerCase(),tag=['png','jpg','jpeg','webp','gif'].includes(ext)?'img':['mp4','mov','webm'].includes(ext)?'video':['mp3','wav','m4a','ogg'].includes(ext)?'audio':'';
  const managed=/^(?:附件|08_资料库\/附件)\//.test(file)&&!/[\\:<>"|?*\x00-\x1f]/.test(file)&&file.split('/').every(p=>p&&p!=='.'&&p!=='..');
  const body=tag&&managed?'<'+tag+' data-attachment-path="'+escapeText(file)+'" '+(tag==='img'?'alt="'+escapeText(label||file)+'"':'controls preload="metadata"')+'>'+(tag==='img'?'':'</'+tag+'>'):escapeText(label||file);
  return hold('<span data-mobile-media="'+escapeText(file)+'" data-media-source="'+escapeText(source)+'" contenteditable="false">'+body+'</span>');
 });
 text=text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g,(_,label,url)=>hold(safeLink(url)?'<a href="'+escapeText(safeLink(url))+'" rel="noopener noreferrer">'+escapeText(label)+'</a>':escapeText(label+' ('+url+')')));
 text=escapeText(text).replace(/\*\*\*([^*\n]+)\*\*\*/g,'<strong><em>$1</em></strong>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/~~([^~\n]+)~~/g,'<s>$1</s>');
 return text.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[Number(i)]);
}
export function renderMarkdown(markdown){
 const lines=String(markdown??'').replace(/\r\n/g,'\n').split('\n'),html=[];let paragraph=[],list=[],listTag='',code=null;
 const flush=()=>{if(paragraph.length){html.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph=[];}if(list.length){html.push('<'+listTag+'>'+list.join('')+'</'+listTag+'>');list=[];listTag='';}};
 for(const line of lines){
  if(/^```/.test(line)){flush();if(code===null)code=[];else{html.push('<pre><code>'+escapeText(code.join('\n'))+'</code></pre>');code=null;}continue;}
  if(code!==null){code.push(line);continue;}
  if(!line.trim()){flush();continue;}
  const heading=/^(#{1,6})\s+(.+)$/.exec(line),quote=/^>\s?(.*)$/.exec(line),item=/^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
  if(heading){flush();html.push('<h'+heading[1].length+'>'+inline(heading[2])+'</h'+heading[1].length+'>');}
  else if(quote){flush();html.push('<blockquote>'+inline(quote[1])+'</blockquote>');}
  else if(item){const tag=/^\d/.test(line)?'ol':'ul';if(paragraph.length||listTag&&listTag!==tag)flush();listTag=tag;const task=/^\[([ xX])\]\s+(.*)$/.exec(item[1]);list.push(task?'<li data-task="'+(task[1]===' '?'false':'true')+'">'+(task[1]===' '?'☐ ':'☑ ')+inline(task[2])+'</li>':'<li>'+inline(item[1])+'</li>');}
  else {if(list.length)flush();paragraph.push(line);}
 }
 flush();if(code!==null)html.push('<pre><code>'+escapeText(code.join('\n'))+'</code></pre>');return html.join('')||'<p><br></p>';
}
export function editorMarkdown(editor){
 const walk=node=>{
  if(node.nodeType===3)return node.nodeValue.replace(/[\\`*_[\]~]/g,'\\$&');
  if(node.nodeType!==1)return '';
  if(node.hasAttribute('data-mobile-media'))return node.getAttribute('data-media-source')||'';
  const tag=node.tagName.toLowerCase();if(['script','style','iframe','object','img'].includes(tag))return '';
  const children=()=>[...node.childNodes].map(walk).join(''),wrap=marker=>{const t=children();return t.trim()?t.replace(/^(\s*)([\s\S]*?)(\s*)$/,(_,a,b,c)=>a+marker+b+marker+c):t;};
  if(tag==='br')return '\n';if(tag==='strong'||tag==='b')return wrap('**');if(tag==='em'||tag==='i')return wrap('*');if(tag==='s'||tag==='strike'||tag==='del')return wrap('~~');
  if(tag==='pre')return '\n\n```\n'+node.textContent+'\n```\n\n';
  if(tag==='code')return '`'+node.textContent.replaceAll('`','\\`')+'`';
  if(tag==='a'){const url=safeLink(node.getAttribute('href'));return url?'['+children()+']('+url.replaceAll(')','%29')+')':children();}
  if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children().trim()+'\n\n';
  if(tag==='blockquote')return '\n\n'+children().trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
  if(tag==='li'){const task=node.getAttribute('data-task'),body=children().trim().replace(/^[☐☑]\s*/,'');return (node.parentElement?.tagName==='OL'?'1. ':'- ')+(task===null?'':task==='true'?'[x] ':'[ ] ')+body+'\n';}
  if(tag==='ul'||tag==='ol')return '\n\n'+children()+'\n';
  if(tag==='p'||tag==='div')return '\n\n'+children()+'\n\n';
  if(tag==='span'){if(/^(bold|[6-9]00)$/.test(node.style.fontWeight))return wrap('**');if(node.style.fontStyle==='italic')return wrap('*');if(node.style.textDecorationLine.includes('line-through'))return wrap('~~');}
  return children();
 };
 return [...editor.childNodes].map(walk).join('').replace(/\n{3,}/g,'\n\n').trim();
}
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
