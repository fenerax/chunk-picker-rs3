import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createCoverageReporter } from '../scripts/ci/coverage-reporter.mjs';

const file = 'tests/fixture.test.mjs';
const reporter = (cwd = '/repo') => createCoverageReporter({ lane: 'test', cwd, files: [file] });
const summary = (tests, overrides = {}) => ({ counts: { tests, suites: 0, passed: tests, failed: 0, skipped: 0, cancelled: 0, todo: 0, topLevel: tests, ...overrides } });
const event = (testId, name, extra = {}) => ({ type: 'test:complete', data: {
  entryFile: file, file: 'tests/shared-helper.mjs', testId, name, parentId: 0, nesting: 0,
  details: { passed: true, type: 'test' }, ...extra,
} });

test('coverage keys normalize OS paths and retain nested identity and repeated names', () => {
  const run = cwd => {
    const r = reporter(cwd);
    r.onEvent(event(1, 'suite', { details: { type: 'suite', passed: true } }));
    r.onEvent(event(2, 'same', { parentId: 1, nesting: 1 }));
    r.onEvent(event(3, 'same', { parentId: 1, nesting: 1 }));
    r.onEvent(event(4, 'other'));
    r.onEvent({ type: 'test:complete', data: { file, name: file } });
    r.onFile({ file, passed: true, summary: summary(3, { suites: 1, topLevel: 2 }) });
    return r.report();
  };
  const linux = run('/repo'), windows = run('C:\\repo');
  assert.deepEqual(windows, linux);
  assert.equal(linux.passed, true);
  assert.equal(linux.tests.length, 3);
  const repeated = linux.tests.filter(item => item.name[0] === 'suite');
  assert.deepEqual(repeated.map(item => item.name), [['suite', 'same'], ['suite', 'same']]);
  assert.deepEqual(repeated.map(item => item.occurrence), [1, 2]);
  assert.equal(new Set(linux.tests.map(item => item.key)).size, 3);
  assert.deepEqual(linux.completedFiles, [file]);
});

test('coverage preserves skipped suites, todo, failures and cancellations', () => {
  const r = reporter();
  r.onEvent(event(1, 'skipped suite', { skip: 'Windows only', details: { type: 'suite', passed: true } }));
  r.onEvent(event(2, 'skip', { skip: true }));
  r.onEvent(event(3, 'todo', { todo: 'later' }));
  r.onEvent(event(4, 'failure', { details: { passed: false } }));
  r.onEvent(event(5, 'cancelled', { details: { passed: false, error: { failureType: 'cancelledByParent' } } }));
  r.onFile({ file, passed: false, summary: summary(4, { suites: 1, passed: 0, skipped: 1, todo: 1, failed: 1, cancelled: 1, topLevel: 5 }) });
  const result = r.report({ passed: true });
  assert.equal(result.passed, false);
  assert.deepEqual(Object.fromEntries(result.tests.map(item => [item.name[0], item.status])), {
    'skipped suite': 'skip', skip: 'skip', todo: 'todo', failure: 'fail', cancelled: 'cancelled',
  });
  assert.equal(result.tests.find(item => item.name[0] === 'skipped suite').reason, 'Windows only');
});

test('coverage fails closed for malformed inventory, identities and incomplete execution', () => {
  assert.throws(() => createCoverageReporter({ files: [file, file] }), /Duplicate/);
  assert.throws(() => createCoverageReporter({ files: ['../outside.test.mjs'] }), /outside/);
  const r = reporter();
  assert.equal(r.report({ passed: true }).passed, false);
  assert.throws(() => r.onEvent(event(1, 'bad', { entryFile: 'tests/unexpected.test.mjs' })), /Unexpected/);
  r.onEvent({ type: 'test:enqueue', data: event(1, 'pending').data });
  assert.throws(() => r.report(), /Incomplete/);
  r.onEvent(event(1, 'pending'));
  assert.throws(() => r.onEvent(event(1, 'pending')), /Duplicate/);
  r.onEvent(event(2, 'orphan', { parentId: 999, nesting: 1 }));
  assert.throws(() => r.report(), /Missing coverage parent/);
});

test('coverage requires native counts and detects missing case events', () => {
  const r = reporter();
  assert.throws(() => r.onFile({ file, passed: true }), /Missing native coverage counts/);
  r.onEvent(event(1, 'only observed case'));
  r.onFile({ file, passed: true, summary: summary(2) });
  assert.throws(() => r.report(), /Native coverage count mismatch/);
});

test('real adaptive native events report nested cases, imported helpers and skipped suites', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-coverage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tests'));
  await writeFile(path.join(root, 'tests/helper.mjs'), `import { test } from 'node:test'; export const helper = () => test('helper case', () => {});`);
  await writeFile(path.join(root, file), `import { describe, test } from 'node:test';
import { helper } from './helper.mjs';
describe('outer', () => { describe('inner', () => { test('same', () => {}); test('same', () => {}); helper(); }); });
describe('omitted suite', {skip: 'platform reason'}, () => { test('never registered', () => {}); });
test('later', {todo: 'planned'}, () => {});
test('parent test', async t => { await t.test('child test', () => {}); });
`);
  const runner = new URL('../scripts/adaptive-test-runner.mjs', import.meta.url).href;
  const collector = new URL('../scripts/ci/coverage-reporter.mjs', import.meta.url).href;
  await writeFile(path.join(root, 'run.mjs'), `import { runAdaptive } from ${JSON.stringify(runner)};
import { createCoverageReporter } from ${JSON.stringify(collector)};
const files = [${JSON.stringify(file)}], r = createCoverageReporter({cwd: process.cwd(), files});
const result = await runAdaptive({files, minConcurrency: 1, maxConcurrency: 1, memory: () => 8 * 1024 ** 3, policy: () => ({}), onEvent: r.onEvent, onFile: r.onFile});
await r.write('coverage.json', {passed: result.passed});
`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['run.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(await readFile(path.join(root, 'coverage.json'), 'utf8'));
  assert.equal(result.passed, true);
  assert.equal(result.tests.length, 7);
  assert.equal(result.fileResults[0].recordCount, 7);
  assert.equal(result.fileResults[0].counts.tests, 6);
  assert.equal(result.fileResults[0].counts.suites, 3);
  assert.equal(result.tests.find(item => item.name[0] === 'parent test' && item.name.length === 1).kind, 'test');
  assert.equal(result.tests.find(item => item.name.at(-1) === 'helper case').file, file);
  assert.deepEqual(result.tests.find(item => item.name.at(-1) === 'helper case').name, ['outer', 'inner', 'helper case']);
  assert.equal(result.tests.find(item => item.name[0] === 'omitted suite').reason, 'platform reason');
  assert.equal(result.tests.find(item => item.name[0] === 'omitted suite').kind, 'suite');
  assert.equal(result.tests.find(item => item.name[0] === 'later').status, 'todo');
});
