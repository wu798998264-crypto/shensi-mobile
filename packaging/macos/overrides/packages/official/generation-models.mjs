import {getProviderImageModelOptions,getProviderVideoModelOptions,getProviderAudioModelOptions,imageModelCapabilities,videoModelCapabilities} from './legacy/model-presets.js';
import {profileChannels,profileForChannel} from '../ui/model-capabilities.js';
import {failure} from './store.mjs';
import {currentGptModels} from '../ui/gpt-model-policy.js';
import {gptImageModelAllowed,isGptImageModel} from '../ui/gpt-image-options.js';
import {strictMediaCatalog} from '../ui/media-model-policy.js';
import {canvasModels,canonicalCanvasModel} from '../ui/dreamina-canvas-models.js';

const catalogs={image:getProviderImageModelOptions,video:getProviderVideoModelOptions,audio:getProviderAudioModelOptions};
export const isAntigravityImageProfile=p=>p?.channel==='image'&&p.adapter==='cli'&&/(?:^|[\\/])antigravity-image-cli\.mjs(?:["']|\s|$)/.test(String(p.cliArgs||''));
export function generationModelOptions(profile,channel=profile.channel){
 const settings=profileForChannel(profile,channel),catalog=catalogs[channel];if(!catalog)return [];
 if(isAntigravityImageProfile(settings))return [{slug:'nano-banana-2',label:'Nano Banana 2（反重力原生生图）',capabilities:{imageCounts:[1],aspectRatios:['1:1','16:9','9:16','4:3','3:4'],resolutions:[],outputResolutions:[],backgrounds:[],exact:true}}];
 if(settings.provider==='即梦'&&settings.adapter==='cli'&&settings.dreaminaCanvasMode==='canvas')return canvasModels(channel).filter(m=>!profile.modelCatalogModels||profile.modelCatalogModels.some(c=>c.id===m.slug&&c.available!==false&&c.selectable!==false)).map(m=>({...m,capabilities:{...m.capabilities,...(channel==='audio'?profile.modelCatalogModels?.find(c=>c.id===m.slug)?.audioCapabilities||{}:{})}}));
 if(settings.adapter==='browser')return settings.model?[{slug:settings.model,label:settings.model,capabilities:{}}]:[];
 const exact=channel==='image'&&profile.exactImageCatalog;
 const advertised=slug=>profile.modelCatalogModels?.some(item=>item.id===slug&&(item.channels?.includes(channel)||!item.channels?.length&&isGptImageModel(slug)));
 const options=profile.memberRef?[]:catalog(settings.provider,settings.adapter).filter(item=>item.available!==false&&item.selectable!==false&&(!exact||advertised(item.slug))&&(!strictMediaCatalog(settings)||!profile.modelCatalogModels||profile.modelCatalogModels.some(m=>m.id===item.slug&&m.channels?.includes(channel))));
 const unavailable=slug=>settings.provider==='即梦'&&settings.adapter==='cli'&&channel==='image'&&slug==='5.5'||!gptImageModelAllowed(profile,slug)||profile.modelCatalogModels?.some(item=>item.id===slug&&(item.available===false||item.selectable===false));
 for(const item of profile.memberRef?[]:profile.modelCatalogModels||[])if((item.channels?.includes(channel)||channel==='image'&&!item.channels?.length&&isGptImageModel(item.id))&&!unavailable(item.id)&&!options.some(option=>option.slug===item.id))options.push({slug:item.id,label:item.label});
 if(settings.model&&!exact&&!strictMediaCatalog(settings)&&!unavailable(settings.model)&&!options.some(item=>item.slug===settings.model))options.unshift({slug:settings.model,label:settings.model});
 return currentGptModels(options.filter(item=>!unavailable(item.slug))).map(item=>({slug:item.slug,label:String(item.label||item.slug).replace(/\s*[（(](?:即梦|Dreamina)\s+CLI[）)]\s*$/iu,''),capabilities:channel==='image'?{...imageModelCapabilities(settings.provider,item.slug),...(settings.provider==='LibTV'?profile.modelCatalogModels?.find(m=>m.id===item.slug)?.imageCapabilities||{}:{})}:channel==='video'?{...videoModelCapabilities(settings.provider,item.slug),...(settings.provider==='LibTV'?profile.modelCatalogModels?.find(m=>m.id===item.slug)?.videoCapabilities||{}:{})}:{}}));
}
export function publicGenerationModels(profile){return Object.fromEntries(profileChannels(profile).filter(channel=>catalogs[channel]).map(channel=>[channel,generationModelOptions(profile,channel)]));}
export function selectGenerationModel(profile,channel,requested){
 const settings=profileForChannel(profile,channel),raw=String(requested||settings.model||'').trim(),model=settings.dreaminaCanvasMode==='canvas'?canonicalCanvasModel(raw):raw;
 if(!generationModelOptions(profile,channel).some(item=>item.slug===model))throw failure('所选模型不属于当前连接的可用模型，请重新选择','MODEL_NOT_AVAILABLE');
 // Only the per-task model changes. Connection, endpoint and credential identity
 // remain authoritative machine settings; member-issued models stay fixed.
 const {modelCatalogModels,exactImageCatalog,...selectedSettings}=settings;
 const libTvVideoCapabilities=settings.provider==='LibTV'&&channel==='video'?modelCatalogModels?.find(item=>item.id===model)?.videoCapabilities:null;
 return {...selectedSettings,model,...(libTvVideoCapabilities?{libTvVideoCapabilities}:{}),...(settings.dreaminaCanvasMode==='canvas'&&channel==='video'?{canvasVideoCapabilities:canvasModels('video').find(m=>m.slug===model)?.capabilities}:{})};
}
