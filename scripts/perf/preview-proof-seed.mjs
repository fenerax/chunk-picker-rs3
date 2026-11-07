// One synthetic before/after first Preview. No repetitions or wall-clock gates.
// Run only on a hosted runner: CI=true RS3_DATASET=open-f2p node this-file.mjs.
import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createTaskScheduler } from '../../app/tasks/scheduler.mjs';
import { preparationSourceDigest } from '../../app/preparation-key.mjs';
import { canonical } from '../../tools/calc-check/compare.mjs';
import { previewProofFixture } from './preview-proof-fixture.mjs';

if (process.env.CI !== 'true' || !process.env.GITHUB_ACTIONS) throw new Error('Run this measurement on hosted GitHub CI.');
const fixture = previewProofFixture(), rows = [];
const input = createHash('sha256').update(JSON.stringify(fixture.state)).digest('hex');
for (const seeded of [false, true]) {
  const scheduler = await createTaskScheduler({ workerData: fixture.workerData, maxCalculators: 2, eligibilityProofSeeding: seeded });
  try {
    await scheduler.evaluate(fixture.state, 'one', 'evaluate', undefined, 'baseline', input);
    const started = performance.now();
    const preview = await scheduler.evaluate(fixture.state, 'one', 'predict', '12598', undefined, input);
    const firstPreviewMs = performance.now() - started;
    assert.equal(preview.eligibilitySeeded, seeded, 'measurement must exercise the declared path');
    rows.push({ arm: seeded ? 'seeded' : 'unseeded', firstPreviewMs, eligibilitySeeded: preview.eligibilitySeeded,
      workerMs: preview.evaluationMs, engineMs: preview.timingMs.engineMs, predictionMs: preview.timingMs.predictionMs,
      canonicalResult: canonical(JSON.parse(JSON.stringify(preview.result))) });
  } finally { await scheduler.close(); }
}
assert.deepEqual(rows[1].canonicalResult, rows[0].canonicalResult);
const resultSha256 = createHash('sha256').update(JSON.stringify(rows[0].canonicalResult)).digest('hex');
for (const row of rows) delete row.canonicalResult;
const report = { version: 1, head: process.env.GITHUB_SHA, source: preparationSourceDigest(), node: process.versions.node,
  fixture: { chunks: Object.keys(fixture.definitions.chunks).length, challenges: fixture.engine.catalogue.length, members: 2,
    sha256: input }, resultSha256, rows,
  savedMs: rows[0].firstPreviewMs - rows[1].firstPreviewMs,
  limitation: 'One synthetic sample per arm, including prediction worker startup and transfer; no wall-clock acceptance threshold or real-save claim.' };
await writeFile('preview-proof-seed.json', JSON.stringify(report, null, 2) + '\n');
const table = `| First Preview | Unseeded | Seeded |\n| --- | ---: | ---: |\n| End-to-end ms | ${rows[0].firstPreviewMs.toFixed(2)} | ${rows[1].firstPreviewMs.toFixed(2)} |\n| Worker engine ms | ${rows[0].engineMs.toFixed(2)} | ${rows[1].engineMs.toFixed(2)} |\n\n${report.limitation}\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, table);
console.log(JSON.stringify(report, null, 2));
