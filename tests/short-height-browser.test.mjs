import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

// The app and this CDP harness have no npm dependencies. Only a missing Chrome
// installation may skip the native keyboard, clipping and hit-ownership checks.
test('short phone shells and enlarged dialog titles leave focused controls visible', {
  timeout: 240000,
}, async t => {
  let executable;
  try { executable = await findChrome(); } catch (error) {
    if (error.message !== 'CHROME_UNAVAILABLE') throw error;
    t.skip('Chrome not found'); return;
  }
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/perf/short-height-browser.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, CHROME_PATH: executable },
    windowsHide: true, timeout: 230000, maxBuffer: 1024 * 1024,
  });
  const summary = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(summary.cases, 12, 'every font/height/notice combination ran');
  assert.equal(summary.failures, 0);
  t.diagnostic(JSON.stringify(summary));
});
