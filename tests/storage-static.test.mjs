import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState, importBackup } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';

const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const large = kind => `${kind}:${'Preserved synthetic evidence. '.repeat(11000)}`;
function initialState(allFields = false) {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }]);
  state.legacy = { evidence: large('legacy') };
  if (allFields) {
    const id = 'rs3:task:synthetic-static-goal';
    state.tasks = [{ id, category: 'custom', label: large('catalogue') }];
    state.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, kind: 'task', label: large('identity'), aliases: [] } }, aliases: {}, unresolved: [] };
    state.provenance = { evidence: large('provenance') };
  }
  return state;
}
async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rs3-storage-static-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function diskDocument(dir) { return JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')); }

test('large static fields are durable once, ordinary writes stay compact, and all exports remain portable after restart', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState: initialState(true), world });
  t.after(() => store.close());
  const before = await store.backup();
  const first = await diskDocument(dataDir);
  assert.equal(first.storage.schemaVersion, 1);
  assert.deepEqual(Object.keys(first.storage.fields).sort(), ['identityRegistry', 'legacy', 'provenance', 'tasks']);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 8192);
  for (const [key, reference] of Object.entries(first.storage.fields)) {
    assert.equal(Object.hasOwn(first.state, key), false);
    assert.equal(reference.id, `static-${reference.sha256}.json.gz`);
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'static', reference.id)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256);
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), before.state[key]);
  }
  const files = await readdir(path.join(dataDir, 'static'));
  const result = await store.commandSerialized(command, 0);
  assert.deepEqual(JSON.parse(result.stateJSON), store.getState());
  assert.deepEqual((await diskDocument(dataDir)).storage, first.storage);
  assert.deepEqual(await readdir(path.join(dataDir, 'static')), files);
  const retained = (await store.listBackups())[0];
  const retainedBytes = gunzipSync(await readFile(path.join(dataDir, 'backups', retained.id)));
  assert.ok(retainedBytes.length < 8192);
  assert.deepEqual(await store.readBackup(retained.id), before);
  const portable = await store.backup();
  assert.equal(portable.storage, undefined);
  assert.deepEqual(importBackup(JSON.stringify(portable)), portable.state);
  await store.close();
  const reopened = await openStore({ dataDir, world });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.backup(), portable);
  assert.deepEqual(await reopened.readBackup(retained.id), before);
  assert.deepEqual(await readdir(path.join(dataDir, 'static')), files);
  const restoreDir = await directory(t);
  const restored = await openStore({ dataDir: restoreDir });
  t.after(() => restored.close());
  await restored.replace(portable, 0);
  assert.deepEqual(restored.getState().legacy, portable.state.legacy);
  assert.deepEqual(restored.getState().identityRegistry, portable.state.identityRegistry);
  assert.deepEqual(restored.getState().tasks, portable.state.tasks);
  assert.deepEqual(importBackup(JSON.stringify(await restored.backup())), restored.getState());
});

test('an interrupted static-state commit keeps the old compact state and reusable backup cache', async t => {
  const dataDir = await directory(t);
  let fail = true;
  const store = await openStore({ dataDir, initialState: initialState(), beforeCommit: () => { if (fail) throw new Error('Interrupted sidecar commit'); } });
  t.after(() => store.close());
  const before = await store.backup();
  const bytes = await readFile(path.join(dataDir, 'state.json'));
  await assert.rejects(() => store.command(command, 0), /Interrupted sidecar/);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), bytes);
  assert.deepEqual(await store.backup(), before);
  fail = false;
  await store.command(command, 0);
  const snapshots = await store.listBackups();
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) assert.deepEqual(await store.readBackup(snapshot.id), before);
});

test('opt-in command deltas omit only unchanged sidecar trees and retain their acknowledged baseline and lazy snapshot', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState: initialState(true), world });
  t.after(() => store.close());
  const baseline = store.getState();
  const first = await store.commandSerialized(command, 0, { omitUnchanged: true });
  assert.equal(first.baseRevision, 0);
  assert.deepEqual(first.unchangedFields.sort(), ['identityRegistry', 'legacy', 'provenance', 'tasks']);
  assert.ok(Buffer.byteLength(first.stateJSON) < 8192);
  const partial = JSON.parse(first.stateJSON);
  for (const key of first.unchangedFields) assert.equal(Object.hasOwn(partial, key), false);
  const hydrated = { ...partial, ...Object.fromEntries(first.unchangedFields.map(key => [key, baseline[key]])) };
  assert.deepEqual(hydrated, store.getState());
  const task = { id: 'rs3:task:synthetic-new-delta-goal', category: 'custom', label: 'New goal' };
  const changed = await store.commandSerialized({ type: 'add-task', task }, 1, { omitUnchanged: true });
  assert.equal(changed.baseRevision, 1);
  assert.deepEqual(changed.unchangedFields.sort(), ['identityRegistry', 'legacy', 'provenance']);
  const acknowledged = store.getState();
  // Undo crosses full validation into new trees, so it must send a full state.
  const undone = await store.commandSerialized({ type: 'undo' }, 2, { omitUnchanged: true });
  assert.equal(undone.baseRevision, undefined);
  assert.equal(undone.unchangedFields, undefined);
  assert.deepEqual(JSON.parse(undone.stateJSON), store.getState());
  changed.stateJSONParts[0] = 'External array mutation';
  const changedPartial = JSON.parse(changed.stateJSON);
  assert.deepEqual(changedPartial.tasks, acknowledged.tasks);
  assert.equal(changedPartial.revision, 2);
  assert.equal(first.baseRevision, 0);
  assert.equal(JSON.parse(first.stateJSON).revision, 1);
  assert.deepEqual(importBackup(JSON.stringify(await store.backup())), store.getState());
});

test('caller command hooks force the opt-in delta path to retain fully validated static fields', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState: initialState(true), world,
    prepareState: state => { state.legacy.hookObserved = true; return state; },
  });
  t.after(() => store.close());
  const result = await store.commandSerialized(command, 0, { omitUnchanged: true });
  assert.equal(result.baseRevision, undefined);
  assert.equal(result.unchangedFields, undefined);
  assert.deepEqual(JSON.parse(result.stateJSON), store.getState());
});

test('queued delta responses anchor omitted fields to each accepted expected revision', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState: initialState(), world });
  t.after(() => store.close());
  const [first, second] = await Promise.all([
    store.commandSerialized(command, 0, { omitUnchanged: true }),
    store.commandSerialized({ ...command, value: true }, 1, { omitUnchanged: true }),
  ]);
  assert.equal(first.baseRevision, 0);
  assert.equal(second.baseRevision, 1);
  assert.equal(JSON.parse(first.stateJSON).revision, 1);
  assert.equal(JSON.parse(first.stateJSON).rules['access.shared'], false);
  assert.equal(JSON.parse(second.stateJSON).revision, 2);
  assert.equal(JSON.parse(second.stateJSON).rules['access.shared'], true);
  assert.deepEqual(first.unchangedFields, ['legacy']);
  assert.deepEqual(second.unchangedFields, ['legacy']);
});

test('a compaction command keeps unchanged static trees shared and preserves portable history and archived undo after restart', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState: initialState(true), world, retention: { historyEntries: 2 } });
  t.after(() => store.close());
  const before = await store.backup();
  const initialReferences = (await diskDocument(dataDir)).storage.fields;
  for (let revision = 0; revision < 4; revision++) await store.command({ ...command, value: Boolean(revision % 2) }, revision);
  assert.equal(store.getInfo().retention.historyArchives, 0);
  const compacted = await store.commandSerialized(command, 4, { omitUnchanged: true });
  assert.equal(compacted.baseRevision, 4);
  assert.deepEqual(compacted.unchangedFields.sort(), ['identityRegistry', 'legacy', 'tasks']);
  assert.equal(store.getInfo().retention.historyArchives, 1);
  assert.equal(store.getInfo().retention.activeHistoryEntries, 2);
  const references = (await diskDocument(dataDir)).storage.fields;
  for (const key of ['tasks', 'identityRegistry', 'legacy']) assert.deepEqual(references[key], initialReferences[key]);
  assert.notEqual(references.provenance.id, initialReferences.provenance.id);
  const portable = await store.backup();
  assert.deepEqual(portable.state.history.map(event => event.revision), [1, 2, 3, 4, 5]);
  assert.equal(portable.state.provenance.historyArchive, undefined);
  assert.deepEqual(importBackup(JSON.stringify(portable)), portable.state);
  const preserved = (await store.listBackups()).find(item => item.revision === 4);
  assert.equal((await store.readBackup(preserved.id)).state.history.length, 4);
  await store.close();
  const reopened = await openStore({ dataDir, world, retention: { historyEntries: 2 } });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.backup(), portable);
  for (let count = 0; count < 5; count++) await reopened.command({ type: 'undo' }, reopened.getState().revision);
  assert.deepEqual(reopened.getState().rules, before.state.rules);
  assert.deepEqual(reopened.getState().members, before.state.members);
  await assert.rejects(() => reopened.command({ type: 'undo' }, reopened.getState().revision), /No reversible command/);
  assert.deepEqual(importBackup(JSON.stringify(await reopened.backup())), (await reopened.backup()).state);
});

for (const corruption of ['missing', 'checksum', 'reference', 'missing-hash', 'version', 'duplicate']) {
  test(`static ${corruption} corruption fails closed without replacing state or retained snapshots`, async t => {
    const dataDir = await directory(t);
    const store = await openStore({ dataDir, initialState: initialState() });
    await store.command(command, 0);
    const snapshot = (await store.listBackups())[0];
    const originalBackup = await readFile(path.join(dataDir, 'backups', snapshot.id));
    await store.close();
    const document = await diskDocument(dataDir);
    const reference = document.storage.fields.legacy;
    if (corruption === 'missing') await unlink(path.join(dataDir, 'static', reference.id));
    else if (corruption === 'checksum') await writeFile(path.join(dataDir, 'static', reference.id), gzipSync(JSON.stringify({ evidence: 'Changed bytes' })));
    else if (corruption === 'reference') reference.sha256 = '0'.repeat(64);
    else if (corruption === 'missing-hash') delete reference.sha256;
    else if (corruption === 'version') document.storage.schemaVersion = 2;
    else document.state.legacy = { conflicting: true };
    if (!['missing', 'checksum'].includes(corruption)) await writeFile(path.join(dataDir, 'state.json'), JSON.stringify(document));
    const corruptedState = await readFile(path.join(dataDir, 'state.json'));
    if (['missing', 'checksum'].includes(corruption)) await assert.rejects(() => store.readBackup(snapshot.id), /static|Static/);
    await assert.rejects(() => openStore({ dataDir }), /Cannot load the saved state:.*(?:static|Static)/);
    assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), corruptedState);
    assert.deepEqual(await readFile(path.join(dataDir, 'backups', snapshot.id)), originalBackup);
    assert.ok(!(await readdir(dataDir)).includes('store.lock'));
  });
}

test('retention packs compact snapshots only after verifying their static dependencies and preserves full historical exports', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir, initialState: initialState(), retention: false, now: () => '2026-01-01T00:00:00.000Z' });
  for (let revision = 0; revision < 4; revision++) await store.command({ ...command, value: Boolean(revision % 2) }, revision);
  const snapshots = await store.listBackups();
  await store.close();
  const resumed = await openStore({ dataDir, retention: { backupDays: 1 }, now: () => '2026-10-07T00:00:00.000Z' });
  t.after(() => resumed.close());
  assert.equal(resumed.getInfo().retention.failure, undefined);
  assert.equal((await resumed.listBackups()).length, 4);
  const packs = await readdir(path.join(dataDir, 'backups', 'archives'));
  assert.ok(packs.length > 0);
  for (const id of packs) {
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'backups', 'archives', id)));
    assert.ok(bytes.length < 16384);
  }
  for (const snapshot of snapshots) {
    const backup = await resumed.readBackup(snapshot.id);
    assert.equal(backup.state.revision, snapshot.revision);
    assert.deepEqual(backup.state.legacy, initialState().legacy);
    assert.deepEqual(importBackup(JSON.stringify(backup)), backup.state);
  }
});

test('a changed migration writes a new static dependency, pins the original snapshot and is idempotent on restart', async t => {
  const dataDir = await directory(t);
  const original = await openStore({ dataDir, initialState: initialState() });
  const before = await original.backup();
  const oldReference = (await diskDocument(dataDir)).storage.fields.legacy;
  await original.close();
  const migrateState = state => { state.legacy.migrated = true; return state; };
  const migrated = await openStore({ dataDir, migrateState });
  assert.equal(migrated.getState().revision, 1);
  const newReference = (await diskDocument(dataDir)).storage.fields.legacy;
  assert.notEqual(newReference.id, oldReference.id);
  const retained = (await migrated.listBackups())[0];
  const raw = JSON.parse(gunzipSync(await readFile(path.join(dataDir, 'backups', retained.id))).toString('utf8'));
  assert.equal(raw.retentionPinned, true);
  assert.deepEqual(raw.storage.fields.legacy, oldReference);
  assert.deepEqual(await migrated.readBackup(retained.id), before);
  await migrated.close();
  const reopened = await openStore({ dataDir, migrateState });
  t.after(() => reopened.close());
  assert.equal(reopened.getState().revision, 1);
  assert.equal((await reopened.listBackups()).length, 1);
  assert.deepEqual((await diskDocument(dataDir)).storage.fields.legacy, newReference);
});

test('retention leaves old standalone snapshots intact when their static dependency is missing', async t => {
  const dataDir = await directory(t);
  const original = await openStore({ dataDir, initialState: initialState(), retention: false, now: () => '2026-01-01T00:00:00.000Z' });
  const reference = (await diskDocument(dataDir)).storage.fields.legacy;
  const staticBytes = await readFile(path.join(dataDir, 'static', reference.id));
  for (let revision = 0; revision < 4; revision++) await original.command({ ...command, value: Boolean(revision % 2) }, revision);
  const old = (await original.listBackups()).find(item => item.revision === 1);
  const oldBytes = await readFile(path.join(dataDir, 'backups', old.id));
  const replacement = initialState();
  replacement.legacy.evidence += ' A new replacement.';
  await original.replace(replacement, 4);
  await original.close();
  await unlink(path.join(dataDir, 'static', reference.id));
  const resumed = await openStore({ dataDir, retention: { backupDays: 1 }, now: () => '2026-10-07T00:00:00.000Z' });
  t.after(() => resumed.close());
  assert.match(resumed.getInfo().retention.failure, /Missing static field dependency/);
  assert.deepEqual(await readFile(path.join(dataDir, 'backups', old.id)), oldBytes);
  await writeFile(path.join(dataDir, 'static', reference.id), staticBytes);
  assert.deepEqual((await resumed.readBackup(old.id)).state.legacy, initialState().legacy);
});

test('hydrated archive exports and rejected Undo hooks cannot mutate current state or retained history', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  let hookInput, migrationInput, rejectUndo = false;
  const migrateState = input => { migrationInput = input; return input; };
  const prepareState = (input, { operation }) => {
    hookInput = input;
    if (rejectUndo && operation === 'command') {
      input.legacy.evidence = 'Rejected hook mutation';
      input.history[0].at = '2000-01-01T00:00:00.000Z';
      throw new Error('Rejected hydrated Undo');
    }
    return input;
  };
  const options = { dataDir, world, retention: { historyEntries: 2 }, migrateState, prepareState };
  const store = await openStore({ ...options, initialState: initialState(true) });
  t.after(() => store.close());
  const initial = store.getState();
  for (let revision = 0; revision < 5; revision++) await store.command({ ...command, value: Boolean(revision % 2) }, revision);
  assert.ok(store.getInfo().retention.historyArchives > 0);
  const baseline = store.getState(), expectedPortable = await store.backup();
  const retained = (await store.listBackups()).find(item => item.revision === 4);
  assert.ok(retained);
  const expectedRetained = await store.readBackup(retained.id);
  const detached = await store.backup();
  detached.state.legacy.evidence = 'Export mutation';
  detached.state.members[0].name = 'Export name';
  detached.state.history[0].at = '2000-01-01T00:00:00.000Z';
  assert.deepEqual(store.getState(), baseline);
  assert.deepEqual(await store.backup(), expectedPortable);
  assert.deepEqual(await store.readBackup(retained.id), expectedRetained);
  await store.close();
  const reopened = await openStore(options);
  t.after(() => reopened.close());
  migrationInput.legacy.evidence = 'Retained migration input mutation';
  hookInput.members[0].name = 'Retained hook name';
  hookInput.history[0].at = '2000-01-01T00:00:00.000Z';
  assert.deepEqual(reopened.getState(), baseline);
  assert.deepEqual(await reopened.backup(), expectedPortable);
  const diskBeforeRejectedUndo = await readFile(path.join(dataDir, 'state.json'));
  rejectUndo = true;
  await assert.rejects(() => reopened.command({ type: 'undo' }, baseline.revision), /Rejected hydrated Undo/);
  rejectUndo = false;
  assert.deepEqual(reopened.getState(), baseline);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), diskBeforeRejectedUndo);
  assert.deepEqual(await reopened.backup(), expectedPortable);
  assert.deepEqual(await reopened.readBackup(retained.id), expectedRetained);
  for (let count = 0; count < 5; count++) await reopened.command({ type: 'undo' }, reopened.getState().revision);
  assert.deepEqual(reopened.getState().rules, initial.rules);
  assert.deepEqual(reopened.getState().members, initial.members);
  assert.deepEqual(reopened.getState().legacy, initial.legacy);
  assert.deepEqual(importBackup(JSON.stringify(await reopened.backup())), (await reopened.backup()).state);
  await assert.rejects(() => reopened.command({ type: 'undo' }, reopened.getState().revision), /No reversible command/);
});

test('history hydration retains JSON number normalization without mutating owned loaded evidence', async t => {
  const dataDir = await directory(t), seed = initialState();
  seed.legacy.negativeZero = 0;
  const store = await openStore({ dataDir, initialState: seed, retention: { historyEntries: 2 } });
  t.after(() => store.close());
  for (let revision = 0; revision < 5; revision++) await store.command({ ...command, value: Boolean(revision % 2) }, revision);
  assert.ok(store.getInfo().retention.historyArchives > 0);
  await store.close();
  const document = await diskDocument(dataDir), oldReference = document.storage.fields.legacy;
  const text = gunzipSync(await readFile(path.join(dataDir, 'static', oldReference.id))).toString('utf8');
  assert.ok(text.includes('"negativeZero":0'));
  const bytes = Buffer.from(text.replace('"negativeZero":0', '"negativeZero":-0'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  document.storage.fields.legacy = { id: `static-${sha256}.json.gz`, sha256 };
  await writeFile(path.join(dataDir, 'static', document.storage.fields.legacy.id), gzipSync(bytes));
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify(document));
  const reopened = await openStore({ dataDir, retention: { historyEntries: 2 } });
  t.after(() => reopened.close());
  assert.ok(Object.is(reopened.getState().legacy.negativeZero, -0));
  const portable = await reopened.backup();
  assert.equal(portable.state.legacy.negativeZero, 0);
  assert.equal(Object.is(portable.state.legacy.negativeZero, -0), false);
  assert.ok(Object.is(reopened.getState().legacy.negativeZero, -0));
  assert.deepEqual(importBackup(JSON.stringify(portable)), portable.state);
});
