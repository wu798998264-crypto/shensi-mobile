import {createMobileNotebookTransfer} from './nutstore-notebooks.mjs';
import {createCloudNotebookTransfer} from './cloud-notebook-transfer.mjs';
export {validateCloudNotebook} from '../core/src/notebook-snapshot.mjs';
export function createCloudNotebookSync({documents,storage,metadata,account,media}){
 const files=account.cloudFiles({journal:metadata});
 async function transfer(){const who=await account.status(),member=who.user?.id;if(!member)throw Error('请先登录');const target=createMobileNotebookTransfer({documents,storage,media}),notebooks={};for(const method of ['peek','export','import','apply'])notebooks[method]=async(...args)=>{if((await account.status()).user?.id!==member)throw Error('登录账号已变化，未修改原笔记本');return target[method](...args);};return createCloudNotebookTransfer({files:account.cloudFiles({journal:metadata,expectedMemberId:member}),notebooks,metadata,scope:(account.issuer||'official')+':'+member,media});}
 return {status:()=>files.status(),allocate:()=>files.allocate(),list:()=>files.listAll(),upload:async(...args)=>(await transfer()).upload(...args),download:async(file,onProgress)=>(await transfer()).download(file.id,onProgress),conflicts:async()=>(await transfer()).conflicts(),preview:async body=>(await transfer()).preview(body),resolve:async(body,onProgress)=>(await transfer()).resolve(body,onProgress)};
}
