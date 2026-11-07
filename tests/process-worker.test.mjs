import './helpers/file-safety-stop.mjs';
import { waitForCondition } from './helpers/condition.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize, deserialize } from 'node:v8';
import childProcesses from 'node:child_process';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { encodeProcessMessage, decodeProcessMessage } from '../app/tasks/process-worker-transport.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';
import { createDeepProfiles } from '../app/deep-profiles.mjs';
import { checkpoint, profile } from './helpers/process-lifecycle.mjs';
import { adapterFixture, hostFixture } from './helpers/process-host.mjs';

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
  const pending = new Promise((resolve, reject) => {
    const message = value => { if (predicate(value)) { cleanup(); resolve(value); } };
    const error = value => { cleanup(); reject(value); };
    const exit = () => error(new Error('Process exited before the expected response.'));
    const cleanup = () => { worker.off('message', message); worker.off('error', error); worker.off('exit', exit); };
    worker.on('message', message); worker.on('error', error); worker.on('exit', exit);
  });
  // Several observations can be outstanding when a real witness fails. They
  // still reject their callers, without secondary unhandled-rejection noise.
  pending.catch(() => {}); return pending;
}
async function fixture(t, options = {}) {
  t.diagnostic('phase: spawning real relay host and calculator');
  const world = buildWorld(definitions);
  const worker = new ProcessWorker(genericWorkerData({ definitionBytes: sharedBytes(JSON.stringify(definitions)),
    world: { chunks: world.chunks, surface: world.surface } }), options);
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.type, 'ready'); assert.ok(ready.catalogue.length > 0);
  t.diagnostic('phase: calculator ready');
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
  assert.throws(() => new ProcessWorker({ invalid: () => {} }, { forkProcess() { assert.fail('must serialize before fork'); } }), { name: 'DataCloneError' });
});

test('isolated task worker compiles, evaluates, reuses shared state and requests missing snapshot resend', async t => {
  const { worker, state, send } = await fixture(t, { trackRss: true });
  assert.notEqual(worker.pid, process.pid);
  assert.ok(worker.rssBytes > 0, 'process RSS reports arrive independently of calculation replies');
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

const probeImport = new URL('./fixtures/process-worker-probe.mjs', import.meta.url).href;

test('cancel IPC updates the child-local SAB while its worker is synchronous; isolate memory can be probed', async t => {
  t.diagnostic('phase: real IPC witness starting');
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

test('terminate is idempotent and resolves only after its owned process exits', async t => {
  t.diagnostic('phase: real IPC witness starting');
  const { worker } = await fixture(t);
  const pid = worker.pid, exit = once(worker, 'exit');
  const first = worker.terminate(), second = worker.terminate(); assert.equal(first, second);
  const code = await first; assert.equal((await exit)[0], code);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.throws(() => worker.postMessage({ id: 1 }), /stopped/);
  await assert.rejects(worker.getMemoryUsage(), /stopped/);
});

test('initialization failure forwards the worker error and leaves no child process', async t => {
  const worker = new ProcessWorker({ definitions: null });
  t.after(() => worker.terminate());
  const exited = new Promise(resolve => worker.once('exit', resolve));
  const [error] = await once(worker, 'error'); assert.ok(error instanceof Error);
  await exited; assert.throws(() => process.kill(worker.pid, 0), { code: 'ESRCH' });
});


// kill(pid, 0) also succeeds for Linux zombies. An orphan can have exited
// without being reaped when a container's PID 1 does not collect children.
async function processHasExited(pid, { platform = process.platform, kill = process.kill,
  readStat = pid => readFile(`/proc/${pid}/stat`, 'utf8') } = {}) {
  try { kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  if (platform !== 'linux') return false;
  let stat;
  // A reap between open and read makes Linux return ESRCH from the read.
  try { stat = await readStat(pid); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return true; throw error; }
  // comm can contain spaces, newlines and ')'; the state follows its final ')'.
  const match = /^\d+ \([\s\S]*\) ([A-Za-z]) /.exec(stat);
  assert.ok(match, 'expected a Linux /proc/<pid>/stat process state');
  return match[1] === 'Z' || match[1] === 'X';
}

const osError = code => Object.assign(new Error('Synthetic process metadata failure.'), { code });
const orphanStates = [
  ...['R', 'S', 'D', 'T', 't', 'I', 'Z', 'X'].map(state => ({
    name: `Linux state ${state}`, platform: 'linux', expected: ['Z', 'X'].includes(state),
    readStat: async () => `123 (name with ) and\nspaces) ${state} 1 2 3`,
  })),
  ...['linux', 'win32', 'darwin'].flatMap(platform => [
    { name: `${platform} missing at existence check`, platform, killError: 'ESRCH', expected: true },
    { name: `${platform} existence check denied`, platform, killError: 'EPERM', error: 'EPERM' },
  ]),
  ...['win32', 'darwin'].map(platform => ({ name: `${platform} live without proc metadata`, platform, expected: false })),
  ...['ENOENT', 'ESRCH'].map(code => ({ name: `Linux opened-then-reaped (${code})`, platform: 'linux', statError: code, expected: true })),
  { name: 'Linux metadata denied', platform: 'linux', statError: 'EPERM', error: 'EPERM' },
  { name: 'Linux malformed metadata', platform: 'linux', readStat: async () => 'malformed', error: /process state/ },
];
for (const row of orphanStates) test(`orphan state: ${row.name}`, async () => {
  const result = processHasExited(123, { platform: row.platform,
    kill() { if (row.killError) throw osError(row.killError); },
    readStat: row.readStat ?? (async () => {
      if (row.statError) throw osError(row.statError);
      assert.fail('this state must not open /proc metadata');
    }),
  });
  if (row.error) await assert.rejects(result, typeof row.error === 'string' ? { code: row.error } : row.error);
  else assert.equal(await result, row.expected);
});

test('an owned calculator exits when its parent disappears without calling terminate', async t => {
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
  t.diagnostic('phase: waiting for owned parent/calculator ready');
  const [ready] = await once(parent, 'message'); workerPid = ready.workerPid;
  assert.ok(workerPid > 0); assert.doesNotThrow(() => process.kill(workerPid, 0));
  const exited = once(parent, 'exit'); parent.send({ stop: true }); await exited;
  t.diagnostic('phase: parent exited; observing actual orphan state');
  await waitForCondition(() => processHasExited(workerPid));
  workerPid = undefined;

});

const observe = promise => promise.then(value => ({ value }), error => ({ error }));

test('real native profiler and IPC return both valid captures and permit reuse', async t => {
  const { worker } = await fixture(t);
  for (let index = 0; index < 2; index++) {
    t.diagnostic(`phase: real native start ${index + 1}`);
    const handle = await worker.startCpuProfile();
    t.diagnostic(`phase: real native stop ${index + 1}`);
    const result = await handle.stop();
    for (const kind of ['calculator', 'relay']) {
      const capture = typeof result[kind] === 'string' ? JSON.parse(result[kind]) : result[kind];
      assert.ok(capture.nodes.length > 0, `${kind} has native profile nodes`);
      assert.ok(capture.endTime >= capture.startTime, `${kind} has a valid time span`);
    }
  }
});

test('host deadline stops both captures before any parent stop request', async t => {
  const f = hostFixture(t), started = f.worker.startCpuProfile({ deadline: f.clock.now() + 100 });
  await f.admit(); const handle = await started;
  await f.c.ack('relay-stop'); await f.c.ack('native-stop');
  await f.clock.advance(100);
  assert.equal(f.inbound.filter(m => m.operation === 'stop').length, 0);
  assert.equal(f.c.gates['relay-stop'].calls, 1); assert.equal(f.c.gates['native-stop'].calls, 1);
  assert.deepEqual(await handle.stop(), { calculator: profile, relay: profile });
  const next = await f.worker.startCpuProfile(); await next.stop(); assert.deepEqual(f.exits, []);
});

test('expiry before worker-online preserves foreground and repeated capture admission', async t => {
  const f = hostFixture(t);
  f.worker.postMessage({ id: 1, type: 'evaluate' });
  for (let index = 0; index < 4; index++) {
    const started = observe(f.worker.startCpuProfile({ deadline: f.clock.now() + 100 }));
    for (const stage of ['open', 'enable', 'relay-start', 'relay-stop']) await f.c.ack(stage);
    await f.clock.advance(100);
    assert.match((await started).error.message, /unavailable/);
    assert.equal(f.c.gates['native-start'].calls, 0);
    assert.equal(f.worker.profileRetiring, undefined); assert.deepEqual(f.exits, []);
  }
  f.complete(); f.online();
  const next = f.worker.startCpuProfile(); await f.c.cleanup(); await (await next).stop();
  assert.deepEqual(f.exits, []);
});

test('parent timeout before worker-online proves cleanup without retiring foreground', async t => {
  const f = hostFixture(t), started = observe(f.worker.startCpuProfile());
  f.worker.postMessage({ id: 1, type: 'evaluate' });
  for (const stage of ['open', 'enable', 'relay-start', 'relay-stop']) await f.c.ack(stage);
  await f.clock.advance(200);
  assert.match((await started).error.message, /unavailable/);
  assert.equal(f.c.gates['native-start'].calls, 0); assert.equal(f.c.gates['relay-stop'].calls, 1);
  assert.equal(f.worker.profileRetiring, undefined); assert.deepEqual(f.exits, []);
  f.complete(); f.online(); await checkpoint(); assert.deepEqual(f.exits, []);
});

for (const operation of ['start', 'stop']) for (const lateCleanup of [false, true]) {
  test(`native ${operation} uncertainty ${lateCleanup ? 'restores on late stop proof' : 'retires after foreground-complete'}`, async t => {
    const f = hostFixture(t);
    f.worker.postMessage({ id: 1, type: 'evaluate' });
    const started = observe(f.worker.startCpuProfile({ deadline: f.clock.now() + 100 }));
    for (const name of ['open', 'enable', 'relay-start']) await f.c.ack(name);
    f.online(); await checkpoint();
    assert.equal(f.c.gates['native-start'].calls, 1, 'phase: request-issued before deadline');
    if (operation === 'stop') await f.c.ack('native-start');
    await f.c.ack('relay-stop'); await f.clock.advance(100);
    if (operation === 'stop') await f.clock.advance(10);
    assert.equal(f.worker.profileRetiring, true);
    assert.deepEqual(f.exits, [], 'uncertainty cannot retire foreground work');
    await assert.rejects(f.worker.startCpuProfile(), /unavailable/);
    await f.clock.advance(2500);
    assert.deepEqual(f.exits, [], 'no former kill deadline may retire foreground work');
    if (lateCleanup) {
      await f.c.ack('native-start');
      assert.equal(f.worker.profileRetiring, true, 'start-ack is not stop proof');
      await f.c.ack('native-stop'); assert.equal(f.worker.profileRetiring, undefined);
    }
    const completed = once(f.worker, 'message'); f.complete();
    assert.equal((await completed)[0].id, 1);
    await checkpoint();
    assert.equal(f.exits.length, Number(!lateCleanup));
    const result = await started;
    if (operation === 'start') assert.match(result.error.message, /unavailable/);
    else assert.equal(result.error, undefined);
    if (lateCleanup) {
      f.worker.postMessage({ id: 2, type: 'evaluate' }); f.complete(2);
      const next = await f.worker.startCpuProfile(); await next.stop(); assert.deepEqual(f.exits, []);
    }
  });
}

for (const acknowledgement of ['delayed', 'missing']) {
  test(`${acknowledgement} start-ack disables capture; only cleanup proof restores foreground`, async t => {
    let held;
    const f = hostFixture(t, { drop(message) {
      if (message.kind === 'profile' && !message.error && !message.profile) { held = message; return true; }
      return message.kind === 'profile-cleaned' || message.cancelled;
    } });
    f.worker.postMessage({ id: 1, type: 'evaluate' });
    const started = observe(f.worker.startCpuProfile()); await f.admit();
    assert.ok(held, 'phase: start-ack held after actual host acknowledgement');
    await f.c.ack('relay-stop'); await f.c.ack('native-stop');
    await f.clock.advance(200);
    assert.match((await started).error.message, /unavailable/);
    assert.equal(f.worker.profileRetiring, true); assert.deepEqual(f.exits, []);
    if (acknowledgement === 'delayed') f.child.emit('message', held);
    await checkpoint(); assert.equal(f.worker.profileRetiring, true);
    f.child.emit('message', { kind: 'profile-cleaned' }); await checkpoint();
    assert.equal(f.worker.profileRetiring, undefined);
    f.complete(); await checkpoint(); assert.deepEqual(f.exits, []);
    assert.equal(f.c.gates['native-stop'].calls, 1); assert.equal(f.c.gates['relay-stop'].calls, 1);
  });
}

test('cancelled profile reply never publishes a profile or grants a capture handle', async t => {
  const f = adapterFixture(t), started = observe(f.worker.startCpuProfile());
  const request = f.sent.find(message => message.operation === 'start');
  f.reply({ kind: 'profile', id: request.id, cancelled: true, error: true, profile: { calculator: profile, relay: profile } });
  assert.match((await started).error?.message ?? '', /unavailable/);
  assert.equal(f.sent.filter(message => message.operation === 'stop').length, 0);
});

test('cancelled calculator and relay profiles never reach published storage', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cancelled-profile-'));
  const f = adapterFixture(t), profiles = await createDeepProfiles(directory);
  t.after(async () => { await profiles.close(); await rm(directory, { recursive: true, force: true }); });
  f.child.on('request-issued', message => {
    if (message.kind !== 'profile') return;
    f.reply({ kind: 'profile', id: message.id, ...(message.operation === 'stop'
      ? { cancelled: true, error: true, profile: { calculator: profile, relay: profile } } : {}) });
  });
  profiles.attach(f.worker);
  await profiles.start(); await profiles.stop();
  const published = await profiles.list();
  assert.equal(published.filter(entry => /-(calculator|relay)\./.test(entry.name)).length, 0,
    'cancelled worker bytes must never be published');
  assert.ok(published.some(entry => /-picker\./.test(entry.name)), 'real picker capture is still published');
  assert.ok(profiles.status().failures > 0); assert.equal(profiles.status().active, false);
});

test('graceful escalation issues SIGTERM then SIGKILL and joins exit exactly once', async t => {
  const f = adapterFixture(t);
  f.child.kill = signal => { f.signals.push(signal); if (signal === 'SIGKILL') f.child.emit('exit', null, signal); };
  let retired = false;
  const retirement = f.worker.terminate(); assert.equal(retirement, f.worker.terminate());
  void retirement.then(() => { retired = true; });
  await f.clock.advance(999); assert.equal(retired, false); assert.deepEqual(f.signals, []);
  await f.clock.advance(1); assert.deepEqual(f.signals, ['SIGTERM']); assert.equal(retired, false);
  await f.clock.advance(1000); await retirement;
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']); assert.equal(retired, true); assert.equal(f.clock.pending(), 0);
});

test('real forced kill joins the owned host exit', async t => {
  const { worker } = await fixture(t), pid = worker.pid;
  t.diagnostic('phase: owned host ready; sending SIGKILL');
  const exit = once(worker, 'exit'), retirement = worker.terminate({ force: true });
  assert.equal(await retirement, (await exit)[0]);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('RSS samples retain the last valid measurement, including decreases', async t => {
  const f = adapterFixture(t);
  f.reply({ kind: 'memory-rss', rssBytes: 200 }); assert.equal(f.worker.rssBytes, 200);
  for (const rssBytes of [undefined, NaN, Infinity, -1, '0', 1.5]) {
    f.reply({ kind: 'memory-rss', rssBytes }); assert.equal(f.worker.rssBytes, 200);
  }
  await f.clock.advance(500); assert.equal(f.worker.rssBytes, 200);
  f.reply({ kind: 'memory-rss', rssBytes: 100 }); assert.equal(f.worker.rssBytes, 100);
});

test('memory emergency upgrades graceful retirement to immediate force-kill', async t => {
  const f = adapterFixture(t), retirement = f.worker.terminate();
  assert.equal(f.worker.terminate({ force: true }), retirement);
  assert.deepEqual(f.signals, ['SIGKILL']); await retirement; assert.equal(f.clock.pending(), 0);
});

test('parent IPC disappearance stops the owned host even during foreground work', async t => {
  const f = hostFixture(t);
  f.worker.postMessage({ id: 1, type: 'evaluate' });
  f.parent.connected = false; f.parent.emit('disconnect'); await checkpoint();
  assert.deepEqual(f.exits, [0], 'orphan shutdown must stop the owned host');
});

const hostTransitions = [
  ['relay-ready', async f => { for (const name of ['open', 'enable', 'relay-start']) await f.c.ack(name); }],
  ['worker-online', async f => { f.online(); await checkpoint(); }],
  ['request-issued', async f => { assert.equal(f.c.gates['native-start'].calls, 1); }],
  ['start-ack', f => f.c.ack('native-start')],
  ['deadline', f => f.clock.advance(100)],
  ['stop-ack', async f => { await f.c.ack('relay-stop'); await f.c.ack('native-stop'); }],
  ['foreground-complete', async f => { f.complete(); await checkpoint(); }],
];
for (const [index, [phase]] of hostTransitions.entries()) for (const side of ['before', 'after']) {
  test(`host cancellation ${side} ${phase} joins acknowledgements without losing foreground`, async t => {
    const f = hostFixture(t);
    f.worker.postMessage({ id: 1, type: 'evaluate' });
    const started = observe(f.worker.startCpuProfile({ deadline: f.clock.now() + 100 }));
    await checkpoint();
    for (const [, transition] of hostTransitions.slice(0, index + Number(side === 'after'))) await transition(f);
    const issued = f.c.gates['native-start'].calls;
    f.parent.emit('message', { kind: 'profile', operation: 'cancel', id: 'cancel-proof' });
    await checkpoint(); await f.c.cleanup();
    assert.equal(f.c.gates['native-start'].calls, issued, 'cancel cannot admit new native work');
    assert.equal(f.c.gates['native-stop'].calls, issued, 'every issued native handle is stopped');
    assert.equal(f.worker.profileRetiring, undefined, 'late cleanup restores the adapter');
    assert.deepEqual(f.exits, [], 'cancel and late acknowledgement preserve foreground');
    if (!(phase === 'foreground-complete' && side === 'after')) f.complete();
    await checkpoint(); await started;
    assert.deepEqual(f.exits, []); assert.equal(f.clock.pending(), 0);
    if (issued && index + Number(side === 'after') < 4) {
      assert.ok(f.outbound.some(message => message.kind === 'profile-retiring'), 'missing native start-ack reports uncertainty');
      assert.ok(f.outbound.some(message => message.kind === 'profile-cleaned'), 'late stop-ack proves cleanup');
    } else assert.ok(f.outbound.some(message => message.id === 'cancel-proof' && message.cancelled), 'cancel acknowledged');
  });
}
