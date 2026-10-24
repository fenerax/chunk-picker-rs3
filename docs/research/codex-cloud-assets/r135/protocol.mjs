import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import EXPECTED from './provider-identity.json' with {type:'json'};
export const OUTPUTS={'app/server.mjs':'77e37222c77bb3eeaf56e0b93f5b3d34d8fb48deef3e93aa331dcfc1b1603329','app/tasks/worker.mjs':'ac1c2603ea7ec759d0dd1a64abfe60c32c9f6bf69de21996cdcbe14c060f1e66'};
export function schedule(){return ['A','A','A','C','C','A','A','C'].map((arm,index)=>({index,arm,group:index<2?'AA-control':'pair-'+Math.floor((index-2)/2),fresh:true}));}
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
 assert.equal(changed,0,'R49 targets are excluded from all94 provider records');
 assert.deepEqual(actual,expected,'all61 input and33 evidence bytes/hashes unchanged');
 if(baseline)assert.deepEqual(actual,canonicalRecords(baseline));else assert.equal(arm,'A');
 assert.equal(actualDigest,EXPECTED.datasetDigest,'same exact provider fingerprint for A and R49 C');
 return evidence;
}
