// Host-only observation gate; importing the mapped contract starts no browser/service.
import assert from 'node:assert/strict';
import {openSync,readFileSync,fstatSync,closeSync,constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {observationComplete,SOURCE_PIN,PINS} from '../codex-cloud-assets/r139/contract.mjs';

export const MANIFEST='38b6213e5657a31a024fffc3618b2629c368e28e8a6154bf9545cdb62495a408';
const MEMORY=6442450944,CONFIG='sha256:fee853fafa59550d162cef52bca02d907694b44ebf6ef9fb075bcc0c65d8dedb';
const hex64=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const integer=(x,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=0&&x<=max;

export function accepted(value){
 try{
  assert.equal(value.schema,'docker-envelope-final-v1');assert.equal(value.envelope,'docker-hard-2cpu-6g-v1');assert.equal(value.runnerRevision,'docker-pinned-image-env-v3');assert.equal(value.sourceCommit,SOURCE_PIN);assert.equal(value.mode,'browser');assert.equal(value.control,'none');assert.equal(value.passed,true);assert.equal(value.cleanupPassed,true);assert.equal(value.reasonCode,null);assert.equal(value.allProductAcceptanceGates,'OPEN');
  const baseline={image:PINS.image,node:PINS.node,playwright:PINS.playwright,chromium:PINS.chromium,chromiumRevision:PINS.revision,platform:'linux/amd64'};
  for(const [key,pin]of Object.entries(baseline))assert.equal(value.baseline?.[key],pin);
  assert.equal(value.provenance?.nodeSha256,PINS.nodeSha256);
  for(const key of ['sourceManifestSha256','harnessManifestSha256','runnerManifestSha256','dependencyLockSha256'])assert.ok(hex64(value.provenance?.[key]));
  const host=value.hostConfig;assert.equal(host.admitted,true);assert.deepEqual(host.failedChecks,[]);assert.equal(host.imageId,CONFIG);assert.ok(hex64(host.containerId));assert.equal(host.nanoCpus,2000000000);assert.equal(host.memory,MEMORY);assert.equal(host.memorySwap,MEMORY);assert.equal(host.pidsLimit,512);assert.equal(host.init,true);assert.ok(Array.isArray(host.cpus)&&host.cpus.length===2&&host.cpus.every(x=>integer(x,65535))&&host.cpus[0]<host.cpus[1]);
  const evidence=value.resourceEvidence;assert.equal(evidence.present,true);assert.ok(integer(evidence.samples)&&evidence.samples>=2);assert.ok(!evidence.partialOrInvalidLine);
  const admission=evidence.admission;assert.ok(Array.isArray(admission.cpuMax)&&admission.cpuMax.length===2&&admission.cpuMax.every(x=>integer(x)&&x>0)&&admission.cpuMax[0]===2*admission.cpuMax[1]);assert.equal(admission.memoryMax,MEMORY);assert.equal(admission.memorySwapMax,0);assert.equal(admission.pidsMax,512);assert.deepEqual(admission.cpuset,host.cpus);assert.deepEqual(admission.affinity,host.cpus);assert.ok(['docker-init','tini','catatonit'].includes(admission.initComm));
  assert.equal(evidence.last?.memorySwapCurrent,0);assert.equal(evidence.last?.memoryEvents?.oom,0);assert.equal(evidence.last?.memoryEvents?.oom_kill,0);assert.equal(evidence.last?.pidsEvents?.max,0);
  const cleanup=value.containerCleanup;assert.equal(cleanup.removed,true);assert.equal(cleanup.running,false);assert.equal(cleanup.pid,0);assert.equal(cleanup.exitCode,0);assert.equal(cleanup.oomKilled,false);
  const inner=value.result;assert.equal(inner.passed,true);assert.equal(inner.control,'none');assert.equal(inner.intentionalNegative,false);assert.equal(inner.orphanReaped,true);assert.ok(integer(inner.cgroupMemoryPeak,MEMORY));
  const actual=inner.caseResult;assert.equal(actual.schema,'r139-body-lifecycle-v1');assert.equal(actual.mode,'r139-five-case-component-v1');assert.equal(actual.status,'correct');assert.equal(actual.code,'r139-observation-complete');assert.equal(actual.passed,true);assert.equal(actual.cleanupPassed,true);assert.equal(actual.acceptance,false);assert.equal(actual.caseExitCode,0);
  assert.equal(actual.sourcePin,SOURCE_PIN);assert.equal(actual.r139HarnessManifestSha256,MANIFEST);assert.equal(actual.r139BaselineClientSha256,PINS.baseline);assert.equal(actual.r139CandidateClientSha256,PINS.candidate);assert.equal(actual.r139LedgerSha256,PINS.ledger);assert.equal(actual.nodeSha256,PINS.nodeSha256);assert.equal(actual.nodeVersion,PINS.node);assert.equal(actual.playwrightVersion,PINS.playwright);assert.equal(actual.chromiumVersion,PINS.chromium);
  assert.ok(Buffer.byteLength(JSON.stringify(actual)+'\n')<=32768);
  // This is the unchanged pure producer contract, including its permitted terminal outcomes.
  assert.equal(observationComplete(actual),true);return true;
 }catch{return false;}
}

function readFinal(filename){
 const fd=openSync(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{const stat=fstatSync(fd);assert.ok(stat.isFile()&&stat.size<=1048576);const raw=readFileSync(fd);assert.ok(raw.length<=1048576);return JSON.parse(raw);}finally{closeSync(fd);}
}
export function main(argv=process.argv.slice(2)){
 let passed=false;try{assert.equal(argv.length,2);assert.equal(argv[0],'--final');passed=accepted(readFinal(argv[1]));}catch{}
 console.log(JSON.stringify({schema:'r139-host-observation-v1',observationPassed:passed,acceptance:false,networkScope:'same-wire-5s-node-cdp-receipt-cutoff',bodySurveyTiming:'after-cutoff',allProductAcceptanceGates:'OPEN'}));return passed?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main();
