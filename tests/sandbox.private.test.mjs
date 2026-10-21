import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { normalizeSandboxRequest, applySandboxChanges, sandboxDelta, compactSandboxPrediction } from '../app/sandbox.mjs';

const chunkIds = Array.from({ length: 42 }, (_, index) => String(12341 + index));
const world = buildWorld({ chunks: Object.fromEntries(chunkIds.map(id => [id, {}])), walkableChunks: chunkIds, walkableChunksF2P: chunkIds });
function fixture() {
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'], selected: ['12342'],
    pendingRoll: ['12343', '12344'], blacklisted: ['12345'] }, { id: 'two', name: 'Two', unlocked: ['12346'] }]);
  state.tasks = [{ id: 'custom:saved', label: 'Saved', category: 'Quest' }];
  state.members[0].taskStatus = { 'custom:saved': { challengeCompleted: true, note: 'Keep' } };
  return { state, body: { memberId: 'one', baseRevision: 0, changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } } };
}

test('sandbox normalizes independent changes and task-rule keys for cache reuse', () => {
  const { state, body } = fixture();
  body.changes = { unlockChunks: ['12344', '12343'], lockChunks: ['12341'], doneTasks: ['custom:saved'],
    taskRules: { 'Show Quest Tasks': true, 'Show Skill Tasks': false } };
  const before = structuredClone(body);
  const normalized = normalizeSandboxRequest(body, { state, world });
  assert.deepEqual(normalized.changes.unlockChunks, ['12343', '12344']);
  assert.deepEqual(Object.keys(normalized.changes.taskRules), ['Show Quest Tasks', 'Show Skill Tasks']);
  assert.deepEqual(body, before);
  assert.deepEqual(normalizeSandboxRequest({ ...body, changes: { ...body.changes, unlockChunks: ['12343', '12344'] } }, { state, world }), normalized);
});

