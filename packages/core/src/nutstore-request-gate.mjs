// Shared by real transports, not by model providers. The gate spaces request
// starts and remembers a server cooldown; it never replays a write request.
const shared=new WeakMap();
export function nutstoreRetryAfter(value,now=Date.now()){
 const ms=/^\d+$/.test(value||'')?Number(value)*1000:Date.parse(value||'')-now;
 // Without Retry-After, do not hammer an account-wide 30-minute limit.
 return Math.min(8640000000000000-now,Math.max(60000,Number.isFinite(ms)&&ms>0?ms:1800000));
}
export function createNutstoreRequestGate(fetchImpl,{intervalMs=200,maxRequests=500,windowMs=1800000,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),checkpoint,scope}={}){
 if(checkpoint&&(!scope||!checkpoint.load||!checkpoint.save))throw Error('持久请求预算缺少连接身份或存储');
 let tail=Promise.resolve(),next=0,blockedUntil=0,loaded=false;const starts=[];
 const persist=()=>checkpoint?.save({version:1,scope,next,blockedUntil,starts:[...starts]});
 // Nutstore documents 600 requests/30min for free accounts. Keep 100 spare;
 // this process cannot account for Obsidian or another device's requests.
 const cooling=()=>Object.assign(Error('坚果云请求已进入等待，请在 '+new Date(blockedUntil).toLocaleTimeString()+' 后重试；当前任务未重新发送'),{code:'RETRY_WAIT',retryAfterMs:blockedUntil-now(),retryAt:new Date(blockedUntil).toISOString()});
 return (url,options={})=>{
  const pending=tail.then(async()=>{
   options.signal?.throwIfAborted();
   if(!loaded){const saved=await checkpoint?.load();if(saved&&saved.scope===scope){if(saved.version!==1||!Number.isFinite(saved.next)||!Number.isFinite(saved.blockedUntil)||!Array.isArray(saved.starts)||saved.starts.some((n,i)=>!Number.isFinite(n)||n<0||i&&n<saved.starts[i-1]))throw Object.assign(Error('同步请求预算损坏，未重置或发送请求'),{code:'NUTSTORE_REQUEST_BUDGET_INVALID'});next=saved.next;blockedUntil=saved.blockedUntil;starts.push(...saved.starts);}loaded=true;}
   if(blockedUntil>now())throw cooling();
   while(starts.length&&starts[0]<=now()-windowMs)starts.shift();
   if(starts.length>=maxRequests){blockedUntil=starts[0]+windowMs;await persist();throw cooling();}
   if(next>now())await wait(next-now());options.signal?.throwIfAborted();next=now()+intervalMs;
   // Persist before dispatch: an interrupted/unknown request still consumes
   // the local budget after restart, and is never silently replayed here.
   starts.push(now());await persist();
   const response=await fetchImpl(url,options);if([429,503].includes(response.status)){blockedUntil=now()+nutstoreRetryAfter(response.headers.get('retry-after'),now());try{await persist();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}}return response;
  });tail=pending.then(()=>{},()=>{});return pending;
 };
}
export function pacedNutstoreFetch(fetchImpl){if(!shared.has(fetchImpl))shared.set(fetchImpl,createNutstoreRequestGate(fetchImpl));return shared.get(fetchImpl);}
