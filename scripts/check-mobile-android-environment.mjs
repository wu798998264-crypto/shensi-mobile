import {access,mkdir,writeFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const present=path=>path?access(path).then(()=>true,()=>false):false;
const portableRoot=process.env.SHENSI_ANDROID_TOOLS_ROOT||'E:/ShensiDeveloperTools';
const portableJdks=await readdir(join(portableRoot,'jdk21'),{withFileTypes:true}).then(rows=>rows.filter(row=>row.isDirectory()&&/^jdk-21/.test(row.name)).map(row=>join(portableRoot,'jdk21',row.name,'bin/java.exe')),()=>[]);
const javaCandidates=[process.env.SHENSI_JDK_HOME&&join(process.env.SHENSI_JDK_HOME,'bin','java.exe'),process.env.JAVA_HOME&&join(process.env.JAVA_HOME,'bin','java.exe'),...portableJdks,'C:/Program Files/Android/Android Studio/jbr/bin/java.exe','java'];
let java=null;
for(const candidate of javaCandidates.filter(Boolean))try{
 const result=await run(candidate,['-version'],{windowsHide:true,timeout:10000}),version=String(result.stderr||result.stdout).split(/\r?\n/)[0],major=Number(version.match(/version "(\d+)/)?.[1]);
 const compiler=candidate==='java'?'javac':join(dirname(candidate),'javac.exe');let javac=null;
 try{const compiled=await run(compiler,['-version'],{windowsHide:true,timeout:10000});javac=String(compiled.stdout||compiled.stderr).trim();}catch{}
 const found={found:true,version,major,compiler:javac,compatible:major===21&&/^javac 21\./.test(javac||''),command:candidate};
 if(!java||found.compatible)java=found;if(found.compatible)break;
}catch{}
const sdkCandidates=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(portableRoot,'android-sdk'),process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Android','Sdk')].filter(Boolean);
const sdk=sdkCandidates.length?await Promise.all([...new Set(sdkCandidates)].map(async path=>({path,platform36:await present(join(path,'platforms/android-36/android.jar')),adb:await present(join(path,'platform-tools/adb.exe')),buildTools:await readdir(join(path,'build-tools'),{withFileTypes:true}).then(rows=>rows.filter(r=>r.isDirectory()).map(r=>r.name),()=>[]),sdkLicensePresent:await present(join(path,'licenses/android-sdk-license'))}))):[];
const selected=sdk.find(s=>s.platform36&&s.buildTools.some(v=>Number(v.split('.')[0])>=35)&&s.sdkLicensePresent),report={checkedAt:new Date().toISOString(),java:java||{found:false},sdk,readyForCompile:java?.compatible===true&&!!selected,apkBuilt:false,deviceTest:false,ios:{deferred:true,reason:'用户暂时没有Mac，本阶段继续公共代码与Android'},inspectionOnly:true};
if(process.argv.includes('--record')){const dir=join(root,'docs/migration/evidence',process.argv.includes('--preview-only')?'android-preview-only':'mobile-android-foundation');await mkdir(dir,{recursive:true});await writeFile(join(dir,'environment.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
if(!report.readyForCompile)process.exitCode=2;
