import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Real protocol smoke: two colliding member/input namespaces, both topologies,
// cache eviction/resend and all arrival patterns. No live save or installed pack.
// The benchmark reads /proc and getconf, so it runs on Linux only.
test('capacity benchmark completes two synthetic pickers through the process protocol', { timeout: 60000, skip: process.platform !== 'linux' && 'Linux-only benchmark (/proc, getconf)' }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'multi-picker-capacity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const transport of ['framed', 'production']) {
    const output = path.join(directory, transport + '.json');
    await promisify(execFile)(process.execPath, ['scripts/perf/multi-picker-capacity.mjs', '--transport', transport, '--runs', '1', '--pickers', '2', '--separate', '2', '--output', output],
      { cwd: new URL('../', import.meta.url), timeout: 55000,
        env: { ...process.env, RS3_DATASET: 'unavailable', RS3_PACKS_DIR: '/unavailable', RS3_GAME_DEFAULTS_FILE: '/unavailable' } });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.trials.length, 2);
    assert.match(report.fingerprint.datasetDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(report.fingerprint.packHashes, []);
    assert.ok(report.fingerprint.sourceHashes.length > 0);
    assert.ok(report.fingerprint.sourceHashes.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
    for (const trial of report.trials) {
      assert.equal(trial.pickers, 2);
      assert.equal(trial.transport, transport);
      assert.ok(trial.startup.readyWallMs > 0);
      assert.ok(trial.startup.coreSeconds > 0);
      assert.equal(trial.phases.length, 6);
      assert.ok(trial.peakRSS >= trial.startup.combinedRSS);
      assert.ok(trial.combinedHwmUpperBound >= trial.peakRSS);
      for (const [index, completed] of [2, 2, 2, 12, 6, 4].entries()) {
        const phase = trial.phases[index];
        assert.equal(phase.completed, completed);
        assert.equal(phase.totalCompleted, completed + (phase.name === 'warm-local' ? 2 : 0));
        assert.ok(phase.throughput > 0);
        assert.ok(phase.latencyMs.p95 >= phase.latencyMs.p50);
        assert.ok(phase.peakRSS >= phase.steadyRSS);
      }
      assert.equal(trial.phases.find(p => p.name === 'warm-local').engineWorkCount, 0);
      assert.equal(trial.phases.find(p => p.name === 'alternating').engineWorkCount, 12);
    }
  }
});
