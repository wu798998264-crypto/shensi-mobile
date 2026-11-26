import {frameLatest,boardGestureView} from './board-interaction.js';

// Original card-docked / centered workbench placement, in viewport pixels.
export function generationPlacement({editor,card,dialog,viewport,expanded=false}){
 const margin=10,gap=10,minLeft=margin,maxLeft=Math.max(margin,viewport.width-dialog.width-margin);
 const visibleWidth=Math.min(viewport.width-margin,editor.right)-Math.max(margin,editor.left);
 const tooWide=dialog.width>Math.max(0,visibleWidth-10);
 const leftMin=tooWide?minLeft:Math.max(minLeft,editor.left+margin);
 const leftMax=tooWide?maxLeft:Math.max(leftMin,Math.min(maxLeft,editor.right-dialog.width-margin));
 const preferred=tooWide?(viewport.width-dialog.width)/2:expanded?editor.left+(editor.width-dialog.width)/2:card.left+(card.width-dialog.width)/2;
 const minTop=Math.max(margin,editor.top+margin),bottom=Math.min(viewport.height,editor.bottom??editor.top+editor.height)-margin;
 const height=Math.min(Math.max(190,dialog.height),Math.max(96,bottom-minTop)),below=card.bottom+gap;
 const top=expanded?Math.max(margin,editor.top+Math.max(12,(editor.height-Math.min(dialog.height,editor.height-24))/2))
  :below+190<=bottom?Math.max(minTop,below):Math.max(minTop,Math.min(bottom-height,(card.top??card.bottom)-gap-height));
 return {left:Math.max(leftMin,Math.min(leftMax,preferred)),top,maxHeight:expanded?Math.max(160,Math.min(viewport.height-20,editor.height-24)):Math.max(96,viewport.height-top-margin)};
}

export function mountGenerationLayout(form,{context,doc,node,scope}){
 let frame=0,disposed=false;
 const board=()=>document.querySelector('.board');
 const active=()=>form.isConnected&&context.libraryId()===scope.id&&context.current()?.id===scope.documentId;
 const card=()=>document.querySelector('[data-node="'+CSS.escape(node.id)+'"]');
 function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();removed.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('shensi:board-layout',schedule);}
 function position(){frame=0;if(!form.isConnected){dispose();return;}const cardElement=card(),boardElement=board();if(!active()||!cardElement||!boardElement){form.remove();dispose();return;}
  const expanded=form.classList.contains('generation-expanded'),placement=generationPlacement({editor:boardElement.getBoundingClientRect(),card:cardElement.getBoundingClientRect(),dialog:form.getBoundingClientRect(),viewport:{width:innerWidth,height:innerHeight},expanded});
  form.classList.toggle('generation-constrained',!expanded&&placement.maxHeight<300);
  form.classList.toggle('generation-minimal',!expanded&&placement.maxHeight<190);
  for(const [name,value] of Object.entries(placement)){const next=value+'px';if(form.style[name]!==next)form.style[name]=next;}
 }
 function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(position);}
 const resize=new ResizeObserver(schedule);resize.observe(form);if(board())resize.observe(board());
 const changes=new MutationObserver(records=>{if(records.some(record=>record.type==='childList'&&[...record.addedNodes,...record.removedNodes].some(el=>el.nodeType===1&&(el.matches?.('[data-node],.board-world')||el.querySelector?.('[data-node]')))))schedule();});if(board())changes.observe(board(),{subtree:true,childList:true});
 const removed=new MutationObserver(()=>{if(!form.isConnected)dispose();});removed.observe(form.parentElement,{childList:true});
 window.addEventListener('resize',schedule);document.addEventListener('shensi:board-layout',schedule);
 const header=form.querySelector('header');
 header.onpointerdown=event=>{
  if(event.button!==0||event.target.closest('button,input,select,label')||form.classList.contains('generation-expanded')||!active())return;
  const canvas=context.current()?.canvas,liveNode=canvas?.nodes.find(n=>n.id===node.id);if(!liveNode)return;
  event.preventDefault();const start={x:event.clientX,y:event.clientY,nodeX:liveNode.x,nodeY:liveNode.y},zoom=canvas.viewport.zoom;let moved=false;
  header.setPointerCapture(event.pointerId);
  const view=boardGestureView(board(),canvas,new Set([liveNode.id]));
  const movement=frameLatest(e=>{
   if(!active()||context.current()?.canvas!==canvas){finish();return;}const dx=(e.clientX-start.x)/zoom,dy=(e.clientY-start.y)/zoom;if(!moved&&Math.hypot(dx,dy)<3)return;
   if(!moved){context.recordBoardUndo?.();moved=true;}
   const snap=canvas.settings?.snapToGrid===false?1:canvas.settings?.gridSize||20;
   liveNode.x=Math.round((start.nodeX+dx)/snap)*snap;liveNode.y=Math.round((start.nodeY+dy)/snap)*snap;
   view.paint();
   schedule();
  });
  header.onpointermove=e=>movement.push({clientX:e.clientX,clientY:e.clientY});
  function finish(){movement.flush();view.finish();header.onpointermove=null;header.onpointerup=null;header.onpointercancel=null;if(header.hasPointerCapture(event.pointerId))header.releasePointerCapture(event.pointerId);if(moved&&active()&&context.current()?.canvas===canvas)context.markDirty();schedule();}
  header.onpointerup=header.onpointercancel=finish;
 };
 schedule();return {position:schedule,dispose};
}
