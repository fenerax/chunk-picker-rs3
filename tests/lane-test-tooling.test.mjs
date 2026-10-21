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

import {fixture,hash,put,json,oneByte} from './lane-test-fixture.mjs';

test('every tooling byte change reruns opaque files, including an authorized new external wrapper pin',async t=>{
  const f=await fixture(t);await runFileLane({...f.options,runId:'baseline'});
  const original=await f.plan();
  const changes=['lane-test-evidence.mjs','file-test-lane.mjs','file-test-evidence.mjs','module-scan.mjs','release-evidence.mjs','release-identity.mjs','companion-check.mjs'].map(name=>path.join(f.kit,'tools',name));
  for(const [index,file]of changes.entries()) {
    const previous=await readFile(file);await writeFile(file,oneByte(previous));
    const changed=await f.plan();assert.notEqual(changed.key,original.key,file);
    assert.equal((await lookupLaneEvidence(f.directory,changed)).item,null);
    const run=await runFileLane({...f.options,runId:'mutation-'+index});
    assert.equal(run.summary.fresh,2,file);assert.equal(run.summary.reused,0,file);assert.equal(run.reused,false,file);
    await writeFile(file,previous);
  }
  const manifest=await json(path.join(f.kit,'kit.json'));
  const changedWrapper=oneByte(await readFile(f.heavy));await writeFile(f.heavy,changedWrapper);
  manifest.locks.heavy.sha256=hash(changedWrapper);
  await put(path.join(f.kit,'kit.json'),manifest);
  assert.notEqual((await f.plan()).key,original.key);
  assert.equal((await runFileLane({...f.options,runId:'wrapper-change'})).summary.fresh,2);
});
