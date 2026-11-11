// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { comparison, shapes } from '../scripts/perf/owned-acceptance.mjs';
import { aggregate } from '../scripts/perf/owned-acceptance/aggregate.mjs';

// One generous outer guard, no timing/memory thresholds or repetitions. The
// tiny fixture exercises measurement plumbing, never the acceptance budget.
test('synthetic acceptance smoke preserves both formats and complete measurement structure', { timeout: 180000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-acceptance-smoke-'));
  try {
    const report = await comparison({ output: path.join(root, 'report'), smoke: true });
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
      assert.deepEqual(result.openSamples.map(row => row.count), [1, 2]);
      assert.equal(result.groups.length, 2); assert.equal(result.commandSamples.length, 2);
      assert.equal(result.sessionsRetained, 8); assert.equal(result.repeated.length, 4);
      assert.equal(result.fixtureHashes.length, 6); assert.equal(new Set(result.fixtureHashes).size, 6);
      for (const sample of [result.baseline, ...result.openSamples, result.settled, ...result.repeated]) {
        for (const key of ['heapUsed', 'heapTotal', 'rss', 'external', 'arrayBuffers']) assert.equal(typeof sample.total[key], 'number');
        assert(sample.isolates.some(row => row.pid !== sample.isolates[0].pid));
        assert(sample.isolates.some(row => row.threadId !== 0));
      }
      for (const name of ['open', 'tick', 'note', 'undo', 'calculator', 'full-response', 'play-and-claims']) {
        for (const metric of ['wallMs', 'mainCpuMs', 'childCpuMs'])
          assert.deepEqual(Object.keys(result.times[name][metric]), ['count', 'p50', 'p95', 'max']);
      }
      assert.deepEqual(Object.keys(result.measuredIO), ['fsyncAttempts', 'fsyncs', 'bytesWritten', 'writeCalls', 'baseWrites']);
      assert.equal(result.allPostPublicationIO.baseWrites, 0);
      assert.equal(result.speedBar.gating, false);
      assert.deepEqual(result.bounded.map(row => row.kind), ['exceptional-order', 'full-hook', 'compatibility-export', 'stopped-rebase']);
      assert(result.records.some(row => row.kind === 'calculator' && row.mainCpuMs === null));
    }
    assert.match(await readFile(path.join(root, 'report', 'summary.txt'), 'utf8'), /SMOKE ONLY; no acceptance claim/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
