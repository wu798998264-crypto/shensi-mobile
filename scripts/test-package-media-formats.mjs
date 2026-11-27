// Exercise every exported media format with the package's own binaries.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {testPackageRoot,testPackageUrl,testEvidencePath} from './lib/test-package-path.mjs';
const {configureBundledMedia}=await import(testPackageUrl('apps/desktop/runtime-paths.mjs'));
const {DOWNLOAD_FORMATS,convertMedia,probeMedia,runMediaTool}=await import(testPackageUrl('apps/desktop/video-transfer.mjs'));
const packaged=testPackageRoot!==resolve('.'),resourcesPath=resolve(testPackageRoot,'..');
const media=configureBundledMedia({root:testPackageRoot,resourcesPath,isPackaged:packaged,env:{}});
assert(media.ffmpeg.available&&media.ffprobe.available);
if(packaged)await assert.rejects(access(join(resourcesPath,'ffmpeg/ffmpeg.exe')),{code:'ENOENT'});
const root=await mkdtemp(join(tmpdir(),'shensi-slim-media-')),source=join(root,'source.mp4');
const out=resolve(testEvidencePath('docs/migration/evidence/package-slim-20261127/media-formats'));
await mkdir(out,{recursive:true});
const result={passed:false,packageRoot:testPackageRoot,root,synthetic:true,networkRequests:0,checks:[],media};
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
try{
 await runMediaTool(media.ffmpeg.path,['-v','error','-f','lavfi','-i','testsrc2=size=128x96:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
 const original=await digest(source);
 for(const [kind,formats]of Object.entries(DOWNLOAD_FORMATS))for(const format of formats){
  const directory=join(root,kind+'-'+format);await mkdir(directory);
  const converted=await convertMedia(source,{kind,format,directory,ffmpeg:media.ffmpeg.path,ffprobe:media.ffprobe.path});
  const info=await probeMedia(converted.path,{ffprobe:media.ffprobe.path});
  assert(converted.size>0);assert.equal(await digest(converted.path),converted.sha256);
  if(kind==='audio'){assert(info.streams.every(s=>s.codec_type==='audio'));assert(converted.durationMs>=1900);}
  else{assert.equal(converted.width,128);assert.equal(converted.height,96);if(kind==='video'){assert(info.streams.some(s=>s.codec_type==='audio'));assert(converted.durationMs>=1900);}}
  await runMediaTool(media.ffmpeg.path,['-v','error','-xerror','-i',converted.path,'-f','null','-']);
  result.checks.push({kind,format,bytes:converted.size,fullDecode:true,sha256:converted.sha256});
  console.log('PASS '+kind+' / '+format+' full decode and metadata');
 }
 const stopped=new AbortController();stopped.abort();
 await assert.rejects(convertMedia(source,{kind:'video',format:'mp4',directory:root,signal:stopped.signal,ffmpeg:media.ffmpeg.path,ffprobe:media.ffprobe.path}),{name:'AbortError'});
 assert.equal(await digest(source),original);result.sourceUnchanged=true;result.stopPreserved=true;result.passed=true;
}catch(error){result.error=error.message;throw error;}
finally{await writeFile(join(out,'formats.json'),JSON.stringify(result,null,2));}
