// Explicit, device-local consent, scoped to the current account. No timers or
// credentials in this module; the foreground UI supplies the safe idle tick.
export function createNotebookAutoSync({metadata,identity,listLocal,syncNotebook,now=Date.now}) {
 let active=null,closed=false,guard=()=>true,epoch=0,mutating=Promise.resolve();
 const key=id=>'notebook-auto-sync:v1:'+id;
 const load=async id=>await metadata.get(key(id))||{enabled:false,books:{}};
 const update=(id,change)=>{const task=mutating.then(async()=>metadata.set(key(id),change(await load(id))));mutating=task.catch(()=>{});return task;};
 const stopped=()=>Object.assign(Error('自动同步已暂停，原资料保留'),{code:'AUTO_SYNC_PAUSED'});
 async function status(){const id=await identity();if(!id)return {enabled:false,available:false};return {...await load(id),available:true,running:!!active};}
 async function configure(enabled){if(typeof enabled!=='boolean')throw Error('自动同步开关无效');epoch++;const id=await identity();if(!id)throw Error('请先连接账号');await update(id,value=>({...value,enabled,books:enabled?{}:value.books,updatedAt:now()}));return status();}
 async function tick(){
  if(closed||active)return {skipped:true};
  // Install the lock before the first identity/vault await.
  const token={epoch};active=token;
  try {
   if(!await guard())return {skipped:true};
   const id=await identity();if(!id)return {skipped:true};let state=await load(id);
   if(!state.enabled)return {skipped:true};
   const assertSafe=async()=>{if(closed||token.epoch!==epoch||!await guard()||await identity()!==id||!(await load(id)).enabled)throw stopped();};
   const results=[];
   // Whole-notebook deletion is not inferred from absence. Only notebooks
   // already present on this device participate; first downloads are explicit.
   for(const book of await listLocal()){
    if(book.deleted)continue;await assertSafe();
    const prior=state.books?.[book.id];if(prior?.retryAt>now()){results.push({...prior,id:book.id,deferred:true});continue;}
    let item;
    try{const result=await syncNotebook(book.id,assertSafe);item={id:book.id,status:result?.pending?'conflict':'completed',result,failures:0,retryAt:now()+60000};}
    catch(error){if(error.code==='AUTO_SYNC_PAUSED')break;const failures=(prior?.failures||0)+1;item={id:book.id,status:'failed',error:error.message,code:error.code||'AUTO_SYNC_FAILED',failures,retryAt:now()+Math.max(Number(error.retryAfterMs)||0,Math.min(1800000,60000*2**Math.min(failures-1,5)))};}
    results.push(item);await update(id,value=>({...value,books:{...value.books,[book.id]:item},lastRun:now()}));state=await load(id);
   }
   return {results};
  }finally{if(active===token)active=null;}
 }
 return {status,configure,tick,setGuard:fn=>{guard=fn||(()=>true);},close:()=>{closed=true;}};
}
