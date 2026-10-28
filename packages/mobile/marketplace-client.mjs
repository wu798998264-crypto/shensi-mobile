import {ACCOUNT_ISSUER} from './account-client.mjs';
const fields=['pluginId','version','name','description','author','packageFormat','permissions','repository','downloadUrl','sha256','sizeBytes','publishedAt'];
const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function verifyMobileArtifact(item,pem,platform){
 if(!/^[a-z][a-z0-9.-]{2,79}$/.test(item.pluginId)||!/^\d+\.\d+\.\d+$/.test(item.version)||!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(item.repository)||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<1||item.sizeBytes>2*1024*1024)throw Error('插件制品身份无效');
 if(item.packageFormat!=='shensi-template-plugin-v1'||!Array.isArray(item.permissions)||item.permissions.length||!Array.isArray(item.platforms)||!item.platforms.includes(platform)||item.platforms.some(p=>!['android','ios','desktop'].includes(p)))throw Error('此插件不能在手机上运行');
 if(item.downloadUrl!=='https://github.com/'+item.repository+'/releases/download/plugin-'+item.pluginId+'-v'+item.version+'/'+item.pluginId+'-'+item.version+'.plugin.json')throw Error('插件下载地址与审核版本不一致');
 if(item.signature?.algorithm!=='Ed25519')throw Error('插件未携带有效审核签名');
 const key=await crypto.subtle.importKey('spki',bytes(pem.replace(/-----[^-]+-----|\s/g,'')),{name:'Ed25519'},false,['verify']);
 const payload=new TextEncoder().encode(JSON.stringify(Object.fromEntries([...fields,'platforms'].map(k=>[k,item[k]]))));
 if(!await crypto.subtle.verify('Ed25519',key,bytes(item.signature.value),payload))throw Error('插件签名不匹配，未安装');return item;
}
export function createMobileMarketplaceClient({fetchImpl=fetch,secureVault,platform}={}){
 if(!['android','ios'].includes(platform))throw Error('需要明确手机平台');
 async function request(path){const response=await fetchImpl(ACCOUNT_ISSUER+path,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('插件广场连接失败（HTTP '+response.status+'）');const reader=response.body.getReader(),parts=[];let size=0;for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>4*1024*1024){await reader.cancel();throw Error('目录响应过大');}parts.push(p.value);}const all=new Uint8Array(size);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}return JSON.parse(new TextDecoder().decode(all));}
 return {async catalog(){const c=await request('/v1/plugins/config');if(c.mode!=='plugin-marketplace'||!String(c.publicKeyPem).includes('PUBLIC KEY'))throw Error('广场配置不完整');const key='shensi.mobile.marketplace.trust',old=await secureVault.get(key);if(old&&old!==c.publicKeyPem)throw Error('广场签名公钥变化，需要管理员核对');const result=await request('/v1/plugins/catalog?platform='+platform+'&limit=100');if(result.platform!==platform||!Array.isArray(result.items)||result.items.length>100||!Number.isSafeInteger(result.total))throw Error('广场未返回正确手机分区');for(const item of result.items)await verifyMobileArtifact(item,c.publicKeyPem,platform);if(!old)await secureVault.set(key,c.publicKeyPem);return {...result,publishReady:c.publishReady===true};}};
}
