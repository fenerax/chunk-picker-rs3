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
import { decision } from '../scripts/perf/owned-acceptance/metrics.mjs';

// No per-test deadlines or timing/memory thresholds. The
// tiny fixture exercises measurement plumbing, never the acceptance budget.
test('synthetic acceptance smoke preserves both formats and complete measurement structure', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-smoke-'));
  try {
    const report = await comparison({ output: path.join(root, 'report'), smoke: true, signal: t.signal });
    assert.equal(report.format, 'owned-acceptance-7b');
    assert.equal(report.smoke, true); assert.equal(report.equivalent, true);
    assert.match(report.commit, /^[a-f0-9]{40}$/); assert.equal(typeof report.seed, 'string');
    assert.equal(typeof report.host.os, 'string'); assert.equal(report.runtime.node, process.versions.node);
    const combined = aggregate([report]);
    assert.equal(combined.acceptanceClaim, false); assert.equal(combined.format, 'owned-acceptance-7b-aggregate');
    assert.deepEqual(report.results.map(row => row.mode), ['format1', 'format2']);
    for (const result of report.results) {
      assert.deepEqual(result.shape, shapes.smoke);
      assert.equal(result.decision.status, 'smoke-only'); assert.equal(result.decision.acceptanceClaim, false);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.openSamples.map(row => row.count), [1]);
      assert.equal(result.groups.length, 1); assert.equal(result.commandSamples.length, 1);
      assert.equal(result.sessionsRetained, 4); assert.equal(result.repeated.length, 1);
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
    assert.match(await readFile(path.join(root, 'report', 'summary.txt'), 'utf8'), /SMOKE ONLY; no acceptance claim/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelling a ready comparison reaps the trial and calculator before rejecting', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-cancel-'));
  const controller = new AbortController();
  const signal = AbortSignal.any([t.signal, controller.signal]);
  let pids;
  const pending = comparison({ output: root, smoke: true, signal, onReady: ready => {
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
    assert.deepEqual((await readdir(root)).sort(), ['format1', 'started.json']);
    assert.deepEqual(await readdir(path.join(root, 'format1')), ['probes']);
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
