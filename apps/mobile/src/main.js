import {Capacitor,CapacitorHttp,registerPlugin,SystemBars} from '@capacitor/core';
import {createCustomApiClient} from '../../../packages/mobile/custom-api.mjs';
import {createNativeAdapters} from '../../../packages/mobile/native-adapters.mjs';
import {createMobileDocumentStore} from '../../../packages/mobile/document-store.mjs';
import {createMobileAccountClient} from '../../../packages/mobile/account-client.mjs';
import {mountFoundation} from './workspace.js';
import {nativeFetchAdapter,nativeArtifactFetch} from '../../../packages/mobile/network.mjs';
import {createMobileMetadata} from '../../../packages/mobile/metadata.mjs';
import {createCloudNotebookSync} from '../../../packages/mobile/cloud-notebooks.mjs';
import {createMobileNutstoreClient} from '../../../packages/mobile/nutstore-client.mjs';
import {createMobileMarketplaceClient} from '../../../packages/mobile/marketplace-client.mjs';
import {createMobileMediaImporter} from './media-import.js';

const root=document.querySelector('#app');
try {
 const adapters=createNativeAdapters({platform:Capacitor.getPlatform(),storagePlugin:registerPlugin('ShensiStorage'),vaultPlugin:registerPlugin('ShensiSecureVault')});
 // Construct only. This entry never logs in or queries production automatically.
 const fetchImpl=nativeFetchAdapter(CapacitorHttp,registerPlugin('ShensiCloudTransport'));
 const account=createMobileAccountClient({secureVault:adapters.secureVault,fetchImpl});
 const nativeMeta=registerPlugin('ShensiMetadata'),metadata=createMobileMetadata({read:key=>nativeMeta.read({key}),compareAndSwap:(key,expectedRevision,value)=>nativeMeta.compareAndSwap({key,expectedRevision,value})}),documents=createMobileDocumentStore(adapters);
 const media=createMobileMediaImporter({transport:registerPlugin('ShensiMedia'),convertUrl:url=>Capacitor.convertFileSrc(url)});
 const customTransport=registerPlugin('ShensiCustomApi'),systemAppearance=async value=>{try{await SystemBars.setStyle({style:value==='深色'?'DARK':value==='浅色'?'LIGHT':'DEFAULT'});}catch{/* System-bar styling must not prevent opening the local library. */}};
 await systemAppearance(await metadata.get('mobile-appearance')||'跟随系统');
 await mountFoundation(root,{documents,media,metadata,customApi:createCustomApiClient({secureVault:adapters.secureVault,transport:input=>customTransport.request(input)}),systemAppearance,account,cloud:createCloudNotebookSync({documents,storage:adapters.storage,metadata,account,media}),nutstore:createMobileNutstoreClient({secureVault:adapters.secureVault,fetchImpl,documents,storage:adapters.storage,metadata,media}),marketplace:createMobileMarketplaceClient({fetchImpl,artifactFetch:nativeArtifactFetch(registerPlugin('ShensiCloudTransport')),metadata,secureVault:adapters.secureVault,platform:'android'})});
} catch(error) {
 root.replaceChildren();const h=document.createElement('h1');h.textContent='神思笔记';
 const p=document.createElement('p');p.textContent=error.code==='NATIVE_HOST_REQUIRED'?'这是 Android 原生入口，请在安装包中打开。浏览器不会降级保存账号或正式资料。':'原生资料库无法打开，未创建替代目录或覆盖原资料。';
 const small=document.createElement('small');small.textContent='完整版交互预览仍保留在原预览页面。';root.append(h,p,small);
}
