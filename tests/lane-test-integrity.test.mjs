// Synthetic observations only; every source, proof and cleanup root is disposable.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runFileLane, verifyFileLane, planLane } from '../scripts/private-companion/file-test-lane.mjs';
import { planLaneEvidence, lookupLaneEvidence, laneEvidenceFilename, beginLaneAttempt } from '../scripts/private-companion/lane-test-evidence.mjs';
import { gateContract, atomicJSON } from '../scripts/private-companion/release-evidence.mjs';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';

import {fixture,hash,put,json} from './lane-test-fixture.mjs';

test('stale, missing, tampered, partial and wrong-tooling records miss; rejected bytes survive a fresh run',async t=>{
  const f=await fixture(t);await runFileLane({...f.options,runId:'baseline'});
  const contract=await f.plan(),filename=laneEvidenceFilename(f.directory,contract),original=await json(filename);
  for(const edit of [record=>{record.completed=false;},record=>{record.status='failed';},record=>{record.contract.lane='public-full';},record=>{record.runId=null;},record=>{record.contract.inputs.tooling.adaptive=hash('old tooling');}]){
    const record=structuredClone(original);edit(record);await atomicJSON(filename,record);assert.equal((await lookupLaneEvidence(f.directory,contract)).item,null);
  }
  const stale=structuredClone(original);stale.startedAt=stale.completedAt=new Date(Date.now()-8*86400000).toISOString();stale.cleanup.completedAt=stale.completedAt;const {digest,...body}=stale;stale.digest=digestValue(body);await atomicJSON(filename,stale);
  assert.equal((await lookupLaneEvidence(f.directory,contract)).item,null);
  const rerun=await runFileLane({...f.options,runId:'genuine-rerun'});
  assert.equal(rerun.reused,false);assert.equal(rerun.aggregateReused,true);
  assert.equal(f.calls.length,2);assert.equal((await readdir(path.dirname(filename))).some(name=>name.includes('.rejected-')),true);
  const current=(await lookupLaneEvidence(f.directory,contract)).item;
  await rm(current.record.files[0].proof.filename);
  assert.equal((await lookupLaneEvidence(f.directory,contract)).item,null);
});

