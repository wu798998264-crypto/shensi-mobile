import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {organizeKnowledgeDocuments} from './knowledge-organization.mjs';
import {planRouteHistoryArchives} from './route-history-organization.mjs';
import {chushouKnowledgeSource} from './chushou-bundle.mjs';
import {
 BUNDLED_SKILL_SOURCES,
 SKILL_PANEL,
 SKILL_PANEL_GROUPS,
 SKILL_PANEL_MODULES,
 USER_SKILL_LEGACY_KEYS,
 generatedRouteDocument,
 readableSkillFolderName,
 skillPanelPaths,
 skillPlacements,
 synthesizedSkillDocument,
} from './skill-panel-topology.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const folderIdentity=path=>'knowledge-folder-'+hash(path.join('/')).slice(0,24);
const PANEL_SCHEMA_VERSION=1;
const CURRENT_ROUTE_PREFIX=/^route:(?:template|group|module):/;
const HISTORY_ROUTE_PREFIX='route:template-version:';
const FALLBACK_SKILL_KEYS=Object.freeze({
 'user:shensi.style-distillation':['work-tool:style-distillation/SKILL.md'],
 'user:shensi.book-deconstruction':['work-tool:bestseller-book-deconstruction/SKILL.md'],
 'builtin:video-production-executor':['builtin:video-production-executor'],
 'builtin:video-source-observer':['builtin:video-source-observer'],
});

const moduleMap=new Map(SKILL_PANEL_MODULES.map(node=>[node.id,node]));
const groupMap=new Map(SKILL_PANEL_GROUPS.map(node=>[node.id,node]));
const placements=skillPlacements();
const paths=skillPanelPaths();

function addDocument(state,service,{title,markdown='',folderId='',...metadata},createdIds){
 const used=new Set(Object.values(state.documents||{}).map(doc=>doc.title)),base=String(title||'未命名').trim().slice(0,120)||'未命名';let unique=base,index=2;
 while(used.has(unique))unique=base+' '+index++;
 const id='note-'+randomUUID();
 state.documents[id]={title:unique,moduleId:'library',documentKind:'note',markdown,html:service.markdown(markdown),...(folderId?{coreFolderId:folderId}:{}),...metadata};
 (state.moduleItems??={}).library??=[];state.moduleItems.library.push([id,unique]);createdIds.add(id);return id;
}

function ensureFolder(state,segments){
 state.coreFolders??=[];let parentId=state.coreWork?.enabled?state.coreFolders.find(folder=>folder.workRole==='library')?.id||'':'',path=[];
 for(const raw of segments){const name=String(raw||'').trim();if(!name)continue;path.push(name);const key=path.join('/'),id=folderIdentity(path),legacyId=folderIdentity(path.map(part=>part==='辅助功能'?'辅助能力':part));let folder=state.coreFolders.find(item=>item.id===id||item.id===legacyId)||state.coreFolders.find(item=>item.parentId===parentId&&item.name===name&&item.coreKnowledgeFolder);
  if(!folder){folder={id,name,parentId,coreKnowledgeFolder:true,coreKnowledgePath:key};state.coreFolders.push(folder);}
  else Object.assign(folder,{name,parentId,coreKnowledgeFolder:true,coreKnowledgePath:key});
  parentId=folder.id;
 }
 return parentId;
}

const safeRead=async path=>{try{return await readFile(path,'utf8');}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return '';throw error;}};
async function markdownFiles(root,{limit=500,maxBytes=24*1024*1024}={}){
 const files=[];let bytes=0;
 const walk=async dir=>{for(const entry of await readdir(dir,{withFileTypes:true}).catch(error=>{if(['ENOENT','ENOTDIR'].includes(error.code))return [];throw error;})){
  if(entry.isSymbolicLink())continue;const path=join(dir,entry.name);
  if(entry.isDirectory())await walk(path);else if(/\.(?:md|txt)$/i.test(entry.name)&&entry.name!=='SKILL.md'){
   const text=await safeRead(path);bytes+=Buffer.byteLength(text);if(files.length>=limit||bytes>maxBytes)throw Error('Skill 参考资料超过安全迁移上限');files.push({relativePath:relative(root,path).replaceAll('\\','/'),text});
  }
 }};
 await walk(root);return files;
}

function bundledRoots(){
 const roots=[process.env.SHENSI_LEGACY_SKILL_BUNDLE_ROOT];
 return [...new Set(roots.filter(Boolean).map(value=>resolve(value)))];
}
async function bundledSource(skillId,sourceRelative){
 for(const root of bundledRoots()){
  const path=resolve(root,sourceRelative),rel=relative(root,path);if(rel.startsWith('..'))continue;
  const text=await safeRead(path);if(!text)continue;
  const references=await markdownFiles(join(dirname(path),'references'));
  return {text,references,sourceKind:'legacy-bundled',sourceRelative};
 }
 return null;
}

function userRoots(){
 const roots=[process.env.SHENSI_LEGACY_SKILL_USER_ROOT];
 return [...new Set(roots.filter(Boolean).map(value=>resolve(value)))];
}
async function userSource(skillId){
 const registryKey=USER_SKILL_LEGACY_KEYS[skillId]?.replace(/^skill:/,'');if(!registryKey)return null;
 for(const root of userRoots()){
  const skillRoot=resolve(root,registryKey),rel=relative(root,skillRoot);if(rel.startsWith('..'))continue;
  const versions=await readdir(skillRoot,{withFileTypes:true}).catch(error=>{if(['ENOENT','ENOTDIR'].includes(error.code))return [];throw error;});
  const preferred=versions.filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const version of preferred){const path=join(skillRoot,version,'SKILL.md'),text=await safeRead(path);if(!text)continue;return {text,references:await markdownFiles(join(skillRoot,version)),sourceKind:'legacy-user',sourceRelative:registryKey+'/'+version+'/SKILL.md'};}
 }
 return null;
}

async function sourceDocuments(){
 const result=new Map();
 for(const [skillId,sourceRelative] of Object.entries(BUNDLED_SKILL_SOURCES)){const source=await bundledSource(skillId,sourceRelative);if(source)result.set(skillId,source);}
 for(const skillId of Object.keys(USER_SKILL_LEGACY_KEYS)){const source=await userSource(skillId);if(source)result.set(skillId,source);}
 result.set('builtin:video-production-executor',await chushouKnowledgeSource());
 return result;
}

function routeSpec(type,node){
 const sourceId=type==='panel'?SKILL_PANEL.id:node.id,legacyKey=type==='panel'?'route:template:shensi':'route:'+sourceId;
 return {type,node,sourceId,legacyKey,key:'skill-panel:route:'+sourceId,title:type==='panel'?'技能面板总路由':(type==='group'?'模组路由 · ':'模块路由 · ')+node.name,markdown:generatedRouteDocument(type,node)};
}
const routeSpecs=()=>[routeSpec('panel',SKILL_PANEL),...SKILL_PANEL_GROUPS.map(node=>routeSpec('group',node)),...SKILL_PANEL_MODULES.map(node=>routeSpec('module',node))];

function currentRouteParents(){
 const parents=new Map(),add=(child,parent)=>{const list=parents.get(child)||[];if(!list.includes(parent))list.push(parent);parents.set(child,list);};
 for(const item of SKILL_PANEL.items)add(item.targetId,SKILL_PANEL.id);
 for(const group of SKILL_PANEL_GROUPS)for(const item of group.items)add(item.targetId,group.id);
 return parents;
}

function firstHeading(markdown){return String(markdown||'').match(/^#\s+(.+)$/m)?.[1]?.trim()||'';}
function historicalTitle(doc){
 const legacy=doc.coreLegacyKnowledge?.key||'',parts=legacy.split(':'),revision=parts.at(-2),sourceId=parts.at(-3),node=groupMap.get('group:'+sourceId)||moduleMap.get('module:'+sourceId),heading=firstHeading(doc.markdown);
 const subject=node?.name||(/[^\x00-\xff]/.test(heading)?heading:'历史能力路由');return '历史路由 · '+subject+(revision&&/^\d+$/.test(revision)?' · 版本 '+revision:'');
}

function skillCandidate(state,skillId){
 const entries=Object.entries(state.documents||{}),legacy=USER_SKILL_LEGACY_KEYS[skillId],fallback=new Set(FALLBACK_SKILL_KEYS[skillId]||[]);
 return entries.find(([,doc])=>doc.coreSkillSourceId===skillId)
  ||entries.find(([,doc])=>doc.coreKnowledgeKey==='skill-panel:skill:'+skillId)
  ||entries.find(([,doc])=>legacy&&doc.coreLegacyKnowledge?.key===legacy)
  ||entries.find(([,doc])=>fallback.has(doc.coreKnowledgeKey));
}

const normalizedMarkdown=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,'').trim();
const uniqueIds=values=>[...new Set((values||[]).filter(Boolean))];
function matchingSkillCandidates(state,skillId){
 const legacy=USER_SKILL_LEGACY_KEYS[skillId],fallback=new Set(FALLBACK_SKILL_KEYS[skillId]||[]);
 return Object.entries(state.documents||{}).filter(([,doc])=>doc.coreSkillSourceId===skillId||doc.coreKnowledgeKey==='skill-panel:skill:'+skillId||legacy&&doc.coreLegacyKnowledge?.key===legacy||fallback.has(doc.coreKnowledgeKey));
}
function primaryScore([,doc]){
 const text=normalizedMarkdown(doc.markdown),sourceHash=doc.coreSkillSourceHash||'',manuallyChanged=sourceHash&&hash(text)!==sourceHash;
 return (manuallyChanged?1000:0)+(doc.coreSkillGenerated===false?100:0)+(doc.coreLegacyKnowledge?40:0)+(text.length?Math.min(30,text.length/1000):0);
}
function choosePrimary(candidates){return [...candidates].sort((a,b)=>primaryScore(b)-primaryScore(a))[0];}
function rewriteDocumentIdentity(state,fromIds,toId){
 const removed=new Set(fromIds);if(!removed.size)return;
 const rewrite=value=>uniqueIds(value.map(id=>removed.has(id)?toId:id));
 for(const doc of Object.values(state.documents||{}))for(const key of ['coreGraphLinks','coreSkillDocumentLinks','coreSkillRequiredDocumentIds','coreSkillAvailableDocumentIds'])if(Array.isArray(doc[key]))doc[key]=rewrite(doc[key]);
 for(const [moduleId,items] of Object.entries(state.moduleItems||{})){const seen=new Set();state.moduleItems[moduleId]=(items||[]).map(item=>removed.has(item[0])?[toId,state.documents[toId]?.title||item[1],item[2]]:item).filter(item=>{if(seen.has(item[0]))return false;seen.add(item[0]);return true;});}
 state.documentTabs=(state.documentTabs||[]).map(tab=>removed.has(tab.documentId)?{...tab,documentId:toId}:tab).filter((tab,index,tabs)=>!tab.documentId||tabs.findIndex(item=>item.documentId===tab.documentId)===index);
 if(removed.has(state.activeDocument))state.activeDocument=toId;
 state.coreRecent=uniqueIds((state.coreRecent||[]).map(id=>removed.has(id)?toId:id));
 state.coreFavorites=uniqueIds((state.coreFavorites||[]).map(value=>{const match=String(value).match(/^document:(.+)$/);return match&&removed.has(match[1])?'document:'+toId:value;}));
 state.coreDocumentRedirects??={};for(const id of fromIds)state.coreDocumentRedirects[id]=toId;for(const [id,target] of Object.entries(state.coreDocumentRedirects))if(removed.has(target))state.coreDocumentRedirects[id]=toId;
}
function mergeSkillCandidates(state,candidates,existingDocuments=state.documents){
 if(candidates.length<2)return {primary:candidates[0],merge:null};
 const existing=candidates.filter(([id])=>existingDocuments[id]),primary=choosePrimary(existing.length?existing:candidates),[primaryId,primaryDoc]=primary,duplicates=candidates.filter(([id])=>id!==primaryId),duplicateIds=duplicates.map(([id])=>id);
 for(const [,doc] of duplicates)for(const key of ['coreGraphLinks','coreSkillDocumentLinks','coreSkillRequiredDocumentIds','coreSkillAvailableDocumentIds'])primaryDoc[key]=uniqueIds([...(primaryDoc[key]||[]),...(doc[key]||[])]);
 primaryDoc.coreKnowledgeAliases=uniqueIds([...(primaryDoc.coreKnowledgeAliases||[]),...duplicates.flatMap(([,doc])=>[doc.title,...(doc.coreKnowledgeAliases||[])])].filter(title=>title!==primaryDoc.title));
 primaryDoc.coreKnowledgeMergedKeys=uniqueIds([...(primaryDoc.coreKnowledgeMergedKeys||[]),...duplicates.flatMap(([,doc])=>[doc.coreKnowledgeKey,...(doc.coreKnowledgeMergedKeys||[])])]);
 rewriteDocumentIdentity(state,duplicateIds,primaryId);for(const id of duplicateIds)delete state.documents[id];
 return {primary,merge:{primaryId,duplicateIds}};
}

function routeCandidate(state,spec){
 return Object.entries(state.documents||{}).find(([,doc])=>doc.coreSkillSourceId===spec.sourceId&&doc.coreSkillNodeType==='route')
  ||Object.entries(state.documents||{}).find(([,doc])=>doc.coreLegacyKnowledge?.key===spec.legacyKey)
  ||Object.entries(state.documents||{}).find(([,doc])=>doc.coreKnowledgeKey===spec.key);
}

function referenceCandidates(state,skillId,reference){
 const legacyId=skillId.replace(/^user:/,''),legacy='skill-file:'+legacyId+':'+reference.relativePath,key='skill-panel:reference:'+skillId+':'+reference.relativePath;
 return Object.entries(state.documents||{}).filter(([,doc])=>doc.coreSkillSourceId==='reference:'+skillId+':'+reference.relativePath
  ||doc.coreLegacyKnowledge?.key?.replaceAll('\\','/')===legacy
  ||doc.coreKnowledgeKey===key||skillId==='user:shensi.book-deconstruction'&&doc.coreKnowledgeKey==='work-tool:bestseller-book-deconstruction/'+reference.relativePath);
}

export async function organizeSkillPanelKnowledge({service,notebookId,defaults=[],routeHistoryMetadata={}}){
 const loaded=await service.load(notebookId),state=structuredClone(loaded.state),createdIds=new Set(),createdDefaultIds=new Set();
 const documentMerges=[];
 state.coreFolders??=[];state.documents??={};state.moduleItems??={library:[]};
 for(const item of defaults){if(Object.values(state.documents).some(doc=>doc.coreKnowledgeKey===item.key||doc.coreKnowledgeMergedKeys?.includes(item.key)))continue;const id=addDocument(state,service,{title:item.title,markdown:item.text,coreKnowledgeKey:item.key,coreKnowledgeKind:item.kind},createdIds);createdDefaultIds.add(id);}

 const skillRoot=['技能面板'],routeRoot=['路由文档'];ensureFolder(state,skillRoot);const routeFolders={panel:ensureFolder(state,[...routeRoot,'总路由']),group:ensureFolder(state,[...routeRoot,'模组路由']),module:ensureFolder(state,[...routeRoot,'模块路由']),history:ensureFolder(state,[...routeRoot,'历史路由'])};
 const sources=await sourceDocuments(),skillDocs=new Map(),referenceDocs=new Map();
 for(const [skillId,skillPlacement] of placements){
  const canonical=(paths.modulePaths.get(skillPlacement[0].parentId)?.[0]||[readableSkillFolderName(skillPlacement[0].parentName)]).map(name=>name==='辅助能力'?'辅助功能':name),folderId=ensureFolder(state,[...skillRoot,...canonical]),source=sources.get(skillId),merged=mergeSkillCandidates(state,matchingSkillCandidates(state,skillId),loaded.state.documents),existing=merged.primary;if(merged.merge)documentMerges.push(merged.merge);
  let documentId,doc;
  if(existing){[documentId,doc]=existing;const current=normalizedMarkdown(doc.markdown),managed=source?.managedRevision&&(doc.coreSkillBundleManagedHash===hash(current)||source.previousHashes?.includes(hash(current))||source.previousTexts?.some(text=>normalizedMarkdown(text)===current));const canReplace=source&&(createdDefaultIds.has(documentId)||managed);if(canReplace&&current!==normalizedMarkdown(source.text)){doc.markdown=source.text;doc.html=service.markdown(source.text);}}
  else {const text=source?.text||synthesizedSkillDocument(skillId,skillPlacement);documentId=addDocument(state,service,{title:skillPlacement[0].slotName,markdown:text,folderId,coreKnowledgeKey:'skill-panel:skill:'+skillId,coreKnowledgeKind:'skill'},createdIds);doc=state.documents[documentId];}
  Object.assign(doc,{coreFolderId:folderId,coreKnowledgeKind:'skill',coreSkillPanelId:SKILL_PANEL.id,coreSkillNodeType:'skill',coreSkillSourceId:skillId,coreSkillRelationType:skillPlacement[0].relationType,coreSkillRole:skillPlacement[0].role,coreSkillParentIds:skillPlacement.map(item=>item.parentId),coreSkillPlacements:skillPlacement.map(item=>({...item,path:paths.modulePaths.get(item.parentId)||[]})),coreSkillOrder:Math.min(...skillPlacement.map(item=>item.order)),coreSkillSourceHash:source?hash(source.text):doc.coreSkillSourceHash||hash(String(doc.markdown||'')),coreSkillSourceKind:source?.sourceKind||doc.coreSkillSourceKind||'synthesized',coreSkillSourceRelativePath:source?.sourceRelative||doc.coreSkillSourceRelativePath||'',coreSkillGenerated:source?false:doc.coreSkillGenerated??true});
  skillDocs.set(skillId,documentId);
  if(source?.managedRevision){
   if(normalizedMarkdown(doc.markdown)===normalizedMarkdown(source.text)){doc.coreSkillBundleManagedHash=hash(normalizedMarkdown(source.text));doc.coreSkillBundleRevision=source.managedRevision;delete doc.coreSkillBundleUpdateAvailable;}
   else doc.coreSkillBundleUpdateAvailable=source.managedRevision;
  }
  // Removing private files from the installer must not remove references that
  // already belong to this user's knowledge library. Original graph order also
  // repairs the earlier empty-list migration without copying private content.
  const existingReference=id=>state.documents[id]?.coreSkillSourceId?.startsWith('reference:'+skillId+':');
  const currentRequired=doc.coreSkillRequiredDocumentIds||[],graphReferences=(doc.coreGraphLinks||[]).filter(id=>existingReference(id)||currentRequired.includes(id));
  const repairOrder=graphReferences.some(id=>existingReference(id)&&!currentRequired.includes(id));
  const required=source?[]:uniqueIds([...(repairOrder?graphReferences:currentRequired),...(repairOrder?currentRequired:graphReferences),...Object.keys(state.documents).filter(existingReference)].filter(id=>state.documents[id]));
  const available=[];
  for(const reference of source?.references||[]){
   if(!reference.text.trim())continue;const referenceFolder=ensureFolder(state,[...skillRoot,...canonical,skillPlacement[0].slotName+'参考资料']),mergedReference=mergeSkillCandidates(state,referenceCandidates(state,skillId,reference),loaded.state.documents),candidate=mergedReference.primary;let refId,refDoc;if(mergedReference.merge)documentMerges.push(mergedReference.merge);
   if(candidate){[refId,refDoc]=candidate;if(source.managedRevision&&refDoc.coreSkillBundleManagedHash===hash(normalizedMarkdown(refDoc.markdown))&&normalizedMarkdown(refDoc.markdown)!==normalizedMarkdown(reference.text)){refDoc.markdown=reference.text;refDoc.html=service.markdown(reference.text);}}else{refId=addDocument(state,service,{title:reference.relativePath,markdown:reference.text,folderId:referenceFolder,coreKnowledgeKey:'skill-panel:reference:'+skillId+':'+reference.relativePath,coreKnowledgeKind:'note'},createdIds);refDoc=state.documents[refId];}
   if(source.managedRevision&&normalizedMarkdown(refDoc.markdown)===normalizedMarkdown(reference.text))refDoc.coreSkillBundleManagedHash=hash(normalizedMarkdown(reference.text));
   Object.assign(refDoc,{coreFolderId:referenceFolder,coreSkillPanelId:SKILL_PANEL.id,coreSkillNodeType:'reference',coreSkillSourceId:'reference:'+skillId+':'+reference.relativePath,coreSkillParentIds:[skillId],coreSkillSourceHash:hash(reference.text),coreSkillSourceKind:source.sourceKind,coreSkillSourceRelativePath:(source.sourceRelative?dirname(source.sourceRelative).replaceAll('\\','/')+'/':'')+reference.relativePath});if(source.referenceMode==='on-demand')available.push(refId);else required.push(refId);referenceDocs.set(refDoc.coreSkillSourceId,refId);
  }
  if(skillId==='user:shensi.book-deconstruction')for(const [refId,refDoc] of Object.entries(state.documents))if(refDoc.coreKnowledgeKey?.startsWith('work-tool:book-complement/')||refDoc.coreKnowledgeKey?.startsWith('work-tool:bestseller-book-deconstruction/references/'))required.push(refId);
  doc.coreSkillRequiredDocumentIds=[...new Set(required)];
  if(source?.referenceMode==='on-demand')doc.coreSkillAvailableDocumentIds=available;
 }

 const routeDocs=new Map();
 for(const spec of routeSpecs()){
  const existing=routeCandidate(state,spec),folderId=routeFolders[spec.type];let documentId,doc;if(existing)[documentId,doc]=existing;else{documentId=addDocument(state,service,{title:spec.title,markdown:spec.markdown,folderId,coreKnowledgeKey:spec.key,coreKnowledgeKind:'route'},createdIds);doc=state.documents[documentId];}
  doc.title=spec.title;Object.assign(doc,{coreFolderId:folderId,coreKnowledgeKind:'route',coreSkillPanelId:SKILL_PANEL.id,coreSkillNodeType:'route',coreSkillRouteType:spec.type,coreSkillSourceId:spec.sourceId,coreSkillRelationType:spec.node.relationType,coreSkillSourceHash:doc.coreSkillSourceHash||hash(String(doc.markdown||'')),coreSkillGenerated:existing?doc.coreSkillGenerated??false:true,coreSkillHistorical:false});routeDocs.set(spec.sourceId,documentId);
 }

 for(const doc of Object.values(state.documents))if(doc.coreKnowledgeKind==='route'&&!doc.coreSkillSourceId){const legacy=doc.coreLegacyKnowledge?.key||'';if(legacy.startsWith(HISTORY_ROUTE_PREFIX)||doc.coreKnowledgeKey?.startsWith('legacy-import:')&&!CURRENT_ROUTE_PREFIX.test(legacy)){doc.coreFolderId=routeFolders.history;doc.coreSkillPanelId=SKILL_PANEL.id;doc.coreSkillNodeType='route';doc.coreSkillRouteType='history';doc.coreSkillSourceId='history:'+legacy;doc.coreSkillHistorical=true;if(/^原版路由(?: \d+)?$/.test(doc.title||''))doc.title=historicalTitle(doc);}else if(doc.coreKnowledgeKey==='shensi-routing')doc.coreFolderId=routeFolders.panel;}

 const parentMap=currentRouteParents();
 for(const spec of routeSpecs()){
  const doc=state.documents[routeDocs.get(spec.sourceId)],parentIds=parentMap.get(spec.sourceId)||[],childSourceIds=spec.type==='panel'?SKILL_PANEL.items.map(item=>item.targetId):spec.type==='group'?spec.node.items.map(item=>item.targetId):spec.node.slots.map(slot=>slot.id),childDocumentIds=childSourceIds.map(id=>routeDocs.get(id)||skillDocs.get(id)).filter(Boolean),parentDocumentIds=parentIds.map(id=>routeDocs.get(id)).filter(Boolean);
  Object.assign(doc,{coreSkillParentIds:parentIds,coreSkillChildIds:childSourceIds,coreSkillDocumentLinks:[...new Set([...parentDocumentIds,...childDocumentIds])],coreSkillOrder:spec.type==='panel'?0:Math.min(...((parentIds.length?parentIds:[SKILL_PANEL.id]).map(parent=>{const container=parent===SKILL_PANEL.id?SKILL_PANEL:groupMap.get(parent);return container?.items?.find(item=>item.targetId===spec.sourceId)?.order??0;})))});
 }
 for(const [,documentId] of skillDocs){const doc=state.documents[documentId],links=[...(doc.coreSkillParentIds||[]).map(id=>routeDocs.get(id)).filter(Boolean),...(doc.coreSkillRequiredDocumentIds||[]),...(doc.coreSkillAvailableDocumentIds||[])];doc.coreSkillDocumentLinks=[...new Set(links)];}
 for(const [sourceId,documentId] of referenceDocs){const doc=state.documents[documentId],skillId=sourceId.slice('reference:'.length).split(':').slice(0,-1).join(':');doc.coreSkillDocumentLinks=skillDocs.has(skillId)?[skillDocs.get(skillId)]:[];}

 for(const doc of Object.values(state.documents))if(doc.coreSkillPanelId===SKILL_PANEL.id&&!doc.coreSkillGraphInitialized){doc.coreGraphLinks=[...new Set([...(doc.coreGraphLinks||[]),...(doc.coreSkillDocumentLinks||[])])];doc.coreSkillGraphInitialized=true;}
 const routePlan=planRouteHistoryArchives(state,routeHistoryMetadata);
 for(const merge of routePlan.merges){merge.savedTimes=Object.fromEntries(merge.duplicateIds.map(id=>[id,state.documents[id].coreRouteHistorySavedAt]).filter(([,time])=>time));const target=state.documents[merge.primaryId];target.coreKnowledgeAliases=uniqueIds([...(target.coreKnowledgeAliases||[]),...merge.duplicateIds.map(id=>state.documents[id].title)]);target.coreKnowledgeMergedKeys=uniqueIds([...(target.coreKnowledgeMergedKeys||[]),...merge.duplicateIds.map(id=>state.documents[id].coreKnowledgeKey)]);for(const duplicateId of merge.duplicateIds)for(const key of ['coreGraphLinks','coreSkillDocumentLinks'])target[key]=uniqueIds([...(target[key]||[]),...(state.documents[duplicateId][key]||[])]);rewriteDocumentIdentity(state,merge.duplicateIds,merge.primaryId);for(const id of merge.duplicateIds)delete state.documents[id];documentMerges.push(merge);}
 organizeKnowledgeDocuments(state,segments=>ensureFolder(state,segments));
 state.coreSkillPanelMigration={schemaVersion:PANEL_SCHEMA_VERSION,panelId:SKILL_PANEL.id,skillCount:skillDocs.size,moduleCount:SKILL_PANEL_MODULES.length,groupCount:SKILL_PANEL_GROUPS.length,updatedAt:state.coreSkillPanelMigration?.updatedAt||new Date().toISOString()};
 if(JSON.stringify(loaded.state)===JSON.stringify(state))return loaded;
 const existingMerges=documentMerges.map(merge=>({...merge,duplicateIds:merge.duplicateIds.filter(id=>loaded.state.documents[id])})).filter(merge=>merge.duplicateIds.length);
 const documentUpdates=Object.keys(state.documents).filter(id=>loaded.state.documents[id]&&state.documents[id].coreSkillSourceKind==='packaged-chushou'&&normalizedMarkdown(state.documents[id].markdown)!==normalizedMarkdown(loaded.state.documents[id].markdown));
 return (existingMerges.length||documentUpdates.length)&&service.saveMergedDocuments?service.saveMergedDocuments(notebookId,{state,expectedStateStamp:loaded.stateStamp,documentMerges:existingMerges,documentUpdates}):service.save(notebookId,{state,expectedStateStamp:loaded.stateStamp});
}

function publicDocument(documentId,doc,{text=true}={}){return {documentId,title:doc.title,key:doc.coreKnowledgeKey||'',kind:doc.coreKnowledgeKind||'note',legacySource:doc.coreLegacyKnowledge?.key||'',folderId:doc.coreFolderId||'',nodeType:doc.coreSkillNodeType||'',sourceId:doc.coreSkillSourceId||'',relationType:doc.coreSkillRelationType||'',role:doc.coreSkillRole||'',parentIds:doc.coreSkillParentIds||[],requiredDocumentIds:doc.coreSkillRequiredDocumentIds||[],historical:!!doc.coreSkillHistorical,...(doc.coreSkillDocumentation?{skillSource:{sourceId:doc.coreSkillDocumentation.sourceId,pluginId:doc.coreSkillDocumentation.pluginId,path:doc.coreSkillDocumentation.path}}:{}),...(text?{text:String(doc.markdown||'')}:{})};}

export function knowledgeListFromState(notebookId,loaded){return {id:notebookId,stateStamp:loaded.stateStamp,documents:Object.entries(loaded.state.documents||{}).map(([id,doc])=>publicDocument(id,doc))};}
export function knowledgeCatalogFromState(notebookId,loaded){return {id:notebookId,stateStamp:loaded.stateStamp,documents:Object.entries(loaded.state.documents||{}).filter(([,doc])=>['skill','route'].includes(doc.coreKnowledgeKind)&&!doc.coreSkillHistorical).map(([id,doc])=>publicDocument(id,doc,{text:false}))};}

const termScore=(text,term)=>{
 if(text.includes(term))return Math.max(2,term.length);
 for(let size=Math.min(8,term.length);size>=2;size--)for(let index=0;index+size<=term.length;index++)if(text.includes(term.slice(index,index+size)))return size;
 return 0;
};
const score=(query,node)=>{const text=String(query||'').toLowerCase(),terms=[node.name,node.description,node.triggerRules,...(node.hints||[])].filter(Boolean).map(item=>String(item).toLowerCase());if(!text)return 0;return terms.reduce((total,term)=>total+termScore(text,term),0);};
const routeSummary=(node,documentId)=>({sourceId:node.id,documentId,name:node.name,description:node.description,relationType:node.relationType,hints:node.hints||[]});
export function routeKnowledgeFromState(notebookId,loaded,{query='',groupIds=[],moduleIds=[],skillIds=[]}={}){
 const bySource=new Map(Object.entries(loaded.state.documents||{}).filter(([,doc])=>doc.coreSkillSourceId).map(([id,doc])=>[doc.coreSkillSourceId,{id,doc}])),explicitGroups=new Set(groupIds),explicitModules=new Set(moduleIds),explicitSkills=new Set(skillIds);
 const routeQuery=String(query||''),groupConflict=node=>node.id==='group:short-fiction'&&/长篇/u.test(routeQuery)&&!/短篇/u.test(routeQuery)||node.id==='group:novel'&&/短篇/u.test(routeQuery)&&!/长篇/u.test(routeQuery);
 const moduleScores=new Map(SKILL_PANEL_MODULES.map(node=>[node.id,score(query,node)+Math.max(0,...node.slots.map(slot=>score(query,{name:slot.name,description:slot.description,hints:[]})))]));
 const groupScores=new Map();const groupScore=id=>{if(groupScores.has(id))return groupScores.get(id);const node=groupMap.get(id);if(!node)return 0;const direct=score(query,node),descendant=Math.max(0,...node.items.map(item=>item.targetType==='group'?groupScore(item.targetId):moduleScores.get(item.targetId)||0)),value=direct*2+descendant*.25;groupScores.set(id,value);return value;};
 const groupCandidates=SKILL_PANEL_GROUPS.filter(node=>explicitGroups.has(node.id)||!groupConflict(node)&&groupScore(node.id)>0).sort((a,b)=>(Number(explicitGroups.has(b.id))-Number(explicitGroups.has(a.id)))||groupScore(b.id)-groupScore(a.id)),maxGroupScore=Math.max(0,...groupCandidates.map(node=>groupScore(node.id))),groups=groupCandidates.filter(node=>explicitGroups.has(node.id)||groupScore(node.id)>=Math.max(4,maxGroupScore*.45)).slice(0,3);
 const reachableModules=new Set();const collect=id=>{const group=groupMap.get(id);if(!group)return;for(const item of group.items)item.targetType==='group'?collect(item.targetId):reachableModules.add(item.targetId);};for(const group of groups)collect(group.id);for(const item of SKILL_PANEL.items)if(item.targetType==='module')reachableModules.add(item.targetId);
 const moduleCandidates=SKILL_PANEL_MODULES.filter(node=>explicitModules.has(node.id)||(reachableModules.has(node.id)&&moduleScores.get(node.id)>0)).sort((a,b)=>(Number(explicitModules.has(b.id))-Number(explicitModules.has(a.id)))||(moduleScores.get(b.id)||0)-(moduleScores.get(a.id)||0)),maxModuleScore=Math.max(0,...moduleCandidates.map(node=>moduleScores.get(node.id)||0)),modules=moduleCandidates.filter(node=>explicitModules.has(node.id)||(moduleScores.get(node.id)||0)>=Math.max(3,maxModuleScore*.45)).slice(0,6);
 const chosenSkills=new Set(explicitSkills);
 for(const module of modules){
  const ranked=module.slots.map(slot=>({slot,value:score(query,{name:slot.name,description:slot.description,hints:[]})})).sort((a,b)=>b.value-a.value);
  if(module.relationType==='primary-secondary'){const primary=module.slots.find(slot=>slot.role==='primary')||module.slots[0];if(primary)chosenSkills.add(primary.id);for(const item of ranked)if(item.value>0)chosenSkills.add(item.slot.id);}
  else if(module.relationType==='organization'){const upper=module.slots.find(slot=>slot.role==='upper')||module.slots[0];if(upper)chosenSkills.add(upper.id);for(const item of ranked)if(item.value>0)chosenSkills.add(item.slot.id);}
  else {const matched=ranked.filter(item=>item.value>0);for(const item of matched.length?matched:ranked)chosenSkills.add(item.slot.id);}
 }
 const skills=[...placements].filter(([id])=>chosenSkills.has(id)).sort(([a],[b])=>(Number(explicitSkills.has(b))-Number(explicitSkills.has(a)))||score(query,{name:placements.get(b)[0].slotName,description:placements.get(b)[0].description})-score(query,{name:placements.get(a)[0].slotName,description:placements.get(a)[0].description})).slice(0,8).map(([id,list])=>({sourceId:id,documentId:bySource.get(id)?.id||'',name:list[0].slotName,description:list[0].description,parents:list.map(item=>item.parentId),roles:[...new Set(list.map(item=>item.role))],relationTypes:[...new Set(list.map(item=>item.relationType))]}));
 const panel=bySource.get(SKILL_PANEL.id);return {id:notebookId,query:String(query).slice(0,1000),limits:{groups:3,modules:6,skills:8},panel:{sourceId:SKILL_PANEL.id,documentId:panel?.id||'',name:'技能面板',description:SKILL_PANEL.description},groups:groups.map(node=>routeSummary(node,bySource.get(node.id)?.id||'')),modules:modules.map(node=>routeSummary(node,bySource.get(node.id)?.id||'')),skills};
}

export function readKnowledgeFromState(notebookId,loaded,documentId){
 documentId=loaded.state.coreDocumentRedirects?.[documentId]||documentId;
 const doc=loaded.state.documents?.[documentId];if(!doc)return null;const result=publicDocument(documentId,doc),required=(doc.coreSkillRequiredDocumentIds||[]).map(id=>loaded.state.documents[id]&&publicDocument(id,loaded.state.documents[id])).filter(Boolean);
 const referenceDocuments=(doc.coreSkillAvailableDocumentIds||[]).map(id=>loaded.state.documents[id]&&publicDocument(id,loaded.state.documents[id],{text:false})).filter(Boolean);
 return {...result,notebookId,requiredDocuments:required,...(referenceDocuments.length?{referenceDocuments}:{}),...(doc.coreSkillBundleUpdateAvailable?{bundleUpdateAvailable:doc.coreSkillBundleUpdateAvailable}: {})};
}
