import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';

const world = buildWorld({ chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] });
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-storage-play-'));
  const initialState = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }]);
  initialState.legacy = { original: 'Retained original import. '.repeat(15000) };
  const store = await openStore({ dataDir, initialState, world, ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return store;
}
const snapshot = saved => ({ ...saved, state: JSON.parse(saved.stateJSON) });
test('queued play acknowledgements omit unchanged trees, merge exactly and leave full views intact', async t => {
  const store = await fixture(t), initial = snapshot(store.getStateSnapshot({ view: 'play-v1' }));
  const [firstSaved, secondSaved] = await Promise.all([
    store.commandSerialized({ type: 'set-chunk', memberId: 'one', chunkId: '12342', status: 'unlocked' }, 0, { view: 'play-v1', omitUnchanged: true }),
    store.commandSerialized({ type: 'set-note', memberId: 'one', chunkId: '12342', note: 'Next revision' }, 1, { view: 'play-v1', omitUnchanged: true }),
  ]);
  const first = snapshot(firstSaved), second = snapshot(secondSaved);
  assert.equal(first.baseRevision, 0); assert.equal(second.baseRevision, 1);
  assert.deepEqual(first.unchangedFields.sort(), ['identityRegistry', 'legacy', 'tasks']);
  assert.ok(Buffer.byteLength(first.stateJSON) < 2000);
  assert.equal(first.state.revision, 1); assert.equal(second.state.revision, 2);
  assert.equal(first.state.members[0].notes, undefined); assert.equal(second.state.members[0].notes['12342'], 'Next revision');
  const current = snapshot(store.getStateSnapshot({ view: 'play-v1' }));
  assert.deepEqual(mergeCommandState(mergeCommandState(initial.state, first), second), current.state);
  assert.ok(current.state.legacy.original); assert.ok(current.state.tasks); assert.ok(current.state.identityRegistry);
  assert.ok(store.getState().legacy.original); assert.equal(mergeCommandState(initial.state, second), null);
});
test('new saved identity candidates are sent even when tasks and raw imports remain unchanged', async t => {
  const source = 'rs3:task:play-source', other = 'rs3:task:previously-unknown';
  const initialState = createGroupState([{ id: 'one', name: 'One' }]);
  initialState.tasks = [{ id: source, label: 'Source', category: 'Extra' }, { id: other, label: 'Other', category: 'Extra' }];
  initialState.identityRegistry = { schemaVersion: 1, entries: { [source]: { id: source, kind: 'task', label: 'Source', category: 'Extra', aliases: [] } }, aliases: {}, unresolved: [] };
  const store = await fixture(t, { initialState, prepareState(state, { operation }) {
    if (operation === 'command') state.identityRegistry = { ...state.identityRegistry,
      entries: { ...state.identityRegistry.entries, [other]: { id: other, kind: 'task', label: 'Other', category: 'Extra', aliases: [] } },
      aliases: { ...state.identityRegistry.aliases, [source]: [source, other] } };
    return state;
  } });
  const before = snapshot(store.getStateSnapshot({ view: 'play-v1' }));
  assert.equal(before.state.identityRegistry.entries[other], undefined);
  const saved = snapshot(await store.commandSerialized({ type: 'set-task-status', memberId: 'one', taskId: source, favorite: true }, 0, { view: 'play-v1', omitUnchanged: true }));
  assert.ok(!saved.unchangedFields?.includes('identityRegistry'));
  assert.deepEqual(saved.state.identityRegistry.aliases[source], [source, other]);
  assert.ok(saved.state.identityRegistry.entries[other]);
  assert.deepEqual(mergeCommandState(before.state, saved), snapshot(store.getStateSnapshot({ view: 'play-v1' })).state);
});
test('first saved reference and undo of the last reference transmit the changed sparse catalogue', async t => {
  const id = 'rs3:task:unreferenced';
  const initialState = createGroupState([{ id: 'one', name: 'One' }]);
  initialState.tasks = [{ id, label: 'Unreferenced', category: 'Extra' }];
  const store = await fixture(t, { initialState });
  const baseline = snapshot(store.getStateSnapshot({ view: 'play-v1' }));
  assert.deepEqual(baseline.state.tasks, []);
  const first = snapshot(await store.commandSerialized({ type: 'set-task-status', memberId: 'one', taskId: id, challengeCompleted: false }, 0, { view: 'play-v1', omitUnchanged: true }));
  assert.ok(!first.unchangedFields.includes('tasks')); assert.deepEqual(first.state.tasks, initialState.tasks);
  const afterFirst = mergeCommandState(baseline.state, first);
  assert.deepEqual(afterFirst, snapshot(store.getStateSnapshot({ view: 'play-v1' })).state);
  const last = snapshot(await store.commandSerialized({ type: 'undo' }, 1, { view: 'play-v1', omitUnchanged: true }));
  assert.ok(!last.unchangedFields.includes('tasks')); assert.deepEqual(last.state.tasks, []);
  assert.deepEqual(mergeCommandState(afterFirst, last), snapshot(store.getStateSnapshot({ view: 'play-v1' })).state);
  assert.deepEqual(store.getState().tasks, initialState.tasks);
});
test('serialized calculation snapshots retain every input field and stay coherent when bytes are read after a newer save', async t => {
  const initialState = createGroupState([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  initialState.provenance = { restore: { previousHistory: ['retained archive'] } };
  initialState.tasks = [{ id: 'custom:unicode', label: 'Player 🦊', category: 'Custom' }];
  initialState.members[1].taskStatus = { 'custom:unicode': { note: 'Île 🦊', challengeCompleted: false } };
  initialState.legacy = { maps: { raw: { content: 'Original 🦊', settings: { keep: true } } } };
  const store = await fixture(t, { initialState, prepareState(state, { operation }) {
    if (operation === 'command') state.legacy = { ...state.legacy, hookRevision: state.revision };
    return state;
  } });
  const original = store.getState(), captured = store.getCalculationSnapshot();
  // Only the effigies migration marker crosses into calculation input; archives stay out.
  const { provenance, history, ...input } = original; input.history = [];
  input.provenance = { ancientEffigiesMigratedMembers: ['one', 'two'] };
  assert.ok(provenance.restore.previousHistory);
  assert.equal(captured, store.getCalculationSnapshot()); assert.equal(captured.revision, original.revision);
  assert.deepEqual(captured.members, [{ id: 'one' }, { id: 'two' }]); assert.equal(captured.inputKey, store.getGameplayFingerprint());
  await store.command({ type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Next revision' }, 0);
  const bytes = captured.stateJSON;
  assert.ok(bytes instanceof SharedArrayBuffer); assert.equal(captured.stateJSON, bytes);
  assert.deepEqual(JSON.parse(Buffer.from(bytes).toString('utf8')), input);
  assert.deepEqual(captured.state, input); assert.equal(captured.state.provenance.restore, undefined); assert.deepEqual(captured.state.history, []);
  const next = store.getCalculationSnapshot(); assert.notEqual(next, captured); assert.equal(next.revision, 1);
  const nextJSON = JSON.parse(Buffer.from(next.stateJSON).toString('utf8'));
  assert.deepEqual(nextJSON, store.getCalculationState()); assert.equal(nextJSON.legacy.hookRevision, 1);
  assert.equal(nextJSON.members[0].notes['12341'], 'Next revision');
  assert.ok(store.getState().provenance.restore.previousHistory); assert.ok(store.getState().history.length);
});
