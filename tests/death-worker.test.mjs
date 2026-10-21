import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { duoFixture } from './fixtures/partner.mjs';

async function workerFixture(t, data, world = buildWorld(data)) {
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions: data, world: { chunks: world.chunks, surface: world.surface } }),
  });
  t.after(() => worker.terminate());
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.on('message', message => {
      if (message.type === 'ready') { resolve(); return; }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message);
    });
  });
  const evaluate = (state, memberId, type = 'death-estimates', options = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, state, memberId, type, ...options });
  });
  evaluate.cancelLatest = () => worker.postMessage({ id: sequence, type: 'cancel' });
  return evaluate;
}

test('prediction uses the same own collection and equipment goals as normal worker evaluation', async t => {
  const duo = duoFixture();
  const evaluate = await workerFixture(t, duo.data, duo.world);
  const before = structuredClone(duo.state);
  const current = (await evaluate(duo.state, 'player1', 'evaluate')).result;
  assert.ok(!current.presentation.tasks.some(row => row.equipmentName === 'Partner sword'));
  assert.ok(!current.tasks.some(row => row.record?.Label === 'Kill X' && row.monster === 'Imp'));
  const prediction = (await evaluate(duo.state, 'player1', 'predict', { chunkId: '12851' })).result;
  assert.ok(prediction.delta.tasksAdded.some(row => row.equipmentName === 'Partner sword'));
  assert.ok(prediction.delta.tasksAdded.some(row => row.record?.Label === 'Kill X'));
  assert.ok(prediction.delta.tasksAdded.some(row => row.record?.Label === 'Every Drop'));
  const unlocked = structuredClone(duo.state);
  unlocked.revision++;
  unlocked.members[0].unlocked.push('12851');
  const after = (await evaluate(unlocked, 'player1', 'evaluate')).result;
  assert.ok(after.equipmentPlanning.obligationIds.includes(prediction.delta.tasksAdded.find(row => row.equipmentName === 'Partner sword').id));
  assert.deepEqual(duo.state, before, 'Prediction must leave ownership, checks and history unchanged');
});

test('hiding BiS tasks retains a rare own equipment death duty while BIS=false waives it', async t => {
  const data = { chunks: { '12850': {}, '12851': { Monster: { Giant: true } } },
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850'] } },
    walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'], challenges: {},
    drops: { Giant: { 'Rare helm': { '1': '1/100000' } } },
    equipment: { 'Rare helm': { slot: 'head', class: 'melee', melee_damage: 1, armour: 100, requirements: {} } } };
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12850'],
    taskRules: { 'Show Best in Slot Tasks': false, 'Rare Drop': true, BIS: true } }]);
  const before = structuredClone(state), evaluate = await workerFixture(t, data);
  const estimate = (await evaluate(state, 'player1', 'death-estimates', { chunkIds: ['12851'] })).result.estimates[0];
  const duty = estimate.breakdown.find(row => row.item === 'Rare helm');
  assert.ok(duty, 'A pure display setting must retain the obtain obligation');
  assert.ok(Math.abs(duty.hours - 100000 * 60 / 3600) < 1e-9);
  assert.equal(estimate.death, true);
  const owned = structuredClone(state); owned.revision++; owned.members[0].unlocked.push('12851');
  const full = (await evaluate(owned, 'player1', 'evaluate')).result;
  assert.ok(!full.presentation.tasks.some(row => row.equipmentName === 'Rare helm'));
  assert.equal(full.tasks.find(row => row.equipmentName === 'Rare helm').hidden, true);
  assert.equal(full.currentBiS.obtainable.recommendations.length, 0);
  const waived = structuredClone(state); waived.revision = 2; waived.members[0].taskRules.BIS = false;
  const waivedEstimate = (await evaluate(waived, 'player1', 'death-estimates', { chunkIds: ['12851'] })).result.estimates[0];
  assert.ok(!waivedEstimate.breakdown.some(row => row.item === 'Rare helm'));
  assert.equal(waivedEstimate.death, false);
  assert.deepEqual(state, before);
});

test('death worker reuses one baseline and cached estimates by revision and member', async t => {
  const duo = duoFixture();
  const evaluate = await workerFixture(t, duo.data, duo.world);
  const batch = (await evaluate(duo.state, 'player1', 'death-estimates', { chunkIds: ['12851', '12852'] })).result;
  assert.deepEqual(batch.estimates.map(row => row.chunkId), ['12851', '12852']);
  assert.equal(batch.cache.baselineEvaluations, 1);
  assert.equal(batch.cache.predictionEvaluations, 2);
  assert.equal(batch.cancelled, false);
  const repeat = (await evaluate(duo.state, 'player1', 'death-estimates', { chunkIds: ['12851', '12852'] })).result;
  assert.equal(repeat.cache.baselineEvaluations, 0);
  assert.equal(repeat.cache.predictionEvaluations, 0);
  assert.equal(repeat.cache.estimateHits, 2);
  assert.deepEqual(repeat.estimates, batch.estimates);
  const detail = (await evaluate(duo.state, 'player1', 'death-estimates', { chunkIds: ['12851'] })).result;
  assert.equal(detail.cache.estimateHits, 1);
  const partner = (await evaluate(duo.state, 'player2', 'death-estimates', { chunkIds: ['12850'] })).result;
  assert.equal(partner.cache.baselineEvaluations, 1);
  assert.equal(partner.estimates[0].memberId, 'player2');
  const changed = structuredClone(duo.state); changed.revision++;
  const revised = (await evaluate(changed, 'player1', 'death-estimates', { chunkIds: ['12851'] })).result;
  assert.equal(revised.cache.baselineEvaluations, 1);
  assert.equal(revised.cache.predictionEvaluations, 1);
  assert.equal(revised.estimates[0].stateRevision, changed.revision);
});

test('a newer snapshot interrupts the remaining old background candidates', async t => {
  const duo = duoFixture();
  const evaluate = await workerFixture(t, duo.data, duo.world);
  const oldBatch = evaluate(duo.state, 'player1', 'death-estimates', { chunkIds: Array(120).fill('12851') });
  const newer = structuredClone(duo.state); newer.revision++;
  const current = evaluate(newer, 'player1', 'evaluate');
  const [old, result] = await Promise.all([oldBatch, current]);
  assert.equal(old.result.cancelled, true);
  assert.ok(old.result.estimates.length < 120);
  assert.ok(result.result.presentation);
});

test('request cancellation stops remaining candidates without requiring a newer revision', async t => {
  const duo = duoFixture(), evaluate = await workerFixture(t, duo.data, duo.world);
  const batch = evaluate(duo.state, 'player1', 'death-estimates', { chunkIds: Array(120).fill('12851') });
  evaluate.cancelLatest();
  const cancelled = await batch;
  assert.equal(cancelled.result.cancelled, true);
  assert.ok(cancelled.result.estimates.length < 120);
  const current = await evaluate(duo.state, 'player1', 'evaluate');
  assert.ok(current.result.presentation);
});

async function serverFixture(t) {
  const directoryRoot = path.resolve('.local/death-verification/tmp');
  await mkdir(directoryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(directoryRoot, 'death-server-'));
  const data = {
    chunks: Object.fromEntries(['12850', '12851', '12852', '12853', '12854', '12855'].map(id => [id, {}])),
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850'] } },
    walkableChunks: ['12850', '12851', '12852', '12853', '12854', '12855'],
    walkableChunksF2P: ['12850', '12851', '12852', '12853', '12854', '12855'], challenges: {},
  };
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12850'], selected: ['12852', '12853', '999999'], pendingRoll: ['12854'], blacklisted: ['12853'] },
    { id: 'player2', name: 'Player 2' }]);
  state.rules['roll.selected'] = false;
  const application = await createServer({ dataDir: directory, definitions: data, taskMap: {}, initialState: state, port: 0 });
  await application.listen();
  t.after(async () => {
    await application.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${directoryRoot}${path.sep}`));
    await rm(resolved, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${application.address().port}`;
  const headers = { Authorization: `Bearer ${application.store.getAccessToken()}` };
  return { application, api: route => fetch(`${origin}${route}`, { headers }) };
}

test('HTTP background scope contains only the roll pool and valid selected chunks; details are on demand', async t => {
  const { application, api } = await serverFixture(t);
  const before = application.store.getState();
  const response = await api('/api/death-estimates?memberId=player1');
  assert.equal(response.status, 200);
  const batch = await response.json();
  assert.deepEqual(batch.candidateIds, ['12851', '12852']);
  assert.deepEqual(batch.estimates.map(row => row.chunkId), batch.candidateIds);
  assert.equal(batch.memberId, 'player1');
  assert.equal(batch.stateRevision, before.revision);
  assert.equal(batch.cache.worker, true);
  assert.equal(batch.cache.baselineEvaluations, 1);
  const repeat = await (await api('/api/death-estimates?memberId=player1')).json();
  assert.equal(repeat.cache.hit, true);
  const detail = await (await api('/api/death-estimates?memberId=player1&chunkId=12855')).json();
  assert.deepEqual(detail.candidateIds, ['12855']);
  assert.deepEqual(detail.estimates.map(row => row.chunkId), ['12855']);
  assert.equal(detail.cache.baselineHit, true);
  assert.deepEqual(application.store.getState(), before);
  for (const route of ['/death-chunks.mjs', '/death-settings.mjs', '/core/death-settings.mjs']) {
    assert.equal((await api(route)).status, 200, `Browser dependency ${route} is served`);
  }
});

test('death estimate HTTP inputs reject missing members and invalid surface chunks', async t => {
  const { api } = await serverFixture(t);
  for (const query of ['', '?memberId=unknown', '?memberId=player1&chunkId=', '?memberId=player1&chunkId=0', '?memberId=player1&chunkId=999999']) {
    assert.equal((await api(`/api/death-estimates${query}`)).status, 400, query);
  }
});
