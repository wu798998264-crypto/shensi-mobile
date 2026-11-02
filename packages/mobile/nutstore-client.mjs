import {createMobileNutstoreJournal} from './nutstore-journal.mjs';
import {createMobileNotebookTransfer,createNutstoreNotebookTransfer} from './nutstore-notebooks.mjs';
import {nutstoreRetryAfter,createNutstoreRequestGate} from '../core/src/nutstore-request-gate.mjs';
const KEY='shensi.mobile.nutstore.v1',BASE='https://dav.jianguoyun.com/dav/';
export function createMobileNutstoreClient({secureVault,fetchImpl=fetch,documents,storage,metadata,notebooks,media,requestGateOptions}={}){
 // Native Android/preview transports are custom fetch adapters too. They must
 // share the same persistent account budget as connection probes and sync.
 const gates=new Map();
 const requestFor=account=>{if(!gates.has(account)){const key='nutstore-request-budget:'+account;gates.set(account,createNutstoreRequestGate(async(url,options)=>{const {assertBeforeDispatch,...request}=options;await assertBeforeDispatch?.();return fetchImpl(url,request);},{...requestGateOptions,scope:BASE+account,...metadata?{checkpoint:{load:()=>metadata.get(key),save:value=>metadata.set(key,value)}}:{}}));}return gates.get(account);};
 const config=async()=>{const raw=await secureVault.get(KEY);return raw?JSON.parse(raw):null;};
 const ready=!!metadata&&!!(notebooks||documents&&storage);let active=false,operation=null;const listeners=new Set();
 const emit=patch=>{operation={...operation,...patch};for(const listener of listeners)try{listener(structuredClone(operation));}catch{}};
 const cooldownKey=account=>'nutstore-cooldown:'+account;
 const cooled=async account=>{const until=Number(await metadata?.get(cooldownKey(account)))||0;if(until>Date.now())throw Object.assign(Error('坚果云暂时繁忙，请在 '+new Date(until).toLocaleTimeString()+' 后重试；没有重复发送'),{code:'RETRY_WAIT',retryAfterMs:until-Date.now()});};
 const transfer=async(fn,kind)=>{if(!ready)throw Error('本机笔记本同步存储尚未加载，请更新应用');if(active)throw Error('正在传输，请等待当前操作完成');active=true;let identityAccount;if(kind){operation=null;emit({kind,status:'running',startedAt:new Date().toISOString()});}try{
  const c=await config();if(!c)throw Error('请先连接坚果云');
  identityAccount=c.account;await cooled(identityAccount);
  const assertIdentity=async()=>{const current=await config();if(current?.account!==c.account||current?.password!==c.password)throw Error('坚果云账号已变化，已停止传输；原资料保留');};
  const identity='mobile-nutstore-device',deviceId=await metadata.get(identity)||crypto.randomUUID();await metadata.set(identity,deviceId);
  const scope=c.account+':神思双端笔记快照',scanKey='nutstore-journal-index:'+scope;
  const repository=createMobileNutstoreJournal({...c,remoteRoot:'神思双端笔记快照',deviceId,checkpoint:{load:()=>metadata.get(scanKey),save:value=>metadata.set(scanKey,value)},fetchImpl:async(url,options)=>{await assertIdentity();return requestFor(c.account)(url,{...options,assertBeforeDispatch:assertIdentity});}}),target=notebooks||createMobileNotebookTransfer({documents,storage,media});
  const scopedMedia=media&&{
   source:async(...args)=>{await assertIdentity();return media.source(...args);},
   sink:receipt=>{const sink=media.sink(receipt);return Object.fromEntries(['begin','write','finish','abort'].map(method=>[method,async(...args)=>{if(method!=='abort')await assertIdentity();return sink[method](...args);}]));}
  };
  const bound=Object.fromEntries(['export','import','peek','apply'].map(method=>[method,async(...args)=>{await assertIdentity();return target[method](...args);} ]));const result=await fn(createNutstoreNotebookTransfer({repository,notebooks:bound,metadata,scope,media:scopedMedia}));if(kind)emit({status:'completed',finishedAt:new Date().toISOString()});return result;
 }catch(error){if(error.code==='RETRY_WAIT'&&identityAccount)await metadata.set(cooldownKey(identityAccount),Date.now()+Math.max(60000,error.retryAfterMs||0));if(kind)emit({status:error.code==='REMOTE_CHANGED_DURING_SYNC'?'conflict':'failed',error:error.message,code:error.code||'NUTSTORE_TRANSFER_FAILED',finishedAt:new Date().toISOString()});throw error;}finally{active=false;}};
 async function request(c,method,path='',body,extra={}){
  await cooled(c.account);
  const credentials=btoa(String.fromCharCode(...new TextEncoder().encode(c.account+':'+c.password)));
  const res=await requestFor(c.account)(BASE+path,{method,headers:{Authorization:'Basic '+credentials,...extra},body,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)}).catch(async error=>{if(error.code==='RETRY_WAIT')await metadata?.set(cooldownKey(c.account),Date.now()+Math.max(60000,error.retryAfterMs||0));throw error;});
  if(res.status>=300&&res.status<400||res.status===401){await res.body?.cancel().catch(()=>{});throw Error(res.status===401?'坚果云账号或应用密码不正确':'坚果云重定向已拒绝');}
  if([429,503].includes(res.status)){const retryAfterMs=nutstoreRetryAfter(res.headers.get('retry-after'));await res.body?.cancel().catch(()=>{});await metadata?.set(cooldownKey(c.account),Date.now()+retryAfterMs);throw Object.assign(Error('坚果云暂时繁忙，请等待冷却后重试；登录配置仍保留'),{code:'RETRY_WAIT',retryAfterMs});}
  return res;
 }
 async function verify(c){const res=await request(c,'PROPFIND','', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',{'Depth':'0','Content-Type':'application/xml'});await res.body?.cancel().catch(()=>{});if(res.status!==207)throw Error('坚果云连接失败（HTTP '+res.status+'）');return {account:c.account,connected:true,checkedAt:new Date().toISOString(),automaticSyncAvailable:false};}
 async function mutation(c,method,path,body,headers){const res=await request(c,method,path,body,headers);await res.body?.cancel().catch(()=>{});return res;}
 return {
  subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  operation:()=>operation&&structuredClone(operation),
  async status(){const c=await config();return {configured:!!c,account:c?.account||'',automaticSyncAvailable:false,notebookTransferAvailable:ready,remoteRoot:'神思双端笔记快照'};},
  listNotebooks:()=>transfer(t=>t.list()),
  uploadNotebook:(id,onProgress)=>transfer(t=>t.upload(id,onProgress),'upload'),
  downloadNotebook:(entry,onProgress)=>transfer(t=>t.download(entry,onProgress),'download'),
  conflicts:()=>transfer(t=>t.conflicts()),
  previewConflict:request=>transfer(t=>t.preview(request)),
  resolveConflict:(request,onProgress)=>transfer(t=>t.resolve(request,onProgress),'resolve'),
  async connect({account,password}){if(active)throw Error('传输期间不能更换坚果云账号');if(typeof account!=='string'||!account.trim()||typeof password!=='string'||!password||account.includes(':')||account.length>256||password.length>512)throw Error('请填写坚果云账号和应用密码');const c={account:account.trim(),password},r=await verify(c);await secureVault.set(KEY,JSON.stringify(c));return {...r,notebookTransferAvailable:ready};},
  async probe(){const c=await config();if(!c)throw Error('请先连接坚果云');return verify(c);},
  async roundTripProbe(){const c=await config();if(!c)throw Error('请先连接坚果云');await verify(c);const root='shensi-mobile-connection-check/',folder=await mutation(c,'MKCOL',root);if(![201,405].includes(folder.status))throw Error('测试目录不可创建');const id=crypto.randomUUID(),payload=JSON.stringify({kind:'shensi-connection-check',id,personalData:false}),path=root+id+'.json';let written=false;try{const put=await mutation(c,'PUT',path,payload,{'If-None-Match':'*','Content-Type':'application/json'});if(![200,201,204].includes(put.status))throw Error('写入测试失败（HTTP '+put.status+'）');written=true;const get=await request(c,'GET',path);if(!get.ok){await get.body?.cancel().catch(()=>{});throw Error('坚果云回读失败（HTTP '+get.status+'）');}if(await get.text()!==payload)throw Error('坚果云回读不一致');return {writeReadVerified:true,personalLibrarySynced:false};}finally{if(written){const removed=await mutation(c,'DELETE',path);if(![200,204,404].includes(removed.status))throw Error('回读结束，但测试文件清理失败，请检查 '+path);}}},
  async disconnect(){if(active)throw Error('请等待当前传输结束后断开');await secureVault.remove(KEY);return {configured:false,notebookTransferAvailable:ready};}
 };
}
