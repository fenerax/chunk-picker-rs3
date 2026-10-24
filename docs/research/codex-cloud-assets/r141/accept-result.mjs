import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import CONTRACT from './case-contract.json' with {type:'json'};
export function accepted(final,expectedManifest){
 try{
  assert.match(expectedManifest,/^[a-f0-9]{64}$/);assert.equal(final.schema,'docker-envelope-final-v1');assert.equal(final.envelope,'docker-hard-2cpu-6g-v1');assert.equal(final.mode,'native');assert.equal(final.sourceCommit,CONTRACT.sourcePin);
  assert.equal(final.passed,true);assert.equal(final.cleanupPassed,true);assert.equal(final.control,'none');assert.equal(final.result.passed,true);assert.equal(final.result.control,'none');assert.equal(final.result.intentionalNegative,false);assert.equal(final.result.orphanReaped,true);
  assert.equal(final.allProductAcceptanceGates,'OPEN');assert.equal(final.containerCleanup.running,false);assert.equal(final.containerCleanup.pid,0);assert.equal(final.containerCleanup.removed,true);assert.equal(final.containerCleanup.exitCode,0);assert.equal(final.containerCleanup.oomKilled,false);
  const c=final.result.caseResult;assert.equal(c.schema,'r141-planning-stage-diagnostic-v1');assert.equal(c.status,'correct');assert.equal(c.passed,true);assert.equal(c.cleanupPassed,true);assert.equal(c.caseExitCode,0);assert.equal(c.count,2);assert.equal(c.completedCellCount,2);assert.equal(c.code,'r141-diagnostic-complete');assert.equal(c.r141PacketManifestSha256,expectedManifest);assert.equal(c.sourceCommit,CONTRACT.sourcePin);
  assert.equal(c.diagnosticOnly,true);assert.equal(c.acceptance,false);assert.equal(c.performanceAcceptance,false);assert.equal(c.productAcceptance,false);assert.equal(c.allFinalGates,'OPEN');assert.equal(c.sourcePostflightPassed,true);
  assert.equal(c.providerChangedRecordCount,0);assert.equal(c.providerExpectedChangedRecordCount,0);assert.equal(c.providerActualRecordCount,94);assert.equal(c.providerActualInputCount,61);assert.equal(c.providerActualEvidenceCount,33);
  assert.equal(c.providerActualDigest,CONTRACT.providerDigest);assert.equal(c.providerExpectedDigest,CONTRACT.providerDigest);assert.equal(c.providerExpectedRecordsSha256,CONTRACT.providerRecordsSha256);assert.equal(c.providerActualRecordsSha256,CONTRACT.providerRecordsSha256);
  const allowed=new Set(CONTRACT.metricKeys);assert.ok(c.metrics&&typeof c.metrics==='object');for(const [key,value]of Object.entries(c.metrics)){assert.ok(allowed.has(key));assert.ok(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e9);}
  for(const arm of ['A','C']){
   const p='r141'+arm,m=name=>c.metrics[p+name],has=name=>Object.hasOwn(c.metrics,p+name);
   for(const name of CONTRACT.metricNames)if(!['WorkerEvaluateFullMs','WorkerReadySerializationMs'].includes(name))assert.ok(has(name),name);
   assert.ok(m('AppCreateToReadyMs')>0&&m('HttpFirstBodyMs')>0);assert.equal(m('WorkerProjectedRows'),772);assert.equal(m('DispatchGeneration'),1);assert.equal(m('DispatchPredictionReady'),1);assert.equal(m('DispatchPredictionResident'),1);
   assert.equal(m('ForegroundCataloguePresent'),1);assert.equal(m('ForegroundDynamicPresent'),1);assert.ok(m('ForegroundCatalogueRows')>0&&m('ForegroundDynamicBytes')>0);
   assert.equal(m('PredictionCataloguePresent'),arm==='A'?1:0);assert.equal(m('PredictionDynamicPresent'),arm==='A'?1:0);
   if(arm==='C'){assert.equal(m('PredictionCatalogueRows'),0);assert.equal(m('PredictionDynamicBytes'),0);assert.equal(has('WorkerReadySerializationMs'),false);}else{assert.ok(m('PredictionCatalogueRows')>0&&m('PredictionDynamicBytes')>0);assert.ok(has('WorkerReadySerializationMs'));}
   assert.ok(['json-full','json-reference','object','snapshot-reference'].includes(c[p+'Transport']));assert.ok(['hit','miss'].includes(c[p+'BaselineState']));assert.ok(['hit','miss'].includes(c[p+'IndexState']));assert.equal(c[p+'ReadyOmissionObserved'],arm==='C');
   assert.equal(m('WorkerBaselineHit'),c[p+'BaselineState']==='hit'?1:0);assert.equal(m('WorkerIndexHit'),c[p+'IndexState']==='hit'?1:0);assert.equal(m('WorkerIndexPresentAtBaselineLookup'),m('WorkerIndexHit'));assert.equal(has('WorkerEvaluateFullMs'),c[p+'BaselineState']==='miss');
   assert.equal(c[p+'InstrumentedProofSha256'],CONTRACT.proofSha256[arm]);assert.equal(c[p+'ObservedModuleProofSha256'],CONTRACT.observedModuleProofSha256[arm]);assert.match(c[p+'TraceSha256'],/^[a-f0-9]{64}$/);
   for(const name of CONTRACT.booleanMetricNames)assert.ok([0,1].includes(m(name)),name);
   for(const name of CONTRACT.integerMetricNames)assert.ok(Number.isSafeInteger(m(name)),name);
  }
  for(const name of ['EngineRows','EquipmentRows','CollectionRows','HouseRows','GeneratedRows'])assert.equal(c.metrics['r141AWorkerLocal'+name],c.metrics['r141CWorkerLocal'+name]);
  return true;
 }catch{return false;}
}
if(process.argv[1]?.endsWith('accept-result.mjs')){
 let passed=false;try{const raw=await readFile(process.argv[2]);assert.ok(raw.length<=131072);passed=accepted(JSON.parse(raw),process.argv[3]);}catch{}
 console.log(JSON.stringify({schema:'r141-host-diagnostic-decision-v1',passed,acceptance:false,performanceAcceptance:false,allFinalGates:'OPEN'}));if(!passed)process.exitCode=1;
}
