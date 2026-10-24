import test from 'node:test';
import assert from 'node:assert/strict';
import {accepted,r134Assessment,PIN,R134_PACKET} from './accept_performance.mjs';
import {schedule,modes} from './r134_screen_core.mjs';

function envelope(actual,mode='component'){
 return {schema:'docker-envelope-final-v1',envelope:'docker-hard-2cpu-6g-v1',sourceCommit:PIN,mode,control:'none',passed:true,cleanupPassed:true,containerCleanup:{removed:true,running:false,pid:0,exitCode:0,oomKilled:false},result:{passed:true,control:'none',intentionalNegative:false,orphanReaped:true,caseResult:actual}};
}
function fixture134(gains=[10,10,10],regressionMode=null){
 const metrics={};
 for(const spec of schedule)for(let p=0;p<2;p++)for(const mode of [...modes,'providerSetupMs','constructionMs','migrationCatalogueMs']){
  let value=100;
  if(spec.kind==='ac'&&spec.arms[p]==='C'&&mode==='unlocked-miss')value=100-gains[spec.rep];
  if(spec.kind==='ac'&&spec.rep===2&&spec.arms[p]==='C'&&mode===regressionMode)value=103;
  metrics[`r134_${spec.kind}${spec.rep}_p${p}_${modes.includes(mode)?mode.replaceAll('-','_')+'Ms':mode}`]=value;
 }
 const assessment=r134Assessment(metrics);delete assessment.rawLogRatios;
 return envelope({schema:'r134-engine-performance-v1',mode:'r134-owner-evaluate-screen-v1',status:'correct',passed:true,code:'r134-screen-complete',count:48,r134ObservedTimedSamples:48,r134ObservedVerifiedSamples:48,r134CompletedProcesses:12,caseExitCode:0,sourcePin:PIN,r134PacketManifestSha256:R134_PACKET,r134ProviderProofSha256:'60fc803df8fcc59e9384181de7923737d95234a0b41bd126c42e878fef501d74',fixtureSha256:'afc4dd775a78452a1e8d87efc579269f9f3dfa477674243f6e482a5503445584',calculatorBytesSha256:'4b89f61b6f3e9ccab48d140bb2d43f10b4cc4a62283002110b4f3571a65247a0',r134RawVectorsSha256:'a'.repeat(64),...assessment,metrics:{...metrics,...assessment.metrics}});
}
function fixture135(warm=0){
 const metrics={};for(let i=0;i<8;i++){metrics[`r135Cell${i}ReadyMs`]=100;metrics[`r135Cell${i}FirstBodyMs`]=200;if(i<warm)metrics[`r135Cell${i}WarmBodyMs`]=50;}
 return envelope({schema:'r135-http-component-v1',status:'correct',passed:true,cleanupPassed:true,count:8,completedCellCount:8,caseExitCode:0,sourceCommit:PIN,elapsedMs:5000,providerChangedRecordCount:0,providerExpectedChangedRecordCount:0,providerActualRecordCount:94,providerActualInputCount:61,providerActualEvidenceCount:33,providerExpectedDigest:'3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9',providerActualDigest:'3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9',providerExpectedRecordsSha256:'3149f86d99755116b57e1a5e4dbdb1437c4763ecf602a8a741454988441e51c4',providerActualRecordsSha256:'3149f86d99755116b57e1a5e4dbdb1437c4763ecf602a8a741454988441e51c4',metrics},'native');
}

test('all three complete R134 screen outcomes are accepted without a speed gate',()=>{
 for(const [gain,status]of [[[10,10,10],'promising'],[[1,1,1],'inconclusive'],[[50,50,-3],'parked']]){const v=fixture134(gain);assert.equal(v.result.caseResult.screenStatus,status);assert.equal(accepted(v,'r134'),true);}
});
test('strict threshold and every setup regression obey the predeclared veto',()=>{
 const at=fixture134([2,2,2]);assert.equal(at.result.caseResult.screenStatus,'inconclusive');assert.ok(accepted(at,'r134'));
 for(const mode of ['cold','original-hit','unlocked-hit','providerSetupMs','constructionMs','migrationCatalogueMs']){const v=fixture134([10,10,10],mode);assert.equal(v.result.caseResult.screenStatus,'parked');assert.ok(accepted(v,'r134'));}
});
test('R134 all126 numeric fields are required and all42 derived values are recomputed',()=>{
 const base=fixture134(),metrics=base.result.caseResult.metrics;assert.equal(Object.keys(metrics).length,126);
 for(const key of Object.keys(metrics)){const v=structuredClone(base);delete v.result.caseResult.metrics[key];assert.equal(accepted(v,'r134'),false,key);}
 const derived=r134Assessment(metrics).metrics;assert.equal(Object.keys(derived).length,42);
 for(const key of Object.keys(derived)){const v=structuredClone(base);v.result.caseResult.metrics[key]+=0.01;assert.equal(accepted(v,'r134'),false,key);}
});
test('R134 rejects corrupt classifiers, verdict, fraction/log confusion and CA reversal',()=>{
 const base=fixture134();for(const key of [...Object.keys(base.result.caseResult).filter(k=>k.endsWith('_classification')),'screenStatus','gainBeyondNoise']){const v=structuredClone(base);v.result.caseResult[key]=key==='gainBeyondNoise'?false:key==='screenStatus'?'parked':v.result.caseResult[key]==='within-noise'?'gain-observed':'within-noise';assert.equal(accepted(v,'r134'),false,key);}
 const reversed=structuredClone(base);for(const label of modes){const a=`r134_ac1_p0_${label.replaceAll('-','_')}Ms`,b=`r134_ac1_p1_${label.replaceAll('-','_')}Ms`;[reversed.result.caseResult.metrics[a],reversed.result.caseResult.metrics[b]]=[reversed.result.caseResult.metrics[b],reversed.result.caseResult.metrics[a]];}assert.equal(accepted(reversed,'r134'),false);
 const confused=structuredClone(base);confused.result.caseResult.metrics.r134_unlocked_miss_acGainMedianBaselineFraction=confused.result.caseResult.metrics.r134_unlocked_miss_acGainLogMin;assert.equal(accepted(confused,'r134'),false);
});
test('R134 rejects invalid raw times, extra metrics, bad source and packet pins',()=>{
 for(const value of [0,-1,NaN,Infinity,true,'100']){const v=fixture134();v.result.caseResult.metrics.r134_aa0_p0_coldMs=value;assert.equal(accepted(v,'r134'),false);}
 for(const key of ['sourcePin','r134PacketManifestSha256','r134ProviderProofSha256','fixtureSha256','calculatorBytesSha256','r134RawVectorsSha256']){const v=fixture134();v.result.caseResult[key]='bad';assert.equal(accepted(v,'r134'),false,key);}
 const extra=fixture134();extra.result.caseResult.metrics.privateToken=100;assert.equal(accepted(extra,'r134'),false);
});
test('R135 accepts sixteen required values and zero through eight optional warm values',()=>{for(let i=0;i<=8;i++)assert.ok(accepted(fixture135(i),'r135'));});
test('R135 rejects every missing required metric, partial cells, invalid optional values and elapsed budget',()=>{
 const base=fixture135();for(const key of Object.keys(base.result.caseResult.metrics)){const v=structuredClone(base);delete v.result.caseResult.metrics[key];assert.equal(accepted(v,'r135'),false,key);}
 for(const [key,value]of [['count',7],['completedCellCount',7],['elapsedMs',1200001],['elapsedMs',NaN],['cleanupPassed',false]]){const v=fixture135();v.result.caseResult[key]=value;assert.equal(accepted(v,'r135'),false);}
 for(const value of [0,-1,NaN,Infinity,true,'50']){const v=fixture135();v.result.caseResult.metrics.r135Cell0WarmBodyMs=value;assert.equal(accepted(v,'r135'),false);}
 const extra=fixture135();extra.result.caseResult.metrics.secret=1;assert.equal(accepted(extra,'r135'),false);
});
test('both cases reject failed or missing case evidence and failed outer cleanup',()=>{
 for(const [caseName,make]of [['r134',fixture134],['r135',fixture135]]){
  for(const key of ['passed','cleanupPassed']){const v=make();v[key]=false;assert.equal(accepted(v,caseName),false);}
  for(const [key,value]of [['status','failed'],['passed',false],['schema','wrong'],['caseExitCode',1]]){const v=make();v.result.caseResult[key]=value;assert.equal(accepted(v,caseName),false);}
  for(const [key,value]of [['removed',false],['running',true],['pid',100],['exitCode',1],['oomKilled',true]]){const v=make();v.containerCleanup[key]=value;assert.equal(accepted(v,caseName),false);}
  const v=make();delete v.result.caseResult;assert.equal(accepted(v,caseName),false);
 }
});
test('per-process and per-cell public timing totals cannot exceed declared child ceilings',()=>{
 const a=fixture134();a.result.caseResult.metrics.r134_aa0_p0_providerSetupMs=65001;assert.equal(accepted(a,'r134'),false);
 const b=fixture135();b.result.caseResult.metrics.r135Cell0FirstBodyMs=135001;assert.equal(accepted(b,'r135'),false);
 const c=fixture135(1);c.result.caseResult.metrics.r135Cell0FirstBodyMs=134900;assert.equal(accepted(c,'r135'),false);
});
test('completion counters and retained first failure cannot be promoted into a green case',()=>{
 for(const key of ['r134ObservedTimedSamples','r134ObservedVerifiedSamples','r134CompletedProcesses']){const v=fixture134();v.result.caseResult[key]=1;assert.equal(accepted(v,'r134'),false);}
 const a=fixture134();a.result.caseResult.r134FailureOperation='arm-exit';assert.equal(accepted(a,'r134'),false);
 const b=fixture135();b.result.caseResult.operationCode='r135-child-wait';assert.equal(accepted(b,'r135'),false);
});
test('R135 requires the exact unchanged94record provider vector including all61inputs and33evidence',()=>{
 for(const key of ['providerChangedRecordCount','providerExpectedChangedRecordCount','providerActualRecordCount','providerActualInputCount','providerActualEvidenceCount','providerExpectedDigest','providerActualDigest','providerExpectedRecordsSha256','providerActualRecordsSha256']){const v=fixture135();v.result.caseResult[key]=typeof v.result.caseResult[key]==='number'?2:'a'.repeat(64);assert.equal(accepted(v,'r135'),false,key);}
});
