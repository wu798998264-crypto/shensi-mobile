import {Capacitor,CapacitorHttp,registerPlugin} from '@capacitor/core';
import {createNativeAdapters} from '../../../packages/mobile/native-adapters.mjs';
import {createMobileDocumentStore} from '../../../packages/mobile/document-store.mjs';
import {createMobileAccountClient} from '../../../packages/mobile/account-client.mjs';
import {mountFoundation} from './workspace.js';
import {nativeFetchAdapter} from '../../../packages/mobile/network.mjs';
import {createMobileNutstoreClient} from '../../../packages/mobile/nutstore-client.mjs';
import {createMobileMarketplaceClient} from '../../../packages/mobile/marketplace-client.mjs';

const root=document.querySelector('#app');
try {
 const adapters=createNativeAdapters({platform:Capacitor.getPlatform(),storagePlugin:registerPlugin('ShensiStorage'),vaultPlugin:registerPlugin('ShensiSecureVault')});
 // Construct only. This entry never logs in or queries production automatically.
 const fetchImpl=nativeFetchAdapter(CapacitorHttp);
 const account=createMobileAccountClient({secureVault:adapters.secureVault,fetchImpl});
 await mountFoundation(root,{documents:createMobileDocumentStore(adapters),account,nutstore:createMobileNutstoreClient({secureVault:adapters.secureVault,fetchImpl}),marketplace:createMobileMarketplaceClient({fetchImpl,secureVault:adapters.secureVault,platform:'android'})});
} catch(error) {
 root.replaceChildren();const h=document.createElement('h1');h.textContent='神思笔记';
 const p=document.createElement('p');p.textContent=error.code==='NATIVE_HOST_REQUIRED'?'这是 Android 原生入口，请在安装包中打开。浏览器不会降级保存账号或正式资料。':'原生资料库无法打开，未创建替代目录或覆盖原资料。';
 const small=document.createElement('small');small.textContent='完整版交互预览仍保留在原预览页面。';root.append(h,p,small);
}
