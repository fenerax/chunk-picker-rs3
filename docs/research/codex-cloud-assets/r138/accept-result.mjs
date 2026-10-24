import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessMetrics} from './screen.mjs';
export function accepted(final, expectedManifest) {
  try {
    assert.match(expectedManifest,/^[a-f0-9]{64}$/);
    assert.equal(final.schema,'docker-envelope-final-v1');assert.equal(final.envelope,'docker-hard-2cpu-6g-v1');
    assert.equal(final.sourceCommit,'6f22fefa782747790e2eaefa01e4e5ea7b557323');assert.equal(final.mode,'native');
    assert.equal(final.passed,true);assert.equal(final.cleanupPassed,true);
    assert.equal(final.control,'none');assert.equal(final.result.passed,true);assert.equal(final.result.control,'none');
    assert.equal(final.result.intentionalNegative,false);assert.equal(final.result.orphanReaped,true);
    assert.equal(final.containerCleanup.running,false);assert.equal(final.containerCleanup.pid,0);
    assert.equal(final.containerCleanup.removed,true);assert.equal(final.containerCleanup.exitCode,0);assert.equal(final.containerCleanup.oomKilled,false);
    const c=final.result.caseResult;
    assert.equal(c.schema,'r138-http-component-v1');assert.equal(c.status,'correct');assert.equal(c.passed,true);
    assert.equal(c.cleanupPassed,true);assert.equal(c.caseExitCode,0);assert.equal(c.count,8);assert.equal(c.completedCellCount,8);
    assert.equal(c.code,'r138-screen-complete');assert.equal(c.r138PacketManifestSha256,expectedManifest);
    assert.equal(c.sourceCommit,final.sourceCommit);assert.equal(c.providerChangedRecordCount,0);
    assert.equal(c.providerExpectedChangedRecordCount,0);assert.equal(c.providerActualRecordCount,94);
    assert.equal(c.providerActualInputCount,61);assert.equal(c.providerActualEvidenceCount,33);
    const digest='3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9';
    assert.equal(c.providerExpectedDigest,digest);assert.equal(c.providerActualDigest,digest);
    assert.equal(c.providerExpectedRecordsSha256,'3149f86d99755116b57e1a5e4dbdb1437c4763ecf602a8a741454988441e51c4');
    assert.equal(c.providerActualRecordsSha256,c.providerExpectedRecordsSha256);
    const screen=assessMetrics(c.metrics);
    for (const [key,value] of Object.entries(screen.fields)) assert.equal(c[key],value,key);
    for (const [key,value] of Object.entries(screen.metrics)) assert.equal(c.metrics[key],value,key);
    const allowed=new Set([...Array.from({length:8},(_,i)=>['ReadyMs','FirstBodyMs','WarmBodyMs'].map(s=>'r138Cell'+i+s)).flat(),...Object.keys(screen.metrics)]);
    assert.ok(Object.keys(c.metrics).every(key=>allowed.has(key)));
    return true;
  } catch {return false;}
}
if (process.argv[1]?.endsWith('accept-result.mjs')) {
  let passed=false;
  try {const raw=await readFile(process.argv[2]);assert.ok(raw.length<=131072);passed=accepted(JSON.parse(raw),process.argv[3]);}catch{}
  console.log(JSON.stringify({schema:'r138-host-decision-v1',passed,scope:'measurement complete only; screen decision remains separate from product acceptance'}));
  if (!passed) process.exitCode=1;
}
