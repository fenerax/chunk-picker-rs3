import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir, rename, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, exportBackup, importBackup, getUndoEligibility } from '../app/core/state.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { taskReuseInputKey } from '../app/tasks/unlock-reuse.mjs';
import { lookupPermanentId } from '../app/tasks/identity.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { openStore } from '../app/storage/store.mjs';

const now = () => '2026-10-12T12:00:00.000Z';
const owners = [{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }];
const claim = (taskId = 'custom:first', memberId = 'player1', extra = {}) => ({ type: 'claim-task', memberId, taskId, ...extra });
function initial() {
  const state = createGroupState(owners);
  state.tasks = ['first', 'second', 'family'].map(id => ({ id: `custom:${id}`, label: id, category: 'Extra' }));
  return state;
}
const run = (state, command, options = {}) => applyCommand(state, command, { now, expectedRevision: state.revision, ...options });

test('[regression] aliases in saved claims and inverse guards become canonical and remain reversible', () => {
  const id = 'rs3:task:003532', alias = lookupPermanentId(id).aliases.find(value => value.startsWith('rs3:Extra:'));
  const canonical = run(createGroupState(owners), claim(id));
  const legacy = structuredClone(canonical);
  legacy.taskClaims[alias] = legacy.taskClaims[id]; delete legacy.taskClaims[id];
  legacy.history[0].undo.taskClaimChanges.changes[0].id = alias;
  const loaded = importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state: legacy });
  assert.deepEqual(loaded.taskClaims, canonical.taskClaims);
  assert.equal(loaded.history[0].undo.taskClaimChanges.changes[0].id, id);
  const released = run(loaded, { type: 'clear-task-claim', memberId: 'player1', taskId: alias });
  assert.equal(released.history.at(-1).command.taskId, id);
  assert.equal(released.history.at(-1).command.requestedTaskId, alias);
  assert.deepEqual(run(released, { type: 'undo' }).taskClaims, canonical.taskClaims);
  assert.equal(Object.hasOwn(run(loaded, { type: 'undo' }), 'taskClaims'), false);
});

test('claim and takeover aliases look up and save one canonical coordination record', () => {
  const id = 'rs3:task:003532', alias = lookupPermanentId(id).aliases.find(value => value.startsWith('rs3:Extra:'));
  const first = run(createGroupState(owners), claim(alias));
  assert.deepEqual(Object.keys(first.taskClaims), [id]);
  assert.equal(first.history[0].command.taskId, id);
  assert.throws(() => run(first, claim(id)), /already claimed/);
  const taken = run(first, claim(alias, 'player2', { takeover: true }));
  assert.deepEqual(Object.keys(taken.taskClaims), [id]);
  assert.equal(taken.taskClaims[id].memberId, 'player2');
  assert.deepEqual(run(taken, { type: 'undo' }).taskClaims, first.taskClaims);
});

test('claims change neither computation fingerprint nor saved task catalogue', () => {
  const fingerprint = createGameplayFingerprint(), before = initial();
  const after = run(before, claim());
  assert.equal(fingerprint(before), fingerprint(after));
  assert.equal(taskReuseInputKey(before), taskReuseInputKey(after));
  const knownId = 'rs3:task:003532', row = lookupPermanentId(knownId);
  assert(row);
  const dynamic = run(createGroupState(owners), claim(knownId));
  assert.deepEqual(dynamic.tasks, []);
  assert.equal(dynamic.history[0].command.taskLabel, row.label);
  assert.equal(fingerprint(createGroupState(owners)), fingerprint(dynamic));
  assert.deepEqual(importBackup(exportBackup(dynamic)), dynamic);
  assert.equal(Object.hasOwn(run(dynamic, { type: 'undo' }), 'taskClaims'), false);
});

async function isolatedStore(t, options = {}) {
  const root = path.resolve('.local/task-claim-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'store-'));
  const store = await openStore({ dataDir, initialState: initial(), now, ...options });
  t.after(async () => {
    await store.close();
    assert.equal(path.dirname(path.resolve(dataDir)), root);
    await rm(dataDir, { recursive: true, force: true });
  });
  return { store, dataDir };
}

test('[regression] replacing personal completion with a saved alias clears its canonical claim', () => {
  const id = 'rs3:task:003532', alias = lookupPermanentId(id).aliases.find(value => value.startsWith('rs3:Extra:'));
  const original = createGroupState(owners);
  original.tasks = [{ id, label: lookupPermanentId(id).label, category: 'Extra' }];
  original.identityRegistry = { schemaVersion: 1, entries: { [id]: lookupPermanentId(id) }, aliases: { [alias]: id }, unresolved: [] };
  const claimed = run(original, claim(id));
  const member = { ...claimed.members[1], completedTasks: [alias] };
  const completed = run(claimed, { type: 'replace-member', memberId: 'player2', member });
  assert.deepEqual(completed.taskClaims, {});
});

test('[regression] original-picker completion aliases clear canonical claims in the importing save', () => {
  const id = 'rs3:task:003532', alias = lookupPermanentId(id).aliases.find(value => value.startsWith('rs3:Extra:'));
  const original = createGroupState(owners);
  original.members[1].sourceMapId = 'qxb';
  original.tasks = [id, alias].map(id => ({ id, label: lookupPermanentId('rs3:task:003532').label, category: 'Extra' }));
  original.identityRegistry = { schemaVersion: 1, entries: { [id]: lookupPermanentId(id) }, aliases: { [alias]: id }, unresolved: [] };
  const claimed = run(original, claim(id));
  const command = { type: 'sync-original', capturedAt: now(), sourceHash: `sha256:${'a'.repeat(64)}`,
    members: [{ memberId: 'player2', sourceMapId: 'qxb', groups: ['tasks'], tasks: { complete: [alias], backlog: [] } }] };
  for (const apply of [applyCommand, applyValidatedCommand]) {
    const completed = apply(claimed, command, { expectedRevision: claimed.revision, now });
    assert.deepEqual(completed.taskClaims, {});
    if (apply === applyValidatedCommand) assert.equal(completed.history.at(-1).type, 'sync-original');
  }
});

