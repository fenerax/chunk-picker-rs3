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
    initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]),
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


test('a worker wake cancels the server quiet-period collection', async t => {
  const f = await fixture(t);
  f.idleClock.tick(100); await flush();
  assert.equal((await f.diagnostics()).idleGc.pending, true);
  const pending = f.api('/api/tasks?memberId=actor1');
  await until(() => f.workers[1]?.messages.length);
  f.memoryClock.tick(100); await flush(); assert.equal(f.collections(), 0);
  f.workers[1].finish(); assert.equal((await pending).status, 200);
});

test('server shutdown cancels its pending quiet-period collection', async t => {
  const f = await fixture(t);
  f.idleClock.tick(100); await flush();
  assert.equal((await f.diagnostics()).idleGc.pending, true);
  await f.application.close();
  f.memoryClock.tick(100); await flush(); assert.equal(f.collections(), 0);
});

for (const compact of [true, false]) test(`authenticated writer reads retained ${compact ? 'compact' : 'full and compact'} tasks after sleep without waking a worker`, async t => {
  const f = await fixture(t), route = '/api/tasks?memberId=actor1';
  const initial = await calculate(f, route + (compact ? '&view=play-v1' : ''), { compact });
  await until(async () => { const d = await f.diagnostics(); return compact ? d.viewerTaskCache.entries === 1 : d.viewerTaskCache.fullCompressedBytes > 0; });
  f.idleClock.tick(100); await flush();
  const before = await f.diagnostics(); assert.equal(before.worker.status, 'sleeping');
  for (const suffix of compact ? ['&view=play-v1'] : ['', '&view=play-v1']) {
    const response = await f.api(route + suffix); assert.equal(response.status, 200);
    const value = await response.json();
    assert.deepEqual(value.tasks, initial.tasks); assert.equal(value.memberId, 'actor1');
    assert.equal(value.stateRevision, initial.stateRevision); assert.equal(value.cache.savedResult, true); assert.equal(value.cache.worker, false);
    if (!suffix) assert.deepEqual(value.activityInfo, result.activityInfo);
  }
  const after = await f.diagnostics();
  assert.equal(f.workers.length, 1); assert.equal(after.worker.status, 'sleeping'); assert.deepEqual(after.counts, before.counts);
});

test('a gameplay change invalidates retained sleeping tasks and launches a new calculation', async t => {
  const f = await fixture(t), route = '/api/tasks?memberId=actor1';
  await calculate(f, route);
  await until(async () => (await f.diagnostics()).viewerTaskCache.fullCompressedBytes > 0);
  f.idleClock.tick(100); await flush();
  const saved = await f.api('/api/command', { expectedRevision: 0, command: { type: 'set-rule', ruleId: 'access.shared', value: false } });
  assert.equal(saved.status, 200); assert.equal(f.workers.length, 1);
  const value = await calculate(f, route);
  assert.equal(f.workers.length, 2); assert.equal(value.stateRevision, 1); assert.equal(value.cache.hit, false); assert.equal(value.cache.worker, true);
});

test('display-only saves keep compact reads asleep but full writer responses carry the current body revision', async t => {
  const f = await fixture(t), route = '/api/tasks?memberId=actor1';
  await calculate(f, route);
  await until(async () => (await f.diagnostics()).viewerTaskCache.fullCompressedBytes > 0);
  f.idleClock.tick(100); await flush();
  const saved = await f.api('/api/command', { expectedRevision: 0,
    command: { type: 'set-preference', memberId: 'actor1', preferenceId: 'ids', value: true } });
  assert.equal(saved.status, 200);
  const compact = await (await f.api(route + '&view=play-v1')).json();
  assert.equal(compact.stateRevision, 1); assert.equal(compact.cache.worker, false); assert.equal(f.workers.length, 1);
  const full = await calculate(f, route);
  assert.equal(full.stateRevision, 1, 'old gzip metadata must never be returned to the writer');
  assert.equal(full.cache.worker, true); assert.equal(f.workers.length, 2);
});
