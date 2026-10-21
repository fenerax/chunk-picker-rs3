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

test('a complete exact full pass skips opaque files, even forced early previous failures, and retains rollback proof',async t=>{
  const f=await fixture(t);
  const first=await runFileLane({...f.options,runId:'first'});
  assert.equal(first.summary.fresh,2);assert.equal(first.reused,false);assert.equal(first.summary.alwaysRun,2);
  assert.equal(first.files[0].record.metrics.provenance.cleanup.runId,'first');
  const early=await runFileLane({...f.options,runId:'later-early',phase:'previous',only:['tests/a.test.mjs'],force:true});
  assert.equal(early.summary.fresh,0);assert.equal(early.summary.wholeLaneReused,true);
  const full=await runFileLane({...f.options,runId:'later-full'});
  assert.equal(f.calls.length,1);assert.equal(full.summary.reused,2);assert.equal(full.reused,true);
  assert.deepEqual(full.summary.sourceRunIds,['first']);
  assert.equal(full.summary.fileDetails[0].disposition,'reused');
  await verifyFileLane({...f.options,item:full});
  // Shared expiry/removal cannot destroy the candidate's sealed rollback copy.
  await rm(f.directory,{recursive:true,force:true});
  await verifyFileLane({...f.options,item:full,retained:true});
  await writeFile(f.heavy,oneByte(await readFile(f.heavy)));
  await assert.rejects(verifyFileLane({...f.options,item:full}),/wrapper changed/);
  await verifyFileLane({...f.options,item:full,retained:true});
  const original=await json(full.laneEvidence.filename);original.files.pop();
  await atomicJSON(full.laneEvidence.filename,original);
  await assert.rejects(verifyFileLane({...f.options,item:full,retained:true}),/observation|changed/);
});

