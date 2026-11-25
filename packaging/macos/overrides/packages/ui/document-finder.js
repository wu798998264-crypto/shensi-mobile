import {findTextMatches} from '/legacy/document-find-replace.js';

// Ranges paint over the editor without changing its saved HTML or undo stack.
export function createDocumentFinder(){
 let context={},scope='',query='',replacement='',ranges=[],matches=[],index=-1,observer,timer;
 const clear=()=>{CSS.highlights?.delete('shensi-find');CSS.highlights?.delete('shensi-find-current');};
 function collect(editor){
  const entries=[];let text='',lastBlock;
  const walk=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement.closest('script,style,[hidden],.inline-edit-suggestion')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let node;while(node=walk.nextNode()){
   const block=node.parentElement.closest('p,div,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th');
   if(entries.length&&block!==lastBlock)text+='\n';
   entries.push({node,start:text.length,end:text.length+node.length});text+=node.data;lastBlock=block;
  }
  return {text,entries};
 }
 function paint(){
  clear();if(ranges.length&&globalThis.Highlight){CSS.highlights.set('shensi-find',new Highlight(...ranges));if(index>=0)CSS.highlights.set('shensi-find-current',new Highlight(ranges[index]));}
  if(context.output)context.output.textContent=(matches.length?(index+1)+' / ':'')+matches.length+' 处';
  if(context.input)context.input.dataset.matchIndex=String(index);
 }
 function refresh(){
  if(!context.input)return;const next=context.input.value,changed=next!==query;query=next;replacement=context.replacement?.value||'';
  const {editor,source}=context,found=editor?collect(editor):{text:source?.value??context.boardText?.()??'',entries:[]};
  const before=matches[index]?.start,previous=index;matches=findTextMatches(found.text,query);ranges=[];
  for(const match of editor?matches:[]){
   const first=found.entries.find(e=>e.start<=match.start&&e.end>match.start),last=found.entries.find(e=>e.start<match.end&&e.end>=match.end);
   if(!first||!last)continue;const range=document.createRange();range.setStart(first.node,match.start-first.start);range.setEnd(last.node,match.end-last.start);ranges.push(range);
  }
  index=matches.length?(changed?0:before===undefined?Math.max(0,Math.min(previous,matches.length-1)):Math.max(0,matches.findIndex(m=>m.start===before))):-1;paint();
  if(changed&&editor&&ranges.length)reveal();
 }
 function reveal(){
  const {editor,source}=context,match=matches[index];if(!match)return false;
  if(source){
   source.focus({preventScroll:true});source.setSelectionRange(match.start,match.end);
   const mirror=document.createElement('div'),style=getComputedStyle(source);
   for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[key]=style[key];
   Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',width:source.clientWidth+'px',whiteSpace:'pre-wrap',visibility:'hidden'});
   mirror.append(document.createTextNode(source.value.slice(0,match.start)));const marker=document.createElement('span');marker.textContent=source.value.slice(match.start,match.end)||' ';mirror.append(marker);document.body.append(mirror);
   const y=marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top;mirror.remove();source.scrollTop=Math.max(0,y-source.clientHeight/2);source.scrollIntoView({block:'nearest',inline:'nearest'});
  }else if(editor&&ranges[index]){
   const rect=ranges[index].getBoundingClientRect(),scroll=editor.closest('.editor-scroll');
   if(scroll){const bounds=scroll.getBoundingClientRect();scroll.scrollTop+=rect.top-bounds.top-scroll.clientHeight/2+rect.height/2;}
  }
  return true;
 }
 return {
  bind(next){
   observer?.disconnect();clearTimeout(timer);clear();
   if(context.input?.isConnected){query=context.input.value;replacement=context.replacement?.value||'';}
   if(scope!==next.scope){scope=next.scope;query='';replacement='';index=-1;}
   context=next;ranges=[];matches=[];if(!next.input)return;
   next.input.value=query;if(next.replacement)next.replacement.value=replacement;
   next.input.oninput=refresh;next.input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();this.next(e.shiftKey?-1:1);}};if(next.replacement)next.replacement.oninput=()=>{replacement=next.replacement.value;};
   refresh();if(next.editor){observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(refresh,0);});observer.observe(next.editor,{subtree:true,childList:true,characterData:true});}
  },
  next(direction=1){refresh();if(!matches.length)return false;index=(index+(direction<0?-1:1)+matches.length)%matches.length;paint();return reveal();},
 };
}
