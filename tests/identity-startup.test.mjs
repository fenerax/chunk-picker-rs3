import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { openStore } from '../app/storage/store.mjs';
import { applyCommand, createGroupState, exportBackup, importBackup } from '../app/core/state.mjs';
import { legacyTaskId, permanentTaskId } from '../app/tasks/identity.mjs';

const permanentId = 'rs3:task:startup-fixture';
const label = 'Startup quest';
const oldId = legacyTaskId('Quest', label);
const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'],
  challenges: { Quest: { [label]: { PickerId: permanentId, Chunks: ['12341'] } } } };
const options = { definitions, taskMap: {}, port: 0, now: '2026-10-07T12:00:00.000Z' };

async function directory(t) {
  const root = path.resolve('.local', 'identity-startup-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
function legacyState() {
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  state.tasks = [{ id: oldId, label, category: 'Quest' }];
  return applyCommand(state, { type: 'complete-task', memberId: 'player1', taskId: oldId, completed: true }, { now: options.now });
}
async function save(dataDir, state) {
  const bytes = `${JSON.stringify(exportBackup(state), null, 2)}\n`;
  await writeFile(path.join(dataDir, 'state.json'), bytes);
  return bytes;
}
async function application(t, dataDir, extra = {}) {
  const app = await createServer({ dataset: fixtureDataset, ...options, ...extra, dataDir });
  t.after(() => app.close());
  return app;
}

test('saved identity collisions start with archived evidence, one refresh, and an idempotent reopen', async t => {
  const dataDir = await directory(t), original = legacyState();
  await save(dataDir, original);
  let sawMigration = false;
  const app = await application(t, dataDir, { prepareState(state, context) {
    assert.equal(context.operation, 'load');
    assert.equal(context.migration.reused, false);
    assert(context.catalogue.some(task => task.id === permanentId));
    sawMigration = true;
    return state;
  } });
  await app.listen();
  const state = app.store.getState();
  assert(sawMigration);
  assert.equal(state.revision, original.revision + 1);
  assert.deepEqual(state.members[0].completedTasks, [permanentId]);
  assert.deepEqual(state.history.map(event => event.type), ['catalogue-refresh']);
  const archives = state.provenance.taskIdentityMigration.archives;
  assert(archives.some(archive => JSON.stringify(archive.history) === JSON.stringify(original.history)));
  assert(archives.some(archive => archive.tasks.some(task => task.id === oldId)));
  assert(archives.some(archive => JSON.stringify(archive.members) === JSON.stringify(original.members)));
  const backups = await app.store.listBackups();
  assert.equal(backups.length, 1);
  assert.deepEqual((await app.store.readBackup(backups[0].id)).state, original);
  const committed = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  await app.close();
  const reopened = await application(t, dataDir);
  assert.deepEqual(reopened.store.getState(), state);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), committed);
  assert.equal((await reopened.store.listBackups()).length, 1);
});

test('a collision-free startup alias projection preserves sparse undo after portable restore', async t => {
  const dataDir = await directory(t);
  const base = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  const rawLabel = "~|Cook's Assistant|~ Complete the quest";
  const alias = legacyTaskId('Quest', rawLabel), canonical = permanentTaskId('Quest', rawLabel);
  base.tasks = [{ id: alias, label: "Cook's Assistant Complete the quest", category: 'Quest' }];
  // Model the sparse event saved by the preceding label-ID version. Current
  // commands already decode this known alias before registering objectives.
  const original = structuredClone(base);
  original.revision = 1;
  original.members[0].completedTasks = [alias];
  original.history = [{ id: 'revision-1', revision: 1, type: 'complete-task', at: options.now,
    command: { type: 'complete-task', memberId: 'player1', taskId: alias, completed: true },
    undo: { memberChanges: [{ id: 'player1', changes: [{ path: ['completedTasks'], kind: 'value',
      before: { exists: true, value: [] }, after: { exists: true, value: [alias] } }] }] } }];
  await save(dataDir, original);
  // A saved objective absent from this small current catalogue still has an
  // authored global decoder, and needs no old/new catalogue-row merge.
  const app = await application(t, dataDir, { definitions: { ...definitions, challenges: {} } });
  const state = app.store.getState();
  assert.equal(state.history.length, 2);
  assert.equal(state.history[0].command.taskId, canonical);
  assert.deepEqual(state.members[0].completedTasks, [canonical]);
  const portable = importBackup(await app.store.backup());
  const undone = applyCommand(portable, { type: 'undo' }, { now: options.now });
  assert.deepEqual(undone.members[0].completedTasks, []);
  assert(state.provenance.taskIdentityMigration.archives.some(archive => JSON.stringify(archive.history) === JSON.stringify(original.history)));
  const committed = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  await app.close();
  await assert.rejects(() => createServer({ dataset: fixtureDataset, ...options, dataDir, definitions: { ...definitions, challenges: {} },
    prepareState(ready) { ready.history = []; return ready; } }), /authoritative revision and history/);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), committed);
});

test('caller load hooks cannot rewrite trusted migration history or revision', async t => {
  for (const corrupt of [
    state => { state.history = [{ id: 'revision-1', revision: 1, type: 'import', at: options.now }]; },
    state => { state.revision++; },
  ]) {
    const dataDir = await directory(t), bytes = await save(dataDir, legacyState());
    await assert.rejects(() => createServer({ dataset: fixtureDataset, ...options, dataDir, prepareState(state) { corrupt(state); return state; } }), /authoritative revision and history/);
    assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
    assert.deepEqual(await readdir(path.join(dataDir, 'backups')), []);
    assert(!(await readdir(dataDir)).includes('store.lock'));
    const recovered = await application(t, dataDir);
    assert.equal(recovered.store.getState().revision, 2);
    await recovered.close();
  }
  // With no migration stage, deleting ordinary authoritative history still fails.
  const dataDir = await directory(t), bytes = await save(dataDir, legacyState());
  await assert.rejects(() => openStore({ dataDir, prepareState(state) { state.history = []; return state; } }), /authoritative revision and history/);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
});

test('a failed startup refresh leaves the original save and a recoverable lock', async t => {
  const dataDir = await directory(t), bytes = await save(dataDir, legacyState());
  await assert.rejects(() => createServer({ dataset: fixtureDataset, ...options, dataDir, beforeCommit({ operation }) {
    assert.equal(operation, 'catalogue-refresh');
    throw new Error('Injected refresh failure');
  } }), /Injected refresh failure/);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
  assert(!(await readdir(dataDir)).includes('store.lock'));
  const recovered = await application(t, dataDir);
  assert.equal(recovered.store.getState().revision, 2);
});

test('retained preceding history is migrated together and cannot revive undo across a collision boundary', async t => {
  const dataDir = await directory(t);
  const base = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  base.tasks = [{ id: oldId, label, category: 'Quest' }];
  const store = await openStore({ dataDir, initialState: base, retention: { historyEntries: 1 }, now: options.now });
  for (const completed of [true, false, true]) await store.command({ type: 'complete-task', memberId: 'player1', taskId: oldId, completed }, store.getState().revision);
  const before = importBackup(await store.backup());
  assert.equal(before.history.length, 3);
  assert(store.getState().provenance.historyArchive.length > 0);
  await store.close();
  const app = await application(t, dataDir, { retention: { historyEntries: 1 } });
  const state = app.store.getState();
  assert.equal(state.provenance.historyArchive, undefined);
  assert(state.provenance.taskIdentityMigration.archives.some(archive => JSON.stringify(archive.history) === JSON.stringify(before.history)));
  assert.deepEqual(importBackup(await app.store.backup()).history.map(event => event.type), ['catalogue-refresh']);
  await assert.rejects(() => app.store.command({ type: 'undo' }, state.revision), /No reversible command/);
});

test('a reusable startup migration keeps unchanged retention segments and reopens without a refresh', async t => {
  const dataDir = await directory(t);
  const retention = { historyEntries: 1 };
  const app = await application(t, dataDir, { retention });
  for (const value of [false, true, false]) await app.store.command({ type: 'set-rule', ruleId: 'content.f2p', value }, app.store.getState().revision);
  const state = app.store.getState();
  assert(state.provenance.historyArchive.length > 0);
  const complete = await app.store.backup();
  const bytes = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  const backupCount = (await app.store.listBackups()).length;
  await app.close();
  for (let reopen = 0; reopen < 2; reopen++) {
    const restarted = await application(t, dataDir, { retention });
    assert.deepEqual(restarted.store.getState(), state);
    assert.deepEqual(await restarted.store.backup(), complete);
    assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
    assert.equal((await restarted.store.listBackups()).length, backupCount);
    await restarted.close();
  }
});
