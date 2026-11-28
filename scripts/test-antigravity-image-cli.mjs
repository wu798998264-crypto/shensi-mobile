import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const root=resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.'),scriptPath=join(root,'packages/official/antigravity-image-cli.mjs');
const {imageHook,imageSignature,runAntigravityImage}=await import(pathToFileURL(scriptPath));
const fixture=async()=>{const runRoot=await mkdtemp(join(tmpdir(),'shensi-agy-image-test-'));return {runRoot,workspace:join(runRoot,'workspace'),prompt:'合成测试',imageName:'synthetic',references:[]};};
const hookInput=(config,name,args={},conversationId='synthetic')=>({toolCall:{name,args},conversationId,workspacePaths:[config.workspace],artifactDirectoryPath:join(config.runRoot,'artifacts')});
test('仅一次原生生图，拒绝其他工具及重试，使用固定原提示词',async()=>{
 const config=await fixture();
 for(const name of ['run_command','view_file','write_to_file','search_web','send_message','mcp__test','define_subagent','invoke_subagent'])assert.equal((await imageHook(config,hookInput(config,name))).decision,'deny');
 const calls=await Promise.all(Array.from({length:4},(_,i)=>imageHook(config,hookInput(config,'generate_image',{Prompt:'不可替换原提示词',ImagePaths:['outside.png']},'synthetic-'+i))));
 assert.equal(calls.filter(r=>r.decision==='allow').length,1);assert.equal(calls.filter(r=>r.decision==='deny').length,3);assert.deepEqual(calls.find(r=>r.decision==='allow').overwrite,{Prompt:config.prompt,ImageName:config.imageName,ImagePaths:[]});assert(JSON.parse(await readFile(join(config.runRoot,'submitted.json'),'utf8')).submittedAt);
 // Failure does not remove this marker, including after another hook process starts.
 assert.equal((await imageHook({...config},hookInput(config,'generate_image'))).decision,'deny');
 assert.equal((await imageHook(config,hookInput(config,'invoke_subagent',{TypeName:'image-generator'}))).decision,'deny');
});
test('官方单次执行器支持1.5.18平铺参数，固定工作区、提示词和模型继承',async()=>{
 const config=await fixture();
 const input=hookInput(config,'invoke_subagent',{TypeName:'"image-generator"',Workspace:'"branch"',Prompt:'改提示词并生成3张',Model:'other'});
 const calls=await Promise.all(Array.from({length:4},()=>imageHook(config,input)));
 assert.equal(calls.filter(x=>x.decision==='allow').length,1);
 const spec=calls.find(x=>x.decision==='allow').overwrite;
 assert.equal(spec.TypeName,'image-generator');assert.equal(spec.Workspace,'inherit');assert.equal(spec.Model,'inherit');assert(spec.Prompt.endsWith(config.prompt));assert(!spec.Prompt.includes('生成3张'));
 assert.equal((await imageHook(config,hookInput(config,'generate_image',{},'child'))).decision,'allow');
 assert.equal((await imageHook(config,hookInput(config,'generate_image',{},'parent'))).decision,'deny');
});
test('新版数组仅接受单个image-generator，不放行未知代理或混合批量',async()=>{
 const config=await fixture();
 for(const Subagents of [[],[{TypeName:'self'}],[{TypeName:'image-generator'},{TypeName:'self'}],null,'bad'])assert.equal((await imageHook(config,hookInput(config,'invoke_subagent',{Subagents}))).decision,'deny');
 const r=await imageHook(config,hookInput(config,'invoke_subagent',{Subagents:[{TypeName:'image-generator',Workspace:'branch',Prompt:'替换提示词'}]}));
 assert.equal(r.decision,'allow');assert.equal(r.overwrite.Subagents.length,1);assert.equal(r.overwrite.Subagents[0].Workspace,'inherit');assert(r.overwrite.Subagents[0].Prompt.endsWith(config.prompt));
 assert.equal((await imageHook(config,hookInput(config,'invoke_subagent',{TypeName:'image-generator'},'child'))).decision,'deny');
});
test('工作区不一致或会话元数据缺失时不消耗也不放行',async()=>{
 const config=await fixture(),base=hookInput(config,'generate_image');
 for(const input of [{...base,workspacePaths:[]},{...base,workspacePaths:[config.workspace,config.runRoot]},{...base,workspacePaths:[config.runRoot]},{...base,conversationId:''},{...base,artifactDirectoryPath:''}])assert.equal((await imageHook(config,input)).decision,'deny');
 assert.equal((await imageHook(config,base)).decision,'allow');
});
test('独立hook进程在配置损坏或磁盘记账失败时明确拒绝，不用异常放行',async()=>{
 const config=await fixture(),path=join(config.runRoot,'broken.json'),script=scriptPath;
 await writeFile(path,'{bad');
 for(const contents of [null,{...config,runRoot:join(config.runRoot,'missing')}]){
  if(contents)await writeFile(path,JSON.stringify(contents));
  const r=spawnSync(process.execPath,[script,'--hook',path],{input:JSON.stringify(hookInput(config,'generate_image')),encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).decision,'deny');
 }
});
test('启动只指定官方执行器，仍禁止文件命令；没有工具回执不能成功或重发',async()=>{
 const base=await mkdtemp(join(tmpdir(),'shensi-agy-image-launch-'));let launched=0,launchArgs,launchOptions;
 const spawnProcess=(exe,args,opts)=>{
  launched++;launchArgs=args;launchOptions=opts;
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'没有生成图片'}})+'\n');child.emit('close',0);}));return child;
 };
 const input={prompt:'合成测试',output:join(base,'output.png'),runRootBase:base,idempotencyKey:'synthetic-one',spawnProcess};
 await assert.rejects(runAntigravityImage(input),{code:'ANTIGRAVITY_IMAGE_TOOL_NOT_CALLED'});
 const instruction=launchArgs[launchArgs.indexOf('-p')+1];assert(instruction.includes('TypeName=image-generator'));assert(instruction.includes('禁止补单或质量重试'));assert(!launchArgs.includes('--dangerously-skip-permissions'));
 const settings=JSON.parse(await readFile(launchArgs[launchArgs.indexOf('--settings')+1],'utf8'));assert.equal(settings.useG1Credits,false);assert(settings.permissions.deny.includes('read_file(*)'));assert(settings.permissions.deny.includes('command(*)'));
 const hooks=JSON.parse(await readFile(join(launchOptions.cwd,'.agents/hooks.json'),'utf8'));assert.equal(hooks['shensi-image-limit'].PreToolUse[0].matcher,'.*');
 await assert.rejects(runAntigravityImage(input),{code:'ANTIGRAVITY_IMAGE_PENDING'});assert.equal(launched,1);
});
test('不支持的型号/数量/比例在调用上游前拒绝',async()=>{
 let spawned=false;const spawnProcess=()=>{spawned=true;throw Error('不得执行');};
 await assert.rejects(runAntigravityImage({model:'invented',count:1,spawnProcess}));
 await assert.rejects(runAntigravityImage({count:2,spawnProcess}));
 await assert.rejects(runAntigravityImage({prompt:'测试',aspectRatio:'invalid',spawnProcess}));assert.equal(spawned,false);
});
test('文本及极小假PNG不能冒充图片',()=>{assert.throws(()=>imageSignature(Buffer.from('<svg/>')));const b=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(1,16);b.writeUInt32BE(1,20);assert.throws(()=>imageSignature(b));});
test('父会话的唯一 JPG 可在子目录缺失时落为 PNG，不取同目录其他任务或多张冲突图片',async()=>{
 const {configureBundledMedia}=await import(pathToFileURL(join(root,'apps/desktop/runtime-paths.mjs')));
 const directory=await mkdtemp(join(tmpdir(),'shensi-agy-parent-jpg-'));
 const env={...process.env,USERPROFILE:directory,HOME:directory};
 const ffmpeg=configureBundledMedia({root,resourcesPath:resolve(root,'..'),isPackaged:existsSync(join(root,'release-build.json')),env}).ffmpeg.path;
 const brain=join(directory,'.gemini','antigravity-cli','brain'),parent=crypto.randomUUID(),child=crypto.randomUUID();
 const parentDir=join(brain,parent);await mkdir(parentDir,{recursive:true});
 const write=(name,value)=>writeFile(join(directory,name),JSON.stringify(value));
 await write('submitted.json',{conversationId:child,artifactDirectoryPath:join(brain,child)});
 await write('delegated.json',{conversationId:parent,artifactDirectoryPath:parentDir});
 await write('request.json',{createdAt:new Date().toISOString(),model:'nano-banana-2'});
 await write('hook-config.json',{imageName:'shensi_test'});
 const source=join(parentDir,'shensi_test_1.jpg');
 const generated=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x256','-frames:v','1',source],{env,windowsHide:true});
 assert.equal(generated.status,0,generated.stderr?.toString());
 await writeFile(join(parentDir,'shensi_test_other.jpg'),'不属于本次任务');
 const output=join(directory,'card.png');
 const collect=()=>spawnSync(process.execPath,['--input-type=module','-e',
  'import {collectAntigravityImage} from '+JSON.stringify(pathToFileURL(scriptPath).href)+';await collectAntigravityImage({runRoot:process.argv[1],output:process.argv[2]});',
  directory,output],{env,encoding:'utf8',windowsHide:true});
 const recovered=collect();assert.equal(recovered.status,0,recovered.stderr);
 const png=await readFile(output),metadata=imageSignature(png);assert.deepEqual([metadata.width,metadata.height],[320,256]);
 assert.equal(JSON.parse(await readFile(join(directory,'receipt.json'),'utf8')).providerTaskId,child);
 await writeFile(join(parentDir,'shensi_test_2.png'),png);
 const ambiguous=collect();assert.notEqual(ambiguous.status,0);assert.match(ambiguous.stderr,/ANTIGRAVITY_IMAGE_OUTPUT_MISSING/);
});
