// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { comparison, shapes } from '../scripts/perf/owned-acceptance.mjs';
import { aggregate } from '../scripts/perf/owned-acceptance/aggregate.mjs';
import { pairReports } from '../scripts/perf/owned-acceptance/comparison.mjs';
import { SEED } from '../scripts/perf/owned-acceptance/profile.mjs';
import { decision } from '../scripts/perf/owned-acceptance/metrics.mjs';
const fullAggregate = receipts => aggregate(receipts, { scope: 'full' });

// No per-test deadlines or timing/memory thresholds. The
// tiny fixture exercises measurement plumbing, never the acceptance budget.
test('per-format launcher smoke preserves both formats and complete aggregate measurement structure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-smoke-'));
  try {
    const receipts = [];
    for (const mode of ['format1', 'format2']) {
      const output = path.join(root, mode);
      // Exercise the launcher's real format selection in this test process.
      // Only the measured trial/calculator need fresh, fully reaped processes.
      const receipt = await comparison({ output, format: mode, smoke: true, signal: t.signal });
      assert.deepEqual(JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8')), receipt);
      assert.equal(receipt.selectedFormat, mode); assert.equal(receipt.equivalent, false);
      assert.deepEqual(receipt.results.map(row => row.mode), [mode]);
      assert.deepEqual(receipt.failures, []);
      assert.deepEqual((await readdir(output)).sort(), [mode, 'results.json', 'started.json', 'summary.txt'].sort());
      assert.match(await readFile(path.join(output, 'summary.txt'), 'utf8'), /SMOKE ONLY; no acceptance claim until both formats/);
      receipts.push(receipt);
    }
    const [report] = pairReports(receipts);
    assert.equal(report.format, 'owned-acceptance-7b');
    assert.equal(report.smoke, true); assert.equal(report.equivalent, true);
    assert.match(report.commit, /^[a-f0-9]{40}$/); assert.equal(typeof report.seed, 'string');
    assert.equal(typeof report.host.os, 'string'); assert.equal(report.runtime.node, process.versions.node);
    const combined = aggregate(receipts);
    assert.equal(combined.acceptanceClaim, false); assert.equal(combined.format, 'owned-acceptance-7b-aggregate');
    assert.equal(combined.comparisons[0].equivalent, true);
    assert.deepEqual(report.results.map(row => row.mode), ['format1', 'format2']);
    for (const result of report.results) {
      assert.deepEqual(result.shape, shapes.smoke);
      assert.equal(result.decision.status, 'smoke-only'); assert.equal(result.decision.acceptanceClaim, false);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.openSamples.map(row => row.count), [1]);
      assert.equal(result.groups.length, 1); assert.equal(result.commandSamples.length, 1);
      assert.equal(result.sessionsRetained, 4); assert.equal(result.repeated.length, 1);
      assert.equal(result.retention.warmup.status, 'blocked');
      assert(result.retention.warmup.blockers.some(reason => reason.includes('archive-references-have-no-cap')));
      assert.equal(result.retention.caps.complete, false);
      assert.equal(result.retention.caps.projectedTotal100GroupBytes, null);
      assert.equal(result.retention.caps.knownPerGroupByteCapSubtotal, 48 * 1024 ** 2);
      assert.equal(result.retention.caps.knownSharedByteCapSubtotal, 384 * 1024 ** 2);
      assert.equal(result.openSamples[0].ownerLedgers, undefined, 'opening censuses are not retained in the measured controller');
      assert(result.commandSamples.at(-1).ownerLedgers.some(row => row.owner === 'History'));
      assert(result.commandSamples.at(-1).isolates.every(row => row.ownerLedgers === undefined), 'censuses load after measurement, outside isolate receipts in memory');
      assert.equal(result.mutationRepeated.length, 1);
      assert.equal(result.decision.mutationGrowth.commandsPerGroupPerRound, 4);
      assert.equal(result.decision.mutationGrowth.historyBounded, true);
      assert.equal(typeof result.decision.mutationGrowth.slopeBytesPerCommand, 'number');
      for (const round of [result.mutationWarmup, ...result.mutationRepeated]) {
        assert.deepEqual(round.history.map(row => row.revisionDelta), [4]);
        assert.deepEqual(round.history.map(row => row.index), [0]);
      }
      assert.equal(result.fixtureHashes.length, 5); assert.equal(new Set(result.fixtureHashes).size, 5);
      for (const sample of [result.baseline, ...result.openSamples, result.settled, ...result.repeated, ...result.mutationRepeated]) {
        for (const key of ['heapUsed', 'heapTotal', 'rss', 'external', 'arrayBuffers']) assert.equal(typeof sample.total[key], 'number');
        assert(sample.isolates.some(row => row.pid !== sample.isolates[0].pid));
        assert(sample.isolates.some(row => row.threadId !== 0));
      }
      for (const name of ['open', 'tick', 'note', 'undo', 'calculator', 'full-response', 'play-and-claims']) {
        for (const metric of ['wallMs', 'mainCpuMs', 'childCpuMs'])
          assert.deepEqual(Object.keys(result.times[name][metric]), ['count', 'p50', 'p95', 'max']);
      }
      assert.deepEqual(Object.keys(result.measuredIO), ['fsyncAttempts', 'fsyncs', 'bytesWritten', 'writeCalls', 'baseWrites']);
      assert.deepEqual(Object.keys(result.postPublicationIO), Object.keys(result.measuredIO));
      assert.equal(result.postPublicationIO.baseWrites, 0);
      assert.equal(result.allPostPublicationIO.baseWrites, 0);
      assert.equal(result.speedBar.gating, false);
      assert.deepEqual(result.bounded.map(row => row.kind), ['exceptional-order', 'full-hook', 'compatibility-export', 'stopped-rebase']);
      assert(result.records.some(row => row.kind === 'calculator' && row.mainCpuMs === null));
      // Synthetic detector inputs, never thresholds on this host's measurements.
      // A per-revision leak must reject even when read-only keys remain stable.
      const leak = { ...result, smoke: false,
        repeated: result.repeated.map(row => ({ ...row, total: { ...row.total, heapUsed: 100 } })),
        mutationRepeated: Array.from({ length: 4 }, (_, i) => ({ ...result.mutationRepeated[0], round: i + 1,
          total: { ...result.mutationRepeated[0].total, heapUsed: 100 + i } })) };
      assert(decision(leak).reasons.includes('positive-mutation-repeat-heap-slope'));
      assert(decision({ ...leak, postPublicationIO: { ...leak.postPublicationIO, baseWrites: 1 } })
        .reasons.includes('base-rewritten-after-publication'));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Fully synthetic receipts drive decisions, never measured GC sizes or elapsed
// time. These are not acceptance evidence for the running implementation.
function hostedReceipts() {
  return ['linux', 'win32'].flatMap(os => [1, 2, 3, 4, 5].flatMap(run => ['format1', 'format2'].map(mode => ({
    format: 'owned-acceptance-7b', schemaVersion: 1, selectedFormat: mode, smoke: false, snapshots: false, scope: 'full',
    commit: 'a'.repeat(40), seed: SEED, runtime: { node: '24.21.0', v8: 'synthetic-v8', arch: 'x64' },
    host: { os, hostname: `${mode}-synthetic-host` }, ci: { run: 'synthetic-dispatch', attempt: '1', freshRun: String(run) },
    failures: [], results: [{ mode, shape: shapes.acceptance, errors: [],
      fixtureHashes: Array.from({ length: 54 }, (_, i) => `fixture-${i}`),
      finalHashes: Array.from({ length: 50 }, (_, i) => `final-${i}`),
      measuredIO: { baseWrites: 0 }, allPostPublicationIO: { baseWrites: 0 },
      records: [{ kind: 'calculator', wallMs: run, mainCpuMs: run, childCpuMs: run, cpuMs: run * 2 }],
      times: { open: { wallMs: { p95: 1 } }, calculator: { wallMs: { p95: 1 } } },
      speedBar: { everyday: { measured: { wallMs: { p95: 1 } } } },
      decision: { status: 'target-met', acceptanceClaim: true, reasons: [], groups: [{ attributableBytes: 1 }],
        perGroupBytes: { max: 1 }, maximumGroupHeapBytes: 1, openSlopeBytesPerGroup: 1 },
    }],
  }))));
}

test('aggregate pairs twenty receipts into ten decisions without requiring identical hosts', () => {
  const receipts = hostedReceipts(), result = fullAggregate(receipts.reverse());
  assert.equal(result.acceptanceClaim, true); assert.deepEqual(result.errors, []);
  assert.equal(result.comparisons.length, 10);
  for (const pair of result.comparisons) {
    assert.equal(pair.equivalent, true); assert.deepEqual(pair.errors, []);
    assert.equal(pair.decision.acceptanceClaim, true);
    assert.equal(pair.formatHosts.format1.hostname, 'format1-synthetic-host');
    assert.equal(pair.formatHosts.format2.hostname, 'format2-synthetic-host');
  }
  assert.equal(result.platforms.linux.formats.format2.times.calculator.wallMs.p95, 5);
  assert.equal(receipts[0].results[0].decision.reasons.length, 0, 'comparison does not mutate input receipts');
});

test('aggregate refuses absent, duplicate, mismatched, failed or non-accepting measurements', () => {
  const cases = [
    ['missing format', rows => rows.shift()],
    ['missing pair', rows => rows.splice(0, 2)],
    ['duplicate receipt', rows => rows.push(structuredClone(rows[0]))],
    ['duplicate run', rows => { rows[2].ci.freshRun = '1'; rows[3].ci.freshRun = '1'; }],
    ['wrong run', rows => { rows[0].ci.freshRun = '6'; rows[1].ci.freshRun = '6'; }],
    ...['commit', 'seed', 'smoke', 'snapshots', 'scope'].map(key => [key, rows => { rows[0][key] = 'mismatch'; }]),
    ...['node', 'v8', 'arch'].map(key => [key, rows => { rows[0].runtime[key] = 'mismatch'; }]),
    ...['run', 'attempt'].map(key => [key, rows => { rows[0].ci[key] = 'mismatch'; }]),
    ...['fixtureHashes', 'finalHashes'].map(key => [key, rows => { rows[0].results[0][key][0] = 'mismatch'; }]),
    ['wrong format', rows => { rows[0].results[0].mode = 'format2'; }],
    ['failed control', rows => { rows[0].failures.push({ mode: 'format1', message: 'synthetic failure' }); }],
    ['partial control', rows => { rows[0].results = []; }],
    ['control refusal', rows => { rows[0].results[0].errors.push({ code: 429 }); }],
    ['candidate refusal', rows => { rows[1].results[0].errors.push({ code: 429 }); }],
    ['control base write', rows => { rows[0].results[0].allPostPublicationIO.baseWrites = 1; }],
    ['candidate base write', rows => { rows[1].results[0].allPostPublicationIO.baseWrites = 1; }],
    ['candidate target missed', rows => { Object.assign(rows[1].results[0].decision, { status: 'within-hard-limits-target-missed', acceptanceClaim: false }); }],
    ['candidate growth rejection', rows => { Object.assign(rows[1].results[0].decision, { status: 'reject', acceptanceClaim: false, reasons: ['positive-mutation-repeat-heap-slope'] }); }],
    ['candidate shape', rows => { rows[1].results[0].shape = shapes.smoke; }],
    ['all smoke', rows => { for (const row of rows) row.smoke = true; }],
  ];
  for (const [name, change] of cases) {
    const receipts = hostedReceipts(); change(receipts);
    assert.equal(fullAggregate(receipts).acceptanceClaim, false, name);
  }
  const receipts = hostedReceipts();
  Object.assign(receipts[0].results[0].decision, { status: 'reject', acceptanceClaim: false, reasons: ['aggregate-over-750-MiB'] });
  assert.equal(fullAggregate(receipts).acceptanceClaim, true, 'control memory is reported, not applied as the candidate gate');
  assert.equal(fullAggregate([]).acceptanceClaim, false);
});

test('diagnostic scope pairs both formats on Linux once, checks hashes and never claims final acceptance', () => {
  const receipts = hostedReceipts().filter(row => row.host.os === 'linux' && row.ci.freshRun === '1');
  receipts.forEach(row => { row.scope = 'diagnostic'; row.results[0].decision.gatePassed = true; row.results[0].decision.acceptanceClaim = false; });
  const result = aggregate(receipts);
  assert.equal(result.scope, 'diagnostic'); assert.equal(result.scopePassed, true); assert.equal(result.acceptanceClaim, false);
  assert.equal(result.comparisons.length, 1); assert.deepEqual(result.errors, []);
  assert.equal(fullAggregate(receipts).acceptanceClaim, false);
  receipts[1].results[0].finalHashes[0] = 'different';
  assert.equal(aggregate(receipts).scopePassed, false);
});

test('full scope accepts goals missed within all hard gates and rejects diagnostic or extra receipts', () => {
  const receipts = hostedReceipts();
  for (const receipt of receipts) Object.assign(receipt.results[0].decision, { status: 'within-hard-limits-target-missed', targetMet: false });
  assert.equal(fullAggregate(receipts).acceptanceClaim, true);
  assert.equal(aggregate(receipts).scopePassed, false);
  assert.throws(() => aggregate(receipts, { scope: 'typo' }), /Unknown acceptance scope/);
});

test('CI defaults to one diagnostic pair, expands full scope, and isolates reduced snapshots', async () => {
  const workflow = await readFile(new URL('../.github/workflows/format2-acceptance.yml', import.meta.url), 'utf8');
  assert.match(workflow, /options: \[diagnostic, full\]/);
  assert.match(workflow, /default: diagnostic/);
  assert.match(workflow, /inputs.scope == 'full' && '\["ubuntu-latest","windows-latest"\]' \|\| '\["ubuntu-latest"\]'/);
  assert.match(workflow, /inputs.scope == 'full' && '\[1,2,3,4,5\]' \|\| '\[1\]'/);
  assert.match(workflow, /format: \[format1, format2\]/);
  assert.match(workflow, /timeout-minutes: 60/);
  assert.match(workflow, /max-parallel: 2/);
  assert.match(workflow, /owned-acceptance\.mjs --format "\$ACCEPTANCE_FORMAT"/);
  assert.match(workflow, /name: owned-acceptance-\$\{\{ matrix.os \}\}-\$\{\{ matrix.run \}\}-\$\{\{ matrix.format \}\}/);
  assert.match(workflow, /if: always\(\) && inputs.snapshots/);
  assert.match(workflow, /--spot-check --snapshots --format format2/);
  assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /needs: measure/);
  assert.match(workflow, /pattern: owned-acceptance-\*/);
  assert.match(workflow, /owned-acceptance\/aggregate\.mjs var\/owned-acceptance-receipts/);
});

test('cancelling a ready comparison reaps the trial and calculator before rejecting', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-cancel-'));
  const controller = new AbortController();
  const signal = AbortSignal.any([t.signal, controller.signal]);
  let pids;
  const pending = comparison({ output: root, format: 'format2', smoke: true, signal, onReady: ready => {
    // This IPC event follows a complete baseline barrier from the real relay
    // and calculator thread. No delay, polling or host timing selects the abort.
    pids = [ready.controller, ...ready.children];
    assert.equal(pids.length, 2);
    for (const pid of pids) process.kill(pid, 0);
    controller.abort();
  } });
  try {
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(pids?.length, 2, 'cancellation reached a live calculator');
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.deepEqual((await readdir(root)).sort(), ['format2', 'started.json']);
    assert.deepEqual(await readdir(path.join(root, 'format2')), ['probes']);
  } finally {
    controller.abort(); await pending.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('a calculator exit after the baseline survives failed trials in JSON artifacts and the human summary', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-retirement-'));
  try {
    const report = await comparison({ output: root, smoke: true, signal: t.signal, onReady: ({ children }) => {
      // The trial identifies its own live calculator after complete relay and
      // isolate receipts. Kill only that owned child, without a delay or race
      // against an assumed calculation duration.
      assert.equal(children.length, 1);
      process.kill(children[0], 'SIGKILL');
    } });
    assert.deepEqual(report.results, []);
    assert.deepEqual(report.failures.map(row => row.mode), ['format1', 'format2']);
    assert.equal(report.equivalent, false);
    const saved = JSON.parse(await readFile(path.join(root, 'results.json'), 'utf8'));
    assert.deepEqual(saved.failures, report.failures);
    for (const failure of report.failures) {
      assert.match(failure.message, /refusing incomplete residency evidence/);
      assert.notEqual(failure.stage, 'cleanup');
      assert.equal(failure.calculatorLifecycle.length, 1);
      const worker = failure.calculatorLifecycle[0];
      assert.equal(typeof worker.exit.code, 'number');
      const incident = worker.events.find(row => row.initiator === 'crash');
      assert.equal(incident.reason, 'worker-exit');
      assert.equal(typeof incident.scheduler.queue.depth, 'number');
      assert.equal(typeof incident.barrier, 'number');
      assert.equal(typeof incident.lastCompletedBarrier, 'number');
      assert.equal(typeof incident.stage, 'string');
      assert.deepEqual(JSON.parse(await readFile(path.join(root, failure.mode, 'failure.json'), 'utf8')), failure);
    }
    const human = await readFile(path.join(root, 'summary.txt'), 'utf8');
    assert.match(human, /INCOMPLETE SMOKE; no acceptance claim/);
    assert.match(human, /format1 calculator 1: crash \(worker-exit\).*barrier.*queue.*exit/);
    assert.match(human, /format2 calculator 1: crash \(worker-exit\).*barrier.*queue.*exit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('probe receipts stay immutable and publication failure cannot acknowledge or retry a sequence', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-probe-publication-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('RS3_') || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
  Object.assign(env, { RS3_ACCEPTANCE_PROBE_DIR: root, RS3_ACCEPTANCE_STORE_ROOT: root });
  try {
    await promisify(execFile)(process.execPath, ['--import', new URL('../scripts/perf/owned-acceptance/probe.mjs', import.meta.url).href,
      '--input-type=module', '--eval', `
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import path from 'node:path';
        process.env.RS3_ACCEPTANCE_CONTROLLER_PID = String(process.pid);
        const root = process.env.RS3_ACCEPTANCE_PROBE_DIR;
        const probe = globalThis[Symbol.for('rs3.acceptance.probe')];
        const request = sequence => ({ sequence, gc: false });
        for (const sequence of [1, 2]) fs.mkdirSync(path.join(root, 'checkpoints', String(sequence)), { recursive: true });
        await probe.collect(request(1));
        const file = path.join(root, 'checkpoints', '1', process.pid + '-0.json');
        const held = fs.openSync(file, 'r');
        try {
          await probe.collect(request(2));
          assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sequence, 1);
        } finally { fs.closeSync(held); }
        // Missing receipt directory deterministically injects a real IO error.
        await assert.rejects(probe.collect(request(3)), { code: 'ENOENT' });
        assert.equal(probe.record().sequence, 2);
        assert.match(fs.readFileSync(path.join(root, process.pid + '-0.error'), 'utf8'), /ENOENT/);
        fs.mkdirSync(path.join(root, 'checkpoints', '3'));
        await assert.rejects(probe.collect(request(3)), { code: 'ENOENT' });
        assert.equal(probe.record().sequence, 2);
      `], { env, signal: t.signal, windowsHide: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
