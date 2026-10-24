// Import only the packet's pure classifier and host predicate; no case entrypoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {accepted} from '../codex-cloud-assets/r138/accept-result.mjs';
import {assessMetrics} from '../codex-cloud-assets/r138/screen.mjs';
const PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323',MANIFEST='9d74efb3ddeef7771fcfeb7d82525e52a27a904f5900e639aeaae90317e4a36e';
function fixture({gain=10,warm=true,startupRegression=false}={}){
 const raw={};for(let i=0;i<8;i++){raw[`r138Cell${i}ReadyMs`]=startupRegression&&[3,4].includes(i)?103:100;raw[`r138Cell${i}FirstBodyMs`]=[3,4,7].includes(i)?100-gain:100;if(warm)raw[`r138Cell${i}WarmBodyMs`]=100;}
 const screen=assessMetrics(raw),digest='3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9',records='3149f86d99755116b57e1a5e4dbdb1437c4763ecf602a8a741454988441e51c4';
 return {schema:'docker-envelope-final-v1',envelope:'docker-hard-2cpu-6g-v1',sourceCommit:PIN,mode:'native',control:'none',passed:true,cleanupPassed:true,containerCleanup:{running:false,pid:0,removed:true,exitCode:0,oomKilled:false},result:{passed:true,control:'none',intentionalNegative:false,orphanReaped:true,caseResult:{schema:'r138-http-component-v1',status:'correct',passed:true,cleanupPassed:true,caseExitCode:0,count:8,completedCellCount:8,code:'r138-screen-complete',r138PacketManifestSha256:MANIFEST,sourceCommit:PIN,providerChangedRecordCount:0,providerExpectedChangedRecordCount:0,providerActualRecordCount:94,providerActualInputCount:61,providerActualEvidenceCount:33,providerExpectedDigest:digest,providerActualDigest:digest,providerExpectedRecordsSha256:records,providerActualRecordsSha256:records,...screen.fields,metrics:{...raw,...screen.metrics}}}};
}
test('R138 accepts promising inconclusive and parked complete observations with independent primary gain',()=>{
 for(const [options,status,gain]of [[{},'promising',true],[{gain:1},'inconclusive',false],[{startupRegression:true},'parked',true]]){const value=fixture(options);assert.equal(value.result.caseResult.screenStatus,status);assert.equal(value.result.caseResult.gainBeyondNoise,gain);assert.ok(accepted(value,MANIFEST));}
});
test('R138 warm evidence may be absent and never becomes zero or a clear control',()=>{
 const value=fixture({warm:false});assert.equal(Object.keys(value.result.caseResult.metrics).length,28);assert.equal(value.result.caseResult.warmControlStatus,'unobserved');assert.equal(value.result.caseResult.screenStatus,'inconclusive');assert.ok(accepted(value,MANIFEST));
 value.result.caseResult.metrics.r138Cell0WarmBodyMs=0;assert.equal(accepted(value,MANIFEST),false);
});
test('R138 recomputes all18 signed derived metrics and closed decision fields',()=>{
 const base=fixture();assert.equal(Object.keys(base.result.caseResult.metrics).length,42);const derived=Object.keys(assessMetrics(base.result.caseResult.metrics).metrics);assert.equal(derived.length,18);
 for(const key of derived){const value=structuredClone(base);value.result.caseResult.metrics[key]+=0.01;assert.equal(accepted(value,MANIFEST),false,key);}
 for(const [key,item]of [['screenStatus','parked'],['gainBeyondNoise',false],['primaryPairCount',2],['startupControlStatus','unobserved'],['warmControlStatus','unobserved']]){const value=structuredClone(base);value.result.caseResult[key]=item;assert.equal(accepted(value,MANIFEST),false,key);}
});
test('R138 never accepts failed case evidence wrong manifest or missing required timing',()=>{
 for(const [key,item]of [['status','failed'],['passed',false],['cleanupPassed',false],['count',7],['completedCellCount',7],['r138PacketManifestSha256','a'.repeat(64)],['providerChangedRecordCount',2]]){const value=fixture();value.result.caseResult[key]=item;assert.equal(accepted(value,MANIFEST),false,key);}
 for(const key of Object.keys(fixture().result.caseResult.metrics).filter(k=>k.endsWith('ReadyMs')||k.endsWith('FirstBodyMs'))){const value=fixture();delete value.result.caseResult.metrics[key];assert.equal(accepted(value,MANIFEST),false,key);}
 const value=fixture();value.cleanupPassed=false;assert.equal(accepted(value,MANIFEST),false);
});
