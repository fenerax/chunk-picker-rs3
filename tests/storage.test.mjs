import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { openStore as openApplicationStore } from '../app/storage/store.mjs';
import { createGroupState, exportBackup, importBackup } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { evaluateRollPool } from '../app/core/rules.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';

// Storage scenarios declare actors explicitly so provider defaults do not affect persistence.
const openStore = options => openApplicationStore({ initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]), ...options });

const command = { type: 'set-rule', ruleId: 'access.shared', value: false };

test('releasing task caches preserves committed state and captured in-flight snapshots', async t => {
  const dataDir = await directory(t), store = await openStore({ dataDir });
  t.after(() => store.close());
  const state = store.getState(), captured = store.getCalculationSnapshot(), key = captured.taskInputKey;
  assert.equal(key, taskReuseInputKey(state));
  const bytes = Buffer.from(captured.stateJSON).toString('utf8');
  store.releaseTaskCaches();
  const rebuilt = store.getCalculationSnapshot();
  assert.notEqual(rebuilt, captured); assert.equal(rebuilt.taskInputKey, key);
  assert.equal(Buffer.from(rebuilt.stateJSON).toString('utf8'), bytes);
  await store.command(command, 0);
  assert.equal(Buffer.from(captured.stateJSON).toString('utf8'), bytes);
  assert.notEqual(store.getCalculationSnapshot().taskInputKey, key);
  assert.equal(store.getState().revision, 1);
  assert.equal((await store.backup()).state.rules['access.shared'], false);
});
async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rs3-duo-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('writes serialize and two clients cannot save the same expected revision', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir });
  t.after(() => store.close());
  assert.equal(store.getState().revision, 0);
  assert.deepEqual(store.getState().members.map(({ id, name, sourceMapId }) => ({ id, name, sourceMapId })), [
    { id: 'actor1', name: 'Player', sourceMapId: null }, { id: 'reed', name: 'Reed', sourceMapId: null },
  ]);
  assert.deepEqual(store.getState().members.map(member => member.unlocked), [[], []]);
  const results = await Promise.allSettled([store.command(command, 0), store.command(command, 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected').reason;
  assert.equal(failure.code, 'REVISION_CONFLICT');
  assert.equal(failure.state.revision, 1);
  assert.equal(store.getState().revision, 1);
  const copy = store.getState();
  copy.members[0].unlocked.push('101');
  assert.deepEqual(store.getState().members[0].unlocked, []);
  assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).revision, 1);
  const backups = await readdir(path.join(dataDir, 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /\.json\.gz$/);
  assert.equal((await store.readBackup(backups[0])).state.revision, 0);
});

test('state and private invite token persist across restart with a released exclusive lock', async t => {
  const dataDir = await directory(t);
  const first = await openStore({ dataDir });
  const token = first.getAccessToken();
  await assert.rejects(() => openStore({ dataDir }), /already holds/);
  await first.command(command, 0);
  await first.close();
  const second = await openStore({ dataDir });
  t.after(() => second.close());
  assert.equal(second.getAccessToken(), token);
  assert.equal(second.getState().revision, 1);
  assert.equal(second.getState().rules['access.shared'], false);
});

test('failed persistence keeps the old state, does not broadcast, cleans temp files and recovers on restart', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir, beforeCommit: () => { throw new Error('Injected pre-rename failure'); } });
  let notifications = 0;
  store.subscribe(() => notifications++);
  await assert.rejects(() => store.command(command, 0), /Injected/);
  assert.equal(store.getState().revision, 0);
  assert.equal(notifications, 0);
  assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).revision, 0);
  assert.ok((await readdir(dataDir)).every(name => !name.endsWith('.tmp')));
  const retained = await store.listBackups();
  assert.equal(retained.length, 1);
  assert.equal((await store.readBackup(retained[0].id)).state.revision, 0);
  await store.close();
  const recovered = await openStore({ dataDir });
  t.after(() => recovered.close());
  assert.equal(recovered.getState().revision, 0);
  await recovered.command(command, 0);
  assert.equal(recovered.getState().revision, 1);
  assert.equal((await recovered.listBackups()).length, 2, 'A failed save must not delete its preserved snapshot.');
});

test('cached prior-state backups advance only after a successful commit and restore snapshots stay pinned', async t => {
  const dataDir = await directory(t);
  let fail = false;
  const store = await openStore({ dataDir, beforeCommit: () => { if (fail) throw new Error('Interrupted cached-state commit'); } });
  t.after(() => store.close());
  await store.command(command, 0);
  const previous = await store.backup();
  fail = true;
  await assert.rejects(() => store.command({ ...command, value: true }, 1), /Interrupted cached-state/);
  fail = false;
  await store.command({ ...command, value: true }, 1);
  const copies = (await store.listBackups()).filter(item => item.revision === 1);
  assert.equal(copies.length, 2);
  for (const copy of copies) assert.deepEqual(await store.readBackup(copy.id), previous);
  const beforeRestore = await store.backup();
  const restored = await store.replace(previous, 2);
  const pinned = (await store.listBackups()).find(item => item.revision === 2);
  const document = JSON.parse(gunzipSync(await readFile(path.join(dataDir, 'backups', pinned.id))).toString('utf8'));
  assert.equal(document.retentionPinned, true);
  assert.deepEqual(document.state, beforeRestore.state);
  await store.command(command, 3);
  const restoredSnapshot = (await store.listBackups()).find(item => item.revision === 3);
  assert.deepEqual((await store.readBackup(restoredSnapshot.id)).state, restored);
});

test('serialized command responses and cached fingerprints preserve state, pools and conservative gameplay inputs', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] });
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }]);
  initialState.legacy = { preserved: { evidence: 'Keep original evidence' } };
  initialState.provenance = { evidence: { source: 'Synthetic fixture' } };
  const store = await openStore({ dataDir, initialState, world });
  t.after(() => store.close());
  const independentlyFingerprint = createGameplayFingerprint();
  const expectedFingerprint = () => independentlyFingerprint(store.getState());
  const originalFingerprint = store.getGameplayFingerprint();
  assert.equal(originalFingerprint, expectedFingerprint());
  const response = await store.commandSerialized({ type: 'set-preference', memberId: 'actor1', preferenceId: 'ids', value: true }, 0);
  const saved = store.getState();
  assert.equal(response.revision, 1);
  assert.equal(response.stateJSON, JSON.stringify(saved));
  assert.equal(response.stateJSONParts.join(''), response.stateJSON);
  assert.equal(store.getStateJSONParts().join(''), response.stateJSON);
  const parts = store.getStateJSONParts();
  parts[0] = 'External mutation';
  assert.equal(store.getStateJSONParts().join(''), response.stateJSON);
  assert.deepEqual(response.pools.actor1, evaluateRollPool(world, saved, 'actor1'));
  response.pools.actor1.eligible.push({ id: 'External mutation' });
  assert.deepEqual(store.getState(), saved);
  assert.equal(store.getGameplayFingerprint(), originalFingerprint);
  assert.equal(store.getGameplayFingerprint(), expectedFingerprint());
  const deferred = await store.commandSerialized(command, 1);
  const secondState = store.getState();
  assert.notEqual(store.getGameplayFingerprint(), originalFingerprint);
  assert.equal(store.getGameplayFingerprint(), expectedFingerprint());
  await store.commandSerialized({ type: 'undo' }, 2);
  deferred.stateJSONParts[0] = 'External array mutation';
  assert.deepEqual(JSON.parse(deferred.stateJSON), secondState, 'Lazy results retain their own acknowledged revision');
  assert.equal(store.getGameplayFingerprint(), originalFingerprint);
  assert.equal(store.getGameplayFingerprint(), expectedFingerprint());
  const durable = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  assert.equal(durable, `${JSON.stringify(await store.backup())}\n`);
});

test('retained snapshots support compressed and previous plain JSON without exposing paths or accepting traversal', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir });
  t.after(() => store.close());
  const original = await store.backup();
  const oldId = '0000000000000000-0123456789abcdef.json';
  await writeFile(path.join(dataDir, 'backups', oldId), JSON.stringify(original));
  await writeFile(path.join(dataDir, 'backups', 'unrelated.json'), '{}');
  await store.command(command, 0);
  const backups = await store.listBackups();
  assert.equal(backups.length, 2);
  assert.ok(backups.every(item => Object.keys(item).sort().join(',') === 'at,bytes,event,id,revision'));
  assert.ok(backups.every(item => item.event === null));
  assert.ok(backups.every(item => item.revision === 0 && item.bytes > 0 && Number.isFinite(Date.parse(item.at))));
  assert.deepEqual(await store.readBackup(oldId), original);
  assert.deepEqual(await store.readBackup(backups.find(item => item.id.endsWith('.gz')).id), original);
  for (const id of ['../state.json', '/state.json', '..\\state.json', 'access-token', `${oldId}/extra`, 'unrelated.json']) {
    await assert.rejects(() => store.readBackup(id), /Invalid retained backup ID/);
  }
  await assert.rejects(() => store.readBackup('0000000000000000-aaaaaaaaaaaaaaaa.json.gz'), error => error.code === 'ENOENT' && !error.message.includes(dataDir));
  assert.equal((await readdir(path.join(dataDir, 'backups'))).length, 3);
  assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).revision, 1);
});

test('replacement rebases the live revision and preserves incoming history and provenance as evidence', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir });
  t.after(() => store.close());
  await store.command(command, 0);
  const incoming = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  incoming.revision = 99;
  incoming.history = [{ id: 'revision-98', revision: 98, type: 'roll', at: '2026-10-07T00:00:00.000Z' }];
  incoming.provenance = { ...incoming.provenance, arbitrary: { notes: 'Retain imported evidence' } };
  incoming.members[0].unlocked = ['12341'];
  const changed = await store.replace(exportBackup(incoming), 1);
  assert.equal(changed.revision, 2);
  assert.deepEqual(changed.history.map(event => event.id), ['revision-2']);
  assert.equal(changed.history[0].type, 'restore');
  assert.deepEqual(changed.provenance.restore.previousHistory.map(event => event.id), ['revision-1']);
  assert.equal(changed.provenance.restore.incomingRevision, 99);
  assert.deepEqual(changed.provenance.restore.incomingHistory, incoming.history);
  assert.deepEqual(changed.provenance.restore.incomingProvenance, incoming.provenance);
  assert.deepEqual(changed.members[0].unlocked, ['12341']);
  assert.deepEqual(importBackup(await store.backup()), changed);
  const next = await store.command(command, 2);
  assert.equal(next.history.at(-1).id, 'revision-3');
});

test('invalid or stale replacement never destroys current saved state', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir });
  t.after(() => store.close());
  const originalBytes = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  const invalid = store.getState();
  invalid.members[0].unlocked = ['0'];
  await assert.rejects(() => store.replace(invalid, 0), /base chunk ID/);
  await assert.rejects(async () => store.replace(await store.backup(), 1), /Revision conflict/);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), originalBytes);
  assert.deepEqual(await readdir(path.join(dataDir, 'backups')), []);
});

test('a dead-process lock is recoverable, but malformed saved data is never silently replaced', async t => {
  const dataDir = await directory(t);
  await writeFile(path.join(dataDir, 'store.lock'), JSON.stringify({ pid: 2147483647, nonce: 'old' }));
  const store = await openStore({ dataDir });
  await store.close();
  await writeFile(path.join(dataDir, 'state.json'), '{broken');
  await assert.rejects(() => openStore({ dataDir }), /Cannot load/);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), '{broken');
  assert.ok(!(await readdir(dataDir)).includes('store.lock'));
});

test('catalogue preparation is awaited before initial and changed state reaches disk', async t => {
  const dataDir = await directory(t);
  const operations = [];
  const store = await openStore({ dataDir, prepareState: async (state, context) => {
    operations.push(context.operation);
    state.tasks = [{ id: 'quest:example', label: 'Example', category: 'quest' }];
    return state;
  } });
  t.after(() => store.close());
  assert.equal(store.getState().tasks[0].id, 'quest:example');
  await store.command({ type: 'complete-task', memberId: 'actor1', taskId: 'quest:example', completed: true }, 0);
  assert.deepEqual(operations, ['initialize', 'command']);
  assert.deepEqual(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).members[0].completedTasks, ['quest:example']);
});

test('first-party migration runs at initialization and replacement without repeating on a prepared command', async t => {
  const dataDir = await directory(t);
  const operations = [];
  const store = await openStore({ dataDir, migrateState: (state, context) => { operations.push(context.operation); return state; } });
  t.after(() => store.close());
  await store.command(command, 0);
  assert.deepEqual(operations, ['initialize']);
  await store.replace(await store.backup(), 1);
  assert.deepEqual(operations, ['initialize', 'replace']);
});

test('a first-party current-state predicate avoids repeated migration and keeps restart revision stable', async t => {
  const dataDir = await directory(t);
  const migrateState = () => { throw new Error('Already-current state must not be migrated'); };
  migrateState.isCurrent = state => state.members[0].id === 'actor1';
  const first = await openStore({ dataDir, migrateState });
  await first.command(command, 0);
  const saved = first.getState();
  await first.close();
  const reopened = await openStore({ dataDir, migrateState });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getState(), saved);
  assert.equal((await reopened.listBackups()).length, 1);
});

test('caller preparation hooks invalidate cached evidence bytes and cannot retain private trees', async t => {
  const dataDir = await directory(t);
  let retained;
  const store = await openStore({ dataDir, prepareState: (state, context) => {
    state.legacy ??= { evidence: { commands: 0 } };
    if (context.operation === 'command') state.legacy.evidence.commands++;
    retained = state;
    return state;
  } });
  t.after(() => store.close());
  const originalFingerprint = store.getGameplayFingerprint();
  await store.command(command, 0);
  const saved = store.getState();
  assert.equal(saved.legacy.evidence.commands, 1);
  assert.notEqual(store.getGameplayFingerprint(), originalFingerprint);
  retained.legacy.evidence.commands = 99;
  assert.equal(store.getState().legacy.evidence.commands, 1);
  await store.command(command, 1);
  assert.equal(store.getState().legacy.evidence.commands, 2);
  const previous = (await store.listBackups()).find(item => item.revision === 1);
  assert.deepEqual((await store.readBackup(previous.id)).state, saved);
  assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).legacy.evidence.commands, 2);
});

test('changed catalogue preparation on restart commits a backed-up refresh revision and is idempotent', async t => {
  const dataDir = await directory(t);
  const original = await openStore({ dataDir });
  await original.command(command, 0);
  await original.close();
  const prepareState = async state => {
    state.tasks = [{ id: 'quest:example', label: 'Example', category: 'quest' }];
    return state;
  };
  const refreshed = await openStore({ dataDir, prepareState });
  assert.equal(refreshed.getState().revision, 2);
  assert.deepEqual(refreshed.getState().history.map(event => [event.id, event.type]), [['revision-1', 'set-rule'], ['revision-2', 'catalogue-refresh']]);
  assert.equal((await readdir(path.join(dataDir, 'backups'))).length, 2);
  const refreshedSnapshot = (await refreshed.listBackups()).find(item => item.revision === 1);
  const refreshedDocument = JSON.parse(gunzipSync(await readFile(path.join(dataDir, 'backups', refreshedSnapshot.id))).toString('utf8'));
  assert.equal(refreshedDocument.retentionPinned, true);
  await refreshed.close();
  const stable = await openStore({ dataDir, prepareState });
  t.after(() => stable.close());
  assert.equal(stable.getState().revision, 2);
  assert.equal((await readdir(path.join(dataDir, 'backups'))).length, 2);
});

test('replacement preview prepares the exact replacement history and revision without committing', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir, now: () => '2026-10-07T12:00:00.000Z' });
  t.after(() => store.close());
  await store.command(command, 0);
  const incoming = createGroupState([{ id: 'a', name: 'A' }]);
  incoming.revision = 40;
  incoming.history = [{ id: 'revision-40', revision: 40, type: 'import', at: '2026-10-06T00:00:00.000Z' }];
  const preview = await store.previewReplacement(exportBackup(incoming));
  assert.equal(preview.current.revision, 1);
  assert.equal(preview.state.revision, 2);
  assert.deepEqual(preview.state.history.map(event => event.id), ['revision-2']);
  assert.equal(store.getState().revision, 1);
  assert.deepEqual(await store.replace(exportBackup(incoming), 1), preview.state);
});

test('restore creates an undo barrier without losing archived history and supports a different roster', async t => {
  const dataDir = await directory(t);
  const world = buildWorld({ chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] });
  const store = await openStore({ dataDir, world });
  t.after(() => store.close());
  await store.command({ type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' }, 0);
  const incoming = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  incoming.members[0].unlocked = ['12342'];
  const restored = await store.replace(exportBackup(incoming), 1);
  assert.equal(restored.revision, 2);
  assert.deepEqual(restored.members[0].unlocked, ['12342']);
  assert.equal(restored.provenance.restore.previousHistory[0].undo.memberChanges[0].id, 'actor1');
  await assert.rejects(() => store.command({ type: 'undo' }, 2), /No reversible command/);
  assert.equal(store.getState().revision, 2);
  assert.deepEqual(store.getState().members[0].unlocked, ['12342']);
  await store.command({ type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' }, 2);
  const undone = await store.command({ type: 'undo' }, 3);
  assert.equal(undone.revision, 4);
  assert.deepEqual(undone.members[0].unlocked, ['12342']);
  const different = await store.replace(exportBackup(createGroupState([{ id: 'third', name: 'Third' }])), 4);
  assert.equal(different.revision, 5);
  assert.deepEqual(different.members.map(member => member.id), ['third']);
  assert.ok(different.provenance.restore.previousHistory.some(event => event.type === 'undo'));
  assert.deepEqual(importBackup(await store.backup()), different);
  await assert.rejects(() => store.command({ type: 'undo' }, 5), /No reversible command/);
});

test('trusted-state copying still isolates hooks, backups and client results and rejects invalid initialization', async t => {
  const dataDir = await directory(t);
  let retainedHookInput;
  let retainedCommitInput;
  const store = await openStore({ dataDir, prepareState: state => { retainedHookInput = state; return state; },
    beforeCommit: ({ state }) => { retainedCommitInput = state; } });
  t.after(() => store.close());
  retainedHookInput.members[0].name = 'External mutation';
  assert.equal(store.getState().members[0].name, 'Player');
  const result = await store.command(command, 0);
  retainedHookInput.members[0].name = 'External hook mutation';
  retainedCommitInput.members[0].name = 'External commit mutation';
  result.members[0].name = 'Client mutation';
  const backup = await store.backup();
  backup.state.members[0].name = 'Backup mutation';
  assert.equal(store.getState().members[0].name, 'Player');
  assert.equal(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')).members[0].name, 'Player');
  const otherDir = path.join(dataDir, 'invalid');
  const initialState = createGroupState([{ id: 'a', name: 'A' }]);
  initialState.members[0].unlocked = ['0'];
  await assert.rejects(() => openStore({ dataDir: otherDir, initialState, prepareState: () => { throw new Error('Must not run before input validation'); } }), /base chunk ID/);
});


test('browser snapshots omit identity migration evidence while history, undo and backups retain it', async t => {
  const dataDir = await directory(t), initialState = createGroupState([{ id: 'actor1', name: 'Player' }]);
  const evidence = { schemaVersion: 1, archives: [{ retained: 'archive' }], conversions: [{ retained: 'conversion' }], conflicts: [], unresolved: [] };
  initialState.provenance = { source: 'fixture', taskIdentityMigration: evidence };
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState, world }); t.after(() => store.close());
  const baseline = await store.backup();
  for (const view of [undefined, 'play-v1']) {
    const display = JSON.parse(store.getStateSnapshot({ view }).stateJSON);
    assert.equal(display.provenance?.taskIdentityMigration, undefined);
    assert.equal(display.revision, baseline.state.revision);
  }
  const saved = await store.commandSerialized(command, 0);
  assert.equal(JSON.parse(saved.stateJSON).provenance.taskIdentityMigration, undefined);
  assert.deepEqual((await store.backup()).state.provenance.taskIdentityMigration, evidence);
  const retained = await store.readBackup((await store.listBackups())[0].id);
  assert.deepEqual(retained.state.provenance.taskIdentityMigration, evidence);
  await assert.rejects(store.command(command, 0), error => error.code === 'REVISION_CONFLICT');
  await store.command({ type: 'undo' }, 1);
  assert.deepEqual(store.getState().provenance.taskIdentityMigration, evidence);
  assert.ok(store.getState().history.length >= 2);
  assert.deepEqual(exportBackup(store.getState()).state.provenance.taskIdentityMigration, evidence);
  assert.deepEqual(importBackup(await store.backup()).provenance.taskIdentityMigration, evidence);
  await store.replace(baseline, 2);
  assert.deepEqual((await store.backup()).state.provenance.restore.incomingProvenance.taskIdentityMigration, evidence);
  assert.equal(JSON.parse(store.getStateSnapshot().stateJSON).provenance.restore.incomingProvenance.taskIdentityMigration, undefined);
});
