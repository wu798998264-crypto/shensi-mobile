import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL as packageFileUrl} from 'node:url';
import {resolve as packageResolve} from 'node:path';
const packageRoot=packageResolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.');
const {checkNotesUpdate,compareNotesVersions,NOTES_UPDATE_REPOSITORY:repository}=await import(packageFileUrl(packageResolve(packageRoot,'packages/core/src/update-service.mjs')));
const evidence={checks:[],realDownload:false,installedUpgrade:false},check=async(name,fn)=>{await fn();evidence.checks.push({name,status:'离线通过'});console.log('PASS '+name);};
const root='https://github.com/'+repository+'/releases/download/v0.3.0/',latest='https://github.com/'+repository+'/releases/latest/download/shensi-notes-update.json',manifest={appId:'shensi-notes',version:'0.3.0',downloads:[{platform:'win32',arch:'x64',url:root+'ShensiNotes.exe',sha256:'a'.repeat(64),sizeBytes:100}]};
let mode='',value=manifest,seen=[];
const fetchImpl=async(input,options)=>{const url=String(input);seen.push(url);assert.equal(options.headers.Authorization,undefined);assert(!url.startsWith('https://api.github.com/'),'No anonymous REST dependency');if(mode==='network')throw Error('synthetic outage');if(mode==='missing')return new Response(null,{status:404});if(url===latest&&mode!=='unbound'){const location=mode==='redirect'?'https://untrusted.example/manifest':mode==='wrong-repo'?root.replace(repository,'other/repo')+'shensi-notes-update.json':mode==='prerelease'?root.replace('v0.3.0','v0.3.0-preview.1')+'shensi-notes-update.json':mode==='bare-cdn'?'https://release-assets.githubusercontent.com/manifest':root+'shensi-notes-update.json';return new Response(null,{status:302,headers:{location}});}if(mode==='loop')return new Response(null,{status:302,headers:{location:url}});if(mode==='cdn'&&url===root+'shensi-notes-update.json')return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/manifest?signed=fixture'}});return new Response(mode==='oversized'?'x'.repeat(131073):JSON.stringify(value));};
const run=()=>checkNotesUpdate({currentVersion:'0.2.0-preview.1',platform:'win32',arch:'x64',fetchImpl});
try{
 await check('默认使用官方最新清单直链，不调用匿名REST；缺少清单不误报最新版本',async()=>{mode='missing';assert.equal((await run()).status,'unavailable');assert.equal(seen[0],latest);mode='';});
 await check('发布版本及安装包绑定官方 GitHub、平台、哈希与大小，预发布版本比较正确',async()=>{const result=await run();assert.equal(result.status,'available');assert.equal(result.download.url,manifest.downloads[0].url);assert(compareNotesVersions('0.2.0','0.2.0-preview.1')>0);assert(compareNotesVersions('0.2.0-preview.10','0.2.0-preview.2')>0);assert(compareNotesVersions('0.2.0-preview.1','0.2.0')<0);});
 await check('错误软件身份、版本、下载来源、重复平台和缺失安装包均阻止误报',async()=>{for(const patch of [{appId:'other'},{version:'0.4.0'},{downloads:[{...manifest.downloads[0],url:'https://evil.example/app.exe'}]},{downloads:[manifest.downloads[0],manifest.downloads[0]]}]){value={...manifest,...patch};assert.equal((await run()).status,'error');}value={...manifest,downloads:[]};assert.equal((await run()).status,'unavailable');value=manifest;});
 await check('断网、超大清单、外域/异仓库/预发布跳转、未绑定版本和循环均拒绝',async()=>{for(const test of ['network','oversized','redirect','wrong-repo','prerelease','unbound','bare-cdn','loop']){mode=test;seen=[];assert.equal((await run()).status,'error',test);assert(!seen.some(url=>url.startsWith('https://untrusted')||url.includes('other/repo')));}mode='';});
 await check('固定版本到GitHub CDN跳转可用，清单与版本及安装包身份一致',async()=>{mode='cdn';assert.equal((await run()).status,'available');mode='';});
 await check('403/429返回具体等待时间；普通403不冒充限流',async()=>{const clock=1700000000000;for(const status of [403,429]){const r=await checkNotesUpdate({now:()=>clock,fetchImpl:async()=>new Response(null,{status,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String((clock+120000)/1000),'retry-after':'180'}})});assert.equal(r.code,'UPDATE_RATE_LIMITED');assert.equal(r.retryAt,new Date(clock+180000).toISOString());}const denied=await checkNotesUpdate({fetchImpl:async()=>new Response(null,{status:403})});assert.equal(denied.status,'error');assert(!denied.retryAt&&!denied.code);});
 await check('自定义 HTTPS 更新源保留；相同版本通过，非本机 HTTP 拒绝',async()=>{assert.equal((await checkNotesUpdate({currentVersion:'0.3.0',feed:'https://updates.example/manifest',fetchImpl})).status,'up_to_date');assert.equal((await checkNotesUpdate({feed:'http://untrusted.example/manifest',fetchImpl})).status,'error');});
 await check('Mac 官方目录不可达时改读正式苹果附件；Windows 清单不参与，限流和身份不符不绕过',async()=>{
  const feed='https://raw.githubusercontent.com/'+repository+'/main/catalog/macos-update.json';
  for(const response of ['offline','limited','mismatch']){
   let fallback=0;
   const result=await checkNotesUpdate({currentVersion:'0.2.0',platform:'darwin',arch:'arm64',feed,fetchImpl:async(url,options)=>{
    if(url===feed){if(response==='offline')throw new TypeError('fetch failed');if(response==='limited')return new Response(null,{status:429});return Response.json({...manifest,appId:'other'});}
    fallback++;assert(!url.endsWith('/shensi-notes-update.json'));if(url.endsWith('/latest/download/shensi-notes-macos-update.json'))return new Response(null,{status:302,headers:{location:root+'shensi-notes-macos-update.json'}});assert.equal(url,root+'shensi-notes-macos-update.json');return Response.json({...manifest,downloads:[{...manifest.downloads[0],platform:'darwin',arch:'arm64',url:root+'Shensi-arm64.dmg'}]});
   }});
   if(response==='offline'){assert.equal(fallback,2);assert.equal(result.status,'available');assert(result.usedReleaseManifestFallback);assert.equal(result.download.arch,'arm64');}
   else{assert.equal(fallback,0);assert.equal(result.status,'error');}
  }
 });
 await check('Mac 备用清单沿用版本与来源校验；不接受 Windows 附件跳转或其他仓库',async()=>{
  for(const location of [root+'shensi-notes-update.json',root.replace(repository,'other/repo')+'shensi-notes-macos-update.json']){
   let calls=0;const result=await checkNotesUpdate({platform:'darwin',arch:'arm64',feed:'',fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});assert.equal(result.status,'error');assert.equal(calls,1);
  }
 });
 evidence.result='passed';
}catch(error){evidence.result='failed';evidence.error=error.stack;console.error(error);process.exitCode=1;}
finally{const dir=process.env.SHENSI_TEST_EVIDENCE_DIR||'docs/migration/evidence/plugin-marketplace';await mkdir(dir,{recursive:true});await writeFile(dir+'/notes-update-'+Date.now()+'.json',JSON.stringify(evidence,null,2));}
