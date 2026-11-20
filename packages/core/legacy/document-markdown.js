import {Marked} from './vendor/marked.js';
import {sanitizeDocumentHtml, safeDocumentLink, safeDocumentAttachmentPath} from './document-sanitize.js';
import {markdownTableToHtml, parseMarkdownTable} from './markdown-table.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unescape=value=>String(value??'').replace(/&(?:amp|quot|apos|lt|gt|#39);/g,c=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'}[c]));
const preserved=(source,label=source)=>`<span data-markdown-source="${escape(source)}" contenteditable="false">${escape(label)}</span>`;
function media(token,mobile){
 let path=unescape(token.href);if(safeDocumentAttachmentPath(path))try{path=decodeURIComponent(path);}catch{}
 const label=unescape(token.text)||path,ext=path.split('.').pop().toLowerCase();
 const tag=['png','jpg','jpeg','webp','gif','avif','bmp','svg'].includes(ext)?'img':['mp4','m4v','mov','webm','ogv'].includes(ext)?'video':['mp3','wav','m4a','ogg','flac','aac','opus'].includes(ext)?'audio':'';
 // No arbitrary src is trusted. External/unsupported embeds remain visible,
 // lossless Markdown until imported through the managed attachment boundary.
 if(!tag||!safeDocumentAttachmentPath(path))return preserved(token.raw);
 const html=tag==='img'?`<img data-attachment-path="${escape(path)}" alt="${escape(label)}"${token.title?` title="${escape(unescape(token.title))}"`:''} loading="lazy">`:`<${tag} data-attachment-path="${escape(path)}" aria-label="${escape(label)}" controls preload="metadata"${tag==='video'?' playsinline':''}></${tag}>`;
 return mobile?`<span data-mobile-media="${escape(path)}" data-media-source="${escape(token.raw)}" contenteditable="false">${html}</span>`:html;
}
function createParser(mobile){
 const parser=new Marked({gfm:true,breaks:true,async:false});
 const tableStart=/^(?:<!--[ \t]*shensi-table-layout:[^\n]*\n)?[^\n]*\|[^\n]*\n[ \t:|\-]*\|[ \t:|\-]*(?:\n|$)/gm;
 const tableHeader=new RegExp(tableStart.source,'y');
 parser.use({renderer:{
  // Formatting whitespace between block tags becomes real textContent and
  // changes rich-editor selection offsets. Emit compact block markup; only
  // user-authored line breaks (including code) belong in the editable text.
  heading(token){return `<h${token.depth}>${this.parser.parseInline(token.tokens)}</h${token.depth}>`;},
  paragraph(token){return `<p>${this.parser.parseInline(token.tokens)}</p>`;},
  blockquote(token){return `<blockquote>${this.parser.parse(token.tokens)}</blockquote>`;},
  list(token){const tag=token.ordered?'ol':'ul';return `<${tag}${token.ordered&&token.start!==1?` start="${token.start}"`:''}>${token.items.map(item=>this.listitem(item)).join('')}</${tag}>`;},
  listitem(token){return `<li>${this.parser.parse(token.tokens)}</li>`;},
  hr:()=>'<hr>',
  // Raw HTML is text, except a line break emitted by our table serializer.
  html:token=>/^<br\s*\/?\s*>$/i.test(token.text)?'<br>':escape(token.text),
  link(token){let href=unescape(token.href);if(safeDocumentAttachmentPath(href))try{href=decodeURIComponent(href);}catch{}return safeDocumentLink(href)?`<a href="${escape(href)}"${token.title?` title="${escape(unescape(token.title))}"`:''}>${this.parser.parseInline(token.tokens)}</a>`:preserved(token.raw);},
  image:token=>media(token,mobile),
  checkbox:token=>token.checked?'☑ ':'☐ ',
  del(token){return `<s>${this.parser.parseInline(token.tokens)}</s>`;},
  code:token=>`<pre><code${token.lang?` data-language="${escape(token.lang)}"`:''}>${escape(token.text)}</code></pre>`,
 },extensions:[{
  name:'shensiWiki',level:'inline',start:source=>source.search(/!?\[\[/),
  tokenizer(source){const m=/^(!?)\[\[([^\]\n]+)\]\]/.exec(source);if(!m)return;const [href,...labels]=m[2].split('|');return {type:'shensiWiki',raw:m[0],embed:!!m[1],href:href.trim(),text:labels.join('|')||href};},
  renderer:token=>token.embed?media(token,mobile):preserved(token.raw,token.text),
 },{
  // Preserve the existing table column/row metadata and Obsidian pipe rules.
  name:'shensiTable',level:'block',start:source=>{
   if(!source.includes('|'))return;
   for(const candidate of source.matchAll(tableStart))if(parseMarkdownTable(candidate[0]))return candidate.index;
  },
  tokenizer(source){
   // Only inspect a possible header here; splitting the remaining document at
   // every block makes long non-table documents quadratic in allocations.
   tableHeader.lastIndex=0;const header=tableHeader.exec(source)?.[0];
   if(!header||!parseMarkdownTable(header))return;
   let end=header.length;
   while(end<source.length){
    const newline=source.indexOf('\n',end),line=source.slice(end,newline<0?source.length:newline);
    if(!line.trim()||!line.includes('|')||/^\s*(?:#{1,6}\s|>|```|~~~)/.test(line))break;
    end=newline<0?source.length:newline+1;
   }
   const raw=source.slice(0,end);return {type:'shensiTable',raw,text:raw};
  },
  renderer:token=>markdownTableToHtml(token.text,{renderInline:value=>parser.parseInline(value)}),
 }]});
 return parser;
}
const desktop=createParser(false),phone=createParser(true);
export const renderDocumentMarkdown=(source,{mobile=false}={})=>sanitizeDocumentHtml((mobile?phone:desktop).parse(String(source??'')));
export const renderDocumentMarkdownInline=source=>sanitizeDocumentHtml(desktop.parseInline(String(source??'')));

// Reuse the editor grammar for transfers: regex-only scans miss reference-style
// images and wiki embeds, and incorrectly treat code examples as dependencies.
export function documentMarkdownReferences(source){
 const lexer=new desktop.Lexer(desktop.defaults),tokens=lexer.lex(String(source??'')),references=[],html=[];
 const visit=token=>{
  if(['image','link','shensiWiki'].includes(token.type))references.push({href:token.href,embed:token.type==='image'||!!token.embed,wiki:token.type==='shensiWiki'});
  if(token.type==='html')html.push(token.text);
  if(token.type==='shensiTable'){
   const table=parseMarkdownTable(token.text);
   for(const cell of [...table.headers,...table.rows.flat()])desktop.walkTokens(lexer.inlineTokens(cell),visit);
  }
 };
 desktop.walkTokens(tokens,visit);
 // Inline HTML arrives as separate opening/child/closing tokens. Inspect it
 // together so code examples do not become required attachment dependencies.
 if(html.length)references.push({html:html.join('')});
 return references;
}
