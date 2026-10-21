// Deterministic Windows sharing violations; no real lane, browser or wrapper child.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkerStatusWriter, createWorkerProgressReporter } from '../scripts/private-companion/post-merge-private.mjs';
import { runAdaptive } from '../scripts/adaptive-test-runner.mjs';

const scratch = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.local');
async function fixture(t) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'postmerge-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, state: path.join(root, 'state.json') };
}
const blocked = () => Object.assign(Error('synthetic Windows sharing violation'), { code: 'EPERM' });

test('overlapping scheduler/file status writes stay ordered and retry the same atomic rename', async t => {
  const { root, state } = await fixture(t);
  let active = 0, peak = 0, calls = 0;
  const waits = [], committed = [];
  const write = createWorkerStatusWriter({ platform: 'win32', wait: async ms => { waits.push(ms); }, renameFile: async (from, to) => {
    active++; peak = Math.max(peak, active);
    try {
      await delay(5);
      if (++calls <= 2) throw blocked();
      committed.push(JSON.parse(await readFile(from)).completed);
      await rename(from, to);
    } finally { active--; }
  } });
  const first = { completed: 1 }, one = write(state, first);
  first.completed = 99; // A queued write must retain its original snapshot.
  const two = write(state, { completed: 2 });
  await Promise.all([one, two]);
  assert.equal(peak, 1); assert.equal(calls, 4);
  assert.deepEqual(waits, [25, 50]); assert.deepEqual(committed, [1, 2]);
  assert.equal(JSON.parse(await readFile(state)).completed, 2);
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('exhausted critical status writes retain previous state, clean temps and do not poison the queue', async t => {
  const { root, state } = await fixture(t);
  await writeFile(state, JSON.stringify({ phase: 'queued' }));
  let denied = true, attempts = 0;
  const write = createWorkerStatusWriter({ platform: 'win32', attempts: 3, wait: async () => {}, renameFile: async (from, to) => {
    attempts++; if (denied) throw blocked(); await rename(from, to);
  } });
  await assert.rejects(write(state, { phase: 'complete' }), { code: 'EPERM' });
  assert.equal(attempts, 3); assert.equal(JSON.parse(await readFile(state)).phase, 'queued');
  assert.deepEqual(await readdir(root), ['state.json']);
  denied = false;
  await write(state, { phase: 'failed' });
  assert.equal(JSON.parse(await readFile(state)).phase, 'failed');
});

test('degraded telemetry does not cancel actual file outcomes; critical completion still refuses', async t => {
  const { root, state } = await fixture(t), warnings = [];
  const write = createWorkerStatusWriter({ platform: 'win32', attempts: 2, wait: async () => {}, renameFile: async () => { throw blocked(); } });
  const reporter = createWorkerProgressReporter({ writeStatus: write, warn: warning => warnings.push(warning) });
  let executed = 0;
  const files = ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs'];
  const result = await runAdaptive({ files, memory: () => 16 * 1024 ** 3, minConcurrency: 1, maxConcurrency: 1, pollMs: 1, rampMs: 1,
    runFile: async ({ file }) => { executed++; return { file, passed: true }; },
    onSchedule: status => reporter.write(state, { phase: 'running', active: status.active }),
    onFile: () => reporter.write(state, { phase: 'running', completed: executed }) });
  assert.equal(result.passed, true); assert.equal(executed, 3);
  assert.equal(reporter.telemetry.degraded, true); assert.ok(reporter.telemetry.failures >= 3);
  assert.equal(reporter.telemetry.lastError, 'EPERM'); assert.equal(warnings.length, 1);
  const complete = path.join(root, 'complete.json');
  await assert.rejects(write(complete, { passed: true }), { code: 'EPERM' });
  await assert.rejects(readFile(complete), { code: 'ENOENT' });
  assert.deepEqual(await readdir(root), []);
});

test('a queued progress update retains the degraded flag after its predecessor fails', async t => {
  const { state } = await fixture(t);
  const write = createWorkerStatusWriter();
  let calls = 0;
  const reporter = createWorkerProgressReporter({ warn: () => {}, writeStatus: async (file, value) => {
    if (++calls === 1) { await delay(5); throw blocked(); }
    await write(file, value);
  } });
  await Promise.all([reporter.write(state, { completed: 1 }), reporter.write(state, { completed: 2 })]);
  const saved = JSON.parse(await readFile(state));
  assert.equal(saved.completed, 2); assert.equal(saved.statusTelemetry.degraded, true);
  assert.equal(saved.statusTelemetry.failures, 1);
});
