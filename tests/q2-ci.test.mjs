import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculatorChanged, importClosure, prReport, prSummary } from '../scripts/experiments/q2-diff-engine/pr.mjs';
import { requireUpstreamSuccess } from '../scripts/ci/coverage-gate.mjs';
import { operations, MIN_HARVEST_PAIRS, MIN_HARVEST_RESULTS } from '../scripts/experiments/q2-diff-engine/inputs.mjs';
const execute = promisify(execFile), ROOT = fileURLToPath(new URL('../', import.meta.url));
const valid = () => ({ format: 'q2-engine-diff-v1', complete: true, exitCode: 0, errors: 0, differences: 0,
  inputsVerified: true, requestPairs: 700, expectedPairs: 700, sources: { synthetic: 100, harvest: 600 },
  resultPairs: 700, errorPairs: 0, successfulSources: { synthetic: 100, harvest: 600 },
  successfulRequests: Object.fromEntries(operations.map(type => [type, 1])), durationMs: 100, limits: { wallMs: 1000 } });
const context = () => ({ relevant: true, report: valid(), supervisor: { complete: true, exitCode: 0 }, exitCode: 0, durationMs: 100 });

test('PR workflow decisions follow old and new calculator imports and reference data, excluding unrelated files', async () => {
  const old = { 'app/tasks/engine.mjs': "import '../old-helper.mjs'", 'app/old-helper.mjs': '' };
  const next = { 'app/tasks/engine.mjs': "import '../new-helper.mjs'", 'app/new-helper.mjs': '' };
  const closure = new Set([...await importClosure(async file => old[file], ['app/tasks/engine.mjs']),
    ...await importClosure(async file => next[file], ['app/tasks/engine.mjs'])]);
  for (const file of ['app/tasks/engine.mjs', 'app/old-helper.mjs', 'app/new-helper.mjs', 'reference/fixture.json'])
    assert.equal(calculatorChanged([file], closure), true, file);
  for (const file of ['README.md', 'app/web/app.css', 'app/data/changelog.json', 'app/data/roadmap.json'])
    assert.equal(calculatorChanged([file], closure), false, file);
});

test('not relevant succeeds through the coverage gate; failed, cancelled and skipped upstream jobs fail closed', () => {
  const skipped = prReport({ relevant: false, durationMs: 1 });
  assert.equal(skipped.status, 'not relevant'); assert.equal(skipped.exitCode, 0);
  assert.match(prSummary(skipped), /Not relevant: no calculator input or code paths changed/);
  requireUpstreamSuccess({ RS3_COVERAGE_DIFFERENTIAL_RESULT: skipped.exitCode === 0 ? 'success' : 'failure' });
  assert.equal(prReport(context()).status, 'passed');
  for (const key of ['RS3_COVERAGE_TEST_RESULT', 'RS3_COVERAGE_WINDOWS_RESULT', 'RS3_COVERAGE_DIFFERENTIAL_RESULT']) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) assert.throws(() => requireUpstreamSuccess({ [key]: result }));
    requireUpstreamSuccess({ [key]: 'success' });
  }
});

test('PR success requires the complete comparison, supervisor and both harvest floors', () => {
  for (const corrupt of [
    ctx => ctx.report.sources.harvest = MIN_HARVEST_PAIRS - 1,
    ctx => ctx.report.successfulSources.harvest = MIN_HARVEST_RESULTS - 1,
    ctx => ctx.report.differences++, ctx => ctx.report.complete = false,
    ctx => ctx.supervisor.complete = false, ctx => ctx.supervisor.exitCode = 13,
    ctx => ctx.report = undefined, ctx => ctx.supervisor = undefined,
  ]) { const ctx = context(); corrupt(ctx); assert.throws(() => prReport(ctx)); }
});

test('compact failure report retains request type and field path, omitting compared values', () => {
  const ctx = context(); ctx.exitCode = 10;
  ctx.report.differences = 2; ctx.report.firstDifference = { requestType: 'evaluate', path: '/full/metrics/catalogueCount', reference: 1, candidate: 2 };
  const report = prReport(ctx);
  assert.equal(report.status, 'failed'); assert.equal(report.differences, 2);
  assert.deepEqual(report.firstDifference, { requestType: 'evaluate', path: '/full/metrics/catalogueCount' });
  assert.match(prSummary(report), /evaluate/); assert.match(prSummary(report), /catalogueCount/);
  assert.throws(() => requireUpstreamSuccess({ RS3_COVERAGE_DIFFERENTIAL_RESULT: 'failure' }));
});

test('workflow checks PR head with full history and always uploads compact reports; coverage consumes its result', async () => {
  const differential = await readFile(new URL('../.github/workflows/differential.yml', import.meta.url), 'utf8');
  const q2 = differential.slice(differential.indexOf('  engine-pr:'));
  assert.match(q2, /if: github.event_name == 'pull_request'/);
  assert.match(q2, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(q2, /fetch-depth: 0/); assert.match(q2, /persist-credentials: false/);
  assert.match(q2, /timeout-minutes: 15/); assert.match(q2, /container: node:24.21.0-bookworm/);
  assert.match(q2, /--base-ref "\$BASE_SHA" --head-ref "\$HEAD_SHA"/);
  for (const flag of ['request-ms', 'wall-ms', 'outer-ms', 'rss-mib', 'tree-rss-mib']) assert(q2.includes('--' + flag));
  assert.match(q2, /if: always\(\)/); assert.match(q2, /summary.json/); assert.match(q2, /summary.md/);
  assert.doesNotMatch(q2, /candidate-patch|continue-on-error|pull_request_target/);
  const caller = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  assert.match(caller, /uses: \.\/\.github\/workflows\/differential.yml/);
  assert.match(caller, /needs: \[gate, affected, test, windows, differential\]/);
  assert.match(caller, /RS3_COVERAGE_DIFFERENTIAL_RESULT: \$\{\{ needs.differential.result \}\}/);
});

test('real PR script persists a successful not-relevant summary and refuses missing history', { skip: process.platform !== 'linux' && 'Linux /proc required' }, async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'q2-pr-unit-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RS3_') && key !== 'GITHUB_STEP_SUMMARY'));
  const head = (await execute('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
  const run = (base, name) => execute(process.execPath, ['scripts/experiments/q2-diff-engine/pr.mjs', '--base-ref', base,
    '--head-ref', head, '--out', path.join(temporary, name)], { cwd: ROOT, env, timeout: 30000 });
  await run(head, 'skip');
  const skipped = JSON.parse(await readFile(path.join(temporary, 'skip/summary.json'), 'utf8'));
  assert.equal(skipped.status, 'not relevant'); assert.equal(skipped.exitCode, 0);
  assert.equal(skipped.reference, head); assert.equal(skipped.candidate, head);
  assert.match(await readFile(path.join(temporary, 'skip/summary.md'), 'utf8'), /Not relevant/);
  await assert.rejects(run('q2-missing-ref-for-test', 'missing'), { code: 14 });
  const failed = JSON.parse(await readFile(path.join(temporary, 'missing/summary.json'), 'utf8'));
  assert.equal(failed.status, 'failed'); assert.equal(failed.exitCode, 14);
});
