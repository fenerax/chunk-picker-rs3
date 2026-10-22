import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { openChrome } from '../scripts/perf/cdp.mjs';
import { normalizeRequest, measurementPlan, estimatedSeconds } from '../scripts/ci/perf-bench-config.mjs';
import { distribution, compareSamples, extractMetrics, extractObservations, reportMarkdown, failureReadiness } from '../scripts/ci/perf-bench-report.mjs';
import { verifySave, runBenchmark, parseArguments } from '../scripts/ci/perf-bench.mjs';
import { prepareImport } from '../scripts/ci/perf-bench-import.mjs';
import { safeDiagnostic, safeStderrTail, DIAGNOSTIC_PREFIX, chromeStartupMessage } from '../scripts/perf/diagnostics.mjs';

test('failure diagnostics allow harness messages and locations but never arbitrary save or stderr text', () => {
  const error = new TypeError('fixture-private-save-value');
  error.stack = 'TypeError: fixture-private-save-value\n at action (/tmp/private-fixture/scripts/perf/page-load.mjs:10:20)';
  const diagnostic = safeDiagnostic(error, { stage: 'measure', scenario: 'cold', body: 'fixture-private' });
  assert.equal(diagnostic.errorClass, 'TypeError');
  assert.equal(diagnostic.message, 'Unrecognized error message withheld.');
  assert.deepEqual(diagnostic.frames, ['page-load.mjs:10:20']);
  assert.equal(diagnostic.scenario, 'cold');
  const tail = safeStderrTail('fixture-private-save-value\n{"state":"fixture-private"}\nPerformance benchmark failed: CDP Runtime.evaluate timed out.\n'
    + DIAGNOSTIC_PREFIX + JSON.stringify({ ...diagnostic, frames: [...diagnostic.frames, '/tmp/private-fixture/save.json'], body: 'fixture-private' }));
  assert.equal(tail.length, 2);
  assert.doesNotMatch(JSON.stringify({ diagnostic, tail }), /fixture-private|state|body|save.json/);
  assert.match(tail[0], /Runtime.evaluate timed out/);
  assert.equal(chromeStartupMessage('[pid] No usable sandbox! private-fixture'), 'Chrome sandbox initialization failed.');
  assert.deepEqual(safeStderrTail('FATAL ERROR: Reached heap limit Allocation failed - fixture-private'), ['Node heap limit reached.']);
  assert.equal(safeDiagnostic({ code: 'ERR_PRIVATE_FIXTURE' }).code, undefined);
  assert.equal(safeDiagnostic({ code: 'ENOMEM' }).code, 'ENOMEM');
  const forged = new Error('fixture-private /fixture-private.mjs:12:3\n at /page-load.mjs:123:456');
  const safe = safeDiagnostic(forged);
  assert.deepEqual(safe.frames, []);
  const forgedTail = safeStderrTail(DIAGNOSTIC_PREFIX + JSON.stringify({ errorClass: 'Error', frames: ['fixture-private.mjs:12:3', 'page-load.mjs:3:4'] }));
  assert.doesNotMatch(JSON.stringify(forgedTail), /fixture-private/);
  assert.match(JSON.stringify(forgedTail), /page-load.mjs:3:4/);
});

test('signal-terminated Chrome fails immediately with an allowlisted startup cause', async () => {
  const child = new EventEmitter();
  child.exitCode = null; child.signalCode = 'SIGTRAP';
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
  let requested = false;
  await assert.rejects(openChrome('synthetic-chrome', 'synthetic-profile', { port: 8961 }, {
    spawn: () => { queueMicrotask(() => child.stderr.emit('data', '[pid] No usable sandbox! fixture-private\n')); return child; },
    fetch: async () => { requested = true; },
  }), /Chrome exited during startup/);
  assert.equal(requested, false);
});

test('failed trial readiness retains booleans and fixed endpoint statuses only', () => {
  const readiness = failureReadiness({ failedSuite: { failedMeasurement: { wallMs: 10,
    lastSnapshot: { tasksReady: false, taskError: false, member: 'fixture-private', milestones: [
      { name: 'state-adopted', timeMs: 2, memberId: 'fixture-private' }, { name: 'fixture-private', timeMs: 3 } ] },
    requests: [{ path: '/api/tasks', status: 500, pending: false, body: 'fixture-private' },
      { path: '/api/fixture-private', status: 404, pending: true }] } } });
  assert.equal(readiness.tasksReady, false);
  assert.equal(readiness.pendingCount, 1);
  assert.deepEqual(readiness.failedEndpoints, [{ path: '/api/tasks', status: 500 }]);
  assert.equal(readiness.milestones.length, 1);
  assert.doesNotMatch(JSON.stringify(readiness), /fixture-private|member|body/);
});

test('starter smoke uses its backup importer; legacy production import remains file-based', async () => {
  const state = { revision: 1 }, input = { format: 'rs3-chunk-picker', state };
  let imported, loaded;
  const options = await prepareImport({ checkout: path.resolve('fixture'), save: 'fixture-save', dataDir: 'fixture-output', datasetId: 'open-f2p' }, {
    load: async url => { loaded = url; return { importBackup: document => { imported = document; return state; } }; },
    read: async filename => { assert.equal(filename, 'fixture-save'); return JSON.stringify(input); },
  });
  assert.equal(options.initialImport, undefined);
  assert.equal(options.initialState, state);
  assert.deepEqual(imported, input);
  assert.match(loaded, /app\/core\/state.mjs$/);
  assert.equal(options.port, 8968);
  const production = await prepareImport({ checkout: 'fixture', save: 'fixture-save', dataDir: 'fixture-output', datasetId: 'duo-legacy' }, {
    load: () => assert.fail('Legacy import must be deferred to createServer'), read: () => assert.fail('Never read legacy save contents in the runner'),
  });
  assert.equal(production.initialImport, 'fixture-save');
  assert.equal(production.initialState, undefined);
});

test('one scenario catalogue controls bounded requests and alternating plans', () => {
  const request = normalizeRequest({ runs: 3, scenarios: ['unlock', 'panels'] });
  assert.deepEqual(measurementPlan(request).map(row => `${row.arm}${row.run}/${row.groupView}`),
    ['A1/off','B1/off','A1/on','B1/on','A2/off','B2/off','A2/on','B2/on','A3/off','B3/off','A3/on','B3/on']);
  assert.ok(estimatedSeconds({}) >= 1100 && estimatedSeconds({}) <= 1400);
  for (const invalid of [{ runs: 0 }, { runs: 11 }, { scenarios: ['../save'] }, { scenarios: ['cold', 'cold'] },
    { options: { command: 'fixture' } }, { options: { screenshots: 'false' } }, { options: { groupViews: ['off', 'off'] } },
    { options: { unlockPick: 'prepared', unlockDwellMs: 3 } }, { base: 'HEAD' }]) assert.throws(() => normalizeRequest(invalid));
  assert.throws(() => normalizeRequest({}, { requireRevisions: true }));
  assert.throws(() => parseArguments(['--runs','1','--runs','2']));
});

test('non-overlapping ranges need three complete observations; absent is never zero', () => {
  assert.deepEqual(distribution([null, undefined, 0, 2, 1]), { n: 3, median: 1, min: 0, max: 2 });
  const samples = (a, b) => [...a.map(x => ({ arm: 'A', groupView: 'off', metrics: { x } })), ...b.map(x => ({ arm: 'B', groupView: 'off', metrics: { x } }))];
  assert.equal(compareSamples(samples([10,11,12],[7,8,9]),3)[0].verdict, 'win');
  assert.equal(compareSamples(samples([10,11,12],[12,13,14]),3)[0].verdict, 'noise');
  assert.equal(compareSamples(samples([10,11,12],[13,14,15]),3)[0].verdict, 'loss');
  assert.equal(compareSamples(samples([10],[1]),1)[0].verdict, 'noise');
  assert.equal(compareSamples(samples([10,11,12],[1,null,2]),3)[0].verdict, 'missing');
});

test('metric extraction excludes raw save, URL, cache text and fixture paths', () => {
  const metrics = extractMetrics({ secret: 'fixture-private', suites: [{ mode: 'normal', server: { rssReadyBytes: 1048576 },
    results: [{ name: 'search', durationMs: 15, text: 'fixture-private' }, { name: 'cold',
      milestones: { tasksPaintedMs: 10, secret: 'fixture-private' }, network: { totals: { transferBytes: 2048 } } }] }] });
  assert.equal(metrics['search.paint.ms'], 15);
  assert.equal(metrics['server.rss-ready.MiB'], 1);
  assert.equal(metrics['cold.wire.KiB'], 2);
  assert.doesNotMatch(JSON.stringify(metrics), /fixture-private|secret/);
  const observations = extractObservations({ suites: [{ results: [{ name: 'unlock', taskCalculation: { hit: true, note: 'fixture-private' },
    taskIdentity: { memberId: 'fixture-private', revision: 2 }, serverCalculations: [
      { memberId: 'fixture-private', revision: 2, startedMs: 10, doneMs: 20, state: 'fixture-private' }] }] }] });
  assert.equal(observations.unlock[0].cacheHit, true);
  assert.equal(observations.unlock[0].workerEvents[0].selectedMember, true);
  assert.doesNotMatch(JSON.stringify(observations), /fixture-private|state|memberId|revision/);
});

test('checksum mismatch refuses before importing either app', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-perf-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const save = path.join(root, 'save.json'); await writeFile(save, '{}');
  await assert.rejects(verifySave(save, '0'.repeat(64)), /SHA256 mismatch/);
  let called = false;
  await assert.rejects(runBenchmark({ 'a-dir': root, 'b-dir': root, save, 'packs-dir': root, 'save-sha256': '0'.repeat(64) },
    { execute: async () => { called = true; } }), /SHA256 mismatch/);
  assert.equal(called, false);
});

test('paired orchestration imports twice, alternates, writes safe reports and cleans its data', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-perf-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const save = path.join(root, 'save.json'); await writeFile(save, '{"fixture-private":true}');
  const saveHash = createHash('sha256').update(await readFile(save)).digest('hex');
  await writeFile(path.join(root, 'selection.json'), '{}');
  const calls = [], imported = [], revision = 'a'.repeat(40);
  const output = path.join(root, 'report');
  const report = await runBenchmark({ 'a-dir': root, 'b-dir': root, save, 'save-sha256': saveHash,
    'packs-dir': root, 'output-dir': output, runs: '3', scenarios: 'cold', options: '{"groupViews":["off"]}' }, {
    revision: async () => revision,
    execute: async (script, args) => {
      if (script.endsWith('perf-bench-import.mjs')) { imported.push(args[2]); await mkdir(args[2]); return; }
      calls.push(args[args.indexOf('--label') + 1].match(/-([AB])-([0-9]+)-off$/).slice(1).join(''));
      await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ applicationSource: { sha256: 'b'.repeat(64) },
        fixture: { sha256: 'c'.repeat(64), source: 'fixture-private' }, environment: { node: 'v24.0.0', chrome: 'Chrome/1', platform: 'linux' },
        suites: [{ mode: 'normal', server: { rssReadyBytes: 1048576, rssAfterBytes: 2097152 },
          results: [{ name: 'cold', milestones: { tasksPaintedMs: 20 }, network: { totals: {} } }] }] }));
    },
  });
  assert.equal(imported.length, 2);
  assert.deepEqual(calls, ['A1','B1','A2','B2','A3','B3']);
  assert.equal(report.complete, true);
  assert.equal(report.samples.length, 6);
  assert.doesNotMatch(await readFile(path.join(output, 'perf-report.json'), 'utf8'), /fixture-private|scratch-/);
  assert.match(await readFile(path.join(output, 'perf-report.md'), 'utf8'), /non-overlapping/);
  for (const directory of imported) await assert.rejects(readFile(path.join(directory, 'state.json')), { code: 'ENOENT' });
  assert.match(reportMarkdown(report, { short: true }), /cold.tasksPainted.ms/);
});

test('failed imports retain only a scalar failure report and discard ambient operator inputs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-perf-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const save = path.join(root, 'save.json'); await writeFile(save, '{}');
  await writeFile(path.join(root, 'selection.json'), '{}');
  const previous = process.env.RS3_ICON_ASSETS_DIR;
  process.env.RS3_ICON_ASSETS_DIR = 'fixture-private-icons';
  t.after(() => { if (previous === undefined) delete process.env.RS3_ICON_ASSETS_DIR; else process.env.RS3_ICON_ASSETS_DIR = previous; });
  let imported;
  const output = path.join(root, 'report');
  await assert.rejects(runBenchmark({ 'a-dir': root, 'b-dir': root, save, 'packs-dir': root, 'output-dir': output,
    'save-sha256': createHash('sha256').update('{}').digest('hex') }, {
    revision: async () => 'a'.repeat(40),
    execute: async (script, args, { env }) => {
      assert.equal(env.RS3_ICON_ASSETS_DIR, undefined);
      assert.equal(env.GH_TOKEN, undefined); assert.equal(env.GITHUB_TOKEN, undefined);
      assert.equal(env.RS3_DATASET, 'duo-legacy');
      imported = args[2]; await mkdir(imported);
      const error = Error('fixture-private-save-value');
      error.stderrTail = ['fixture-private-save-value', DIAGNOSTIC_PREFIX + JSON.stringify({ errorClass: 'Error', message: 'CDP Runtime.evaluate timed out.', stage: 'measure', scenario: 'cold' })];
      throw error;
    },
  }), /benchmark child or integrity check failed/);
  const json = await readFile(path.join(output, 'perf-report.json'), 'utf8'), report = JSON.parse(json);
  assert.equal(report.complete, false);
  assert.deepEqual(report.failureContext, { operation: 'import', arm: 'A' });
  assert.equal(report.diagnostic.errorClass, 'Error');
  assert.match(report.diagnostic.stderrTail[0], /Runtime.evaluate timed out/);
  assert.doesNotMatch(json, /fixture-private/);
  await assert.rejects(readFile(path.join(imported, 'state.json')), { code: 'ENOENT' });
});
