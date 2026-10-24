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
import {assessMetrics} from './screen.mjs';
const H=fileURLToPath(new URL('./',import.meta.url)),S='/scratch/r138',PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
const sha=b=>createHash('sha256').update(b).digest('hex'),stage=stage=>writeSync(3,JSON.stringify({stage})+'\n');
const summary={schema:'r138-http-component-v1',status:'failed',passed:false,cleanupPassed:false,count:0,elapsedMs:0,sourceCommit:PIN,metrics:{}};
const report={schema:'r138-http-full-report-v1',scope:'unshaped-local-HTTP-component; no40ms/UI/SLO claim',plan:schedule(),cells:[],remaining:[],history:'Exact existing PR8 product candidate; R63 is conformance only and supplies no accepted paired speedup'};
report.cellStates=schedule().map(cell=>({...cell,status:'UNRUN',reportPath:S+'/cell-'+cell.index+'/report.json'}));
let child,activeClose,expired=false,allClosed=true,reference,referenceRows;const began=performance.now();
let operationCode='r138-entry-admission',cellOrdinal=null;const failures=firstFailureRecorder();
const remember=error=>failures.capture(error,operationCode,cellOrdinal,summary.count);
let deadline;const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(k==='PERF_STAGE_FD'||k.startsWith('RS3_')||['NODE_PATH','NODE_OPTIONS','NODE_V8_COVERAGE'].includes(k)||k.startsWith('NODE_TEST_')||k.startsWith('NODE_CHANNEL_'))));
async function verifyTree(root,files,changed={}){
 for(const f of files)assert.equal(sha(await readFile(root+'/'+f.path)),changed[f.path]??f.sha256,f.path);
}
async function one(cell){
 cellOrdinal=cell.index;operationCode='r138-child-start';report.cellStates[cell.index].status='RUNNING';
 stage('episode-start');assert.equal(expired,false);
 const output=S+'/cell-'+cell.index,logs=[];let bytes=0,timedOut=false,closed=false;
 child=fork(H+'http-child.mjs',[S+'/'+cell.arm,output],{execPath:'/runtime/node',execArgv:['--max-old-space-size=768'],env,cwd:S,stdio:['ignore','pipe','pipe','ipc']});allClosed=false;
 activeClose=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;allClosed=true;resolve({code,signal});}));
 child.once('error',error=>failures.capture(error,'r138-child-start',cell.index,summary.count));
 child.on('message',message=>{if(message?.kind==='r138-first-failure'){try{failures.accept(message.diagnostic,cell.index,summary.count);}catch(error){remember(error);}}});
 const stopSampling=sampleOwned(child.pid);
 const ondata=b=>{bytes+=b.length;if(bytes<=1048576)logs.push(b);else child.kill('SIGTERM');};child.stdout.on('data',ondata);child.stderr.on('data',ondata);
 const term=setTimeout(()=>{failures.capture(Object.assign(new Error('cell deadline'),{code:'ETIMEDOUT'}),'r138-child-wait',cell.index,summary.count);timedOut=true;child.kill('SIGTERM');},130000),kill=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},135000);
 operationCode='r138-child-wait';let outcome,resources;try{outcome=await activeClose;}finally{clearTimeout(term);clearTimeout(kill);resources=await stopSampling();await writeFile(S+'/cell-'+cell.index+'.resources.json',JSON.stringify(resources));await writeFile(S+'/cell-'+cell.index+'.log',Buffer.concat(logs));}
 operationCode='r138-resource-validation';assert.equal(failures.value,undefined,'child-first-failure');assert.equal(expired,false);assert.equal(timedOut,false);assert.ok(bytes<=1048576);assert.equal(outcome.code,0);assert.equal(outcome.signal,null);assert.equal(resources.errors.length,0);
 operationCode='r138-descendant-drain';for(const pid of new Set(resources.samples.map(x=>x.pid))){
  const drainBy=performance.now()+2000;
  while(performance.now()<drainBy){try{await access('/proc/'+pid);}catch(e){if(e.code==='ENOENT')break;throw e;}await new Promise(resolve=>setTimeout(resolve,20));}
  await assert.rejects(access('/proc/'+pid),{code:'ENOENT'});
 }
 operationCode='r138-child-report-read';const raw=JSON.parse(await readFile(output+'/report.json','utf8'));assert.equal(raw.status,'FEASIBLE-HTTP-ONLY');
 assert.ok(raw.milestones.some(x=>x.name==='normal-close-complete'));
 operationCode='r138-provider-validation';checkProvider(raw.provider.files,reference?.provider.files,cell.arm,raw.provider.status.digest,evidence=>Object.assign(summary,evidence));
 if(!reference)reference=raw;
 operationCode='r138-first-body-read';const body=JSON.parse(await readFile(output+'/first-planning.json','utf8')),rows=JSON.stringify(body.rows);
 operationCode='r138-row-validation';
 assert.equal(body.rows.length,772);assert.equal(Buffer.byteLength(rows),408272);assert.equal(sha(rows),'e4d73ab056534151b33dc98ef53da7326c025b3d5eb347cb50eaa0efeec58519');
 if(referenceRows===undefined)referenceRows=rows;else assert.equal(rows,referenceRows);
 if(raw.warmupControl.status==='PROVEN-READY'){operationCode='r138-warm-body-read';const warm=JSON.parse(await readFile(output+'/completed-warmup-planning.json','utf8'));assert.equal(JSON.stringify(warm.rows),rows);}
 report.cells.push({cell,outcome,report:raw,bodyPath:output+'/first-planning.json'});
 operationCode='r138-metric-record';const first=raw.responses.find(x=>x.label==='first-planning');assert.ok(first);
 summary.metrics['r138Cell'+cell.index+'ReadyMs']=raw.createToReadyMs;summary.metrics['r138Cell'+cell.index+'FirstBodyMs']=first.bodyCompleteMs;
 const warm=raw.responses.find(x=>x.label==='completed-warmup-planning');if(warm)summary.metrics['r138Cell'+cell.index+'WarmBodyMs']=warm.bodyCompleteMs;
 summary.count++;report.cellStates[cell.index].status='correct';stage('episode-end');
}
try{
 stage('start');assert.equal(process.version,'v24.19.0');assert.equal(process.argv.length,2);assert.equal(process.env.NODE_PATH,'/deps/node_modules');
 deadline=setTimeout(()=>{operationCode='r138-controller-deadline';remember(Object.assign(new Error('controller deadline'),{code:'ETIMEDOUT'}));expired=true;child?.kill('SIGTERM');setTimeout(()=>{if(!allClosed)child?.kill('SIGKILL');},5000).unref();},1120000);
 operationCode='r138-harness-read';const manifestRaw=await readFile(H+'manifest.json');const m=JSON.parse(manifestRaw),lock=JSON.parse(await readFile('/scratch/source-lock.json','utf8'));assert.equal(lock.sourceCommit,PIN);assert.equal(m.candidateCommit,'157e16614bcd248df96070a4c3482e0691b18594');summary.r138PacketManifestSha256=sha(manifestRaw);
 operationCode='r138-harness-verify';for(const f of m.files)assert.equal(sha(await readFile(H+f.path)),f.sha256,f.path);
 operationCode='r138-source-verify';await verifyTree('/source',lock.files);operationCode='r138-scratch-create';await mkdir(S);
 operationCode='r138-source-copy';await cp('/source',S+'/A',{recursive:true});await cp('/source',S+'/C',{recursive:true});
 operationCode='r138-patch-read';const inputs=new Map();for(const name of Object.keys(m.patchOutputs))inputs.set(name,await readFile(S+'/C/'+name,'utf8'));
 const patch=await readFile(H+'pr8-advisory-ready.patch','utf8');assert.equal(Buffer.byteLength(patch),6043);assert.equal(sha(patch),'3d38008dfb6d0eaf9f52d326a7e61b868c396b90b11928720b759088688ce70f');
 operationCode='r138-patch-apply';for(const [name,data]of applyUnifiedPatch(patch,inputs)){assert.equal(sha(data),m.patchOutputs[name]);await writeFile(S+'/C/'+name,data);}
 operationCode='r138-candidate-verify';await verifyTree(S+'/A',lock.files);await verifyTree(S+'/C',lock.files,m.patchOutputs);
 operationCode='r138-dependency-link';for(const arm of ['A','C'])await symlink('/deps/node_modules',S+'/'+arm+'/node_modules','dir');
 for(const cell of schedule())await one(cell);
 cellOrdinal=null;operationCode='r138-source-postflight';await verifyTree('/source',lock.files);await verifyTree(S+'/A',lock.files);await verifyTree(S+'/C',lock.files,m.patchOutputs);
 operationCode='r138-screen-classify';const screen=assessMetrics(summary.metrics);Object.assign(summary,screen.fields);Object.assign(summary.metrics,screen.metrics);report.screen=screen;summary.code='r138-screen-complete';summary.status='correct';summary.passed=true;
}catch(error){remember(error);for(const cell of report.cellStates)if(cell.status==='RUNNING')cell.status='failed';summary.status='failed';summary.passed=false;process.exitCode=1;report.failure=expired?'controller-deadline':'first-validation-resource-runtime-or-cleanup-failure';stage('error');}
finally{
 stage('cleanup-start');operationCode='r138-cleanup';try{if(activeClose)await activeClose;}catch(error){remember(error);summary.passed=false;summary.status='failed';process.exitCode=1;}clearTimeout(deadline);summary.cleanupPassed=allClosed&&summary.passed;
 summary.completedCellCount=summary.count;Object.assign(summary,failures.value??{});
 summary.elapsedMs=performance.now()-began;report.remaining=report.cellStates.filter(cell=>cell.status==='UNRUN');report.summary=summary;
 operationCode='r138-report-write';try{await writeFile('/scratch/r138-full-report.json',JSON.stringify(report)+'\n');}catch(error){remember(error);Object.assign(summary,failures.value);summary.status='failed';summary.passed=false;process.exitCode=1;}
 operationCode='r138-result-write';const data=JSON.stringify(summary)+'\n';assert.ok(Buffer.byteLength(data)<=32768);await writeFile('/scratch/case-result.json',data);
 stage('cleanup-end');stage('result');
}
