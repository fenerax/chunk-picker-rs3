// R130 derived source packet. Runtime UNRUN until independent Docker controls pass.
import assert from 'node:assert/strict';
import {readFile,writeFile,cp,mkdir,symlink,access,readdir} from 'node:fs/promises';
import {writeSync} from 'node:fs';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCase} from './result-policy.mjs';
import {applyUnifiedPatch} from './strict-patch.mjs';
const H=fileURLToPath(new URL('./',import.meta.url)),N='/runtime/node',S='/scratch/r130';
const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323',PROFILE='docker-hard-2cpu-6g-v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const stage=name=>writeSync(3,JSON.stringify({stage:name})+'\n');
const result={schema:'r130-codec-functional-v1',status:'failed',passed:false,cleanupPassed:false,processStatus:'unrun',threadStatus:'unrun',elapsedMs:0,sourceCommit:PIN,fixtureSha256:'e46b59151a55bfaf5101f6f542118c1a8e4b860f5eed6b8dd34ab3ad436a465c',datasetDigest:'f129828c58260ba4894f2cb6ed7287c07c8f5360cb8d0a1716a5f26ddb9dfbc0',metrics:{processElapsedMs:0,threadElapsedMs:0,processGenerations:0,threadGenerations:0}};
const report={schema:'r130-codec-full-report-v1',runtime:'attempted',cells:[],failureCode:null};
const active=new Map();let expired=false,deadline;const started=performance.now();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(k==='PERF_STAGE_FD'||k.startsWith('RS3_')||['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE'].includes(k)||k.startsWith('NODE_TEST_')||k.startsWith('NODE_CHANNEL_'))));
env.R130_DOCKER_PROFILE=PROFILE;
function track(p){const done=new Promise(resolve=>p.once('close',resolve));active.set(p,done);done.then(()=>active.delete(p));return p;}
function terminate(signal){for(const p of active.keys())p.kill(signal);}
async function cell(index,mode,mask){
 assert.equal(expired,false);result[mode+'Status']='failed';stage('episode-start');
 let text='',bytes=0,timedOut=false,closed=false;const log=[],begin=performance.now();
 const child=track(fork(S+'/prep/child-entry.mjs',['C',mode,String(mask),'authored'],{execPath:N,execArgv:['--max-old-space-size=768'],cwd:S,env:{...env,R130_CELL:String(index)},stdio:['ignore','pipe','pipe','ipc']}));
 const output=b=>{bytes+=b.length;if(bytes>1048576){child.kill('SIGTERM');return;}log.push(b);text+=b.toString();};
 child.stdout.on('data',output);child.stderr.on('data',output);
 child.on('message',m=>{if(m&&m.stage===(index===1?'reference-ready':'measured-ready'))stage(m.stage);});
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},35000);
 const kill=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},37000);
 let end;
 try{end=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{closed=true;resolve({code,signal});});});}
 finally{clearTimeout(timer);clearTimeout(kill);await writeFile('/scratch/r130-cell-'+index+'.log',Buffer.concat(log));}
 const rows=[];for(const line of text.split('\n'))if(line.startsWith('{')){try{rows.push(JSON.parse(line));}catch{}}
 report.cells.push({index,mode,mask,flavour:'authored',timedOut,bytes,exit:end,records:rows,logPath:'/scratch/r130-cell-'+index+'.log'});
 assert.equal(expired,false);assert.equal(timedOut,false);assert.ok(bytes<=1048576);assert.equal(end.code,0);assert.equal(end.signal,null);
 const count=validateCase(rows,text,mode);
 for(const row of rows.filter(x=>x.phase==='R114-constructor'&&x.childPid))await assert.rejects(access('/proc/'+row.childPid),{code:'ENOENT'});
 assert.equal((await readdir(S)).some(n=>n.startsWith('unarchived-owned-store-')),false);
 result.metrics[mode+'ElapsedMs']=Math.round(performance.now()-begin);result.metrics[mode+'Generations']=count;
 result[mode+'Status']='correct';stage('episode-end');
}
try{
 stage('start');assert.equal(process.version,'v24.19.0');assert.equal(process.argv.length,2);
 // Fixed wrapper environment and source lock bind this entry; outer controls own resource admission.
 assert.equal(process.env.PERF_SOURCE_ROOT,'/source');assert.equal(process.env.PERF_HARNESS_ROOT,'/harness');
 assert.equal(process.env.PERF_OUTPUT_ROOT,'/scratch');assert.equal(process.env.PERF_CASE_RESULT,'/scratch/case-result.json');
 assert.equal(process.env.PERF_STAGE_FD,'3');assert.equal(process.env.NODE_PATH,'/deps/node_modules');
 deadline=setTimeout(()=>{expired=true;stage('error');terminate('SIGTERM');setTimeout(()=>terminate('SIGKILL'),2000).unref();},90000);
 const manifestBytes=await readFile(H+'manifest.json'),manifest=JSON.parse(manifestBytes);result.harnessManifestSha256=hash(manifestBytes);
 assert.equal(manifest.sourceRevision,PIN);
 const lock=JSON.parse(await readFile('/scratch/source-lock.json','utf8'));assert.equal(lock.sourceCommit,PIN);
 for(const [name,digest] of Object.entries(manifest.publicHarnessFiles))assert.equal(hash(await readFile(H+name)),digest,name);
 for(const [name,digest] of Object.entries(manifest.baselineCore))assert.equal(hash(await readFile('/source/'+name)),digest,name);
 await mkdir(S,{recursive:false});await cp('/source',S+'/C',{recursive:true,filter:src=>!['.git','node_modules'].includes(src.split('/').at(-1))});await mkdir(S+'/prep');
 await access('/deps/node_modules');await symlink('/deps/node_modules',S+'/C/node_modules','dir');
 const sources=new Map();
 for(const name of ['app/server.mjs','app/tasks/worker.mjs'])sources.set(name,await readFile(S+'/C/'+name,'utf8'));
 const patched=applyUnifiedPatch(await readFile(H+'assets/r49-production-v2.patch','utf8'),sources);
 for(const [name,value] of patched){assert.equal(hash(value),manifest.candidateCore[name],name);await writeFile(S+'/C/'+name,value);}
 for(const [name,digest] of Object.entries(manifest.candidateCore))assert.equal(hash(await readFile(S+'/C/'+name)),digest,name);
 for(const [name,digest] of Object.entries(manifest.baselineCore))assert.equal(hash(await readFile('/source/'+name)),digest,name);
 for(const name of ['r104-generations.mjs','r114-modes.mjs','decoder-preload.mjs','extract.mjs'])await cp(H+'assets/'+name,S+'/prep/'+name);
 await cp(H+'assets/portable-driver.mjs',S+'/prep/portable-driver.mjs');await cp(H+'child-entry.mjs',S+'/prep/child-entry.mjs');
 await cell(1,'process',0);await cell(2,'thread',1);
 assert.equal(expired,false);result.status='correct';result.passed=true;
}catch{report.failureCode=expired?'supervisor-deadline':'native-or-preparation-failed';result.status='failed';result.passed=false;stage('error');process.exitCode=1;}
finally{
 stage('cleanup-start');await Promise.all([...active.values()]);clearTimeout(deadline);
 result.cleanupPassed=active.size===0&&result.processStatus==='correct'&&result.threadStatus==='correct';
 if(expired||!result.cleanupPassed){result.status='failed';result.passed=false;process.exitCode=1;}
 result.elapsedMs=Math.round(performance.now()-started);report.result=result;
 await writeFile('/scratch/r130-case-report.json',JSON.stringify(report)+'\n');
 const encoded=JSON.stringify(result)+'\n';assert.ok(Buffer.byteLength(encoded)<=32768);
 await writeFile('/scratch/case-result.json',encoded);stage('cleanup-end');stage('result');
}
