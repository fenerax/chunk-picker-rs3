// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { taskId } from '../app/tasks/engine.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import { compareValues, resultValue } from '../scripts/experiments/q2-diff-engine/inputs.mjs';

const definitions = { chunks: { '12850': { Spawn: { Seed: 1 } }, '12851': { Spawn: { Token: 1 } } },
  walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'], equipment: {}, codeItems: {}, drops: {},
  challenges: { Extra: { First: { Items: ['Seed'], Output: 'Key' }, Second: { Tasks: { First: 'Extra' } },
    Future: { Items: ['Token'], Output: 'Badge' }, Cycle: { Items: ['Badge'] } } } };
async function calculator(t, bytes) {
  const world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface }, skillGuideCatalogue: { skills: [], tasks: [] } }),
    env: { ...process.env, RS3_CALCULATOR_CACHE_BYTES: String(bytes) },
  });
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  let sequence = 0;
  return async request => {
    const reply = once(worker, 'message'); worker.postMessage({ id: ++sequence, ...request });
    const [message] = await reply;
    assert.equal(message.error, undefined);
    return resultValue(message, request.type, ready.datasetDigest, 'identical-synthetic-inputs');
  };
}
const wire = value => JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child);

test('serialized baseline, views, planning, Why, How and previews equal full recalculation after deterministic edits', async t => {
  const retained = await calculator(t, 4 * 1024 * 1024), full = await calculator(t, 0);
  const state = createGroupState(['one', 'two'].map(id => ({ id, name: 'Synthetic ' + id, unlocked: ['12850'] })));
  state.tasks = Object.keys(definitions.challenges.Extra).map(label => ({ id: taskId('Extra', label), label, category: 'Extra' }));
  const edits = [() => {},
    () => state.members[0].unlocked.push('12851'),
    () => state.members[0].taskStatus = { [taskId('Extra', 'First')]: { backlogged: true } },
    () => { state.members[0].taskStatus = {}; state.members[0].completedTasks = [taskId('Extra', 'First')]; },
    () => { state.rules['access.shared'] = false; state.members[0].unlocked.pop(); },
  ];
  for (const [index, edit] of edits.entries()) {
    edit(); state.revision = index;
    for (const memberId of ['one', 'two']) {
      const base = { state, memberId, input: 'edit-' + index };
      const requests = [
        { type: 'death-estimates', chunkIds: [] }, // Deferred views first.
        { type: 'evaluate' }, { type: 'evaluate' },
        { type: 'chunk-planning', chunkId: '12851' },
        { type: 'why-task', chunkId: taskId('Extra', 'Second') },
        { type: 'how-task', chunkId: taskId('Extra', 'Second') },
        { type: 'predict', chunkId: '12851' },
        { type: 'sandbox', chunkId: { changes: { unlockChunks: ['12851'] }, planningChunkId: '12851' } },
      ];
      for (const request of requests) {
        const warm = await retained({ ...base, ...request }), cold = await full({ ...base, ...request });
        // Why is deliberately resident-only, so the zero-budget oracle uses
        // the established full-result Why path instead of a missing snapshot.
        if (request.type === 'why-task') {
          const { taskWhyDisplay, createTaskWhyIndex } = await import('../app/tasks/task-why-display.mjs');
          const baseline = (await full({ ...base, type: 'evaluate' })).result;
          cold.result = taskWhyDisplay(baseline, request.chunkId, memberId, state.revision,
            { index: createTaskWhyIndex(baseline) }) ?? { unavailable: true };
        }
        assert.deepEqual(compareValues(warm, cold), [], `${index}/${memberId}/${request.type}`);
        if (request.type === 'evaluate') assert.equal(wire(warm.result), wire(cold.result));
      }
      // Actual transport bytes preserve ordering and every field, including
      // map locations and the duo/sidebar projections, after hydration.
      for (const resultView of ['full', 'play-v1']) {
        const request = { ...base, type: 'evaluate', resultTransport: 'json-shared-v1', resultView, duoProjection: true, duoSidebarProjection: true };
        const warm = await retained(request), cold = await full(request);
        const fields = resultView === 'full' ? ['resultJSON', 'playJSON'] : ['playJSON', 'duoJSON', 'duoSidebarJSON'];
        for (const key of fields) assert.equal(wire(JSON.parse(Buffer.from(warm[key]))), wire(JSON.parse(Buffer.from(cold[key]))));
      }
    }
  }
});
