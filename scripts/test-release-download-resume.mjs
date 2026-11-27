import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,stat,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';
const packageRoot=resolve(process.env.SHENSI_TEST_PACKAGE_ROOT||'.');
const {downloadReleaseFile}=await import(pathToFileURL(join(packageRoot,'packages/core/src/release-download.cjs')));
const {startServer}=await import(pathToFileURL(join(packageRoot,'apps/desktop/server.mjs')));

const root=await mkdtemp(join(tmpdir(),'shensi-update-resume-'));
const bytes=Buffer.from('0123456789abcdef'.repeat(4096));
const digest=createHash('sha256').update(bytes).digest('hex');
const url='https://github.com/wu798998264-crypto/shensi-notes/releases/download/v0.9.0/fixture.exe';
let mode='drop',attempts=[],host;
const upstream=createServer(async(req,res)=>{
 const range=req.headers.range||'';
 attempts.push(range);
 let start=range?Number(range.slice(6,-1)):0;
 if(mode==='full')start=0;
 if(mode==='status'&&attempts.length===1){res.writeHead(503);res.end();return;}
 const resume=!!range&&mode!=='full';
 res.writeHead(resume?206:200,{'Content-Length':bytes.length-start,...resume&&{'Content-Range':'bytes '+(start+(mode==='wrong'?1:0))+'-'+(bytes.length-1)+'/'+bytes.length}});
 if((mode==='drop'||mode==='stall')&&attempts.length===1){
   res.write(bytes.subarray(start,start+8192));
   if(mode==='drop'){await wait(70);res.destroy();}
   return;
 }
 if(mode==='slow'){for(let i=start;i<bytes.length;i+=8192){res.write(bytes.subarray(i,i+8192));await wait(50);}res.end();return;}
 res.end(mode==='corrupt'?Buffer.alloc(bytes.length-start):bytes.subarray(start));
});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const origin='http://127.0.0.1:'+upstream.address().port;
const fetchImpl=(input,opts)=>{assert.equal(input,url);return fetch(origin,opts);};
const run=(name,extra)=>downloadReleaseFile({url,destination:join(root,name),size:bytes.length,digest,fetchImpl,idleMs:200,retryMs:1,...extra});
try {
 await run('drop');assert.deepEqual(attempts,['','bytes=8192-']);assert.deepEqual(await readFile(join(root,'drop')),bytes);
 mode='stall';attempts=[];await run('stall');assert.deepEqual(attempts,['','bytes=8192-']);
 mode='slow';attempts=[];await run('slow');assert.deepEqual(attempts,['']);console.log('PASS interruption and idle timeout resume; active slow transfer survives multiple idle intervals');
 mode='drop';attempts=[];await assert.rejects(run('restart',{attempts:1}));assert.equal((await stat(join(root,'restart.'+digest.slice(0,16)+'.part'))).size,8192);
 await run('restart');assert.deepEqual(attempts,['','bytes=8192-']);console.log('PASS fresh download after termination reopens persisted prefix');
 for(const action of ['full','wrong','corrupt','status']){
   mode=action;attempts=[];
   if(action==='full'||action==='wrong')await writeFile(join(root,action+'.'+digest.slice(0,16)+'.part'),bytes.subarray(0,32));
   if(action==='wrong'||action==='corrupt'){await assert.rejects(run(action),action==='wrong'?/续传位置/:/完整性/);await assert.rejects(stat(join(root,action)),{code:'ENOENT'});}
   else{await run(action);assert.deepEqual(await readFile(join(root,action)),bytes);if(action==='status')assert.equal(attempts.length,2);}
 }
 console.log('PASS ignored Range, incorrect range, checksum failure and temporary HTTP 503');
 for(const errorText of ['net::ERR_NAME_NOT_RESOLVED','net::ERR_PROXY_CONNECTION_FAILED','net::ERR_TUNNEL_CONNECTION_FAILED','getaddrinfo EAI_AGAIN']){
  let calls=0;const destination=join(root,'network-'+errorText.replace(/[^a-z]/gi,''));await downloadReleaseFile({url,destination,size:bytes.length,digest,retryMs:1,fetchImpl:async()=>{calls++;if(calls===1)throw Error(errorText);return new Response(bytes);}});assert.equal(calls,2);assert.deepEqual(await readFile(destination),bytes);
 }
 let deniedCalls=0;await assert.rejects(downloadReleaseFile({url,destination:join(root,'invalid-cert'),size:bytes.length,digest,retryMs:1,fetchImpl:async()=>{deniedCalls++;throw Error('net::ERR_CERT_AUTHORITY_INVALID');}}),/ERR_CERT/);assert.equal(deniedCalls,1);console.log('PASS transient DNS/proxy failures retry; certificate errors do not');
 mode='slow';attempts=[];
 process.env.SHENSI_CORE_BUNDLED_PLUGINS='0';
 host=await startServer({dataRoot:join(root,'workspace'),updateOptions:{currentVersion:'0.1.0',platform:'win32',arch:'x64',feed:'https://example.invalid/manifest',fetchImpl:(input,opts)=>input===url?fetchImpl(input,opts):Response.json({appId:'shensi-notes',version:'0.9.0',downloads:[{platform:'win32',arch:'x64',url,sizeBytes:bytes.length,sha256:digest}]})}});
 const html=await(await fetch(host.origin)).text(),token=html.match(/name="shensi-session" content="([^"]+)"/)[1];
 const api=async(endpoint,body)=>{const r=await fetch(host.origin+'/api/settings/'+endpoint,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Shensi-Token':token},body:body&&JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 assert((await api('check-update',{})).available);
 const submitted=await Promise.all([api('download-update',{background:true}),api('download-update',{background:true})]);
 assert(submitted.every(r=>r.downloadState.status==='downloading'));
 let status;for(let i=0;i<80;i++){status=await api('update-status');if(status.downloadState.status!=='downloading')break;await wait(50);}
 assert.equal(status.downloadState.status,'downloaded');assert.equal(attempts.length,1);
 assert.deepEqual(await readFile(join(root,'workspace','machine','updates',status.downloadState.fileName)),bytes);
 console.log('PASS desktop HTTP entry acknowledges before completion, shares one transfer and exposes verified bytes');
}finally{await host?.close();upstream.closeAllConnections();upstream.close();await rm(root,{recursive:true,force:true});}
