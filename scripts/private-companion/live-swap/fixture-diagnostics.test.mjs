import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRuntimeDiagnostics, overlappingGC } from './fixture-diagnostics.mjs';

test('real activation observations preserve results and include finite process resources', async () => {
  const recorder = createRuntimeDiagnostics();
  try {
    const expected = { ready: true }; assert.equal(await recorder.capture('activate', async () => expected), expected);
    const snapshot = recorder.snapshot(), operation = snapshot.operations[0];
    assert.equal(operation.failed, null); assert.ok(operation.durationMs >= 0); assert.ok(operation.cpuUsage.user >= 0); assert.ok(operation.cpuUsage.system >= 0);
    assert.ok(operation.before.heapSizeLimit > 0); assert.ok(operation.after.rss > 0); assert.ok(operation.before.heapUsed <= operation.before.heapSizeLimit);
    assert.ok(operation.sampleStartedAtMs <= operation.startedAtMs); assert.ok(operation.sampleEndedAtMs >= operation.endedAtMs);
  } finally { recorder.close(); }
});
test('failure observations preserve the original error and timing', async () => {
  const recorder = createRuntimeDiagnostics({ observeGC: false }), error = Object.assign(new Error('Activation refused'), { code: 'EXPECTED_FAILURE' });
  await assert.rejects(recorder.capture('activate', async () => { throw error; }), value => value === error);
  assert.equal(recorder.snapshot().operations[0].failed, 'EXPECTED_FAILURE'); recorder.close();
});
test('GC overlap distinguishes child work from unrelated collector pauses', () => {
  const events = [{ startedAtMs: 1, endedAtMs: 3 }, { startedAtMs: 4, endedAtMs: 8 }, { startedAtMs: 10, endedAtMs: 11 }];
  assert.deepEqual(overlappingGC(events, { startedAtMs: 3, endedAtMs: 10 }), [events[1]]);
});
test('operation, phase and GC observations retain only the bounded recent window', async () => {
  const recorder = createRuntimeDiagnostics({ limit: 3, observeGC: false });
  for (let index = 0; index < 10; index++) {
    await recorder.capture(`activation-${index}`, async () => recorder.phase({ phase: `phase-${index}`, durationMs: index }));
    recorder.recordGC([{ startTime: performance.now(), duration: 1, detail: { kind: 1 } }]);
  }
  const snapshot = recorder.snapshot(); assert.equal(snapshot.gcEvents.length, 3); assert.equal(snapshot.operations.length, 3);
  assert.equal(snapshot.operations[0].name, 'activation-7'); assert.equal(snapshot.operations.at(-1).phases[0].phase, 'phase-9'); recorder.close();
});
