// Packaging only: copy the public desktop mark byte-for-byte.
import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function materializeMobileBranding(){
  const res=join(root,'apps/mobile/android/app/src/main/res');
  for(const [directory,name]of [['drawable-nodpi','shensi_logo.png'],['mipmap-nodpi','shensi_launcher.png']]){
    await mkdir(join(res,directory),{recursive:true});
    await copyFile(join(root,'packages/ui/tray-icon.png'),join(res,directory,name));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await materializeMobileBranding();
