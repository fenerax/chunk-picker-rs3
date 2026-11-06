import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CANARY, planStability, windowsSlice } from '../scripts/ci/stability-plan.mjs';
import { executeShard, diagnostic } from '../scripts/ci/stability-run.mjs';
import { summarizeStability } from '../scripts/ci/stability-summary.mjs';
import { runAdaptive } from '../scripts/adaptive-test-runner.mjs';

const inventory = ['tests/a.test.mjs', 'tests/win.test.mjs', CANARY];
const plan = options => planStability({ inventory, windows: ['tests/win.test.mjs'], ...options });
const all = result => result.matrix.include.flatMap(task => task.attempts.map(row => ({ ...row, os: task.os })));

test('direct entry selection ignores deleted files, nested helpers and unrelated edits; tooling gets a canary', () => {
  assert.deepEqual(plan({ changed: ['README.md', 'tests/helper.mjs', 'tests/nested/a.test.mjs', 'tests/deleted.test.mjs'] }).targets, []);
  const result = plan({ changed: ['tests/a.test.mjs', 'tests/a.test.mjs', 'tests/win.test.mjs'] });
  assert.deepEqual(result.targets.map(({ file, os, repetitions }) => [file, os, repetitions]), [
    ['tests/a.test.mjs', 'linux', 50], ['tests/win.test.mjs', 'linux', 50], ['tests/win.test.mjs', 'windows', 50],
  ]);
  for (const file of ['scripts/ci/stability-plan.mjs', 'scripts/ci/stability-run.mjs', 'scripts/ci/stability-summary.mjs', '.github/workflows/stability.yml']) {
    assert.deepEqual(plan({ changed: [file] }).targets, [{ file: CANARY, os: 'linux', requested: 5, repetitions: 5 }]);
  }
});

test('matrix partitions every first attempt exactly once, ten jobs per OS, and caps broad PR work', () => {
  for (const changed of [['tests/a.test.mjs'], ['tests/a.test.mjs', 'tests/win.test.mjs']]) {
    const result = plan({ changed });
    const attempts = all(result);
    assert.equal(result.matrix.include.length, changed.includes('tests/win.test.mjs') ? 20 : 10);
    assert.equal(new Set(attempts.map(row => `${row.os}:${row.file}:${row.repetition}`)).size, attempts.length);
    for (const target of result.targets) assert.deepEqual(attempts.filter(row => row.file === target.file && row.os === target.os)
      .map(row => row.repetition).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  }
  const names = Array.from({ length: 7 }, (_, i) => `tests/file-${i}.test.mjs`);
  const result = planStability({ inventory: names, changed: names });
  assert.equal(result.reduced, true);
  assert.equal(all(result).length, 196);
  assert(result.targets.every(target => target.repetitions === 28));
  const tooMany = Array.from({ length: 201 }, (_, i) => `tests/file-${i}.test.mjs`);
  assert.throws(() => planStability({ inventory: tooMany, changed: tooMany }), /Over 200/);
});

test('dispatch validates existing entry files, count, OS, and total budget', () => {
  const result = plan({ files: 'tests/a.test.mjs,\ntests/win.test.mjs tests/a.test.mjs', repetitions: '3', os: 'both' });
  assert.equal(result.targets.length, 4); assert.equal(all(result).length, 12);
  for (const repetitions of [0, 51, 1.5, 'oops']) assert.throws(() => plan({ files: inventory[0], repetitions }));
  for (const files of ['', '../tests/a.test.mjs', 'tests/missing.test.mjs', 'tests/helper.mjs', 'tests/a.test.mjs;echo']) assert.throws(() => plan({ files }));
  assert.throws(() => plan({ files: inventory.join(','), os: 'both' }), /200/);
  assert.throws(() => plan({ files: inventory[0], os: 'macos' }), /OS/);
});

test('Windows selection reads the real slice, refusing a changed declaration shape', async () => {
  const source = await readFile(new URL('../.github/windows-slice/run.mjs', import.meta.url), 'utf8');
  const files = windowsSlice(source);
  assert(files.includes('tests/release-pipeline-v2.test.mjs'));
  assert(files.includes('tests/owned-child-processes.test.mjs'));
  assert.throws(() => windowsSlice('export const windowsFiles = getFiles();'));
  assert.throws(() => windowsSlice('export const windowsFiles = [unknown];'));
});

test('aggregate requires exact current-SHA attempts; missing, failed, duplicate and stale receipts fail closed', () => {
  const planned = { ...plan({ files: inventory[0], repetitions: 3 }), sha: 'a'.repeat(40), runId: '1', runAttempt: '1' };
  const receipts = planned.matrix.include.map(task => ({ schema: 'rs3-stability-shard-v1', id: task.id,
    sha: planned.sha, runId: '1', runAttempt: '1', rows: task.attempts.map(row => ({ ...row, os: task.os, passed: true, durationMs: row.repetition * 10, errors: [] })) }));
  const result = summarizeStability(planned, receipts);
  assert.equal(result.passed, true); assert.equal(result.files[0].medianMs, 20); assert.equal(result.files[0].p90Ms, 30);
  assert.equal(summarizeStability(planned, receipts.slice(1)).passed, false);
  assert.throws(() => summarizeStability(planned, [...receipts, receipts[0]]), /duplicate/);
  assert.throws(() => summarizeStability(planned, [{ ...receipts[0], sha: 'b'.repeat(40) }]), /Stale/);
  receipts[1].rows[0].passed = false;
  const failed = summarizeStability(planned, receipts);
  assert.equal(failed.passed, false); assert.equal(failed.files[0].failures[0].repetition, 2);
});

test('real native loop uses fresh processes and stops at the first failure without retrying', async t => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'stability-unit-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'tests'));
  await writeFile(path.join(cwd, inventory[0]), `import test from 'node:test'; import { appendFileSync } from 'node:fs';
test('fresh process', () => appendFileSync('pids.txt', process.pid + '\\n'));
`);
  const task = plan({ files: inventory[0], repetitions: 3 }).matrix.include;
  const attempts = task.flatMap(shard => shard.attempts);
  const run = file => runAdaptive({ files: [file], cwd, env: process.env, policy: () => ({}), minConcurrency: 1, maxConcurrency: 1 });
  let saved;
  const result = await executeShard({ os: 'linux', attempts }, { run, save: async rows => { saved = structuredClone(rows); }, log: () => {} });
  assert.equal(result.passed, true); assert.equal(saved.length, 3);
  assert.equal(new Set((await readFile(path.join(cwd, 'pids.txt'), 'utf8')).trim().split('\n')).size, 3);
  await writeFile(path.join(cwd, inventory[0]), "import test from 'node:test'; test('intentional synthetic failure', () => { throw new Error('synthetic failure'); });\n");
  const failed = await executeShard({ os: 'linux', attempts }, { run, save: async rows => { saved = structuredClone(rows); }, log: () => {} });
  assert.equal(failed.passed, false); assert.equal(saved.length, 1); assert.equal(saved[0].repetition, 1);
  assert.equal(JSON.stringify(saved).includes('synthetic failure'), false, 'receipt redacts error payloads');
});

test('public diagnostics strip external paths and credentials, keeping assertion details', () => {
  const output = diagnostic(new Error('expected 1, actual 2 at C:\\outside\\file.mjs and /home/runner/tool.mjs Bearer invented-value'), 'C:\\repo');
  assert.match(output, /expected 1, actual 2/);
  assert.doesNotMatch(output, /outside|\/home\/runner|invented-value/);
  assert.equal(diagnostic('import failed\nat /unusual/tool.mjs\nBearer invented-value'), 'import failed\nat [external-path]\nBearer <token>');
});

test('workflow pins existing action SHAs, is read-only, cancels old pushes, and retains receipts even on failure', async () => {
  const workflow = await readFile(new URL('../.github/workflows/stability.yml', import.meta.url), 'utf8');
  const existing = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  const actions = [...workflow.matchAll(/uses: (\S+)/g)].map(([, action]) => action);
  assert(actions.length > 0);
  for (const action of actions) { assert.match(action, /@[a-f0-9]{40}$/); assert(existing.includes(action), action); }
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.equal((workflow.match(/permissions:/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|continue-on-error/);
  for (const text of ['pull_request:', 'workflow_dispatch:', 'cancel-in-progress: true', 'max-parallel: 20', 'fail-fast: false',
    'fetch-depth: 0', 'persist-credentials: false', 'if: always()', 'stability-receipt.json', '-Stability',
    'node scripts/ci/coverage-inputs.mjs', 'frozen-rollback-', 'wiki-open-f2p-', "packs-${{ hashFiles('.github/packs/pack-pin.json') }}"])
    assert(workflow.includes(text), text);
});
