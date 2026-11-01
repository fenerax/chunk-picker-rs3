import assert from 'node:assert/strict';
import { NORMALIZATION } from './semantic.mjs';
export function validateReport(report, expected) {
  assert.equal(report.format, 'y03-report-v1');
  assert.equal(report.complete, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.harnessCommit, expected.harnessCommit);
  assert.equal(report.harnessDirty, false, 'Commit the integrated harness before acceptance');
  assert.deepEqual(report.commits, expected.commits);
  assert.deepEqual(report.adapters, ['worker-cold-v1', 'worker-warm-v1']);
  assert.equal(report.adapterSHA256, expected.adapterSHA256);
  assert.equal(report.normalization, NORMALIZATION);
  assert.equal(report.fault, 'none');
  assert.equal(report.profile, expected.profile);
  const deep = expected.profile === 'deep', cases = deep ? 12 : 2, owners = deep ? 18 : 3;
  assert.deepEqual(report.seeds, deep ? [19003, 19004, 19005] : [19003, 19004]);
  assert.equal(report.requestedCases, cases); assert.equal(report.completedCases, cases);
  assert.equal(report.requestPairs, deep ? 174 : 29); assert.equal(report.replayPairs, report.requestPairs);
  assert.deepEqual(report.requests, { 'prepare-rules': cases, evaluate: owners * 2, 'roll-pool': owners, predict: owners,
    'death-estimates': owners, 'chunk-planning': owners, sandbox: owners, 'area-check': owners, 'how-task': owners });
  assert.deepEqual(report.views, { full: owners, 'play-v1': owners });
  for (const key of ['errors', 'differences', 'nondeterministicFields', 'faultControlPairs']) assert.equal(report[key], 0, key);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.limits, { requestMs: 5000, wallMs: deep ? 600000 : 110000, rssBytes: 1073741824,
    shrinkAttempts: 12, sampleMs: 20, bridgeOldGenerationMiB: 256, workerOldGenerationMiB: 512 });
  assert(Number.isFinite(report.durationMs) && report.durationMs > 0 && report.durationMs <= report.limits.wallMs);
  if (expected.coordinatorDurationMs !== undefined) {
    assert(Number.isFinite(expected.coordinatorDurationMs) && expected.coordinatorDurationMs > 0);
    if (expected.coordinatorDurationMs > report.limits.wallMs) {
      throw Object.assign(Error('Coordinator campaign wall budget exhausted'), { exitCode: 15 });
    }
  }
  assert.equal(report.peakRSSBytes.length, 2);
  assert(report.peakRSSBytes.every(bytes => bytes > 0 && bytes <= report.limits.rssBytes));
  assert.equal(report.engines.length, 2);
  assert.equal(report.engines[0].datasetDigest, report.engines[1].datasetDigest);
  for (const value of [report.harnessSourceSHA256, report.adapterSHA256, report.definitionsSHA256, report.statesSHA256,
    report.corpusSHA256, report.resultSHA256, ...report.engines.map(engine => engine.datasetDigest)]) assert.match(value, /^[a-f0-9]{64}$/);
  return true;
}
