// Runs the private live-swap unit tests, which live next to their code in
// scripts/private-companion. Discovery only reads tests/, so this file pulls them in.
// The swap and fault hammers stay opt-in and are never imported here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import '../scripts/private-companion/live-swap/backend-lifecycle.test.mjs';
import '../scripts/private-companion/live-swap/controller.test.mjs';
import '../scripts/private-companion/live-swap/fixture-diagnostics.test.mjs';
import '../scripts/private-companion/live-swap/front-door.test.mjs';
import '../scripts/private-companion/live-swap/managed-runtime.test.mjs';

test('bridge ownership checks exact process identity', { skip: process.platform !== 'win32' }, () => {
  const script = fileURLToPath(new URL('../scripts/private-companion/operator/Bridge-Ownership.test.ps1', import.meta.url));
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(result, { checks: 5, passed: true, servers: 0, foreignProcessActions: 0 });
});
