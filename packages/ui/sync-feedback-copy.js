import {notebookSyncScopeText} from './notebook-auto-sync.js';
const words={
 '全部采用本地':'Use local for all','全部采用云端':'Use cloud for all',
 '双方版本均保存到同一文件的历史中，采用的版本作为本机当前版本。不同设备可采用不同版本，不新增同名副本。点击采用即执行；同步删除仍须单独确认。':'Both versions are saved in the same file’s history. The chosen version becomes current on this device. Devices may choose different versions without duplicate files. Choices apply immediately; deletion requires separate confirmation.',
 '坚果云冲突处理':'Resolve Nutstore conflicts','官方云同步冲突处理':'Resolve official cloud conflicts','关闭冲突处理':'Close conflict resolution','正在读取冲突…':'Loading conflicts…','没有未解决的冲突':'No unresolved conflicts','采用本地':'Use local','采用云端':'Use cloud','预览双方内容与时间':'Preview both versions and dates','正在读取版本预览…':'Loading version previews…','请先保存当前编辑，再处理同步冲突':'Save your edits before resolving conflicts','正在保留版本并核对处理结果…':'Saving both versions and verifying the result…',
 [notebookSyncScopeText]:'Devices may choose different current versions; both versions remain in history. Sync includes existing notebooks, documents, whiteboards, prompts, reference order, managed image/audio/video files and full history. Conflicts need a choice; deletions need separate confirmation. Download new cloud notebooks manually. PDFs, workspace attachments, plugin settings and credentials are not included.',
 ' 完整快照上限64MiB。':' Complete snapshot limit: 64 MiB.',' 完整快照上限64MiB，大库分块传输，两端需使用支持分块的新版；后台休眠后待再次打开应用继续。':' Complete snapshot limit: 64 MiB; large notebooks use chunks and require updated apps on both devices. Resume by reopening the app after background suspension.'
};
export function translateSyncFeedback(text){
 if(words[text])return words[text];
 if(text.includes(notebookSyncScopeText))return text.replace(notebookSyncScopeText,words[notebookSyncScopeText]).replace('手机与电脑使用“神思双端笔记快照”目录。完整快照上限64MiB，大库分块传输，两端需使用支持分块的新版；','Phone and desktop use the shared notebook snapshot directory. Complete snapshot limit: 64 MiB; large notebooks use chunks and require updated apps on both devices. ').replace(/ 完整快照上限64MiB[^]*$/,s=>words[s]||s);
 let m;if((m=/^发现 (\d+) 项待处理冲突$/.exec(text)))return m[1]+' conflicts to resolve';
 if(text.startsWith('版本已保存，界面刷新未完成：'))return text.replace('版本已保存，界面刷新未完成：','Versions saved; the view could not refresh: ');
 if((m=/^正在处理 (\d+) \/ (\d+)：([^]*)$/.exec(text)))return 'Processing '+m[1]+' / '+m[2]+': '+m[3];
 if(text.startsWith('已处理 '))return text.replace(/^已处理 (\d+) 项/,'Resolved $1 items').replace(/；失败 (\d+) 项，双方内容保留：/,'; $1 failed; both versions retained: ').replace(/；(\d+) 项删除或其他冲突需单独处理/,'; $1 deletion or other conflicts require individual review').replace('；版本已保存，界面刷新未完成：','; Versions saved; the view could not refresh: ');
 return text;
}
