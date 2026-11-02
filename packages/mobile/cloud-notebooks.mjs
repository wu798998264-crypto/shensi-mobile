import {createMobileNotebookTransfer} from './nutstore-notebooks.mjs';
import {createCloudNotebookTransfer} from './cloud-notebook-transfer.mjs';
import {createNotebookAutoSync} from './notebook-auto-sync.mjs';
export {validateCloudNotebook} from '../core/src/notebook-snapshot.mjs';
export function createCloudNotebookSync({documents,storage,metadata,account,media,notebooks:target=createMobileNotebookTransfer({documents,storage,media}),listLocal=()=>documents.list()}){
 const files=account.cloudFiles({journal:metadata});
 let active=false,closed=false;
 async function transfer(fn,guard=async()=>{}){if(closed||active)throw Error('云端传输正在执行或已关闭');active=true;try{await guard();const who=await account.status(),member=who.authenticated===false?null:who.user?.id;if(!member)throw Error('请先登录');const notebooks={};for(const method of ['peek','export','import','apply'])notebooks[method]=async(...args)=>{await guard();if((await account.status()).user?.id!==member)throw Error('登录账号已变化，未修改原笔记本');return target[method](...args);};return await fn(createCloudNotebookTransfer({files:account.cloudFiles({journal:metadata,expectedMemberId:member}),notebooks,metadata,scope:(account.issuer||'official')+':'+member,media}));}finally{active=false;}}
 const auto=createNotebookAutoSync({metadata,identity:async()=>{const who=await account.status();return who.authenticated!==false&&who.user?.id?(account.issuer||'official')+':'+who.user.id:null;},listLocal,syncNotebook:(id,guard)=>transfer(t=>t.sync(id),guard)});
 return {autoStatus:auto.status,setAutomaticSync:auto.configure,autoTick:auto.tick,setAutoGuard:auto.setGuard,close:()=>{closed=true;auto.close();},status:()=>files.status(),allocate:()=>files.allocate(),list:()=>files.listAll(),upload:(...args)=>transfer(t=>t.upload(...args)),download:(file,onProgress)=>transfer(t=>t.download(typeof file==='string'?file:file.id,onProgress)),conflicts:()=>transfer(t=>t.conflicts()),preview:body=>transfer(t=>t.preview(body)),resolve:(body,onProgress)=>transfer(t=>t.resolve(body,onProgress))};
}
