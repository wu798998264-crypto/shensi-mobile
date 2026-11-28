import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {detectKnownAgentRunnerInstallation} from './legacy/server/antigravity-probe.mjs';
import {nodeRuntimeExecutable} from './legacy/server/node-runtime.mjs';
import {isAntigravityImageProfile} from './generation-models.mjs';

export async function antigravityCardVerification({models,dataRoot,profileId}){
 const profile=(await models.list()).profiles.find(p=>p.id===profileId&&isAntigravityImageProfile(p));
 if(!profile)throw Error('未找到反重力生图配置');
 const read=path=>readFile(path,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return null;throw e;});
 const ledger=await read(join(dataRoot,'plugins','media-targets.json'));
 for(const item of Object.values(ledger||{}).reverse()){
  if(item.profileId!==profileId||!item.nodeId||!/^generation-[a-z0-9-]+$/i.test(item.jobId||''))continue;
  const job=await read(join(dataRoot,'generation-jobs',item.jobId+'.json'));
  if(job?.status==='complete'&&job.appliedAt&&job.providerTaskId&&job.result?.attachments?.length&&job.request?.settings?.connectionId===profile.id&&job.request.settings.model===profile.model&&Date.parse(job.createdAt)>=Date.parse(profile.updatedAt))return {verified:true,at:job.appliedAt};
 }
 return {verified:false};
}

export async function setupAntigravityImage({models,dataRoot,expectedRevision,probe=detectKnownAgentRunnerInstallation}){
 const catalog=await models.list();
 const existing=catalog.profiles.find(isAntigravityImageProfile);
 if(existing)return {profileId:existing.id,existing:true};
 if(catalog.revision!==expectedRevision)throw Error('模型配置已变化，请刷新后再试');
 const detection=await probe();
 if(!detection.ready)throw Error(detection.message);
 const script=fileURLToPath(new URL('./antigravity-image-cli.mjs',import.meta.url));
 const profile={name:'反重力生图 · Nano Banana 2',channel:'image',provider:'自定义兼容接口',adapter:'cli',cliPath:nodeRuntimeExecutable(),
  cliArgs:'"'+script+'" --prompt-file {promptFile} --reference-images-file {referenceImagesFile} --model {model} --aspect-ratio {aspectRatio} --count {imageCount} --output {outputFile} --idempotency-key {idempotencyKey} --jobs-root "'+join(dataRoot,'antigravity-image-jobs')+'"',
  model:'nano-banana-2',authorizationSource:'cli',enabled:true,timeoutMs:600000,aspectRatio:'16:9'};
 const saved=await models.save({profile,expectedRevision});
 return {profileId:saved.profiles.find(isAntigravityImageProfile).id,existing:false};
}
