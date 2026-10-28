// Only the bundled application may import this module. Downloaded plugin code
// must not run in this privileged WebView. There are deliberately no web fallbacks.
export function createNativeAdapters({platform,storagePlugin,vaultPlugin}={}){
 if(!['android','ios'].includes(platform))throw Object.assign(Error('需要 Android/iOS 原生宿主'),{code:'NATIVE_HOST_REQUIRED'});
 if(!storagePlugin||!vaultPlugin)throw Error('原生桥接尚未加载');
 return {
  storage:{
   read:key=>storagePlugin.read({key}),
   list:async()=>{const result=await storagePlugin.list();if(!Array.isArray(result.keys))throw Error('原生目录回执无效');return result.keys;},
   compareAndSwap:(key,expectedRevision,value)=>storagePlugin.compareAndSwap({key,expectedRevision,value})
  },
  secureVault:{
   get:async key=>{const result=await vaultPlugin.get({key});if(result.value!==null&&typeof result.value!=='string')throw Error('安全凭据回执无效');return result.value||'';},
   set:(key,value)=>vaultPlugin.set({key,value}),
   remove:key=>vaultPlugin.remove({key})
  }
 };
}
