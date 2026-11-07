// @test solo dataset=open-f2p
import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

for (const mode of ['views', 'transfer']) test(`resident index releases hydrated request state after ${mode}`, async () => {
  // GC is part of this test's own configuration; the suite needs no special
  // flags, environment or manually prepared calculator process.
  const { stdout } = await promisify(execFile)(process.execPath, ['--expose-gc',
    fileURLToPath(new URL('./fixtures/resident-planning-gc.mjs', import.meta.url)), mode],
  { windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.match(stdout, /request state collected; planning index retained/);
});
