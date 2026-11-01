import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createCompletionEncoder, decodeCompletionDocument } from '../app/storage/completion-codec.mjs';
import { createCompletionEncoder as browserEncoder, decodeCompletionDocument as browserDecode } from '../app/core/completion-codec.mjs';
import { applyCommand, createGroupState, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';

const world = { chunks: new Map([['100', { id: '100' }], ['200', { id: '200' }]]), neighbors: new Map(), walkable: new Set(['100', '200']), f2p: new Set(['100', '200']) };
const now = () => new Date('2026-10-25T12:00:00.000Z');
const complete = (index, completed = true, memberId = 'one') => ({ type: 'complete-task', memberId, taskId: `custom:${index}`, completed });
function seed() {
  const state = createGroupState([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  state.tasks = Array.from({ length: 32 }, (_, index) => ({ id: `custom:${index}`, label: `Task ${index}`, category: 'custom' }));
  return state;
}
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp('/tmp/completion-codec-test-');
  let store = await openStore({ dataDir, initialState: seed(), world, now, completionCodec: true, ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, get store() { return store; }, async reload(extra = {}) {
    await store.close();
    store = await openStore({ dataDir, world, now, completionCodec: true, ...options, ...extra });
    return store;
  } };
}

test('ordered splice documents round-trip add/remove/reorder/empty and preserve old leaves', () => {
  const arrays = [Array.from({ length: 40 }, (_, i) => `custom:${i}`)];
  arrays.push([...arrays[0], 'custom:40']);
  arrays.push(arrays[1].filter(id => id !== 'custom:12'));
  arrays.push([...arrays[2]].reverse(), [], ['custom:3']);
  const state = { history: arrays.slice(1).map((after, index) => ({ revision: index + 1, undo: { memberChanges: [{ id: 'one', changes: [
    { kind: 'value', path: ['completedTasks'], before: { exists: true, value: arrays[index] }, after: { exists: true, value: after } },
    { kind: 'value', path: ['selected'], before: { exists: true, value: [] }, after: { exists: true, value: ['100'] } },
  ] }] } })) };
  const document = { schemaVersion: 1, state }, before = structuredClone(document);
  const encoded = createCompletionEncoder()(document);
  assert.equal(encoded.schemaVersion, 2);
  assert.ok(encoded.completionArrays.entries.some(entry => entry.base !== undefined));
  assert.deepEqual(decodeCompletionDocument(encoded), before);
  assert.deepEqual(document, before);
  encoded.state.history[0].undo.memberChanges[0].changes[0].before = before.state.history[0].undo.memberChanges[0].changes[0].before;
  assert.deepEqual(decodeCompletionDocument(encoded), before, 'mixed old and compact leaves');
  assert.deepEqual(decodeCompletionDocument(before), before);
  assert.deepEqual(createCompletionEncoder()({ schemaVersion: 1, state: { history: [] } }), { schemaVersion: 1, state: { history: [] } });
});

test('compact expansion is bounded and oversized writes retain the readable legacy form', () => {
  const value = ['x'.repeat(1024 * 1024)], side = { exists: true, value };
  const patch = { kind: 'value', path: ['completedTasks'], before: side, after: side };
  const event = { undo: { memberChanges: [{ id: 'one', changes: [patch] }] } };
  const document = { schemaVersion: 1, state: { history: [event] } };
  const encoded = createCompletionEncoder()(document);
  encoded.state.history = Array(130).fill(encoded.state.history[0]);
  assert.throws(() => decodeCompletionDocument(encoded), /completion-array codec/);
  document.state.history = Array(130).fill(event);
  assert.equal(createCompletionEncoder()(document), document);
});

test('browser hashing and native hashing agree across UTF-8, escaping and SHA block boundaries', () => {
  for (const length of [0, 1, 40, 52, 53, 54, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 65536]) {
    const value = [`unicode:\u00e9\ud83c\udf32\ud800\\\"${'x'.repeat(length)}`];
    const document = { schemaVersion: 1, state: { history: [{ undo: { memberChanges: [{ id: 'one', changes: [
      { kind: 'value', path: ['completedTasks'], before: { exists: true, value: [] }, after: { exists: true, value } },
    ] }] } }] } };
    const native = createCompletionEncoder()(document), browser = browserEncoder()(document);
    assert.deepEqual(browser, native);
    assert.deepEqual(browserDecode(native), document);
    assert.deepEqual(decodeCompletionDocument(browser), document);
  }
});

test('real store preserves gameplay and complete History across commands, reload and selected Undo', async t => {
  const f = await fixture(t);
  let expected = seed();
  const commands = [complete(0), complete(1), complete(1), complete(0, false), complete(0),
    { type: 'set-task-status', memberId: 'one', taskId: 'custom:2', challengeCompleted: true },
    { type: 'set-note', memberId: 'two', chunkId: '100', note: 'Other player' },
    { type: 'undo', undoRevision: 6 }, { type: 'undo' },
    { type: 'set-rule', ruleId: 'access.shared', value: false }, { type: 'undo' },
    { type: 'delete-task', taskId: 'custom:1' }, { type: 'undo' }];
  for (const command of commands) {
    expected = applyCommand(expected, command, { world, now });
    await f.store.command(command, f.store.getInfo().revision);
    assert.deepEqual(f.store.getState(), expected);
    assert.deepEqual(f.store.getHistory().history, expected.history);
    assert.deepEqual(importBackup(await readFile(`${f.dataDir}/state.json`, 'utf8')), expected);
    await f.reload();
    assert.deepEqual(f.store.getState(), expected);
  }
  const before = f.store.getState();
  await assert.rejects(f.store.command({ type: 'undo', undoRevision: 1 }, before.revision), /later command|same saved value/i);
  assert.deepEqual(f.store.getState(), before);
  assert.deepEqual(importBackup(await f.store.backup()), expected);
  assert.equal((await f.store.backup()).schemaVersion, 1);
});

test('versioned writes are opt-in and legacy portable export provides rollback', async t => {
  const f = await fixture(t, { completionCodec: false });
  await f.store.command(complete(0), 0);
  const old = await readFile(`${f.dataDir}/state.json`, 'utf8');
  assert.equal(JSON.parse(old).schemaVersion, 1);
  await f.reload({ completionCodec: true });
  assert.equal(await readFile(`${f.dataDir}/state.json`, 'utf8'), old, 'opening does not migrate files');
  await f.store.command(complete(1), 1);
  const compact = JSON.parse(await readFile(`${f.dataDir}/state.json`, 'utf8'));
  assert.equal(compact.schemaVersion, 2);
  assert.deepEqual(importBackup(JSON.stringify(compact)), f.store.getState());
  const exported = exportBackup(f.store.getState());
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.completionArrays, undefined);
  await f.reload({ completionCodec: false });
  await f.store.command(complete(2), 2);
  assert.equal(JSON.parse(await readFile(`${f.dataDir}/state.json`, 'utf8')).schemaVersion, 1);
  for (const backup of await f.store.listBackups()) assert.equal((await f.store.readBackup(backup.id)).schemaVersion, 1);
  await f.store.replace(exported, 3);
  assert.deepEqual(f.store.getState().members, exported.state.members);
});

test('old snapshots, archive cuts, hydration and retained backups stay self-contained', async t => {
  const initial = seed();
  initial.provenance = {};
  let old = applyCommand(initial, complete(0), { world, now });
  old.history[0].undo = { members: initial.members };
  old = validateState(old);
  const f = await fixture(t, { initialState: old, retention: { backupDays: 1, historyEntries: 2 } });
  let expected = old;
  for (let i = 1; i < 12; i++) {
    expected = applyCommand(expected, complete(i), { world, now });
    await f.store.command(complete(i), i);
  }
  assert.ok(f.store.getInfo().retention.historyArchives > 0);
  assert.deepEqual((await f.store.backup()).state, expected);
  assert.equal((await f.store.queryHistory({ limit: 100 })).history.length, expected.history.length);
  await f.reload();
  await f.store.command({ type: 'undo' }, 12);
  expected = applyCommand(expected, { type: 'undo' }, { world, now });
  assert.deepEqual((await f.store.backup()).state, expected);
  for (const name of await readdir(`${f.dataDir}/history`)) {
    const archive = JSON.parse(gunzipSync(await readFile(`${f.dataDir}/history/${name}`)));
    assert.equal(archive.format, 'rs3-chunk-picker-history');
    for (const event of archive.events) for (const member of event.undo?.memberChanges ?? []) for (const patch of member.changes) {
      if (patch.path[0] === 'completedTasks') assert.ok(Array.isArray(patch.before.value));
    }
  }
  await f.store.prepareSnapshot();
  for (const backup of await f.store.listBackups()) assert.ok((await f.store.readBackup(backup.id)).state);
});

test('claims and pending-roll dependencies retain existing exact Undo semantics', async t => {
  const initial = seed(); initial.members[0].selected = ['100', '200'];
  const f = await fixture(t, { initialState: initial, random: () => 0 });
  let expected = initial;
  const commands = [{ type: 'claim-task', memberId: 'one', taskId: 'custom:0' }, complete(0),
    { type: 'undo' }, { type: 'roll', memberId: 'one', count: 2 },
    { type: 'set-note', memberId: 'two', chunkId: '100', note: 'Pending choice survives' }, { type: 'undo', undoRevision: 4 }];
  for (const command of commands) {
    expected = applyCommand(expected, command, { world, now, random: () => 0 });
    await f.store.command(command, f.store.getInfo().revision);
    assert.deepEqual(f.store.getState(), expected);
    await f.reload(); assert.deepEqual(f.store.getState(), expected);
  }
});

test('corrupt guards, forward references, unknown versions, duplicate IDs and stale History fail closed', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 25; i++) await f.store.command(complete(i), i);
  const document = JSON.parse(await readFile(`${f.dataDir}/state.json`, 'utf8'));
  const mutations = [
    copy => { copy.completionArrays.version = 99; },
    copy => { copy.completionArrays.extra = true; },
    copy => { copy.completionArrays.entries[0].sha256 = '0'.repeat(64); },
    copy => { copy.completionArrays.entries[0].value = ['custom:0', 'custom:0']; },
    copy => { copy.completionArrays.entries.find(entry => entry.base !== undefined).base = 10000; },
    copy => { copy.completionArrays.entries.find(entry => entry.base !== undefined).at = -1; },
    copy => { copy.completionArrays.entries.find(entry => entry.base !== undefined).remove = ['custom:missing']; },
    copy => { copy.completionArrays.entries.find(entry => entry.base !== undefined).length++; },
    copy => { copy.state.history[0].undo.memberChanges[0].changes[0].before.value.completionArray = 99999; },
    copy => { copy.state.history[0].undo.memberChanges[0].changes[0].before.exists = 1; },
    copy => { copy.schemaVersion = 1; }, copy => { delete copy.completionArrays; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(document); mutate(copy);
    assert.throws(() => importBackup(copy), /completion-array codec/);
  }
  const stale = decodeCompletionDocument(document); stale.state.members[0].completedTasks.pop();
  assert.throws(() => importBackup(stale), /Stale undo/);
  await f.store.close();
  const corrupt = structuredClone(document); mutations[2](corrupt);
  await writeFile(`${f.dataDir}/state.json`, JSON.stringify(corrupt));
  await assert.rejects(openStore({ dataDir: f.dataDir, world }), /Cannot load.*completion-array codec/);
  await writeFile(`${f.dataDir}/state.json`, JSON.stringify(document));
});

test('failed durable replacement and competing revisions preserve the last committed codec document', async t => {
  let fail = false;
  const f = await fixture(t, { beforeCommit: () => { if (fail) throw Error('Injected commit failure'); } });
  await f.store.command(complete(0), 0);
  const bytes = await readFile(`${f.dataDir}/state.json`, 'utf8'), state = f.store.getState();
  let broadcasts = 0; f.store.subscribe(() => broadcasts++); fail = true;
  await assert.rejects(f.store.command(complete(1), 1), /Injected commit failure/);
  assert.equal(await readFile(`${f.dataDir}/state.json`, 'utf8'), bytes);
  assert.deepEqual(f.store.getState(), state); assert.equal(broadcasts, 0);
  assert.ok((await readdir(f.dataDir)).every(name => !name.endsWith('.tmp')));
  fail = false; await f.reload();
  const outcomes = await Promise.allSettled([f.store.command(complete(1), 1), f.store.command(complete(2), 1)]);
  assert.deepEqual(outcomes.map(row => row.status), ['fulfilled', 'rejected']);
  assert.equal(outcomes[1].reason.code, 'REVISION_CONFLICT');
  assert.deepEqual(importBackup(await readFile(`${f.dataDir}/state.json`, 'utf8')), f.store.getState());
  for (const backup of await f.store.listBackups()) assert.ok(importBackup(gunzipSync(await readFile(`${f.dataDir}/backups/${backup.id}`)).toString()).revision >= 0);
  assert.deepEqual(importBackup(gunzipSync(gzipSync(JSON.stringify(await f.store.backup()))).toString()), f.store.getState());
});

test('a killed writer leaves the preceding versioned state readable and backed up', async t => {
  const f = await fixture(t);
  await f.store.command(complete(0), 0);
  const before = await readFile(`${f.dataDir}/state.json`, 'utf8');
  await f.store.close();
  const source = `import { openStore } from ${JSON.stringify(new URL('../app/storage/store.mjs', import.meta.url).href)};
    const store = await openStore({ dataDir: ${JSON.stringify(f.dataDir)}, completionCodec: true,
      beforeCommit: () => process.kill(process.pid, 'SIGKILL') });
    await store.command(${JSON.stringify(complete(1))}, 1);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 15000 });
  // Windows reports a self-SIGKILL as a non-zero exit status, not a signal.
  if (process.platform === 'win32') assert.ok(child.status !== 0 && child.status !== null, `writer must die before committing (status ${child.status})`);
  else assert.equal(child.signal, 'SIGKILL');
  assert.equal(await readFile(`${f.dataDir}/state.json`, 'utf8'), before);
  await f.reload();
  assert.deepEqual(f.store.getState(), importBackup(before));
  for (const backup of await f.store.listBackups()) assert.equal((await f.store.readBackup(backup.id)).state.revision, backup.revision);
  await f.store.command(complete(1), 1);
  assert.equal(f.store.getState().revision, 2);
});

test('static dependencies and expired retained archive packs load with either write switch', async t => {
  const initialState = seed(); initialState.legacy = { evidence: 'Synthetic sidecar. '.repeat(20000) };
  let day = 0;
  const f = await fixture(t, { initialState, retention: { backupDays: 1 }, now: () => new Date(Date.UTC(2026, 9, 25 + day)) });
  for (let i = 0; i < 5; i++) await f.store.command(complete(i), i);
  const disk = JSON.parse(await readFile(`${f.dataDir}/state.json`, 'utf8'));
  assert.equal(disk.schemaVersion, 2); assert.ok(disk.storage.fields.legacy);
  const expected = await f.store.backup();
  day = 3;
  await f.store.prepareSnapshot();
  const packs = await readdir(`${f.dataDir}/backups/archives`);
  assert.ok(packs.length > 0);
  const pack = JSON.parse(gunzipSync(await readFile(`${f.dataDir}/backups/archives/${packs[0]}`)));
  assert.ok(pack.snapshots.some(row => row.document.schemaVersion === 2));
  await f.reload({ completionCodec: false });
  assert.deepEqual(await f.store.backup(), expected);
  for (const backup of await f.store.listBackups()) {
    const document = await f.store.readBackup(backup.id);
    assert.equal(document.schemaVersion, 1);
    assert.equal(document.state.revision, backup.revision);
  }
});
