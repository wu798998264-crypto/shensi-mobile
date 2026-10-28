// Connection and isolated round-trip probe only. Personal-library sync is not
// enabled until the shared desktop manifest/conflict protocol is available.
const KEY='shensi.mobile.nutstore.v1',BASE='https://dav.jianguoyun.com/dav/';
export function createMobileNutstoreClient({secureVault,fetchImpl=fetch}={}){
 const config=async()=>{const raw=await secureVault.get(KEY);return raw?JSON.parse(raw):null;};
 async function request(c,method,path='',body,extra={}){
  const credentials=btoa(String.fromCharCode(...new TextEncoder().encode(c.account+':'+c.password)));
  const res=await fetchImpl(BASE+path,{method,headers:{Authorization:'Basic '+credentials,...extra},body,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(res.status>=300&&res.status<400)throw Error('坚果云重定向已拒绝');
  if(res.status===401)throw Error('坚果云账号或应用密码不正确');
  return res;
 }
 async function verify(c){const res=await request(c,'PROPFIND','', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',{'Depth':'0','Content-Type':'application/xml'});if(res.status!==207)throw Error('坚果云连接失败（HTTP '+res.status+'）');return {account:c.account,connected:true,checkedAt:new Date().toISOString(),automaticSyncAvailable:false};}
 return {
  async status(){const c=await config();return {configured:!!c,account:c?.account||'',automaticSyncAvailable:false};},
  async connect({account,password}){if(typeof account!=='string'||!account.trim()||typeof password!=='string'||!password||account.includes(':')||account.length>256||password.length>512)throw Error('请填写坚果云账号和应用密码');const c={account:account.trim(),password},r=await verify(c);await secureVault.set(KEY,JSON.stringify(c));return r;},
  async probe(){const c=await config();if(!c)throw Error('请先连接坚果云');return verify(c);},
  async roundTripProbe(){const c=await config();if(!c)throw Error('请先连接坚果云');await verify(c);const root='shensi-mobile-connection-check/',folder=await request(c,'MKCOL',root);if(![201,405].includes(folder.status))throw Error('测试目录不可创建');const id=crypto.randomUUID(),payload=JSON.stringify({kind:'shensi-connection-check',id,personalData:false}),path=root+id+'.json';let written=false;try{const put=await request(c,'PUT',path,payload,{'If-None-Match':'*','Content-Type':'application/json'});if(![200,201,204].includes(put.status))throw Error('写入测试失败（HTTP '+put.status+'）');written=true;const get=await request(c,'GET',path);if(!get.ok||await get.text()!==payload)throw Error('坚果云回读不一致');return {writeReadVerified:true,personalLibrarySynced:false};}finally{if(written){const removed=await request(c,'DELETE',path);if(![200,204,404].includes(removed.status))throw Error('回读结束，但测试文件清理失败，请检查 '+path);}}},
  async disconnect(){await secureVault.remove(KEY);return {configured:false};}
 };
}
