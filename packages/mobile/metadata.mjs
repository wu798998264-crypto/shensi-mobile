// Separate native SQLite table: journal/plugin metadata must not look like notebooks.
export function createMobileMetadata({read,compareAndSwap}){
 const queues=new Map();
 const key=async value=>'meta-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
 async function get(name){const row=await read(await key(name));if(!row||!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('原生记录版本无效');if(row.value===null)return null;const saved=JSON.parse(row.value);if(saved.key!==name)throw Error('原生记录身份不符');return saved.value;}
 async function set(name,value){const id=await key(name);const run=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{const row=await read(id),encoded=JSON.stringify({key:name,value});const result=await compareAndSwap(id,row.revision,encoded);if(result.value!==encoded||result.revision!==row.revision+1)throw Error('原生记录保存回执不符');});queues.set(id,run);try{await run;}finally{if(queues.get(id)===run)queues.delete(id);}}
 return {get,set,remove:name=>set(name,null)};
}
