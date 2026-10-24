import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,writeSync,createWriteStream,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {immutableExpected} from './case-comparison.mjs';
import {fileURLToPath} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex'),out='/scratch/r124-full-result.json';
const outerStage=stage=>writeSync(3,JSON.stringify({stage})+'\n');
const report={schema:'r124-hard-docker-result-v1',contract:'docker-hard-2cpu-6g-v1',status:'running',arms:{baseline:{status:'UNRUN'},candidate:{status:'UNRUN'}},comparison:null};
const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');
try{
 assert.equal(process.versions.node,'24.19.0');assert.equal(sha(readFileSync(process.execPath)),'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12');
 assert.equal(existsSync(out),false,'fresh owned scratch required');
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('RS3_')||k.startsWith('R67_')||k.startsWith('NODE_TEST_')||['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_DEBUG','NODE_DEBUG_NATIVE','PERF_STAGE_FD'].includes(k))delete env[k];
 const stages=[];let baselineExpected=null;
 for(const arm of ['baseline','candidate']){
  report.arms[arm]={status:'running'};save();
  const stdout=createWriteStream(`/scratch/${arm}.stdout.log`,{flags:'wx'}),stderr=createWriteStream(`/scratch/${arm}.stderr.log`,{flags:'wx'});
  // This supervisor exclusively owns the IPC endpoint; fd3 is supplied only to
  // its own direct child. Every arm has a fresh process and module cache.
  const child=spawn('/runtime/node',['--max-old-space-size=4096',fileURLToPath(new URL('./case-entry.mjs',import.meta.url)),arm],{env,cwd:'/scratch',stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);let complete=false,protocolError=null,expectedSent=false;
  child.on('message',m=>{
   if(m?.schema!=='r124-stage-v1'||m.arm!==arm){protocolError='unexpected IPC message';child.kill('SIGTERM');return;}
   if(m.stage==='awaiting-baseline'){
    if(arm!=='candidate'||expectedSent||baselineExpected===null){protocolError='unexpected baseline expectation request';child.kill('SIGTERM');return;}
    expectedSent=true;
    child.send({schema:'r124-baseline-expected-v1',arm,expected:baselineExpected},error=>{if(error){protocolError='baseline expectation delivery failed';child.kill('SIGTERM');}});
   }
   stages.push(m);if(m.stage==='case-complete'&&m.cases===8)complete=true;writeFileSync('/scratch/stages.ndjson',stages.map(x=>JSON.stringify(x)).join('\n')+'\n');
   const mapped=m.stage==='scope-gates'?(arm==='baseline'?'reference-start':'measured-start'):m.stage==='before-app-import'?(arm==='baseline'?'reference-ready':'measured-ready'):m.stage==='case-complete'&&arm==='baseline'?'reference-close':null;
   if(mapped)outerStage(mapped);
  });
  const exit=await new Promise((ok,no)=>{child.on('error',no);child.on('exit',(code,signal)=>ok({code,signal}));});
  await Promise.all([new Promise(ok=>stdout.writableFinished?ok():stdout.once('finish',ok)),new Promise(ok=>stderr.writableFinished?ok():stderr.once('finish',ok))]);
  let artifact=null;try{artifact=JSON.parse(readFileSync(`/scratch/${arm}/case-result.json`));}catch{}
  report.arms[arm]={status:exit.code===0&&exit.signal===null&&complete&&!protocolError&&artifact?.status==='complete'&&(arm==='baseline'||expectedSent)?'complete':'failed',exit,ipcComplete:complete,expectedSent,protocolError,artifact};save();
  if(report.arms[arm].status!=='complete')throw Error(`${arm} failed; remaining arm UNRUN`);
  if(arm==='baseline')baselineExpected=immutableExpected(artifact.results);
 }
 const B=report.arms.baseline.artifact.results,C=report.arms.candidate.artifact.results;
 report.comparison={status:'running',providerDigests:{baseline:B.providerDigest,candidate:C.providerDigest},sourceSensitiveDigestsComparedSeparately:true};
 for(const k of ['fixtureSHA256','definitionsHash','stateHash','migration','catalogueCounts'])assert.ok(isDeepStrictEqual(B[k],C[k]),`identity mismatch ${k}`);
 assert.equal(B.results.length,8);assert.equal(C.results.length,8);
 for(let i=0;i<8;i++)for(const k of ['owner','label','inputHash','semanticHash','rows','statuses','metrics','eligibilityCacheHit'])assert.ok(isDeepStrictEqual(B.results[i][k],C.results[i][k]),`case ${i} mismatch ${k}`);
 report.comparison.status='matched';report.comparison.onlyExcludedField='exact root metrics.elapsedMs; values retained separately including cached/historical';report.status='complete';save();
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};save();console.error(error.stack);process.exitCode=1;}
