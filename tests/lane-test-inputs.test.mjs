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

test('every whole-input class invalidates reuse, while paths and candidate names do not enter the key',async t=>{
  const f=await fixture(t);await runFileLane({...f.options,runId:'baseline'});
  const original=await f.plan();
  const changes=[
    path.join(f.release,'core/unimported-core.txt'),
    path.join(f.kit,'checks/private-source/unimported-private.txt'),
    path.join(f.kit,'checks/private-source/tests/core-overlays.json'),
    path.join(f.kit,'checks/private-source/scripts/adaptive-test-runner.mjs'),
    path.join(f.release,'core/scripts/test-selection.mjs'),
    path.join(f.release,'core/scripts/test.mjs'),
    path.join(f.kit,'operator/with-heavy.ps1'),
    f.browser,
  ];
  for(const [index,file]of changes.entries()) {
    const previous=await readFile(file);await writeFile(file,oneByte(previous));
    const changed=await f.plan();assert.notEqual(changed.key,original.key,file);
    assert.equal((await lookupLaneEvidence(f.directory,changed)).item,null);
    const run=await runFileLane({...f.options,runId:'mutation-'+index});
    assert.equal(run.summary.fresh,2,file);assert.equal(run.summary.reused,0,file);assert.equal(run.reused,false,file);
    await writeFile(file,previous);
  }
  await f.setPayload(oneByte('payload one'));assert.notEqual((await f.plan()).key,original.key);assert.equal((await runFileLane({...f.options,runId:'pack-mutation'})).summary.fresh,2);await f.setPayload('payload one');
  const changedText=oneByte('release text one');await put(f.text,changedText);f.companion.textOverrides[0].sha256=hash(changedText);await put(path.join(f.release,'companion.json'),f.companion);assert.notEqual((await f.plan()).key,original.key);assert.equal((await runFileLane({...f.options,runId:'text-mutation'})).summary.fresh,2);
  await put(f.text,'release text one');f.companion.textOverrides[0].sha256=hash('release text one');await put(path.join(f.release,'companion.json'),f.companion);
  assert.equal((await f.plan()).key,original.key);
  for(const options of [{lane:'public-full'},{execution:{...f.options.execution,digest:hash('changed Node/environment/policy')}},{runtimeOS:{...original.inputs.os,version:'changed OS'}},{retainedBrowser:hash('changed Chrome') }])assert.notEqual((await planLaneEvidence({...f.options,...options})).key,original.key);
  const relocated=path.join(f.root,'relocated');await cp(f.kit,path.join(relocated,'kit'),{recursive:true});await cp(f.release,path.join(relocated,'release'),{recursive:true});
  const movedCompanion={...f.companion,packsDir:path.join(relocated,'kit/packs')};await put(path.join(relocated,'release/companion.json'),movedCompanion);
  assert.equal((await planLaneEvidence({...f.options,kit:path.join(relocated,'kit'),release:path.join(relocated,'release')})).key,original.key);
});

