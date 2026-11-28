import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,extname} from 'node:path';

const content=asset=>asset.coreNodeSnapshot||{name:asset.nodeName||asset.attachment?.name||'文本',text:asset.text||'',file:asset.kind==='text'?undefined:asset.attachment?.relativePath,kind:asset.kind||'text',mimeType:asset.attachment?.mimeType};
const matches=(node,asset)=>{const old=content(asset);return String(node.text||'')===String(old.text||'')&&String(node.file||'')===String(old.file||'')&&String(node.file?node.kind:'text')===String(old.file?old.kind:'text');};
const identity=(id,documentId,assetId)=>Buffer.from(JSON.stringify([id,documentId,assetId])).toString('base64url');
const fileName=(node,asset)=>{const name=node.name||asset.nodeName||basename(node.file),extension=extname(node.file);return extension&&!name.toLowerCase().endsWith(extension.toLowerCase())?name+extension:name;};

// Only asset content and source identities enter the catalog, never settings.
export function createAssetCatalog(service){
 async function list({notebookId}={}){
  const entries=[];
  for(const notebook of await service.list()){
   if(notebookId&&notebook.id!==notebookId)continue;
   const loaded=await (service.assetLoad||service.load)(notebook.id),state=loaded.state;
   const collect=(assets,nodes,trash,documentId,title,removed={})=>{
    const versions=assets.map(asset=>({...asset}));
    for(const node of nodes){
     if(!node.text&&!node.file)continue;
     const current=[...versions].reverse().find(asset=>asset.sourceNodeId===node.id&&matches(node,asset));
     if(current){current.current=true;continue;}
     if(node.file&&versions.some(asset=>content(asset).file===node.file))continue;
     versions.push({id:'current:'+node.id,sourceNodeId:node.id,nodeName:node.name,kind:node.file?node.kind:'text',text:node.text||'',origin:node.generation?'generated':'upload',current:true,coreNodeSnapshot:node,createdAt:node.generation?.createdAt||''});
    }
    for(const asset of versions){
     if(!asset.id||removed[asset.id])continue;const source=content(asset),snapshot={};
     for(const field of ['type','kind','name','text','file','mimeType','width','height','aspectRatio','durationMs','videoWidth','videoHeight'])if(source[field]!==undefined)snapshot[field]=source[field];
     if(asset.kind==='text'){delete snapshot.file;snapshot.kind='text';}
     entries.push({id:identity(notebook.id,documentId,asset.id),assetId:asset.id,sourceNodeId:asset.sourceNodeId||'',sourceNotebookId:notebook.id,sourceDocumentId:documentId,sourceLabel:[notebook.name,title].filter(Boolean).join(' / '),sourceStateStamp:loaded.stateStamp,kind:asset.kind==='generated'?'text':asset.kind||'text',origin:asset.origin||'upload',current:!!asset.current,trashed:!!trash?.[asset.id],nodeName:asset.nodeName||snapshot.name||asset.attachment?.name||'文本',prompt:asset.prompt||'',createdAt:asset.createdAt||'',coreNodeSnapshot:snapshot});
    }
   };
   collect(state.workspaceAssets||[],[],state.coreWorkspaceAssetTrash,'','独立资产',state.coreAssetCatalogRemoved);
   for(const [documentId,doc] of Object.entries(state.documents||{}))if(doc.canvas)collect(doc.canvas.assets||[],doc.canvas.nodes||[],doc.canvas.coreAssetTrash,documentId,doc.title,doc.canvas.coreAssetCatalogRemoved);
  }
  return {assets:entries};
 }
 async function find(sourceId){let parts;try{parts=JSON.parse(Buffer.from(String(sourceId),'base64url').toString('utf8'));}catch{}if(!Array.isArray(parts)||parts.length!==3||parts.some(p=>typeof p!=='string')||! /^[a-zA-Z0-9_-]{1,90}$/.test(parts[0])||identity(...parts)!==sourceId)throw Error('原资产身份无效，请重新选择');const asset=(await list({notebookId:parts[0]})).assets.find(asset=>asset.id===sourceId);if(!asset)throw Error('原资产已不存在，请刷新资产列表');return asset;}
 async function importAsset({id,documentId,sourceId,expectedSourceStateStamp},resolvedAsset){
  const asset=resolvedAsset||await find(sourceId),node={...asset.coreNodeSnapshot};
  if(asset.sourceStateStamp!==expectedSourceStateStamp)throw Object.assign(Error('原资产所在笔记已变化，请刷新后重新选择'),{code:'WORKSPACE_STATE_CONFLICT'});
  const target=await service.load(id);if(!target.state.documents[documentId]?.canvas)throw Error('目标白板已不存在');
  if(node.file){
   const info=await service.assetInfo(asset.sourceNotebookId,node.file,asset.sourceDocumentId||undefined);
   if(asset.sourceNotebookId===id)return {node};
   const attachment=await service.asset(id,{name:fileName(node,asset),mimeType:node.mimeType||info.mimeType,base64:(await readFile(info.absolutePath)).toString('base64'),whiteboardDocumentId:documentId,whiteboardMediaKind:node.kind});
   Object.assign(node,{file:attachment.relativePath,mimeType:attachment.mimeType||node.mimeType});
  }
  return {node};
 }
 async function setTrash({sourceIds,trashed,expectedStateStamp}){
  if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>1000)throw Error('请选择 1–1000 项资产');
  const all=(await list()).assets,chosen=sourceIds.map(id=>all.find(asset=>asset.id===id));if(chosen.some(asset=>!asset||asset.assetId.startsWith('current:')))throw Error('当前卡片内容不能作为独立资产删除');
  const id=chosen[0].sourceNotebookId;if(chosen.some(asset=>asset.sourceNotebookId!==id))throw Error('每个资产事务只能修改同一个笔记本');
  const loaded=await service.load(id);if(loaded.stateStamp!==expectedStateStamp)throw Object.assign(Error('资产所在笔记已变化，请刷新后重试'),{code:'WORKSPACE_STATE_CONFLICT'});
  return {id,...await service.setAssetTrash(id,{items:chosen.map(a=>({documentId:a.sourceDocumentId,sourceNodeId:a.sourceNodeId,assetId:a.assetId})),trashed,expectedStateStamp:loaded.stateStamp})};
 }
 async function remove({sourceId,expectedStateStamp}){
  const asset=await find(sourceId);if(!asset.trashed||asset.assetId.startsWith('current:'))throw Error('仅可移除回收站内的独立资产记录');
  const loaded=await service.load(asset.sourceNotebookId);if(loaded.stateStamp!==expectedStateStamp)throw Object.assign(Error('原笔记已变化，请刷新后重试'),{code:'WORKSPACE_STATE_CONFLICT'});
  const container=asset.sourceDocumentId?loaded.state.documents[asset.sourceDocumentId]?.canvas:loaded.state;if(!container)throw Error('原白板已不存在');
  (container.coreAssetCatalogRemoved??={})[asset.assetId]=new Date().toISOString();
  return {id:asset.sourceNotebookId,...await service.save(asset.sourceNotebookId,{state:loaded.state,expectedStateStamp:loaded.stateStamp})};
 }
 async function land({sourceId,expectedSourceStateStamp,id,title,folderId,expectedStateStamp}){
  const asset=await find(sourceId);if(asset.sourceStateStamp!==expectedSourceStateStamp)throw Error('原资产已变化，请重新选择');
  const loaded=await service.load(id);if(loaded.stateStamp!==expectedStateStamp)throw Object.assign(Error('目标笔记已变化，请重试'),{code:'WORKSPACE_STATE_CONFLICT'});
  const folders=loaded.state.coreFolders||[],library=folders.find(f=>f.workRole==='library');folderId??=loaded.state.coreWork?.enabled?library?.id||'':'';
  if(folderId&&!folders.some(f=>f.id===folderId))throw Error('保存目录已不存在');
  if(loaded.state.coreWork?.enabled){let current=folders.find(f=>f.id===folderId),valid=false;const seen=new Set();while(current&&!seen.has(current.id)){seen.add(current.id);if(current.id===library?.id){valid=true;break;}current=folders.find(f=>f.id===current.parentId);}if(!valid)throw Error('作品素材须保存到资料库及其子目录');}
  const node=asset.coreNodeSnapshot;let markdown=node.text||'';
  if(node.file){const info=await service.assetInfo(asset.sourceNotebookId,node.file,asset.sourceDocumentId||undefined),attachment=await service.asset(id,{name:fileName(node,asset),mimeType:node.mimeType||info.mimeType,base64:(await readFile(info.absolutePath)).toString('base64')});
   const escape=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
   markdown=node.kind==='image'?'!['+String(node.name||'图片').replace(/[\[\]\n]/g,'')+']('+attachment.relativePath+')':'<'+node.kind+' controls src="'+escape(attachment.relativePath)+'"></'+node.kind+'>';
  }
  return {id,...await service.createDocument(id,{expectedStateStamp,source:'user',document:{title:title||asset.nodeName||'资产笔记',markdown,coreFolderId:folderId,...(loaded.state.coreWork?.enabled?{coreWorkRole:'library',coreWorkContentType:'reference'}:{})}})};
 }
 async function replace(body){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.operationId||''))throw Error('替换需要唯一操作身份');
  if(!!body.sourceNodeId===!!body.sourceId)throw Error('请选择一个替换来源');
  const selectionHash=createHash('sha256').update(JSON.stringify([body.documentId,body.nodeId,body.sourceNodeId||'',body.sourceId||'',body.expectedSourceStateStamp||'',body.expectedStateStamp])).digest('hex');
  const live=await service.load(body.id),prior=live.state.coreTextOperations?.[body.operationId];
  if(prior){if(prior.selectionHash!==selectionHash)throw Error('操作身份已用于其他替换');return {...live,documentId:body.documentId,nodeId:body.nodeId,replayed:true};}
  if(live.stateStamp!==body.expectedStateStamp)throw Object.assign(Error('白板已变化，请重新选择'),{code:'WORKSPACE_STATE_CONFLICT'});
  let source;
  if(body.sourceNodeId){const node=live.state.documents[body.documentId]?.canvas?.nodes.find(n=>n.id===body.sourceNodeId);if(!node||node.id===body.nodeId)throw Error('请选择其他媒体卡片');source=structuredClone(node);}
  else {const asset=await find(body.sourceId);if(asset.trashed||!['image','video','audio'].includes(asset.kind))throw Error('请选择未回收的媒体资产');source=(await importAsset(body,asset)).node;}
  if(!['image','video','audio'].includes(source?.kind)||!source.file)throw Error('仅可使用真实媒体替换');
  return service.replaceCard(body.id,{...body,source,selectionHash});
 }
 async function clipboardEntries(sourceIds){
  if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>500)throw Error('请选择 1 至 500 项资产');
  const catalog=new Map((await list()).assets.map(asset=>[asset.id,asset]));
  return Promise.all(sourceIds.map(async id=>{
   const asset=catalog.get(id);if(!asset)throw Error('原资产已变化，请刷新资产库');
   const node=asset.coreNodeSnapshot;
   if(!node.file)return {name:(asset.nodeName||'文本')+'.md',text:node.text||''};
   const file=await service.assetInfo(asset.sourceNotebookId,node.file,asset.sourceDocumentId||undefined);
   return {path:file.absolutePath,name:fileName(node,asset),mimeType:file.mimeType};
  }));
 }
 return {list,importAsset,setTrash,remove,land,replace,clipboardEntries};
}
