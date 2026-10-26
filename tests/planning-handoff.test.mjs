import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { definitions, initialState, locations } from './helpers/planning-areas.mjs';

// The reference suppresses only the handoff flag. It runs the unchanged full
// baseline/index path through the production prediction calculator and HTTP API.
for (const group of [false, true]) test(`HTTP planning handoff equals advisory evaluation, group ${group}`, { timeout: 60000 }, async t => {
  const mode = process.env.RS3_TASK_WORKER_MODE; process.env.RS3_TASK_WORKER_MODE = 'process';
  t.after(() => { if (mode === undefined) delete process.env.RS3_TASK_WORKER_MODE; else process.env.RS3_TASK_WORKER_MODE = mode; });
  const all = [], directory = await mkdtemp(path.join(tmpdir(), 'planning-handoff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const handoff of [false, true]) {
    const workerFactory = data => {
      const worker = new ProcessWorker(data);
      if (!handoff) { const post = worker.postMessage.bind(worker); worker.postMessage = message => post({ ...message, planningBaseline: false }); }
      return worker;
    };
    const app = await createServer({ dataDir: path.join(directory, String(handoff)), port: 0, definitions, taskMap: {}, initialState: initialState(), predictionPrewarm: false,
      taskWorkerOptions: { workerFactory, serializedStateInput: true } });
    try {
      await app.listen(); const origin = `http://127.0.0.1:${app.address().port}`;
      const get = async route => { const r = await fetch(origin + route, { headers: { authorization: `Bearer ${app.store.getAccessToken()}` } }); const body = await r.json(); assert.equal(r.status, 200, `${route}: ${JSON.stringify(body)}`); return body; };
      const state = (await get('/api/state')).state, responses = [];
      for (const member of state.members) await get(`/api/tasks?memberId=${member.id}&view=play-v1${group ? `&projection=duo-sidebar-v1&revision=${state.revision}` : ''}`);
      for (const member of state.members) for (const chunkId of locations) for (let repeat = 0; repeat < 2; repeat++) {
        const { cache, ...body } = await get(`/api/chunk-planning?memberId=${member.id}&chunkId=${encodeURIComponent(chunkId)}`);
        if (handoff) assert.equal(cache.timingMs.engineMs ?? 0, 0, 'No baseline re-evaluation');
        responses.push(body);
      }
      if (handoff) {
        const diagnostics = await get('/api/diagnostics');
        assert.ok(diagnostics.planningBaselines.bytes <= diagnostics.planningBaselines.byteLimit);
        assert.equal(diagnostics.planningLane.counts.completed, 8);
        assert.equal(diagnostics.predictionLane.worker.status, 'idle', 'Planning never starts a full advisory calculator');
      }
      all.push(responses);
    } finally { await app.close(); }
  }
  assert.deepEqual(all[1], all[0], 'Every HTTP body field, excluding volatile cache timings');
});

import { EventEmitter } from 'node:events';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { encodePlanningBaseline, PLANNING_BASELINE_BYTES } from '../app/tasks/planning-baseline.mjs';
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function mockFactory() {
  const workers = [];
  return { workers, create() {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
    worker.finish = extra => worker.emit('message', { id: worker.messages.findLast(m => m.id)?.id, result: { tasks: [] }, evaluationMs: 1, ...extra });
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  } };
}
function idleClock() {
  let time = 0; const timers = new Map(); let id = 0;
  return { now: () => time, setTimeout(fn, delay) { timers.set(++id, { fn, at: time + delay }); return id; }, clearTimeout(key) { timers.delete(key); },
    tick(ms) { const end = time + ms; for (;;) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); } time = end; } };
}
const smallBaseline = () => encodePlanningBaseline(definitions, { access: {}, tasks: [] }, { chunks: new Map(), areas: new Map() });
test('handed-off planning cannot delay saves; stale and disconnected work is cancelled and isolated', async t => {
  const foreground = mockFactory(), planning = mockFactory();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, planningWorkerFactory: planning.create });
  t.after(() => scheduler.close());
  const state = { revision: 0, members: [{ id: 'a' }] };
  const initial = scheduler.evaluate(state, 'a', 'evaluate', undefined, 'current', 'before');
  foreground.workers[0].finish({ planningBaseline: smallBaseline() }); await initial;
  const first = scheduler.evaluate(state, 'a', 'chunk-planning', '12341', 'plan', 'before');
  const obsolete = assert.rejects(first, { status: 409 }); await flush();
  const active = planning.workers[0].messages.at(-1);
  assert.equal(active.type, 'chunk-planning'); assert.equal(active.state.tasks, undefined);
  const saved = scheduler.evaluate({ ...state, revision: 1 }, 'a', 'evaluate', undefined, 'saved', 'after', undefined, [], 'play-v1');
  assert.equal(foreground.workers[0].messages.at(-1).input, 'after', 'Save dispatches while planning remains blocked');
  await obsolete; assert.equal(Atomics.load(new Int32Array(active.cancellation), 0), 1);
  foreground.workers[0].finish({ planningBaseline: smallBaseline() }); await saved;
  planning.workers[0].finish();
  const controller = new AbortController();
  const disconnected = scheduler.evaluate({ ...state, revision: 1 }, 'a', 'chunk-planning', '12342', 'cancel', 'after', controller.signal);
  const rejected = assert.rejects(disconnected, { name: 'AbortError' }); controller.abort(); await rejected;
  planning.workers[0].finish();
  assert.equal(scheduler.getHealth().failures, 0);
  assert.equal(scheduler.getDiagnostics().planningLane.cache.entries, 0, 'Abandoned results are not cached');
});

test('handoff cache has byte/count bounds; planning sleeps and wakes without a calculator restart', async t => {
  const foreground = mockFactory(), planning = mockFactory(), clock = idleClock();
  const scheduler = await createTaskScheduler({ workerFactory: foreground.create, planningWorkerFactory: planning.create, idleMs: 100, idleClock: clock });
  t.after(() => scheduler.close());
  const state = { revision: 0, members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  for (const member of ['a', 'b', 'c']) {
    const current = scheduler.evaluate(state, member, 'evaluate', undefined, member, 'input');
    foreground.workers[0].finish({ planningBaseline: smallBaseline() }); await current;
  }
  assert.equal(scheduler.getDiagnostics().planningBaselines.entries, 2);
  assert.ok(scheduler.getDiagnostics().planningBaselines.bytes <= PLANNING_BASELINE_BYTES);
  const plan = scheduler.evaluate(state, 'c', 'chunk-planning', '12341', 'plan', 'input'); await flush(); planning.workers[0].finish(); await plan;
  // Keep foreground live while the independent planning idle interval expires.
  clock.tick(50); await scheduler.evaluate(state, 'c', 'evaluate', undefined, 'c', 'input');
  clock.tick(50); await flush();
  assert.equal(scheduler.getHealth().planning.status, 'sleeping'); assert.equal(planning.workers[0].terminated, true);
  const woke = scheduler.evaluate(state, 'c', 'chunk-planning', '12341', 'plan', 'input'); await flush();
  assert.equal(planning.workers.length, 2); planning.workers[1].finish(); await woke;
  assert.equal(scheduler.getHealth().planning.restarts, 0); assert.equal(scheduler.getHealth().planning.idleStops, 1);
  clock.tick(100); await flush(); assert.equal(scheduler.getDiagnostics().planningBaselines.bytes, 0);
});
