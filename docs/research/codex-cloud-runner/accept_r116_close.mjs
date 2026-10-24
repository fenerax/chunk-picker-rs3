// Host-only observation gate. Importing this file never starts an application.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSync,readFileSync,fstatSync,closeSync,constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PHASES,STATES,COUNTS} from '../codex-cloud-capture/close-observation.mjs';
const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323',SHA=/^[0-9a-f]{64}$/;
const BASELINE={node:'v24.19.0',playwright:'1.62.1',chromium:'151.0.7922.34',chromiumRevision:'1234',platform:'linux/amd64',image:'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac'};
const MODULES={
 'app/server.mjs':{original:'5edc544473fe98ba1bdf42deaf8cceccbea9db5fa9f42d51daa111f3eb9ceb25',observed:'b593b897e46ec1a0b283d3137dfc69d87088e7b8abd8f2e022f0df4800e47807',bytes:189119},
 'app/storage/store.mjs':{original:'bcdd2a3fa7d07403ad76ac34f44e0754ef31ee8f6f204fd29ea0e0231d4b0f06',observed:'cab7a58f5abcb2a11d661697da3ffe242ac20023a3c3661b424b53e6eb7f49c7',bytes:81807},
};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const int=value=>Number.isSafeInteger(value)&&value>=0;
const keys=(value,wanted)=>assert.deepEqual(Object.keys(value).sort(),[...wanted].sort());

export function accepted(final,lock){
 try{
  assert.equal(final.schema,'docker-envelope-final-v1');assert.equal(final.envelope,'docker-hard-2cpu-6g-v1');assert.equal(final.sourceCommit,PIN);assert.equal(final.mode,'browser');assert.equal(final.control,'none');assert.equal(final.passed,true);assert.equal(final.cleanupPassed,true);
  for(const [key,value]of Object.entries(BASELINE))assert.equal(final.baseline[key],value);
  const outer=final.containerCleanup;assert.equal(outer.running,false);assert.equal(outer.pid,0);assert.equal(outer.removed,true);assert.equal(outer.exitCode,0);assert.equal(outer.oomKilled,false);
  assert.equal(final.result.passed,true);assert.equal(final.result.control,'none');assert.equal(final.result.intentionalNegative,false);assert.equal(final.result.orphanReaped,true);
  const c=final.result.caseResult;assert.equal(c.schema,'r116-app-close-diagnostic-v1');assert.equal(c.mode,'r116-close-phases-observation-v1');assert.equal(c.status,'blocked');assert.equal(c.code,'r116-close-observation-complete');assert.equal(c.passed,false);assert.equal(c.acceptance,false);assert.equal(c.cleanupStatus,'complete');assert.equal(c.caseExitCode,0);
  assert.equal(c.sourcePin,PIN);assert.equal(c.harnessManifestSha256,'df34c38e28cae4bcdd6eb52c2f89c5059dd8a7621d52afff67a583fb8f2c4bd2');assert.equal(c.fixtureSha256,'380ffb698ea594ccb1d375321708a4369f50da82fdc796fd91a4a8c8038b8022');
  assert.equal(c.nodeVersion,BASELINE.node);assert.equal(c.chromiumVersion,BASELINE.chromium);
  assert.equal(lock.schemaVersion,1);assert.equal(lock.sourceCommit,PIN);assert.equal(lock.verification,'host-verified-public-git-archive');assert.equal(lock.files.length,1928);
  const names=new Set();for(const row of lock.files){keys(row,['path','bytes','sha256']);assert.equal(typeof row.path,'string');assert.ok(!row.path.startsWith('/')&&!row.path.includes('\\')&&row.path.split('/').every(x=>x&&x!=='..'&&x!=='.'));assert.ok(!names.has(row.path));names.add(row.path);assert.ok(int(row.bytes)&&row.bytes>0);assert.match(row.sha256,SHA);}
  const original=sha(JSON.stringify(lock.files));assert.equal(lock.manifestSha256,original);assert.equal(c.sourceManifestSha256,original);
  const identity=c.closeObservationIdentity;assert.equal(identity.mode,'scratch-source-close-phases-v1');assert.equal(identity.timingEligibility,'diagnostic-only');assert.equal(identity.fileCount,1928);assert.equal(identity.originalManifestSha256,original);
  const derived=lock.files.map(row=>{const module=MODULES[row.path];if(module)assert.equal(row.sha256,module.original);return{path:row.path,bytes:module?.bytes??row.bytes,sha256:module?.observed??row.sha256};});
  assert.ok(Object.keys(MODULES).every(name=>names.has(name)));assert.equal(identity.observedManifestSha256,sha(JSON.stringify(derived)));assert.notEqual(identity.observedManifestSha256,original);
  for(const [key,module]of [['Server',MODULES['app/server.mjs']],['Store',MODULES['app/storage/store.mjs']]]){assert.equal(identity[`original${key}Sha256`],module.original);assert.equal(identity[`observed${key}Sha256`],module.observed);}
  const close=c.referenceCloseDiagnostic;
  for(const [key,value]of Object.entries({attemptStatus:'complete',stopRpcStatus:'acknowledged',stopErrorCode:'none',exitWaitErrorCode:'none',witnessCode:'closed-witness-verified',receiptStatus:'present',exitCode:0,exitSignal:'none',stoppedMessageCount:1,pendingRpcCount:0,closeCompleted:'yes',ownershipStable:'yes',ownerLockPresent:'no',journalCount:0,captureErrorCount:0,driverStage:'complete'}))assert.equal(close[key],value);
  assert.ok(['already-exited','normal-exit'].includes(close.exitWaitStatus));assert.ok(int(close.elapsedMs));assert.ok(int(close.witnessCount)&&close.witnessCount>=1);assert.equal(close.validWitnessCount,close.witnessCount);
  const phases=c.closePhaseDiagnostic;keys(phases,['lastPhase','events','dropped','states','firstMs','lastMs','counts']);assert.ok(PHASES.includes(phases.lastPhase));assert.ok(int(phases.events)&&phases.events>0&&phases.events<=128);assert.equal(phases.dropped,0);
  keys(phases.states,PHASES);keys(phases.firstMs,PHASES);keys(phases.lastMs,PHASES);keys(phases.counts,COUNTS);
  for(const phase of PHASES){const state=phases.states[phase],first=phases.firstMs[phase],last=phases.lastMs[phase];assert.ok(STATES.includes(state)&&!['pending','rejected'].includes(state));if(state==='unobserved'){assert.equal(first,null);assert.equal(last,null);}else{assert.ok(int(first)&&int(last)&&last>=first&&last<=540000);}}
  for(const phase of ['serverPreface','serverAll','serverStore','storeAll','storeReleaseFile','storeReleaseGuard'])assert.equal(phases.states[phase],'fulfilled');
  for(const count of Object.values(phases.counts))assert.ok(count===null||int(count));
  // No measured opening, All transition or RTT acceptance is inferred here.
  return true;
 }catch{return false;}
}

function readJson(filename){
 const fd=openSync(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{const info=fstatSync(fd);assert.ok(info.isFile()&&info.size<=1048576);const raw=readFileSync(fd);assert.ok(raw.length<=1048576);return JSON.parse(raw);}finally{closeSync(fd);}
}
export function main(argv=process.argv.slice(2)){
 let passed=false;
 try{assert.equal(argv.length,2);assert.equal(argv[0],'--final');passed=accepted(readJson(argv[1]),readJson(join(dirname(argv[1]),'scratch','source-lock.json')));}catch{}
 console.log(JSON.stringify({schema:'r116-close-observation-host-v1',observationPassed:passed,acceptance:false,productSLOGates:'OPEN'}));return passed?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main();
