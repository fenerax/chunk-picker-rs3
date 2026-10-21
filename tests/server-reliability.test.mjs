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
    initialState: createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]), ...options });
  await application.listen();
  t.after(async () => { await application.close(); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${application.address().port}`;
  const api = (route, body, extra = {}) => fetch(`${origin}${route}`, { ...extra,
    method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: `Bearer ${application.store.getAccessToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra.headers } });
  return { application, api, origin };
}

test('authenticated health and diagnostics expose recovery, bounded queue and timings without personal data', async t => {
  const f = fakeFactory();
  const { api, origin, application } = await fixture(t, { taskWorkerOptions: { workerFactory: f.workerFactory, maxRestarts: 1, backoffMs: 1000 } });
  assert.equal((await fetch(`${origin}/api/diagnostics`)).status, 401);
  const calculating = api('/api/tasks?memberId=actor1'); await until(() => f.workers[0].messages.length);
  const pending = await (await api('/api/diagnostics')).json(); assert.equal(pending.queue.active, 1);
  f.workers[0].finish(); assert.equal((await calculating).status, 200);
  const diagnostic = await (await api('/api/diagnostics')).json();
  assert.equal(diagnostic.cache.entries, 1); assert.ok(diagnostic.cache.bytes > 0);
  assert.equal(diagnostic.timingMs.stages.engineMs.meanMs, 2);
  f.workers[0].emit('error', new Error('A private note and secret token'));
  const health = await (await api('/api/health')).json(); assert.equal(health.ready, false); assert.equal(health.status, 'degraded'); assert.equal(health.savesReady, true);
  await until(() => f.workers.length === 2); f.workers[1].emit('exit', 2);
  const failed = await (await api('/api/health')).json(); assert.equal(failed.ready, false); assert.equal(failed.status, 'restart-required');
  assert.equal((await api('/api/tasks?memberId=actor1')).status, 503);
  const diagnosticJSON = JSON.stringify(await (await api('/api/diagnostics')).json());
  for (const privateValue of ['actor1', 'reed', 'private note', application.store.getAccessToken()]) assert.ok(!diagnosticJSON.includes(privateValue));
  const save = await api('/api/command', { expectedRevision: 0, command: { type: 'set-rule', ruleId: 'access.shared', value: false } }); assert.equal(save.status, 200);
});

test('idle shutdown keeps SSE connected and saves durable while task requests wake safely', async t => {
  let time = 0, sequence = 0; const timers = new Map();
  const idleClock = { now: () => time,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const f = fakeFactory();
  const { api, application } = await fixture(t, { predictionPrewarm: false,
    taskWorkerOptions: { workerFactory: f.workerFactory, idleMs: 100, idleClock } });
  const references = new Map();
  for (const route of ['/api/definitions', '/api/task-map']) {
    const plain = await api(route, undefined, { headers: { 'Accept-Encoding': 'identity' } });
    assert.equal(plain.status, 200);
    const bytes = Buffer.from(await plain.arrayBuffer()); references.set(route, bytes);
    const compressed = await api(route, undefined, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(compressed.headers.get('Content-Encoding'), 'gzip');
    assert.deepEqual(Buffer.from(await compressed.arrayBuffer()), bytes);
  }
  const referenceBytes = [...references.values()].reduce((total, bytes) => total + bytes.length, 0);
  assert.ok((await (await api('/api/diagnostics')).json()).referenceCache.bytes > referenceBytes);
  const controller = new AbortController(); t.after(() => controller.abort());
  const events = await api('/api/events', undefined, { signal: controller.signal });
  const reader = events.body.getReader(); await reader.read();
  time = 100;
  for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); }
  const diagnostic = await (await api('/api/diagnostics')).json();
  assert.equal(diagnostic.worker.status, 'sleeping'); assert.equal(diagnostic.responseCache.bytes, 0);
  assert.equal(diagnostic.referenceCache.bytes, referenceBytes, 'sleep releases compressed reference variants');
  const health = await (await api('/api/health')).json();
  assert.equal(health.status, 'sleeping'); assert.equal(health.savesReady, true);
  assert.equal(health.worker.stuck, false);
  const asleepBackup = await api('/api/backup'); assert.equal(asleepBackup.status, 200);
  assert.equal((await asleepBackup.json()).format, 'rs3-chunk-picker');
  assert.deepEqual((await (await api('/api/worker-restart', {})).json()).restarted, []);
  assert.equal(f.workers.length, 1, 'Health, backups and healthy recovery do not wake calculators.');
  const save = await api('/api/command', { expectedRevision: 0,
    command: { type: 'set-rule', ruleId: 'access.shared', value: false } });
  assert.equal(save.status, 200); assert.equal(f.workers.length, 1);
  let received = '';
  while (!received.includes('event: revision')) { const read = await reader.read(); assert.equal(read.done, false); received += new TextDecoder().decode(read.value); }
  assert.match(received, /"revision":1/);
  const tasks = api('/api/tasks?memberId=actor1');
  await until(() => f.workers[1]?.messages.some(message => message.type === 'evaluate'));
  assert.equal(f.workers[1].messages.at(-1).state.revision, 1);
  f.workers[1].finish(); assert.equal((await tasks).status, 200);
  assert.equal((await application.store.backup()).state.rules['access.shared'], false);
  for (const [route, bytes] of references) {
    const compressed = await api(route, undefined, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(compressed.status, 200); assert.equal(compressed.headers.get('Content-Encoding'), 'gzip');
    assert.deepEqual(Buffer.from(await compressed.arrayBuffer()), bytes);
  }
  controller.abort();
});

test('HTTP disconnect removes queued calculation while the other member remains active', async t => {
  const f = fakeFactory();
  const { api } = await fixture(t, { taskWorkerOptions: { workerFactory: f.workerFactory } });
  const active = api('/api/tasks?memberId=actor1'); await until(() => f.workers[0].messages.length);
  const controller = new AbortController();
  const queued = api('/api/tasks?memberId=reed', undefined, { signal: controller.signal }); const rejected = assert.rejects(queued, { name: 'AbortError' });
  await until(async () => (await (await api('/api/diagnostics')).json()).queue.depth === 1);
  controller.abort(); await rejected;
  for (let i = 0; i < 20; i++) { const info = await (await api('/api/diagnostics')).json(); if (!info.queue.depth && info.counts.cancelled) break; await delay(5); }
  const info = await (await api('/api/diagnostics')).json(); assert.equal(info.queue.depth, 0); assert.equal(info.counts.cancelled, 1);
  f.workers[0].finish(); assert.equal((await active).status, 200);
});


test('HTTP request coalescing and gameplay cache survive display saves and history archival', async t => {
  const f = fakeFactory();
  const { api, application } = await fixture(t, { retention: { historyEntries: 2 }, taskWorkerOptions: { workerFactory: f.workerFactory } });
  const first = api('/api/tasks?memberId=actor1'); await until(() => f.workers[0].messages.length);
  const follower = api('/api/tasks?memberId=actor1&chunkId=ignored-for-ordinary-tasks');
  await until(async () => (await (await api('/api/diagnostics')).json()).counts.coalesced === 1);
  assert.equal(f.workers[0].messages.length, 1); f.workers[0].finish();
  assert.equal((await (await first).json()).cache.hit, false); assert.equal((await (await follower).json()).cache.hit, true);
  for (let revision = 0; revision < 5; revision++) {
    const response = await api('/api/command', { expectedRevision: revision,
      command: { type: 'set-preference', memberId: 'actor1', preferenceId: 'ids', value: !!(revision % 2) } });
    assert.equal(response.status, 200);
  }
  assert.ok(application.store.getInfo().retention.historyArchives > 0);
  const cached = await (await api('/api/tasks?memberId=actor1')).json();
  assert.equal(cached.stateRevision, 5); assert.equal(cached.cache.hit, true); assert.equal(f.workers[0].messages.length, 1);
});

test('graceful shutdown drains queued saves, rejects new writes and bounds unfinished connections', async t => {
  let release, entered = false;
  const held = new Promise(resolve => { release = resolve; });
  const { application, api, origin } = await fixture(t, { definitions: { ...definitions, challenges: undefined }, beforeCommit: async () => { entered = true; await held; }, shutdownDeadlineMs: 60 });
  const saving = api('/api/command', { expectedRevision: 0, command: { type: 'set-rule', ruleId: 'access.shared', value: false } }, { headers: { 'Accept-Encoding': 'identity' } });
  await until(() => entered);
  const socket = net.connect(application.address().port, '127.0.0.1'); socket.on('error', () => {});
  await new Promise(resolve => socket.once('connect', resolve));
  socket.write(`POST /api/command HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nAuthorization: Bearer ${application.store.getAccessToken()}\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{`);
  const started = performance.now(); const closing = application.close();
  let admissionTimer;
  try {
    // Store admission closes synchronously; a regression must fail without
    // waiting forever behind the deliberately held first save.
    await assert.rejects(Promise.race([
      application.store.command({ type: 'set-rule', ruleId: 'access.shared', value: true }, 0),
      new Promise((_, reject) => { admissionTimer = setTimeout(() => reject(new Error('Store admission stayed open during shutdown.')), 1000); }),
    ]), /closed/);
    clearTimeout(admissionTimer);
    // Let the network deadline expire while an accepted save is still queued.
    await delay(90); release();
    assert.equal((await saving).status, 200); await closing;
    assert.equal(application.store.getState().revision, 1); assert.ok(performance.now() - started < 5000);
  } finally {
    clearTimeout(admissionTimer); release(); socket.destroy();
    await closing.catch(() => {}); await saving.catch(() => {});
  }
});

test('a nonreading save requester cannot keep shutdown open after its save commits', async t => {
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }]);
  initialState.legacy = { gameplayNotes: 'x'.repeat(4 * 1024 * 1024) };
  let release, entered = false;
  const held = new Promise(resolve => { release = resolve; });
  const { application, origin } = await fixture(t, { initialState, definitions: { ...definitions, challenges: undefined },
    shutdownDeadlineMs: 50, beforeCommit: async () => { entered = true; await held; } });
  const socket = net.connect(application.address().port, '127.0.0.1'); socket.on('error', () => {});
  await new Promise(resolve => socket.once('connect', resolve)); socket.pause();
  const body = JSON.stringify({ expectedRevision: 0, command: { type: 'set-rule', ruleId: 'access.shared', value: false } });
  socket.write(`POST /api/command HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nAuthorization: Bearer ${application.store.getAccessToken()}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  await until(() => entered);
  const started = performance.now(), closing = application.close(); release(); await closing;
  assert.equal(application.store.getState().revision, 1); assert.ok(performance.now() - started < 5000);
  socket.destroy();
});

test('shutdown endpoint requires auth and same-origin safeguards and returns before closing', async t => {
  const { api, origin, application } = await fixture(t, { definitions: { ...definitions, challenges: undefined } });
  assert.equal((await fetch(`${origin}/api/shutdown`, { method: 'POST' })).status, 401);
  assert.equal((await api('/api/shutdown', {}, { headers: { Origin: 'http://foreign.invalid' } })).status, 403);
  const response = await api('/api/shutdown', {}); assert.equal(response.status, 202); assert.equal((await response.json()).status, 'stopping');
  await application.close(); assert.equal(application.server.listening, false);
});
