// Routing uses live notebook metadata and links. It never executes a linked
// document, treats prose as authorization, or imports the ambient skill library.
import {linkIndex} from './workspace.mjs';
const lower=value=>String(value||'').toLowerCase();
const unique=values=>[...new Set(values.filter(Boolean))];
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const generic=new Set(['使用','需要','相关','能力','任务','技能','里面','可以','进行','帮我','当前','完成','处理','文档','要求','图片','视频','音频','文本','文件','内容','查看','读取','请','the','with','this','skill','skills','use']);
const terms=text=>unique([...segmenter.segment(lower(text))].filter(s=>s.isWordLike&&s.segment.length>1&&!generic.has(s.segment)).map(s=>s.segment));
export function taskRoutingQuery(text,messages=[]){
 const continuation=/^\s*(?:继续|接着|接续|按(?:上面|之前|刚才|这个)|就这样|再(?:试|做|改)|把(?:它|这个|上面)|修改(?:它|这)|优化(?:它|这)|continue\b|resume\b|try again\b)/iu;
 if(!continuation.test(String(text)))return String(text||'');
 const prior=messages.slice(0,-1).filter(m=>m.role==='user'&&typeof m.content==='string').map(m=>m.content).reverse().find(t=>!continuation.test(t));
 return prior?prior.slice(0,4000)+'\n本轮接续要求：'+text:String(text||'');
}
const negated=(query,names)=>names.filter(Boolean).some(name=>{const q=lower(query),needle=lower(name);let at=q.indexOf(needle);while(at>=0){const clause=q.slice(Math.max(0,at-45),at).split(/[，,。；;\n]|但是|而是|改用/u).at(-1);if(/(?:不要|禁止|别|不使用|不调用|无需|不用|do not|don't)[^，,。；;\n]{0,30}$/iu.test(clause))return true;at=q.indexOf(needle,at+needle.length);}return false;});
export function taskMatch(query,{title='',name='',description='',aliases=[]}={}){
 const q=lower(query),names=[title,name,...aliases].filter(v=>String(v).length>1);
 if(negated(query,names))return 0;
 if(names.some(n=>q.includes(lower(n))))return 100;
 const words=terms(q),heading=lower(title+' '+name),detail=lower(description);
 return words.reduce((n,w)=>n+(heading.includes(w)?4:detail.includes(w)?1:0),0);
}
const metadata=(id,d)=>({documentId:id,title:d.title||'',kind:d.coreKnowledgeKind||'note',sourceId:d.coreSkillSourceId||'',
 ...(d.coreSkillDocumentation?{skillSource:{sourceId:d.coreSkillDocumentation.sourceId,pluginId:d.coreSkillDocumentation.pluginId,path:d.coreSkillDocumentation.path}}:{})});

export function knowledgeGraph(loaded){
 const docs=Object.fromEntries(Object.entries(loaded.state.documents||{}).filter(([,d])=>!d.coreSkillHistorical));
 const edges=new Map(Object.keys(docs).map(id=>[id,new Set()]));
 for(const {source,target} of linkIndex({...loaded.state,documents:docs}).edges)if(edges.has(source)&&edges.has(target)){edges.get(source).add(target);edges.get(target).add(source);}
 return {docs,edges};
}

export function routeLinkedKnowledge(loaded,{query='',documentIds=[]}={},seed={}){
 const {docs,edges}=knowledgeGraph(loaded),explicit=new Set(documentIds),selected=new Map();
 const matches=new Map(Object.entries(docs).map(([id,d])=>[id,taskMatch(query,{title:d.title,aliases:d.coreKnowledgeAliases,description:d.coreSkillDescription||''})]));
 const add=(id,via,reason)=>{if(docs[id]&&!selected.has(id))selected.set(id,{...metadata(id,docs[id]),via,reason,score:matches.get(id)||0});};
 for(const id of explicit)add(id,'','用户明确引用');
 const named=Object.keys(docs).filter(id=>matches.get(id)>=100);
 for(const id of named)add(id,'','用户点名');
 // Named roots win over a static directory's broad substring matches.
 if(!named.length&&!explicit.size)for(const item of [...(seed.groups||[]),...(seed.modules||[]),...(seed.skills||[])])add(item.documentId,'','任务类型路由');
 if(!named.length&&!explicit.size)for(const [id,value] of [...matches].sort((a,b)=>b[1]-a[1]))if(value>=4&&selected.size<24)add(id,'','任务语义匹配');
 const relevant=new Set([...matches].filter(([,score])=>score>=4).map(([id])=>id));
 // Include intermediate route pages, but never turn unrelated linked skills
 // into candidates merely because they share a hub.
 for(let depth=0;depth<3;depth++){const before=relevant.size;for(const [id,d] of Object.entries(docs))if(d.coreKnowledgeKind==='route'&&[...(edges.get(id)||[])].some(next=>relevant.has(next)&&!named.includes(next)&&!explicit.has(next)))relevant.add(id);if(before===relevant.size)break;}
 let frontier=[...selected.keys()];
 for(let depth=0;depth<4;depth++){
  const next=[];
  for(const id of frontier)for(const target of edges.get(id)||[]){
   const required=(docs[id].coreSkillRequiredDocumentIds||[]).includes(target);
   // A link is evidence of a relationship, not permission to run every sibling.
   if(!selected.has(target)&&(required||relevant.has(target))&&selected.size<24){add(target,id,required?'声明的必读参考':'双向链接与任务匹配');next.push(target);}
  }
  frontier=next;
 }
 return [...selected.values()].map(item=>({...item,linkedDocumentIds:[...(edges.get(item.documentId)||[])].slice(0,40)}));
}

export function createTaskSkillScope({body,catalog,knowledgeCatalog,routing}){
 const refs=(body.skillRefs||[]).filter(r=>r.referenceType==='skill'),key=s=>s.rootId+'\0'+s.skillId;
 const items=[...(catalog.skills||[])];for(const ref of refs)if(!items.some(s=>key(s)===key(ref)))items.push(ref);
 const explicit=new Set(refs.map(key)),docs=new Map((knowledgeCatalog.documents||[]).map(d=>[d.documentId,d]));
 const selected=new Set([...(routing?.documents||[]).map(d=>d.documentId),...[...(body.skillRefs||[]),...(body.routeRefs||[])].filter(r=>r.notebookId===knowledgeCatalog.id).map(r=>r.documentId)]);
 const linkedDocs=[...selected].map(id=>docs.get(id)||(routing?.documents||[]).find(d=>d.documentId===id)).filter(Boolean);
 const matchedDoc=s=>{
  const candidates=explicit.has(key(s))?[...docs.values()]:linkedDocs;
  const exact=candidates.find(d=>{
  const source=d.skillSource;
  if(source?.sourceId==='local:'+s.rootId+':'+s.skillId)return true;
  if(source?.pluginId===s.pluginId&&s.pluginId)return d.title===s.title;
  return d.sourceId===s.skillId||d.sourceId==='builtin:'+s.skillId;
  });if(exact)return exact;const titled=linkedDocs.filter(d=>d.title===s.title);return titled.length===1?titled[0]:undefined;
 };
 const namedLibraries=new Set(items.filter(s=>s.pluginId&&s.library?.length>1&&lower(body.text).includes(lower(s.library))).map(s=>s.pluginId));
 const allowed=items.filter(s=>!negated(body.text,[s.title,s.skillId])&&(explicit.has(key(s))||[s.title,s.skillId].some(n=>n?.length>1&&lower(body.text).includes(lower(n)))||matchedDoc(s)||(!namedLibraries.size||namedLibraries.has(s.pluginId))&&taskMatch(body.text,s.library==='本地技能'?{title:s.title,name:s.skillId}:s)>=4));
 const byKey=new Map(allowed.map(s=>[key(s),s]));
 return {catalog:{rootId:catalog.rootId,skills:allowed.map(s=>({...s,...(matchedDoc(s)?{knowledgeDocumentId:matchedDoc(s).documentId}:{})}))},
  allowReferences(document){for(const ref of [...(document?.requiredDocuments||[]),...(document?.referenceDocuments||[])])if(!['skill','route'].includes(ref.kind))selected.add(ref.documentId);},
  assertKnowledgeAllowed(id){const doc=docs.get(id);if(doc&&(['skill','route'].includes(doc.kind)||doc.skillSource)&&doc.key!=='shensi-routing'&&!selected.has(id)&&!allowed.some(s=>matchedDoc(s)?.documentId===id))throw Object.assign(Error('此知识库技能未匹配本轮任务，请从当前路由和相关双向链接选择，不要改换任务。'),{code:'SKILL_TASK_MISMATCH'});},
  assertAllowed(ref){if(!byKey.has(key(ref)))throw Object.assign(Error('此技能未被本轮用户指定，也未匹配知识库任务路由。请回到本轮请求，使用 knowledge.route/read 查找相关能力，继续原任务。'),{code:'SKILL_TASK_MISMATCH'});},
  knowledgeDocument(ref){return matchedDoc(byKey.get(key(ref))||{})?.documentId;}};
}
