import test from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

// The app has no npm dependencies. Supply the externally installed browser tool
// explicitly, as for scripts/perf/phone-check.mjs. The harness asserts native Tab
// visibility and hit ownership, not just successful keyboard activation.
test('short phone shells and enlarged dialog titles leave focused controls visible', {
  skip: !process.env.PLAYWRIGHT_MODULE && 'Set PLAYWRIGHT_MODULE to an external playwright-core installation',
  timeout: 240000,
}, async () => {
  await promisify(execFile)(process.execPath, ['scripts/perf/short-height-browser.mjs'], {
    cwd: new URL('../', import.meta.url), env: process.env, timeout: 230000, maxBuffer: 1024 * 1024,
  });
});
