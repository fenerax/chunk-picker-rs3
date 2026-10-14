import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommandState, projectChunkState } from '../app/web/command-state.mjs';

test('chunk previews share untouched state and preserve saved revision, history and ownership', () => {
  const first = { id: 'a', unlocked: ['1'], selected: ['2'], blacklisted: ['3'], pendingRoll: ['4'] };
  const second = { id: 'b', unlocked: ['9'], selected: [], blacklisted: [], pendingRoll: [] };
  const state = { revision: 7, history: [{ type: 'saved' }], tasks: [], members: [first, second] };
  const baseline = structuredClone(state);
  assert.equal(projectChunkState(state, []), state);
  const projected = projectChunkState(state, [
    { memberId: 'a', chunkId: '1', status: 'locked' },
    { memberId: 'a', chunkId: '2', status: 'unlocked' },
    { memberId: 'a', chunkId: '3', status: 'selected' },
    { memberId: 'a', chunkId: '2', status: 'blacklisted' },
    { memberId: 'a', chunkId: '4', status: 'unlocked' },
    { memberId: 'a', chunkId: '5', status: 'invalid' },
    { memberId: 'removed', chunkId: '9', status: 'locked' },
  ]);
  assert.deepEqual(projected.members[0].unlocked, []);
  assert.deepEqual(projected.members[0].selected, ['3']);
  assert.deepEqual(projected.members[0].blacklisted, ['2']);
  assert.equal(projected.revision, state.revision); assert.equal(projected.history, state.history); assert.equal(projected.tasks, state.tasks);
  assert.equal(projected.members[1], second); assert.deepEqual(state, baseline);
});

test('command responses reuse retained fields only from their submitted revision', () => {
  const tasks = Object.freeze([{ id: 'saved-task' }]);
  const baseline = Object.freeze({ revision: 7, tasks, legacy: Object.freeze({ exact: 'archive' }), members: [] });
  const changed = { revision: 8, members: [{ id: 'member', selected: ['12341'] }] };
  const response = { state: changed, baseRevision: 7, unchangedFields: ['tasks', 'legacy'] };
  const merged = mergeCommandState(baseline, response);
  assert.deepEqual(merged, { ...changed, tasks, legacy: baseline.legacy });
  assert.equal(merged.tasks, tasks);
  assert.equal(mergeCommandState({ ...baseline, revision: 8 }, response), null);
  assert.equal(mergeCommandState(undefined, response), null);
  assert.equal(mergeCommandState(baseline, { state: changed }), changed);
  assert.equal(Object.hasOwn(changed, 'tasks'), false);
});

test('retained command fields reject unknown, missing or already supplied values', () => {
  const baseline = { revision: 1, tasks: [] };
  for (const unchangedFields of [['constructor'], ['members'], ['identityRegistry'], 'tasks']) {
    assert.throws(() => mergeCommandState(baseline, { state: { revision: 2 }, baseRevision: 1, unchangedFields }));
  }
  assert.throws(() => mergeCommandState(baseline, { state: { revision: 2, tasks: [] }, baseRevision: 1, unchangedFields: ['tasks'] }));
});
