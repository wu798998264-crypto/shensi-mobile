// Custom media-CLI adapter. Never alters the shared image submit/poll/stop chain.
import {readFile,writeFile,mkdir,copyFile,readdir,realpath,stat} from 'node:fs/promises';
import {join,resolve,relative,dirname,basename,extname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {configureBundledMedia} from '../../apps/desktop/runtime-paths.mjs';
import {antigravityInput,parseAntigravityOutput} from './legacy/server/antigravity-cli-protocol.mjs';
import {resolveRunnerLaunch} from './legacy/server/agent-runner-launch.mjs';

const fail=(message,code)=>Object.assign(Error(message),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const imageInstruction=config=>'仅使用内置 generate_image 恰好一次，生成一张真实PNG。提示词、ImageName、ImagePaths以宿主hook固定值为准。失败立即结束，禁止补单或质量重试；不要调用其他代理、命令、文件、网页或MCP，不要复制文件，不要用SVG或代码代替图片。只返回原生工具生成的路径。\n'+config.prompt;
const argumentValue=value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}};
async function claimImageStep(config,input,file){
 try{await writeFile(join(config.runRoot,file),JSON.stringify({submittedAt:new Date().toISOString(),conversationId:input.conversationId,artifactDirectoryPath:input.artifactDirectoryPath}),{flag:'wx'});return true;}
 catch(e){if(e.code==='EEXIST')return false;throw e;}
}
function imageDecoder(){
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const media=configureBundledMedia({root,resourcesPath:resolve(root,'..'),isPackaged:existsSync(join(root,'release-build.json'))});
 const ffmpeg=media.ffmpeg.path;if(!media.ffmpeg.available)throw fail('缺少图片解码器，请修复神思安装；不会重新生图','ANTIGRAVITY_IMAGE_DECODER_MISSING');
 return ffmpeg;
}
async function decodeImage(path){
 const ffmpeg=imageDecoder();
 await new Promise((done,reject)=>{const child=spawn(ffmpeg,['-nostdin','-v','error','-xerror','-i',path,'-frames:v','1','-f','null','-'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';const timer=setTimeout(()=>{child.kill();reject(fail('图片解码校验超时','ANTIGRAVITY_IMAGE_DECODE'));},20000);child.stderr.on('data',b=>errors=(errors+b).slice(-1000));child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?done():reject(fail('图片不能完整解码：'+errors,'ANTIGRAVITY_IMAGE_DECODE'));});});
}
export function imageSignature(bytes){
 if(bytes.length>24*1024*1024)throw fail('反重力图片超过24MiB，未导入','ANTIGRAVITY_IMAGE_SIZE');
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>24){const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(width>=256&&height>=256&&width<=16384&&height<=16384)return {mimeType:'image/png',width,height,sha256:hash(bytes)};}
 throw fail('反重力未返回可校验的PNG原始图片，未用占位图代替','ANTIGRAVITY_IMAGE_INVALID');
}
export async function imageHook(config,input){
 const name=input.toolCall?.name;
 if(!name)return {decision:'deny',reason:'本轮仅允许一次原生 generate_image，不执行其他工具'};
 // The built-in worker must use this same workspace and the same on-disk quota.
 if(!config.workspace||!Array.isArray(input.workspacePaths)||input.workspacePaths.length!==1||resolve(input.workspacePaths[0])!==resolve(config.workspace))return {decision:'deny',reason:'生图工作区与本轮隔离目录不一致，未放行'};
 if(name==='invoke_subagent'){
  const args=input.toolCall.args||{},batch=Object.hasOwn(args,'Subagents'),specs=batch?argumentValue(args.Subagents):[args];
  if(!Array.isArray(specs)||specs.length!==1||argumentValue(specs[0]?.TypeName)!=='image-generator')return {decision:'deny',reason:'仅允许一个官方内置 image-generator，其他代理或批量调用未授权'};
  if(await readFile(join(config.runRoot,'submitted.json'),'utf8').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))return {decision:'deny',reason:'原生生图已提交，禁止再启动生图执行器'};
  if(!await claimImageStep(config,input,'delegated.json'))return {decision:'deny',reason:'本轮生图执行器已启动，失败也不重新委派'};
  const spec={TypeName:'image-generator',Role:'单次原生生图',Workspace:'inherit',Prompt:imageInstruction(config)};
  // 1.5.18 uses a flat spec; newer documented schemas accept Subagents[].
  return {decision:'allow',overwrite:batch?{Subagents:[spec]}:{...spec,Model:'inherit'}};
 }
 if(name!=='generate_image')return {decision:'deny',reason:'本轮只允许原生 generate_image；文件、命令、网页、MCP及其他代理均不开放'};
 if(!input.conversationId||!input.artifactDirectoryPath)return {decision:'deny',reason:'缺少生图会话或产物目录，未提交'};
 // A local exclusive marker covers concurrent attempts and failed calls too.
 if(!await claimImageStep(config,input,'submitted.json'))return {decision:'deny',reason:'本轮一次生图额度已用，失败也计入；禁止补单或质量重试'};
 return {decision:'allow',overwrite:{Prompt:config.prompt,ImageName:config.imageName,ImagePaths:config.references}};
}
export async function runAntigravityImage({prompt,output,referencePaths=[],aspectRatio='1:1',model='nano-banana-2',count=1,idempotencyKey='',runRootBase=join(process.env.LOCALAPPDATA||homedir(),'ShensiNotes','antigravity-image-jobs'),spawnProcess=spawn}={}){
 if(model!=='nano-banana-2'||Number(count)!==1)throw fail('反重力生图仅接入 Nano Banana 2，单任务仅1张','ANTIGRAVITY_IMAGE_OPTIONS');
 if(!['1:1','16:9','9:16','4:3','3:4'].includes(aspectRatio)||!prompt?.trim()||Buffer.byteLength(prompt)>24000)throw fail('生图提示词或比例无效','ANTIGRAVITY_IMAGE_INPUT');
 if(referencePaths.length>4)throw fail('单次最多4张明确参考图','ANTIGRAVITY_IMAGE_REFERENCES');
 const references=[];for(const path of referencePaths){const actual=await realpath(path),info=await stat(actual);if(!info.isFile()||info.size>24*1024*1024||!['.png','.jpg','.jpeg','.webp'].includes(extname(actual).toLowerCase()))throw fail('参考图片类型或体积无效，未提交','ANTIGRAVITY_IMAGE_REFERENCES');references.push(actual);}
 const key=hash(idempotencyKey||randomUUID()),runRoot=join(runRootBase,key),requestHash=hash(JSON.stringify({prompt,aspectRatio,references,model}));await mkdir(runRoot,{recursive:true});
 try{const prior=JSON.parse(await readFile(join(runRoot,'request.json'),'utf8'));if(prior.requestHash!==requestHash)throw fail('同一任务身份对应不同请求，已拒绝','ANTIGRAVITY_IMAGE_IDEMPOTENCY');const receipt=await readFile(join(runRoot,'receipt.json'),'utf8').then(JSON.parse,e=>{if(e.code!=='ENOENT')throw e;return null;});if(!receipt){if(existsSync(join(runRoot,'submitted.json'))&&existsSync(join(runRoot,'response.json')))return collectAntigravityImage({runRoot,output});throw fail('原任务已启动但尚无完整回执，未重复生图','ANTIGRAVITY_IMAGE_PENDING');}const bytes=await readFile(join(runRoot,'result.png'));if(hash(bytes)!==receipt.sha256)throw fail('缓存图片校验失败，未重复生图','ANTIGRAVITY_IMAGE_CACHE');await copyFile(join(runRoot,'result.png'),output);return {...receipt,path:output,replayed:true};}catch(e){if(e.code!=='ENOENT')throw e;}
 if(process.env.SHENSI_ANTIGRAVITY_COLLECT_ONLY==='1')throw fail('只读取原任务成品，本次没有可用回执','ANTIGRAVITY_IMAGE_OUTPUT_MISSING');
 const workspace=join(runRoot,'workspace');await mkdir(join(workspace,'.agents'),{recursive:true});
 const config={runRoot,workspace,imageName:'shensi_'+key.slice(0,16),references,prompt:prompt+'\n画幅 '+aspectRatio+'；只生成一张完整画面，不要拼贴。'};
 await writeFile(join(runRoot,'request.json'),JSON.stringify({requestHash,createdAt:new Date().toISOString(),model,aspectRatio,referenceCount:references.length}),{flag:'wx'});
 const configPath=join(runRoot,'hook-config.json');await writeFile(configPath,JSON.stringify(config));
 const script=fileURLToPath(import.meta.url),quote=s=>'"'+s.replaceAll('"','')+'"';
 await writeFile(join(workspace,'.agents/hooks.json'),JSON.stringify({'shensi-image-limit':{PreToolUse:[{matcher:'.*',hooks:[{type:'command',command:[process.execPath,script,'--hook',configPath].map(quote).join(' '),timeout:10}]}]}}));
 await writeFile(join(workspace,'.agents/mcp_config.json'),JSON.stringify({mcpServers:{}}));
 const settingsFile=join(runRoot,'settings.json');await writeFile(settingsFile,JSON.stringify({agentMode:'',toolPermission:'request-review',useG1Credits:false,title:{enabled:false},statusLine:{enabled:false},permissions:{allow:[],ask:[],deny:['read_file(*)','write_file(*)','command(*)','read_url(*)','execute_url(*)','mcp(*)']}}));
 const instruction='调用一次官方内置 image-generator 生图执行器（TypeName=image-generator，Workspace=inherit），等待它完成。不得调用其他类型代理，不得再次委派，不发送追加指令。传递以下任务：\n'+imageInstruction(config);
 const invocation=antigravityInput({prompt:instruction,model:'gemini-4-neon-high',workspace,settingsFile}),launch=await resolveRunnerLaunch({runnerId:'antigravity'});
 if(!launch?.executable)throw fail('未探测到已登录的 agy CLI','ANTIGRAVITY_IMAGE_CLI_MISSING');
 let stdout='',stderr='';
 await new Promise((done,reject)=>{const child=spawnProcess(launch.executable,[...(launch.prefixArgs||[]),...invocation.args],{cwd:workspace,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});const timer=setTimeout(()=>{child.kill();reject(fail('反重力生图超过8分钟，未补发','ANTIGRAVITY_IMAGE_TIMEOUT'));},480000);child.stdin.on('error',()=>{});child.stdout.on('data',b=>{stdout+=b;if(stdout.length>8000000){child.kill();reject(Error('反重力回执超限'));}});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-24000);});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?done():reject(fail('反重力进程失败：'+stderr.slice(-500),'ANTIGRAVITY_IMAGE_CLI_FAILED'));});child.stdin.end(invocation.input);});
 await writeFile(join(runRoot,'stdout.jsonl'),stdout);const result=parseAntigravityOutput(stdout);await writeFile(join(runRoot,'response.json'),JSON.stringify(result));
 return collectAntigravityImage({runRoot,output});
}
export async function collectAntigravityImage({runRoot,output}){
 const read=name=>readFile(join(runRoot,name),'utf8').then(JSON.parse);
 const submitted=await read('submitted.json').catch(()=>{throw fail('本机 CLI 未调用原生 generate_image，不能声称生图可用','ANTIGRAVITY_IMAGE_TOOL_NOT_CALLED');});
 const delegated=await read('delegated.json').catch(e=>{if(e.code!=='ENOENT')throw e;});
 const request=await read('request.json'),config=await read('hook-config.json');
 const brain=await realpath(join(homedir(),'.gemini','antigravity-cli','brain'));
 const candidates=new Map();
 for(const scope of [submitted,delegated].filter(Boolean)){
  if(!/^[\da-f-]{36}$/i.test(scope.conversationId))throw fail('无效生图会话身份','ANTIGRAVITY_IMAGE_SCOPE');
  let artifact;
  try{artifact=await realpath(scope.artifactDirectoryPath);}
  catch(e){
   if(e.code==='ENOENT'&&basename(scope.artifactDirectoryPath)===scope.conversationId&&await realpath(dirname(scope.artifactDirectoryPath))===brain)continue;
   throw e;
  }
  if(relative(brain,artifact)!==scope.conversationId)throw fail('产物目录不属于本次会话','ANTIGRAVITY_IMAGE_SCOPE');
  for(const entry of await readdir(artifact,{withFileTypes:true})){
   if(!entry.isFile()||!entry.name.startsWith(config.imageName)||!/^(_\d+)?\.(png|jpe?g)$/i.test(entry.name.slice(config.imageName.length)))continue;
   const path=join(artifact,entry.name),info=await stat(path);
   if(info.mtimeMs<Date.parse(request.createdAt)-2000||info.size>24*1024*1024)continue;
   const bytes=await readFile(path);candidates.set(hash(bytes),{path,bytes});
  }
 }
 if(candidates.size!==1)throw fail('未找到唯一的本次生图成品，请核对原任务','ANTIGRAVITY_IMAGE_OUTPUT_MISSING');
 const [chosen]=candidates.values();let bytes=chosen.bytes;
 if(bytes[0]===0xff&&bytes[1]===0xd8){
  const result=await promisify(execFile)(imageDecoder(),['-nostdin','-v','error','-xerror','-i',chosen.path,'-frames:v','1','-c:v','png','-f','image2pipe','pipe:1'],{encoding:'buffer',windowsHide:true,maxBuffer:24*1024*1024,timeout:30000});
  bytes=result.stdout;
 }
 const metadata=imageSignature(bytes),file=join(runRoot,'result.png');
 try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||hash(await readFile(file))!==metadata.sha256)throw e;}
 await decodeImage(file);
 const receipt={...metadata,providerTaskId:submitted.conversationId,model:request.model,generatedAt:new Date().toISOString(),runRoot,decoded:true};
 await writeFile(join(runRoot,'receipt.json'),JSON.stringify(receipt));await copyFile(file,output);return {...receipt,path:output};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
 try{
  if(option('--hook')){try{let input='';for await(const b of process.stdin)input+=b;console.log(JSON.stringify(await imageHook(JSON.parse(await readFile(option('--hook'),'utf8')),JSON.parse(input))));}catch{console.log(JSON.stringify({decision:'deny',reason:'本轮生图限制无法校验，已拒绝执行'}));}}
  else if(args.includes('--version'))console.log('shensi-antigravity-image 0.1.0 candidate');
  else {const result=await runAntigravityImage({prompt:await readFile(option('--prompt-file'),'utf8'),output:resolve(option('--output')),model:option('--model','nano-banana-2'),count:Number(option('--count','1')),aspectRatio:option('--aspect-ratio','1:1'),idempotencyKey:option('--idempotency-key',process.env.SHENSI_MEDIA_IDEMPOTENCY_KEY||''),referencePaths:option('--reference-images-file')?JSON.parse(await readFile(option('--reference-images-file'),'utf8')):[],...(option('--jobs-root')?{runRootBase:resolve(option('--jobs-root'))}:{})});console.log(JSON.stringify(result));}
 }catch(e){console.error(JSON.stringify({code:e.code||'ANTIGRAVITY_IMAGE_FAILED',message:e.message}));process.exitCode=1;}
}
