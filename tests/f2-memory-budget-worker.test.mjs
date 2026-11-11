// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/fixed-performance-clock.mjs';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { engineFixture, fixtureStates } from './fixtures/task-engine.mjs';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE, SKILL_GUIDE_MILESTONES_RULE } from '../app/data/skill-guides.mjs';

const semantic = value => JSON.stringify(value);
const definitions = { chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
  challenges: { Extra: { Synthetic: { Chunks: ['12850'] } } }, equipment: {}, codeItems: {}, drops: {} };

async function calculator(t, stateBytes) {
  const sent = [], evictions = [], world = buildWorld(definitions);
  const scheduler = await createTaskScheduler({ maxCalculators: 1, idleMs: 600000,
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface }, skillGuideCatalogue: { skills: [], tasks: [] } }),
    workerFactory(data) {
      const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: data,
        execArgv: ['--import', new URL('./helpers/fixed-performance-clock.mjs', import.meta.url).href],
        env: { ...process.env, RS3_STATE_SNAPSHOT_BYTES: String(stateBytes), RS3_CALCULATOR_CACHE_BYTES: '0', RS3_ENGINE_VARIANT_BYTES: '0' } });
      const post = worker.postMessage.bind(worker);
      worker.postMessage = message => {
        if (message.type === 'evaluate') sent.push({ fresh: !!message.stateJSON, caps: data.memoryBudget });
        return post(message);
      };
      worker.on('message', message => { evictions.push(...message.evictedStateInputs ?? []); });
      return worker;
    } });
  t.after(() => scheduler.close());
  const pickerId = 'p_' + createHash('sha256').update('synthetic-memory-budget').digest('hex').slice(0, 32);
  const lane = scheduler.forPicker(pickerId);
  const state = createGroupState([{ id: 'synthetic-member', name: 'Synthetic Player', unlocked: ['12850'] }]);
  const bytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(bytes.length); Buffer.from(stateJSON).set(bytes);
  return { sent, evictions, async evaluate(key) {
    const value = await lane.evaluate(state, 'synthetic-member', 'evaluate', undefined, key, 'synthetic-input', undefined, [], 'full', { inputKey: 'synthetic-input', stateJSON });
    return semantic(value.result);
  } };
}

test('input eviction hints trigger full resends and preserve serialized calculator replies', async t => {
  const roomy = await calculator(t, 1024 ** 2), capped = await calculator(t, 0);
  const expected = await roomy.evaluate('first');
  assert.equal(await capped.evaluate('first'), expected);
  assert.equal(await roomy.evaluate('second'), expected);
  assert.equal(await capped.evaluate('second'), expected);
  assert.equal(await capped.evaluate('third'), expected);
  assert.deepEqual(roomy.sent.map(row => row.fresh), [true, false]);
  assert.deepEqual(capped.sent.map(row => row.fresh), [true, true, true]);
  assert.equal(capped.evictions.length, 3);
  assert.equal(capped.sent[0].caps.calculators, 1);
});

test('all guide variants recreate after cap eviction with the same task answers', () => {
  const options = { skillGuideCatalogue: { skills: [], tasks: [] } }, data = engineFixture();
  const reference = createTaskEngine(data, { ...options, variantByteLimit: 16 * 1024 ** 2 });
  const capped = createTaskEngine(data, { ...options, variantByteLimit: 0 });
  for (let mask = 0; mask < 8; mask++) {
    const state = structuredClone(fixtureStates()[0].state);
    for (const [i, rule] of [SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE, SKILL_GUIDE_MILESTONES_RULE].entries()) state.rules[rule] = !!(mask & 1 << i);
    assert.equal(semantic(capped.evaluate(state, 'm0')), semantic(reference.evaluate(state, 'm0')));
    assert.equal(capped.retentionLedger().parsedBytes, 0);
  }
  assert.equal(reference.retentionLedger().keys.length, 8);
  assert(capped.retentionLedger().evictions >= 8);
});
