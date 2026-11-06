import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessProfiles } from '../app/tasks/process-profiles.mjs';
import { checkpoint, manualClock, profileControls, profile } from './helpers/process-lifecycle.mjs';

function fixture() {
  const c = profileControls(), clock = manualClock();
  let retirements = 0, restores = 0;
  const profiles = createProcessProfiles({ worker: c.worker, online: c.gates.online.issue(),
    openSession: c.openSession, clock, stopTimeoutMs: 10,
    retire() { retirements++; }, restore() { restores++; } });
  return { c, clock, profiles, retirements: () => retirements, restores: () => restores };
}
const observe = promise => promise.then(value => ({ value }), error => ({ error }));
const cancelled = result => assert.match(result.error?.message ?? '', /cancelled|did not stop/);

test('repeated expiry before worker-online stops relay only and allows subsequent capture', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) {
    const started = observe(f.profiles.start(f.clock.now() + 100));
    for (const stage of ['open', 'enable', 'relay-start', 'relay-stop']) await f.c.ack(stage);
    await f.clock.advance(100); cancelled(await started);
    assert.equal(f.c.gates['native-start'].calls, 0); assert.equal(f.retirements(), 0);
  }
  assert.equal(f.c.gates['relay-stop'].calls, 4);
  const next = f.profiles.start(f.clock.now() + 100); await f.c.cleanup(); await next;
  assert.deepEqual(await f.profiles.stop(), { calculator: profile, relay: profile });
  assert.equal(f.retirements(), 0); assert.equal(f.clock.pending(), 0);
});

const admission = ['open', 'enable', 'relay-start', 'online', 'native-start'];
for (const stage of admission) for (const side of ['before', 'after']) {
  test(`cancel ${side} ${stage} acknowledgement rechecks native admission and joins cleanup`, async () => {
    const f = fixture(), started = observe(f.profiles.start(f.clock.now() + 100));
    const index = admission.indexOf(stage) + Number(side === 'after');
    for (const name of admission.slice(0, index)) await f.c.ack(name);
    await checkpoint();
    const issued = f.c.gates['native-start'].calls;
    const stopping = observe(f.profiles.cancel());
    await f.c.cleanup();
    const result = await started;
    if (stage === 'native-start' && side === 'after') assert.equal(result.error, undefined);
    else cancelled(result);
    assert.equal(f.c.gates['native-start'].calls, issued, 'cancel must never issue a new native request');
    if (issued && !(stage === 'native-start' && side === 'after')) {
      assert.match((await stopping).error.message, /did not stop/);
      assert.equal(f.retirements(), 1); assert.equal(f.restores(), 1);
    } else { assert.equal((await stopping).value, true); assert.equal(f.retirements(), 0); }
    if (issued) assert.equal(f.c.gates['native-stop'].calls, 1);
    assert.ok(f.c.calls.includes('disconnect')); assert.equal(f.clock.pending(), 0);
  });
}

test('deadline stops both captures without parent stop and retains valid output for retrieval', async () => {
  const f = fixture(), start = f.profiles.start(f.clock.now() + 100);
  await f.c.admit(); await start;
  await f.c.ack('relay-stop'); await f.c.ack('native-stop');
  await f.clock.advance(100);
  assert.equal(f.c.gates['relay-stop'].calls, 1); assert.equal(f.c.gates['native-stop'].calls, 1);
  assert.deepEqual(await f.profiles.stop(), { calculator: profile, relay: profile });
  const next = f.profiles.start(f.clock.now() + 100); await next; await f.profiles.stop();
  assert.equal(f.retirements(), 0); assert.equal(f.clock.pending(), 0);
});

test('deadline with missing relay start-ack stops sampling before its late acknowledgement', async () => {
  const f = fixture(), started = observe(f.profiles.start(f.clock.now() + 100));
  await f.c.ack('open'); await f.c.ack('enable'); await f.c.ack('relay-stop');
  assert.equal(f.c.gates['relay-start'].calls, 1);
  await f.clock.advance(100);
  cancelled(await started);
  assert.equal(f.c.gates['relay-stop'].calls, 1); assert.ok(f.c.calls.includes('disconnect'));
  assert.equal(f.retirements(), 0); assert.equal(f.c.gates['native-start'].calls, 0);
  await f.c.ack('relay-start'); await f.c.ack('online');
  assert.equal(f.c.gates['native-start'].calls, 0, 'late relay acknowledgement cannot admit a cancelled capture');
  assert.equal(f.clock.pending(), 0);
});

for (const operation of ['start', 'stop']) {
  test(`uncertain native ${operation}: deadline retires, late stop proof alone restores`, async () => {
    const f = fixture(), started = observe(f.profiles.start(f.clock.now() + 100));
    for (const name of admission.filter(name => operation !== 'start' || name !== 'native-start')) await f.c.ack(name);
    await f.c.ack('relay-stop'); await f.clock.advance(100);
    if (operation === 'stop') await f.clock.advance(10);
    assert.equal(f.retirements(), 1); assert.equal(f.restores(), 0);
    assert.ok(f.c.calls.includes('Profiler.stop')); assert.ok(f.c.calls.includes('disconnect'));
    if (operation === 'start') cancelled(await started); else assert.equal((await started).error, undefined);
    await assert.rejects(f.profiles.cancel(), /did not stop/);
    await assert.rejects(f.profiles.start(f.clock.now() + 100), /unavailable/);
    await assert.rejects(f.profiles.stop(), /did not stop/);
    await f.c.ack('native-start');
    assert.equal(f.restores(), 0, 'late start acknowledgement is not stop proof');
    await f.c.ack('native-stop');
    assert.equal(f.restores(), 1); assert.equal(f.c.gates['native-stop'].calls, 1);
    const next = f.profiles.start(f.clock.now() + 100); await next; await f.profiles.cancel();
    assert.equal(f.clock.pending(), 0);
  });
}

for (const operation of ['start', 'stop']) for (const side of ['before', 'after']) {
  test(`relay ${operation} acknowledgement ${side === 'before' ? 'withheld' : 'delivered'} at cancellation cannot block cleanup`, async () => {
    const f = fixture(), started = observe(f.profiles.start(f.clock.now() + 100));
    for (const name of ['open', 'enable']) await f.c.ack(name);
    if (operation === 'stop' || side === 'after') { await f.c.ack('relay-start'); await f.c.ack('online'); await f.c.ack('native-start'); }
    await checkpoint();
    if (operation === 'stop' && side === 'after') await f.c.ack('relay-stop');
    await f.c.ack('native-stop');
    const stopping = f.profiles.cancel(); await checkpoint();
    await f.clock.advance(10); assert.equal(await stopping, true);
    assert.equal(f.retirements(), 0); assert.ok(f.c.calls.includes('disconnect'));
    await f.c.cleanup(); await started; assert.equal(f.clock.pending(), 0);
  });
}

for (const stalled of [false, true]) test(`relay failure still joins ${stalled ? 'uncertain' : 'healthy'} native cleanup`, async () => {
  const f = fixture(), started = f.profiles.start(f.clock.now() + 100);
  await f.c.admit(); await started;
  if (!stalled) await f.c.ack('native-stop');
  const stopping = observe(f.profiles.cancel());
  f.c.gates['relay-stop'].fail(); await checkpoint();
  if (stalled) await f.clock.advance(10);
  const result = await stopping;
  assert.equal(f.retirements(), Number(stalled)); assert.ok(f.c.calls.includes('disconnect'));
  if (stalled) { assert.match(result.error.message, /did not stop/); await f.c.ack('native-stop'); }
  else assert.equal(result.value, true);
  assert.equal(f.clock.pending(), 0);
});

test('invalid, expired and concurrent admissions are refused without disturbing ownership', async () => {
  const f = fixture();
  for (const deadline of [NaN, Infinity, f.clock.now(), f.clock.now() - 1]) await assert.rejects(f.profiles.start(deadline), /unavailable/);
  const started = f.profiles.start(f.clock.now() + 100); await f.c.admit(); await started;
  await assert.rejects(f.profiles.start(f.clock.now() + 100), /unavailable/);
  await f.c.cleanup(); await f.profiles.cancel(); assert.equal(f.clock.pending(), 0);
});
