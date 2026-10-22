import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { projectPlayResult, projectPlayTask } from '../app/play-view.mjs';
import { projectDuoSidebarResult } from '../app/duo-play-view.mjs';
import { buildChunkPlanningIndex } from '../app/tasks/chunk-planning-index.mjs';
import { projectMapTaskLocations } from '../app/tasks/map-task-locations.mjs';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from '../app/data/skill-guides.mjs';

const definitions = {
  chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Quest: { 'Present quest': { Chunks: ['12341'] }, 'Future quest': { Chunks: ['12342'] } } },
};
const stageNames = ['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs', 'currentBiSMs', 'activityMs', 'predictionMs', 'deathMs', 'totalMs'];

async function fixture(t, sourceDefinitions = definitions, trackStateParses = false) {
  const world = buildWorld(sourceDefinitions);
  const workerUrl = new URL('../app/tasks/worker.mjs', import.meta.url);
  const instrumented = `
    import { parentPort } from 'node:worker_threads';
    let stateParses = 0;
    const parse = JSON.parse;
    JSON.parse = (...args) => { const value = parse(...args); if (value?.schemaVersion === 1 && Array.isArray(value.members) && Array.isArray(value.tasks)) stateParses++; return value; };
    const post = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = (message, ...args) => post({ ...message, stateParses }, ...args);
    await import(${JSON.stringify(workerUrl.href)});
  `;
  const worker = new Worker(trackStateParses ? new URL(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`) : workerUrl, {
    workerData: genericWorkerData({ definitions: sourceDefinitions, world: { chunks: world.chunks, surface: world.surface } }),
  });
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.type, 'ready');
  assert.ok(Number.isFinite(ready.compileMs) && ready.compileMs >= 0);
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }]);
  if (createRuleRegistry().get('content.f2p')) state.rules['content.f2p'] = false;
  state.members[0].unlocked = ['12341'];
  return {
    state, ready,
    async send(request) {
      const response = once(worker, 'message');
      worker.postMessage({ id: 1, state, memberId: 'player1', ...request });
      return (await response)[0];
    },
  };
}
function stateBytes(text) {
  const bytes = Buffer.from(text), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes);
  return shared;
}
function serializedRequest(state, input = 'captured') {
  const stateJSON = stateBytes(JSON.stringify(state));
  return { state: undefined, input, snapshotKey: JSON.stringify([state.revision, input]), stateTransport: 'json-shared-v1',
    stateJSON, stateJSONBytes: stateJSON.byteLength, stateRevision: state.revision, stateMemberIds: state.members.map(member => member.id),
    resultTransport: 'json-shared-v1', resultView: 'play-v1' };
}

function checkTimings(message) {
  assert.deepEqual(Object.keys(message.timingMs), stageNames);
  for (const value of Object.values(message.timingMs)) {
    assert.equal(typeof value, 'number');
    assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(value <= message.evaluationMs);
  }
  assert.equal(message.timingMs.totalMs, message.evaluationMs);
}

test('native rule preparation leaves evaluation and advisory baselines untouched', async t => {
  const prepared = await fixture(t), fresh = await fixture(t);
  const rules = { ...prepared.state.rules, [SKILL_GUIDE_TASKS_RULE]: true, [SKILL_GUIDE_CORRECTIONS_RULE]: true };
  prepared.state.rules = { ...rules }; fresh.state.rules = { ...rules };
  const before = structuredClone(prepared.state), catalogue = structuredClone(prepared.ready.catalogue);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await prepared.send({ type: 'prepare-rules', state: { revision: prepared.state.revision, rules }, memberId: undefined });
    assert.equal(response.error, undefined);
    assert.deepEqual(response.result, { prepared: true });
    assert.ok(Number.isFinite(response.timingMs.preparationMs) && response.timingMs.preparationMs > 0);
    assert.ok(response.evaluationMs >= response.timingMs.preparationMs);
    assert.equal(response.timingMs.totalMs, response.evaluationMs);
    for (const stage of stageNames.filter(stage => stage !== 'totalMs')) assert.equal(response.timingMs[stage], 0, stage);
  }
  assert.deepEqual(prepared.state, before);
  assert.deepEqual(prepared.ready.catalogue, catalogue);
  assert.deepEqual(prepared.ready.catalogue, fresh.ready.catalogue);
  const advisory = await prepared.send({ type: 'death-estimates', chunkIds: ['12342'] });
  assert.equal(advisory.result.cache.baselineEvaluations, 1);
  assert.equal(advisory.result.cache.baselineHit, false);
  assert.equal(advisory.result.cache.estimateHits, 0);
  const freshAdvisory = await fresh.send({ type: 'death-estimates', chunkIds: ['12342'] });
  const normalize = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
  assert.deepEqual(normalize(advisory.result), normalize(freshAdvisory.result));
  const full = await prepared.send({ type: 'evaluate' }), freshFull = await fresh.send({ type: 'evaluate' });
  assert.deepEqual(normalize(full.result), normalize(freshFull.result));
  checkTimings(full);
});

test('death estimates keep the input baseline but recalculate when display-only death settings change', async t => {
  const { state, send } = await fixture(t);
  const at = (revision, preferences = {}) => ({ ...state, revision, members: state.members.map(member => ({ ...member, preferences })) });
  const first = await send({ type: 'death-estimates', state: at(0), input: 'gameplay', chunkIds: ['12342'] });
  assert.equal(first.error, undefined); assert.equal(first.result.cache.estimatedCount, 1);
  const slower = await send({ type: 'death-estimates', state: at(1, { defaultSecondsPerKill: 120 }), input: 'gameplay', chunkIds: ['12342'] });
  assert.equal(slower.result.cache.baselineHit, true);
  assert.equal(slower.result.cache.estimatedCount, 1, 'changed death settings are never served from the old estimate');
  assert.equal(slower.result.estimates[0].stateRevision, 1);
  const repeat = await send({ type: 'death-estimates', state: at(2, { defaultSecondsPerKill: 120 }), input: 'gameplay', chunkIds: ['12342'] });
  assert.equal(repeat.result.cache.estimateHits, 1); assert.equal(repeat.result.estimates[0].stateRevision, 2);
});