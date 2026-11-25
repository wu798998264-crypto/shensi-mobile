import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bookNetwork,bookUrl,chapterTexts} from './fixtures/work-mode.mjs';
const root=resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.'),load=path=>import(pathToFileURL(join(root,path)));
const {startServer}=await load('apps/desktop/server.mjs'),{createExportFileSaver}=await load('apps/desktop/export-files.mjs');
process.env.SHENSI_CORE_BUNDLED_PLUGINS='0';
const data=await mkdtemp(join(tmpdir(),'shensi-card-export-')),out=resolve(process.env.SHENSI_TEST_EVIDENCE||'docs/migration/evidence/card-export-novel-20261126'),report={passed:false,checks:[],syntheticOnly:true,modelRequests:0};
let cancel=false,dialogCalls=0;
const saver=createExportFileSaver({directory:data,dialog:{showSaveDialog:async options=>{dialogCalls++;assert.equal(options.title,'导出');assert.equal(options.filters[0].extensions[0],'md');return cancel?{canceled:true}:{filePath:join(data,'chosen.md')};}}});
const host=await startServer({dataRoot:join(data,'data'),desktop:{saveExportFile:saver},updateOptions:{fetchImpl:async()=>{throw Error('isolated');}}});
const api=async(path,body,status=200)=>{const res=await fetch(host.origin+'/api/'+path,{method:body?'POST':'GET',headers:{'x-shensi-token':host.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),value=await res.json();assert.equal(res.status,status,JSON.stringify(value));return value;};
const unzip=bytes=>{const files={};let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+18),names=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+names+extra;files[bytes.subarray(at+30,at+30+names).toString()]=bytes.subarray(start,start+size);at=start+size;}return files;};
try{
 const {id}=await host.service.create('卡片导出验收');let live=await host.service.load(id);
 live=await host.service.createDocument(id,{kind:'whiteboard',expectedStateStamp:live.stateStamp,document:{title:'原白板'}});const board=live.documentId;
 const body='# 卡片正文\n\n第一段中文 & <符号>。\n\n第二段保留。';
 live.state.documents[board].canvas.nodes=[{id:'text-card',kind:'generated',type:'text',name:'文字卡片',text:body,x:0,y:0,width:340,height:240},...['image','video','audio'].map((kind,i)=>({id:kind,kind,type:'file',name:kind,text:'尚无文件',x:(i+1)*360,y:0,width:340,height:240}))];
 live=await host.service.save(id,{state:live.state,expectedStateStamp:live.stateStamp});const before=await host.service.load(id),request=(extra={})=>({id,documentIds:[board],nodeId:'text-card',expectedStateStamp:before.stateStamp,format:'markdown',...extra});
 for(const format of ['docx','pdf','markdown','text','screenplay','epub','html']){
  const result=await api('documents/export',request({format})),bytes=Buffer.from(result.base64,'base64');assert(bytes.length>20);assert.equal(result.documentCount,1);
  if(['docx','screenplay'].includes(format))assert(unzip(bytes)['word/document.xml'].toString().includes('第一段中文'));
  else if(format==='epub')assert(unzip(bytes)['OEBPS/chapter-1.xhtml'].toString().includes('第一段中文'));
  else if(format==='pdf')assert(bytes.toString().includes('7B2C4E006BB54E2D6587'));
  else assert(bytes.toString().includes('第一段中文'));
 }
 report.checks.push('已保存文本卡片的七种文档格式实际生成，正文回读有效');
 const saved=await api('documents/export',request({saveToFile:true}));assert.equal(saved.saved,true);assert.equal(saved.base64,undefined);assert((await readFile(join(data,'chosen.md'),'utf8')).includes(body));
 const original=await readFile(join(data,'chosen.md'));cancel=true;assert.equal((await api('documents/export',request({saveToFile:true}))).saved,false);assert.deepEqual(await readFile(join(data,'chosen.md')),original);assert.equal(dialogCalls,2);
 report.checks.push('通过原生保存入口指定目录写入真实文件；取消不写入、不返回大段正文');
 for(const patch of [{nodeId:'missing'},{nodeId:'image'},{nodeId:'video'},{nodeId:'audio'},{nodeId:''},{format:'canvas'},{documentIds:[board,'missing']}])await api('documents/export',request(patch),400);
 await api('documents/export',request({expectedStateStamp:'stale',saveToFile:true}),409);assert.equal(dialogCalls,2);
 const after=await host.service.load(id);assert.equal(after.stateStamp,before.stateStamp);assert.deepEqual(after.state.documents,before.state.documents);assert.deepEqual(after.state.histories,before.state.histories);
 report.checks.push('已删除或媒体卡片、过期快照拒绝；原卡片和所有历史逐字保持');
 const network=bookNetwork(),fetchImpl=async(...args)=>{const res=await network.fetchImpl(...args);return new Response((await res.text()).replace('</div>','<p>来源：这是小说人物的原话，必须保留。</p></div>'),{status:res.status,headers:res.headers});};
 for(const source of ['packages/official/legacy/server/quanben-book-source.mjs','resources/skills/chushou/scripts/novel-source/quanben-book-source.mjs']){
  const mod=await load(source),directory=await mod.fetchQuanbenDirectory({bookUrl,...network}),ref=await mod.createQuanbenChapterReference({book:{url:bookUrl,title:'合成小说'},chapters:directory.chapters,selectedChapterIds:directory.chapters.map(c=>c.id).reverse(),temporaryRoot:join(data,source.startsWith('packages')?'app-reference':'skill-reference'),...network,fetchImpl});
  assert(ref.text.includes('- 作品页：'+bookUrl));assert.equal((ref.text.match(/来源：这是小说人物的原话/g)||[]).length,2);assert(!/来源：https?:/.test(ref.text));assert(ref.text.indexOf(chapterTexts[1])<ref.text.indexOf(chapterTexts[0]));assert(ref.documents.every(d=>d.url.startsWith(bookUrl)&&d.sha256.length===64));
  const manifest=JSON.parse(await readFile(join(ref.temporaryDirectory,'manifest.json'),'utf8'));assert.deepEqual(manifest.chapters,ref.documents);assert.equal((await readFile(join(ref.temporaryDirectory,'reference.txt'),'utf8')).trim(),ref.text.trim());
 }
 report.checks.push('应用与触手两条小说导入路径取消逐章来源行；总来源、章节索引、摘要和正文内“来源”原话保留');report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}finally{await host.close();await mkdir(out,{recursive:true});await writeFile(join(out,'service.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
