import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

const definitions = {
  chunks: { '12341': { Object: { Tree: true } }, '12342': { Object: { Anvil: true } }, '12343': {} },
  walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'],
  challenges: { Extra: { Ordinary: { Chunks: ['12341'] }, Consumer: { Items: ['Fixture material'] } },
    Nonskill: { Supply: { Chunks: ['12343'], Output: 'Fixture material' } },
    Quest: { Step: { Chunks: ['12343'], BaseQuest: 'Fixture quest', Output: 'Token' },
      Finish: { Tasks: { Step: 'Quest' }, BaseQuest: 'Fixture quest', QuestPoints: 1 } },
    Woodcutting: { Logs: { Level: 1, Objects: ['Tree'], Primary: true, Output: 'Logs' },
      Capability: { Level: 30, Chunks: ['12343'], Primary: true } } },
};
const options = { cacheWalking: false, retainedTaskCorrections: false };
const normalize = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
function fixture() {
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]);
  if (createRuleRegistry().get('content.f2p')) state.rules['content.f2p'] = false;
  if (createRuleRegistry().get('travel.automatic')) state.rules['travel.automatic'] = false;
  if (createRuleRegistry().get('access.transport')) state.rules['access.transport'] = false;
  for (const member of state.members) member.teleports = ['12341', '12342', '12343'].map(destination => ({
    id: `fixture:${destination}`, destination, available: true, consumable: false,
  }));
  for (const member of state.members) member.taskStatus = {};
  state.tasks = createTaskEngine(definitions, options).catalogue;
  return state;
}
const ids = [taskId('Extra', 'Ordinary'), taskId('Quest', 'Step'), taskId('Nonskill', 'Supply'), taskId('Woodcutting', 'Capability')];

test('personal completion opens quest prerequisites, supplies and passive capabilities; challenge ticks do not', () => {
  const state = fixture(), engine = createTaskEngine(definitions, options);
  const status = (result, category, name) => result.tasks.find(row => row.id === taskId(category, name)).status;
  const initial = engine.evaluate(state, 'one');
  assert.equal(status(initial, 'Quest', 'Finish'), 'blocked');
  assert.equal(status(initial, 'Extra', 'Consumer'), 'blocked');
  for (const id of ids) state.members[0].taskStatus[id] = { challengeCompleted: true };
  const ticked = engine.evaluate(state, 'one');
  assert.equal(ticked.metrics.eligibilityCacheHit, true);
  assert.equal(status(ticked, 'Quest', 'Finish'), 'blocked');
  assert.equal(status(ticked, 'Extra', 'Consumer'), 'blocked');
  state.members[0].completedTasks = ids.slice(1);
  const completed = engine.evaluate(state, 'one');
  assert.equal(status(completed, 'Quest', 'Finish'), 'available');
  assert.equal(status(completed, 'Extra', 'Consumer'), 'available');
  assert.equal(completed.training.Woodcutting.passiveLevel, 30);
});

for (const scope of ['any', 'all', 'personal']) test(`eligibility reuse equals cold results for both Group members (${scope})`, () => {
  const state = fixture(), engine = createTaskEngine(definitions, options);
  state.rules['tasks.completion'] = scope;
  const compare = expectedHit => {
    for (const member of state.members) {
      const actual = engine.evaluate(state, member.id);
      assert.equal(actual.metrics.eligibilityCacheHit, expectedHit);
      const cold = createTaskEngine(definitions, options).evaluate(state, member.id);
      assert.deepEqual(normalize(actual), normalize(cold));
      assert.deepEqual(actual.processing, cold.processing);
      assert.deepEqual(actual.tasks.map(row => row.processingPrimary), cold.tasks.map(row => row.processingPrimary));
      for (const key of Object.getOwnPropertyNames(cold.metrics).filter(key => key.startsWith('processing'))) {
        assert.deepEqual(Object.getOwnPropertyDescriptor(actual.metrics, key), Object.getOwnPropertyDescriptor(cold.metrics, key));
      }
    }
  };
  compare(false);
  for (const member of state.members) for (const id of ids) {
    member.taskStatus[id] = { challengeCompleted: true }; state.revision++; compare(true);
    member.taskStatus[id].challengeCompleted = false; state.revision++; compare(true);
    member.taskStatus[id] = { favorite: true, note: 'Plan', backlogReason: 'Later' }; compare(true);
    member.completedTasks.push(id); compare(false);
    member.completedTasks.pop(); compare(false);
    member.taskStatus[id].backlogged = true; compare(false);
    member.taskStatus[id].backlogged = false; compare(false);
  }
  for (const member of state.members) { member.unlocked.push('12343'); compare(false); }
});

test('independent partner ownership reuses eligibility while shared ownership invalidates it', () => {
  for (const shared of [false, true]) {
    const state = fixture(), engine = createTaskEngine(definitions, options);
    state.rules['access.shared'] = shared;
    const before = engine.evaluate(state, 'one');
    const consumer = result => result.tasks.find(row => row.id === taskId('Extra', 'Consumer')).status;
    assert.equal(consumer(before), 'blocked');
    state.members[1].unlocked.push('12343');
    const actual = engine.evaluate(state, 'one');
    assert.equal(actual.metrics.eligibilityCacheHit, !shared);
    assert.equal(consumer(actual), shared ? 'available' : 'blocked', 'Remote supply must follow the sharing boundary');
    assert.deepEqual(normalize(actual), normalize(createTaskEngine(definitions, options).evaluate(state, 'one')));
  }
});

test('cache owns its result graphs and notices in-place facts, aliases and query changes', () => {
  const state = fixture(), engine = createTaskEngine(definitions, options);
  const result = engine.evaluate(state, 'one');
  result.tasks[0].record.Polluted = true; result.items.push({ name: 'Polluted' }); result.processing.diagnostics.push({ polluted: true });
  const clean = engine.evaluate(state, 'one');
  assert.deepEqual(normalize(clean), normalize(createTaskEngine(definitions, options).evaluate(state, 'one')));
  state.members[0].completedTasks.push('legacy-completion');
  engine.evaluate(state, 'one');
  state.identityRegistry = { aliases: { 'legacy-completion': ids[1] }, entries: { [ids[1]]: {} } };
  assert.equal(engine.evaluate(state, 'one').metrics.eligibilityCacheHit, false);
  assert.equal(engine.evaluate(state, 'one', { ownItemQueries: ['Logs'] }).metrics.eligibilityCacheHit, false);
  state.members[0].obtainedEquipment = ['Fixture equipment'];
  assert.equal(engine.evaluate(state, 'one', { ownItemQueries: ['Logs'] }).metrics.eligibilityCacheHit, false);
});

test('transport-owned proofs bypass duplicate retention and remain cold-equivalent', () => {
  const state = fixture(), engine = createTaskEngine(definitions, options);
  for (let index = 0; index < 2; index++) {
    const actual = engine.evaluate(state, 'one', { reuseEligibility: false });
    assert.equal(actual.metrics.eligibilityCacheHit, false);
    assert.deepEqual(normalize(actual), normalize(createTaskEngine(definitions, options).evaluate(state, 'one')));
  }
});

test('warm worker completion overlays deep-equal fresh workers including both Group projections', async t => {
  const state = fixture(), world = buildWorld(definitions, options);
  const start = async () => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({
      definitions, datasetOptions: options, world: { chunks: world.chunks, surface: world.surface } }) });
    await once(worker, 'message'); return worker;
  };
  const warm = await start(); t.after(() => warm.terminate());
  let sequence = 0;
  const send = async (worker, memberId) => {
    const message = once(worker, 'message');
    worker.postMessage({ id: ++sequence, type: 'evaluate', state, memberId, input: `revision-${state.revision}`,
      resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true, duoSidebarProjection: true });
    const [response] = await message; assert.equal(response.error, undefined);
    return Object.fromEntries(['playJSON', 'duoJSON', 'duoSidebarJSON'].map(key => [key, normalize(JSON.parse(Buffer.from(response[key]).toString()))]));
  };
  const compare = async () => {
    const cold = await start();
    try { for (const member of state.members) assert.deepEqual(await send(warm, member.id), await send(cold, member.id)); }
    finally { await cold.terminate(); }
  };
  await compare();
  for (const [index, id] of ids.entries()) {
    state.members[index % 2].taskStatus[id] = { challengeCompleted: true }; state.revision++; await compare();
  }
  for (const member of state.members) {
    member.taskStatus[ids[0]] = { challengeCompleted: false, backlogged: true }; state.revision++; await compare();
    member.completedTasks.push(ids[1], ids[2], ids[3]); state.revision++; await compare();
    member.unlocked.push('12343'); state.revision++; await compare();
  }
});
