import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

// Keep twelve fixture cells inside the active crop. The private reference keeps
// its original IDs; the independent crop lays out the same fixture by column.
const ids = Array.from({ length: 12 }, (_, index) => String(selectedDataset.capabilities.independent
  ? SURFACE_GRID.startId + Math.floor(index / SURFACE_GRID.rows) * SURFACE_GRID.stride - index % SURFACE_GRID.rows
  : 12850 + index));
const definitions = { chunks: Object.fromEntries(ids.map(id => [id, { Nickname: `Place ${id}` }])),
  walkableChunks: ids, walkableChunksF2P: ids,
  challenges: { Mining: Object.fromEntries(ids.map(id => [`Mine at ${id}`, { Chunks: [id] }])) } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(operation, predicate) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { const value = await operation(); if (predicate(value)) return value; await delay(20); }
  assert.fail('Pool comparison did not settle');
}
async function fixture(t, extra = {}) {
  const base = path.resolve('.local/pool-ranking-tests'); await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'fixture-'));
  assert.ok(path.resolve(dataDir).startsWith(base + path.sep), 'Test cleanup stays inside its fixture directory');
  const initialState = createGroupState([{ id: 'reed', name: 'Reed', unlocked: [ids[0]], selected: ids.slice(1) }]);
  const app = await createServer({ dataDir, port: 0, definitions, taskMap: {}, initialState, predictionPrewarm: false, ...extra });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen(); const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const request = (route, body, auth = headers) => fetch(origin + route, { headers: body === undefined ? auth
    : { ...auth, Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const get = async route => { const response = await request(route); assert.equal(response.status, 200); return response.json(); };
  const intent = (visible, watchId = 'test', revision = 0) => request('/api/pool-ranking-intent', { memberId: 'reed', revision, watchId, visible });
  return { app, get, request, intent, origin, headers };
}
test('pool reads do no worker work; visible comparison checks every chunk and reuses saved rows', async t => {
  const f = await fixture(t);
  const before = await f.get('/api/diagnostics');
  const pending = await f.get('/api/pool-ranking?memberId=reed');
  assert.ok(pending.total > 8); assert.equal(pending.checked, 0);
  assert.ok(pending.rows.every(row => row.status === 'estimated' && row.count === null));
  assert.deepEqual((await f.get('/api/diagnostics')).predictionLane, before.predictionLane);
  await f.get('/api/tasks?memberId=reed&view=play-v1');
  assert.equal((await f.intent(true)).status, 200);
  const checked = await until(() => f.get('/api/pool-ranking?memberId=reed'), value => value.checked === value.total);
  assert.equal(checked.total, pending.total); assert.equal(checked.rows.length, pending.total);
  assert.ok(checked.rows.every(row => Number.isSafeInteger(row.count)));
  assert.equal((await f.intent(false)).status, 200);
  const diag = await f.get('/api/diagnostics');
  assert.equal(diag.poolRanking.watchers, 0); assert.equal(diag.predictionLane.ranking.pending, 0);
  assert.deepEqual((await f.get('/api/pool-ranking?memberId=reed')).rows, checked.rows);
  assert.deepEqual((await f.get('/api/diagnostics')).predictionLane, diag.predictionLane);
  assert.equal((await f.request('/pool-ranking.mjs')).status, 200);
  const saved = await f.request('/api/command?view=play-v1', { expectedRevision: 0,
    command: { type: 'set-note', memberId: 'reed', chunkId: ids[0], note: 'Display-only edit' } });
  assert.equal(saved.status, 200); await saved.arrayBuffer();
  const restamped = await f.get('/api/pool-ranking?memberId=reed');
  assert.equal(restamped.stateRevision, 1);
  assert.deepEqual(restamped.rows, checked.rows, 'Display-only reuse keeps exact counts under the current revision');
  assert.deepEqual((await f.get('/api/diagnostics')).predictionLane, diag.predictionLane);
});
test('viewers can see saved ranking but cannot start work, and invalid/stale intents are rejected', async t => {
  const f = await fixture(t);
  const createdResponse = await f.request('/api/invites', { label: 'Watcher', viewer: true });
  assert.equal(createdResponse.status, 201); const created = await createdResponse.json();
  const joined = await fetch(created.link, { redirect: 'manual' });
  const viewer = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  const before = await f.get('/api/diagnostics');
  assert.equal((await f.request('/api/pool-ranking?memberId=reed', undefined, viewer)).status, 200);
  assert.equal((await f.request('/api/pool-ranking-intent', { memberId: 'reed', revision: 0, watchId: 'viewer', visible: true }, viewer)).status, 403);
  assert.deepEqual((await f.get('/api/diagnostics')).predictionLane, before.predictionLane);
  assert.equal((await f.intent(true, 'test', 1)).status, 409);
  assert.equal((await f.request('/api/pool-ranking?memberId=unknown')).status, 400);
  assert.equal((await f.intent(true, 'bad watch id')).status, 400);
});
test('closing cancels only ranking; pending task lists defer it and stale completions are discarded', async t => {
  const workers = [];
  const workerFactory = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message); worker.terminate = async () => {};
    worker.finish = (message, result = { tasks: [], metrics: {} }) => worker.emit('message', { id: message.id, result, evaluationMs: 1 });
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const f = await fixture(t, { taskWorkerOptions: { workerFactory } });
  const tasks = f.request('/api/tasks?memberId=reed&view=play-v1');
  await until(async () => workers[0].messages.find(message => message.type === 'evaluate'), Boolean);
  assert.equal((await f.intent(true)).status, 200);
  await delay(1100); assert.equal(workers.length, 1, 'Pool waits for the main task list');
  workers[0].finish(workers[0].messages.find(message => message.type === 'evaluate'));
  assert.equal((await tasks).status, 200);
  const active = await until(async () => workers[1]?.messages.find(message => message.type === 'predict'), Boolean);
  assert.equal((await f.intent(false)).status, 200);
  const after = await f.get('/api/diagnostics');
  assert.equal(after.predictionLane.ranking.pending, 0); assert.equal(after.predictionLane.ranking.active, 0);
  workers[1].finish(active, { delta: { tasksAdded: [{ label: 'Late task', category: 'Mining' }] } });
  await delay(20);
  assert.equal((await f.get('/api/pool-ranking?memberId=reed')).checked, 0, 'Cancelled result cannot mark a row checked');
  assert.equal(workers[1].messages.filter(message => message.type === 'predict').length, 1);
});

test('a pool read held across an HTTP save rejects its captured owner before retaining rows', { timeout: 20000 }, async t => {
  const { Worker } = await import('node:worker_threads');
  let release, hold = false, markHeld;
  const held = new Promise(resolve => { markHeld = resolve; });
  const f = await fixture(t, { taskWorkerOptions: { workerFactory(data) {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: data });
    const send = worker.postMessage.bind(worker);
    worker.postMessage = message => {
      if (hold && message.type === 'roll-pool') {
        hold = false; release = () => send(message); markHeld();
      } else send(message);
    };
    return worker;
  } } });
  t.after(() => release?.());
  await f.app.store.command({ type: 'set-skill-levels', memberId: 'reed', skill: 'Mining', passiveLevel: 2 }, 0);
  hold = true;
  const old = f.request('/api/pool-ranking?memberId=reed');
  await held;
  const saving = f.request('/api/command?view=play-v1', { expectedRevision: 1,
    command: { type: 'set-chunk', memberId: 'reed', chunkId: ids[1], status: 'unlocked' } });
  await until(async () => f.app.store.getInfo().revision, value => value === 2);
  release(); release = undefined;
  const saved = await saving;
  assert.equal(saved.status, 200); await saved.arrayBuffer();
  const rejected = await old;
  assert.equal(rejected.status, 409, 'An asynchronous old read cannot take ownership of current summaries');
  await rejected.arrayBuffer();
  const current = await f.get('/api/pool-ranking?memberId=reed');
  assert.equal(current.stateRevision, 2);
  await f.get(`/api/predict?memberId=reed&chunkId=${current.rows[0].id}`);
  const checked = await f.get('/api/pool-ranking?memberId=reed');
  assert.ok(checked.checked >= 1);
  const before = await f.get('/api/diagnostics');
  for (let i = 0; i < 3; i++) assert.deepEqual((await f.get('/api/pool-ranking?memberId=reed')).rows, checked.rows);
  const after = await f.get('/api/diagnostics');
  assert.deepEqual(after.predictionLane, before.predictionLane);
  assert.equal(after.poolRanking.watchers, 0);
  assert.equal((await f.request('/map-availability.mjs')).status, 200);
});
