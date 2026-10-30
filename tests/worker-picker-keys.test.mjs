import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
const definitions = { challenges: { Extra: { Alpha: { Chunks: ['12850'] }, Beta: { Chunks: ['12851'] } } }, drops: {}, equipment: {}, codeItems: {}, chunks: { '12850': {}, '12851': {} }, walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'] };
function state(label = 'one') {
  const value = createGroupState([{ id: 'one', name: 'Explorer', unlocked: [label === 'beta' ? '12851' : '12850'] }]);
  value.tasks = [{ id: 'custom:picker-job', category: 'Custom', label }];
  return value;
}
function shared(value) {
  const bytes = Buffer.from(JSON.stringify(value)), result = new SharedArrayBuffer(bytes.length);
  Buffer.from(result).set(bytes); return result;
}
async function fixture(t) {
  const world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }),
  });
  t.after(() => worker.terminate());
  await once(worker, 'message');
  let sequence = 0;
  const pending = new Map();
  worker.on('message', message => {
    if (message.type === 'progress') return;
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  const send = message => new Promise(resolve => {
    const id = ++sequence; pending.set(id, resolve);
    worker.postMessage({ id, memberId: 'one', type: 'evaluate', input: 'collision', ...message });
  });
  return { worker, send };
}

test('superseding A preserves B in-flight and later work at colliding input, revision and member IDs', async t => {
  const { worker, send } = await fixture(t);
  const chunks = Array(4).fill('12851');
  const b = send({ pickerId: B, state: state('beta'), type: 'death-estimates', chunkIds: chunks });
  const a = send({ pickerId: A, state: state('alpha'), type: 'death-estimates', chunkIds: chunks });
  worker.postMessage({ type: 'supersede', pickerId: A, revision: 9 });
  assert.equal((await a).result.cancelled, true);
  const complete = (await b).result;
  assert.equal(complete.cancelled, false);
  assert.equal(complete.estimates.length, chunks.length);
  assert.equal((await send({ pickerId: B, state: state('beta'), type: 'death-estimates', chunkIds: chunks })).result.cancelled, false);
});

for (const transport of ['object', 'json-shared-v1']) test(`${transport} refs cannot resolve another picker's state`, async t => {
  const { send } = await fixture(t), value = state('alpha'), snapshotKey = JSON.stringify([0, 'collision']);
  const metadata = transport === 'object' ? {} : { stateTransport: transport, stateJSONBytes: shared(value).byteLength, stateRevision: 0, stateMemberIds: ['one'] };
  const body = transport === 'object' ? { state: value } : { stateJSON: shared(value) };
  const firstA = await send({ pickerId: A, snapshotKey, ...metadata, ...body });
  assert.equal(firstA.error, undefined);
  assert.equal((await send({ pickerId: B, snapshotKey, ...metadata })).error?.name, 'RangeError');
  const own = state('beta');
  const ownBody = transport === 'object' ? { state: own } : { stateJSON: shared(own), stateJSONBytes: shared(own).byteLength };
  const firstB = await send({ pickerId: B, snapshotKey, ...metadata, ...ownBody });
  assert.equal(firstB.error, undefined);
  assert.notDeepEqual(firstA.result, firstB.result);
  const b = await send({ pickerId: B, snapshotKey, ...metadata, ...(transport === 'object' ? {} : { stateJSONBytes: shared(own).byteLength }) });
  assert.equal(b.error, undefined);
  assert.deepEqual(b.result, firstB.result);
  const a = await send({ pickerId: A, snapshotKey, ...metadata });
  assert.deepEqual(a.result, firstA.result);
});

test('absent pickerId and legacy-shared use the same state namespace in both directions', async t => {
  const { send } = await fixture(t), snapshotKey = JSON.stringify([0, 'collision']);
  await send({ state: state(), snapshotKey });
  assert.equal((await send({ pickerId: 'legacy-shared', snapshotKey })).error, undefined);
  await send({ pickerId: 'legacy-shared', state: state(), snapshotKey });
  assert.equal((await send({ snapshotKey })).error, undefined);
});

test('absent pickerId supersedes only legacy-shared', async t => {
  const { worker, send } = await fixture(t), chunkIds = ['12851'];
  worker.postMessage({ type: 'supersede', revision: 9 });
  assert.equal((await send({ pickerId: 'legacy-shared', state: state(), type: 'death-estimates', chunkIds })).result.cancelled, true);
  assert.equal((await send({ pickerId: B, state: state(), type: 'death-estimates', chunkIds })).result.cancelled, false);
});

test('a cancel naming A cannot cancel B even when it names B request ID', async t => {
  const { worker, send } = await fixture(t);
  const b = send({ pickerId: B, state: state(), type: 'death-estimates', chunkIds: ['12851'] });
  worker.postMessage({ type: 'cancel', pickerId: A, id: 1 });
  assert.equal((await b).result.cancelled, false);
});
