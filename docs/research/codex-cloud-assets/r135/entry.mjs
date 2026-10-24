import assert from 'node:assert/strict';
import {readFile,writeFile,cp,mkdir,symlink,access,readdir} from 'node:fs/promises';
import {writeSync} from 'node:fs';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {applyUnifiedPatch} from './strict-patch.mjs';
import {schedule,checkProvider} from './protocol.mjs';
import {sampleOwned} from './resources.mjs';
import {firstFailureRecorder} from './diagnostics.mjs';
const H=fileURLToPath(new URL('./',import.meta.url)),S='/scratch/r135',PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
const sha=b=>createHash('sha256').update(b).digest('hex'),stage=stage=>writeSync(3,JSON.stringify({stage})+'\n');
const summary={schema:'r135-http-component-v1',status:'failed',passed:false,cleanupPassed:false,count:0,elapsedMs:0,sourceCommit:PIN,metrics:{}};
const report={schema:'r135-http-full-report-v1',scope:'unshaped-local-HTTP-component; no40ms/UI/SLO claim',plan:schedule(),cells:[],remaining:[],history:'R94 guard failure preserved; no R94 performance acceptance; R130 tiny conformance does not prove full-public performance'};
report.cellStates=schedule().map(cell=>({...cell,status:'UNRUN',reportPath:S+'/cell-'+cell.index+'/report.json'}));
let child,activeClose,expired=false,allClosed=true,reference,referenceRows;const began=performance.now();
let operationCode='r135-entry-admission',cellOrdinal=null;const failures=firstFailureRecorder();
const remember=error=>failures.capture(error,operationCode,cellOrdinal,summary.count);
let deadline;const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(k==='PERF_STAGE_FD'||k.startsWith('RS3_')||['NODE_PATH','NODE_OPTIONS','NODE_V8_COVERAGE'].includes(k)||k.startsWith('NODE_TEST_')||k.startsWith('NODE_CHANNEL_'))));
async function verifyTree(root,files,changed={}){
 for(const f of files)assert.equal(sha(await readFile(root+'/'+f.path)),changed[f.path]??f.sha256,f.path);
}
async function one(cell){
 cellOrdinal=cell.index;operationCode='r135-child-start';report.cellStates[cell.index].status='RUNNING';
 stage('episode-start');assert.equal(expired,false);
 const output=S+'/cell-'+cell.index,logs=[];let bytes=0,timedOut=false,closed=false;
 child=fork(H+'http-child.mjs',[S+'/'+cell.arm,output],{execPath:'/runtime/node',execArgv:['--max-old-space-size=768'],env,cwd:S,stdio:['ignore','pipe','pipe','ipc']});allClosed=false;
 activeClose=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;allClosed=true;resolve({code,signal});}));
 child.once('error',error=>failures.capture(error,'r135-child-start',cell.index,summary.count));
 child.on('message',message=>{if(message?.kind==='r135-first-failure'){try{failures.accept(message.diagnostic,cell.index,summary.count);}catch(error){remember(error);}}});
 const stopSampling=sampleOwned(child.pid);
 const ondata=b=>{bytes+=b.length;if(bytes<=1048576)logs.push(b);else child.kill('SIGTERM');};child.stdout.on('data',ondata);child.stderr.on('data',ondata);
 const term=setTimeout(()=>{failures.capture(Object.assign(new Error('cell deadline'),{code:'ETIMEDOUT'}),'r135-child-wait',cell.index,summary.count);timedOut=true;child.kill('SIGTERM');},130000),kill=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},135000);
 operationCode='r135-child-wait';let outcome,resources;try{outcome=await activeClose;}finally{clearTimeout(term);clearTimeout(kill);resources=await stopSampling();await writeFile(S+'/cell-'+cell.index+'.resources.json',JSON.stringify(resources));await writeFile(S+'/cell-'+cell.index+'.log',Buffer.concat(logs));}
 operationCode='r135-resource-validation';assert.equal(failures.value,undefined,'child-first-failure');assert.equal(expired,false);assert.equal(timedOut,false);assert.ok(bytes<=1048576);assert.equal(outcome.code,0);assert.equal(outcome.signal,null);assert.equal(resources.errors.length,0);
 operationCode='r135-descendant-drain';for(const pid of new Set(resources.samples.map(x=>x.pid))){
  const drainBy=performance.now()+2000;
  while(performance.now()<drainBy){try{await access('/proc/'+pid);}catch(e){if(e.code==='ENOENT')break;throw e;}await new Promise(resolve=>setTimeout(resolve,20));}
  await assert.rejects(access('/proc/'+pid),{code:'ENOENT'});
 }
 operationCode='r135-child-report-read';const raw=JSON.parse(await readFile(output+'/report.json','utf8'));assert.equal(raw.status,'FEASIBLE-HTTP-ONLY');
 assert.ok(raw.milestones.some(x=>x.name==='normal-close-complete'));
 operationCode='r135-provider-validation';checkProvider(raw.provider.files,reference?.provider.files,cell.arm);
 if(!reference)reference=raw;
 operationCode='r135-first-body-read';const body=JSON.parse(await readFile(output+'/first-planning.json','utf8')),rows=JSON.stringify(body.rows);
 operationCode='r135-row-validation';
 assert.equal(body.rows.length,772);assert.equal(Buffer.byteLength(rows),408272);assert.equal(sha(rows),'e4d73ab056534151b33dc98ef53da7326c025b3d5eb347cb50eaa0efeec58519');
 if(referenceRows===undefined)referenceRows=rows;else assert.equal(rows,referenceRows);
 if(raw.warmupControl.status==='PROVEN-READY'){operationCode='r135-warm-body-read';const warm=JSON.parse(await readFile(output+'/completed-warmup-planning.json','utf8'));assert.equal(JSON.stringify(warm.rows),rows);}
 report.cells.push({cell,outcome,report:raw,bodyPath:output+'/first-planning.json'});
 operationCode='r135-metric-record';const first=raw.responses.find(x=>x.label==='first-planning');assert.ok(first);
 summary.metrics['r135Cell'+cell.index+'ReadyMs']=raw.createToReadyMs;summary.metrics['r135Cell'+cell.index+'FirstBodyMs']=first.bodyCompleteMs;
 const warm=raw.responses.find(x=>x.label==='completed-warmup-planning');if(warm)summary.metrics['r135Cell'+cell.index+'WarmBodyMs']=warm.bodyCompleteMs;
 summary.count++;report.cellStates[cell.index].status='correct';stage('episode-end');
}
try{
 stage('start');assert.equal(process.version,'v24.19.0');assert.equal(process.argv.length,2);assert.equal(process.env.NODE_PATH,'/deps/node_modules');
 deadline=setTimeout(()=>{operationCode='r135-controller-deadline';remember(Object.assign(new Error('controller deadline'),{code:'ETIMEDOUT'}));expired=true;child?.kill('SIGTERM');setTimeout(()=>{if(!allClosed)child?.kill('SIGKILL');},5000).unref();},1120000);
 operationCode='r135-harness-read';const m=JSON.parse(await readFile(H+'manifest.json','utf8')),lock=JSON.parse(await readFile('/scratch/source-lock.json','utf8'));assert.equal(lock.sourceCommit,PIN);
 operationCode='r135-harness-verify';for(const f of m.files)assert.equal(sha(await readFile(H+f.path)),f.sha256,f.path);
 operationCode='r135-source-verify';await verifyTree('/source',lock.files);operationCode='r135-scratch-create';await mkdir(S);
 operationCode='r135-source-copy';await cp('/source',S+'/A',{recursive:true});await cp('/source',S+'/C',{recursive:true});
 operationCode='r135-patch-read';const inputs=new Map();for(const name of Object.keys(m.patchOutputs))inputs.set(name,await readFile(S+'/C/'+name,'utf8'));
 const patch=await readFile(H+'r49-production-v2.patch','utf8');assert.equal(Buffer.byteLength(patch),3734);assert.equal(sha(patch),'de1710639fdf88a57d6d7d945c310c89e06dc99635dbbb7898c33e963a572c9a');
 operationCode='r135-patch-apply';for(const [name,data]of applyUnifiedPatch(patch,inputs)){assert.equal(sha(data),m.patchOutputs[name]);await writeFile(S+'/C/'+name,data);}
 operationCode='r135-candidate-verify';await verifyTree(S+'/A',lock.files);await verifyTree(S+'/C',lock.files,m.patchOutputs);
 operationCode='r135-dependency-link';for(const arm of ['A','C'])await symlink('/deps/node_modules',S+'/'+arm+'/node_modules','dir');
 for(const cell of schedule())await one(cell);
 cellOrdinal=null;operationCode='r135-source-postflight';await verifyTree('/source',lock.files);await verifyTree(S+'/A',lock.files);await verifyTree(S+'/C',lock.files,m.patchOutputs);
 summary.status='correct';summary.passed=true;
}catch(error){remember(error);for(const cell of report.cellStates)if(cell.status==='RUNNING')cell.status='failed';summary.status='failed';summary.passed=false;process.exitCode=1;report.failure=expired?'controller-deadline':'first-validation-resource-runtime-or-cleanup-failure';stage('error');}
finally{
 stage('cleanup-start');operationCode='r135-cleanup';try{if(activeClose)await activeClose;}catch(error){remember(error);summary.passed=false;summary.status='failed';process.exitCode=1;}clearTimeout(deadline);summary.cleanupPassed=allClosed&&summary.passed;
 summary.completedCellCount=summary.count;Object.assign(summary,failures.value??{});
 summary.elapsedMs=performance.now()-began;report.remaining=report.cellStates.filter(cell=>cell.status==='UNRUN');report.summary=summary;
 operationCode='r135-report-write';try{await writeFile('/scratch/r135-full-report.json',JSON.stringify(report)+'\n');}catch(error){remember(error);Object.assign(summary,failures.value);summary.status='failed';summary.passed=false;process.exitCode=1;}
 operationCode='r135-result-write';const data=JSON.stringify(summary)+'\n';assert.ok(Buffer.byteLength(data)<=32768);await writeFile('/scratch/case-result.json',data);
 stage('cleanup-end');stage('result');
}
