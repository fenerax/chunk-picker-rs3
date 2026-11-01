import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTest, concurrencyFor, fullConcurrency, selectTests, testRunPolicy } from '../scripts/test-selection.mjs';
import { hardCodedTestPorts } from '../scripts/test-port-check.mjs';
import { testRunEnvironment } from '../scripts/test-run-environment.mjs';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../scripts/test-timing-reporter.mjs';

test('test children share native bytecode cache and remove only their owned cache', async () => {
  const environment = { ...process.env };
  delete environment.NODE_COMPILE_CACHE;
  delete environment.NODE_DISABLE_COMPILE_CACHE;
  const run = await testRunEnvironment(environment);
  try {
    const child = execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { getCompileCacheDir } from 'node:module'; console.log(getCompileCacheDir());"],
    { env: run.env, encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
    const relative = path.relative(run.env.NODE_COMPILE_CACHE, child);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    await access(child);
    assert.equal(environment.NODE_COMPILE_CACHE, undefined);
    const explicit = await testRunEnvironment({ NODE_COMPILE_CACHE: run.env.NODE_COMPILE_CACHE });
    assert.equal(explicit.env.NODE_COMPILE_CACHE, run.env.NODE_COMPILE_CACHE);
    await explicit.cleanup();
    await access(run.env.NODE_COMPILE_CACHE);
  } finally { await run.cleanup(); }
  await assert.rejects(access(run.env.NODE_COMPILE_CACHE), { code: 'ENOENT' });
});

test('timing failures redact player, administrator, overlay and bearer credentials', () => {
  const credential = 'invented-private-fixture-value';
  for (const input of [`http://localhost/join/${credential}`, `http://localhost/overlay#key=${credential}`,
    `http://localhost/?overlay_token=${credential}&view=one`, `Bearer ${credential}`]) {
    const output = redact(input);
    assert.equal(output.includes(credential), false);
    assert.ok(output.includes('<token>'));
  }
  assert.equal(redact('unrelated failure details'), 'unrelated failure details');
  assert.equal(redact(`credential: "${'Z'.repeat(43)}"`), 'credential: "<token>"');
});

test('full suite retains quick and full-only files and heavy families remain full-only', () => {
  const files = ['state.test.mjs', 'server.test.mjs', 'web-browser.test.mjs', 'perf-harness.test.mjs',
    'cache-game-data-items.test.mjs', 'original-parity.test.mjs', 'command-performance.test.mjs',
    'duo-focus-browser.test.mjs', 'setup-guide-browser.test.mjs'];
  assert.deepEqual(selectTests(files), ['state.test.mjs']);
  assert.deepEqual(selectTests(files, 'full'), [...files].sort());
  for (const name of files.slice(1)) assert.equal(classifyTest(name), 'full-only', name);
  for (const port of [8000, 8788, 9049, 9999]) {
    for (const source of [`port: ${port}`, `server.listen('${port}')`, `const listenerPort = ${port}; createServer({port: listenerPort})`]) {
      assert.deepEqual(hardCodedTestPorts(source), [{ line: 1, port }], source);
    }
  }
  assert.deepEqual(hardCodedTestPorts(`// fixture\nserver.listen(${9}_049)`), [{ line: 2, port: Number('9049') }]);
  for (const port of [0, 7999, 10000, 19888]) assert.deepEqual(hardCodedTestPorts(`port: ${port}`), []);
  assert.deepEqual(hardCodedTestPorts(`const chunkId = ${9049}; assert.equal(value, chunkId)`), []);
});

test('unclassified additions fail every suite instead of disappearing from quick feedback', () => {
  for (const suite of ['quick', 'full', 'differential']) {
    assert.throws(() => selectTests(['state.test.mjs', 'new-model.test.mjs'], suite), /Unclassified tests: new-model/);
  }
  assert.equal(classifyTest('new-model.test.mjs'), null);
  assert.equal(classifyTest('new-model.private.test.mjs'), null);
  assert.equal(classifyTest('state.private.test.mjs'), 'quick');
  assert.equal(classifyTest('web-browser.private.test.mjs'), 'full-only');
  assert.equal(classifyTest('new-server.test.mjs'), 'full-only');
  assert.equal(classifyTest('cache-new-data.test.mjs'), 'full-only');
  assert.deepEqual(selectTests(['state.test.mjs', 'fixture.mjs', 'terrain-assets-exporter.test.py']), ['state.test.mjs']);
  assert.throws(() => selectTests([], 'quick'), /No tests selected/);
  assert.throws(() => selectTests(['state.test.mjs'], 'unknown'), /Suite must/);
});

test('detector integration belongs only to the separately reported differential suite', () => {
  const integration = 'y03-fuzz-ci-integration.test.mjs', unit = 'y03-fuzz-ci.test.mjs';
  const files = [integration, unit, 'server.test.mjs'];
  assert.equal(classifyTest(integration), 'differential-only');
  assert.equal(classifyTest(unit), 'quick');
  assert.deepEqual(selectTests(files, 'quick'), [unit]);
  assert.deepEqual(selectTests(files, 'full'), ['server.test.mjs', unit]);
  assert.deepEqual(selectTests(files, 'differential'), [integration]);
  assert.equal(testRunPolicy(integration).solo, false);
  assert.equal(concurrencyFor('differential', {}), 1);
});

test('suite concurrency uses the measured default unless a valid override is given', () => {
  assert.equal(fullConcurrency, 6);
  assert.equal(concurrencyFor('full', {}), fullConcurrency);
  assert.equal(concurrencyFor('quick', {}), 2);
  assert.equal(concurrencyFor('full', { RS3_TEST_CONCURRENCY: '4' }), 4);
  for (const cap of ['1','2','3','4','5','6']) assert.equal(concurrencyFor('full',{RS3_TEST_CONCURRENCY:cap}),Number(cap));
  for (const bad of ['0', '7', '8', '9', '2.5', 'many', '']) assert.equal(concurrencyFor('full', { RS3_TEST_CONCURRENCY: bad }), fullConcurrency);
});
