import {writeFile} from 'node:fs/promises';
import {basename,extname,join} from 'node:path';

// Only accepts a server-produced export. The destination comes from the native dialog.
export function createExportFileSaver({dialog,getWindow,directory}){
 return async({base64,fileName})=>{
  const name=basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,180),extension=extname(name).slice(1);
  if(!['docx','pdf','md','txt','epub','html','canvas','zip'].includes(extension))throw Error('不支持的导出格式');
  const options={title:'导出',defaultPath:join(directory,name),filters:[{name:extension.toUpperCase(),extensions:[extension]}]},owner=getWindow?.();
  const answer=owner&&!owner.isDestroyed()?await dialog.showSaveDialog(owner,options):await dialog.showSaveDialog(options);
  if(answer.canceled||!answer.filePath)return {saved:false};
  await writeFile(answer.filePath,Buffer.from(base64,'base64'));return {saved:true};
 };
}
