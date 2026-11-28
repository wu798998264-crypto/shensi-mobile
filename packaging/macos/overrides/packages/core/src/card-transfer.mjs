import {createHash} from 'node:crypto';
import {copySelection,pasteSelection} from '../../ui/canvas-model.js';
import {copyAssets,verifyAssets} from './document-move.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function selection(doc,ids){
 const canvas=doc?.canvas,set=new Set(ids);
 if(!canvas||!set.size||set.size!==ids.length||set.size>500)throw Error('请选择有效的白板卡片');
 const nodes=canvas.nodes.filter(n=>set.has(n.id));
 if(nodes.length!==ids.length)throw Error('原卡已变化，请重新复制或剪切');
 const edges=canvas.edges.filter(e=>set.has(e.fromNode)||set.has(e.toNode));
 const assets=(canvas.assets||[]).filter(a=>set.has(a.sourceNodeId));
 const trash=Object.fromEntries(assets.filter(a=>canvas.coreAssetTrash?.[a.id]).map(a=>[a.id,canvas.coreAssetTrash[a.id]]));
 const drafts=Object.fromEntries(nodes.map(n=>[n.id,canvas.coreGenerationDrafts?.[n.id]??doc.coreLegacyGenerationDrafts?.[n.id]]).filter(([,draft])=>draft));
 return {nodes,edges,assets,trash,drafts};
}
export const cardSelectionHash=(doc,ids)=>digest(selection(doc,ids));
export function createCardTransfer({exclusive,load,commit,options}){
 return body=>exclusive(async()=>{
  const {id,documentId,sourceId,sourceDocumentId,nodeIds,sourceHash,operationId,cut}=body;
  if(!Array.isArray(nodeIds)||!/^cards-[a-z0-9-]{30,80}$/i.test(operationId)||typeof cut!=='boolean'||(body.point&&(!Number.isFinite(body.point.x)||!Number.isFinite(body.point.y))))throw Error('卡片传输参数无效');
  const target=await load(id),source=id===sourceId?target:await load(sourceId);
  const dest=target.state.documents[documentId],from=source.state.documents[sourceDocumentId];
  if(!dest?.canvas||!from?.canvas)throw Error('目标或来源白板已不存在');
  const same=dest===from,across=id!==sourceId,set=new Set(nodeIds);
  const key=digest([sourceId,sourceDocumentId,nodeIds,sourceHash,cut,documentId]),prior=target.state.coreCardTransfers?.[operationId];
  if(prior&&prior.key!==key)throw Error('此粘贴操作已经用于不同卡片或目标');
  if(prior&&(!cut||!across||!from.canvas.nodes.some(n=>set.has(n.id))))return {nodeIds:prior.nodeIds};
  if(!prior&&body.expectedStateStamp!==target.stateStamp)throw Error('目标白板已变化，请重新粘贴');
  if([dest,from].some(d=>d.locked||d.coreLocked)||target.state.lockedDocuments?.includes(documentId)||source.state.lockedDocuments?.includes(sourceDocumentId))throw Error('请先解除文档锁定');
  const saved=selection(from,nodeIds);
  if(digest(saved)!==sourceHash)throw Error('复制后原卡或连线已变化，请重新复制或剪切。原卡已保留');
  const payload=copySelection(from.canvas,nodeIds,from);
  const removeSources=()=>{
   from.canvas.nodes=from.canvas.nodes.filter(n=>!set.has(n.id));
   from.canvas.edges=from.canvas.edges.filter(e=>!set.has(e.fromNode)&&!set.has(e.toNode));
   from.canvas.assets=(from.canvas.assets||[]).filter(a=>!set.has(a.sourceNodeId));
   for(const asset of saved.assets)if(from.canvas.coreAssetTrash)delete from.canvas.coreAssetTrash[asset.id];
   for(const n of saved.nodes){if(from.canvas.coreGenerationDrafts)delete from.canvas.coreGenerationDrafts[n.id];if(from.coreLegacyGenerationDrafts)delete from.coreLegacyGenerationDrafts[n.id];}
  };
  const copied=across?await copyAssets(options(sourceId).requestedPath,options(id).requestedPath,cut?saved:payload):[];
  let landed=prior?.nodeIds;
  if(!prior){
   if(same&&cut){landed=nodeIds;}
   else if(cut){
    if(dest.canvas.nodes.some(n=>set.has(n.id))||saved.assets.some(a=>dest.canvas.assets?.some(b=>b.id===a.id)))throw Error('目标白板有相同身份的卡片或历史，原卡已保留');
    const edges=saved.edges.filter(e=>set.has(e.fromNode)&&set.has(e.toNode));
    if(edges.some(e=>dest.canvas.edges.some(old=>old.id===e.id)))throw Error('目标已有同名连线，原卡已保留');
    dest.canvas.nodes.push(...structuredClone(saved.nodes));dest.canvas.edges.push(...structuredClone(edges));
    (dest.canvas.assets??=[]).push(...structuredClone(saved.assets));
    Object.assign(dest.canvas.coreAssetTrash??={},saved.trash);Object.assign(dest.canvas.coreGenerationDrafts??={},saved.drafts);
    landed=nodeIds;if(!across)removeSources();
   }else landed=pasteSelection(dest.canvas,payload);
   if(body.point||same&&cut){
    const landedIds=new Set(landed),nodes=dest.canvas.nodes.filter(n=>landedIds.has(n.id));
    const dx=body.point?body.point.x-Math.min(...nodes.map(n=>n.x)):40;
    const dy=body.point?body.point.y-Math.min(...nodes.map(n=>n.y)):40;
    for(const node of nodes){node.x+=dx;node.y+=dy;}
   }
   (target.state.coreCardTransfers??={})[operationId]={key,nodeIds:landed,signature:cardSelectionHash(dest,landed)};
   await commit(id,{state:target.state,expectedStateStamp:target.stateStamp});
  }
  if(cut&&across){
   const verified=await load(id),receipt=verified.state.coreCardTransfers?.[operationId];
   if(!receipt||receipt.signature!==cardSelectionHash(verified.state.documents[documentId],landed))throw Error('目标卡片回读不一致，原卡已保留');
   await verifyAssets(copied,options(sourceId).requestedPath,options(id).requestedPath);
   const previousDocument=structuredClone(from);
   removeSources();await commit(sourceId,{state:source.state,expectedStateStamp:source.stateStamp},{documentId:sourceDocumentId,source:'user',operationType:'move',reason:'跨笔记本移动卡片',previousDocument});
  }
  return {nodeIds:landed};
 });
}
