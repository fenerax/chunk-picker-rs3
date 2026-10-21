import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} };
const result = { tasks: [{ id: 'synthetic-idle-task', label: 'Mine ore', category: 'Mining', status: 'available' }],
  metrics: { availableCount: 1 }, activityInfo: { skills: [{ skill: 'Mining' }] } };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function until(predicate) {
  for (let i = 0; i < 1000; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Timed out waiting for idle-memory fixture');
}
function clock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  return { now: () => time,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      time = end;
    },
  };
}
function factory({ heldTermination = false } = {}) {
  const workers = [];
  return { workers, create() {
    const worker = new EventEmitter(); worker.messages = []; worker.terminated = false;
    let release;
    const retiring = new Promise(resolve => { release = resolve; });
    worker.release = release;
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => {
      worker.terminated = true;
      if (heldTermination) await retiring;
      worker.emit('exit', 1);
    };
    worker.finish = ({ compact = false } = {}) => {
      const message = { id: worker.messages.findLast(message => message.id)?.id, evaluationMs: 1 };
      if (compact) {
        const bytes = Buffer.from(JSON.stringify(result)), playJSON = new SharedArrayBuffer(bytes.length);
        Buffer.from(playJSON).set(bytes); message.playJSON = playJSON;
      } else message.result = structuredClone(result);
      worker.emit('message', message);
    };
    workers.push(worker);
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 1 }));
    return worker;
  } };
}
async function fixture(t, options = {}) {
  const base = path.resolve('.local/idle-memory-tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'server-'));
  const f = factory(options), idleClock = clock(), memoryClock = clock();
  let collections = 0;
  const application = await createServer({ dataDir: directory, definitions, taskMap: {}, port: 0, predictionPrewarm: false,
    initialState: createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]),
    taskWorkerOptions: { workerFactory: f.create, idleMs: 100, idleClock },
    idleMemoryOptions: { collect: async () => { collections++; }, clock: memoryClock, delayMs: 50 } });
  await application.listen();
  t.after(async () => { for (const worker of f.workers) worker.release(); await application.close(); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${application.address().port}`;
  const api = (route, body) => fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${application.store.getAccessToken()}`, 'Accept-Encoding': 'identity',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const diagnostics = async () => (await api('/api/diagnostics')).json();
  return { ...f, application, api, diagnostics, idleClock, memoryClock, collections: () => collections };
}
async function calculate(f, route, finishOptions) {
  const response = f.api(route);
  await until(() => f.workers.some(worker => !worker.terminated && worker.messages.some(message => message.type === 'evaluate')));
  f.workers.findLast(worker => !worker.terminated && worker.messages.some(message => message.type === 'evaluate')).finish(finishOptions);
  const value = await response; assert.equal(value.status, 200); return value.json();
}

test('server collects only after every worker termination settles and a fresh quiet delay', async t => {
  const f = await fixture(t, { heldTermination: true });
  const death = f.api('/api/death-estimates?memberId=player1&chunkId=12341');
  await until(() => f.workers[1]?.messages.length);
  f.workers[1].finish(); assert.equal((await death).status, 200);
  f.idleClock.tick(100); await flush();
  assert.equal(f.workers.every(worker => worker.terminated), true);
  f.memoryClock.tick(500); await flush(); assert.equal(f.collections(), 0);
  f.workers[0].release(); await flush();
  f.memoryClock.tick(500); await flush(); assert.equal(f.collections(), 0, 'death lane is still retiring');
  f.workers[1].release(); await flush();
  f.memoryClock.tick(49); await flush(); assert.equal(f.collections(), 0);
  f.memoryClock.tick(1); await flush(); assert.equal(f.collections(), 1);
  f.memoryClock.tick(500); await flush(); assert.equal(f.collections(), 1, 'one collection per idle episode');
  assert.equal((await f.diagnostics()).idleGc.released, 1);
});

