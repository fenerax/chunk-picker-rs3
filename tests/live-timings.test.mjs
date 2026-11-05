import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLiveTimings, noteTiming, actions, TIMING_FILE_CAP } from '../app/live-timings.mjs';
import { createDeepProfiles } from '../app/deep-profiles.mjs';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

async function temporary(t) { const dir = await mkdtemp(path.join(tmpdir(), 'live-timings-unit-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

function cleanupClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = globalThis.setTimeout, waiting = [];
  let armed = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    const timer = timeout(callback, ms, ...args);
    if (ms === 20) {
      armed++;
      for (const entry of waiting) if (armed >= entry.count) entry.resolve();
    }
    return timer;
  });
  return {
    armed(count) { return armed >= count ? Promise.resolve() : new Promise(resolve => waiting.push({ count, resolve })); },
    tick(ms) { t.mock.timers.tick(ms); },
  };
}
test('bounded summaries, numeric stages, windows, restart and private-byte allowlist', async t => {
  const dir = await temporary(t); let now = Date.now();
  let timings = await openLiveTimings(dir, { now: () => now });
  const poison = 'SECRET-MEMBER-TASK-CHUNK';
  for (let i = 0; i < 3000; i++) timings.record('how', i, { source: i % 2 ? 'cache' : 'computed', coalesced: i % 3 === 0, calculatorStarted: true, stages: { engineMs: 3, [poison]: 50 }, memberId: poison });
  timings.record(poison, 9000); await timings.flush();
  let summary = timings.summary();
  const row = summary.windows['24h'].find(row => row.action === 'how');
  assert.equal(row.count, 3000); assert.equal(row.cacheHitShare, 0.5); assert.equal(row.coalesced, 1000); assert.equal(row.max, 2999);
  assert.ok(row.p50 >= 1499 && row.p50 < 1575); assert.equal(summary.slowest.length, 20); assert.equal(summary.slowest[0].durationMs, 2999);
  let bytes = await readFile(`${dir}/live-timings.json`, 'utf8'); assert.ok(!bytes.includes(poison)); assert.ok(Buffer.byteLength(bytes) < TIMING_FILE_CAP);
  assert.equal(JSON.parse(bytes).recent.length, 2048);
  await timings.close(); timings = await openLiveTimings(dir, { now: () => now });
  assert.deepEqual(timings.summary().windows, summary.windows);
  now += 25 * 3600000; assert.equal(timings.summary().windows['24h'].find(r => r.action === 'how').count, 0);
  assert.equal(timings.summary().windows['7d'].find(r => r.action === 'how').count, 3000);
  for (let hour = 0; hour < 180; hour++) { now += 3600000; for (const action of actions) timings.record(action, hour); }
  await timings.close(); bytes = await readFile(`${dir}/live-timings.json`, 'utf8');
  assert.ok(JSON.parse(bytes).hours.length <= 168); assert.ok(Buffer.byteLength(bytes) <= TIMING_FILE_CAP);
});
test('HTTP completion records isolate concurrent requests, allowlist query values and ignore late producer metadata', async t => {
  const dir = await temporary(t), timings = await openLiveTimings(dir);
  const finish = async (url, metadata) => {
    const response = new EventEmitter(); response.statusCode = 200; response.writableFinished = true;
    await timings.request({ url }, response, async () => { await new Promise(resolve => setImmediate(resolve)); noteTiming(metadata); noteTiming({ timingMs: { engineMs: 2 } }); response.emit('finish'); noteTiming({ source: 'computed' }); response.emit('close'); });
  };
  await Promise.all([finish('/api/tasks?view=play-v1&memberId=SECRET', { source: 'cache' }), finish('/api/predict?chunkId=SECRET', { source: 'computed', coalesced: true, calculatorStarted: true, timingMs: { stages: { engineMs: 5, SECRET: 20 } } })]);
  const rows = timings.summary().windows['24h']; assert.equal(rows.find(r => r.action === 'tasks-play').cached, 1); assert.equal(rows.find(r => r.action === 'preview-first').coalesced, 1); assert.equal(rows.find(r => r.action === 'preview-first').stages.engineMs.totalMs, 7);
  await timings.close(); assert.ok(!(await readFile(`${dir}/live-timings.json`, 'utf8')).includes('SECRET'));
});
test('disabled collector does not write', async t => {
  const dir = await temporary(t), timings = await openLiveTimings(dir, { enabled: false }); timings.record('how', 1); await timings.close();
  await assert.rejects(stat(`${dir}/live-timings.json`), { code: 'ENOENT' });
});
test('CPU profiles cover process calculators, deadline, close, downloads and caps', { timeout: 30000 }, async t => {
  const dir = await temporary(t), profiles = await createDeepProfiles(dir, { caps: { count: 3, fileBytes: 4 * 1024 * 1024, totalBytes: 12 * 1024 * 1024 } });
  const worker = new ProcessWorker(genericWorkerData({ definitions: { chunks: {}, challenges: {}, walkableChunks: [], walkableChunksF2P: [] } }));
  t.after(async () => { await profiles.close(); await worker.terminate(); });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  // Native profiler admission can exceed 500 ms on a busy runner. Wait for
  // both process profilers to acknowledge startup before firing the picker
  // deadline, rather than making successful admission race a wall-clock sleep.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  profiles.attach(worker); await profiles.start(60);
  assert.equal(profiles.status().active, true);
  t.mock.timers.tick(60000);
  assert.equal(profiles.status().active, false, 'The deadline stops capture without an explicit stop');
  await profiles.stop(); // Join the deadline-triggered cleanup and profile writes.
  assert.equal(profiles.status().active, false);
  const files = await profiles.list(); assert.equal(files.length, 3); assert.ok(files.some(f => f.name.endsWith('-calculator.cpuprofile'))); assert.ok(files.some(f => f.name.endsWith('-relay.cpuprofile'))); assert.ok(files.some(f => f.name.endsWith('-picker.cpuprofile')));
  for (const file of files) { const parsed = JSON.parse(await profiles.download(file.name)); assert.ok(parsed.nodes.length > 0); }
  await assert.rejects(profiles.download('../state.json'), { status: 404 }); await assert.rejects(profiles.start(601), { status: 400 });
  await profiles.start(60); await profiles.close(); assert.equal(profiles.status().active, false); assert.equal((await profiles.list()).length, 3);
  assert.equal(profiles.status().failures, 0);
});
test('persisted unknown fields never get reflected into summaries', async t => {
  const dir = await temporary(t);
  await writeFile(`${dir}/live-timings.json`, JSON.stringify({ version: 1, hours: [[Math.floor(Date.now() / 3600000), { SECRET: { count: 1 }, how: { count: 1, max: 1, histogram: { 1: 1, SECRET: 50 }, SECRET: 'SECRET' } }]], recent: [] }));
  const timings = await openLiveTimings(dir); assert.ok(!JSON.stringify(timings.summary()).includes('SECRET')); await timings.close();
});

test('each task view and picker-prefixed route has a fixed action name', async t => {
  const timings = await openLiveTimings(await temporary(t));
  for (const [url, action] of [
    ['/api/tasks', 'tasks-full'], ['/api/tasks?view=play-v1', 'tasks-play'],
    ['/api/tasks?lane=duo-v1', 'tasks-duo'], ['/api/tasks?projection=duo-sidebar-v1', 'tasks-sidebar'],
    ['/api/tasks?projection=duo-inspection-v1', 'tasks-inspection'],
    ['/api/pickers/PRIVATE-ID/tasks?view=play-v1', 'tasks-play'],
  ]) {
    const response = new EventEmitter(); response.statusCode = 200; response.writableFinished = true;
    timings.request({ url }, response, () => { response.emit('finish'); });
    assert.ok(timings.summary().windows['24h'].find(r => r.action === action).count > 0);
  }
  await timings.close();
});
test('calculator wake is recorded after a sleeping lane gets a ready worker', async t => {
  const { createTaskScheduler } = await import('../app/tasks/scheduler.mjs');
  const records = [], workers = [];
  const scheduler = await createTaskScheduler({ idleMs: 20, timings: { record: (...args) => records.push(args) }, workerFactory() {
    const worker = new EventEmitter(); workers.push(worker);
    worker.terminate = async () => { worker.emit('exit', 0); };
    worker.postMessage = message => { if (message.type !== 'evaluate') return; queueMicrotask(() => worker.emit('message', { id: message.id, result: {}, evaluationMs: 1 })); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  } });
  t.after(() => scheduler.close());
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(scheduler.getHealth().status, 'sleeping');
  const result = await scheduler.evaluate({ revision: 0 }, 'synthetic', 'evaluate', undefined, 'key', 'input');
  assert.equal(result.calculatorStarted, true); assert.equal(workers.length, 2);
  assert.equal(records.length, 1); assert.equal(records[0][0], 'calculator-wake'); assert.ok(records[0][1] >= 0);
});

test('standby stays read only and reloads the writer summary on activation', async t => {
  const dir = await temporary(t), writer = await openLiveTimings(dir), standby = await openLiveTimings(dir, { paused: true });
  standby.record('worker-start', 10); await standby.flush();
  await assert.rejects(stat(`${dir}/live-timings.json`), { code: 'ENOENT' });
  writer.record('command', 20); await writer.pause(); await standby.resume();
  assert.equal(standby.summary().windows['24h'].find(r => r.action === 'command').count, 1);
  standby.record('how', 1); await standby.flush(); await writer.close();
  const reader = await openLiveTimings(dir); assert.equal(reader.summary().windows['24h'].find(r => r.action === 'how').count, 1); await reader.close(); await standby.close();
});

test('VPS runner rejects the live directory and aliases before creating a scratch copy', async t => {
  const { spawn } = await import('node:child_process');
  const dir = await temporary(t);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/perf/vps-hotspots.mjs', import.meta.url)), '--recovery-save', dir, '--live-data-dir', dir, '--out', `${dir}-out`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stderr.on('data', bytes => { output += bytes; }); child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 1); assert.match(result.output, /IsolationError/);
});

test('oversized CPU captures are discarded within byte caps', async t => {
  const profiles = await createDeepProfiles(await temporary(t), { caps: { count: 1, fileBytes: 64, totalBytes: 128 } });
  await profiles.start(0.02); await new Promise(resolve => setTimeout(resolve, 80)); await profiles.stop();
  assert.equal(profiles.status().active, false); assert.equal((await profiles.list()).length, 0); assert.ok(profiles.status().failures > 0);
  await profiles.close();
});

test('partial profile writes and failed renames clean up and stay within disk caps', async t => {
  const caps = { count: 2, fileBytes: 64, totalBytes: 96 };
  for (const operation of ['write', 'rename']) {
    const dir = await temporary(t), directory = path.join(dir, 'cpu-profiles');
    let attempts = 0;
    const checkDisk = async () => {
      const entries = await Promise.all((await readdir(directory)).map(name => stat(path.join(directory, name))));
      assert.ok(entries.length <= caps.count);
      assert.ok(entries.reduce((sum, entry) => sum + entry.size, 0) <= caps.totalBytes);
      assert.ok(entries.every(entry => entry.size <= caps.fileBytes));
    };
    const profiles = await createDeepProfiles(dir, { caps, fileIO: {
      unlink,
      async writeFile(file, bytes, options) {
        await writeFile(file, operation === 'write' ? bytes.slice(0, 8) : bytes, options);
        await checkDisk();
        if (operation === 'write') { attempts++; throw new Error('Synthetic partial write failure'); }
      },
      async rename() { attempts++; throw new Error('Synthetic rename failure'); },
    } });
    t.after(() => profiles.close());
    const worker = new EventEmitter(); worker.startCpuProfile = async () => ({ stop: async () => ({ nodes: [1] }) }); profiles.attach(worker);
    for (let index = 0; index < 6; index++) {
      await profiles.start(60); await profiles.stop(); await checkDisk();
      assert.deepEqual(await readdir(directory), []);
    }
    assert.equal(attempts, 6); assert.ok(profiles.status().failures >= attempts);
  }
});

test('temporary profiles count toward caps and failed cleanup refuses capture admission', async t => {
  const dir = await temporary(t), directory = path.join(dir, 'cpu-profiles');
  let blocked = false, starts = 0;
  const profiles = await createDeepProfiles(dir, { caps: { count: 2, fileBytes: 64, totalBytes: 96 }, fileIO: {
    writeFile, rename, async unlink(file) { if (blocked) throw new Error('Synthetic cleanup failure'); await unlink(file); },
  } });
  t.after(() => profiles.close());
  await mkdir(directory);
  for (let index = 0; index < 3; index++) await writeFile(path.join(directory, `profile-1-${index}-calculator.cpuprofile.tmp`), 'x'.repeat(40));
  const worker = new EventEmitter(); worker.startCpuProfile = async () => { starts++; return { stop: async () => ({ nodes: [1] }) }; }; profiles.attach(worker);
  blocked = true;
  for (let index = 0; index < 3; index++) await assert.rejects(profiles.start(60), { status: 503 });
  assert.equal(starts, 0); assert.equal(profiles.status().active, false);
  assert.deepEqual(await profiles.list(), []);
  await assert.rejects(profiles.download('profile-1-0-calculator.cpuprofile.tmp'), { status: 404 });
  blocked = false; await profiles.start(60); await profiles.stop();
  assert.equal(starts, 1); assert.equal((await readdir(directory)).length, 1);
});

test('a calculator crash during capture releases handles and leaves no partial files', async t => {
  const dir = await temporary(t), profiles = await createDeepProfiles(dir);
  const worker = new ProcessWorker(genericWorkerData({ definitions: { chunks: {}, challenges: {}, walkableChunks: [], walkableChunksF2P: [] } }));
  t.after(async () => { await profiles.close(); await worker.terminate(); });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  profiles.attach(worker); await profiles.start(60);
  const exited = new Promise(resolve => worker.once('exit', resolve)); process.kill(worker.pid, 'SIGKILL'); await exited;
  assert.ok(profiles.status().failures > 0); await profiles.stop();
  assert.deepEqual(profiles.status(), { enabled: true, active: false, starting: false, deadline: null, stopping: false, failures: 1, retirements: 0 });
  const files = await profiles.list(); assert.equal(files.length, 1); assert.match(files[0].name, /-picker\.cpuprofile$/);
  assert.deepEqual((await readdir(path.join(dir, 'cpu-profiles'))).sort(), files.map(file => file.name).sort());
  await profiles.start(60); await profiles.close();
  assert.equal(profiles.status().failures, 1, 'dead calculator must not be restarted or stopped again');
  assert.equal((await profiles.list()).length, 2);
});

test('a calculator created during an active profile joins without a restart flag', async t => {
  const profiles = await createDeepProfiles(await temporary(t)); await profiles.start(60);
  const worker = new ProcessWorker(genericWorkerData({ definitions: { chunks: {}, challenges: {}, walkableChunks: [], walkableChunksF2P: [] } }));
  t.after(async () => { await profiles.close(); await worker.terminate(); });
  profiles.attach(worker);
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  await new Promise(resolve => setTimeout(resolve, 20)); await profiles.stop();
  const files = await profiles.list();
  assert.ok(files.some(file => file.name.endsWith('-calculator.cpuprofile'))); assert.ok(files.some(file => file.name.endsWith('-relay.cpuprofile')));
  assert.equal(profiles.status().failures, 0);
});
test('public administrator connections cannot read or switch profiles', async () => {
  const { serveLiveTimings } = await import('../app/live-timings-route.mjs');
  for (const [method, route] of [['GET', '/admin/live-timings'], ['GET', '/api/admin/live-timings'], ['POST', '/api/admin/cpu-profiles']]) {
    await assert.rejects(serveLiveTimings({ method }, {}, { route, identity: { admin: true }, security: { publicRequest: true } }), { status: 403 });
  }
});

test('pooled warm use does not claim a calculator start; a retired pool starts one', async t => {
  const { createTaskScheduler } = await import('../app/tasks/scheduler.mjs');
  const workers = [];
  const scheduler = await createTaskScheduler({ maxCalculators: 1, idleMs: 30, workerFactory() {
    const worker = new EventEmitter(); workers.push(worker);
    worker.terminate = async () => { worker.emit('exit', 0); };
    worker.postMessage = message => { if (message.type === 'evaluate') queueMicrotask(() => worker.emit('message', { id: message.id, result: {}, evaluationMs: 1 })); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  } });
  t.after(() => scheduler.close());
  assert.equal((await scheduler.evaluate({ revision: 0 }, 'synthetic', 'evaluate', undefined, 'first', 'first')).calculatorStarted, false);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await scheduler.evaluate({ revision: 1 }, 'synthetic', 'evaluate', undefined, 'second', 'second')).calculatorStarted, true);
  assert.equal(workers.length, 2);
});

test('thread calculators created during capture wait for online and produce a profile', async t => {
  const { Worker } = await import('node:worker_threads');
  const profiles = await createDeepProfiles(await temporary(t)); await profiles.start(60);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions: { chunks: {}, challenges: {}, walkableChunks: [], walkableChunksF2P: [] } }) });
  t.after(async () => { await profiles.close(); await worker.terminate(); }); profiles.attach(worker);
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  await profiles.stop(); assert.ok((await profiles.list()).some(file => file.name.endsWith('-calculator.cpuprofile'))); assert.equal(profiles.status().failures, 0);
});

test('promoted peer cache hits discard the producer and follower timing flags', async t => {
  const { createTaskScheduler } = await import('../app/tasks/scheduler.mjs');
  const factory = () => {
    const worker = new EventEmitter();
    worker.terminate = async () => { worker.emit('exit', 0); };
    worker.postMessage = message => {
      if (message.type !== 'evaluate') return;
      queueMicrotask(() => {
        const bytes = Buffer.from('{"tasks":[]}'), playJSON = new SharedArrayBuffer(bytes.length); Buffer.from(playJSON).set(bytes);
        worker.emit('message', { id: message.id, playJSON, cancelled: false, evaluationMs: 1 });
      });
    };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  };
  const scheduler = await createTaskScheduler({ workerFactory: factory, duoWorkerFactory: factory }); t.after(() => scheduler.close());
  const state = { revision: 0 }, call = lane => scheduler.evaluate(state, 'peer', 'evaluate', undefined, 'same', 'input', undefined, [], 'play-v1', undefined, lane);
  const [, follower] = await Promise.all([call('duo'), call('duo')]);
  assert.equal(follower.coalesced, true); assert.equal(follower.calculatorStarted, true);
  const cached = await call('foreground'); assert.equal(cached.hit, true);
  assert.notEqual(cached.coalesced, true); assert.notEqual(cached.calculatorStarted, true);
});

test('stop cancels capture admission before any picker or calculator profiler starts', async t => {
  const dir = await temporary(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const profiles = await createDeepProfiles(dir, { fileIO: { writeFile, rename, async unlink(file) {
    entered.resolve(); await release.promise; await unlink(file);
  } } });
  t.after(async () => { release.resolve(); await profiles.close(); });
  await mkdir(path.join(dir, 'cpu-profiles'));
  await writeFile(path.join(dir, 'cpu-profiles', 'profile-1-1-calculator.cpuprofile.tmp'), '{}');
  let starts = 0;
  const worker = new EventEmitter(); worker.startCpuProfile = async () => { starts++; return { stop: async () => ({ nodes: [1] }) }; };
  profiles.attach(worker);
  const started = profiles.start(600); await entered.promise;
  assert.equal(profiles.status().starting, true); assert.equal(profiles.status().active, true);
  let stopped = false;
  const stopping = profiles.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false); assert.equal(profiles.status().stopping, true);
  await assert.rejects(profiles.start(60), { status: 409 });
  release.resolve(); await Promise.all([started, stopping]);
  assert.equal(starts, 0); assert.deepEqual(await profiles.list(), []);
  assert.deepEqual(profiles.status(), { enabled: true, active: false, starting: false, deadline: null, stopping: false, failures: 0, retirements: 0 });
});

test('concurrent capture starts reserve one owner synchronously', async t => {
  const profiles = await createDeepProfiles(await temporary(t)); t.after(() => profiles.close());
  let starts = 0;
  const worker = new EventEmitter(); worker.startCpuProfile = async () => { starts++; return { stop: async () => ({ nodes: [1] }) }; };
  profiles.attach(worker);
  const first = profiles.start(60);
  assert.equal(profiles.status().starting, true);
  await assert.rejects(profiles.start(60), { status: 409 });
  await first; assert.equal(profiles.status().starting, false); assert.equal(starts, 1);
  await profiles.stop();
  const cancelled = profiles.start(600), stopped = profiles.stop();
  await Promise.all([cancelled, stopped]); assert.equal(starts, 1);
  assert.equal(profiles.status().active, false);
});


test('one failed admission disables the capture before replacements or other workers join', async t => {
  const profiles = await createDeepProfiles(await temporary(t));
  t.after(() => profiles.close());
  let starts = 0, replacements = 0;
  const worker = new EventEmitter();
  worker.startCpuProfile = async () => {
    starts++;
    worker.profileRetiring = true; worker.emit('profile-retiring');
    for (let index = 0; index < 12; index++) {
      const replacement = new EventEmitter();
      replacement.startCpuProfile = async () => { replacements++; throw new Error('Synthetic failure.'); };
      profiles.attach(replacement);
    }
    throw new Error('Synthetic native uncertainty.');
  };
  profiles.attach(worker);
  await profiles.start(60); await profiles.stop();
  assert.equal(starts, 1); assert.equal(replacements, 0);
  assert.equal(profiles.status().active, false);
  assert.ok(profiles.status().failures > 0);
});


test('a failed capture retires at most one calculator and replacements finish foreground work', async t => {
  const profiles = await createDeepProfiles(await temporary(t)), workers = [];
  let starts = 0;
  const scheduler = await createTaskScheduler({ maxRestarts: 0, onWorker: worker => profiles.attach(worker), workerFactory() {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = message => worker.messages.push(message);
    worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
    worker.startCpuProfile = async () => {
      starts++; worker.profileRetiring = true; worker.emit('profile-retiring'); throw new Error('Synthetic native failure.');
    };
    workers.push(worker); queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
  } });
  t.after(async () => { await profiles.close(); await scheduler.close(); });
  for (let index = 0; index < 6; index++) {
    const request = scheduler.evaluate({ revision: index }, 'synthetic-member', 'evaluate', undefined, String(index), String(index));
    const deadline = Date.now() + 3000;
    while (!workers.at(-1).messages.some(message => message.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    const worker = workers.at(-1), message = worker.messages.find(message => message.id); assert.ok(message);
    if (!index) await profiles.start(60);
    assert.ok(!worker.terminated);
    worker.messages.splice(worker.messages.indexOf(message), 1);
    worker.emit('message', { id: message.id, result: { synthetic: true } });
    assert.equal((await request).result.synthetic, true);
  }
  await profiles.stop();
  assert.equal(starts, 1); assert.equal(workers.length, 2); assert.equal(profiles.status().retirements, 1);
  assert.equal(scheduler.getHealth().restarts, 0); assert.equal(scheduler.getHealth().failures, 0);
});

for (const stage of ['Profiler.start', 'Profiler.stop']) test(`picker ${stage} acknowledgement cannot block stop or close`, { timeout: 30000 }, async t => {
  const { Session } = await import('node:inspector');
  const original = Session.prototype.post, entered = Promise.withResolvers();
  let release;
  Session.prototype.post = function(method, ...args) {
    if (method !== stage) return original.call(this, method, ...args);
    const callback = args.pop();
    return original.call(this, method, ...args, (...result) => {
      release = () => callback(...result); entered.resolve();
    });
  };
  const profiles = await createDeepProfiles(await temporary(t), { stopTimeoutMs: 20 });
  const started = profiles.start(60);
  if (stage === 'Profiler.stop') await started;
  const clock = cleanupClock(t);
  const stopping = stage === 'Profiler.stop' ? profiles.stop() : undefined;
  await entered.promise;
  const closed = profiles.close();
  try {
    if (stage === 'Profiler.stop') {
      await clock.armed(1);
      clock.tick(19); await new Promise(resolve => setImmediate(resolve));
      assert.equal(profiles.status().stopping, true);
      clock.tick(1);
    }
    await Promise.all([started, stopping, closed]);
    assert.equal(profiles.status().stopping, false);
    assert.equal(profiles.status().active, false);
  } finally {
    Session.prototype.post = original; release();
    await started; await stopping; await closed;
  }
});

test('a missing calculator start acknowledgement bounds close and retires uncertain cleanup', { timeout: 30000 }, async t => {
  const profiles = await createDeepProfiles(await temporary(t), { stopTimeoutMs: 20 });
  const entered = Promise.withResolvers(), pending = Promise.withResolvers(); let stopped = 0;
  const worker = new EventEmitter();
  worker.startCpuProfile = () => { entered.resolve(); return pending.promise; };
  profiles.attach(worker);
  let otherStarts = 0;
  const other = new EventEmitter();
  other.startCpuProfile = async () => { otherStarts++; return { stop: async () => ({ nodes: [1] }) }; };
  profiles.attach(other);
  const started = profiles.start(60); await entered.promise;
  const clock = cleanupClock(t);
  let completed = false;
  const closed = profiles.close();
  void closed.then(() => { completed = true; });
  try {
    // The picker stop arms the first bound; calculator cleanup arms the second
    // after the picker profile's real file I/O. Only then advance virtual time.
    await clock.armed(2);
    clock.tick(19); await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false, 'cleanup waits for its configured deadline');
    assert.equal(worker.profileRetiring, undefined);
    clock.tick(1); await closed;
    assert.equal(completed, true, 'the 20 ms cleanup bound releases close without an acknowledgement');
    assert.equal(worker.profileRetiring, true);
    assert.equal(otherStarts, 0);
    assert.equal(other.profileRetiring, undefined, 'an unissued admission must not retire another calculator');
    assert.equal(profiles.status().stopping, false);
  } finally {
    pending.resolve({ stop: async () => { stopped++; return { nodes: [1] }; } });
    await started; await closed; await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, 1);
  }
});
