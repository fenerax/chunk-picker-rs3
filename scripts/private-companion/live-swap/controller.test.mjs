import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { SwapController } from './controller.mjs';
import { Journal, atomicJSON, latestCheckpoint, acquireOperation, replaceSynced } from './journal.mjs';
import os from 'node:os';

async function fixture(t) {
  const root = path.join((process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(), 'rs3-live-swap-tests')), 'operator-unit');
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'run-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const save = path.join(directory, 'state.json'); await atomicJSON(save, { schemaVersion: 1, state: { revision: 0 }, receipts: ['retained'] });
  let held = false, paused = false, writer = 'old', target, frozen = false, committed = 'old'; const calls = [];
  const make = name => {
    let state = name === 'old' ? 'owned' : 'stopped', standby = false;
    const identity = { release: name, port: name === 'old' ? 18701 : 18702, version: name };
    return { identity,
      async observe() { return { state, standby, processIdentity: { nonce: name, pid: 100 } }; },
      async standby() { state = 'owned'; standby = true; },
      async freeze() { return latestCheckpoint(directory); },
      async close() { calls.push(`close-${name}`); state = 'stopped'; if (writer === name) writer = null; },
      async activate(checkpoint) { assert.equal(writer, null); assert.deepEqual(checkpoint, await latestCheckpoint(directory)); writer = name; state = 'owned'; standby = false; calls.push(`activate-${name}`); },
      async verify() { return { ready: true, standby, savesReady: !standby, revision: (await latestCheckpoint(directory)).revision, version: name, liveSwapProtocol: 2, actionReceiptFormat: 2, saveSchemaVersion: 1 }; },
      uncertain() { state = 'uncertain'; },
    };
  };
  const old = make('old'), next = make('next'); target = old.identity;
  const managed = {
    async acquire() { assert.equal(held, false); held = true; return async () => { held = false; }; },
    async assertHeld() { assert.equal(held, true); }, async pause() { paused = true; },
    async assertStoreReleased() { assert.equal(writer, null); },
    async commit(identity) { committed = identity.release; }, async unpause() { paused = false; },
  };
  const frontDoor = {
    async freeze() { frozen = true; }, async drain() {}, async route(identity) { assert.equal(frozen, true); target = identity; },
    async status() { return { target, frozen }; },
    async probe() { assert.equal(writer, target.release); return (writer === 'old' ? old : next).verify(); },
    async resume(identity) { assert.deepEqual(identity, target); frozen = false; },
  };
  const options = { journal: path.join(directory, 'journal.json'), dataDir: directory, old, next, managed, frontDoor, policy: { mode: 'verification' } };
  return { ...options, directory, save, calls, status: () => ({ held, paused, writer, target, frozen, committed }), controller: extra => new SwapController({ ...options, ...extra }) };
}

test('successful transaction durably commits before admission with one writer', async t => {
  const f = await fixture(t); const state = await f.controller().swap();
  assert.equal(state.phase, 'admitted'); assert.equal(f.status().writer, 'next'); assert.equal(f.status().committed, 'next');
  assert.equal(f.status().frozen, false); assert.equal(f.status().paused, false);
  assert.deepEqual(f.calls, ['close-old', 'activate-next']);
});

for (const phase of ['prepared', 'standby-intent', 'freeze-intent', 'frozen', 'release-intent', 'released', 'activate-intent', 'acquired', 'commit-intent', 'committed', 'admitted']) {
  test(`interruption at ${phase} recovers latest receipts with deterministic writer`, async t => {
    const f = await fixture(t);
    await assert.rejects(f.controller({ onPhase(name) { if (name === phase) throw new Error('injected interruption'); } }).swap());
    assert.equal(f.status().frozen, true); assert.equal(f.status().paused, true);
    const value = JSON.parse(await readFile(f.save)); value.state.revision = 8; value.receipts.push('accepted-after-cutover'); await atomicJSON(f.save, value);
    const recovered = await f.controller().recover();
    const expected = ['commit-intent', 'committed', 'admitted'].includes(phase) ? 'next' : 'old';
    assert.equal(f.status().writer, expected); assert.equal(recovered.recoveryCheckpoint.revision, 8);
    assert.deepEqual(JSON.parse(await readFile(f.save)).receipts, ['retained', 'accepted-after-cutover']);
    assert.equal(f.status().frozen, false); assert.equal(f.status().held, false);
  });
}

test('uncertain ownership stays durably frozen and paused; no writer activation', async t => {
  const f = await fixture(t); await f.controller().swap(); f.next.uncertain();
  await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_OWNERSHIP_UNCERTAIN' });
  assert.equal(f.status().frozen, true); assert.equal(f.status().paused, true);
  assert.equal((await new Journal(f.journal).read()).phase, 'recovery-required');
});
test('corrupt journal freezes without selecting stale evidence or modifying the save', async t => {
  const f = await fixture(t); await f.controller().swap(); const before = await readFile(f.save);
  await writeFile(f.journal, '{broken'); await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_JOURNAL_INVALID' });
  assert.equal(f.status().frozen, true); assert.equal(f.status().paused, true); assert.deepEqual(await readFile(f.save), before);
});
test('kernel controller ownership rejects concurrency and releases on close', async t => {
  const f = await fixture(t), release = await acquireOperation(f.journal);
  await assert.rejects(acquireOperation(f.journal)); await release(); await (await acquireOperation(f.journal))();
});
test('changed release identity refuses recovery before stopping a known writer', async t => {
  const f = await fixture(t); await f.controller().swap(); f.next.identity.version = 'changed';
  await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_RECOVERY_IDENTITY' });
  assert.equal(f.status().frozen, true); assert.equal(f.calls.length, 2);
});

for (const boundary of ['after-activate', 'after-commit', 'after-resume']) test(`interruption after side effect ${boundary} follows durable selection`, async t => {
  const f = await fixture(t);
  await assert.rejects(f.controller({ onBoundary(name) { if (name === boundary) throw new Error('Interrupted after side effect'); } }).swap());
  assert.equal(f.status().frozen, true); const recovered = await f.controller().recover();
  assert.equal(f.status().writer, boundary === 'after-activate' ? 'old' : 'next'); assert.ok(['admitted', 'rolled-back'].includes(recovered.phase));
});
for (const phase of ['recovery-stopping', 'recovery-released', 'recovery-acquired', 'recovery-committed']) test(`recovery itself interrupted at ${phase} resumes latest document`, async t => {
  const f = await fixture(t); await f.controller().swap();
  await assert.rejects(f.controller({ onPhase(name) { if (name === phase) throw new Error('Interrupted recovery'); } }).recover());
  assert.equal(f.status().frozen, true); assert.equal(f.status().paused, true);
  await f.controller().recover(); assert.equal(f.status().writer, 'next'); assert.equal(f.status().frozen, false);
});
test('automatic budget evidence refusal leaves existing writer admission unchanged', async t => {
  const f = await fixture(t); await assert.rejects(f.controller({ policy: { mode: 'automatic' } }).swap(), { code: 'LIVE_SWAP_BUDGET_EVIDENCE' });
  assert.equal(f.status().writer, 'old'); assert.equal(f.status().frozen, false); assert.equal(f.status().paused, false);
});
test('durable budget overrun latch rejects later automatic attempts', async t => {
  const f = await fixture(t); await atomicJSON(`${f.journal}.budget-blocked.json`, { automaticDisabled: true });
  await assert.rejects(f.controller({ policy: { mode: 'automatic' } }).swap(), { code: 'LIVE_SWAP_BUDGET_BLOCKED' });
  assert.equal(f.status().writer, 'old'); assert.equal(f.status().frozen, false);
});
test('busy excluded request defers before release and reopens the same writer', async t => {
  const f = await fixture(t); f.old.freeze = async () => { throw Object.assign(new Error('Excluded request'), { code: 'LIVE_SWAP_BUSY' }); };
  const result = await f.controller().swap(); assert.equal(result.deferred, true); assert.equal(result.phase, 'rolled-back');
  assert.equal(f.status().writer, 'old'); assert.equal(f.status().frozen, false); assert.equal(f.status().paused, false); assert.deepEqual(f.calls, ['close-next']);
});
test('a reused controller clears attempt state before later budget refusal', async t => {
  const f = await fixture(t), controller = f.controller(); await controller.swap(); const before = await readFile(f.journal);
  controller.policy = { mode: 'automatic' }; await assert.rejects(controller.swap());
  assert.equal(f.status().writer, 'next'); assert.equal(f.status().frozen, false); assert.deepEqual(await readFile(f.journal), before);
});
test('Windows replacement retries the same synchronized temporary without deleting old evidence', async t => {
  const f = await fixture(t), temporary = path.join(f.directory, 'pending.tmp'), destination = path.join(f.directory, 'retained.json');
  await writeFile(temporary, 'new'); await writeFile(destination, 'old'); const calls = [];
  await replaceSynced(temporary, destination, { platform: 'win32', pause: async () => {}, replace: async (source, target) => {
    calls.push([source, target]); assert.equal(await readFile(destination, 'utf8'), 'old'); assert.equal(await readFile(temporary, 'utf8'), 'new');
    if (calls.length < 4) throw Object.assign(new Error('Temporary sharing violation'), { code: ['EPERM', 'EACCES', 'EBUSY'][calls.length - 1] });
    const { rename } = await import('node:fs/promises'); await rename(source, target);
  } });
  assert.equal(calls.length, 4); assert.ok(calls.every(call => call[0] === temporary && call[1] === destination)); assert.equal(await readFile(destination, 'utf8'), 'new');
});
test('persistent Windows replacement refusal is bounded and keeps old evidence intact', async t => {
  const f = await fixture(t), temporary = path.join(f.directory, 'pending.tmp'), destination = path.join(f.directory, 'retained.json');
  await writeFile(temporary, 'new'); await writeFile(destination, 'old'); let attempts = 0;
  await assert.rejects(replaceSynced(temporary, destination, { platform: 'win32', pause: async () => {}, replace: async () => { attempts++; throw Object.assign(new Error('Refused'), { code: 'EPERM' }); } }), { code: 'EPERM' });
  assert.equal(attempts, 7); assert.equal(await readFile(destination, 'utf8'), 'old'); assert.equal(await readFile(temporary, 'utf8'), 'new');
});
for (const boundary of ['acquired', 'committed']) test(`crash at ${boundary} recovers from the preceding durable intent and latest receipts`, async t => {
  const f = await fixture(t); let retained;
  await assert.rejects(f.controller({ onPhase: async name => {
    if (name !== boundary) return;
    retained = await new Journal(f.journal).read(); assert.equal(retained.phase, boundary === 'acquired' ? 'freeze-intent' : 'commit-intent');
    if (boundary === 'acquired') assert.equal(retained.checkpoint, undefined);
    throw new Error('Simulated hard process loss');
  } }).swap());
  // A hard kill cannot run the controller catch. Restore exactly the durable
  // bytes observed at the kill boundary, then append a later authoritative save.
  const crashJournal = new Journal(f.journal); await crashJournal.read(); await crashJournal.write(retained);
  const value = JSON.parse(await readFile(f.save)); value.state.revision = 9; value.receipts.push('latest-after-durable-intent'); await atomicJSON(f.save, value);
  await f.controller().recover(); assert.equal(f.status().writer, boundary === 'acquired' ? 'old' : 'next');
  assert.equal((await latestCheckpoint(f.directory)).revision, 9); assert.equal(JSON.parse(await readFile(f.save)).receipts.at(-1), 'latest-after-durable-intent');
});
test('diagnostic failure observed after resume refuses success and keeps committed recovery selection', async t => {
  const f = await fixture(t), resume = f.frontDoor.resume;
  f.frontDoor.resume = async identity => { await resume(identity); await f.frontDoor.freeze(); };
  await assert.rejects(f.controller().swap(), { code: 'LIVE_SWAP_DOOR_FROZEN_AFTER_RESUME' });
  assert.equal(f.status().frozen, true); assert.equal(f.status().paused, true); assert.equal((await new Journal(f.journal).read()).preferred, 'next');
  f.frontDoor.resume = resume; await f.controller().recover(); assert.equal(f.status().writer, 'next'); assert.equal(f.status().frozen, false);
});
test('requireIdle defers while an accepted old action finishes and advances the revision', async t => {
  const f = await fixture(t);
  f.old.freeze = async options => {
    assert.deepEqual(options, { requireIdle: true });
    const value = JSON.parse(await readFile(f.save)); value.state.revision = 1; value.receipts.push('accepted-before-defer'); await atomicJSON(f.save, value);
    throw Object.assign(new Error('Accepted action in flight'), { code: 'LIVE_SWAP_BUSY' });
  };
  const result = await f.controller().swap(); assert.equal(result.deferred, true); assert.equal(f.status().writer, 'old'); assert.equal(f.status().frozen, false);
  assert.equal((await latestCheckpoint(f.directory)).revision, 1); assert.deepEqual(f.calls, ['close-next']);
});

async function replaceRevision(f, revision, metadata = {}) {
  const value = JSON.parse(await readFile(f.save)); value.state.revision = revision; Object.assign(value, metadata); await atomicJSON(f.save, value);
}
test('recovery refuses a physical save below its durable checkpoint without activating or restoring', async t => {
  const f = await fixture(t); await replaceRevision(f, 7); await f.controller().swap(); await replaceRevision(f, 6);
  const before = await readFile(f.save), activations = f.calls.filter(call => call.startsWith('activate-')).length;
  await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_REVISION_REGRESSION' });
  assert.equal(f.status().writer, null); assert.equal(f.status().frozen, true); assert.equal(f.status().paused, true);
  assert.equal(f.calls.filter(call => call.startsWith('activate-')).length, activations); assert.deepEqual(await readFile(f.save), before);
  assert.equal((await new Journal(f.journal).read()).phase, 'recovery-required');
});
test('precommit standby intent retains the observed old revision floor', async t => {
  const f = await fixture(t); await replaceRevision(f, 7);
  await assert.rejects(f.controller({ onPhase(name) { if (name === 'freeze-intent') throw new Error('Interrupted before freeze'); } }).swap());
  const state = await new Journal(f.journal).read(); assert.equal(state.checkpoint, undefined); assert.deepEqual(state.revisionFloor, { revision: 7, schemaVersion: 1 });
  await replaceRevision(f, 6); await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_REVISION_REGRESSION' }); assert.equal(f.status().writer, null);
});
test('a replacement transaction retains the preceding durable revision floor', async t => {
  const f = await fixture(t); await replaceRevision(f, 7); await f.controller().swap();
  const reverse = { old: f.next, next: f.old, onPhase(name) { if (name === 'prepared') throw new Error('Interrupted before health probe'); } };
  await assert.rejects(f.controller(reverse).swap()); assert.deepEqual((await new Journal(f.journal).read()).revisionFloor, { revision: 7, schemaVersion: 1 });
  await replaceRevision(f, 6); await assert.rejects(f.controller({ old: f.next, next: f.old }).recover(), { code: 'LIVE_SWAP_REVISION_REGRESSION' });
});
test('interrupted recovery retains the newest recovery checkpoint as a floor', async t => {
  const f = await fixture(t); await f.controller().swap(); await replaceRevision(f, 9);
  await assert.rejects(f.controller({ onPhase(name) { if (name === 'recovery-released') throw new Error('Interrupted recovery'); } }).recover());
  await replaceRevision(f, 8); await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_REVISION_REGRESSION' }); assert.equal(f.status().writer, null);
});
for (const revision of [7, 8]) test(`recovery accepts latest revision ${revision} including changed ACK metadata`, async t => {
  const f = await fixture(t); await replaceRevision(f, 7); await f.controller().swap();
  await replaceRevision(f, revision, { acknowledgements: { slot: 4, sequence: 12 } }); const before = await readFile(f.save);
  const recovered = await f.controller().recover(); assert.equal(recovered.recoveryCheckpoint.revision, revision); assert.equal(f.status().writer, 'next');
  assert.deepEqual(await readFile(f.save), before); assert.equal(f.status().frozen, false);
});
test('recovery refuses a physical schema inconsistent with the durable floor', async t => {
  const f = await fixture(t); await replaceRevision(f, 7); await f.controller().swap(); await replaceRevision(f, 8, { schemaVersion: 2 });
  const before = await readFile(f.save); await assert.rejects(f.controller().recover(), { code: 'LIVE_SWAP_SCHEMA_REGRESSION' });
  assert.equal(f.status().writer, null); assert.equal(f.status().frozen, true); assert.deepEqual(await readFile(f.save), before);
});
test('automatic promotion passes the qualified size bound atomically and defers warmup save growth without releasing old', async t => {
  const f = await fixture(t), maxSaveBytes = (await readFile(f.save)).byteLength, standby = f.next.standby;
  const evidence = { schemaVersion: 1, representative: true, liveSwapProtocol: 2, actionReceiptFormat: 2, old: f.old.identity, next: f.next.identity, maxFreezeMs: 100, maxSaveBytes };
  f.next.standby = async () => { await standby(); await replaceRevision(f, 1, { imported: 'newly accepted data'.repeat(100) }); };
  f.old.freeze = async options => {
    assert.deepEqual(options, { requireIdle: true, maxSaveBytes }); assert.ok((await readFile(f.save)).byteLength > options.maxSaveBytes);
    // The real core performs this check under its admission/store freeze fence
    // and restores normal old-store admission before returning LIVE_SWAP_BUSY.
    throw Object.assign(new Error('Qualified size exceeded'), { code: 'LIVE_SWAP_BUSY' });
  };
  const state = await f.controller({ policy: { mode: 'automatic', freezeBudgetEvidence: evidence } }).swap();
  assert.equal(state.deferred, true); assert.equal(f.status().writer, 'old'); assert.equal(f.status().committed, 'old');
  assert.equal(f.status().paused, false); assert.equal(f.status().frozen, false); assert.deepEqual(f.calls, ['close-next']);
  assert.deepEqual(state.revisionFloor, { revision: 1, schemaVersion: 1 });
});
