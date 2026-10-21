import test from 'node:test';
import assert from 'node:assert/strict';
import { retryFailedFilesOnce } from '../scripts/private-companion/retry-failed-files.mjs';

const initial = () => ({ passed: false, exitCode: 1, aborted: false, wallMs: 10, summary: { success: false },
  files: [{ file: 'tests/pass.test.mjs', passed: true }, { file: 'tests/fail.test.mjs', passed: false, bodyMs: 4 }] });
test('isolated retry is off by default and passing files never rerun', async () => {
  const result = initial();
  assert.equal(await retryFailedFilesOnce({ result, runIsolated: () => assert.fail('default must not retry') }), result);
  const calls = [], flagged = [];
  const retried = await retryFailedFilesOnce({ result, enabled: true, onFlaky: file => flagged.push(file.file), runIsolated: async (files, options) => {
    calls.push({ files, options });
    return { passed: true, exitCode: 0, wallMs: 5, files: [{ file: files[0], passed: true, bodyMs: 1 }] };
  } });
  assert.deepEqual(calls, [{ files: ['tests/fail.test.mjs'], options: { minConcurrency: 1, maxConcurrency: 1, retryOnceInIsolation: false } }]);
  assert.equal(retried.passed, true); assert.equal(retried.flaky, true); assert.equal(retried.wallMs, 15);
  assert.deepEqual(flagged, ['tests/fail.test.mjs']);
  assert.equal(retried.files[1].attempts[0].observation.passed, false);
  assert.equal(retried.files[1].attempts[1].observation.passed, true);
  assert.equal(await retryFailedFilesOnce({ result: retried, enabled: true, runIsolated: () => assert.fail('only once') }), retried);
});
test('failed, aborted, missing or mismatched retry evidence keeps the lane failed', async () => {
  for (const retry of [
    { passed: false, exitCode: 1, files: [{ file: 'tests/fail.test.mjs', passed: false }] },
    { passed: true, exitCode: 0, aborted: true, files: [{ file: 'tests/fail.test.mjs', passed: true }] },
    { passed: true, exitCode: 0, files: [] },
    { passed: true, exitCode: 0, files: [{ file: 'tests/other.test.mjs', passed: true }] },
  ]) {
    const result = await retryFailedFilesOnce({ result: initial(), enabled: true, runIsolated: async () => retry });
    assert.equal(result.passed, false); assert.equal(result.flaky, false);
    const repeat = await retryFailedFilesOnce({ result, enabled: true, runIsolated: () => assert.fail('failed retries never repeat') });
    assert.equal(repeat.passed, false);
  }
  const aborted = { ...initial(), aborted: true };
  assert.equal(await retryFailedFilesOnce({ result: aborted, enabled: true, runIsolated: () => assert.fail('aborted') }), aborted);
  await assert.rejects(retryFailedFilesOnce({ result: initial(), enabled: true, runIsolated: async () => { throw Error('cleanup failed'); } }), /cleanup failed/);
});
