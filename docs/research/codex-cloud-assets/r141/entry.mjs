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
import {reduceTrace} from './reduce-trace.mjs';
const H=fileURLToPath(new URL('./',import.meta.url)),S='/scratch/r141',PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
const sha=b=>createHash('sha256').update(b).digest('hex'),stage=stage=>writeSync(3,JSON.stringify({stage})+'\n');
const summary={schema:'r141-planning-stage-diagnostic-v1',status:'failed',passed:false,cleanupPassed:false,count:0,elapsedMs:0,sourceCommit:PIN,metrics:{},diagnosticOnly:true,acceptance:false,performanceAcceptance:false,productAcceptance:false,allFinalGates:'OPEN'};
const report={schema:'r141-private-diagnostic-report-v1',scope:'instrumented local HTTP authored Alpha first planning only; no performance promotion',plan:schedule(),cells:[],remaining:[]};
report.cellStates=schedule().map(cell=>({...cell,status:'UNRUN'}));
let child,activeClose,expired=false,allClosed=true,reference,referenceRows,manifest;const began=performance.now();
let operationCode='r141-entry-admission',cellOrdinal=null;const failures=firstFailureRecorder();
const remember=error=>failures.capture(error,operationCode,cellOrdinal,summary.count);
let deadline;const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(k==='PERF_STAGE_FD'||k.startsWith('RS3_')||k.startsWith('R141_')||['NODE_PATH','NODE_OPTIONS','NODE_V8_COVERAGE'].includes(k)||k.startsWith('NODE_TEST_')||k.startsWith('NODE_CHANNEL_'))));
async function verifyTree(root,files,changed={}){for(const f of files)assert.equal(sha(await readFile(root+'/'+f.path)),changed[f.path]??f.sha256,f.path);}
async function verifyInstalled(arm){for(const [name,expected]of Object.entries(manifest.installed[arm]))assert.equal(sha(await readFile(S+'/'+arm+'/'+name)),expected,name);}
async function applyPatch(root,patchName,outputs){
 const inputs=new Map();for(const name of Object.keys(outputs))inputs.set(name,await readFile(root+'/'+name,'utf8'));
 const patch=await readFile(H+patchName,'utf8');for(const [name,data]of applyUnifiedPatch(patch,inputs)){assert.equal(sha(data),outputs[name],name);await writeFile(root+'/'+name,data);}
}
async function one(cell){
 cellOrdinal=cell.index;operationCode='r141-child-start';report.cellStates[cell.index].status='RUNNING';stage('episode-start');assert.equal(expired,false);
 const output=S+'/cell-'+cell.index,logs=[];let bytes=0,timedOut=false,closed=false;
 child=fork(H+'http-child.mjs',[S+'/'+cell.arm,output],{execPath:'/runtime/node',execArgv:['--max-old-space-size=768'],env,cwd:S,stdio:['ignore','pipe','pipe','ipc']});allClosed=false;
 activeClose=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;allClosed=true;resolve({code,signal});}));
 child.once('error',error=>failures.capture(error,'r141-child-start',cell.index,summary.count));
 child.on('message',message=>{if(message?.kind==='r141-first-failure'){try{failures.accept(message.diagnostic,cell.index,summary.count);}catch(error){remember(error);}}});
 const stopSampling=sampleOwned(child.pid),ondata=b=>{bytes+=b.length;if(bytes<=1048576)logs.push(b);else child.kill('SIGTERM');};child.stdout.on('data',ondata);child.stderr.on('data',ondata);
 const term=setTimeout(()=>{failures.capture(Object.assign(new Error('cell deadline'),{code:'ETIMEDOUT'}),'r141-child-wait',cell.index,summary.count);timedOut=true;child.kill('SIGTERM');},130000),kill=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},135000);
 operationCode='r141-child-wait';let outcome,resources;try{outcome=await activeClose;}finally{clearTimeout(term);clearTimeout(kill);resources=await stopSampling();await writeFile(S+'/cell-'+cell.index+'.resources.json',JSON.stringify(resources));await writeFile(S+'/cell-'+cell.index+'.log',Buffer.concat(logs));}
 operationCode='r141-resource-validation';assert.equal(failures.value,undefined,'child-first-failure');assert.equal(expired,false);assert.equal(timedOut,false);assert.ok(bytes<=1048576);assert.equal(outcome.code,0);assert.equal(outcome.signal,null);assert.equal(resources.errors.length,0);
 operationCode='r141-descendant-drain';for(const pid of new Set(resources.samples.map(x=>x.pid))){const drainBy=performance.now()+2000;while(performance.now()<drainBy){try{await access('/proc/'+pid);}catch(e){if(e.code==='ENOENT')break;throw e;}await new Promise(resolve=>setTimeout(resolve,20));}await assert.rejects(access('/proc/'+pid),{code:'ENOENT'});}
 operationCode='r141-child-report-read';const raw=JSON.parse(await readFile(output+'/report.json','utf8'));assert.equal(raw.status,'DIAGNOSTIC-HTTP-ONLY');assert.ok(raw.milestones.some(x=>x.name==='normal-close-complete'));assert.equal(raw.responses.length,1);assert.equal(raw.responses[0].label,'first-planning');
 operationCode='r141-provider-validation';for(const provider of [raw.providerBefore,raw.providerAfter])checkProvider(provider.files,reference?.providerBefore.files,cell.arm,provider.status.digest,evidence=>Object.assign(summary,evidence));if(!reference)reference=raw;
 operationCode='r141-first-body-read';const body=JSON.parse(await readFile(output+'/first-planning.json','utf8')),rows=JSON.stringify(body.rows);
 operationCode='r141-row-validation';assert.equal(body.rows.length,772);assert.equal(Buffer.byteLength(rows),408272);assert.equal(sha(rows),'e4d73ab056534151b33dc98ef53da7326c025b3d5eb347cb50eaa0efeec58519');assert.equal(body.cache?.hit,false);if(referenceRows===undefined)referenceRows=rows;else assert.equal(rows,referenceRows);
 operationCode='r141-trace-read';const files={};for(const filename of await readdir(output+'/trace')){assert.match(filename,/^(root-main|endpoint-[0-3]-(host|worker))\.jsonl$/);const bytes=await readFile(output+'/trace/'+filename);assert.ok(bytes.length>0&&bytes.length<=65536);const lines=bytes.toString('utf8').trimEnd().split('\n');assert.ok(lines.length<=96);files[filename.slice(0,-6)]=lines.map(line=>JSON.parse(line));}
 const proofRaw=await readFile(H+'proof-'+cell.arm+'.json'),proof=JSON.parse(proofRaw);assert.equal(sha(proofRaw),manifest.proofSha256[cell.arm]);
 operationCode='r141-trace-reduce';const diagnostic=reduceTrace(files,proof),prefix='r141'+cell.arm;
 for(const [key,value]of Object.entries(diagnostic.metrics))summary.metrics[prefix+key]=value;
 summary.metrics[prefix+'AppCreateToReadyMs']=raw.createToReadyMs;summary.metrics[prefix+'HttpFirstBodyMs']=raw.responses[0].bodyCompleteMs;
 for(const [key,value]of Object.entries(diagnostic.fields))summary[prefix+key[0].toUpperCase()+key.slice(1)]=value;
 summary[prefix+'InstrumentedProofSha256']=sha(proofRaw);
 report.cells.push({cell,outcome,diagnostic,privateTraceFiles:files,report:raw});summary.count++;report.cellStates[cell.index].status='correct';stage('episode-end');
}
try{
 stage('start');assert.equal(process.version,'v24.19.0');assert.equal(process.argv.length,2);assert.equal(process.env.NODE_PATH,'/deps/node_modules');
 deadline=setTimeout(()=>{operationCode='r141-controller-deadline';remember(Object.assign(new Error('controller deadline'),{code:'ETIMEDOUT'}));expired=true;child?.kill('SIGTERM');setTimeout(()=>{if(!allClosed)child?.kill('SIGKILL');},5000).unref();},330000);
 operationCode='r141-harness-read';const manifestRaw=await readFile(H+'manifest.json');manifest=JSON.parse(manifestRaw);const lock=JSON.parse(await readFile('/scratch/source-lock.json','utf8'));assert.equal(lock.sourceCommit,PIN);assert.equal(manifest.candidateCommit,'157e16614bcd248df96070a4c3482e0691b18594');summary.r141PacketManifestSha256=sha(manifestRaw);
 operationCode='r141-harness-verify';for(const f of manifest.files)assert.equal(sha(await readFile(H+f.path)),f.sha256,f.path);
 operationCode='r141-source-verify';await verifyTree('/source',lock.files);operationCode='r141-scratch-create';await mkdir(S);
 operationCode='r141-source-copy';for(const arm of ['A','C'])await cp('/source',S+'/'+arm,{recursive:true});
 operationCode='r141-patch-read';const productPatch=await readFile(H+'pr8-advisory-ready.patch');assert.equal(productPatch.length,6043);assert.equal(sha(productPatch),'3d38008dfb6d0eaf9f52d326a7e61b868c396b90b11928720b759088688ce70f');
 operationCode='r141-patch-apply';await applyPatch(S+'/C','pr8-advisory-ready.patch',manifest.productOutputs);
 for(const arm of ['A','C']){
  operationCode='r141-instrument-apply';await applyPatch(S+'/'+arm,'instrument-'+arm+'.patch',manifest.instrumentedOutputs[arm]);
  operationCode='r141-observer-install';for(const [from,to]of [['observer.mjs','app/r141-observer.mjs'],['trace-contract.mjs','app/r141-trace-contract.mjs'],['proof-'+arm+'.json','app/r141-proof.json']])await writeFile(S+'/'+arm+'/'+to,await readFile(H+from));
  operationCode='r141-candidate-verify';await verifyTree(S+'/'+arm,lock.files,manifest.instrumentedOutputs[arm]);await verifyInstalled(arm);
  operationCode='r141-dependency-link';await symlink('/deps/node_modules',S+'/'+arm+'/node_modules','dir');
 }
 for(const cell of schedule())await one(cell);
 for(const key of ['EngineRows','EquipmentRows','CollectionRows','HouseRows','GeneratedRows'])assert.equal(summary.metrics['r141AWorkerLocal'+key],summary.metrics['r141CWorkerLocal'+key],'unchanged local catalogue counts');
 cellOrdinal=null;operationCode='r141-source-postflight';await verifyTree('/source',lock.files);for(const arm of ['A','C']){await verifyTree(S+'/'+arm,lock.files,manifest.instrumentedOutputs[arm]);await verifyInstalled(arm);}
 summary.sourcePostflightPassed=true;summary.code='r141-diagnostic-complete';summary.status='correct';summary.passed=true;
}catch(error){remember(error);for(const cell of report.cellStates)if(cell.status==='RUNNING')cell.status='failed';summary.status='failed';summary.passed=false;process.exitCode=1;report.failure=expired?'controller-deadline':'first-validation-resource-runtime-trace-or-cleanup-failure';stage('error');}
finally{
 stage('cleanup-start');operationCode='r141-cleanup';try{if(activeClose)await activeClose;}catch(error){remember(error);summary.passed=false;summary.status='failed';process.exitCode=1;}clearTimeout(deadline);summary.cleanupPassed=allClosed&&summary.passed;
 summary.completedCellCount=summary.count;Object.assign(summary,failures.value??{});summary.elapsedMs=performance.now()-began;report.remaining=report.cellStates.filter(cell=>cell.status==='UNRUN');report.summary=summary;
 operationCode='r141-report-write';try{await writeFile('/scratch/r141-private-diagnostic-report.json',JSON.stringify(report)+'\n');}catch(error){remember(error);Object.assign(summary,failures.value);summary.status='failed';summary.passed=false;process.exitCode=1;}
 operationCode='r141-result-write';const data=JSON.stringify(summary)+'\n';assert.ok(Buffer.byteLength(data)<=32768);await writeFile('/scratch/case-result.json',data);stage('cleanup-end');stage('result');
}
