import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createComparisonEvaluator, observeTaskViews, buildComparisonSnapshot } from '../scripts/compare-cache-access.mjs';
import { renderComparison } from '../scripts/report-cache-access-diff.mjs';

const definitions = {
  chunks: { '12341': { Object: { Tree: true, Anvil: true }, Monster: { Goblin: true }, Spawn: { 'Bronze sword': true, 'Bronze hatchet': true } }, '12342': { Object: { Tree: true } } },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Quest: { 'Present quest': { Chunks: ['12341'] }, 'Future quest': { Chunks: ['12342'] } },
    Woodcutting: { 'Cut logs': { Objects: ['Tree'], Level: 1, Primary: true, Items: ['Bronze hatchet'], Output: ['Logs'] } } },
  drops: { Goblin: { Bones: { '1': 'Always' } } }, objectItems: { Tree: { Logs: true } },
  equipment: { 'Bronze sword': { slot: 'main hand weapon', class: 'melee', tier: 1, ability_damage: 10, accuracy: 20, speed: 3, requirements: { Attack: 1 } } }, codeItems: {},
};

test('comparison follows real worker collection, equipment, presentation and Activity Info', async t => {
  const state = createGroupState([{ id: 'tester', name: 'Anonymous' }]);
  state.rules['content.f2p'] = false;
  state.members[0].unlocked = ['12341'];
  state.members[0].taskRules = { 'Kill X': true };
  const initial = structuredClone(state), world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.type, 'ready');
  const response = once(worker, 'message');
  worker.postMessage({ id: 1, state, memberId: 'tester' });
  const [message] = await response;
  assert.equal(message.error, undefined);
  const result = createComparisonEvaluator(definitions, false, { reviewedOverlays: false })(state, 'tester');
  assert.ok(result.tasks.some(row => row.record?.Label === 'Kill X'), 'Collection goals participate in parity validation');
  assert.ok(result.tasks.some(row => row.equipmentName === 'Bronze sword'), 'Equipment catalogue participates in parity validation');
  for (const key of ['tasks', 'collectionPlanning', 'presentation', 'activityInfo', 'access', 'obligationAccess', 'training']) assert.deepEqual(result[key], message.result[key], key);
  assert.equal(result.metrics.availableCount, message.result.metrics.availableCount);
  assert.deepEqual(state, initial);
});

test('actual UI harness respects shared completion, hidden obligations, saved backlogs and controls', async () => {
  const state = createGroupState([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const rows = ['active', 'done', 'backlog', 'hidden', 'partner', 'blocked', 'suppressed'].map(id => ({ id: `custom:${id}`, label: id, category: 'Custom', status: id === 'blocked' ? 'blocked' : 'available', obligation: id !== 'partner', hidden: id === 'hidden' }));
  // Use ordinary IDs for suppressed/blocked so custom fallback does not change eligibility.
  for (const row of rows.filter(row => ['blocked', 'suppressed'].includes(row.label))) row.id = `saved:${row.label}`;
  state.tasks = rows;
  state.members[1].taskStatus = { 'custom:done': { challengeCompleted: true } };
  state.members[0].taskStatus = { 'custom:backlog': { backlogged: true } };
  state.members[0].preferences = { hideChecked: true };
  const result = { tasks: rows, presentation: { tasks: rows.filter(row => row.label !== 'suppressed') }, collectionPlanning: { completionGroups: {} }, access: { areas: [] } };
  const view = observeTaskViews(state, 'a', result);
  assert.deepEqual(view.active, ['custom:active']);
  assert.deepEqual(view.completed, ['custom:done']);
  assert.deepEqual(view.backlog, ['custom:backlog']);
  assert.ok(observeTaskViews(state, 'a', result, { hideCompleted: false }).active.includes('custom:done'));
  assert.ok(observeTaskViews(state, 'a', result, { showAll: true }).active.includes('saved:suppressed'));
  assert.ok(observeTaskViews(state, 'a', result, { showBlocked: true }).active.includes('saved:blocked'));
  state.members[0].taskStatus['custom:active'] = { favorite: true };
  assert.deepEqual(observeTaskViews(state, 'a', result, { showAll: true, taskFilters: { pinned: true } }).active, ['custom:active']);
  assert.deepEqual(observeTaskViews(state, 'a', result, { showBlocked: true, taskFilters: { doable: true } }).active, ['custom:active', 'saved:suppressed']);
  // The shipped renderer finishes its paint promise after returning the row
  // snapshot. Keep this test active until that callback has also completed.
  await new Promise(resolve => setImmediate(resolve));
});

test('snapshots anonymize members and omit private notes/account observations', () => {
  const state = createGroupState([{ id: 'private-member', name: 'Private Person' }]);
  state.members[0].unlocked = ['12341'];
  state.members[0].notes = { '12341': 'SECRET_NOTE' };
  state.members[0].runescapeName = 'SECRET_ACCOUNT';
  const serialized = JSON.stringify(buildComparisonSnapshot(definitions, state, false, { reviewedOverlays: false }));
  for (const forbidden of ['Private Person', 'private-member', 'SECRET_NOTE', 'SECRET_ACCOUNT']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.ok(serialized.includes('Member1'));
});

test('report distinguishes retained source presence from changed source locations and rejects mismatched inputs', () => {
  const state = createGroupState([{ id: 'tester', name: 'Anonymous' }]);
  state.members[0].unlocked = ['12341', '12342'];
  const before = { ...buildComparisonSnapshot(definitions, state, false, { reviewedOverlays: false }), sourceSha256: 'same-input' };
  const after = structuredClone(before);
  after.cacheWalking = true;
  after.cacheStateSha256 = buildComparisonSnapshot(definitions, state, true, { reviewedOverlays: false }).cacheStateSha256;
  for (const scope of ['access', 'obligationAccess']) {
    before.members[0][scope].locations['Object:Tree'] = ['12341', '12342'];
    after.members[0][scope].locations['Object:Tree'] = ['12341'];
  }
  const report = renderComparison(before, after, definitions);
  assert.match(report, /Source-location changes \(including sources still present\)/);
  assert.match(report, /Object:Tree/);
  assert.match(report, /removed `\["12342"\]`/);
  assert.match(report, /No task state, obligation, suppression or source changes/);
  assert.throws(() => renderComparison(before, { ...after, sourceSha256: 'different' }, definitions), /identical input/);
  assert.throws(() => renderComparison({ ...before, schemaVersion: 1 }, after, definitions), /schema 2/);
  assert.throws(() => renderComparison(before, { ...after, cacheStateSha256: 'different-policy' }, definitions), /policy\/topology changed/);
});
