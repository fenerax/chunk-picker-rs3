import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { openUsageStore } from '../app/storage/usage.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';
import { actionFingerprint } from '../app/storage/action-receipts.mjs';
import { preserveGameIdentity } from '../app/game-profile.mjs';
const initialState = () => createGroupState([{ id: 'one', name: 'Synthetic One' }, { id: 'two', name: 'Synthetic Two' }]);
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const clientId = '00112233-4455-4677-8899-aabbccddeeff';
const idFor = (session, sequence = 1) => `v3.${session.scope}.${session.slot}.${session.generation}.${sequence}`;
async function directory(t) {
  const base = path.resolve('var/test-live-swap-storage'); await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'fixture-'));
  t.after(() => rm(dataDir, { recursive: true, force: true })); return dataDir;
}
test('receipt and action commit atomically, survive transfer and reject changed identity/payload', async t => {
  const dataDir = await directory(t);
  let store = await openStore({ dataDir, initialState: initialState(), retention: false });
  t.after(() => store.close());
  const actor = { kind: 'master', label: 'Synthetic operator' };
  const requestId = idFor(await store.openActionSession(clientId, { actor }));
  await store.command(command, 0, { requestId, actor });
  assert.equal((await store.command(command, 0, { requestId, actor })).revision, 1);
  await assert.rejects(() => store.command({ ...command, value: true }, 0, { requestId, actor }), { code: 'REQUEST_ID_MISMATCH' });
  await assert.rejects(() => store.command(command, 0, { requestId, actor: { kind: 'invite', inviteId: 'e425a257-aa94-4fbc-a614-d8a1b294998a', label: 'Other' } }), { code: 'ACTION_SESSION_MISMATCH' });
  const checkpoint = await store.freeze(); await store.close();
  store = await openStore({ dataDir, expectedCheckpoint: checkpoint, liveSwapStrict: true, retention: false });
  assert.equal((await store.command(command, 0, { requestId, actor })).revision, 1);
  assert.equal(store.getState().history.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'state.json'))).actionReceipts.slots[0].receipt.revision, 1);
});
test('a failed atomic write leaves neither receipt nor new revision', async t => {
  const dataDir = await directory(t);
  let fail = true;
  const store = await openStore({ dataDir, initialState: initialState(), retention: false, beforeCommit() { if (fail) throw new Error('Injected disk failure'); } });
  t.after(() => store.close());
  const requestId = idFor(await store.openActionSession(clientId));
  await assert.rejects(() => store.command(command, 0, { requestId }), /Injected disk failure/);
  const disk = JSON.parse(await readFile(path.join(dataDir, 'state.json')));
  assert.equal(disk.state.revision, 0); assert.equal(disk.actionReceipts.slots[0].receipt, undefined);
  fail = false;
  assert.equal((await store.command(command, 0, { requestId })).revision, 1);
});
test('standby takes no writer lock and performs no filesystem writes; freeze rejects new commands', async t => {
  const dataDir = await directory(t), writer = await openStore({ dataDir, initialState: initialState(), retention: false });
  t.after(() => writer.close());
  const before = await readFile(path.join(dataDir, 'state.json')), owner = await readFile(path.join(dataDir, 'store.lock'));
  const names = await readdir(dataDir);
  const standby = await openStore({ dataDir, readOnly: true }); t.after(() => standby.close());
  await assert.rejects(() => standby.command(command, 0), { code: 'PICKER_UPDATING' });
  await standby.close();
  assert.deepEqual(await readdir(dataDir), names); assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), before);
  assert.deepEqual(await readFile(path.join(dataDir, 'store.lock')), owner);
  await assert.rejects(() => openStore({ dataDir }), /already holds/);
  await writer.freeze(); await assert.rejects(() => writer.command(command, 0), { code: 'PICKER_UPDATING' });
});
test('migration and changed final checkpoint refuse before touching the authoritative document', async t => {
  const dataDir = await directory(t), writer = await openStore({ dataDir, initialState: initialState(), retention: false });
  const before = await readFile(path.join(dataDir, 'state.json'));
  await assert.rejects(() => openStore({ dataDir, readOnly: true, prepareState: state => ({ ...state, rules: { ...state.rules, 'access.shared': false } }) }), { code: 'LIVE_SWAP_MIGRATION_REQUIRED' });
  const checkpoint = await writer.freeze(); await writer.close();
  await assert.rejects(() => openStore({ dataDir, expectedCheckpoint: { ...checkpoint, sha256: '0'.repeat(64) }, liveSwapStrict: true }), /checkpoint changed/);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), before);
  const recovered = await openStore({ dataDir, expectedCheckpoint: checkpoint, liveSwapStrict: true, retention: false }); await recovered.close();
});
test('an unsupported storage format is refused without rewriting or locking it in standby', async t => {
  const dataDir = await directory(t), writer = await openStore({ dataDir, initialState: initialState(), retention: false });
  await writer.close();
  const file = path.join(dataDir, 'state.json'), document = JSON.parse(await readFile(file));
  document.schemaVersion = 99;
  const bytes = JSON.stringify(document); await writeFile(file, bytes);
  await assert.rejects(() => openStore({ dataDir, readOnly: true, liveSwapStrict: true }), /Unsupported backup schema version/);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.ok(!(await readdir(dataDir)).includes('store.lock'));
});
test('standby usage retention is read only on open, read and attempted write', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'usage.json');
  const bytes = JSON.stringify({ schemaVersion: 1, counts: [{ id: usageEvents[0].id, actor: 'one', device: 'desktop', day: '2020-01-01', count: 1 }] });
  await writeFile(file, bytes);
  const storage = await openUsageStore({ dataDir, actors: ['one', 'two'], readOnly: true });
  t.after(() => storage.close());
  assert.deepEqual((await storage.read()).counts, []);
  await assert.rejects(() => storage.add({ counts: [] }, 'one'), /read only/);
  await storage.close(); assert.equal(await readFile(file, 'utf8'), bytes);
});
test('bridge-era receipts load byte-for-byte and convert only on an explicit mutation', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'state.json');
  let store = await openStore({ dataDir, initialState: initialState(), retention: false });
  await store.command(command, 0); await store.close();
  const document = JSON.parse(await readFile(file));
  document.actionReceipts = { [clientId]: { fingerprint: actionFingerprint(command), revision: 1 } };
  const bytes = JSON.stringify(document); await writeFile(file, bytes);
  const before = await stat(file);
  store = await openStore({ dataDir, liveSwapStrict: true, retention: false });
  assert.equal((await store.command(command, 0, { requestId: clientId })).revision, 1);
  assert.equal(await readFile(file, 'utf8'), bytes); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  await store.openActionSession(clientId);
  assert.equal(JSON.parse(await readFile(file)).actionReceipts.format, 2);
  assert.equal(store.getState().revision, 1); await store.close();
});
test('restores retain receipts and old no-ID clients keep revision-checked conflicts', async t => {
  const dataDir = await directory(t);
  const world = { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
  let store = await openStore({ dataDir, world, initialState: initialState(), retention: false });
  t.after(() => store.close()); const requestId = idFor(await store.openActionSession(clientId));
  const first = await store.commandSerialized(command, 0, { requestId });
  await store.replace(initialState(), 1);
  const replay = await store.commandSerialized(command, 0, { requestId });
  assert.equal(replay.revision, 2); assert.deepEqual(replay.receipt, first.receipt);
  await assert.rejects(() => store.command(command, 0), { code: 'REVISION_CONFLICT' });
  await store.acknowledgeActionSession(clientId, { slot: 0, generation: 1, sequence: 1, scope: requestId.split('.')[1] });
  const checkpoint = await store.freeze(); await store.close();
  store = await openStore({ dataDir, world, expectedCheckpoint: checkpoint, liveSwapStrict: true, retention: false });
  await assert.rejects(() => store.command(command, 2, { requestId }), { code: 'REQUEST_ACKNOWLEDGED' });
  assert.equal(store.getState().revision, 2);
});
test('freeze size caps validate before admission and preserve an existing freeze on refusal', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'state.json');
  const store = await openStore({ dataDir, initialState: initialState(), retention: false });
  t.after(() => store.close());
  for (const maxSaveBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '100', null]) {
    await assert.rejects(store.freeze({ maxSaveBytes }), /positive safe integer/);
  }
  await assert.rejects(store.freeze({ maxSaveBytes: 1 }), { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await store.command(command, 0)).revision, 1);
  const bytes = await readFile(file);
  assert.equal((await store.freeze({ maxSaveBytes: bytes.length })).revision, 1);
  await assert.rejects(store.freeze({ maxSaveBytes: 1 }), { code: 'LIVE_SWAP_BUSY' });
  await assert.rejects(store.command({ ...command, value: true }, 1), { code: 'PICKER_UPDATING' });
});

test('freeze checks the exact UTF-8 size after an accepted growing command drains and restores the writer', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'state.json');
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  t.after(() => proceed.resolve());
  const world = { chunks: new Map([['12341', {}]]), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
  const store = await openStore({ dataDir, world, initialState: initialState(), retention: false,
    beforeCommit: async ({ state }) => { if (state.revision === 1) { entered.resolve(); await proceed.promise; } } });
  t.after(() => store.close());
  const maxSaveBytes = (await readFile(file)).length;
  const saving = store.command({ type: 'set-note', memberId: 'one', chunkId: '12341', note: 'é'.repeat(512) }, 0);
  await Promise.race([entered.promise, saving.then(() => { throw new Error('The save completed before the commit gate.'); })]);
  const freezing = store.freeze({ maxSaveBytes }); freezing.catch(() => {});
  await assert.rejects(store.freeze(), { code: 'LIVE_SWAP_BUSY' });
  proceed.resolve(); await saving;
  await assert.rejects(freezing, { code: 'LIVE_SWAP_BUSY' });
  const committed = await readFile(file);
  assert.ok(committed.length > maxSaveBytes);
  assert.ok(committed.length > committed.toString('utf8').length);
  await assert.rejects(store.freeze({ maxSaveBytes: committed.toString('utf8').length }), { code: 'LIVE_SWAP_BUSY' });
  assert.equal((await store.command(command, 1)).revision, 2);
  assert.equal((await store.freeze({ maxSaveBytes: (await readFile(file)).length })).revision, 2);
});

test('maintenance excludes freeze and cannot start while a store is frozen', async t => {
  const dataDir = await directory(t), store = await openStore({ dataDir, initialState: initialState(), retention: false });
  t.after(() => store.close());
  const reading = store.listBackups();
  await assert.rejects(store.freeze(), { code: 'LIVE_SWAP_BUSY' });
  await reading;
  assert.equal((await store.command(command, 0)).revision, 1);
  await store.freeze();
  await assert.rejects(store.listBackups(), { code: 'PICKER_UPDATING' });
});
test('backup browsing remains read only during ordinary close and after close, while freeze still refuses read START', async t => {
  const dataDir = await directory(t), store = await openStore({ dataDir, initialState: initialState(), retention: false });
  t.after(() => store.close());
  await store.command(command, 0);
  const [snapshot] = await store.listBackups();
  const accepted = store.readBackup(snapshot.id);
  await assert.rejects(store.freeze(), { code: 'LIVE_SWAP_BUSY' });
  await accepted;
  const browsing = store.listBackups(), closing = store.close();
  assert.equal((await browsing).length, 1);
  assert.equal((await store.readBackup(snapshot.id)).state.revision, 0);
  await closing;
  async function diskSnapshot(directory) {
    const files = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), info = await stat(file);
      files[entry.name] = entry.isDirectory() ? await diskSnapshot(file)
        : { size: info.size, mtime: info.mtimeMs, bytes: (await readFile(file)).toString('base64') };
    }
    return files;
  }
  const before = await diskSnapshot(dataDir);
  assert.equal((await store.listBackups()).length, 1);
  assert.equal((await store.readBackup(snapshot.id)).state.revision, 0);
  assert.deepEqual(await diskSnapshot(dataDir), before);
  const frozen = await openStore({ dataDir, retention: false });
  t.after(() => frozen.close());
  await frozen.freeze();
  await assert.rejects(frozen.listBackups(), { code: 'PICKER_UPDATING' });
  await assert.rejects(frozen.readBackup(snapshot.id), { code: 'PICKER_UPDATING' });
});
test('a warmed standby acquires the original locks and latest receipts without rewriting the checkpoint', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'state.json');
  const writer = await openStore({ dataDir, initialState: initialState(), retention: false });
  const standby = await openStore({ dataDir, readOnly: true, retention: false });
  t.after(async () => { await writer.close(); await standby.close(); });
  const session = await writer.openActionSession(clientId), requestId = idFor(session);
  await writer.command(command, 0, { requestId });
  await assert.rejects(standby.activate({ schemaVersion: 1 }), /already holds/);
  const checkpoint = await writer.freeze(); await writer.close();
  const bytes = await readFile(file), before = await stat(file);
  await assert.rejects(standby.activate({ ...checkpoint, sha256: '0'.repeat(64) }), /checkpoint changed/);
  assert.equal((await readdir(dataDir)).includes('store.lock'), false);
  await standby.activate(checkpoint);
  assert.deepEqual(await readFile(file), bytes); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await standby.command(command, 0, { requestId })).revision, 1);
  assert.equal((await standby.command({ ...command, value: true }, 1, { requestId: idFor(session, 2), requestAck: 1 })).revision, 2);
  await assert.rejects(() => openStore({ dataDir }), /already holds/);
});
test('shutdown waits for in-flight standby activation and cancels ownership publication', async t => {
  const dataDir = await directory(t), entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  t.after(() => proceed.resolve());
  const writer = await openStore({ dataDir, initialState: initialState(), retention: false });
  let pause = false;
  const standby = await openStore({ dataDir, readOnly: true, retention: false, prepareState: async state => {
    if (pause) { entered.resolve(); await proceed.promise; } return state;
  } });
  t.after(async () => { await writer.close(); await standby.close(); });
  const checkpoint = await writer.freeze(); await writer.close(); pause = true;
  const activation = standby.activate(checkpoint); activation.catch(() => {}); await entered.promise;
  let closed = false; const closing = standby.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false);
  proceed.resolve(); await assert.rejects(activation, /cancelled by shutdown/); await closing;
  const fresh = await openStore({ dataDir, expectedCheckpoint: checkpoint, liveSwapStrict: true, retention: false }); await fresh.close();
});
test('checkpoint fences the last acknowledged bytes and refuses external drift before acquisition', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'state.json');
  const writer = await openStore({ dataDir, initialState: initialState(), retention: false });
  const standby = await openStore({ dataDir, readOnly: true, retention: false });
  t.after(async () => { await writer.close(); await standby.close(); });
  const original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from('\n')]));
  const checkpoint = await writer.freeze(); await writer.close();
  await assert.rejects(standby.activate(checkpoint), /checkpoint changed/);
  assert.equal((await readdir(dataDir)).includes('store.lock'), false);
});

test('checkpoints and pinned evidence preserve physical bytes when different UTF-8 bytes decode identically', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'state.json');
  const state = initialState(); state.members[0].name = 'Synthetic \uFFFD One';
  const seed = await openStore({ dataDir, initialState: state, retention: false }); await seed.close();
  const original = await readFile(file), marker = Buffer.from('\uFFFD'), offset = original.indexOf(marker);
  assert.ok(offset >= 0);
  const physical = Buffer.concat([original.subarray(0, offset), Buffer.from([0xff]), original.subarray(offset + marker.length), Buffer.from(' \t\r\n')]);
  await writeFile(file, physical);
  const before = await stat(file), digest = value => createHash('sha256').update(value).digest('hex');
  const writer = await openStore({ dataDir, liveSwapStrict: true, retention: false });
  t.after(() => writer.close());
  assert.deepEqual(await readFile(file), physical); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.ok(Buffer.byteLength(physical.toString('utf8')) > physical.length);
  const checkpoint = await writer.freeze({ maxSaveBytes: physical.length }); await writer.close();
  assert.equal(checkpoint.sha256, digest(physical));
  assert.notEqual(checkpoint.sha256, digest(physical.toString('utf8')));
  const standby = await openStore({ dataDir, readOnly: true, liveSwapStrict: true, retention: false });
  t.after(() => standby.close());
  assert.deepEqual(await readFile(file), physical); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await standby.activate(checkpoint)).revision, 0);
  assert.deepEqual(await standby.freeze({ maxSaveBytes: physical.length }), checkpoint);
  assert.deepEqual(await readFile(file), physical); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  await standby.close();
  const stale = await openStore({ dataDir, readOnly: true, liveSwapStrict: true, retention: false });
  t.after(() => stale.close());
  const changed = Buffer.from(physical); changed[offset] = 0xfe;
  assert.deepEqual(JSON.parse(changed), JSON.parse(physical));
  await writeFile(file, changed);
  await assert.rejects(stale.activate(checkpoint), /checkpoint changed/);
  assert.equal((await readdir(dataDir)).includes('store.lock'), false);
  assert.deepEqual(await readFile(file), changed);
  // A subsequent explicit replacement can acquire the released guards, and its
  // pinned prior snapshot must retain raw evidence rather than decoded text.
  const replacement = await openStore({ dataDir, liveSwapStrict: true, retention: false });
  t.after(() => replacement.close());
  await replacement.replace(initialState(), 0);
  const snapshot = (await replacement.listBackups()).find(item => item.revision === 0);
  const pinned = gunzipSync(await readFile(path.join(dataDir, 'backups', snapshot.id)));
  assert.deepEqual(pinned, Buffer.concat([changed.subarray(0, changed.lastIndexOf(0x7d)), Buffer.from(',"retentionPinned":true}')]));
  assert.equal(JSON.parse(pinned).retentionPinned, true);
});
test('identity-only preparation proves an unchanged load; custom preparation still runs and rejects migration', async t => {
  const dataset = { capabilities: { independent: true }, datasetId: 'synthetic', datasetContractVersion: 1, digest: 'synthetic-digest' };
  const prepare = preserveGameIdentity(dataset), state = await prepare(initialState());
  assert.equal(prepare.isCurrent(state), true);
  assert.equal(prepare.isCurrent({ ...state, provenance: { dataset: { ...state.provenance.dataset, extra: true } } }), false);
  const dataDir = await directory(t), writer = await openStore({ dataDir, initialState: state, retention: false, prepareState: prepare });
  const checkpoint = await writer.freeze(); await writer.close();
  let calls = 0;
  const custom = preserveGameIdentity(dataset, state => { calls++; state.rules['access.shared'] = false; return state; });
  assert.equal(custom.isCurrent, undefined);
  await assert.rejects(openStore({ dataDir, readOnly: true, prepareState: custom, retention: false }), { code: 'LIVE_SWAP_MIGRATION_REQUIRED' });
  assert.equal(calls, 1);
  const reader = await openStore({ dataDir, readOnly: true, prepareState: prepare, retention: false });
  await reader.activate(checkpoint); assert.equal(reader.getState().revision, 0); await reader.close();
});

test('never-ACK sessions keep saving after eviction and cannot reapply after restart or renewal', async t => {
  const dataDir = await directory(t);
  let store = await openStore({ dataDir, initialState: initialState(), retention: false });
  t.after(() => store.close());
  let originalId;
  for (let index = 0; index < 40; index++) {
    const session = await store.openActionSession(randomUUID());
    const requestId = idFor(session);
    originalId ??= requestId;
    await store.command(command, index, { requestId, requestAck: 0 });
  }
  const checkpoint = await store.freeze(); await store.close();
  store = await openStore({ dataDir, expectedCheckpoint: checkpoint, liveSwapStrict: true, retention: false });
  await assert.rejects(store.command(command, 0, { requestId: originalId, requestAck: 0 }), { code: 'ACTION_SESSION_RETIRED', safeToRetry: false });
  const fresh = await store.openActionSession(randomUUID());
  await assert.rejects(store.command(command, 0, { requestId: idFor(fresh), requestAck: 0 }), { code: 'REVISION_CONFLICT' });
  assert.equal(store.getState().revision, 40);
  assert.equal(store.getState().history.length, 40);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'state.json'))).actionReceipts.slots.length, 32);
});
