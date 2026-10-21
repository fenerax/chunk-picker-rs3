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

test('lookup misses write nothing; post-cleanup whole-byte changes refuse publication; same-round opaque observations pin the whole key',async t=>{
  const f=await fixture(t);
  await assert.rejects(runFileLane({...f.options,lookupOnly:true}),error=>error.needsAdmission===true);
  await assert.rejects(readFile(path.join(f.directory,'lanes')),error=>error.code==='ENOENT');
  const early=await runFileLane({...f.options,runId:'same-round',only:['tests/a.test.mjs'],phase:'pipeline'});
  assert.equal(early.summary.stage,'early-pipeline-private-full');
  await put(path.join(f.release,'core/other-input.txt'),'changed whole key');
  const full=await runFileLane({...f.options,runId:'same-round',earned:early.files});
  assert.equal(full.summary.fresh,2);assert.equal(f.calls[1].length,2);
  const second=await fixture(t);
  await assert.rejects(runFileLane({...second.options,execute:async files=>{
    await put(path.join(second.kit,'checks/private-source/unimported.txt'),'mutation after tests');
    return {passed:true,files:files.map(file=>({file,passed:true}))};
  }}),/inputs changed/);
  assert.equal((await lookupLaneEvidence(second.directory,await second.plan())).item,null);
});
