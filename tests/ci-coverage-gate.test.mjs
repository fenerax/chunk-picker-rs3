import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverTests } from '../scripts/test-selection.mjs';
import { windowsBoundTests } from '../scripts/private-companion/neutral-lane.mjs';
import { evaluateCoverage } from '../scripts/ci/coverage-gate.mjs';

const files = ['tests/fixture.test.mjs'];
const row = (status, name = ['fixture'], occurrence = 1) => ({ file: files[0], name, occurrence,
  key: JSON.stringify([files[0], name, occurrence]), kind: 'test', status, ...(status === 'skip' ? { reason: 'Requires Windows' } : {}) });
const report = (lane, tests) => ({ schema: 'rs3-test-coverage-v1', lane, passed: true, files, completedFiles: files, tests,
  fileResults: [{ file: files[0], passed: true, recordCount: tests.length,
    counts: { tests: tests.length, suites: 0, passed: tests.filter(row => row.status === 'pass').length,
      skipped: tests.filter(row => row.status === 'skip').length, failed: 0, cancelled: 0, todo: 0 } }] });
const input = (linux = [row('skip')], win = [row('pass')]) => ({ ubuntu: report('test', linux), windows: report('windows', win),
  files, windowsFiles: files, allowlist: { schema: 'rs3-coverage-allowlist-v1', tests: [] } });

test('an exact Windows pass covers a Linux skip; Linux-only passes also count', () => {
  const result = evaluateCoverage(input([row('skip'), row('pass', ['Linux case'])]));
  assert.equal(result.passed, true);
  assert.equal(result.covered, 2);
});

test('a skip on both OSes or absent on the other OS fails', () => {
  for (const win of [[row('skip')], [row('pass', ['different case'])]]) {
    const result = evaluateCoverage(input(undefined, win));
    assert.equal(result.passed, false);
    assert.deepEqual(result.uncovered.map(item => item.name), [['fixture']]);
  }
});

test('hierarchies, files and duplicate-name occurrences cannot mask skips', () => {
  for (const win of [[row('pass', ['other suite', 'fixture'])], [row('pass', ['fixture'], 2)]]) {
    assert.equal(evaluateCoverage(input(undefined, win)).passed, false);
  }
  const data = input();
  data.windowsFiles = ['tests/other.test.mjs'];
  data.windows.files = data.windows.completedFiles = data.windowsFiles;
  data.windows.tests = [{ ...row('pass'), file: data.windowsFiles[0], key: JSON.stringify([data.windowsFiles[0], ['fixture'], 1]) }];
  data.windows.fileResults[0].file = data.windowsFiles[0];
  assert.equal(evaluateCoverage(data).passed, false);
});

test('only an exact reviewed allowance with a one-line reason excuses an unexecuted test', () => {
  const data = input(undefined, [row('skip')]);
  data.allowlist.tests = [{ file: files[0], name: ['fixture'], occurrence: 1, reason: 'Requires a private save that cannot be published.' }];
  const result = evaluateCoverage(data);
  assert.equal(result.passed, true);
  assert.equal(result.allowed.length, 1);
  data.allowlist.tests[0].reason = '';
  assert.throws(() => evaluateCoverage(data), /one-line reason/);
});

test('stale allowances fail when the test runs or disappears', () => {
  for (const name of [['fixture'], ['removed test']]) {
    const data = input();
    data.allowlist.tests = [{ file: files[0], name, occurrence: 1, reason: 'Requires a private fixture.' }];
    const result = evaluateCoverage(data);
    assert.equal(result.passed, false);
    assert.equal(result.stale.length, 1);
  }
});

test('missing, incomplete, failed, empty and malformed reports fail closed', () => {
  const corruptions = [
    data => { data.ubuntu = null; }, data => { data.windows.lane = 'test'; },
    data => { data.ubuntu.passed = false; }, data => { data.ubuntu.files = []; },
    data => { data.windows.completedFiles = []; }, data => { data.ubuntu.tests = []; },
    data => { data.ubuntu.tests[0].status = 'fail'; }, data => { data.ubuntu.tests[0].status = 'todo'; },
    data => { data.ubuntu.tests[0].key = 'forged'; }, data => { data.ubuntu.tests.push(data.ubuntu.tests[0]); },
    data => { delete data.ubuntu.tests[0].reason; },
    data => { data.ubuntu.fileResults = []; },
    data => { data.ubuntu.fileResults[0].counts.tests++; },
    data => { data.ubuntu.fileResults[0].recordCount++; },
    data => { data.ubuntu.fileResults[0].passed = false; },
    data => { data.ubuntu.tests[0].status = 'pass'; },
  ];
  for (const corrupt of corruptions) {
    const data = input(); corrupt(data);
    assert.throws(() => evaluateCoverage(data));
  }
});

test('CLI checks disposable artifacts against the full inventory and refuses a missing public-input case', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'coverage-gate-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const allowances = JSON.parse(await readFile(new URL('../.github/coverage-allowlist.json', import.meta.url), 'utf8'));
  const inventory = (await discoverTests(undefined, 'full')).map(file => `tests/${file}`);
  const guide = 'tests/skill-guides-extraction.test.mjs';
  const make = (lane, expected) => {
    const tests = expected.flatMap(file => {
      const exempt = allowances.tests.filter(row => row.file === file);
      return (exempt.length ? exempt : [{ file, name: [file === guide ? 'synthetic missing public input' : 'synthetic CLI fixture'], occurrence: 1 }])
        .map(row => ({ ...row, key: JSON.stringify([row.file, row.name, row.occurrence]), kind: 'test',
          status: exempt.length || file === guide ? 'skip' : 'pass', reason: 'Synthetic fixture skip' }));
    });
    return { schema: 'rs3-test-coverage-v1', lane, passed: true, files: expected, completedFiles: expected, tests,
      fileResults: expected.map(file => {
        const rows = tests.filter(row => row.file === file);
        return { file, passed: true, recordCount: rows.length, counts: { tests: rows.length, suites: 0,
          passed: rows.filter(row => row.status === 'pass').length, skipped: rows.filter(row => row.status === 'skip').length,
          failed: 0, cancelled: 0, todo: 0 } };
      }) };
  };
  const ubuntu = make('test', inventory), windows = make('windows', windowsBoundTests.map(file => `tests/${file}`));
  await writeFile(path.join(directory, 'test.json'), JSON.stringify(ubuntu));
  await writeFile(path.join(directory, 'windows.json'), JSON.stringify(windows));
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/ci/coverage-gate.mjs', import.meta.url)), directory],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /UNCOVERED tests\/skill-guides-extraction/);
  ubuntu.tests.find(row => row.file === guide).status = 'pass';
  const counts = ubuntu.fileResults.find(row => row.file === guide).counts;
  counts.passed = 1; counts.skipped = 0;
  await writeFile(path.join(directory, 'test.json'), JSON.stringify(ubuntu));
  const passed = run();
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /0 uncovered/);
  await rm(path.join(directory, 'windows.json'));
  assert.equal(run().status, 1);
});
