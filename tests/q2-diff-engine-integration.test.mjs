import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter, once } from 'node:events';
import { createManualClock } from './helpers/manual-clock.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateEngineReport } from '../scripts/experiments/q2-diff-engine/inputs.mjs';
import { groupRSS, supervise } from '../scripts/experiments/q2-diff-engine/supervise.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url)), execute = promisify(execFile);
const git = async (root, ...args) => (await execute('git', ['-C', root, ...args], { maxBuffer: 8 * 1024 ** 2 })).stdout.trim();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RS3_')));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
test('real refs, full harvest, uncommitted engine bug, changed data, outer deadlines and RSS fail closed', async t => {
  const temporary = await mkdtemp(path.join(process.env.Q2_TEST_ARTIFACTS ?? tmpdir(), 'q2-detectors-'));
  const sha = await git(ROOT, 'rev-parse', 'HEAD'), source = path.join(temporary, 'source'), branch = 'scratch/q2-wrong-' + process.pid;
  let sourceExists = false, serial = 0;
  t.after(async () => {
    if (sourceExists) { await git(ROOT, 'worktree', 'remove', '--force', source); await git(ROOT, 'branch', '-D', branch); }
    if (!process.env.Q2_TEST_ARTIFACTS) await rm(temporary, { recursive: true, force: true });
  });
  async function run(args = []) {
    const out = path.join(temporary, String(serial++));
    const child = spawn(process.execPath, ['scripts/experiments/q2-diff-engine/supervise.mjs', '--reference-ref', sha,
      '--candidate-ref', sha, '--cases', '2', '--out', out, ...args], { cwd: ROOT, env, stdio: 'ignore' });

    const [code] = await once(child, 'close'); const supervisor = await json(path.join(out, 'supervisor.json'));
    assert.equal(supervisor.exitCode, code); assert.equal(groupRSS(supervisor.processGroup), 0);
    return { code, out, supervisor };
  }
  const control = await run(), report = await json(path.join(control.out, 'campaign/report.json'));
  assert.equal(control.code, 0, JSON.stringify(report.failure)); validateEngineReport(report);
  assert(report.requestPairs > 1000); assert(report.resultPairs > 100); assert(report.errorPairs > 0);
  assert.deepEqual(report.harvest.testFiles, ['planning.test.mjs', 'engine-hotspots.test.mjs', 'game-plugin-mapping.test.mjs']);
  await assert.rejects(readFile(path.join(control.out, 'campaign/owned/corpus.json')), { code: 'ENOENT' });
  await git(ROOT, 'worktree', 'add', '-b', branch, source, sha); sourceExists = true;
  const engineFile = path.join(source, 'app/tasks/engine.mjs'), engine = await readFile(engineFile, 'utf8');
  assert.equal(engine.split('catalogueCount: compiled.length,').length, 2);
  await writeFile(engineFile, engine.replace('catalogueCount: compiled.length,', 'catalogueCount: compiled.length + 1,'));
  const patch = path.join(temporary, 'wrong-engine.patch');
  await writeFile(patch, await git(source, 'diff', '--', 'app/tasks/engine.mjs') + '\n');
  const wrong = await run(['--candidate-patch', patch]), wrongReport = await json(path.join(wrong.out, 'campaign/report.json'));
  assert.equal(wrong.code, 10); assert.equal(wrongReport.firstDifference.requestType, 'evaluate');
  assert.equal(wrongReport.firstDifference.path, '/full/metrics/catalogueCount'); assert(wrongReport.differences > 0);
  assert(wrongReport.inputsVerified); assert.notEqual(wrongReport.candidatePatchSHA256, undefined);
  // Refs stay identical; the only candidate modification was never committed.
  assert.equal(await git(source, 'rev-parse', 'HEAD'), sha);
  await git(source, 'restore', 'app/tasks/engine.mjs');
  const dataFile = path.join(source, 'app/datasets/open-f2p/wiki-derived/dataset.json');
  await writeFile(dataFile, await readFile(dataFile, 'utf8') + '\n');
  const dataPatch = path.join(temporary, 'different-data.patch');
  await writeFile(dataPatch, await git(source, 'diff', '--', 'app/datasets/open-f2p/wiki-derived/dataset.json') + '\n');
  const different = await run(['--candidate-patch', dataPatch]), differentReport = await json(path.join(different.out, 'campaign/report.json'));
  assert.equal(different.code, 14); assert.equal(differentReport.requestPairs, 0); assert.equal(differentReport.inputsVerified, false);
  assert.match(differentReport.failure.message, /Data inputs differ/);
  t.diagnostic(JSON.stringify({ artifacts: temporary, control: { pairs: report.requestPairs, results: report.resultPairs, errorPairs: report.errorPairs },
    wrong: { pairs: wrongReport.requestPairs, differences: wrongReport.differences, firstDifference: wrongReport.firstDifference } }));
});

test('supervisor deadline, RSS breach and signals stop the acknowledged child without racing campaign startup', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'q2-controlled-supervisor-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const reason of ['deadline', 'memory', 'SIGTERM']) {
    const clock = createManualClock(), child = new EventEmitter(), signals = new EventEmitter();
    child.pid = 123;
    const armed = clock.nextScheduled(1000);
    let sample, cleared = false, stops = 0;
    clock.setInterval = callback => { sample = callback; return 'monitor'; };
    clock.clearInterval = timer => { assert.equal(timer, 'monitor'); cleared = true; };
    const out = path.join(temporary, reason);
    const running = supervise({ argv: ['--out', out, '--outer-ms', '1000', '--tree-rss-mib', '1'], checkRuntime() {},
      clock, signals, environment: env, execute: () => child, memory: () => 2 * 1024 ** 2,
      stopGroup(pid) { assert.equal(pid, child.pid); stops++; } });
    await armed;
    let code;
    try {
      if (reason === 'deadline') await clock.advance(1000);
      else if (reason === 'memory') sample();
      else signals.emit('SIGTERM');
      assert.equal(stops, 1, 'the triggering event stops the owned child before completion bookkeeping');
    } finally {
      child.emit('close', null, 'SIGKILL');
      code = await running;
    }
    assert.equal(code, reason === 'deadline' ? 124 : reason === 'memory' ? 13 : 143);
    const record = await json(path.join(out, 'supervisor.json'));
    assert.equal(record.interrupted, reason); assert.equal(record.complete, false);
    assert.equal(stops, 2); assert.equal(cleared, true);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  }
});
