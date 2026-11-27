import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const packageRoot=resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.'),entry=file=>pathToFileURL(join(packageRoot,file));
const {createNotesUpdateService,NOTES_UPDATE_INTERVAL_MS,NOTES_UPDATE_MIN_CHECK_MS,NOTES_UPDATE_REPOSITORY:repository}=await import(entry('packages/core/src/update-service.mjs'));
const root=await mkdtemp(join(tmpdir(),'shensi-app-update-')),bytes=Buffer.from('synthetic installer - never execute'),hash=createHash('sha256').update(bytes).digest('hex'),checks=[];
const url='https://github.com/'+repository+'/releases/download/v0.3.0/ShensiNotes.exe',manifest={appId:'shensi-notes',version:'0.3.0',downloads:[{platform:'win32',arch:'x64',url,sha256:hash,sizeBytes:bytes.length}]};
let clock=100,manifestCalls=0,downloads=0,mode='',revealed;
const fetchImpl=async input=>{if(input==='https://updates.example/manifest'){manifestCalls++;if(mode==='offline')throw Error('offline fixture');return Response.json(manifest);}assert.equal(input,url);downloads++;if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://untrusted.example/installer'}});return new Response(mode==='corrupt'?Buffer.alloc(bytes.length):bytes);};
const options={dataRoot:root,currentVersion:'0.2.0',feed:'https://updates.example/manifest',platform:'win32',arch:'x64',fetchImpl,now:()=>clock},updates=createNotesUpdateService(options);
await Promise.all([updates.check({automatic:true}),updates.check({automatic:true})]);assert.equal(manifestCalls,1);assert.equal(downloads,0);assert(updates.snapshot().available);assert.equal(NOTES_UPDATE_INTERVAL_MS,3600000);
clock+=3599999;await updates.check({automatic:true});assert.equal(manifestCalls,1);clock++;await updates.check({automatic:true});assert.equal(manifestCalls,2);checks.push('首次自动检查及3600000ms间隔；多窗口并发/小时内调用不重复联网，不自动下载');
await updates.check();assert.equal(manifestCalls,2);clock+=NOTES_UPDATE_MIN_CHECK_MS-1;await updates.check();assert.equal(manifestCalls,2);clock++;mode='offline';await updates.check();assert.equal(manifestCalls,3);assert(updates.snapshot().available);assert.match(updates.snapshot().message,/offline/);checks.push('手动连续点击一分钟内复用结果；已发现新版后短暂断网不抹掉红点，保留真实失败说明');mode='';
await Promise.all([updates.download(),updates.download()]);assert.equal(downloads,1);assert(updates.snapshot().available);assert.equal(updates.snapshot().downloadState.status,'downloaded');await updates.download();assert.equal(downloads,1);await updates.reveal(async path=>revealed=path);assert.equal(revealed,join(root,'machine','updates'));const file=(await readdir(revealed)).find(f=>f.endsWith('.exe'));assert.deepEqual(await readFile(join(revealed,file)),bytes);checks.push('点击后才下载，完整大小/SHA校验落盘、并发去重及再次点击复用；下载不视作安装');
for(const failure of ['corrupt','redirect']){mode=failure;const isolated=createNotesUpdateService({...options,dataRoot:await mkdtemp(join(tmpdir(),'shensi-update-reject-'))});await isolated.check();await assert.rejects(isolated.download(),failure==='corrupt'?/完整性/:/不可信/);assert.equal(isolated.snapshot().downloadState.status,'error');assert(isolated.snapshot().available);await assert.rejects(isolated.reveal(()=>{}),/尚无/);await isolated.close();}checks.push('损坏包和外域跳转拒绝，错误保留且不给出可安装路径');mode='';
const installed=createNotesUpdateService({...options,currentVersion:'0.3.0'});assert.equal((await installed.check()).available,false);assert.equal(installed.snapshot().status,'up_to_date');await assert.rejects(installed.download(),/没有可下载/);checks.push('安装新版后的当前版本比较移除红点，不能再次下载相同/旧版');await updates.close();await installed.close();

let rateCalls=0,rateMode=false;const limited=createNotesUpdateService({...options,fetchImpl:async()=>{rateCalls++;return rateMode?new Response(null,{status:429,headers:{'retry-after':'7200'}}):Response.json(manifest);}});
await limited.check();clock+=NOTES_UPDATE_MIN_CHECK_MS;rateMode=true;await limited.check();assert(limited.snapshot().available);assert.equal(limited.snapshot().code,'UPDATE_RATE_LIMITED');const resumeAt=Date.parse(limited.snapshot().retryAt);
clock=resumeAt-1;await limited.check();await limited.check({automatic:true});assert.equal(rateCalls,2);clock++;rateMode=false;await limited.check();assert.equal(rateCalls,3);assert(limited.snapshot().available);assert(!limited.snapshot().retryAt&&!limited.snapshot().code);await limited.close();checks.push('源站限流冷却期间手动/自动均不重发，保留已验证新版；到期成功后清除错误');

let failedCalls=0,fail=true;clock=100;
const recovering=createNotesUpdateService({...options,fetchImpl:async()=>{failedCalls++;if(fail)throw TypeError('fetch failed');return Response.json(manifest);}});
const firstError=await recovering.check({automatic:true});assert.equal(firstError.pollIntervalMs,30000);clock+=1000;fail=false;
assert.equal((await recovering.check()).status,'available');assert.equal(failedCalls,2);checks.push('首次断网后无需等一分钟，手动重试立即真实请求并恢复');
clock+=60000;fail=true;await recovering.check();assert.equal(recovering.snapshot().lastCheckStatus,'error');assert(recovering.snapshot().available);assert.equal(recovering.snapshot().pollIntervalMs,30000);
for(const delay of [30000,60000,120000,240000,300000]){const before=failedCalls;clock+=delay-1;await recovering.check({automatic:true});assert.equal(failedCalls,before);clock++;await recovering.check({automatic:true});assert.equal(failedCalls,before+1);}
fail=false;clock+=300000;assert.equal((await recovering.check({automatic:true})).pollIntervalMs,3600000);assert(!recovering.snapshot().lastCheckStatus);await recovering.close();checks.push('失败自动按30秒至5分钟退避，保留已发现新版，恢复后回到每小时检查');

// One scheduler follows server backoff; network recovery can explicitly retry.
const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},intervals=[],calls=[],listeners={};
globalThis.window={addEventListener:(name,fn)=>listeners[name]=fn};globalThis.document={querySelectorAll:()=>[]};globalThis.setTimeout=(fn,ms)=>{const item={fn,ms,active:true};intervals.push(item);return item;};globalThis.clearTimeout=item=>{if(item)item.active=false;};
try{const {createAppUpdates}=await import(entry('packages/ui/app-updates.js'));let mode='failed';const client=createAppUpdates({api:async(path,body)=>{calls.push({path,body});if(mode==='transport')throw Error('local connection dropped');return mode==='failed'?{status:'error',message:'temporary outage',pollIntervalMs:30000,available:false}:{available:true,latestVersion:'0.3.0',pollIntervalMs:3600000,downloadState:{status:'idle'}};}});
 client.start();client.start();await new Promise(r=>setImmediate(r));assert.equal(intervals.length,1);assert.equal(intervals[0].ms,30000);assert.equal(calls.length,1);assert.equal(calls[0].body.automatic,true);
 intervals[0].fn();await new Promise(r=>setImmediate(r));assert.equal(calls.length,2);mode='success';listeners.online();await new Promise(r=>setImmediate(r));assert.equal(calls.at(-1).body.automatic,false);assert.equal(intervals.at(-1).ms,3600000);assert(client.state.available);
 mode='transport';await assert.rejects(client.check());assert.match(client.state.message,/local connection dropped/);assert(client.state.available);assert.equal(intervals.at(-1).ms,30000);assert.equal(intervals.filter(i=>i.active).length,1);
 listeners.pagehide();assert.equal(intervals.filter(i=>i.active).length,0);const stopped=calls.length;listeners.online();await new Promise(r=>setImmediate(r));assert.equal(calls.length,stopped);assert(calls.every(c=>c.path.endsWith('check-update')));checks.push('前端按失败退避调度、联网恢复立即检查；本地接口异常可见；单计时器且关闭后不再检查或下载');}
finally{Object.assign(globalThis,original);}
const evidenceDir=process.env.SHENSI_TEST_EVIDENCE_DIR||'docs/migration/evidence/app-update-notice-20261103';await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,'service.json'),JSON.stringify({passed:true,syntheticOnly:true,realNetworkCalls:0,installerExecuted:false,checks},null,2));checks.forEach(c=>console.log('PASS '+c));
