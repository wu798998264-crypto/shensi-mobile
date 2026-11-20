import {markdownTableRowsToMarkdown} from './markdown-table.js';

const text=value=>String(value??'').replace(/[\\`*_[\]~<>]/g,'\\$&').replace(/(^|\n)( {0,3})(?=#{1,6}\s|[-+]\s|\d+[.)]\s)/g,'$1$2\\');
const destination=value=>String(value??'').replace(/[<>\s\\]/g,c=>encodeURIComponent(c));
const tickRun=value=>Math.max(0,...(String(value).match(/`+/g)||[]).map(s=>s.length));
export function documentDomToMarkdown(root){
 const literal=[];
 const hold=value=>`\u0000shensi-code-${literal.push(value)-1}\u0000`;
 const clean=value=>value.replace(/\n{3,}/g,'\n\n').trim();
 const walk=node=>{
  if(node.nodeType===3)return text(node.nodeValue);
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  if(node.nodeType===11)return [...node.childNodes].map(walk).join('');
  const tag=node.tagName,inside=()=>[...node.childNodes].map(walk).join('');
  if(['SCRIPT','STYLE','IFRAME','OBJECT'].includes(tag))return '';
  if(node.hasAttribute('data-mobile-media'))return node.getAttribute('data-media-source')||'';
  if(node.hasAttribute('data-markdown-source'))return node.getAttribute('data-markdown-source');
  if(tag==='BR')return '\n';
  if(tag==='IMG')return `![${text(node.getAttribute('alt'))}](<${destination(node.dataset.attachmentPath||node.getAttribute('src'))}>${node.title?' "'+node.title.replace(/["\\]/g,'\\$&')+'"':''})`;
  if(['VIDEO','AUDIO'].includes(tag))return `![[${node.dataset.attachmentPath||node.getAttribute('src')||''}]]`;
  const wrap=marker=>{const value=inside();return value.trim()?value.replace(/^(\s*)([\s\S]*?)(\s*)$/,(_,a,b,c)=>a+marker+b+marker+c):value;};
  if(tag==='STRONG'||tag==='B')return wrap('**');if(tag==='EM'||tag==='I')return wrap('*');if(['S','DEL','STRIKE'].includes(tag))return wrap('~~');
  if(tag==='A')return node.hasAttribute('href')?`[${inside()}](<${destination(node.getAttribute('href'))}>${node.title?' "'+node.title.replace(/["\\]/g,'\\$&')+'"':''})`:inside();
  if(tag==='PRE'){
   const body=node.textContent,marker='`'.repeat(Math.max(3,tickRun(body)+1)),language=node.querySelector('code')?.dataset.language||'';
   return '\n\n'+hold(marker+language+'\n'+body+(body.endsWith('\n')?'':'\n')+marker)+'\n\n';
  }
  if(tag==='CODE'){const body=node.textContent,marker='`'.repeat(tickRun(body)+1),pad=/^`|`$|^ .* $/.test(body)?' ':'';return hold(marker+pad+body+pad+marker);}
  if(/^H[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+inside().trim()+'\n\n';
  if(tag==='BLOCKQUOTE')return '\n\n'+clean(inside()).split('\n').map(line=>'> '+line).join('\n')+'\n\n';
  if(tag==='UL'||tag==='OL'){
   const start=Number(node.getAttribute('start')||1);
   return '\n\n'+[...node.children].filter(li=>li.tagName==='LI').map((li,index)=>{
    let body=clean([...li.childNodes].map(walk).join(''));
    const task=li.dataset.task??(/^[☐☑]\s/.test(body)?String(body.startsWith('☑')):null);
    if(task!==null)body=(task==='true'?'[x] ':'[ ] ')+body.replace(/^[☐☑]\s*/,'');
    const marker=tag==='OL'?`${start+index}. `:'- ';
    return marker+body.split('\n').join('\n'+' '.repeat(Math.max(4,marker.length)));
   }).join('\n')+'\n\n';
  }
  if(tag==='TABLE'){
   const rows=[...node.rows].map(row=>[...row.cells].map(cell=>clean([...cell.childNodes].map(walk).join(''))));
   return '\n\n'+markdownTableRowsToMarkdown(rows,[...(node.rows[0]?.cells||[])].map(cell=>cell.dataset.align),{
    columnWidths:[...node.querySelectorAll('col')].map(col=>Number(col.dataset.columnWidth)||null),rowHeights:[...node.rows].map(row=>Number(row.dataset.rowHeight)||null),
   })+'\n\n';
  }
  if(tag==='HR')return '\n\n---\n\n';
  if(tag==='SPAN'){if(/^(bold|[6-9]00)$/.test(node.style.fontWeight))return wrap('**');if(node.style.fontStyle==='italic')return wrap('*');if(node.style.textDecorationLine.includes('line-through'))return wrap('~~');}
  return inside()+(['P','DIV','FIGURE','SECTION'].includes(tag)?'\n\n':'');
 };
 return clean([...root.childNodes].map(walk).join('')).replace(/\u0000shensi-code-(\d+)\u0000/g,(_,i)=>literal[Number(i)]);
}
