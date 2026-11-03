import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createProcessProfiles } from '../app/tasks/process-profiles.mjs';

function fixture(options = {}) {
  const online = Promise.withResolvers(), relayStarted = Promise.withResolvers();
  const calls = [], retired = Promise.withResolvers(); let retirements = 0;
  const session = { disconnect() { calls.push('disconnect'); }, post(method, callback) {
    calls.push(method); if (method === 'Profiler.start') relayStarted.resolve();
    callback(null, { profile: { nodes: [1] } });
  } };
  const worker = { startCpuProfile() { calls.push('native-start'); return { stop: async () => { calls.push('native-stop'); return { nodes: [1] }; } }; } };
  const profiles = createProcessProfiles({ worker, online: online.promise, retire() { retirements++; retired.resolve(); }, openSession: async () => session, stopTimeoutMs: 20, ...options });
  return { profiles, online, relayStarted, calls, retired: retired.promise, retirements: () => retirements };
}

test('expiry while waiting online stops only the relay; repeated captures preserve the calculator', async () => {
  const f = fixture();
  for (let index = 0; index < 4; index++) {
    const started = assert.rejects(f.profiles.start(Date.now() + 30), /cancelled/);
    // Keep this unit test alive while the production watchdog is unreferenced.
    await delay(45); await started;
    assert.equal(f.retirements(), 0); assert.ok(!f.calls.includes('native-start'));
  }
  assert.equal(f.calls.filter(call => call === 'Profiler.stop').length, 4);
  f.online.resolve(); await f.profiles.start(Date.now() + 1000); await f.profiles.stop();
  assert.equal(f.calls.filter(call => call === 'native-start').length, 1);
  assert.equal(f.retirements(), 0);
});

for (const stage of ['open', 'Profiler.enable', 'Profiler.start', 'online']) {
  test(`cancellation during ${stage} is rechecked before issuing a native request`, async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const calls = [], retired = Promise.withResolvers(); let retirements = 0;
    const session = { disconnect() { calls.push('disconnect'); }, post(method, callback) {
      calls.push(method);
      if (method === stage) { entered.resolve(); void release.promise.then(() => callback(null, {})); }
      else callback(null, { profile: {} });
    } };
    const profiles = createProcessProfiles({ worker: { startCpuProfile() { assert.fail('cancelled start reached calculator'); } },
      online: stage === 'online' ? entered.promise.then(() => release.promise) : Promise.resolve(),
      retire() { retirements++; }, openSession: async () => { if (stage === 'open') { entered.resolve(); await release.promise; } return session; } });
    const started = assert.rejects(profiles.start(Date.now() + 1000), /cancelled/);
    if (stage === 'online') { await delay(5); entered.resolve(); } else await entered.promise;
    const cancelled = profiles.cancel(); release.resolve();
    assert.equal(await cancelled, true); await started;
    assert.equal(retirements, 0); assert.ok(calls.includes('disconnect'));
  });
}

for (const operation of ['start', 'stop']) {
  test(`an uncertain native ${operation} retires and stops relay sampling at the deadline`, async () => {
    const pending = Promise.withResolvers();
    const f = fixture({ worker: { startCpuProfile() { return operation === 'start' ? pending.promise : { stop: () => pending.promise }; } } });
    f.online.resolve();
    const started = f.profiles.start(Date.now() + 30);
    const completed = operation === 'start' ? assert.rejects(started, /did not stop/) : started;
    await f.retired; await completed;
    assert.equal(f.retirements(), 1);
    assert.ok(f.calls.includes('Profiler.stop')); assert.ok(f.calls.includes('disconnect'));
    await assert.rejects(f.profiles.stop());
    if (operation === 'start') pending.resolve({ stop: async () => ({}) }); else pending.resolve({});
  });
}

test('cancelling an issued native capture proves cleanup without retirement when stop succeeds', async () => {
  const f = fixture(); f.online.resolve();
  await f.profiles.start(Date.now() + 1000);
  assert.equal(await f.profiles.cancel(), true);
  assert.equal(f.retirements(), 0);
  assert.ok(f.calls.includes('native-stop')); assert.ok(f.calls.includes('Profiler.stop'));
  await f.profiles.start(Date.now() + 1000); await f.profiles.stop();
});

for (const stalled of [false, true]) {
  test(`relay failure ${stalled ? 'waits for uncertain native cleanup' : 'preserves a healthy native calculator'}`, async () => {
    let retirements = 0, disconnected = false;
    const profiles = createProcessProfiles({ online: Promise.resolve(), stopTimeoutMs: 20, retire() { retirements++; },
      worker: { startCpuProfile: () => ({ stop: () => stalled ? new Promise(() => {}) : {} }) },
      openSession: async () => ({ disconnect() { disconnected = true; }, post(method, callback) {
        callback(method === 'Profiler.stop' ? new Error('Synthetic relay failure.') : null, {});
      } }),
    });
    await profiles.start(Date.now() + 1000);
    if (stalled) { const cancelled = assert.rejects(profiles.cancel(), /did not stop/); await delay(30); await cancelled; }
    else assert.equal(await profiles.cancel(), true);
    assert.equal(retirements, Number(stalled)); assert.equal(disconnected, true);
  });
}


for (const operation of ['start', 'stop']) {
  test(`late native ${operation} cleanup clears idle retirement without a parent stop`, async () => {
    const pending = Promise.withResolvers(); let restores = 0;
    const f = fixture({ restore() { restores++; }, worker: { startCpuProfile() {
      return operation === 'start' ? pending.promise : { stop: () => pending.promise };
    } } });
    f.online.resolve();
    const started = f.profiles.start(Date.now() + 20);
    const completion = operation === 'start' ? assert.rejects(started, /did not stop/) : started;
    await f.retired; await completion;
    assert.equal(f.retirements(), 1); assert.equal(restores, 0);
    await assert.rejects(f.profiles.cancel(), /did not stop/);
    await assert.rejects(f.profiles.start(Date.now() + 1000), /unavailable/i);
    assert.equal(restores, 0, 'a repeated cancel cannot prove uncertain native cleanup');
    if (operation === 'start') pending.resolve({ stop: async () => ({}) }); else pending.resolve({});
    await delay(5);
    assert.equal(restores, 1);
    assert.ok(f.calls.includes('Profiler.stop'));
  });
}


test('host deadline stops relay sampling while its start acknowledgement is missing', async () => {
  const entered = Promise.withResolvers(), stopped = Promise.withResolvers(); let release;
  const calls = [];
  const f = fixture({ openSession: async () => ({ disconnect() { calls.push('disconnect'); }, post(method, callback) {
    calls.push(method);
    if (method === 'Profiler.start') { release = () => callback(null, {}); entered.resolve(); }
    else { callback(null, { profile: {} }); if (method === 'Profiler.stop') stopped.resolve(); }
  } }) });
  const started = assert.rejects(f.profiles.start(Date.now() + 30), /cancelled/);
  await entered.promise;
  await Promise.race([stopped.promise, delay(1000).then(() => assert.fail('relay deadline did not stop sampling'))]);
  assert.ok(calls.includes('disconnect')); assert.equal(f.retirements(), 0);
  release(); await started;
});
