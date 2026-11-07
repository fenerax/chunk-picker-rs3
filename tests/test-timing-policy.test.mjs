import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { timingViolations, timingAllowlist } from './helpers/timing-policy.mjs';

test('test sources use deterministic behavior checks and the shared file safety stop', async () => {
  const failures = [];
  async function visit(directory = new URL('./', import.meta.url), prefix = 'tests/') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = prefix + entry.name, url = new URL(entry.name, directory);
      if (entry.isDirectory()) await visit(new URL(entry.name + '/', directory), file + '/');
      else if (/\.(?:[cm]?js|ts|ps1)$/.test(entry.name)) {
        try { failures.push(...timingViolations(await readFile(url, 'utf8'), file)); }
        catch (error) { failures.push({ message: `${file}:1: Timing policy could not scan source: ${error.message}` }); }
      }
    }
  }
  await visit();
  assert.equal(failures.length, 0, failures.map(row => row.message).join('\n'));
});

test('policy catches inline and indirect measurements, deadlines and timer aliases with locations', () => {
  for (const source of [
    'assert.ok(performance.now() - began < 3000);',
    'assert.ok(Math.abs(Date.now() - began) < 3000);',
    'assert.ok(result.metrics.elapsedMs < 3000);',
    'assert.ok(result.heldMs < 30000);',
    'const start = Date.now(); const duration = Date.now() - start;\nassert(duration < 50);',
    'const start = Date.now(); const duration = Math.abs(Date.now() - start); assert(duration < 50);',
    'const now = Date.now; const start = now(); assert(now() - start < 50);',
    'const getNow = performance.now; const start = getNow(); assert(getNow() - start < 50);',
    "import { strictEqual as check } from 'node:assert/strict'; check(Date.now() - began < 50, true);",
    "test('case', { timeout: 1000 }, async () => {});",
    "test('case', { timeout: 0 }, async () => {});",
    'test({ timeout: 0 }, async () => {});',
    "const timeout = 50; test('case', { timeout }, () => {});",
    "test('case', { 'timeout': 0 }, () => {});",
    "test.only('case', { timeout: 0 }, () => {});",
    "import check from 'node:test'; const options = { timeout: Infinity }; check('case', options, () => {});",
    'await Promise.race([work, new Promise(resolve => setTimeout(resolve, 30))]);',
    'await fetch(url, { signal: AbortSignal.timeout(10) });',
    "import { setTimeout as wait } from 'node:timers/promises'; await Promise.race([work, wait(30)]);",
    'const wait = setTimeout; await Promise.race([work, new Promise(resolve => wait(resolve, 30))]);',
  ]) {
    const failures = timingViolations(source, 'tests/synthetic.test.mjs');
    assert.equal(failures.length, 1, source);
    assert.match(failures[0].message, /^tests\/synthetic.test.mjs:[12]:/);
    assert.match(failures[0].message, /controlled clock|file-level outer safety stop/);
  }
  for (const source of [
    "// assert(Date.now() - start < 3);\nconst text = 'setTimeout(resolve, 30)';",
    'clock.advance(30); assert.equal(calls, 1);',
    'const clock = { setTimeout(callback, delay) { callbacks.push(callback); } };',
    'const elapsed = performance.now() - start; diagnostic(elapsed);',
  ]) assert.deepEqual(timingViolations(source, 'tests/synthetic.test.mjs'), []);
  for (const entry of Object.values(timingAllowlist)) for (const reason of Object.values(entry)) assert.ok(reason.length > 20);
  for (const file of ['tests/warm-candidate.test.mjs', 'tests/linux-offhost.test.mjs', 'tests/map-terrain.test.mjs']) {
    assert.equal(timingViolations('setTimeout(() => {}, 5);', file).length, 1, 'controlled checks do not exempt future timers');
    assert.equal(timingViolations('assert(Date.now() - began < 10);', file).length, 1, 'controlled checks do not exempt future elapsed budgets');
  }
  for (const source of ['Start-Sleep -Milliseconds 50', '$child.WaitForExit(5000)', 'if ($watch.ElapsedMilliseconds -lt 50) { throw "slow" }'])
    assert.equal(timingViolations(source, 'tests/synthetic.ps1').length, 1);
});
