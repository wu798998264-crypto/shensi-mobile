// Interactive, local-only mobile proposal. Never calls product or marketplace APIs.
// Product API and native secrets must not be substituted with these preview records.
// BEGIN SHARED MOBILE EDITOR
// A small, shared editor contract. Source is Markdown, never executable HTML.
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const u=new URL(value);return ['https:','http:','mailto:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const clearTransactions=new WeakMap();
function inline(source){
 const tokens=[],hold=html=>'\u0000'+(tokens.push(html)-1)+'\u0000';
 let text=String(source).replace(/\u0000/g,'').replace(/\\([\\`*_[\]~<>])/g,(_,c)=>hold(escapeText(c)));
 text=text.replace(/`([^`\n]+)`/g,(_,c)=>hold('<code>'+escapeText(c)+'</code>'));
 text=text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g,(_,label,url)=>hold(safeLink(url)?'<a href="'+escapeText(safeLink(url))+'" rel="noopener noreferrer">'+escapeText(label)+'</a>':escapeText(label+' ('+url+')')));
 text=escapeText(text).replace(/\*\*\*([^*\n]+)\*\*\*/g,'<strong><em>$1</em></strong>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/~~([^~\n]+)~~/g,'<s>$1</s>');
 return text.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[Number(i)]);
}
function renderMarkdown(markdown){
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
function editorMarkdown(editor){
 const walk=node=>{
  if(node.nodeType===3)return node.nodeValue.replace(/[\\`*_[\]~]/g,'\\$&');
  if(node.nodeType!==1)return '';
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
function editRichText(editor,command){
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
function bindRichText(editor,onInput){
 editor.addEventListener('input',onInput);
 editor.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();editRichText(editor,event.shiftKey?'redo':'undo');}});
 editor.addEventListener('paste',event=>{event.preventDefault();editor.ownerDocument.execCommand('insertText',false,event.clipboardData?.getData('text/plain')||'');});
 editor.addEventListener('drop',event=>event.preventDefault());
 editor.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
}

// One soft, rounded icon language for the native entry and the approved preview.
const editorPaths={
 undo:'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',redo:'m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
 heading:'M5 5v14M19 5v14M5 12h14',bold:'M7 4h6a4 4 0 0 1 0 8H7V4m0 8h7a4 4 0 0 1 0 8H7v-8',
 italic:'M10 4h9M5 20h9M15 4 9 20',strike:'M17 6c-1-3-10-3-10 2 0 2 2 3 5 4m5 3c2 7-10 7-11 3M3 12h18',
 list:'M9 6h12M9 12h12M9 18h12M3 6h.1M3 12h.1M3 18h.1',task:'M9 5h11M9 12h11M9 19h11M2 5l2 2 3-4M2 12h3M2 19h3',
 quote:'M4 6h6v7H5c0 3 2 4 4 4M14 6h6v7h-5c0 3 2 4 4 4',link:'M10 14l4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
 code:'m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 22',
 clear:'M4 4h14M11 4 8 15m9-5 5 5-6 6h-5l-3-3 9-8m-5 4 6 6M3 21h5'
};
const mobileEditorTools=[['undo','撤销'],['redo','重做'],['heading','标题'],['bold','加粗'],['italic','斜体'],['strike','删除线'],['list','列表'],['task','待办'],['quote','引用'],['link','链接'],['code','代码'],['clear','清除格式']];
function editorIcon(id){return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${editorPaths[id]||editorPaths.clear}"/></svg>`;}

// END SHARED MOBILE EDITOR
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={panel:'M4 3h16v18H4z M10 3v18 M6.5 7h1 M6.5 11h1',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',new:'M5 3h10l4 4v14H5z M9 13h6 M12 10v6',tabs:'M4 7h12v14H4z M8 3h12v14',doc:'M5 3h10l4 4v14H5z M8 11h8 M8 15h5',edit:'m4 16 12-12 4 4L8 20H4z M14 6l4 4',read:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',more:'M5 12h.01 M12 12h.01 M19 12h.01',settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',close:'M6 6l12 12 M18 6 6 18',chat:'M3 4h18v13H9l-6 4z M7 9h10 M7 13h6',cloud:'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11z',folder:'M3 6h7l2 3h9v12H3z',download:'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',trash:'M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M9 10v7 M15 10v7'};
Object.assign(icons,{settings:'M9.5 3h5l.6 2.4 2.1 1.2 2.4-.7 2.5 4.2-1.8 1.8v2.4l1.8 1.8-2.5 4.2-2.4-.7-2.1 1.2-.6 2.2h-5l-.6-2.2-2.1-1.2-2.4.7L1.4 16l1.8-1.8v-2.4L1.4 10l2.5-4.2 2.4.7 2.1-1.2z M9 13a3 3 0 1 0 6 0 3 3 0 0 0-6 0',lock:'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',unlock:'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0 M12 14v3',upload:'M12 16V3 m-5 5 5-5 5 5 M4 16v5h16v-5',expand:'m7 14 5-5 5 5',collapse:'m7 10 5 5 5-5'});
// Selected cloud-preview glyphs, vendored from Lucide 1.17.0 (see lucide-LICENSE.txt).
// Keep the existing icon boxes, actions and colors; no CDN request is required.
const softIcons={
 panel:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18 M14 9l3 3-3 3"/>',
 search:'<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
 new:'<path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35 M14 2v5a1 1 0 0 0 1 1h5 M14 19h6 M17 16v6"/>',
 tabs:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18 M9 21V9"/>',
 doc:'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z M14 2v5a1 1 0 0 0 1 1h5 M10 9H8 M16 13H8 M16 17H8"/>',
 edit:'<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
 read:'<path d="M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
 more:'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
 settings:'<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
 chat:'<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/>',
 cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
 folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
 download:'<path d="M12 15V3 M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 m4-5 5 5 5-5"/>',
 trash:'<path d="M10 11v6 M14 11v6 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
 lock:'<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
 unlock:'<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 9.33-2.5"/>',
 upload:'<path d="M12 3v12 m5-7-5-5-5 5 M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
 expand:'<path d="m17 11-5-5-5 5 m10 7-5-5-5 5"/>',collapse:'<path d="m7 6 5 5 5-5 M7 13l5 5 5-5"/>',
 star:'<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'
};
const icon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true" data-mobile-icon="${h(k)}">${softIcons[k]||`<path d="${icons[k]||icons.doc}"/>`}</svg>`;
Object.assign(softIcons,{
 arrow:'<path d="M12 19V5 m-6 6 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',right:'<path d="m9 6 6 6-6 6"/>',
 check:'<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/>',tick:'<path d="m5 12 4 4L19 6"/>',
 history:'<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8 M3 3v5h5 M12 7v5l3 2"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 link:'<path d="M10 13a5 5 0 0 0 7 .4l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7-.4l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
 outline:'<path d="M4 3v14a2 2 0 0 0 2 2h3 M4 5h5 M4 12h5 M13 5h7 M13 12h7 M13 19h7"/>',
 sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M3 2v4 M1 4h4 M21 18v4 M19 20h4"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 language:'<path d="M2 5h12 M7 2v3 M11 5a15 15 0 0 1-8 10 M4 9a15 15 0 0 0 7 6 M14 21l4-10 4 10 M16 17h4"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2 M12 20v2 M2 12h2 M20 12h2 m-3.1-7.1 1.4-1.4 M5.7 18.3l1.4-1.4 M5.7 5.7l1.4 1.4 M16.9 16.9l1.4 1.4"/>',
 moon:'<path d="M20.7 13.1A9 9 0 0 1 10.9 3.3a9 9 0 1 0 9.8 9.8Z"/>',
 monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4 M8 21h8"/>',
 blocks:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 puzzle:'<path d="M19 13h-1.5a2.5 2.5 0 1 0 0 5H19v2a1 1 0 0 1-1 1h-5v-1.5a2.5 2.5 0 1 0-5 0V21H4a1 1 0 0 1-1-1v-5h1.5a2.5 2.5 0 1 0 0-5H3V6a1 1 0 0 1 1-1h5V3.5a2.5 2.5 0 1 1 5 0V5h4a1 1 0 0 1 1 1Z"/>',
 sliders:'<path d="M3 6h4 M11 6h10 M3 12h10 M17 12h4 M3 18h2 M9 18h12"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>',
 refresh:'<path d="M3 10a9 9 0 0 1 15-6l3 3 M21 3v4h-4 M21 14a9 9 0 0 1-15 6l-3-3 M3 21v-4h4"/>',
 logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M9 12h12 m-4-4 4 4-4 4"/>',
 folderOpen:'<path d="M3 8V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2 M4 21h14a2 2 0 0 0 2-1.5l2-8a1 1 0 0 0-1-1.5H6a2 2 0 0 0-2 1.5l-2 7A2 2 0 0 0 4 21Z"/>',
 board:'<rect x="3" y="3" width="18" height="15" rx="2"/><path d="M8 22l4-4 4 4 M8 8h8 M8 12h5"/>',headphones:'<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>'
});
const btn=(action,label,k,extra='')=>`<button data-m3="${action}" aria-label="${h(label)}" title="${h(label)}" ${extra}>${icon(k)}</button>`;
const initial={notebook:'北境志',language:'简体中文',appearance:'跟随系统',active:'chapter',tabs:['chapter','lore','board'],installed:['nutstore'],documents:[{id:'chapter',name:'第 07 章 · 风雪以北',folder:'正文 / 第一卷',type:'text',text:'## 山口\n\n最后一盏灯熄灭时，雪才真正落下来。\n\n她把那片刻着霜羽铭文的石片收进衣襟。山口之外，没有人知道这行字的意思。\n\n“星光不照归途，誓言会。”\n\n## 守灯人\n\n远处的守灯人抬起手，指向被云层遮住的北方。那里是她的故乡，也是故事重新开始的地方。',versions:[]},{id:'lore',name:'霜羽族',folder:'作品设定',type:'text',text:'霜羽族以星象记录迁徙，以铭文保存誓言。',versions:[]},{id:'board',name:'北境场景',folder:'创作素材',type:'album',text:'',versions:[]},{id:'discarded',name:'旧场景草稿',folder:'正文',type:'text',text:'守灯人最初住在南方。',deleted:true,versions:[]} ]};
let s;try{s=JSON.parse(localStorage.getItem('shensi-mobile-preview-v3'))||structuredClone(initial);}catch{s=structuredClone(initial);}
let panel='',sheet='',reading=true,screen='write',plugin='chat',opened=['chat','outline','nutstore'],filter='all',preview='',model='官方算力套餐',expanded=new Set(),host,rerender,notify,search='',message='',selectedHistory=0,pluginMenu=false,recycledId='';
let assetEditing=false, favoritesOnly=false, purgeTarget='', apiEditing='';
let chatDraft='',syncExampleConnected=true;
let editorDirty=false,versionTarget=null;
s.favorites??={};s.apiProfiles??=[];s.historyDays??=30;
icons.star='m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z';
s.modelChoice??={source:'官方算力套餐',model:'shensi-balanced',effort:'medium'};
model=s.modelChoice.source;
const officialModels=[{id:'shensi-balanced',name:'神思 · 均衡模型（演示）',efforts:['low','medium','high'],speeds:['default','fast']},{id:'shensi-reasoning',name:'神思 · 深度推理（演示）',efforts:['medium','high','xhigh'],speeds:['default','fast']}];
delete s.work;
if(!s.mobileV4){s.mobileV4=true;s.documents.push({id:'archived-folder',name:'早期设定',type:'folder',deleted:true,children:[{id:'archived-place',name:'城镇',type:'folder',children:[{id:'archived-harbor',name:'旧港口.md',type:'text',text:'# 旧港口\n\n港口最初被称为归潮。',versions:[]}]},{id:'archived-people',name:'人物初稿.md',type:'text',text:'守灯人曾是一名船长。',versions:[]}]});}
const pluginName=id=>({chat:'文档对话',outline:'大纲',nutstore:'坚果云同步',reader:'文档朗读',focus:'专注时钟'})[id]||id;
// Bind formerly unscoped preview records once without touching production data.
for(const d of s.documents) d.notebook??=s.notebook;
const notebookDocuments=()=>s.documents.filter(d=>!d.deleted&&d.type!=='folder'&&d.notebook===s.notebook);
const menuRow=(action,label,k,detail='',extra='')=>`<button type="button" class="m7-menu-row" data-m3="${h(action)}" ${extra}>${icon(k)}<span>${h(label)}</span>${detail?`<small>${h(detail)}</small>`:''}</button>`;
const settingRow=(action,label,k,detail='')=>`<button type="button" class="m7-setting-row" data-m3="${h(action)}">${icon(k)}<span>${h(label)}</span>${detail?`<small>${h(detail)}</small>`:''}${icon('right')}</button>`;
const pluginMenuRow=id=>menuRow('plugin:'+id,'打开'+pluginName(id),({chat:'chat',outline:'outline',nutstore:'cloud',reader:'headphones',focus:'clock'})[id]||'puzzle');
function settingsHome(){return `<section class="m3-settings m7-settings"><h2>设置</h2><button type="button" class="m7-account-row" data-m3="account"><span class="m7-avatar">${icon('user')}</span><span><b>账户设置</b><small>登录账户与管理服务</small></span>${icon('right')}</button><h4>阅读与保存</h4><div class="m7-setting-group">${settingRow('language-menu','界面语言','language',s.language)}${settingRow('appearance-menu','外观','moon',s.appearance)}${settingRow('history-settings','历史版本','history',s.historyDays?'保留 '+s.historyDays+' 天':'永久保留')}${settingRow('recycle','回收站','trash',s.documents.filter(d=>d.deleted).length+' 项')}</div><h4>插件与连接</h4><div class="m7-setting-group">${settingRow('core-plugins','核心插件','puzzle')}${settingRow('extensions','扩展插件','blocks')}${settingRow('cloud-unavailable','云端同步','cloud','暂无')}${settingRow('api-settings','自定义 API','sliders',s.apiProfiles.length+' 个配置')}</div><p class="hint">仅样式演示，不改变正式设置</p></section>`;}
function nutstoreMenu(){return `<div class="m7-sync-menu">${menuRow('sync-info',syncExampleConnected?'已连接 · 示例状态':'未连接 · 示例状态','check')}${menuRow('sync-demo','立即同步','refresh')}${menuRow('sync-auto','自动同步','clock')}${menuRow('sync-signout',syncExampleConnected?'退出登录':'连接账号','logout')}<p class="hint" role="status">${h(message||'仅预览，不连接真实坚果云。')}</p></div>`;}
function chatBody(){normalizeChatModelChoice();const {selected,efforts,speeds}=chatModelCapabilities();const effort=({low:'轻量',medium:'标准',high:'深入',xhigh:'最高'})[s.modelChoice.effort]||'默认';return `<p class="m7-user-message">把这一章出现的线索整理到世界设定里，保留原文。</p><div class="m7-assistant-message"><div class="m7-assistant-label">${icon('sparkles')}<span>神思 AI · 示例回复</span></div><p>已归纳出三条线索：霜羽铭文、守灯人，以及北方的故乡。</p><p>原文保留，整理结果写入「世界设定 / 线索」，并创建历史版本。</p><details class="m7-execution"><summary>${icon('check')}<span>查看本轮执行记录</span>${icon('down')}</summary><p>定位文档 → 核对版本 → 保存历史 → 写入回读。正式对话由 AI 选择路径，用户无需手动配置落盘计划。</p><button data-m3="plan">演示文档写入</button></details></div><div class="m3-chat-input m7-compose"><textarea placeholder="继续聊聊这一章…" aria-label="文档对话输入">${h(chatDraft)}</textarea><div class="m7-compose-actions"><button type="button" class="m7-model-button" data-m3="model" aria-label="选择模型配置">${icon('sparkles')}<span>${h(selectedConfigName())}</span>${icon('down')}</button><button type="button" class="m7-effort-button" data-m3="model-options" aria-label="选择具体模型和参数"><span>${h(selected.name.replace(/（演示）/g,''))}${efforts.length?' · '+h(effort):''}${speeds.length?' · '+(s.modelChoice.speed==='fast'?'快速':'标准'):''}</span>${icon('down')}</button><button type="button" class="m7-send" data-m3="chat-demo" aria-label="发送预览消息">${icon('arrow')}</button></div></div>`;}
const outline=()=>[{text:doc()?.name||'未打开文档',level:1},...(doc()?.text||'').split('\n').map((text,index)=>{const m=/^(#{1,6})\s+(.+)$/.exec(text);return m?{text:m[2],level:m[1].length,index}:null;}).filter(Boolean)];
const recycleFind=id=>{const find=items=>{for(const d of items){if(d.id===id)return d;const child=find(d.children||[]);if(child)return child;}return null;};return find(s.documents.filter(d=>d.deleted));};
const recycleTree=items=>items.map(d=>d.children?`<details data-m3-recycle-folder="${h(d.id)}"><summary>${icon('folder')}${h(d.name)}</summary><button data-m3="purge:${h(d.id)}" class="m6-danger">彻底删除文件夹</button>${recycleTree(d.children)}</details>`:`<div class="m6-recycle-row"><button class="m3-row" data-m3="recycle-view:${h(d.id)}">${icon('doc')}<span>${h(d.name)}</span><span>预览</span></button>${btn('purge:'+d.id,'彻底删除 '+d.name,'trash')}</div>`).join('');
const save=()=>{const cutoff=s.historyDays?Date.now()-s.historyDays*86400000:0;for(const d of s.documents)if(d.versions?.length&&cutoff)d.versions=d.versions.filter((v,i)=>i===0||!v.createdAt||Number(v.createdAt)>=cutoff);localStorage.setItem('shensi-mobile-preview-v3',JSON.stringify(s));};
const doc=()=>s.documents.find(d=>d.id===s.active&&!d.deleted);
const row=(action,label,detail='›')=>`<button class="m3-row" data-m3="${action}"><span>${h(label)}</span><span>${h(detail)}</span></button>`;
const option=(action,label,active)=>`<button data-m3="${action}" class="${active?'active':''}">${h(label)}</button>`;
function openSheet(name){sheet=name;history.pushState({mobilePreview:true},'');rerender();}
function showPanel(name){panel=name;sheet='';history.pushState({mobilePreview:true},'');rerender();}
function directory(){
 const tree={children:new Map(),files:[]},all=notebookDocuments(),documents=all.filter(d=>!favoritesOnly||(s.favorites[s.notebook]||[]).includes(d.id));
 for(const d of documents){let node=tree;for(const name of (favoritesOnly?'':d.folder||'').split(' / ').filter(Boolean)){if(!node.children.has(name))node.children.set(name,{children:new Map(),files:[]});node=node.children.get(name);}node.files.push(d);}
 const branches=(node,path='',depth=0)=>[...node.children].map(([name,child])=>{const key=path?path+' / '+name:name;return `<details ${expanded.has(key)?'open':''} data-m3-folder="${h(key)}"><summary style="padding-left:${8+depth*14}px">${icon('folder')}${h(name)}</summary>${branches(child,key,depth+1)}</details>`;}).join('')+node.files.map(d=>`<button data-m3-open="${d.id}" class="${d.id===s.active?'active':''}" style="padding-left:${12+depth*14}px">${icon(d.type==='album'?'tabs':'doc')}<span>${h(d.name)}</span></button>`).join('');
 return `<aside class="m3-directory"><header><div class="m6-directory-label">${btn('favorites',favoritesOnly?'显示全部文档':'收藏文档','star',`aria-pressed="${favoritesOnly}"`)}<span>${favoritesOnly?'收藏':'目录'}</span></div><select data-m3-notebook aria-label="选择笔记本">${['北境志','随手笔记','知识库'].map(n=>`<option ${s.notebook===n?'selected':''}>${n}</option>`).join('')}</select></header><div class="m3-tree">${branches(tree)}</div><footer><small>当前笔记本共 ${all.length} 个文档（含白板）</small>${btn('settings','设置','settings')}</footer></aside>`;
}
const art=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect width="600" height="400" fill="#d7e4e1"/><circle cx="450" cy="85" r="43" fill="#fbf3d5"/><path d="M0 310L170 70 350 300 440 180 600 340V400H0" fill="#627f78"/><path d="m105 165 65-95 72 92-60-25z" fill="#f9faf2"/><path d="M0 360Q300 270 600 360V400H0" fill="#3e6660"/></svg>`;
const cards=s.albumCards??=[{id:'text',name:'场景笔记',type:'text',body:'山口以北，灯火是唯一的方向。'},{id:'image',name:'雪山色彩草图',type:'image'},{id:'video',name:'镜头运动示意',type:'video'},{id:'audio',name:'环境声示例',type:'audio'}];
function album(){return `<section class="m3-album"><small>同步白板 · 素材相册</small><h2>${h(doc()?.name||'北境场景')}</h2><div class="m3-filters">${[['all','全部'],['text','文本'],['image','图片'],['video','视频'],['audio','音频']].map(([k,n])=>option('filter:'+k,n,filter===k)).join('')}</div><div class="m3-album-grid">${cards.filter(c=>(c.boardId||'board')===doc()?.id).filter(c=>filter==='all'||c.type===filter).map(c=>`<button data-m3="asset:${c.id}" class="m3-asset">${c.type==='image'?`<img alt="合成雪山草图" src="${c.localUpload?'':'data:image/svg+xml,'+encodeURIComponent(art)}" ${c.localUpload?'data-m5-thumbnail="'+h(c.id)+'"':''}>`:c.type==='text'?`<p>${h(c.body)}</p>`:`<span class="m3-media-symbol">${c.type==='video'?'▷':'♫'}</span>`}<b>${h(c.name)}</b><small>${c.type} · ${c.localUpload||c.userText?'已保存本机 · 待接入同步':'合成预览素材'}</small></button>`).join('')}</div><p class="hint">点击卡片全屏查看；文本可修改，图片、视频和音频可上传。预览上传只保存在此浏览器，尚未同步到电脑。</p></section>`;}
function content(){const d=doc();if(screen==='settings')return settingsHome();
 if(d?.type==='album')return album();if(!d)return '<div class="mobile-doc"><h2>打开一个文档</h2><p>使用下方新签页菜单，或滑动展开目录。</p></div>';
 return `${!reading&&!d.locked?editingToolbar():''}<section class="mobile-doc"><h2>${h(d.name)}</h2>${d.locked?'<span class="badge">文档已锁定</span>':''}<article data-m3-editor contenteditable="${!reading&&!d.locked}" aria-label="章节正文">${renderMarkdown(d.text)}</article><small>${reading?'阅读模式':'编辑模式'} · 本机预览保存</small></section>`;
}
function pluginPanel(){return `<aside class="m3-plugin ${plugin==='chat'?'m7-chat':''}"><header><h3>${icon(plugin==='chat'?'chat':plugin==='outline'?'outline':'cloud')}${pluginName(plugin)}</h3>${plugin==='chat'?'<small>核心插件</small>':''}</header><div class="m3-plugin-body ${plugin==='chat'?'m6-chat-body':''}">${plugin==='outline'?`<nav class="m4-outline" aria-label="文档大纲">${outline().map((item,i)=>`<button data-m3="heading:${i}" style="padding-left:${14+(item.level-1)*16}px">${icon('doc')}<span>${h(item.text)}</span></button>`).join('')}</nav>`:plugin==='chat'?chatBody():plugin==='nutstore'?nutstoreMenu():'<p>这是已安装扩展插件的操作区示意。</p><p class="hint">未下载或运行实际插件代码。</p>'}</div><footer class="m4-plugin-footer"><div class="m4-plugin-switch ${pluginMenu?'expanded':''}">${pluginMenu?'<div class="m4-plugin-options">'+opened.map(id=>`<button data-m3="plugin:${id}" class="${id===plugin?'active':''}">${icon(id==='nutstore'?'cloud':id==='chat'?'chat':'doc')}<span>${pluginName(id)}</span></button>`).join('')+'</div>':''}<button class="m4-plugin-pill" data-m3="plugin-menu" aria-expanded="${pluginMenu}">${icon(plugin==='chat'?'chat':plugin==='nutstore'?'cloud':'doc')}<b>${pluginName(plugin)}</b>${icon(pluginMenu?'collapse':'expand')}</button></div></footer></aside>`;}
function sheetContent(){const d=doc(),v7=mobileV7Sheet();if(v7!==null)return v7;const extra=mobileV6Sheet();if(extra!==null)return extra;
 if(sheet==='search')return `<h3>快速搜索</h3><input data-m3-search placeholder="搜索当前笔记本" value="${h(search)}" autofocus><div data-m3-results>${searchResults()}</div>`;
 if(sheet==='new')return `<div class="m7-action-sheet"><h3>新建签页</h3>${menuRow('new-doc','创建新文档','new')}${menuRow('new-board','新建白板','board')}${menuRow('open-file','打开文件','folderOpen')}${menuRow('close-current','关闭当前签页','close')}<input type="file" accept=".txt,.md" data-m3-file hidden></div>`;
 if(sheet==='tabs')return `<h3>签页 <small>${s.tabs.length}</small></h3><div class="m3-tab-grid">${s.tabs.map(id=>s.documents.find(d=>d.id===id&&!d.deleted)).filter(Boolean).map(d=>`<section class="m3-tab-card">${btn('close-tab:'+d.id,'关闭 '+d.name,'close')}<button data-m3-open="${d.id}"><b>${h(d.name)}</b><p>${h(d.type==='album'?'白板只读相册':d.text.slice(0,55))}</p></button></section>`).join('')}</div>`;
 if(sheet==='document')return `<div class="m7-action-sheet m7-document-menu"><h3>${h(d?.name||'未打开文档')}</h3><section aria-label="文档属性与历史">${menuRow('properties','双向链接与属性','link')}${menuRow('favorite',(s.favorites[s.notebook]||[]).includes(d?.id)?'取消收藏':'收藏文档','star')}${menuRow('history','历史版本','history')}</section><section aria-label="可用插件" class="m7-plugin-section"><h4>可用插件</h4>${['chat','outline',...s.installed].map(pluginMenuRow).join('')}</section></div>`;
 if(sheet==='details'||sheet==='properties')return `<h3>文档详情与状态</h3><dl><dt>标题</dt><dd>${h(d?.name||'—')}</dd><dt>位置</dt><dd>${h(s.notebook+' / '+(d?.folder||''))}</dd><dt>状态</dt><dd>${d?.locked?'锁定':'可编辑'}</dd><dt>双向链接</dt><dd><button data-m3-open="lore">霜羽族 ↗</button></dd><dt>属性</dt><dd>类型：${d?.type==='album'?'白板相册':'正文'} · 字数 ${d?.text.length||0}</dd></dl><div class="m7-action-sheet">${menuRow('favorite',(s.favorites[s.notebook]||[]).includes(d?.id)?'取消收藏':'收藏文档','star')}${menuRow('lock',d?.locked?'解除锁定':'锁定文档',d?.locked?'unlock':'lock')}${menuRow('history','历史版本','history')}${menuRow('close-current','关闭文档','close')}${menuRow('delete-confirm','移入回收站','trash')}</div>`;
 if(sheet==='delete-confirm')return `<h3>移入回收站？</h3><p>${h(d?.name)} 将保留正文和历史，可从回收站恢复。</p><button class="primary wide" data-m3="delete">确认移入回收站</button>`;
 if(sheet==='recycle')return `<header class="m6-sheet-heading"><h3>回收站</h3><button data-m3="purge-all" ${s.documents.some(d=>d.deleted)?'':'disabled'}>一键清空</button></header><p class="hint">预览数据真实持久保存，可刷新后恢复；不操作你的正式资料。</p><div class="m4-recycle-tree">${s.documents.filter(d=>d.deleted).map(d=>`<section>${recycleTree([d])}<button class="m4-restore" data-m3="restore:${d.id}">恢复${d.children?'整个文件夹':''}</button></section>`).join('')||'<p>回收站为空</p>'}</div>`;
 if(sheet==='recycle-preview'){const item=recycleFind(recycledId);return `<h3>${h(item?.name||'回收内容')}</h3><article class="m4-recycled-content">${h(item?.text||'无正文')}</article><small>只读预览 · 正文与历史仍保留在回收站</small>${row('recycle','回到回收站')}`;}
 if(sheet==='history')return `<h3>历史版本</h3><p>${h(d?.name||'请先打开文档')}</p>${d?`<div class="m3-group">${d.versions.map((v,i)=>row('version:'+i,v.label,'预览')).join('')||'<p>当前文档尚无历史。进入编辑模式保存后会保留旧版。</p>'}</div>`:''}`;
 if(sheet==='version'){const v=d?.versions[selectedHistory];return `<h3>历史内容</h3><article>${renderMarkdown(v?.text||'')}</article><div class="m8-version-actions"><button class="primary" data-m3="restore-version" ${v?'':'disabled'}>恢复此版本（先保留当前版）</button>${btn('delete-version','删除此版本','trash',`class="m6-danger" ${v?'':'disabled'}`)}</div>`;}
 if(sheet==='delete-version-confirm')return `<h3>删除此历史版本？</h3><p>只删除选中的历史记录，不修改当前正文。删除后无法恢复。</p><div class="m6-dialog-actions"><button data-m3="version-cancel">取消</button><button class="m6-danger" data-m3="delete-version-confirmed">确认删除此版本</button></div>`;
 if(sheet==='model'||sheet==='model-options')return chatModelPicker(sheet==='model');
 if(sheet==='market')return `<h3>插件广场</h3><span class="badge">仅手机兼容</span><p class="hint">目录与下载流程为合成演示，尚未连接真实广场。</p>${[['reader','文档朗读','听书与播放队列'],['focus','专注时钟','安静地写二十五分钟']].map(([id,n,t])=>`<section class="m3-market-card"><div><b>${n}</b><p>${t}</p><small>mobile · 本地交互示意</small></div><button data-m3="install:${id}" ${s.installed.includes(id)?'disabled':''}>${s.installed.includes(id)?'已安装':'演示下载'}</button></section>`).join('')}`;
 if(sheet==='plan')return `<h3>AI 落盘计划</h3><p>北境志 → 作品设定 → 本章线索</p><ol><li>AI 选择路径与文档类型</li><li>宿主核对版本和写入权限</li><li>保留历史，事务写入并回读</li></ol><button class="primary wide" data-m3="apply-plan">应用至预览资料</button>`;
 if(sheet==='asset'){const c=cards.find(c=>c.id===preview);if(!c)return '';return `<header class="m5-viewer-head"><b>${h(c.name)}</b><div>${c.type==='text'?btn('asset-edit',assetEditing?'切换阅读模式':'切换编辑模式',assetEditing?'read':'edit','aria-pressed="'+assetEditing+'"'):''}${btn('dismiss-sheet','关闭预览','close')}</div></header><main class="m5-viewer-content">${c.type==='image'?`<img class="m3-full-art" alt="${h(c.name)}" ${c.localUpload?'data-m5-thumbnail="'+h(c.id)+'"':'src="data:image/svg+xml,'+encodeURIComponent(art)+'"'}>`:c.type==='text'?`<article data-m5-card-editor contenteditable="${assetEditing}" aria-label="文本卡片正文">${h(c.body)}</article>`:'<div class="m3-media-demo">正在准备播放…</div>'}</main><footer class="m5-viewer-footer"><small>${c.localUpload?'已保存本机 · 待接入同步':'独立预览资料'}</small>${btn('download','下载素材','download')}</footer>`;}
 return '<h3>界面预览</h3><p>此操作在正式移植时连接宿主能力，本页不执行外部任务。</p>';
}
function searchResults(){return notebookDocuments().filter(d=>(d.name+d.text).includes(search)).map(d=>`<button class="m3-row" data-m3-open="${d.id}">${h(d.name)}</button>`).join('')||'<p>没有匹配文档</p>';}
function saveCardEditor(){const e=host?.querySelector('[data-m5-card-editor]'),c=cards.find(c=>c.id===preview);if(e&&c&&assetEditing){const text=e.innerText;if(text!==c.body){c.versions??=[];c.versions.unshift({text:c.body,label:'修改前 · '+new Date().toLocaleTimeString()});c.body=text;assetFiles.delete(c.id);save();}}}
function saveEditor(){saveCardEditor();const e=host?.querySelector('[data-m3-editor]'),d=doc();if(e&&d&&!reading&&!d.locked&&editorDirty){const text=editorMarkdown(e);if(text!==d.text){d.versions.unshift({label:'编辑前 · '+new Date().toLocaleTimeString(),createdAt:Date.now(),text:d.text});d.text=text;save();}editorDirty=false;}}
export function createMobileV3({render,toast}){rerender=render;notify=toast;return {page:()=>`<div class="intro"><div><div class="eyebrow">MOBILE / 07</div><h1>一本随身的创作手记。</h1><p>正文居中，目录和工具按需展开。所有交互仅使用独立预览资料。</p></div><span class="badge">待确认 · 非手机安装版</span></div><section class="mobile-stage m3-stage"><aside class="mobile-guide"><div class="eyebrow">LESS CHROME. MORE STORY.</div><h2>把空间<br>还给故事。</h2><p>左滑展开目录<br>右滑打开正在使用的插件</p><div class="screen-switch"><button data-m3="write">正文阅读 <small>四个底部入口</small></button><button data-m3="directory">笔记本目录 <small>笔记本与文件夹</small></button><button data-m3="settings">设置与插件 <small>手机插件广场</small></button><button data-m3-open="board">白板相册 <small>全屏查看 / 上传 / 文本编辑</small></button></div><p class="hint">可使用 Esc 或浏览器返回演示手机返回键；点击浮层外部也会收起。</p></aside><div class="phone-stage"><div class="phone m3-phone ${s.appearance==='深色'?'m3-dark':''}" data-phone data-screen="${h(screen)}" data-appearance="${h(s.appearance)}"><div class="phone-status"><span>16:00</span><span>5G　▰</span></div><header class="phone-head">${btn('directory','展开左侧目录','panel')}<strong>${screen==='settings'?'神思设置':h(s.notebook)}</strong><div>${doc()?.type==='album'?btn('upload','上传素材','upload'):btn('edit',reading?'切换编辑模式':'切换阅读模式',reading?'edit':'read')}${btn('details','文档详情与状态','more')}</div></header><input type="file" data-m5-upload multiple accept="image/*,video/*,audio/*,.txt,.md" hidden><div class="phone-content">${content()}</div><nav class="phone-foot m3-nav">${btn('search','快速搜索','search')}${btn('new','新建签页','new')}${btn('tabs','签页切换','tabs')}${btn('document','当前文档','doc')}</nav><div class="home-indicator"></div>${panel?`<button class="m3-shade" data-m3="dismiss" aria-label="关闭侧栏"></button>${panel==='directory'?directory():pluginPanel()}`:''}${sheet?`<div class="m3-sheet-shade" data-m3="dismiss-sheet"></div><section class="m3-sheet ${sheet==='asset'?'m5-fullscreen':''}" role="dialog" aria-label="${h(sheet)}"><span class="m3-grabber"></span>${sheetContent()}</section>`:''}</div></div><aside class="mobile-rules"><h2>核心仍然完整。</h2><h3>写作与恢复</h3><p>历史版本、锁定、笔记目录、回收站都在。知识资料以笔记本呈现。</p><h3>仅手机所需</h3><p>文档对话是核心插件；坚果云为自带扩展。白板以素材相册呈现，支持上传和文本卡修改，不携带生成与图谱编辑。</p><h3>正式落盘有保护</h3><p>仅官方算力或自定义 API。AI 决定位置，宿主辅助执行、验证并保留历史。</p><span class="badge">本地预览资料 · 不触碰正式库</span></aside></section>`,mount};}
function mount(root){host=root;root.onpointerdown=e=>{if(e.target.closest('[data-m6-edit]'))e.preventDefault();};editorDirty=false;const editor=root.querySelector('[data-m3-editor]');if(editor)bindRichText(editor,()=>{editorDirty=true;});translateMobile(root);void hydrateMedia();void hydrateUploadedImages();root.onclick=async e=>{if(await mobileV7Click(e)||await mobileV6Click(e))return;const open=e.target.closest('[data-m3-open]');if(open){saveEditor();const d=s.documents.find(d=>d.id===open.dataset.m3Open&&!d.deleted);if(!d)return;s.active=d.id;s.notebook=d.notebook||s.notebook;if(!s.tabs.includes(d.id))s.tabs.push(d.id);save();screen='write';panel=sheet='';rerender();return;}
 const b=e.target.closest('[data-m3]');if(!b)return;const a=b.dataset.m3;saveEditor();
 if(a==='upload'){root.querySelector('[data-m5-upload]').click();return;}else if(a==='asset-edit'){assetEditing=!assetEditing;}else if(a==='dismiss'){panel='';}else if(a==='dismiss-sheet'){sheet='';}else if(a==='directory'){showPanel('directory');return;}else if(a==='settings'){panel='';sheet='';screen='settings';}else if(a==='write'){screen='write';panel=sheet='';}else if(a==='edit'){if(!reading&&doc()&&!doc().locked){doc().versions.unshift({label:'保存版本 · '+new Date().toLocaleTimeString(),createdAt:Date.now(),text:doc().text});save();}reading=!reading;screen='write';}else if(a==='plugin-menu'){pluginMenu=!pluginMenu;}else if(a.startsWith('heading:')){const index=Number(a.slice(8));panel='';sheet='';screen='write';rerender();const nodes=host.querySelectorAll('[data-m3-editor] p');const text=outline()[index]?.text;const node=[...nodes].find(p=>p.textContent.includes(text));node?.scrollIntoView({block:'center'});return;}else if(a.startsWith('recycle-view:')){recycledId=a.slice(13);sheet='recycle-preview';}else if(a.startsWith('language:')||a.startsWith('appearance:')){const [key,value]=a.split(':');s[key]=value;save();const details=b.closest('details');const label=details.querySelector('small');label.textContent=value;details.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));root.querySelector('.m3-phone').classList.toggle('m3-dark',s.appearance==='深色');rerender();return;}else if(a.startsWith('plugin:')){plugin=a.slice(7);pluginMenu=false;if(!opened.includes(plugin))opened.push(plugin);showPanel('plugin');return;}else if(a==='new-doc'){const d={id:crypto.randomUUID(),name:'未命名文档',folder:'文档',type:'text',text:'在这里开始写作。',versions:[]};s.documents.push(d);s.active=d.id;s.tabs.push(d.id);reading=false;screen='write';sheet='';save();}else if(a==='open-file'){root.querySelector('[data-m3-file]').click();return;}else if(a==='close-current'||a.startsWith('close-tab:')){const id=a==='close-current'?s.active:a.slice(10);s.tabs=s.tabs.filter(x=>x!==id);if(s.active===id)s.active=s.tabs.at(-1)||'';if(a==='close-current')sheet='';save();}else if(a==='lock'){if(doc())doc().locked=!doc().locked;save();}else if(a==='delete'){if(doc())doc().deleted=true;s.tabs=s.tabs.filter(x=>x!==s.active);s.active=s.tabs.at(-1)||'';sheet='recycle';save();}else if(a.startsWith('restore:')){const d=s.documents.find(d=>d.id===a.slice(8));if(d){if(d.children){const collect=(items,prefix)=>{for(const item of items){if(item.children)collect(item.children,prefix+' / '+item.name);else s.documents.push({...item,deleted:false,notebook:d.notebook||s.notebook,folder:prefix,versions:item.versions||[]});}};collect(d.children,d.name);s.documents=s.documents.filter(x=>x!==d);}else d.deleted=false;save();}}else if(a.startsWith('version:')){selectedHistory=Number(a.slice(8));sheet='version';}else if(a==='restore-version'){const d=doc(),v=d?.versions[selectedHistory];if(v){const restored=v.text;d.versions.unshift({label:'恢复前备份 · '+new Date().toLocaleTimeString(),text:d.text});d.text=restored;save();sheet='history';}}else if(a.startsWith('install:')){const id=a.slice(8);b.disabled=true;b.textContent='演示安装中…';await new Promise(r=>setTimeout(r,450));if(!s.installed.includes(id))s.installed.push(id);save();notify('已加入预览插件列表；未下载正式插件。');}else if(a==='apply-plan'){const id=crypto.randomUUID();s.documents.push({id,name:'本章线索',folder:'作品设定',notebook:s.notebook,type:'text',text:'石片、守灯人、北方故乡。',versions:[{label:'AI 创建前 · 空白',text:''}]});save();sheet='';message='预览文档已保存并可在目录回读';notify(message);}else if(a.startsWith('filter:'))filter=a.slice(7);else if(a.startsWith('asset:')){preview=a.slice(6);assetEditing=false;openSheet('asset');return;}else if(a==='download'){await downloadAsset(cards.find(c=>c.id===preview));return;}else if(a==='sync-demo'){message='合成连通性检查完成；未连接真实坚果云。';}else if(a==='chat-demo'){notify('这是交互预览，未发送模型请求。');return;}else {openSheet(a);return;}rerender();};
 root.onchange=e=>{if(mobileV6Change(e))return;if(e.target.matches('[data-m5-upload]')){void uploadPreviewFiles([...e.target.files]);return;}if(e.target.matches('[data-m5-model]')){s.modelChoice.model=e.target.value;const m=officialModels.find(m=>m.id===s.modelChoice.model);if(!m.efforts.includes(s.modelChoice.effort))s.modelChoice.effort=m.efforts[0];save();rerender();return;}if(e.target.matches('[data-m5-effort]')){s.modelChoice.effort=e.target.value;save();return;}if(e.target.matches('[data-m3-notebook]')){s.notebook=e.target.value;save();rerender();}if(e.target.matches('[data-m3-model]')){model=e.target.value;s.modelChoice.source=model;save();rerender();}if(e.target.matches('[data-m3-file]')){const f=e.target.files[0];if(!f)return;if(f.size>1024*1024){notify('预览仅支持 1MB 以内的文本文件');return;}f.text().then(text=>{const id=crypto.randomUUID();s.documents.push({id,name:f.name,folder:'文档',type:'text',text,notebook:s.notebook,versions:[]});s.active=id;s.tabs.push(id);save();sheet='';screen='write';rerender();});}};
 root.oninput=e=>{if(e.target.matches('.m3-chat-input textarea'))chatDraft=e.target.value;if(e.target.matches('[data-m3-search]')){search=e.target.value;root.querySelector('[data-m3-results]').innerHTML=searchResults();}};
 root.querySelectorAll('[data-m3-folder]').forEach(d=>d.addEventListener('toggle',()=>{d.open?expanded.add(d.dataset.m3Folder):expanded.delete(d.dataset.m3Folder);}));
 const area=root.querySelector('.phone-content');let start;area.onpointerdown=e=>{if(e.target.closest('input,textarea,button,[contenteditable=true]'))return;start={x:e.clientX,y:e.clientY};};area.onpointerup=e=>{if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;if(Math.abs(dx)>65&&Math.abs(dy)<60){saveEditor();showPanel(dx<0?'directory':'plugin');}};
}
window.addEventListener('popstate',()=>{if(!host?.querySelector('.m3-phone'))return;if(sheet||panel||screen!=='write'){saveEditor();sheet=panel='';screen='write';rerender();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&host?.querySelector('.m3-phone')&&(sheet||panel||screen!=='write')){sheet=panel='';screen='write';rerender();}});
async function makeAsset(c){if(c.localUpload){const blob=await previewBlob('get',c.id);if(!blob)throw Error('本机素材缓存已被清理');return {blob,name:c.name};}let blob,name;if(c.type==='text'){blob=new Blob([c.body],{type:'text/plain;charset=utf-8'});name='场景笔记.txt';}else if(c.type==='image'){blob=new Blob([art],{type:'image/svg+xml'});name='雪山草图.svg';}else if(c.type==='audio'){const rate=16000,count=rate,buf=new ArrayBuffer(44+count*2),v=new DataView(buf),str=(o,t)=>[...t].forEach((x,i)=>v.setUint8(o+i,x.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);for(let i=0;i<count;i++)v.setInt16(44+i*2,Math.sin(i/rate*2*Math.PI*220)*2500*Math.sin(i/count*Math.PI),true);blob=new Blob([buf],{type:'audio/wav'});name='合成音频.wav';}else{const canvas=document.createElement('canvas');canvas.width=480;canvas.height=300;const ctx=canvas.getContext('2d'),stream=canvas.captureStream(20),rec=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];rec.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(r=>rec.onstop=r);rec.start();for(let i=0;i<14;i++){ctx.fillStyle='#d7e4e1';ctx.fillRect(0,0,480,300);ctx.fillStyle='#627f78';ctx.beginPath();ctx.moveTo(0,300);ctx.lineTo(180+i*2,40);ctx.lineTo(420,300);ctx.fill();await new Promise(r=>setTimeout(r,50));}rec.stop();await stopped;stream.getTracks().forEach(t=>t.stop());blob=new Blob(chunks,{type:'video/webm'});name='合成镜头示意.webm';}return {blob,name};}
const assetFiles=new Map();
const preparedAsset=c=>{if(!assetFiles.has(c.id))assetFiles.set(c.id,makeAsset(c).then(a=>({...a,url:URL.createObjectURL(a.blob)})).catch(e=>{assetFiles.delete(c.id);throw e;}));return assetFiles.get(c.id);};
async function downloadAsset(c){try{const a=await preparedAsset(c),link=document.createElement('a');link.href=a.url;link.download=a.name;link.click();}catch{notify('本机演示媒体创建失败，请重新打开素材重试。');}}
async function hydrateMedia(){const c=cards.find(c=>c.id===preview);if(sheet!=='asset'||!['audio','video'].includes(c?.type))return;const box=host.querySelector('.m3-media-demo');if(!box)return;box.textContent='正在准备本机演示媒体…';try{const asset=await preparedAsset(c);if(!box.isConnected||preview!==c.id||sheet!=='asset')return;const player=document.createElement(c.type);player.controls=true;player.autoplay=true;player.playsInline=true;player.src=asset.url;player.style.width='100%';player.setAttribute('aria-label','合成'+(c.type==='audio'?'音频':'视频')+'预览');box.replaceChildren(player);void player.play().catch(()=>{});}catch{if(box.isConnected)box.textContent='本机媒体预览不可用，可先查看文本和图片。';}}
// UI-only dictionary: document text, names, saved history and user input remain intact.
const mobileEnglish={
 '目录':'Files','选择笔记本':'Choose notebook','设置':'Settings','神思设置':'Shensi settings','偏好':'Preferences','界面语言':'Language','外观':'Appearance','简体中文':'简体中文','跟随系统':'System','浅色':'Light','深色':'Dark','历史版本':'Version history','模型配置':'Model configuration','回收站':'Recycle bin','核心插件':'Core plugins','扩展插件':'Extensions','文档对话':'Document chat','大纲':'Outline','文档大纲':'Document outline','文本编辑工具栏':'Text toolbar','已启用':'Enabled','坚果云同步':'Nutstore sync','坚果云':'Nutstore','自带':'Included','插件广场':'Plugin marketplace','手机兼容 →':'Mobile compatible →','手机兼容':'Mobile compatible','预览安装':'Preview install','文档朗读':'Text reader','专注时钟':'Focus timer','阅读模式':'Reading mode','编辑模式':'Editing mode','本机预览保存':'Saved locally in preview',
 '快速搜索':'Quick search','新建签页':'New tab','签页切换':'Switch tabs','当前文档':'Current document','展开左侧目录':'Open files','切换编辑模式':'Edit document','切换阅读模式':'Read document','文档详情与状态':'Document details','关闭侧栏':'Close sidebar','新建文档':'New document','打开文件':'Open file','关闭签页':'Close tab','签页':'Tabs','打开一个文档':'Open a document','使用下方新签页菜单，或滑动展开目录。':'Use the new-tab menu below or swipe to open files.','搜索当前笔记本':'Search this notebook','没有匹配文档':'No matching documents',
 '属性与双向链接':'Properties and backlinks','打开可用插件':'Open installed plugins','核心':'Core','已安装':'Installed','未打开文档':'No document open','标题':'Title','位置':'Location','状态':'Status','锁定':'Locked','可编辑':'Editable','双向链接':'Backlinks','属性':'Properties','正文':'Text','锁定文档':'Lock document','解除锁定':'Unlock document','文档已锁定':'Document locked','关闭文档':'Close document','移入回收站':'Move to recycle bin','移入回收站？':'Move to recycle bin?','确认移入回收站':'Confirm deletion','恢复':'Restore','恢复整个文件夹':'Restore folder','回收站为空':'Recycle bin is empty','预览':'Preview','回到回收站':'Back to recycle bin','只读预览 · 正文与历史仍保留在回收站':'Read only · content and history remain in the recycle bin','预览数据真实持久保存，可刷新后恢复；不操作你的正式资料。':'Preview data persists across reloads. Your real library is not accessed.',
 '历史内容':'Version content','请先打开文档':'Open a document first','当前文档尚无历史。进入编辑模式保存后会保留旧版。':'No earlier versions. Saving an edit preserves the previous version.','恢复此版本（先保留当前版）':'Restore version (keep current as history)','文档对话配置':'Chat configuration','模型来源':'Model source','官方算力套餐':'Official credits plan','自定义 API':'Custom API','API 地址':'API endpoint','模型名称':'Model name','你已配置的模型':'Configured model','思考强度':'Reasoning effort','标准':'Standard','官方算力套餐按可用余额与模型能力显示。':'Models depend on available credits and capabilities.','手机不配置 CLI。此页仅演示，不保存密钥。':'No CLI on mobile. This demo does not store API keys.',
 '知识资料作为笔记本显示，不另设知识库 / Skill 插件。当前是本地交互稿，未连接正式广场。':'Knowledge is organized as notebooks. No separate Knowledge / Skill plugin. This local prototype is not connected to the live marketplace.','目录与下载流程为合成演示，尚未连接真实广场。':'Catalog and downloads are simulated; the live marketplace is not connected.','听书与播放队列':'Listening and playback queue','安静地写二十五分钟':'Write quietly for twenty-five minutes','mobile · 本地交互示意':'mobile · Local prototype','演示下载':'Simulate download',
 '合成对话，无实际模型调用。':'Simulated chat; no model calls.','针对当前文档提问…':'Ask about this document…','文档对话输入':'Document chat input','查看 AI 落盘计划':'Review AI save plan','连接你的笔记，保留每次更改。':'Connect your notes. Preserve every change.','示例账号':'Example account','已连接 · 演示':'Connected · Demo','同步位置':'Sync location','最近同步':'Last sync','今天 15:42':'Today 15:42','自动同步':'Automatic sync','待安全核验':'Awaiting safety checks','正式版仅在条件写入、覆盖保护、冲突与原子提交验证通过后开启自动同步。':'Automatic sync requires verified conditional writes, overwrite protection, conflict handling and atomic commits.','演示连通性检查':'Simulate connection test','合成连通性检查完成；未连接真实坚果云。':'Simulated test finished; no real Nutstore connection.','这是已安装扩展插件的操作区示意。':'Operation panel for an installed extension.','未下载或运行实际插件代码。':'No real plugin code was downloaded or executed.',
 'AI 落盘计划':'AI save plan','AI 选择路径与文档类型':'AI chooses location and document type','宿主核对版本和写入权限':'Host checks revision and permissions','保留历史，事务写入并回读':'Preserve history, commit transaction and verify','应用至预览资料':'Apply to preview data','同步白板 · 只读相册':'Synced whiteboard · Read-only gallery','全部':'All','文本':'Text','图片':'Images','视频':'Video','音频':'Audio','白板相册':'Whiteboard gallery','只读预览 / 下载':'View / Download','界面预览':'Interface preview','此操作在正式移植时连接宿主能力，本页不执行外部任务。':'This action will use the host after implementation. No external task runs in this prototype.'
};
function translateMobile(root){
 const phone=root.querySelector('.m3-phone');if(!phone)return;phone.lang=s.language==='English'?'en':'zh-CN';if(s.language!=='English')return;
 const translate=text=>mobileEnglish[text]||text.replace(/^(\d+) 字符$/,'$1 characters').replace(/^(\d+) 天$/,'$1 days').replace(/^保留 (\d+) 天$/,'Keep $1 days').replace(/^(\d+) 项$/,'$1 items').replace(/^(\d+) 个配置$/,'$1 configurations').replace(/^当前笔记本共 (\d+) 个文档（含白板）$/,'$1 documents in this notebook (including boards)').replace(/^(\d+) 个文档 · 预览资料$/,'$1 documents · Preview data').replace(/^(阅读模式|编辑模式) · 本机预览保存$/,(_,mode)=>mobileEnglish[mode]+' · Saved in preview');
 for(const option of phone.querySelectorAll('option')){option.value=option.value;option.textContent=translate(option.textContent);}
 const walker=document.createTreeWalker(phone,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.parentElement.closest('[data-m3-editor],.m4-recycled-content,textarea,option'))continue;const raw=n.textContent,trimmed=raw.trim(),value=translate(trimmed);if(value!==trimmed)n.textContent=raw.replace(trimmed,value);}
 for(const el of phone.querySelectorAll('[aria-label],[title],[placeholder]'))for(const attr of ['aria-label','title','placeholder'])if(el.hasAttribute(attr))el.setAttribute(attr,translate(el.getAttribute(attr)));
}


async function previewBlob(method,id,blob){
 const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('shensi-mobile-assets-v5',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',method==='put'?'readwrite':'readonly'),store=tx.objectStore('files'),req=method==='put'?store.put(blob,id):store.get(id);let value;req.onsuccess=()=>value=req.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('缓存事务中断'));});}finally{db.close();}
}
async function uploadPreviewFiles(files){
 const target=doc();if(target?.type!=='album'||target.locked){notify('请先打开未锁定的白板');return;}
 let count=0;
 try{for(const f of files){if(f.size>64*1024*1024)throw Error('预览单文件上限64MB');
 const type=/^image\//.test(f.type)?'image':/^video\//.test(f.type)?'video':/^audio\//.test(f.type)?'audio':/\.(txt|md)$/i.test(f.name)?'text':'';
 if(!type)throw Error('不支持该文件类型');
 const c={id:crypto.randomUUID(),name:f.name,type,localUpload:true,boardId:target.id};
 if(type==='text'){if(f.size>1024*1024)throw Error('文本预览上限1MB');c.body=await f.text();c.localUpload=false;c.userText=true;}else await previewBlob('put',c.id,f);
 cards.push(c);save();count++;}rerender();notify('已保存 '+count+' 项到本机预览；真实电脑同步尚未接入。');}catch(error){rerender();notify(error.message);}
}
async function hydrateUploadedImages(){for(const img of host.querySelectorAll('[data-m5-thumbnail]')){const c=cards.find(c=>c.id===img.dataset.m5Thumbnail);if(!c)continue;try{const a=await preparedAsset(c);if(img.isConnected)img.src=a.url;}catch{img.alt='素材缓存不可用';}}}
function selectedConfigName(){return s.modelChoice.profileId?s.apiProfiles.find(p=>p.id===s.modelChoice.profileId)?.name||'请选择配置':'神思 AI';}
function chatModelCapabilities(){
 const profile=s.apiProfiles.find(p=>p.id===s.modelChoice.profileId);
 const models=profile?(profile.models?.length?profile.models:[{id:profile.model,name:profile.model,efforts:profile.efforts||[],speeds:profile.speeds||[]}]):officialModels;
 const selected=models.find(m=>m.id===s.modelChoice.model)||models[0];
 return {profile,models,selected,efforts:selected.efforts||[],speeds:(selected.speeds||[]).filter((v,_,all)=>v!=='default'||all.length>1)};
}
function normalizeChatModelChoice(){const {selected,efforts,speeds}=chatModelCapabilities();s.modelChoice.model=selected.id;if(!efforts.includes(s.modelChoice.effort))s.modelChoice.effort=efforts.includes('medium')?'medium':efforts[0]||'';if(!speeds.includes(s.modelChoice.speed))s.modelChoice.speed=speeds[0]||'';}
function chatModelPicker(configOnly=false){
 normalizeChatModelChoice();const {models,selected,efforts,speeds}=chatModelCapabilities();
 return configOnly?`<h3>选择配置</h3><label>配置<select data-m6-profile><option value="">神思 AI · 官方算力套餐（演示）</option>${s.apiProfiles.map(p=>`<option value="${h(p.id)}" ${p.id===s.modelChoice.profileId?'selected':''}>${h(p.name)}</option>`).join('')}</select></label><p class="hint">API 连接在设置中管理；这里只切换已有配置。</p>`:`<h3>模型与参数</h3><label>具体模型<select data-m6-model>${models.map(m=>`<option value="${h(m.id)}" ${m.id===selected.id?'selected':''}>${h(m.name)}</option>`).join('')}</select></label>${efforts.length?`<label>思考强度<select data-m6-effort>${efforts.map(v=>`<option value="${h(v)}" ${v===s.modelChoice.effort?'selected':''}>${h(({low:'轻量',medium:'标准',high:'深入',xhigh:'最高'})[v]||'默认')}</option>`).join('')}</select></label>`:''}${speeds.length?`<label>思考速度<select data-m6-speed>${speeds.map(v=>`<option ${v===s.modelChoice.speed?'selected':''} value="${h(v)}">${v==='fast'?'快速':'标准'}</option>`).join('')}</select></label>`:''}<p class="hint">只显示当前模型支持的选项；演示模型不会发送真实请求。</p>`;
}
function editingToolbar(){return `<nav class="m6-editor-tools" aria-label="文本编辑工具栏">${mobileEditorTools.map(([id,name])=>`<button type="button" data-m6-edit="${id}" aria-label="${name}" title="${name}">${editorIcon(id)}</button>`).join('')}</nav>`;}
function mobileV6Sheet(){
 if(sheet==='account')return `<h3>账户设置</h3><p class="hint">登录神思账号后核验算力与 VIP 权益。此设计预览不收集账号密码，真实登录将通过双端安装版接入原账户服务。</p><div class="m6-account-avatar">神</div><h3>未登录</h3><button class="primary wide" data-m3="account-login">登录神思账号</button><div class="m3-group">${row('member-models','会员模型','未登录')}${row('compute-unavailable','购买算力套餐','暂未开放')}${row('vip-unavailable','VIP 会员服务','暂未开放')}</div>`;
 if(sheet==='account-login')return `<h3>登录神思账号</h3><p>预览不保存密码、不模拟登录成功。</p><p class="hint">双端正式入口需绑定原账号服务、系统安全凭据库与登录状态核验；此页仅查看布局。</p><button class="wide" data-m3="account">返回账户设置</button>`;
 if(['cloud-unavailable','compute-unavailable','vip-unavailable'].includes(sheet))return `<h3>${sheet==='cloud-unavailable'?'云端同步':sheet==='vip-unavailable'?'VIP 会员服务':'算力套餐'}</h3><p>暂无</p><p class="hint">${sheet==='cloud-unavailable'?'官方云端存储尚未开放，现阶段不上传个人资料。':'购买入口尚未开放；不会创建订单或扣款。'}</p>`;
 if(sheet==='history-settings')return `<h3>历史版本设置</h3><label>保存时间<select data-m6-retention>${[7,30,90,180,365,0].map(n=>`<option value="${n}" ${s.historyDays===n?'selected':''}>${n?n+' 天':'永久保留'}</option>`).join('')}</select></label><p class="hint">仅清理超期版本，保留最新版本；无法确认日期的旧版本不会被误删。正式版沿用桌面历史规则。</p>${row('history','查看当前文档历史')}`;
 if(sheet==='purge-confirm')return `<h3>${purgeTarget==='all'?'清空回收站？':'彻底删除？'}</h3><p>${purgeTarget==='all'?'回收站中的全部文件、子目录及历史':h(recycleFind(purgeTarget)?.name||'此项')+'及其子项'}将永久移除，无法从回收站恢复。</p><div class="m6-dialog-actions"><button data-m3="recycle">取消</button><button class="m6-danger" data-m3="purge-confirmed">确认彻底删除</button></div>`;
 if(sheet==='api-settings')return `<h3>模型配置</h3><p class="hint">自定义 API 在这里统一管理；对话内只切换配置、模型及参数。预览只保存名称和参数，不接收密钥。</p><div class="m3-group">${s.apiProfiles.map(p=>row('api-edit:'+p.id,p.name,p.model)).join('')||'<p>尚未添加自定义 API</p>'}</div><button class="primary wide" data-m3="api-add">添加 API 配置</button>`;
 if(sheet==='api-edit'){const p=s.apiProfiles.find(p=>p.id===apiEditing)||{};return `<h3>${p.id?'编辑':'添加'} API 配置</h3><label>配置名称<input data-m6-api-name maxlength="80" value="${h(p.name||'')}" placeholder="我的 API"></label><label>API 地址<input data-m6-api-url type="url" value="${h(p.baseUrl||'')}" placeholder="https://…/v1"></label><label>模型名称<input data-m6-api-model maxlength="120" value="${h(p.model||'')}" placeholder="模型标识"></label><p class="hint">连接参数界面示意。这里不填写真实密钥；安装版使用系统安全凭据库，不把密钥写入浏览器缓存。</p><button class="primary wide" data-m3="api-save">保存预览配置</button>`;}
 if(sheet==='toolbar')return `<h3>文本编辑工具栏</h3><p>进入编辑模式后显示在正文标题上方，可插入标题、粗体、斜体、列表、待办、引用、链接和代码。</p>`;
 return null;
}
function mobileV7Sheet(){
 if(sheet==='language-menu')return `<div class="m7-action-sheet"><h3>界面语言</h3>${['简体中文','English'].map(v=>menuRow('language:'+v,v,'language','',`aria-pressed="${s.language===v}"`)).join('')}</div>`;
 if(sheet==='appearance-menu')return `<div class="m7-action-sheet"><h3>外观</h3>${[['浅色','sun'],['深色','moon'],['跟随系统','monitor']].map(([v,k])=>menuRow('appearance:'+v,v,k,'',`aria-pressed="${s.appearance===v}"`)).join('')}</div>`;
 if(sheet==='core-plugins')return `<div class="m7-action-sheet"><h3>核心插件</h3>${menuRow('plugin:chat','文档对话','chat','已启用')}${menuRow('plugin:outline','文档大纲','outline','已启用')}${menuRow('toolbar','文本编辑工具栏','edit','已启用')}</div>`;
 if(sheet==='extensions')return `<div class="m7-action-sheet"><h3>扩展插件</h3>${s.installed.map(id=>menuRow('plugin:'+id,pluginName(id),id==='nutstore'?'cloud':id==='reader'?'headphones':'clock',id==='nutstore'?'自带':'已安装')).join('')}<section class="m7-plugin-section">${menuRow('market','插件广场','blocks','手机兼容')}</section></div>`;
 if(sheet==='nutstore')return `<div class="m7-action-sheet"><h3>坚果云同步</h3>${nutstoreMenu()}</div>`;
 if(sheet==='sync-auto')return `<div class="m7-action-sheet"><h3>自动同步</h3><p>待安全核验</p><p class="hint">正式版仅在条件写入、覆盖保护、冲突与原子提交验证通过后开启自动同步。</p><label class="m7-disabled-switch"><span>自动同步</span><input type="checkbox" disabled aria-label="自动同步尚未接通"></label></div>`;
 if(sheet==='sync-info')return `<div class="m7-action-sheet"><h3>连接状态</h3><p>${syncExampleConnected?'已连接 · 示例状态':'未连接 · 示例状态'}</p><p class="hint">仅预览，不连接真实坚果云。</p>${menuRow('sync-demo','演示连通性检查','refresh')}</div>`;
 if(sheet==='member-models')return `<div class="m7-action-sheet"><h3>会员模型</h3><p class="hint">会员模型在账户设置中管理；登录后由官方套餐返回可用模型和权益。当前未接通，仅展示目录样式。</p>${officialModels.map(m=>`<div class="m7-member-model">${icon('sparkles')}<div><b>${h(m.name)}</b><small>${h(m.id)}</small></div><small>演示</small></div>`).join('')}${menuRow('account-login','登录神思账号','user')}</div>`;
 return null;
}
async function mobileV7Click(e){
 const b=e.target.closest('[data-m3]'),a=b?.dataset.m3;if(!a)return false;
 if(a.startsWith('language:')||a.startsWith('appearance:')){saveEditor();const [key,value]=a.split(':');s[key]=value;save();rerender();return true;}
 if(a==='new-doc'||a==='new-board'){
  saveEditor();const board=a==='new-board',d={id:crypto.randomUUID(),notebook:s.notebook,name:board?'未命名白板':'未命名文档',folder:'文档',type:board?'album':'text',text:board?'':'在这里开始写作。',versions:[]};
  s.documents.push(d);s.active=d.id;s.tabs.push(d.id);reading=board;screen='write';panel=sheet='';filter='all';save();rerender();return true;
 }
 if(a==='plugin:nutstore'&&['document','extensions'].includes(sheet)){saveEditor();if(!opened.includes('nutstore'))opened.push('nutstore');openSheet('nutstore');return true;}
 if(a==='sync-signout'){syncExampleConnected=!syncExampleConnected;message=syncExampleConnected?'已恢复连接状态示例；未登录真实账号。':'已退出示例状态；未操作真实账号。';rerender();return true;}
 if(a==='sync-demo'){message='合成连通性检查完成；未连接真实坚果云。';notify(message);rerender();return true;}
 return false;
}
function editMarkup(command){editRichText(host.querySelector('[data-m3-editor][contenteditable=true]'),command);}
async function mobileV6Click(e){
 const edit=e.target.closest('[data-m6-edit]');if(edit){e.preventDefault();editMarkup(edit.dataset.m6Edit);return true;}
 const a=e.target.closest('[data-m3]')?.dataset.m3;if(!a)return false;
 saveEditor();
 if(a==='delete-version'){const d=doc(),v=d?.versions[selectedHistory];if(!v)return true;versionTarget={documentId:d.id,version:v};sheet='delete-version-confirm';rerender();return true;}
 if(a==='version-cancel'){versionTarget=null;sheet='version';rerender();return true;}
 if(a==='delete-version-confirmed'){const d=doc(),index=d?.id===versionTarget?.documentId?d.versions.indexOf(versionTarget.version):-1;if(index<0){notify('历史记录已变化，请重新选择。');}else{d.versions.splice(index,1);save();notify('已删除所选历史版本，当前正文未变。');}versionTarget=null;sheet='history';rerender();return true;}
 if(a==='favorites'){favoritesOnly=!favoritesOnly;rerender();return true;}
 if(a==='favorite'){const d=doc();if(d){const list=s.favorites[s.notebook]??=[];s.favorites[s.notebook]=list.includes(d.id)?list.filter(id=>id!==d.id):[...list,d.id];save();rerender();}return true;}
 if(a==='purge-all'||a.startsWith('purge:')){purgeTarget=a==='purge-all'?'all':a.slice(6);sheet='purge-confirm';rerender();return true;}
 if(a==='purge-confirmed'){
  const remove=items=>items.filter(d=>d.id!==purgeTarget).map(d=>d.children?{...d,children:remove(d.children)}:d);
  s.documents=purgeTarget==='all'?s.documents.filter(d=>!d.deleted):s.documents.map(d=>d.deleted&&d.children?{...d,children:remove(d.children)}:d).filter(d=>!d.deleted||d.id!==purgeTarget);
  save();sheet='recycle';rerender();notify('已永久删除所选预览资料，无法从回收站恢复。');return true;
 }
 if(a==='api-add'||a.startsWith('api-edit:')){apiEditing=a==='api-add'?'':a.slice(9);sheet='api-edit';rerender();return true;}
 if(a==='api-save'){
  const value=key=>host.querySelector('[data-m6-api-'+key+']').value.trim(),name=value('name'),baseUrl=value('url'),modelId=value('model');
  try{const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!name||!modelId)throw Error();}catch{notify('请填写名称、模型和无凭据的 HTTPS API 地址。');return true;}
  const existing=s.apiProfiles.find(p=>p.id===apiEditing);const record={id:apiEditing||crypto.randomUUID(),name,baseUrl,model:modelId,efforts:existing?.model===modelId?existing.efforts||[]:[],speeds:existing?.model===modelId?existing.speeds||[]:[]};s.apiProfiles=s.apiProfiles.filter(p=>p.id!==record.id);s.apiProfiles.push(record);save();sheet='api-settings';rerender();return true;
 }
 return false;
}
function mobileV6Change(e){const t=e.target;
 if(t.matches('[data-m6-retention]')){s.historyDays=Number(t.value);save();notify('已保存预览历史保留时间');return true;}
 if(t.matches('[data-m6-profile]')){const p=s.apiProfiles.find(p=>p.id===t.value);s.modelChoice={profileId:p?.id||'',model:p?.model||officialModels[0].id,effort:p?'':'medium',speed:'default',source:p?'自定义 API':'官方算力套餐'};normalizeChatModelChoice();model=s.modelChoice.source;save();rerender();return true;}
 if(t.matches('[data-m6-model]')){s.modelChoice.model=t.value;normalizeChatModelChoice();save();rerender();return true;}
 if(t.matches('[data-m6-effort],[data-m6-speed]')){s.modelChoice[t.matches('[data-m6-effort]')?'effort':'speed']=t.value;normalizeChatModelChoice();save();return true;}
 return false;
}
Object.assign(mobileEnglish,{'神思 AI':'Shensi AI','神思 AI · 官方算力套餐（演示）':'Shensi AI · Official credits (demo)','具体模型':'Specific model','思考速度':'Reasoning speed','账户设置':'Account settings','云端同步':'Cloud sync','暂无':'Unavailable','收藏':'Favorites','收藏文档':'Favorite document','显示全部文档':'Show all documents','取消收藏':'Remove favorite','一键清空':'Empty bin','彻底删除文件夹':'Delete folder permanently','清空回收站？':'Empty recycle bin?','彻底删除？':'Delete permanently?','确认彻底删除':'Delete permanently','取消':'Cancel','历史版本设置':'History settings','保存时间':'Retention','永久保留':'Keep forever','查看当前文档历史':'Current document history','配置':'Configuration','模型':'Model','速度':'Speed','快速':'Fast','默认':'Default','添加 API 配置':'Add API configuration','配置名称':'Configuration name','尚未添加自定义 API':'No custom API configured','保存预览配置':'Save preview configuration','未登录':'Signed out','登录神思账号':'Sign in to Shensi','购买算力套餐':'Buy compute credits','VIP 会员服务':'VIP membership','暂未开放':'Coming later','返回账户设置':'Account settings'});
Object.assign(mobileEnglish,{
 '文档对话配置':'Document chat configuration','官方算力套餐（演示）':'Official compute plan (demo)','编辑 API 配置':'Edit API configuration','API 地址':'API endpoint','我的 API':'My API','模型标识':'Model ID',
 '撤销':'Undo','重做':'Redo','加粗':'Bold','斜体':'Italic','删除线':'Strikethrough','列表':'List','待办':'Task list','引用':'Quote','链接':'Link','代码':'Code',
 '仅清理超期版本，保留最新版本；无法确认日期的旧版本不会被误删。正式版沿用桌面历史规则。':'Only expired versions are removed. The latest version and versions with unknown dates are kept. The installed app will follow desktop history rules.',
 '此处只选择配置与模型。API 连接在设置中管理；预览配置不发送真实请求，正式模型及参数需由供应目录返回。':'Choose the configuration and model here. Manage API connections in Settings. This preview sends no requests; real models and parameters must come from the provider catalog.',
 '登录神思账号后核验算力与 VIP 权益。此设计预览不收集账号密码，真实登录将通过双端安装版接入原账户服务。':'Sign in to verify compute and VIP benefits. This preview collects no credentials. Android and iOS apps will connect to the existing account service.',
 '预览不保存密码、不模拟登录成功。':'This preview neither stores passwords nor simulates a successful sign-in.',
 '双端正式入口需绑定原账号服务、系统安全凭据库与登录状态核验；此页仅查看布局。':'The installed apps require the existing account service, system secure storage and verified session state. This page only previews the layout.',
 '官方云端存储尚未开放，现阶段不上传个人资料。':'Official cloud storage is not available. No personal notes will be uploaded.',
 '购买入口尚未开放；不会创建订单或扣款。':'Purchases are not available. No order or charge will be created.',
 '自定义 API 在这里统一管理；对话内只切换配置、模型及参数。预览只保存名称和参数，不接收密钥。':'Manage custom APIs here; chat only selects configurations, models and parameters. This preview stores metadata, never API keys.',
 '连接参数界面示意。这里不填写真实密钥；安装版使用系统安全凭据库，不把密钥写入浏览器缓存。':'Connection layout preview. Do not enter real keys. Installed apps must use system secure storage instead of browser caches.',
 '进入编辑模式后显示在正文标题上方，可插入标题、粗体、斜体、列表、待办、引用、链接和代码。':'Shown above the document title while editing, with headings, bold, italic, lists, tasks, quotes, links and code.',
 '预览数据真实持久保存，可刷新后恢复；不操作你的正式资料。':'Preview data persists across reloads. Your real notes are not affected.',
 '回收站为空':'Recycle bin is empty','回收站中的全部文件、子目录及历史将永久移除，无法从回收站恢复。':'All files, subfolders and histories in the recycle bin will be permanently removed and cannot be restored.'
});
Object.assign(mobileEnglish,{'文档锁定':'Document lock','上传素材':'Upload media','下载素材':'Download asset','关闭预览':'Close preview','查看执行记录':'Execution record','演示文档写入':'Try a sample write','神思AI · 具体模型':'Shensi AI · Model','轻量':'Light','深入':'Deep','最高':'Maximum','同步白板 · 素材相册':'Synced board · Media gallery','神思 · 均衡模型（演示）':'Shensi · Balanced (demo)','神思 · 深度推理（演示）':'Shensi · Deep reasoning (demo)','此处是可交互的模型选择示意。正式列表与思考档位必须由官方套餐返回，不能将演示模型用于真实请求。':'Interactive model picker preview. Real models and reasoning levels must come from the official plan. Demo choices cannot be used for real requests.','点击卡片全屏查看；文本可修改，图片、视频和音频可上传。预览上传只保存在此浏览器，尚未同步到电脑。':'Tap a card for fullscreen. Edit text or upload media. Preview uploads stay in this browser and are not synced to desktop.','文本卡片正文':'Text card content','独立预览资料':'Isolated preview data','已保存本机 · 待接入同步':'Saved locally · Sync not connected','正在准备播放…':'Preparing playback…'});
Object.assign(mobileEnglish,{
 '阅读与保存':'Reading & storage','插件与连接':'Plugins & connections','登录账户与管理服务':'Sign-in & services','仅样式演示，不改变正式设置':'Design preview; production settings are unchanged.',
 '可用插件':'Available plugins','双向链接与属性':'Backlinks & properties','文档属性与历史':'Document properties & history','打开文档对话':'Open document chat','打开大纲':'Open outline','打开坚果云同步':'Open Nutstore sync','打开文档朗读':'Open text reader','打开专注时钟':'Open focus timer',
 '创建新文档':'Create document','新建白板':'Create whiteboard','关闭当前签页':'Close current tab','未命名白板':'Untitled whiteboard','选择模型配置':'Choose model configuration','选择思考强度和速度':'Choose reasoning effort and speed','发送预览消息':'Send preview message',
 '把这一章出现的线索整理到世界设定里，保留原文。':'Collect this chapter’s clues in the world notes. Keep the original text.','神思 AI · 示例回复':'Shensi AI · Sample response','已归纳出三条线索：霜羽铭文、守灯人，以及北方的故乡。':'Three clues: the frost-feather inscription, the lamplighter and the northern homeland.','原文保留，整理结果写入「世界设定 / 线索」，并创建历史版本。':'Keep the original and write to World notes / Clues, preserving version history.','查看本轮执行记录':'View this turn’s execution log','继续聊聊这一章…':'Continue discussing this chapter…',
 '已连接 · 示例状态':'Connected · Example state','未连接 · 示例状态':'Disconnected · Example state','立即同步':'Sync now','退出登录':'Sign out','连接账号':'Connect account','连接状态':'Connection status','仅预览，不连接真实坚果云。':'Preview only; no real Nutstore connection.','自动同步尚未接通':'Automatic sync is not connected',
 '已恢复连接状态示例；未登录真实账号。':'Example connection restored. No real account sign-in.','已退出示例状态；未操作真实账号。':'Example signed out. Real accounts are unchanged.','会员模型':'Member models','演示':'Demo',
 '会员模型在账户设置中管理；登录后由官方套餐返回可用模型和权益。当前未接通，仅展示目录样式。':'Manage member models under Account settings. Official plans supply models and entitlements after sign-in. Not connected; catalog preview only.'
});
Object.assign(mobileEnglish,{
 '选择配置':'Choose configuration','模型与参数':'Model & parameters','选择具体模型和参数':'Choose model and parameters',
 'API 连接在设置中管理；这里只切换已有配置。':'Manage API connections in Settings. Select an existing configuration here.',
 '只显示当前模型支持的选项；演示模型不会发送真实请求。':'Only supported options are shown. Demo models do not send requests.',
 '删除此版本':'Delete this version','删除此历史版本？':'Delete this history version?',
 '只删除选中的历史记录，不修改当前正文。删除后无法恢复。':'Only the selected history entry is deleted. The current document is unchanged. This cannot be undone.',
 '确认删除此版本':'Delete this version','恢复此版本（先保留当前版）':'Restore (keep current version first)',
 '历史内容':'Version content','历史记录已变化，请重新选择。':'History changed. Select the version again.',
 '已删除所选历史版本，当前正文未变。':'Selected version deleted. Current document unchanged.'
});
