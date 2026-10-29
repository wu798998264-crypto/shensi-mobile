import {build} from 'esbuild';
import {mkdir,copyFile,writeFile,readFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {materializeMobileBranding} from '../../scripts/materialize-mobile-branding.mjs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url)),preview=process.argv.includes('--preview'),previewUi=process.argv.includes('--preview-ui'),out=join(root,preview?'preview-www':'www');
if(preview&&previewUi)throw Error('不能同时选择 --preview 与 --preview-ui');
await mkdir(out,{recursive:true});
// Remove only known generated files, never app data or an arbitrary tree.
for(const name of ['main.js','main.js.LEGAL.txt','app.css','design-preview.css','mobile-preview.css','mobile-shell.css','index.html','build-manifest.json'])await unlink(join(out,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
const assets=join(out,'assets');
await mkdir(assets,{recursive:true});
const entry=previewUi?'src/preview-ui.js':preview?'src/preview.js':'src/main.js';
const result=await build({absWorkingDir:root,entryPoints:[join(root,entry)],bundle:true,format:'esm',platform:'browser',target:'chrome120',outfile:join(out,'main.js'),metafile:true,legalComments:'linked',sourcemap:false});
if(previewUi){
  await copyFile(join(root,'src','preview-index.html'),join(out,'index.html'));
  await copyFile(join(root,'../..','docs/previews/creative-suite-20261027/preview.css'),join(out,'design-preview.css'));
  await copyFile(join(root,'../..','docs/previews/creative-suite-20261027/v3.css'),join(out,'mobile-preview.css'));
  await copyFile(join(root,'src','mobile-preview.css'),join(out,'mobile-shell.css'));
}else for(const name of ['index.html','app.css'])await copyFile(join(root,'src',name),join(out,name));
await copyFile(join(root,'../..','packages/ui/logo.png'),join(assets,'shensi-logo.png'));
await materializeMobileBranding();
const names=['index.html','main.js','assets/shensi-logo.png',...(previewUi?['design-preview.css','mobile-preview.css','mobile-shell.css']:['app.css'])],files={};
for(const name of names)files[name]={sha256:createHash('sha256').update(await readFile(join(out,name))).digest('hex')};
await writeFile(join(out,'build-manifest.json'),JSON.stringify({schema:3,kind:previewUi?'mobile-approved-preview-ui':preview?'android-foundation-preview':'android-foundation',entry,inputs:Object.keys(result.metafile.inputs),logoAsset:'assets/shensi-logo.png',files,productionDataIncluded:false,isolatedPreviewData:previewUi,productionServiceAdaptersIncluded:!previewUi},null,2));
console.log(`Mobile web assets built (${previewUi?'approved preview UI':preview?'preview foundation':'native foundation'}); this does not compile or verify an Android APK.`);
