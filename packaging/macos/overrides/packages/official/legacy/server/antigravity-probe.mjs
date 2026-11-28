import {execFile} from 'node:child_process';
import {resolveRunnerLaunch} from './agent-runner-launch.mjs';
import {antigravityDiagnostic,parseAntigravityModels} from './antigravity-cli-protocol.mjs';

// Read-only CLI discovery. Do not install a CLI or write the user's registry.
const runProcess=({executable,args,cwd,environment})=>new Promise((resolve,reject)=>{
 execFile(executable,args,{cwd,env:environment,windowsHide:true,timeout:20000,maxBuffer:256*1024},(error,stdout,stderr)=>{
  if(error)reject(Object.assign(error,{stdout,stderr}));else resolve({stdout,stderr});
 });
});
export async function detectKnownAgentRunnerInstallation({runnerId='antigravity',cwd,environment=process.env,resolveLaunch=resolveRunnerLaunch,runProcess:execute=runProcess}={}){
 if(runnerId!=='antigravity')throw Error('此探针仅用于 Antigravity');
 let launch,version='';
 try{
  launch=await resolveLaunch({runnerId,cwd,environment});
  if(!launch?.executable)throw Object.assign(Error('没有找到 agy'),{code:'ENOENT'});
  const invoke=args=>execute({executable:launch.executable,args:[...(launch.prefixArgs||[]),...args],cwd,environment});
  version=String((await invoke(['--version'])).stdout||'').trim().split(/\r?\n/).find(line=>/\d+\.\d+\.\d+/.test(line))||'';
  if(!version)throw Error('agy --version 未返回版本');
  const catalog=parseAntigravityModels((await invoke(['models'])).stdout);
  if(!catalog.models.length)throw Error('agy models 返回空模型目录');
  return {installed:true,available:true,ready:true,state:'ready',version,cliPath:launch.executable,prefixArgs:launch.prefixArgs||[],...catalog,message:'Antigravity 版本与账号模型目录检查通过'};
 }catch(error){
  const detail=[error.message,error.stdout,error.stderr,error.killed?'timeout':''].filter(Boolean).join('\n');
  const diagnostic=error.code==='ENOENT'?{code:'ANTIGRAVITY_NOT_INSTALLED',message:'没有找到 Antigravity CLI，请安装 agy 并在终端登录；默认位置为 %LOCALAPPDATA%/agy/bin/agy.exe'}:antigravityDiagnostic(detail,'Antigravity 模型目录检查失败，请检查 CLI 版本、网络和登录状态');
  return {installed:!!version,available:false,ready:false,state:diagnostic.code==='ANTIGRAVITY_AUTH_REQUIRED'?'login_required':'failed',version,models:[],modelLabels:{},error:diagnostic,message:diagnostic.message};
 }
}
