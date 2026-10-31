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
import { STATE_SNAPSHOT_LIMIT } from '../app/tasks/state-transfer.mjs';

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
  const state = createGroupState([{ id: 'actor1', name: 'Player' }]);
  if (createRuleRegistry().get('content.f2p')) state.rules['content.f2p'] = false;
  state.members[0].unlocked = ['12341'];
  return {
    state, ready,
    async send(request) {
      const response = once(worker, 'message');
      worker.postMessage({ id: 1, state, memberId: 'actor1', ...request });
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


test('worker reports compilation and all evaluation stages without personal timing metadata', async t => {
  const { send } = await fixture(t);
  const response = await send({ type: 'evaluate' });
  assert.equal(response.error, undefined);
  assert.ok(response.result.tasks.some(task => task.label === 'Present quest'));
  checkTimings(response);
  for (const key of stageNames.filter(key => !['predictionMs', 'deathMs', 'totalMs'].includes(key))) assert.ok(response.timingMs[key] > 0, key);
  assert.equal(response.timingMs.predictionMs, 0);
  assert.equal(response.timingMs.deathMs, 0);
});

test('area checks reuse live baselines, include full ordinary goals and keep draft membership out of the cache', async t => {
  const { send } = await fixture(t);
  const baseline = await send({ type: 'evaluate' });
  const area = await send({ type: 'area-check', chunkId: { chunkIds: ['12342'], asMembers: true } });
  assert.equal(area.error, undefined);
  assert.equal(area.result.cache.baselineHit, true);
  assert.deepEqual(area.result.tasks.combined.categories.find(group => group.category === 'Quest').tasks.map(task => task.label), ['Future quest']);
  assert.ok(area.timingMs.collectionMs > 0, 'area scenarios use the ordinary collection pipeline');
  assert.ok(area.timingMs.equipmentMs > 0, 'area scenarios use the ordinary equipment pipeline');
  assert.equal(area.timingMs.currentBiSMs, 0);
  assert.equal(area.timingMs.activityMs, 0);
  const unchanged = await send({ type: 'evaluate' });
  assert.equal(unchanged.timingMs.engineMs, 0);
  assert.deepEqual(unchanged.result, baseline.result);
});

test('byte-budgeted calculation graphs and two transferred states evict older inputs without changing cold bytes', async t => {
  const previousBudget = process.env.RS3_CALCULATOR_CACHE_BYTES;
  let warm, cold;
  try {
    process.env.RS3_CALCULATOR_CACHE_BYTES = String(1024 * 1024);
    warm = await fixture(t); cold = await fixture(t);
  } finally {
    if (previousBudget === undefined) delete process.env.RS3_CALCULATOR_CACHE_BYTES;
    else process.env.RS3_CALCULATOR_CACHE_BYTES = previousBudget;
  }
  const saved = [];
  const bytes = value => JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child);
  for (let revision = 0; revision < 4; revision++) {
    warm.state.revision = revision;
    warm.state.members[0].unlocked = revision % 2 ? ['12341', '12342'] : ['12341'];
    const request = serializedRequest(warm.state, `revision-${revision}`);
    const result = await warm.send({ type: 'evaluate', ...request });
    assert.equal(result.error, undefined);
    saved.push({ request, bytes: Buffer.from(result.playJSON).toString() });
  }
  assert.equal(STATE_SNAPSHOT_LIMIT, 2);
  const previous = await warm.send({ type: 'evaluate', ...saved[2].request, stateJSON: undefined });
  assert.equal(previous.error, undefined);
  assert.equal(previous.timingMs.engineMs, 0, 'the second most recent calculation stays retained');
  const latest = await warm.send({ type: 'evaluate', ...saved[3].request, stateJSON: undefined });
  assert.equal(latest.error, undefined);
  assert.equal(latest.timingMs.engineMs, 0, 'current result stays retained');
  // Older parsed states are released; the scheduler's mirrored LRU resends them.
  const missing = await warm.send({ type: 'evaluate', ...saved[1].request, stateJSON: undefined });
  assert.equal(missing.error?.name, 'RangeError', 'the third most recent state was released');
  // Distinct inputs share a measured byte budget, independently of parsed-state
  // retention. Churn enough complete graphs to evict the original calculations.
  for (let revision = 4; revision < 44; revision++) {
    warm.state.revision = revision;
    const churned = await warm.send({ type: 'evaluate', ...serializedRequest(warm.state, `revision-${revision}`) });
    assert.equal(churned.error, undefined);
  }
  const third = await warm.send({ type: 'evaluate', ...saved[1].request });
  assert.equal(third.error, undefined);
  assert.ok(third.timingMs.collectionMs > 0, 'byte pressure evicted the older calculation');
  const oldest = await warm.send({ type: 'evaluate', ...saved[0].request });
  assert.equal(oldest.error, undefined);
  assert.ok(oldest.timingMs.collectionMs > 0, 'the evicted full calculation is rebuilt');
  const fresh = await cold.send({ type: 'evaluate', ...saved[0].request });
  assert.equal(fresh.error, undefined);
  const decoded = message => JSON.parse(Buffer.from(message.playJSON).toString());
  assert.equal(bytes(decoded(oldest)), bytes(decoded(fresh)), 'rebuilt complete play projection matches cold');
  assert.equal(bytes(decoded(oldest)), bytes(JSON.parse(saved[0].bytes)), 'eviction preserves the original response');
});

test('predictions reuse the baseline and time full hypothetical obligations without mutating state', async t => {
  const { state, send } = await fixture(t);
  const before = structuredClone(state);
  const baseline = await send({ type: 'evaluate' });
  assert.equal(baseline.error, undefined);
  const response = await send({ type: 'predict', chunkId: '12342' });
  assert.equal(response.error, undefined);
  assert.ok(response.result.delta.tasksAdded.some(task => task.label === 'Future quest'));
  checkTimings(response);
  assert.ok(response.timingMs.engineMs > 0);
  assert.ok(response.timingMs.collectionMs > 0);
  assert.ok(response.timingMs.predictionMs >= response.timingMs.engineMs + response.timingMs.collectionMs
    + response.timingMs.equipmentMs + response.timingMs.presentationMs);
  assert.ok(response.timingMs.equipmentMs > 0);
  assert.equal(response.timingMs.currentBiSMs, 0, 'Cached baseline views are not recalculated for a hypothetical result');
  assert.equal(response.timingMs.activityMs, 0);
  assert.equal(response.timingMs.deathMs, 0);
  assert.deepEqual(state, before);
});

test('death batches time predictions and estimates, and cached duties skip recalculation', async t => {
  const { send } = await fixture(t);
  const cold = await send({ type: 'death-estimates', chunkIds: ['12342'] });
  assert.equal(cold.error, undefined);
  checkTimings(cold);
  assert.ok(cold.timingMs.engineMs > 0);
  assert.ok(cold.timingMs.predictionMs > 0);
  assert.ok(cold.timingMs.deathMs > 0);
  assert.equal(cold.timingMs.currentBiSMs, 0);
  assert.equal(cold.timingMs.activityMs, 0);
  assert.equal(cold.result.cache.baselineEvaluations, 1);
  const warm = await send({ type: 'death-estimates', chunkIds: ['12342'] });
  checkTimings(warm);
  assert.equal(warm.result.cache.estimateHits, 1);
  for (const key of stageNames.filter(key => key !== 'totalMs')) assert.equal(warm.timingMs[key], 0, key);
});

test('cold advisory baselines omit panel work and later full evaluation upgrades without changing results', async t => {
  const { send } = await fixture(t), fresh = await fixture(t);
  const cold = await send({ type: 'predict', chunkId: '12342' });
  checkTimings(cold);
  assert.equal(cold.timingMs.currentBiSMs, 0);
  assert.equal(cold.timingMs.activityMs, 0);
  const upgraded = await send({ type: 'evaluate' });
  assert.equal(upgraded.timingMs.engineMs, 0);
  assert.equal(upgraded.timingMs.collectionMs, 0);
  assert.equal(upgraded.timingMs.equipmentMs, 0);
  assert.equal(upgraded.timingMs.presentationMs, 0);
  assert.ok(upgraded.timingMs.currentBiSMs > 0);
  assert.ok(upgraded.timingMs.activityMs > 0);
  assert.ok(upgraded.result.currentBiS);
  assert.ok(upgraded.result.activityInfo);
  const normalize = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
  assert.deepEqual(normalize(upgraded.result), normalize((await fresh.send({ type: 'evaluate' })).result));
  const cached = await send({ type: 'evaluate' });
  assert.deepEqual(cached.result, upgraded.result);
  for (const key of stageNames.filter(key => key !== 'totalMs')) assert.equal(cached.timingMs[key], 0, key);
  assert.deepEqual(normalize((await send({ type: 'predict', chunkId: '12342' })).result), normalize(cold.result));
});

test('upgrading an advisory baseline preserves cached death estimates and full baseline reuse', async t => {
  const { send } = await fixture(t);
  const cold = await send({ type: 'death-estimates', chunkIds: ['12342'] });
  const full = await send({ type: 'evaluate' });
  assert.ok(full.result.currentBiS);
  assert.ok(full.result.activityInfo);
  assert.ok(full.timingMs.currentBiSMs > 0);
  const warm = await send({ type: 'death-estimates', chunkIds: ['12342'] });
  assert.equal(warm.result.cache.baselineHit, true);
  assert.equal(warm.result.cache.baselineEvaluations, 0);
  assert.equal(warm.result.cache.estimateHits, 1);
  assert.deepEqual(warm.result.estimates, cold.result.estimates);
  for (const key of stageNames.filter(key => key !== 'totalMs')) assert.equal(warm.timingMs[key], 0, key);
});

test('display-only revisions rebind the retained input snapshot, baseline and estimates while changed inputs rebuild', async t => {
  const { state, send } = await fixture(t, definitions, true);
  const display = revision => ({ ...state, revision, members: state.members.map(member => ({ ...member, notes: { '12341': `display ${revision}` } })) });
  const first = await send({ type: 'evaluate', ...serializedRequest(state, 'gameplay') });
  assert.equal(first.error, undefined); assert.ok(first.timingMs.engineMs > 0);
  const reference = await send({ type: 'evaluate', ...serializedRequest(display(1), 'gameplay'), stateJSON: undefined });
  assert.equal(reference.error, undefined); assert.equal(reference.stateParses, 1, 'the display-only state is not resent');
  assert.equal(reference.timingMs.engineMs, 0);
  assert.equal(Buffer.from(reference.playJSON).toString(), Buffer.from(first.playJSON).toString());
  const sandbox = await send({ type: 'sandbox', ...serializedRequest(display(2), 'gameplay'), stateJSON: undefined,
    chunkId: { changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } } });
  assert.equal(sandbox.error, undefined); assert.equal(sandbox.stateParses, 1); assert.equal(sandbox.resultCache.baselineHit, true);
  const sandboxResult = JSON.parse(Buffer.from(sandbox.sandboxJSON).toString());
  assert.equal(sandboxResult.stateRevision, 2); assert.equal(sandboxResult.result.stateRevision, 2);
  const cold = await send({ type: 'death-estimates', state: display(3), input: 'gameplay', chunkIds: ['12342'] });
  assert.equal(cold.result.cache.baselineHit, true); assert.equal(cold.result.cache.estimatedCount, 1);
  const warm = await send({ type: 'death-estimates', state: display(4), input: 'gameplay', chunkIds: ['12342'] });
  assert.equal(warm.result.cache.estimateHits, 1); assert.equal(warm.result.cancelled, false);
  assert.equal(warm.result.stateRevision, 4); assert.equal(warm.result.estimates[0].stateRevision, 4);
  const changed = { ...display(5), members: state.members.map(member => ({ ...member, unlocked: ['12341', '12342'] })) };
  const rebuilt = await send({ type: 'evaluate', ...serializedRequest(changed, 'changed') });
  assert.equal(rebuilt.error, undefined); assert.equal(rebuilt.stateParses, warm.stateParses + 1);
  assert.ok(rebuilt.timingMs.engineMs > 0);
  assert.notEqual(Buffer.from(rebuilt.playJSON).toString(), Buffer.from(first.playJSON).toString());
});

test('failed calculations retain stage durations without returning state in timings', async t => {
  const { send } = await fixture(t);
  const response = await send({ type: 'evaluate', memberId: 'missing' });
  assert.ok(response.error);
  checkTimings(response);
  assert.ok(response.timingMs.engineMs > 0);
  assert.equal(response.timingMs.collectionMs, 0);
});

test('evaluate shared JSON transport preserves full results and direct worker compatibility', async t => {
  const { send } = await fixture(t);
  const baseline = await send({ type: 'evaluate' });
  const transported = await send({ type: 'evaluate', resultTransport: 'json-shared-v1' });
  assert.equal(transported.error, undefined);
  assert.equal(transported.result, undefined);
  assert.ok(transported.resultJSON instanceof SharedArrayBuffer);
  assert.ok(transported.playJSON instanceof SharedArrayBuffer);
  assert.equal(transported.cancelled, false);
  assert.deepEqual(JSON.parse(Buffer.from(transported.resultJSON).toString('utf8')), JSON.parse(JSON.stringify(baseline.result)));
  const projected = JSON.parse(Buffer.from(transported.playJSON).toString('utf8'));
  const expectedPlay = { ...projectPlayResult(baseline.result), taskLocations: projectMapTaskLocations(definitions, baseline.result, buildWorld(definitions)) };
  assert.deepEqual(projected, JSON.parse(JSON.stringify(expectedPlay)));
  const presentQuest = baseline.result.presentation.tasks.find(task => task.label === 'Present quest');
  assert.deepEqual(projected.taskLocations[presentQuest.id], ['12341']);
  checkTimings(transported);
  const prediction = await send({ type: 'predict', chunkId: '12342', resultTransport: 'json-shared-v1' });
  assert.ok(prediction.result.delta);
  assert.equal(prediction.resultJSON, undefined);
});

test('compact foreground transport sends only play bytes and full upgrades reuse the core', async t => {
  const { send } = await fixture(t), fresh = await fixture(t);
  const compact = await send({ type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1' });
  assert.equal(compact.resultJSON, undefined);
  assert.equal(compact.result, undefined);
  assert.ok(compact.playJSON instanceof SharedArrayBuffer);
  assert.equal(compact.timingMs.currentBiSMs, 0);
  assert.equal(compact.timingMs.activityMs, 0);
  const play = JSON.parse(Buffer.from(compact.playJSON).toString('utf8'));
  assert.equal(play.format, 'play-v1');
  const full = await send({ type: 'evaluate', resultTransport: 'json-shared-v1' });
  for (const stage of ['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs']) assert.equal(full.timingMs[stage], 0, stage);
  assert.ok(full.timingMs.currentBiSMs > 0);
  assert.ok(full.timingMs.activityMs > 0);
  const normalize = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
  const complete = JSON.parse(Buffer.from(full.resultJSON).toString('utf8'));
  assert.deepEqual(normalize(complete), normalize((await fresh.send({ type: 'evaluate' })).result));
  const again = await send({ type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1' });
  assert.deepEqual(JSON.parse(Buffer.from(again.playJSON).toString('utf8')), play);
  for (const stage of stageNames.filter(stage => stage !== 'totalMs')) assert.equal(again.timingMs[stage], 0, stage);
  const direct = await send({ type: 'evaluate', resultView: 'play-v1' });
  assert.ok(direct.result.currentBiS);
  assert.ok(direct.result.activityInfo);
  assert.equal(direct.result.taskLocations, undefined, 'direct worker clients keep the full result contract');
});

test('chunk planning retains full-index association evidence without loading full views', async t => {
  const { state, send } = await fixture(t);
  const planning = await send({ type: 'chunk-planning', chunkId: '12341' });
  assert.equal(planning.result.format, 'chunk-planning-v1');
  assert.equal(planning.result.chunkId, '12341');
  assert.equal(planning.resultJSON, undefined);
  assert.equal(planning.timingMs.currentBiSMs, 0);
  assert.equal(planning.timingMs.activityMs, 0);
  const full = await send({ type: 'evaluate' });
  assert.equal(full.timingMs.engineMs, 0);
  const index = buildChunkPlanningIndex(definitions, full.result, buildWorld(definitions));
  const expected = [...index.byLocation.get('12341').values()].map(({ task, evidence }) => ({ task: projectPlayTask(task, { retainHiddenDisplay: true }), evidence }));
  assert.deepEqual(planning.result.rows, expected);
  assert.deepEqual(planning.result.clueLocations, index.clueLocations.get('12341') ?? []);
  assert.deepEqual(planning.result.access, full.result.access);
  const repeat = await send({ type: 'chunk-planning', chunkId: '12341' });
  assert.deepEqual(repeat.result, planning.result);
  for (const stage of stageNames.filter(stage => stage !== 'totalMs')) assert.equal(repeat.timingMs[stage], 0, stage);
  assert.equal(state.revision, 0);
});

test('focused chunk planning preserves source evidence, aliases, clue markers and hidden row display', async t => {
  const data = { chunks: { '12341': { Monster: { Goblin: true }, Connect: { Cave: true } }, '12342': { Name: 'Cave' }, Cave: { Connect: { '12341': true } } },
    walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
    clues: { Easy: { '12341': true, Cave: true } },
    challenges: { Quest: { 'Goblin source': { Monsters: ['Goblin'] }, 'Hidden clue': { Chunks: ['Cave'], ClueTier: 'Easy' } } } };
  const { state, send } = await fixture(t, data);
  state.members[0].taskRules = { Quests: false };
  const before = structuredClone(state);
  await send({ type: 'evaluate', resultTransport: 'json-shared-v1', resultView: 'play-v1' });
  const full = (await send({ type: 'evaluate' })).result;
  const index = buildChunkPlanningIndex(data, full, buildWorld(data));
  for (const chunkId of ['12341', '12342', 'Cave']) {
    const focused = await send({ type: 'chunk-planning', chunkId });
    const expected = [...(index.byLocation.get(chunkId)?.values() ?? [])].map(({ task, evidence }) => ({
      task: { ...projectPlayTask(task, { retainHiddenDisplay: true }), ...(task.record?.ClueTier !== undefined ? { record: { ClueTier: task.record.ClueTier } } : {}) }, evidence }));
    assert.deepEqual(focused.result.rows, expected, chunkId);
    assert.deepEqual(focused.result.clueLocations, index.clueLocations.get(chunkId) ?? [], chunkId);
    for (const row of focused.result.rows) { assert.equal(row.task.hidden, true); assert.ok(row.task.rawLabel); }
    if (chunkId === '12341') assert.ok(focused.result.rows.some(row => row.evidence.some(evidence => evidence.reason.includes('monster'))));
    if (chunkId === 'Cave') assert.ok(focused.result.rows.some(row => row.task.record?.ClueTier === 'Easy'));
  }
  assert.deepEqual(state, before);
});

test('serialized foreground state parses once per bounded key and full/planning reuse the captured state', async t => {
  const { state, send } = await fixture(t, definitions, true);
  const input = serializedRequest(state), before = structuredClone(state);
  const compact = await send({ ...input, type: 'evaluate' });
  assert.equal(compact.error, undefined);
  assert.equal(compact.stateParses, 1);
  Buffer.from(input.stateJSON).fill(120);
  const full = await send({ ...input, stateJSON: undefined, type: 'evaluate', resultView: 'full' });
  assert.equal(full.error, undefined);
  assert.equal(full.stateParses, 1);
  assert.equal(full.timingMs.engineMs, 0);
  assert.ok(JSON.parse(Buffer.from(full.resultJSON).toString('utf8')).currentBiS);
  const planning = await send({ ...input, stateJSON: undefined, type: 'chunk-planning', chunkId: '12341' });
  assert.equal(planning.error, undefined);
  assert.equal(planning.stateParses, 1);
  assert.ok(planning.result.rows.some(row => row.task.label === 'Present quest'));
  for (const key of ['two', 'three', 'four', 'five']) assert.equal((await send({ ...serializedRequest(state, key), type: 'evaluate' })).error, undefined);
  const evicted = await send({ ...input, stateJSON: undefined, type: 'evaluate' });
  assert.equal(evicted.error.name, 'RangeError');
  assert.match(evicted.error.message, /state snapshot is missing/);
  assert.equal(evicted.result, undefined);
  const recovered = await send({ ...serializedRequest(state), type: 'evaluate' });
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.stateParses, 6);
  assert.deepEqual(state, before);
});

test('serialized input validation rejects mismatched metadata and malformed bytes without exposing payloads', async t => {
  const { state, send } = await fixture(t);
  const input = serializedRequest(state), privateText = 'SyntheticPrivatePayloadDoNotEcho';
  const malformed = stateBytes(`{"private":"${privateText}",`);
  const invalidUtf8 = new SharedArrayBuffer(1); new Uint8Array(invalidUtf8)[0] = 255;
  const wrongRevision = stateBytes(JSON.stringify({ ...state, revision: 1 }));
  for (const overrides of [
    { stateTransport: 'unknown' }, { stateJSON: new ArrayBuffer(input.stateJSONBytes) },
    { stateJSONBytes: input.stateJSONBytes + 1 }, { snapshotKey: privateText },
    { stateJSON: malformed, stateJSONBytes: malformed.byteLength }, { stateJSON: invalidUtf8, stateJSONBytes: 1 },
    { stateJSON: wrongRevision, stateJSONBytes: wrongRevision.byteLength }, { stateMemberIds: [privateText] },
    { stateMemberIds: [] }, { stateMemberIds: ['actor1', 'actor1'] },
  ]) {
    const failed = await send({ ...input, type: 'evaluate', ...overrides });
    assert.equal(failed.error.name, 'TypeError');
    assert.ok(!failed.error.message.includes(privateText));
    assert.equal(failed.result, undefined);
    assert.equal(failed.resultJSON, undefined);
  }
  assert.equal((await send({ ...input, type: 'evaluate' })).error, undefined);
  const reference = await send({ ...input, stateJSON: undefined, stateJSONBytes: input.stateJSONBytes + 1, type: 'evaluate' });
  assert.equal(reference.error.name, 'TypeError');
});

test('native worker preserves object to serialized to object snapshot compatibility', async t => {
  const { state, send } = await fixture(t, definitions, true);
  const input = serializedRequest(state);
  const object = await send({ type: 'evaluate', snapshotKey: input.snapshotKey, input: input.input });
  assert.equal(object.error, undefined); assert.equal(object.stateParses, 0);
  const serialized = await send({ ...input, type: 'evaluate' });
  assert.equal(serialized.error, undefined); assert.equal(serialized.stateParses, 1);
  const reference = await send({ type: 'evaluate', state: undefined, snapshotKey: input.snapshotKey, input: input.input });
  assert.equal(reference.error, undefined); assert.equal(reference.stateParses, 1);
  assert.deepEqual(reference.result, object.result);
  const repeated = await send({ ...input, stateJSON: undefined, type: 'evaluate' });
  assert.equal(repeated.error, undefined); assert.equal(repeated.stateParses, 1);
});


test('native peer projection sends thin bytes beside the unchanged compact member view without parsing state twice', async t => {
  const { state, send } = await fixture(t, definitions, true), input = serializedRequest(state), before = structuredClone(state);
  const peer = await send({ ...input, type: 'evaluate', duoProjection: true });
  assert.equal(peer.error, undefined); assert.equal(peer.stateParses, 1);
  assert.ok(peer.playJSON instanceof SharedArrayBuffer); assert.ok(peer.duoJSON instanceof SharedArrayBuffer);
  assert.equal(peer.resultJSON, undefined); assert.equal(peer.timingMs.currentBiSMs, 0); assert.equal(peer.timingMs.activityMs, 0);
  const ordinary = JSON.parse(Buffer.from(peer.playJSON).toString('utf8')), thin = JSON.parse(Buffer.from(peer.duoJSON).toString('utf8'));
  const factRules = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
  assert.deepEqual(thin, projectDuoSidebarResult(ordinary, state, factRules, 'actor1')); assert.ok(thin.tasks.length < ordinary.tasks.length);
  const selected = await send({ ...input, stateJSON: undefined, type: 'evaluate' });
  assert.equal(selected.stateParses, 1); assert.equal(selected.duoJSON, undefined);
  assert.deepEqual(JSON.parse(Buffer.from(selected.playJSON).toString('utf8')), ordinary); assert.deepEqual(state, before);
});

test('native foreground sidebar projection preserves normal bytes and personal disclosures only when requested', async t => {
  const data = { ...definitions, challenges: { Quest: { ...definitions.challenges.Quest,
    'Unused future quest': { Chunks: ['12342'] } } } };
  const { state, ready, send } = await fixture(t, data, true);
  const future = ready.catalogue.find(row => row.label === 'Future quest');
  state.members[0].taskStatus = { [future.id]: { challengeCompleted: true, backlogged: true } };
  const input = serializedRequest(state), before = structuredClone(state);
  const sidebar = await send({ ...input, type: 'evaluate', duoSidebarProjection: true });
  assert.equal(sidebar.error, undefined); assert.equal(sidebar.stateParses, 1);
  assert.ok(sidebar.playJSON instanceof SharedArrayBuffer); assert.ok(sidebar.duoSidebarJSON instanceof SharedArrayBuffer);
  assert.equal(sidebar.resultJSON, undefined); assert.equal(sidebar.duoJSON, undefined);
  assert.equal(sidebar.timingMs.currentBiSMs, 0); assert.equal(sidebar.timingMs.activityMs, 0);
  const ordinary = JSON.parse(Buffer.from(sidebar.playJSON).toString('utf8'));
  const thin = JSON.parse(Buffer.from(sidebar.duoSidebarJSON).toString('utf8'));
  const factRules = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
  assert.deepEqual(thin, projectDuoSidebarResult(ordinary, state, factRules, 'actor1'));
  assert.equal(thin.projection, 'duo-sidebar-v1'); assert.ok(thin.tasks.some(row => row.id === future.id));
  assert.ok(thin.tasks.length < ordinary.tasks.length);
  const selected = await send({ ...input, stateJSON: undefined, type: 'evaluate' });
  assert.equal(selected.stateParses, 1); assert.equal(selected.duoSidebarJSON, undefined);
  assert.deepEqual(Buffer.from(selected.playJSON), Buffer.from(sidebar.playJSON));
  const peer = await send({ ...input, stateJSON: undefined, type: 'evaluate', duoProjection: true });
  assert.equal(peer.duoSidebarJSON, undefined); assert.ok(peer.duoJSON instanceof SharedArrayBuffer);
  assert.deepEqual(JSON.parse(Buffer.from(peer.duoJSON).toString('utf8')), thin);
  assert.deepEqual(state, before);
});
