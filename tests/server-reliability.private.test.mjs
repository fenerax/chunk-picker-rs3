import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 1000; i++) { if (await predicate()) return; await delay(5); } assert.fail('Timed out'); }
function fakeFactory() {
  const workers = [];
  return { workers, workerFactory() {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => worker.emit('exit', 1);
    worker.finish = () => worker.emit('message', { id: worker.messages.at(-1).id, result: { tasks: [], metrics: { availableCount: 0 } }, evaluationMs: 3, timingMs: { totalMs: 3, engineMs: 2 } });
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 })); return worker;
  } };
}
async function fixture(t, options = {}) {
  const base = path.resolve('.local/reliability-tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'server-'));
  const application = await createServer({ dataset: fixtureDataset, dataDir: directory, definitions, taskMap: {}, port: 0,
    initialState: createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]), ...options });
  await application.listen();
  t.after(async () => { await application.close(); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${application.address().port}`;
  const api = (route, body, extra = {}) => fetch(`${origin}${route}`, { ...extra,
    method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: `Bearer ${application.store.getAccessToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra.headers } });
  return { application, api, origin };
}

test('HTTP death work is isolated and disconnect cancels only after its last waiter leaves', async t => {
  const f = fakeFactory();
  const { api } = await fixture(t, { taskWorkerOptions: { workerFactory: f.workerFactory } });
  const route = '/api/death-estimates?memberId=player1&chunkId=12341';
  const firstController = new AbortController(), followerController = new AbortController();
  const first = api(route, undefined, { signal: firstController.signal });
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => f.workers[1]?.messages.length === 1);
  assert.deepEqual(f.workers[1].messages[0].chunkIds, ['12341']);
  const follower = api(route, undefined, { signal: followerController.signal });
  const followerRejected = assert.rejects(follower, { name: 'AbortError' });
  await until(async () => (await (await api('/api/diagnostics')).json()).deathLane.counts.coalesced === 1);
  const tasks = api('/api/tasks?memberId=player1');
  await until(() => f.workers[0].messages.length === 1);
  f.workers[0].finish(); assert.equal((await tasks).status, 200);
  assert.equal((await (await api('/api/diagnostics')).json()).deathLane.queue.active, 1);
  firstController.abort(); await firstRejected;
  await until(async () => (await (await api('/api/diagnostics')).json()).deathLane.counts.cancelled === 0);
  assert.equal(f.workers[1].messages.length, 1);
  followerController.abort(); await followerRejected;
  await until(() => f.workers[1].messages.at(-1).type === 'cancel');
  f.workers[1].finish();
  const diagnostics = await (await api('/api/diagnostics')).json();
  assert.equal(diagnostics.deathLane.cache.entries, 0);
  assert.equal(diagnostics.worker.ready, true);
});

