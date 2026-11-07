import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { observationNames } from '../scripts/perf/short-height-readiness.mjs';

// The app and this CDP harness have no npm dependencies. Only a missing Chrome
// installation may skip the native keyboard, clipping and hit-ownership checks.
test('short phone shells and enlarged dialog titles leave focused controls visible', {
  }, async t => {
  let executable;
  try { executable = await findChrome(); } catch (error) {
    if (error.message !== 'CHROME_UNAVAILABLE') throw error;
    t.skip('Chrome not found'); return;
  }
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/perf/short-height-browser.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, CHROME_PATH: executable },
    windowsHide: true, maxBuffer: 1024 * 1024,
  });
  const records = stdout.trim().split('\n').map(line => JSON.parse(line));
  const summary = records.pop();
  assert.deepEqual(records.map(row => [row.font, row.height, row.notice]),
    [16, 24].flatMap(font => [240, 256, 844].flatMap(height => [true, false].map(notice => [font, height, notice]))),
    'exact font/height/notice matrix, without duplicates or skips');
  for (const row of records) assert.deepEqual(row.observations.map(o => o.name), observationNames);
  assert.equal(summary.cases, 12, 'every font/height/notice combination ran');
  assert.equal(summary.observations, 708, 'every named layout/focus observation ran');
  assert.equal(summary.failures, 0);
  t.diagnostic(JSON.stringify(summary));
});
