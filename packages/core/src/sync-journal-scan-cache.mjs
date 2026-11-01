// Cache only journal metadata, not payloads. Every use is bracketed by the
// provider's change cursor; interrupted scans retain work, never a partial
// inventory. No directory ETag/mtime is assumed to cover descendants.
export function createJournalScanCache({io,delta,root,scope,checkpoint,maxCheckpointBytes=Infinity}){
 const base=root.replace(/^\/+|\/+$/g,''),folder=base.split('/')[0],decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();let state,tail=Promise.resolve();
 const fresh=cursor=>({version:1,scope,cursor,lists:{},values:{}});
 const inside=path=>path===base||path.startsWith(base+'/');
 const save=()=>{
  if(!checkpoint)return;
  const snapshot=structuredClone(state);
  // Native mobile metadata rows have a 4MiB bound. Cache eviction never
  // removes remote history; evicted bytes must be fetched/validated again.
  if(Number.isFinite(maxCheckpointBytes)){
   let bytes=encoder.encode(JSON.stringify(snapshot)).length;
   for(const key of Object.keys(snapshot.values)){if(bytes<=maxCheckpointBytes)break;bytes-=encoder.encode(JSON.stringify(key)+':'+JSON.stringify(snapshot.values[key])+',').length;delete snapshot.values[key];}
   if(encoder.encode(JSON.stringify(snapshot)).length>maxCheckpointBytes)return checkpoint.save(fresh(''));
  }
  return checkpoint.save(snapshot);
 };
 const invalidate=(path,isDir=false)=>{
  if(!state)return;
  for(const key of Object.keys(state.lists)){const [list]=JSON.parse(key);if(path===list||path.startsWith(list+'/')||isDir&&list.startsWith(path+'/'))delete state.lists[key];}
  for(const key of Object.keys(state.values))if(key===path||isDir&&key.startsWith(path+'/'))delete state.values[key];
 };
 const valid=saved=>{
  try{return saved?.version===1&&saved.scope===scope&&typeof saved.cursor==='string'&&saved.cursor.length<=4096&&saved.lists&&saved.values&&!Array.isArray(saved.lists)&&!Array.isArray(saved.values)&&Object.entries(saved.lists).every(([key,names])=>{const value=JSON.parse(key);return Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&inside(value[0])&&['files','collections'].includes(value[1])&&Array.isArray(names)&&new Set(names).size===names.length&&names.every(n=>typeof n==='string'&&n&&!/[\\/\x00-\x1f]/.test(n)&&n!=='.'&&n!=='..');})&&Object.entries(saved.values).every(([path,value])=>inside(path)&&typeof value==='string'&&encoder.encode(value).length<=2*1024*1024);}catch{return false;}
 };
 async function refresh(){
  if(!state.cursor){state=fresh((await delta.latest(folder)).cursor);return false;}
  let invalidated=false;const seen=new Set();
  for(let page=0;page<1000;page++){
   if(seen.has(state.cursor))throw Object.assign(Error('增量游标循环，未采用不完整扫描'),{code:'NUTSTORE_DELTA_INVALID'});seen.add(state.cursor);
   const change=await delta.changes(folder,state.cursor);
   if(change.reset){state=fresh((await delta.latest(folder)).cursor);return true;}
   for(const entry of change.entries){
    const path=entry.path.replace(/^\/+|\/+$/g,'');
    if(!inside(path)&&!base.startsWith(path+'/'))continue;
    invalidated=true;
    invalidate(path,entry.isDir);
   }
   state.cursor=change.cursor;if(!change.hasMore)return invalidated;
  }
  throw Object.assign(Error('增量页数超过上限，扫描进度保留'),{code:'NUTSTORE_DELTA_INVALID'});
 }
 const run=work=>{
  const pending=tail.then(async()=>{
   if(!state){const saved=await checkpoint?.load();state=valid(saved)?structuredClone(saved):fresh('');}
   const reader={...io,list:async(path,kind='files')=>{if(!inside(path))throw Error('扫描缓存路径越界');const key=JSON.stringify([path,kind]);if(!Object.hasOwn(state.lists,key))state.lists[key]=await io.list(path,kind);return structuredClone(state.lists[key]);},getBytes:async(path,max)=>{if(!inside(path))throw Error('扫描缓存路径越界');if(!Object.hasOwn(state.values,path))state.values[path]=decoder.decode(await io.getBytes(path,max));const bytes=encoder.encode(state.values[path]);if(bytes.length>max)throw Error('历史元数据超出上限');return bytes;}};
   try{
    await refresh();
    for(let pass=0;pass<3;pass++){const value=await work(reader);if(!await refresh()){await save();return value;}}
    throw Object.assign(Error('扫描期间远端持续变化，已保留进度，未采用混合清单'),{code:'REMOTE_CHANGED_DURING_SYNC'});
   }catch(error){await save();throw error;}
  });tail=pending.catch(()=>{});return pending;
 };
 return {run,invalidate};
}
