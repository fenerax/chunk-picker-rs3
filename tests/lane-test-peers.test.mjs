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

test('complete named failures preserve opaque peers; interrupted or partial observations never publish peers',async t=>{
  const f=await fixture(t);
  const failed=await runFileLane({...f.options,runId:'failed',execute:async files=>({passed:false,aborted:false,files:files.map((file,i)=>({file,passed:i===0}))})}).catch(e=>e);
  assert.deepEqual(failed.failedFiles,['tests/b.test.mjs']);
  const key=await f.plan(),attempt=(await lookupLaneEvidence(f.directory,key)).item;
  assert.equal(attempt.record.status,'failed');
  const recovered=await runFileLane({...f.options,runId:'recovered'});
  assert.deepEqual(f.calls,[['tests/b.test.mjs']]);
  assert.equal(recovered.summary.fresh,1);assert.equal(recovered.summary.reused,1);
  assert.equal(recovered.reused,false);assert.equal(recovered.summary.status,'mixed');
  assert.deepEqual(recovered.summary.sourceRunIds,['failed','recovered']);
  const second=await fixture(t);
  await assert.rejects(runFileLane({...second.options,runId:'aborted',execute:async files=>({passed:false,aborted:true,files:[{file:files[0],passed:true}]})}),/Incomplete/);
  assert.equal((await lookupLaneEvidence(second.directory,await second.plan())).item,null);
  assert.deepEqual(await readdir(path.join(second.directory,'lanes')),[(await second.plan()).lane+'-'+(await second.plan()).key+'.json.pending.json']);
  await runFileLane({...second.options,runId:'retry'});
  assert.equal(second.calls[0].length,2);
  // A later pending exact-key attempt blocks an older complete observation.
  const same=await second.plan();
  await beginLaneAttempt(second.directory,same,{runId:'crash',startedAt:new Date().toISOString(),command:'synthetic interrupted full lane'});
  assert.equal((await lookupLaneEvidence(second.directory,same)).reason,'whole-lane-pending');
});

