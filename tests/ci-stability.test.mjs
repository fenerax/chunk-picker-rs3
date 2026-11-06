import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CANARY, planStability, windowsSlice } from '../scripts/ci/stability-plan.mjs';
import { executeShard, diagnostic } from '../scripts/ci/stability-run.mjs';
import { summarizeStability } from '../scripts/ci/stability-summary.mjs';
import { runAdaptive } from '../scripts/adaptive-test-runner.mjs';
import { classifyTest, createTestSelection, discoverTestEntries, isTestEntryFile } from '../scripts/test-selection.mjs';

const inventory = ['tests/a.test.mjs', 'tests/win.test.mjs', CANARY];
const plan = options => planStability({ inventory, windows: ['tests/win.test.mjs'], ...options });
const all = result => result.matrix.include.flatMap(task => task.attempts.map(row => ({ ...row, os: task.os })));
const counts = overrides => ({ tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, ...overrides });
// Synthetic native event stream for the reviewer's count-shaped reproductions.
const emitCounts = (onEvent, native, file) => {
  for (const status of ['passed', 'failed', 'cancelled', 'skipped', 'todo']) {
    for (let i = 0; i < (native?.[status] ?? 0); i++) onEvent({ type: 'test:complete', data: {
      entryFile: file, skip: status === 'skipped', todo: status === 'todo',
      details: { type: 'test', passed: ['passed', 'skipped', 'todo'].includes(status),
        ...(status === 'cancelled' ? { error: { code: 'ERR_TEST_CANCELLED' } } : {}) },
    } });
  }
};

test('direct entry selection ignores deleted files, nested helpers and unrelated edits; tooling gets a canary', () => {
  assert.deepEqual(plan({ changed: ['README.md', 'tests/helper.mjs', 'tests/nested/a.test.mjs'] }).targets, []);
  assert.throws(() => plan({ changed: ['tests/missing.test.mjs'] }), /Unknown test entry file.*missing/);
  const result = plan({ changed: ['tests/a.test.mjs', 'tests/a.test.mjs', 'tests/win.test.mjs'] });
  assert.deepEqual(result.targets.map(({ file, os, repetitions }) => [file, os, repetitions]), [
    ['tests/a.test.mjs', 'linux', 50], ['tests/win.test.mjs', 'linux', 50], ['tests/win.test.mjs', 'windows', 50],
  ]);
  for (const file of ['scripts/ci/stability-plan.mjs', 'scripts/ci/stability-run.mjs', 'scripts/ci/stability-summary.mjs', '.github/workflows/stability.yml']) {
    assert.deepEqual(plan({ changed: [file] }).targets, [{ file: CANARY, os: 'linux', requested: 5, repetitions: 5 }]);
  }
});

test('review reproduction: every discovery-accepted basename is planned or visibly refused, including _rebuilt', async t => {
  const names = ['_rebuilt.test.mjs', '.rebuilt.test.mjs', 'é-rebuilt.test.mjs', 'semi;rebuilt.test.mjs'];
  const directory = await mkdtemp(path.join(tmpdir(), 'stability-discovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of names) await writeFile(path.join(directory, name), '');
  assert.deepEqual((await discoverTestEntries(directory)).sort(), [...names].sort());
  const selection = createTestSelection(new Map(names.map(name => [name, ''])));
  assert.deepEqual(selection.selectTests(names, 'full'), [...names].sort());
  for (const name of names) {
    assert.equal(isTestEntryFile(name), true);
    const file = 'tests/' + name;
    assert.equal(planStability({ changed: [file], inventory: [file] }).targets[0].file, file);
    assert.equal(planStability({ files: file, inventory: [file] }).targets[0].repetitions, 50);
  }
  const mixed = planStability({ changed: ['tests/_rebuilt.test.mjs', 'tests/ordinary.test.mjs'],
    inventory: ['tests/_rebuilt.test.mjs', 'tests/ordinary.test.mjs'] });
  assert.equal(mixed.targets.length, 2);
  for (const name of ['space name.test.mjs', 'comma,name.test.mjs', 'back\\slash.test.mjs']) {
    const file = 'tests/' + name;
    assert.equal(isTestEntryFile(name), true);
    assert.throws(() => planStability({ changed: [file], inventory: [file] }), error =>
      error.message.includes('Cannot plan test entry filename') && error.message.includes(JSON.stringify(file)));
  }
});

test('review reproduction: dedicated detector lanes are refused in PR, dispatch and runner before any execution', async () => {
  for (const file of ['tests/y03-fuzz-ci-integration.test.mjs', 'tests/q2-diff-engine-integration.test.mjs']) {
    assert.match(classifyTest(file.slice(6)), /differential/);
    for (const options of [{ changed: [file] }, { files: file, os: 'linux' }, { files: file, os: 'both' }])
      assert.throws(() => planStability({ inventory: [file], ...options }), /loop not supported for this lane.*differential/);
    await assert.rejects(executeShard({ os: 'linux', attempts: [{ file, repetition: 1, total: 50 }] }, {
      run: async () => assert.fail('dedicated lane must not execute'), save: async () => {}, log: () => {},
    }), /loop not supported for this lane/);
  }
  const file = 'tests/new-detector.test.mjs';
  const selection = createTestSelection(new Map([[file.slice(6), '// @test engine-differential']]));
  assert.throws(() => planStability({ inventory: [file], changed: [file], classify: selection.classifyTest }), /loop not supported for this lane/);
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
  const receipts = planned.matrix.include.map(task => ({ schema: 'rs3-stability-shard-v2', id: task.id,
    sha: planned.sha, runId: '1', runAttempt: '1', rows: task.attempts.map(row => ({ ...row, os: task.os, passed: true, counts: counts(), durationMs: row.repetition * 10, errors: [] })) }));
  const result = summarizeStability(planned, receipts);
  assert.equal(result.passed, true); assert.equal(result.files[0].medianMs, 20); assert.equal(result.files[0].p90Ms, 30);
  assert.equal(summarizeStability(planned, receipts.slice(1)).passed, false);
  assert.throws(() => summarizeStability(planned, [...receipts, receipts[0]]), /duplicate/);
  assert.throws(() => summarizeStability(planned, [{ ...receipts[0], sha: 'b'.repeat(40) }]), /Stale/);
  receipts[1].rows[0].passed = false;
  const failed = summarizeStability(planned, receipts);
  assert.equal(failed.passed, false); assert.equal(failed.files[0].failures[0].repetition, 2);
});

test('review reproduction: six skipped PowerShell cases never become green 50/50, even if a receipt claims success', async () => {
  const file = 'tests/release-run-ci-powershell.test.mjs';
  const planned = { ...planStability({ files: file, repetitions: 50, os: 'linux', inventory: [file] }),
    sha: 'a'.repeat(40), runId: 'synthetic', runAttempt: '1' };
  const native = { passed: true, files: [{ file, passed: true, summary: { success: true,
    counts: counts({ tests: 6, passed: 0, skipped: 6 }) } }] };
  const receipts = [], logs = [];
  for (const task of planned.matrix.include) {
    const result = await executeShard(task, { run: async (file, onEvent) => {
      emitCounts(onEvent, native.files[0].summary.counts, file); return structuredClone(native);
    }, save: async () => {}, log: line => logs.push(line) });
    assert.equal(result.passed, false); assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].counts.executed, 0); assert.equal(result.rows[0].counts.skipped, 6);
    receipts.push({ schema: 'rs3-stability-shard-v2', id: task.id, sha: planned.sha,
      runId: planned.runId, runAttempt: planned.runAttempt, rows: result.rows });
  }
  assert(logs.some(line => /no executed test cases.*skipped 6/.test(line)));
  const summary = summarizeStability(planned, receipts);
  assert.equal(summary.passed, false); assert.equal(summary.files[0].passed, 0);
  assert.equal(summary.files[0].repetitions[0].counts.skipped, 6);
  const forged = planned.matrix.include.map(task => ({ ...receipts[0], id: task.id,
    rows: task.attempts.map(row => ({ ...row, os: 'linux', passed: true, durationMs: 1,
      counts: native.files[0].summary.counts, errors: [] })) }));
  const claimed = summarizeStability(planned, forged);
  assert.equal(claimed.passed, false); assert.equal(claimed.files[0].passed, 0); assert.equal(claimed.files[0].missing, 0);
  assert.equal(claimed.files[0].failures[0].reason, 'no-executed-cases');
});

test('empty, todo, failed, cancelled, absent and inconsistent counts fail; partial skips retain executed passing cases', async () => {
  const attempt = { file: inventory[0], repetition: 1, total: 1 };
  for (const [nativeCounts, expected] of [
    [counts({ tests: 0, passed: 0 }), false], [counts({ tests: 2, todo: 1 }), false],
    [counts({ tests: 1, passed: 0, todo: 1 }), false], [counts({ tests: 2, failed: 1 }), false],
    [counts({ tests: 2, cancelled: 1 }), false], [null, false], [counts({ skipped: 1 }), false],
    [counts({ tests: 6, skipped: 5 }), true],
  ]) {
    const result = await executeShard({ os: 'linux', attempts: [attempt] }, { log: () => {}, save: async () => {},
      run: async (file, onEvent) => {
        emitCounts(onEvent, nativeCounts, file);
        return { passed: true, files: [{ passed: true, summary: { counts: nativeCounts } }] };
      } });
    assert.equal(result.passed, expected, JSON.stringify(nativeCounts));
    if (expected) { assert.equal(result.rows[0].counts.executed, 1); assert.equal(result.rows[0].counts.skipped, 5); }
  }
  const noEvents = await executeShard({ os: 'linux', attempts: [attempt] }, { log: () => {}, save: async () => {},
    run: async () => ({ passed: true, files: [{ passed: true, summary: { counts: counts() } }] }) });
  assert.equal(noEvents.passed, false, 'case counts without native case events cannot establish execution');
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
  const run = (file, onEvent) => runAdaptive({ files: [file], cwd, env: process.env, policy: () => ({}), minConcurrency: 1, maxConcurrency: 1, onEvent });
  let saved;
  const result = await executeShard({ os: 'linux', attempts }, { run, save: async rows => { saved = structuredClone(rows); }, log: () => {} });
  assert.equal(result.passed, true); assert.equal(saved.length, 3);
  assert.equal(saved[0].counts.executed, 1); assert.equal(saved[0].counts.skipped, 0); assert.equal(saved[0].counts.todo, 0);
  assert.equal(new Set((await readFile(path.join(cwd, 'pids.txt'), 'utf8')).trim().split('\n')).size, 3);
  await writeFile(path.join(cwd, inventory[0]), "import test from 'node:test'; test('intentional synthetic failure', () => { throw new Error('synthetic failure'); });\n");
  const failed = await executeShard({ os: 'linux', attempts }, { run, save: async rows => { saved = structuredClone(rows); }, log: () => {} });
  assert.equal(failed.passed, false); assert.equal(saved.length, 1); assert.equal(saved[0].repetition, 1);
  assert.equal(JSON.stringify(saved).includes('synthetic failure'), false, 'receipt redacts error payloads');
  for (const source of ["test('all skipped', { skip: true }, () => {});", "test('only todo', { todo: true }, () => {});", '']) {
    await writeFile(path.join(cwd, inventory[0]), "import test from 'node:test'; " + source);
    const empty = await executeShard({ os: 'linux', attempts }, { run, save: async rows => { saved = structuredClone(rows); }, log: () => {} });
    assert.equal(empty.passed, false); assert.equal(saved.length, 1); assert.equal(saved[0].counts.executed, 0);
  }
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
