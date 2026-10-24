// Pure mapped host predicate and its published contract only; no runtime entrypoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {accepted} from '../codex-cloud-assets/r141/accept-result.mjs';
import CONTRACT from '../codex-cloud-assets/r141/case-contract.json' with {type:'json'};

const MANIFEST='94975a1dd77befd33995bbdc00fbc3303a6fb0ef5df5b30518fe681b4096e9c6';
function fixture({baselineA='miss',baselineC='miss',indexA='miss',indexC='miss'}={}) {
 const c={schema:'r141-planning-stage-diagnostic-v1',status:'correct',passed:true,cleanupPassed:true,caseExitCode:0,count:2,completedCellCount:2,code:'r141-diagnostic-complete',r141PacketManifestSha256:MANIFEST,sourceCommit:CONTRACT.sourcePin,
  diagnosticOnly:true,acceptance:false,performanceAcceptance:false,productAcceptance:false,sourcePostflightPassed:true,allFinalGates:'OPEN',
  providerChangedRecordCount:0,providerExpectedChangedRecordCount:0,providerActualRecordCount:94,providerActualInputCount:61,providerActualEvidenceCount:33,
  providerExpectedDigest:CONTRACT.providerDigest,providerActualDigest:CONTRACT.providerDigest,providerExpectedRecordsSha256:CONTRACT.providerRecordsSha256,providerActualRecordsSha256:CONTRACT.providerRecordsSha256,metrics:{}};
 for(const arm of ['A','C']) {
  const prefix='r141'+arm,baseline=arm==='A'?baselineA:baselineC,index=arm==='A'?indexA:indexC;
  for(const name of CONTRACT.metricNames)if(!(name==='WorkerReadySerializationMs'&&arm==='C')&&!(name==='WorkerEvaluateFullMs'&&baseline==='hit'))c.metrics[prefix+name]=1;
  Object.assign(c.metrics,{[prefix+'WorkerProjectedRows']:772,[prefix+'PredictionCataloguePresent']:arm==='A'?1:0,[prefix+'PredictionDynamicPresent']:arm==='A'?1:0,
   [prefix+'PredictionCatalogueRows']:arm==='A'?1:0,[prefix+'PredictionDynamicBytes']:arm==='A'?1:0,[prefix+'WorkerBaselineHit']:baseline==='hit'?1:0,[prefix+'WorkerIndexHit']:index==='hit'?1:0,[prefix+'WorkerIndexPresentAtBaselineLookup']:index==='hit'?1:0});
  Object.assign(c,{[prefix+'Transport']:'json-full',[prefix+'BaselineState']:baseline,[prefix+'IndexState']:index,[prefix+'ReadyOmissionObserved']:arm==='C',
   [prefix+'InstrumentedProofSha256']:CONTRACT.proofSha256[arm],[prefix+'ObservedModuleProofSha256']:CONTRACT.observedModuleProofSha256[arm],[prefix+'TraceSha256']:'a'.repeat(64)});
 }
 return {schema:'docker-envelope-final-v1',envelope:'docker-hard-2cpu-6g-v1',sourceCommit:CONTRACT.sourcePin,mode:'native',control:'none',passed:true,cleanupPassed:true,allProductAcceptanceGates:'OPEN',
  containerCleanup:{running:false,pid:0,removed:true,exitCode:0,oomKilled:false},result:{passed:true,control:'none',intentionalNegative:false,orphanReaped:true,caseResult:c}};
}
function rejects(change,base=fixture()) {const value=structuredClone(base);change(value,value.result.caseResult);assert.equal(accepted(value,MANIFEST),false);}

test('complete two-cell diagnostic keeps acceptance false and actual optional spans absent',()=>{
 const value=fixture();assert.equal(CONTRACT.metricKeys.length,128);assert.equal(Object.keys(value.result.caseResult.metrics).length,127);assert.ok(accepted(value,MANIFEST));
 assert.equal(Object.hasOwn(value.result.caseResult.metrics,'r141CWorkerReadySerializationMs'),false);
 assert.equal(value.result.caseResult.acceptance,false);assert.equal(value.result.caseResult.performanceAcceptance,false);
});
test('all actual baseline/index hit or miss combinations remain observations',()=>{
 for(const baselineA of ['hit','miss'])for(const baselineC of ['hit','miss'])for(const indexA of ['hit','miss'])for(const indexC of ['hit','miss']) {
  const value=fixture({baselineA,baselineC,indexA,indexC});assert.ok(accepted(value,MANIFEST));
  for(const arm of ['A','C'])assert.equal(Object.hasOwn(value.result.caseResult.metrics,'r141'+arm+'WorkerEvaluateFullMs'),value.result.caseResult['r141'+arm+'BaselineState']==='miss');
 }
});
test('every required observed stage is retained and finite',()=>{
 const base=fixture();for(const key of Object.keys(base.result.caseResult.metrics)) {
  rejects((_,c)=>delete c.metrics[key],base);rejects((_,c)=>c.metrics[key]=NaN,base);
 }
 for(const bad of [null,true,'SYNTHETIC_SECRET',Infinity,-1,1000000001])rejects((_,c)=>c.metrics.r141AServerListGateMs=bad);
});
test('conditional spans cannot be invented, zero-substituted or removed',()=>{
 rejects((_,c)=>c.metrics.r141CWorkerReadySerializationMs=0);
 rejects((_,c)=>delete c.metrics.r141AWorkerReadySerializationMs);
 const hit=fixture({baselineA:'hit',baselineC:'hit'});rejects((_,c)=>c.metrics.r141AWorkerEvaluateFullMs=0,hit);
 rejects((_,c)=>c.r141ABaselineState='hit');rejects((_,c)=>c.metrics.r141AWorkerIndexPresentAtBaselineLookup=1);
});
test('all seven exact boolean scalars and open diagnostic boundaries are enforced',()=>{
 for(const key of ['diagnosticOnly','acceptance','performanceAcceptance','productAcceptance','sourcePostflightPassed','r141AReadyOmissionObserved','r141CReadyOmissionObserved'])rejects((_,c)=>c[key]=!c[key]);
 rejects(v=>v.allProductAcceptanceGates='PASSED');rejects((_,c)=>c.allFinalGates='PASSED');
});
test('foreground payload stays present while only candidate prediction payload is omitted',()=>{
 for(const arm of ['A','C'])for(const key of ['ForegroundCataloguePresent','ForegroundDynamicPresent','ForegroundCatalogueRows','ForegroundDynamicBytes'])rejects((_,c)=>c.metrics['r141'+arm+key]=0);
 for(const key of ['PredictionCataloguePresent','PredictionDynamicPresent','PredictionCatalogueRows','PredictionDynamicBytes'])rejects((_,c)=>c.metrics['r141C'+key]=1);
 for(const name of ['EngineRows','EquipmentRows','CollectionRows','HouseRows','GeneratedRows'])rejects((_,c)=>c.metrics['r141CWorkerLocal'+name]++);
});
test('module proofs, trace, provider and completion identities stay exact',()=>{
 for(const arm of ['A','C'])for(const name of ['InstrumentedProofSha256','ObservedModuleProofSha256'])rejects((_,c)=>c['r141'+arm+name]='0'.repeat(64));
 rejects((_,c)=>c.r141ATraceSha256='bad');rejects((_,c)=>c.r141PacketManifestSha256='0'.repeat(64));
 for(const [key,bad]of [['providerChangedRecordCount',1],['providerExpectedChangedRecordCount',1],['providerActualRecordCount',93],['providerActualInputCount',60],['providerActualEvidenceCount',32],['completedCellCount',1],['count',1],['caseExitCode',1],['status','failed'],['passed',false],['cleanupPassed',false]])rejects((_,c)=>c[key]=bad);
 for(const key of ['providerActualDigest','providerExpectedDigest','providerActualRecordsSha256','providerExpectedRecordsSha256'])rejects((_,c)=>c[key]='0'.repeat(64));
});
test('numeric flags and counts do not become untyped facts or private payloads',()=>{
 for(const name of CONTRACT.booleanMetricNames)rejects((_,c)=>c.metrics['r141A'+name]=2);
 for(const name of CONTRACT.integerMetricNames)rejects((_,c)=>c.metrics['r141A'+name]=1.5);
 rejects((_,c)=>c.metrics.privateURL=1);rejects((_,c)=>c.r141ATransport='SYNTHETIC_SECRET');
});
test('outer execution and exact container cleanup remain required',()=>{
 for(const [key,bad]of [['removed',false],['running',true],['pid',1],['exitCode',1],['oomKilled',true]])rejects(v=>v.containerCleanup[key]=bad);
 for(const key of ['passed','cleanupPassed'])rejects(v=>v[key]=false);
 rejects(v=>v.result.orphanReaped=false);rejects(v=>v.result.intentionalNegative=true);
});
test('stage clocks are observations and never imply gain or a product gate',()=>{
 const value=fixture();value.result.caseResult.metrics.r141AAppCreateToReadyMs=999999999;value.result.caseResult.metrics.r141CHttpFirstBodyMs=999999999;
 assert.ok(accepted(value,MANIFEST));assert.equal(value.result.caseResult.productAcceptance,false);
 assert.equal(accepted(value,'0'.repeat(64)),false);
});
