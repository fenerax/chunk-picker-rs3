import test from 'node:test';
import assert from 'node:assert/strict';
import { runFileLane } from '../scripts/private-companion/file-test-lane.mjs';
import { planLaneEvidence, lookupLaneEvidence, laneEvidenceFilename } from '../scripts/private-companion/lane-test-evidence.mjs';
import { gateContract, atomicJSON } from '../scripts/private-companion/release-evidence.mjs';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';
import { fixture, json, hash } from './lane-test-fixture.mjs';

test('valid public or different-execution file proofs cannot be spliced into a whole private pass by recomputing its outer digest',async t=>{
  const f=await fixture(t);await runFileLane({...f.options,runId:'private'});
  const whole=await f.plan(),filename=laneEvidenceFilename(f.directory,whole),original=await json(filename);
  const publicOptions={...f.options,lane:'public-full',contract:gateContract('public-full',{synthetic:true},f.options.execution)};
  await runFileLane({...publicOptions,runId:'public'});
  const publicWhole=await planLaneEvidence(publicOptions);
  const publicProof=(await lookupLaneEvidence(f.directory,publicWhole)).item.record.files[0];
  const execution={...f.options.execution,digest:hash('different valid execution')};
  const otherOptions={...f.options,execution,contract:gateContract('private-full',{synthetic:true},execution)};
  await runFileLane({...otherOptions,runId:'different-execution'});
  const otherWhole=await planLaneEvidence(otherOptions);
  const otherProof=(await lookupLaneEvidence(f.directory,otherWhole)).item.record.files[0];
  for(const proof of [publicProof,otherProof]) {
    const spliced=structuredClone(original);spliced.files[0]=proof;
    const {digest,...body}=spliced;spliced.digest=digestValue(body);
    await atomicJSON(filename,spliced);
    const lookup=await lookupLaneEvidence(f.directory,whole);
    assert.equal(lookup.item,null);assert.match(lookup.reason,/recorded file plan changed/);
  }
  await atomicJSON(filename,original);
});
