import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,writeSync,mkdirSync,copyFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {schedule,modes,assess} from './screen-core.mjs';
import {diagnostic,operations,safeFailure,validFailure,firstFailure,bindChildFailure} from './diagnostic.mjs';
const packet=dirname(fileURLToPath(import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex');
const stage=x=>writeSync(3,JSON.stringify({stage:x})+'\n');
const publicResult={schema:'r134-engine-performance-v1',mode:'r134-owner-evaluate-screen-v1',status:'failed',passed:false,code:'runtime-error',metrics:{}};
const report={schema:'r134-raw-performance-v1',fixtureScope:'authored-r38-alpha-only; no user distribution; no group API',pairs:[],status:'running'};
let active,timer,watchdog,deadlineExceeded=false;
let firstDiagnostic=null,nextProcessOrdinal=0,observedTimed,observedVerified,completedProcesses;
const capture=(error,operation,processOrdinal,caseOrdinal)=>{firstDiagnostic=firstFailure(firstDiagnostic,safeFailure(error,{operation,processOrdinal,caseOrdinal}));};
const closedError=code=>Object.assign(new Error(),{code});
const publish=()=>{
 if(firstDiagnostic)Object.assign(publicResult,firstDiagnostic);
 if(observedTimed!==undefined)publicResult.r134ObservedTimedSamples=observedTimed;
 if(observedVerified!==undefined)publicResult.r134ObservedVerifiedSamples=observedVerified;
 if(completedProcesses!==undefined)publicResult.r134CompletedProcesses=completedProcesses;
 writeFileSync('/scratch/case-result.json',JSON.stringify(publicResult)+'\n',{flag:'wx',mode:0o600});
};
const save=()=>writeFileSync('/scratch/r134-full-result.json',JSON.stringify(report,null,2)+'\n');
async function arm(pair,position,expectedPath){
 diagnostic.mark('arm-spawn');
 const processOrdinal=nextProcessOrdinal++;
 assert.equal(deadlineExceeded,false,'whole screen deadline');
 const processStarted=performance.now();
 const label=pair.arms[position],arm=label==='A'?'baseline':'candidate',out=`/scratch/r134-${pair.kind}${pair.rep}-p${position}`;
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('RS3_')||k.startsWith('R67_')||k.startsWith('NODE_TEST_')||['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','PERF_STAGE_FD','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE'].includes(k))delete env[k];
 active=spawn('/runtime/node',['--max-old-space-size=3072',resolve(packet,'arm.mjs'),arm,label==='A'?'/source':'/scratch/r134-candidate-source',out,expectedPath],{cwd:'/scratch',env,stdio:['ignore','ignore','ignore','ipc']});
 let artifact=null,seen=0,timedSeen=0,protocol=null,timedOut=false,childFailure=false;
 const protocolFailure=()=>{protocol='invalid child IPC';capture(closedError('child-ipc-protocol'),'arm-ipc',processOrdinal);active.kill('SIGTERM');};
 active.on('message',m=>{
  if(m?.schema!=='r134-child-v1'){protocolFailure();return;}
  if(m.stage==='operation'){
   if(!operations.includes(m.operation)||(Object.hasOwn(m,'caseOrdinal')&&(!Number.isInteger(m.caseOrdinal)||m.caseOrdinal<0||m.caseOrdinal>3)))protocolFailure();
  }else if(m.stage==='sample-timed'){
   if(m.count!==timedSeen+1||m.count>4){protocolFailure();return;}timedSeen++;observedTimed=(observedTimed??0)+1;
  }else if(m.stage==='case-verified'){
   if(m.index!==seen+1||m.index>4){protocolFailure();return;}seen++;observedVerified=(observedVerified??0)+1;
  }else if(m.stage==='failure'){
   if(!validFailure(m.failure)||(Object.hasOwn(m,'caseOrdinal')&&(!Number.isInteger(m.caseOrdinal)||m.caseOrdinal<0||m.caseOrdinal>3))){protocolFailure();return;}
   const counts=m.counts;
   if(!counts||Object.keys(counts).some(k=>!['timedSamples','verifiedSamples'].includes(k))||Object.values(counts).some(n=>!Number.isInteger(n)||n<1||n>4)){protocolFailure();return;}
   if(counts.timedSamples!==undefined&&counts.verifiedSamples!==undefined&&counts.verifiedSamples>counts.timedSamples){protocolFailure();return;}
   if(counts.timedSamples>timedSeen){observedTimed=(observedTimed??0)+counts.timedSamples-timedSeen;timedSeen=counts.timedSamples;}
   if(counts.verifiedSamples>seen){observedVerified=(observedVerified??0)+counts.verifiedSamples-seen;seen=counts.verifiedSamples;}
   childFailure=true;firstDiagnostic=firstFailure(firstDiagnostic,bindChildFailure(m.failure,processOrdinal,m.caseOrdinal));
  }else if(m.stage==='complete')artifact=m.result;
  else protocolFailure();
 });
 const child=active;timer=setTimeout(()=>{timedOut=true;capture(closedError('child-timeout'),'arm-timeout',processOrdinal);child.kill('SIGTERM');timer=setTimeout(()=>child.kill('SIGKILL'),2000);},65000);
 const exit=await new Promise((ok,no)=>{child.once('error',error=>{capture(error,'arm-spawn',processOrdinal);no(error);});child.once('close',(code,signal)=>ok({code,signal}));});clearTimeout(timer);active=null;
 if(timedOut||protocol||childFailure||exit.code!==0||exit.signal!==null||seen!==4||artifact?.results?.length!==4)capture(closedError('child-exit-failed'),'arm-exit',processOrdinal);
 assert.ok(!timedOut&&!protocol&&!childFailure&&exit.code===0&&exit.signal===null&&seen===4&&artifact?.results?.length===4,'arm failed/timeout/incomplete');
 completedProcesses=(completedProcesses??0)+1;
 return {artifact,out,exit,pid:child.pid,processWallMs:performance.now()-processStarted};
}
try{
 diagnostic.mark('entry-admission');
 stage('start');const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],'--packet-sha256');assert.match(args[1],/^[0-9a-f]{64}$/);assert.equal(args[2],'--seconds');const seconds=Number(args[3]);assert.ok(Number.isInteger(seconds)&&seconds>=1&&seconds<=860);
 diagnostic.mark('packet-verification');
 assert.equal(sha(readFileSync(resolve(packet,'manifest.json'))),args[1]);publicResult.r134PacketManifestSha256=args[1];
 const manifest=JSON.parse(readFileSync(resolve(packet,'manifest.json')));for(const [name,pin]of Object.entries(manifest.members)){const bytes=readFileSync(resolve(packet,name));assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);}
 diagnostic.mark('scope-admission');
 assert.equal(process.versions.node,'24.19.0');assert.equal(sha(readFileSync(process.execPath)),'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12');
 assert.equal(readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'6442450944');const cpu=readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\s+/).map(Number);assert.equal(cpu[0]/cpu[1],2);
 assert.equal(existsSync('/scratch/absent'),false);assert.equal(existsSync('/scratch/r134-full-result.json'),false);
 watchdog=setTimeout(()=>{deadlineExceeded=true;capture(closedError('screen-deadline'),'screen-deadline');if(active)active.kill('SIGTERM');setTimeout(()=>{if(active)active.kill('SIGKILL');report.status='failed';report.diagnostic=firstDiagnostic;save();if(!existsSync('/scratch/case-result.json'))publish();process.exit(1);},2000);},seconds*1000);
 diagnostic.mark('candidate-source-stage');
 const tree=JSON.parse(readFileSync(resolve(packet,'public-tree.json')));assert.equal(tree.pin,'6f22fefa782747790e2eaefa01e4e5ea7b557323');mkdirSync('/scratch/r134-candidate-source');
 for(const [file,hash]of Object.entries(tree.files)){assert.ok(!file.startsWith('/')&&!file.split('/').includes('..'));const source=resolve('/source',file);assert.ok(lstatSync(source).isFile()&&!lstatSync(source).isSymbolicLink());assert.ok(realpathSync(source).startsWith('/source/'));assert.equal(sha(readFileSync(source)),hash);const target=resolve('/scratch/r134-candidate-source',file);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);}
 copyFileSync(resolve(packet,'candidate-engine.mjs'),'/scratch/r134-candidate-source/app/tasks/engine.mjs');stage('reference-ready');
 for(const spec of schedule){const pair={...spec,rows:[],processes:[]};let expected='none';for(let p=0;p<2;p++){stage(spec.kind==='aa'?'reference-start':'measured-start');const done=await arm(spec,p,expected);pair.rows.push(done.artifact.results);pair.processes.push({position:p,pid:done.pid,processWallMs:done.processWallMs,label:spec.arms[p],directory:done.out,exit:done.exit,setupMetrics:done.artifact.setupMetrics,providerDigest:done.artifact.providerDigest,definitionsHash:done.artifact.definitionsHash,stateHash:done.artifact.stateHash});expected=resolve(done.out,'results.json');for(const key of ['providerSetupMs','constructionMs','migrationCatalogueMs'])publicResult.metrics[`r134_${spec.kind}${spec.rep}_p${p}_${key}`]=done.artifact.setupMetrics[key];for(const row of done.artifact.results)publicResult.metrics[`r134_${spec.kind}${spec.rep}_p${p}_${row.label.replaceAll('-','_')}Ms`]=row.callMs;}
  report.pairs.push(pair);save();
 }
 diagnostic.mark('screen-assessment');
 const rawMetrics=publicResult.metrics;const verdict=assess(report.pairs);Object.assign(publicResult,verdict);publicResult.metrics={...rawMetrics,...verdict.metrics};delete publicResult.rawLogRatios;publicResult.metrics={...publicResult.metrics,...Object.fromEntries(report.pairs.flatMap(pair=>pair.rows.flatMap((rows,p)=>rows.map(row=>[`r134_${pair.kind}${pair.rep}_p${p}_${row.label.replaceAll('-','_')}Ms`,row.callMs]))))};
 diagnostic.mark('result-projection');
 report.assessment=verdict;report.status='complete';save();publicResult.r134RawVectorsSha256=sha(readFileSync('/scratch/r134-full-result.json'));publicResult.r134ProviderProofSha256=sha(readFileSync(resolve(packet,'provider-proof.json')));publicResult.fixtureSha256=sha(readFileSync(resolve(packet,'fixture.json')));publicResult.calculatorBytesSha256=sha(readFileSync(resolve(packet,'candidate-engine.mjs')));publicResult.sourcePin=tree.pin;publicResult.status='correct';publicResult.code='r134-screen-complete';publicResult.passed=true;publicResult.count=48;stage('result');
}catch(error){if(!firstDiagnostic)firstDiagnostic=firstFailure(null,diagnostic.failure(error));report.status='failed';report.diagnostic=firstDiagnostic;save();process.exitCode=1;stage('error');}
finally{clearTimeout(timer);clearTimeout(watchdog);publish();}
