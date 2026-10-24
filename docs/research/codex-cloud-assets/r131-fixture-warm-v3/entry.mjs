import {verifyRuntime,expectedManifestArgument} from './runtime-integrity.mjs';
import {publicCaseResult} from './case-result-adapter.mjs';
import {diagnostic,checkedDiagnostic,setDiagnosticContext} from './diagnostics.mjs';
// v4: actual exported candidate source; native execution remains UNRUN.
import fs from 'node:fs';import {fork} from 'node:child_process';import {fileURLToPath} from 'node:url';import {PIN} from './protocol.mjs';import {install} from './install-v4.mjs';
const root=fileURLToPath(new URL('./',import.meta.url));
const stageFD=Number(process.env.PERF_STAGE_FD);if(stageFD!==3)throw Error('raw FD3 stage-pipe required');
const handle=fs.fstatSync(3);if(process.send||(!handle.isFIFO()&&!handle.isSocket()))throw Error('raw wrapper pipe required');
const stage=(name,extra={})=>fs.writeSync(stageFD,JSON.stringify({stage:name,protocol:'r131-borrow-declaration-v4',...extra})+'\n');
const resultPath=process.env.PERF_CASE_RESULT;if(resultPath!=='/scratch/case-result.json')throw Error('owned case-result path required');
let child,result={correct:false,failed:true,native:'UNRUN',records:[],diagnostics:[]};let operation='entry-admission';const track=(op,error,outcome='progress')=>{operation=op;result.diagnostics.push(diagnostic(op,error,outcome));};
try{
 stage('start',{sourceCommit:PIN});
 track('manifest-check');result.runtimeManifest=verifyRuntime(expectedManifestArgument(process.argv.slice(2)));
 if(process.version!=='v24.19.0'||process.env.PERF_SOURCE_ROOT!=='/source'||process.env.PERF_OUTPUT_ROOT!=='/scratch'||process.env.PERF_HARNESS_ROOT!=='/harness')throw Error('runtime/public mount admission mismatch');
 // Install the reviewed versioned composition from actual source exports.
 track('source-install');result.install=install();stage('overlay-ready',{patchSHA256:result.install.patchSHA256});
 for(const mode of ['thread','process']){
  setDiagnosticContext('none',mode);track('cell-launch');
  stage('episode-start',{mode});
  const env={...process.env,R131_CANDIDATE_ROOT:'/scratch/candidate'};delete env.PERF_STAGE_FD;
  for(const key of Object.keys(env))if(key.startsWith('RS3_')||key.startsWith('NODE_TEST')||key==='NODE_OPTIONS')delete env[key];
  const cell=await new Promise((resolve,reject)=>{
   child=fork(new URL('./native-cell-v3.mjs',import.meta.url),['--authorized-native','--mode='+mode],{env,execArgv:['--max-old-space-size=768'],stdio:['ignore','inherit','inherit','ipc'],serialization:'advanced'});
   track('cell-wait');let receipt;const timer=setTimeout(()=>{const error=Error('cell deadline');track('cell-timeout',error,'failed');child.kill('SIGKILL');reject(error);},60000);
   child.on('message',m=>{const safe=checkedDiagnostic(m);if(safe){result.diagnostics.push(safe);return;}if(m.type==='result')receipt=m;});child.once('error',error=>{track('child-error',error,'failed');reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timer);if(code!==0||signal||!receipt?.correct){const error=Object.assign(Error('native cell failed'),{receipt});track('child-exit',error,'failed');reject(error);}else resolve({...receipt,exitObserved:true});});
  });result.records.push({mode,...cell});stage('episode-end',{mode});
 }result={...result,correct:true,failed:false,native:'PASS'};
}catch(error){track(operation,error,'failed');if(error.receipt)result.records.push(error.receipt);result.error=error.stack;result.remaining='UNRUN';stage('error');process.exitCode=1;}
finally{if(child?.connected)child.kill('SIGKILL');const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');fs.writeFileSync('/scratch/full-report.json',bytes);const compact=publicCaseResult(result,bytes);if(!compact.passed)process.exitCode=1;fs.writeFileSync(resultPath,JSON.stringify(compact)+'\n');stage('result',{passed:compact.passed});}
