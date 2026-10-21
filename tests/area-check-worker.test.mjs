import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';

// In-memory fixture only. This test imports no server/store and never touches
// the default .local/duo data directory or a captured gameplay save.
test('real worker handles compact area-check drafts, shared state transport, and invalid input', async t => {
  const definitions = { chunks: { '12850': { Object: { 'Test ore': true } }, '12851': {} },
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850'] } },
    walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
    challenges: { Mining: { 'Mine test ore': { Level: 1, Primary: true, Objects: ['Test ore'] } } } };
  const world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface }, skillGuideCatalogue: { skills: [], tasks: [] } }),
  });
  t.after(() => worker.terminate());
  const requests = new Map();
  await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.on('message', message => {
      if (message.type === 'ready') { resolve(); return; }
      const complete = requests.get(message.id);
      if (complete) { requests.delete(message.id); complete(message); }
    });
  });
  let id = 0;
  const send = options => new Promise(resolve => { requests.set(++id, resolve); worker.postMessage({ id, type: 'area-check', memberId: 'player1', ...options }); });
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12851'] }]), before = structuredClone(state);
  const response = await send({ state, chunkId: { chunkIds: ['12850'], asMembers: false } });
  assert.equal(response.result.format, 'area-check-v1');
  assert.equal(response.result.rows.find(row => row.skill === 'Mining').alone.lowest.level, 1);
  assert.ok(response.timingMs.areaCheckMs >= 0);
  const expectedTasks = { alone: { total: 0, categories: [] }, combined: { total: 0, categories: [] } };
  assert.deepEqual(response.result.tasks, expectedTasks);
  assert.ok(!response.result.items && !response.result.state);
  assert.deepEqual(state, before);
  const bytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(bytes.length);
  Buffer.from(stateJSON).set(bytes);
  const shared = await send({ stateTransport: 'json-shared-v1', stateJSON, stateJSONBytes: bytes.length,
    stateRevision: state.revision, stateMemberIds: ['player1'], input: 'fixture', snapshotKey: JSON.stringify([state.revision, 'fixture']),
    chunkId: { chunkIds: ['12850'], asMembers: true } });
  assert.equal(shared.result.asMembers, true);
  assert.equal(shared.result.stateRevision, state.revision);
  assert.deepEqual(shared.result.tasks, expectedTasks);
  assert.ok(!shared.result.items && !shared.result.state);
  assert.deepEqual(state, before);
  const invalid = await send({ state, chunkId: { chunkIds: ['999999'] } });
  assert.equal(invalid.error.name, 'RangeError');
  assert.match(invalid.error.message, /outside the known surface world/);
});
