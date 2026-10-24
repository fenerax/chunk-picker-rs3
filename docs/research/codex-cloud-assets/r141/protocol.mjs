import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import EXPECTED from './provider-identity.json' with {type:'json'};
export const OUTPUTS={"app/tasks/scheduler.mjs":"4d2b8c206387f43eda1ebfbeed1f9c856bc71881c11152c725a6c2123ac03b24","app/tasks/worker.mjs":"cea6fe56154e7c8e1e90aa3b977968e991e8002afd16696bd3e62078eb9c3e69"};
export function schedule(){return ['A','C'].map((arm,index)=>({index,arm,fresh:true,diagnosticOnly:true}));}
const sha=s=>createHash('sha256').update(s).digest('hex');
export const canonicalRecords=files=>files.map(({path,bytes,sha256,kind})=>({path,bytes,sha256,kind})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
export function recomputeProviderDigest(files=EXPECTED.records){return sha(JSON.stringify({contract:EXPECTED.contract,capabilities:EXPECTED.capabilities,overlayOrder:EXPECTED.overlayOrder,files:canonicalRecords(files),definitionOverlays:EXPECTED.definitionOverlays}));}
export function checkProvider(files,baseline,arm,actualDigest,onEvidence=()=>{}){
 const actual=canonicalRecords(files),expected=canonicalRecords(EXPECTED.records),known=new Map(expected.map(x=>[x.path,x]));
 const changed=actual.filter(x=>JSON.stringify(x)!==JSON.stringify(known.get(x.path))).length+expected.filter(x=>!actual.some(v=>v.path===x.path)).length;
 const evidence={providerChangedRecordCount:changed,providerExpectedChangedRecordCount:0,providerActualRecordCount:actual.length,providerActualInputCount:actual.filter(x=>x.kind==='input').length,providerActualEvidenceCount:actual.filter(x=>x.kind==='evidence').length,providerExpectedDigest:EXPECTED.datasetDigest,providerActualDigest:typeof actualDigest==='string'&&/^[a-f0-9]{64}$/.test(actualDigest)?actualDigest:null,providerExpectedRecordsSha256:sha(JSON.stringify(expected)),providerActualRecordsSha256:sha(JSON.stringify(actual))};
 onEvidence(Object.freeze(evidence));
 assert.ok(['A','C'].includes(arm));assert.equal(actual.length,94);assert.equal(evidence.providerActualInputCount,61);assert.equal(evidence.providerActualEvidenceCount,33);
 assert.equal(new Set(files.map(x=>x.path)).size,94);
 for(const f of files){assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isInteger(f.bytes)&&f.bytes>0);}
 assert.equal(recomputeProviderDigest(),EXPECTED.datasetDigest,'independently reconstructed metadata digest');
 assert.equal(changed,0,'all five instrumentation targets are excluded from all94 provider records');
 assert.deepEqual(actual,expected,'all61 input and33 evidence bytes/hashes unchanged');
 if(baseline)assert.deepEqual(actual,canonicalRecords(baseline));else assert.equal(arm,'A');
 assert.equal(actualDigest,EXPECTED.datasetDigest,'same exact provider fingerprint for A and PR8 C');
 return evidence;
}
