export const GENERATION_CHANNELS=['text','image','video','audio'];
const RATIOS=['21:9','16:9','3:2','4:3','1:1','3:4','2:3','9:16','9:21'];
export function mediaRatioPreset(node){const ratio=Number(node?.aspectRatio)||(['image','video'].includes(node?.kind)&&Number(node?.width)>0&&Number(node?.height)>0?node.width/node.height:0);return ratio>0?[...RATIOS].sort((a,b)=>Math.abs(Math.log(a.split(':').reduce((x,y)=>x/y)/ratio))-Math.abs(Math.log(b.split(':').reduce((x,y)=>x/y)/ratio)))[0]:'';}
export function rememberMediaRatio(canvas,node){if(['image','video','audio'].includes(node?.kind)){const ratio=mediaRatioPreset(node);if(ratio)canvas.coreLastClickedMediaAspectRatio=ratio;}}
export function inheritedMediaRatio(canvas,node,channel){if(!['image','video'].includes(channel))return '';const upstream=(canvas.edges||[]).filter(e=>e.toNode===node.id).map(e=>canvas.nodes.find(n=>n.id===e.fromNode)).find(n=>mediaRatioPreset(n));return mediaRatioPreset(upstream)||canvas.coreLastClickedMediaAspectRatio||canvas.coreLastMediaAspectRatio||'16:9';}
function imageAssetDraft(canvas,node){
 if(node?.kind!=='image'||!node.file)return;
 const records=(canvas?.assets||[]).filter(asset=>asset.sourceNodeId===node.id&&asset.kind==='image'&&asset.attachment?.relativePath===node.file&&typeof asset.prompt==='string'&&asset.prompt.trim()&&(asset.origin==='generated'||['image','native_image_gen'].includes(asset.sourceChannel))&&!canvas.coreAssetTrash?.[asset.id]);
 const record=records.find(asset=>asset.id===node.coreSelectedVersionId)
  ||records.find(asset=>node.coreMediaJobId&&asset.generationJobId===node.coreMediaJobId)
  ||(records.length===1?records[0]:undefined);
 if(!record)return;
 const nodes=canvas.nodes.filter(n=>n.id!==node.id),ids=new Set(nodes.map(n=>n.id));
 const order=Array.isArray(record.referenceOrder)?record.referenceOrder.map(ref=>typeof ref==='string'?ref:ref?.nodeId||ref?.id):[];
 // Only restore paths already represented by an unambiguous board attachment.
 if(!Array.isArray(record.referenceOrder)&&Array.isArray(record.sourceReferencePaths))for(const path of record.sourceReferencePaths){
  const matches=nodes.filter(n=>n.file&&n.file===path);
  if(matches.length===1)order.push(matches[0].id);
 }
 const references=[...new Set(order.filter(id=>ids.has(id)))];
 const incoming=canvas.edges.filter(edge=>edge.toNode===node.id);
 return {channel:'image',prompt:record.prompt,references,referenceEdgeIds:incoming.map(edge=>edge.id),referenceExcludedIds:[...new Set(incoming.map(edge=>edge.fromNode).filter(id=>!references.includes(id)))]};
}
export function generationStoredDraft(doc,node){
 const stored=doc?.canvas?.coreGenerationDrafts?.[node?.id]??doc?.coreLegacyGenerationDrafts?.[node?.id];
 if(stored&&(!stored.channel||stored.channel==='image'||stored.channels?.image))return stored;
 const image=imageAssetDraft(doc?.canvas,node);
 return stored?(image?{...stored,channels:{...stored.channels,image}}:stored):image??{};
}
export function generationIntent(canvas,node,legacyDraft){
 const draft=canvas?.coreGenerationDrafts?.[node?.id]??legacyDraft??imageAssetDraft(canvas,node);
 const channel=node?.generationIntent?.channel||draft?.channel||node?.generation?.channel;
 return GENERATION_CHANNELS.includes(channel)&&node?.coreGenerationAutoOpenDisabled!==true?channel:'';
}
// Original media geometry preserves width and position, and changes height.
export function generationCardRatio(node,channel,ratio){
 if(!['image','video'].includes(channel)||!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(String(ratio)))return false;
 const [w,h]=ratio.split(':').map(Number),numeric=w/h;if(!(numeric>0))return false;
 const height=node.width/numeric;if(Math.abs((node.aspectRatio||0)-numeric)<.0001&&Math.abs(node.height-height)<1)return false;
 node.aspectRatio=numeric;node.height=height;return true;
}
