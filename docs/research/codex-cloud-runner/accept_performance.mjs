// Host-only checks of saved public results; no application or provider imports.
import assert from 'node:assert/strict';
import {openSync,readFileSync,fstatSync,closeSync,constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {assess,modes,schedule} from './r134_screen_core.mjs';

export const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const R134_PACKET='1e88a8b7318cf1923c443daaded1e1219a9bc5b337e9c7dac88631534f09684d';
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e15;
const positive=x=>finite(x)&&x>0;
const SHA=/^[0-9a-f]{64}$/;
const sameKeys=(a,b)=>assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());

export function r134Assessment(metrics){
 const pairs=schedule.map(spec=>({...spec,rows:[0,1].map(p=>modes.map(label=>({label,callMs:metrics[`r134_${spec.kind}${spec.rep}_p${p}_${label.replaceAll('-','_')}Ms`]}))),processes:[0,1].map(p=>({setupMetrics:Object.fromEntries(['providerSetupMs','constructionMs','migrationCatalogueMs'].map(key=>[key,metrics[`r134_${spec.kind}${spec.rep}_p${p}_${key}`]]))}))}));
 for(const pair of pairs)for(let p=0;p<2;p++){const times=[...pair.rows[p].map(row=>row.callMs),...Object.values(pair.processes[p].setupMetrics)];assert.ok(times.every(positive));assert.ok(times.reduce((a,b)=>a+b,0)<=65000);}
 return assess(pairs);
}

function check134(actual){
 assert.equal(actual.schema,'r134-engine-performance-v1');assert.equal(actual.mode,'r134-owner-evaluate-screen-v1');assert.equal(actual.code,'r134-screen-complete');assert.equal(actual.count,48);
 assert.equal(actual.r134ObservedTimedSamples,48);assert.equal(actual.r134ObservedVerifiedSamples,48);assert.equal(actual.r134CompletedProcesses,12);assert.ok(!Object.keys(actual).some(key=>key.startsWith('r134Failure')));
 assert.equal(actual.sourcePin,PIN);assert.equal(actual.r134PacketManifestSha256,R134_PACKET);
 assert.equal(actual.r134ProviderProofSha256,'60fc803df8fcc59e9384181de7923737d95234a0b41bd126c42e878fef501d74');
 assert.equal(actual.fixtureSha256,'afc4dd775a78452a1e8d87efc579269f9f3dfa477674243f6e482a5503445584');
 assert.equal(actual.calculatorBytesSha256,'4b89f61b6f3e9ccab48d140bb2d43f10b4cc4a62283002110b4f3571a65247a0');assert.match(actual.r134RawVectorsSha256,SHA);
 const metrics=actual.metrics;assert.ok(metrics&&typeof metrics==='object'&&!Array.isArray(metrics));
 const expected=r134Assessment(metrics),rawKeys=schedule.flatMap(spec=>[0,1].flatMap(p=>[...modes.map(label=>`${label.replaceAll('-','_')}Ms`),'providerSetupMs','constructionMs','migrationCatalogueMs'].map(key=>`r134_${spec.kind}${spec.rep}_p${p}_${key}`)));
 sameKeys(metrics,Object.fromEntries([...rawKeys,...Object.keys(expected.metrics)].map(key=>[key,0])));assert.equal(Object.keys(metrics).length,126);assert.ok(Object.values(metrics).every(finite));
 for(const [key,value]of Object.entries(expected.metrics))assert.equal(metrics[key],value);
 for(const [key,value]of Object.entries(expected))if(key!=='metrics'&&key!=='rawLogRatios')assert.equal(actual[key],value);
 // All three declared outcomes are valid observations. This gate does not demand a gain.
 assert.ok(['promising','inconclusive','parked'].includes(actual.screenStatus));
}

function check135(actual){
 assert.equal(actual.schema,'r135-http-component-v1');assert.equal(actual.sourceCommit,PIN);assert.equal(actual.cleanupPassed,true);assert.equal(actual.count,8);assert.equal(actual.completedCellCount,8);assert.ok(positive(actual.elapsedMs)&&actual.elapsedMs<=1200000);
 assert.ok(['operationCode','cellOrdinal','errorName','errorCode','errorStackSha256'].every(key=>!Object.hasOwn(actual,key)));
 for(const [key,value]of Object.entries({providerChangedRecordCount:0,providerExpectedChangedRecordCount:0,providerActualRecordCount:94,providerActualInputCount:61,providerActualEvidenceCount:33}))assert.equal(actual[key],value);
 for(const key of ['providerExpectedDigest','providerActualDigest'])assert.equal(actual[key],'3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9');
 for(const key of ['providerExpectedRecordsSha256','providerActualRecordsSha256'])assert.equal(actual[key],'3149f86d99755116b57e1a5e4dbdb1437c4763ecf602a8a741454988441e51c4');
 const metrics=actual.metrics;assert.ok(metrics&&typeof metrics==='object'&&!Array.isArray(metrics));
 const required=Array.from({length:8},(_,i)=>[`r135Cell${i}ReadyMs`,`r135Cell${i}FirstBodyMs`]).flat();
 const allowed=new Set([...required,...Array.from({length:8},(_,i)=>`r135Cell${i}WarmBodyMs`)]);
 assert.ok(required.every(key=>positive(metrics[key])));assert.ok(Object.entries(metrics).every(([key,value])=>allowed.has(key)&&positive(value)&&value<=135000));
 for(let i=0;i<8;i++)assert.ok(metrics[`r135Cell${i}ReadyMs`]+metrics[`r135Cell${i}FirstBodyMs`]+(metrics[`r135Cell${i}WarmBodyMs`]??0)<=135000);
 // Warm entries exist only when the authenticated producer proved normal warmup ready.
}

export function accepted(value,caseName){
 try{
  assert.ok(['r134','r135'].includes(caseName));assert.equal(value.schema,'docker-envelope-final-v1');assert.equal(value.envelope,'docker-hard-2cpu-6g-v1');assert.equal(value.control,'none');assert.equal(value.sourceCommit,PIN);assert.equal(value.mode,caseName==='r134'?'component':'native');assert.equal(value.passed,true);assert.equal(value.cleanupPassed,true);
  const cleanup=value.containerCleanup;assert.equal(cleanup.removed,true);assert.equal(cleanup.running,false);assert.equal(cleanup.pid,0);assert.equal(cleanup.exitCode,0);assert.equal(cleanup.oomKilled,false);
  assert.equal(value.result.passed,true);assert.equal(value.result.control,'none');assert.equal(value.result.intentionalNegative,false);assert.equal(value.result.orphanReaped,true);
  const actual=value.result.caseResult;assert.equal(actual.status,'correct');assert.equal(actual.passed,true);assert.equal(actual.caseExitCode,0);
  (caseName==='r134'?check134:check135)(actual);return true;
 }catch{return false;}
}

function readFinal(filename){
 const fd=openSync(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{const stat=fstatSync(fd);assert.ok(stat.isFile()&&stat.size<=1048576);const raw=readFileSync(fd);assert.ok(raw.length<=1048576);return JSON.parse(raw);}finally{closeSync(fd);}
}
export function main(argv=process.argv.slice(2)){
 let caseName=null,passed=false;
 try{assert.equal(argv.length,4);assert.equal(argv[0],'--case');assert.ok(['r134','r135'].includes(argv[1]));assert.equal(argv[2],'--final');caseName=argv[1];passed=accepted(readFinal(argv[3]),caseName);}catch{}
 console.log(JSON.stringify({schema:'public-performance-acceptance-v1',case:caseName,scopedObservationPassed:passed,productSLOGates:'OPEN'}));return passed?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main();
