import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { serialize, deserialize } from 'node:v8';
import childProcesses from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { encodeProcessMessage, decodeProcessMessage } from '../app/tasks/process-worker-transport.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

const definitions = {
  chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Quest: { 'Present quest': { Chunks: ['12341'] }, 'Future quest': { Chunks: ['12342'] } } },
};
function sharedBytes(value) {
  const bytes = Buffer.from(value), shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes); return shared;
}
function waitFor(worker, predicate) {
  return new Promise((resolve, reject) => {
    const message = value => { if (predicate(value)) { cleanup(); resolve(value); } };
    const error = value => { cleanup(); reject(value); };
    const exit = () => error(new Error('Process exited before the expected response.'));
    const cleanup = () => { worker.off('message', message); worker.off('error', error); worker.off('exit', exit); };
    worker.on('message', message); worker.on('error', error); worker.on('exit', exit);
  });
}
async function fixture(t, options = {}) {
  const world = buildWorld(definitions);
  const worker = new ProcessWorker(genericWorkerData({ definitionBytes: sharedBytes(JSON.stringify(definitions)),
    world: { chunks: world.chunks, surface: world.surface } }), options);
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.type, 'ready'); assert.ok(ready.catalogue.length > 0);
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12341'] }]);
  let id = 0;
  return { worker, state, send: async request => {
    const sequence = ++id, result = waitFor(worker, value => value.id === sequence && !['progress', 'prediction-prepared'].includes(value.type));
    worker.postMessage({ id: sequence, state, memberId: 'player1', ...request });
    return result;
  } };
}

test('process transport preserves shared aliases, cycles, views and native containers without interpreting data keys', () => {
  const shared = sharedBytes('abcdefghijklmnop');
  const view = new Uint16Array(shared, 2, 3), buffer = Buffer.from('gzip bytes');
  const original = { shared, view, sharedBuffer: Buffer.from(shared, 4, 3), nested: { unlockReuse: { playJSON: shared },
    partnerUnlockReuse: { gzipJSONPrefixes: { playJSON: buffer } } }, date: new Date('2026-01-01'),
    ordinaryView: new Float64Array([1, 2]), ordinaryBuffer: new ArrayBuffer(4),
    data: { shared: [], views: [], placeholder: {}, bytes: 'user-defined keys' } };
  original.map = new Map([[original, new Set([shared, view])]]); original.self = original;
  const decoded = decodeProcessMessage(deserialize(serialize(encodeProcessMessage(original))));
  assert.equal(decoded.self, decoded);
  assert.equal(decoded.nested.unlockReuse.playJSON, decoded.shared);
  assert.equal(decoded.view.buffer, decoded.shared); assert.equal(decoded.view.byteOffset, 2);
  assert.equal(decoded.sharedBuffer.buffer, decoded.shared); assert.ok(Buffer.isBuffer(decoded.sharedBuffer));
  assert.ok(decoded.map instanceof Map); assert.ok(decoded.map.get(decoded) instanceof Set);
  assert.ok(decoded.map.get(decoded).has(decoded.view)); assert.ok(decoded.map.get(decoded).has(decoded.shared));
  assert.equal(Buffer.from(decoded.shared).toString(), 'abcdefghijklmnop');
  assert.ok(Buffer.isBuffer(decoded.nested.partnerUnlockReuse.gzipJSONPrefixes.playJSON));
  assert.deepEqual(decoded.date, original.date); assert.deepEqual(decoded.ordinaryView, original.ordinaryView);
  assert.ok(decoded.ordinaryBuffer instanceof ArrayBuffer); assert.deepEqual(decoded.data, original.data);
  Atomics.store(new Uint16Array(decoded.shared), 1, 123);
  assert.equal(decoded.view[0], 123); assert.notEqual(view[0], 123, 'IPC intentionally copies shared bytes between processes');
});

test('uncloneable initialization values fail before spawning an owned child', () => {
  assert.throws(() => new ProcessWorker({ invalid: () => {} }), { name: 'DataCloneError' });
});

test('isolated task worker compiles, evaluates, reuses shared state and requests missing snapshot resend', { timeout: 15000 }, async t => {
  const { worker, state, send } = await fixture(t);
  assert.notEqual(worker.pid, process.pid);
  const object = await send({ type: 'evaluate' }); assert.equal(object.error, undefined);
  const stateJSON = sharedBytes(JSON.stringify(state)), metadata = {
    state: undefined, stateTransport: 'json-shared-v1', input: 'fixture', snapshotKey: JSON.stringify([state.revision, 'fixture']),
    stateJSONBytes: stateJSON.byteLength, stateRevision: state.revision, stateMemberIds: ['player1'],
    resultTransport: 'json-shared-v1', resultView: 'play-v1',
  };
  const fresh = await send({ ...metadata, stateJSON });
  assert.equal(fresh.error, undefined); assert.ok(fresh.playJSON instanceof SharedArrayBuffer);
  const cached = await send(metadata); assert.equal(cached.error, undefined);
  assert.deepEqual(JSON.parse(Buffer.from(cached.playJSON).toString()), JSON.parse(Buffer.from(fresh.playJSON).toString()));
  const missing = await send({ ...metadata, input: 'missing', snapshotKey: JSON.stringify([state.revision, 'missing']) });
  assert.equal(missing.error.name, 'RangeError'); assert.match(missing.error.message, /resend/);
  const resent = await send({ ...metadata, input: 'missing', snapshotKey: JSON.stringify([state.revision, 'missing']), stateJSON });
  assert.equal(resent.error, undefined);
  worker.postMessage({ type: 'supersede', revision: state.revision + 1 });
  const memory = await worker.getMemoryUsage();
  assert.equal(memory.pid, worker.pid); assert.ok(memory.main.rss > 0); assert.deepEqual(memory.workers, []);
});

// This test-only preload witnesses a host-local cancellation word during
// synchronous worker work. Its memory listener uses the same diagnostic port
// contract as the optional performance harness; no app worker code changes.
const probeImport = `data:text/javascript;base64,${Buffer.from(`
  import { parentPort, threadId } from 'node:worker_threads';
  parentPort.on('message', message => {
    if (message.memoryPort) {
      message.memoryPort.postMessage({ threadId, memoryUsage: process.memoryUsage() }); message.memoryPort.close();
    }
    if (message.testWaitForCancellation) {
      const flag = new Int32Array(message.cancellation), deadline = Date.now() + 4000;
      parentPort.postMessage({ type: 'progress', id: message.id, testBlocked: true });
      while (!Atomics.load(flag, 0) && Date.now() < deadline) Atomics.wait(flag, 0, 0, 20);
      parentPort.postMessage({ type: 'progress', id: message.id, testCancellationObserved: !!Atomics.load(flag, 0) });
    }
  });
`).toString('base64')}`;

test('cancel IPC updates the child-local SAB while its worker is synchronous; isolate memory can be probed', { timeout: 15000 }, async t => {
  const { worker, state } = await fixture(t, { probeImport });
  const cancellation = new SharedArrayBuffer(4), id = 99;
  const blocked = waitFor(worker, message => message.id === id && message.testBlocked);
  const observed = waitFor(worker, message => message.id === id && 'testCancellationObserved' in message);
  const completed = waitFor(worker, message => message.id === id && message.type !== 'progress');
  worker.postMessage({ id, state, memberId: 'player1', cancellation, testWaitForCancellation: true });
  await blocked;
  Atomics.store(new Int32Array(cancellation), 0, 1);
  worker.postMessage({ type: 'cancel', id });
  assert.equal((await observed).testCancellationObserved, true);
  assert.equal((await completed).error, undefined);
  const memory = await worker.getMemoryUsage();
  assert.equal(memory.workers.length, 1); assert.ok(memory.workers[0].threadId > 0);
  assert.ok(memory.workers[0].memoryUsage.heapUsed > 0);
});

test('terminate is idempotent and resolves only after its owned process exits', { timeout: 15000 }, async t => {
  const { worker } = await fixture(t);
  const pid = worker.pid, exit = once(worker, 'exit');
  const first = worker.terminate(), second = worker.terminate(); assert.equal(first, second);
  const code = await first; assert.equal((await exit)[0], code);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.throws(() => worker.postMessage({ id: 1 }), /stopped/);
  await assert.rejects(worker.getMemoryUsage(), /stopped/);
});

test('initialization failure forwards the worker error and leaves no child process', { timeout: 15000 }, async t => {
  const worker = new ProcessWorker({ definitions: null });
  t.after(() => worker.terminate());
  const exited = new Promise(resolve => worker.once('exit', resolve));
  const [error] = await once(worker, 'error'); assert.ok(error instanceof Error);
  await exited; assert.throws(() => process.kill(worker.pid, 0), { code: 'ESRCH' });
});

test('a host that ignores graceful termination is killed before retirement resolves', { timeout: 10000 }, async () => {
  const original = childProcesses.fork, child = new EventEmitter(), signals = [];
  child.pid = 123; child.connected = true;
  child.send = (message, callback) => callback?.();
  child.kill = signal => { signals.push(signal); if (signal === 'SIGKILL') child.emit('exit', null, signal); return true; };
  childProcesses.fork = () => child; syncBuiltinESMExports();
  try {
    const worker = new ProcessWorker({ definitions });
    let retired = false;
    const retirement = worker.terminate().then(() => { retired = true; });
    assert.equal(retired, false);
    await retirement;
    assert.equal(retired, true); assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  } finally { childProcesses.fork = original; syncBuiltinESMExports(); }
});

// kill(pid, 0) also succeeds for Linux zombies. An orphan can have exited
// without being reaped when a container's PID 1 does not collect children.
async function processHasExited(pid, { platform = process.platform, kill = process.kill,
  readStat = pid => readFile(`/proc/${pid}/stat`, 'utf8') } = {}) {
  try { kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  if (platform !== 'linux') return false;
  let stat;
  try { stat = await readStat(pid); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  // comm can contain spaces, newlines and ')'; the state follows its final ')'.
  const match = /^\d+ \([\s\S]*\) ([A-Za-z]) /.exec(stat);
  assert.ok(match, 'expected a Linux /proc/<pid>/stat process state');
  return match[1] === 'Z' || match[1] === 'X';
}

test('orphan exit detection distinguishes live, stopped, zombie and missing processes', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ESRCH' });
  const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
  const gone = Object.assign(new Error('gone'), { code: 'ENOENT' });
  const kill = () => {};
  for (const state of ['R', 'S', 'D', 'T', 't', 'I', 'Z', 'X']) {
    assert.equal(await processHasExited(123, { platform: 'linux', kill,
      readStat: async () => `123 (name with ) and\nspaces) ${state} 1 2 3` }), ['Z', 'X'].includes(state), state);
  }
  for (const platform of ['linux', 'win32', 'darwin']) {
    assert.equal(await processHasExited(123, { platform, kill: () => { throw missing; } }), true);
    await assert.rejects(processHasExited(123, { platform, kill: () => { throw denied; } }), { code: 'EPERM' });
  }
  for (const platform of ['win32', 'darwin']) {
    assert.equal(await processHasExited(123, { platform, kill, readStat: () => assert.fail('must not read /proc') }), false);
  }
  assert.equal(await processHasExited(123, { platform: 'linux', kill, readStat: async () => { throw gone; } }), true);
  await assert.rejects(processHasExited(123, { platform: 'linux', kill, readStat: async () => { throw denied; } }), { code: 'EPERM' });
  await assert.rejects(processHasExited(123, { platform: 'linux', kill, readStat: async () => 'malformed' }), /process state/);
});

test('an owned calculator exits when its parent disappears without calling terminate', { timeout: 15000 }, async t => {
  if (process.platform === 'linux') {
    try { await readFile('/proc/self/stat', 'utf8'); }
    catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      t.skip(`Linux orphan exit detection requires readable /proc/<pid>/stat (${error.code})`);
      return;
    }
  }
  const parent = childProcesses.fork(new URL('./fixtures/process-worker-parent.mjs', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  let workerPid;
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill(); if (workerPid) try { process.kill(workerPid, 'SIGKILL'); } catch {} });
  const [ready] = await once(parent, 'message'); workerPid = ready.workerPid;
  assert.ok(workerPid > 0); assert.doesNotThrow(() => process.kill(workerPid, 0));
  const exited = once(parent, 'exit'); parent.send({ stop: true }); await exited;
  const deadline = Date.now() + 5000;
  while (true) {
    if (await processHasExited(workerPid)) { workerPid = undefined; break; }
    assert.ok(Date.now() < deadline, 'calculator must exit after parent IPC disconnect');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('process member preparation observes cancellation while scanning and preserves both members results', async t => {
  const source = { ...definitions, challenges: { Quest: Object.fromEntries(Array.from({ length: 16000 }, (_, i) =>
    [`Member preparation ${i}`, { Chunks: [i % 2 ? '12341' : '12342'] }])) } };
  const world = buildWorld(source), worker = new ProcessWorker(genericWorkerData({ definitions: source,
    world: { chunks: world.chunks, surface: world.surface } }));
  t.after(() => worker.terminate());
  await waitFor(worker, m => m.type === 'ready');
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]);
  const send = (id, memberId, extra = {}) => {
    const result = waitFor(worker, m => m.id === id && m.type !== 'progress');
    worker.postMessage({ id, type: 'evaluate', state, memberId, resultTransport: 'json-shared-v1', resultView: 'play-v1', ...extra });
    return result;
  };
  const semantic = response => { const value = JSON.parse(Buffer.from(response.playJSON).toString()); delete value.metrics.elapsedMs; return value; };
  const one = semantic(await send(1, 'one'));
  const cancelled = send(2, 'two', { memberPreparation: true, cancellation: new SharedArrayBuffer(4) });
  await new Promise(resolve => setTimeout(resolve, 10));
  worker.postMessage({ type: 'cancel', id: 2 });
  assert.equal((await cancelled).cancelled, true, 'host must set the shared flag even while the worker event loop is busy');
  const prepared = await send(3, 'two', { memberPreparation: true, cancellation: new SharedArrayBuffer(4) });
  const ordinary = await send(4, 'two');
  assert.deepEqual(semantic(prepared), semantic(ordinary));
  assert.ok(ordinary.timingMs.engineMs > 0, 'preparation does not retain an ordinary full graph snapshot');
  assert.deepEqual(semantic(await send(5, 'one')), one);
});
