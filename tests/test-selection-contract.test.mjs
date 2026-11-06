import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTest, concurrencyFor, createTestSelection, discoverTests, fullConcurrency, readTestSelection, selectTests, testRunPolicy } from '../scripts/test-selection.mjs';
import { testHeader } from '../scripts/test-classification.mjs';
import { hardCodedTestPorts } from '../scripts/test-port-check.mjs';
import { testRunEnvironment } from '../scripts/test-run-environment.mjs';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { redact } from '../scripts/test-timing-reporter.mjs';
import { releasePreflight } from '../scripts/private-companion/release-preflight.mjs';
import { fileProject } from '../scripts/private-companion/file-test-evidence.mjs';
import { openSources } from '../scripts/private-companion/neutral-lane.mjs';
import { planLane } from '../scripts/private-companion/file-test-lane.mjs';
import { fixture as laneFixture, hash, put } from './lane-test-fixture.mjs';

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
    'duo-focus-browser.test.mjs', 'setup-guide-browser.test.mjs', 'backup-file-browser.test.mjs'];
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

test('untagged additions run in full with shared/default-dataset policy and no registration', () => {
  assert.deepEqual(selectTests(['state.test.mjs', 'new-model.test.mjs']), ['state.test.mjs']);
  assert.deepEqual(selectTests(['state.test.mjs', 'new-model.test.mjs'], 'full'), ['new-model.test.mjs', 'state.test.mjs']);
  assert.equal(classifyTest('new-model.test.mjs'), 'full-only');
  assert.equal(classifyTest('new-model.private.test.mjs'), 'full-only');
  assert.deepEqual(testRunPolicy('new-model.test.mjs'), { solo: false });
  assert.equal(classifyTest('state.private.test.mjs'), 'quick');
  assert.equal(classifyTest('web-browser.private.test.mjs'), 'full-only');
  assert.equal(classifyTest('new-server.test.mjs'), 'full-only');
  assert.equal(classifyTest('cache-new-data.test.mjs'), 'full-only');
  assert.deepEqual(selectTests(['state.test.mjs', 'fixture.mjs', 'terrain-assets-exporter.test.py']), ['state.test.mjs']);
  assert.throws(() => selectTests([], 'quick'), /No tests selected/);
  assert.throws(() => selectTests(['state.test.mjs'], 'unknown'), /Suite must/);
});

test('header exceptions select each suite and carry per-entrypoint options', () => {
  const selection = createTestSelection(new Map([
    ['new-model.test.mjs', '// @test quick solo dataset=open-f2p\nthrow new Error("never import this test");'],
    ['new-model.private.test.mjs', '// Untagged split scenario'],
    ['new-diff.test.mjs', '// @test differential'],
    ['new-engine.test.mjs', '// @test engine-differential'],
    ['state.test.mjs', '// @test full shared dataset=default'],
  ]));
  const names = ['new-model.test.mjs', 'new-model.private.test.mjs', 'new-diff.test.mjs', 'new-engine.test.mjs', 'state.test.mjs'];
  assert.deepEqual(selection.selectTests(names), ['new-model.private.test.mjs', 'new-model.test.mjs']);
  assert.deepEqual(selection.selectTests(names, 'full'), ['new-model.private.test.mjs', 'new-model.test.mjs', 'state.test.mjs']);
  assert.deepEqual(selection.selectTests(names, 'differential'), ['new-diff.test.mjs']);
  assert.deepEqual(selection.selectTests(names, 'engine-differential'), ['new-engine.test.mjs']);
  assert.deepEqual(selection.testRunPolicy('new-model.test.mjs'), { ...testRunPolicy('original-paste.test.mjs'), solo: true });
  assert.deepEqual(selection.testRunPolicy('new-model.private.test.mjs'), { solo: false }, 'only suite membership is inherited');
  assert.deepEqual(selection.testRunPolicy('state.test.mjs'), { solo: false });
  assert.equal(selection.classifyTest('fixture.mjs'), null);
  assert.equal(selection.classifyTest('state.test.mjs'), 'full-only', 'header overrides a compatibility exception');
  const reset = createTestSelection(new Map([
    ['original-paste.test.mjs', '// @test dataset=default'], ['activity.test.mjs', '// @test shared'],
  ]));
  assert.deepEqual(reset.testRunPolicy('original-paste.test.mjs'), { solo: false });
  assert.equal(reset.classifyTest('original-paste.test.mjs'), 'quick', 'omitted suite retains the existing exception');
  assert.deepEqual(reset.testRunPolicy('activity.test.mjs'), { solo: false });
});

test('only the first-line metadata comment is interpreted, with BOM/shebang and CRLF support', () => {
  assert.deepEqual(testHeader('\uFEFF#!/usr/bin/env node\r\n// @test quick solo\r\n'), { classification: 'quick', solo: true });
  for (const source of ['// ordinary comment\n// @test quick', 'const text = "// @test quick";', '/* @test quick */']) {
    assert.deepEqual(testHeader(source), {});
  }
  for (const tag of ['quick full', 'solo shared', 'dataset=default dataset=open-f2p', 'quick typo', 'dataset=unknown']) {
    assert.throws(() => testHeader('// @test ' + tag, 'new.test.mjs'), /Invalid @test option .* in new.test.mjs/);
  }
});

test('discovery uses the supplied tree and an untagged new file executes without edits', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'test-classification-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'brand-new.test.mjs');
  await writeFile(file, 'import test from "node:test"; test("automatic default runs", () => {});\n');
  await writeFile(path.join(directory, 'tagged.test.mjs'), '// @test quick solo dataset=open-f2p\nthrow new Error("classification must not execute test modules");');
  assert.deepEqual(await discoverTests(directory, 'full'), ['brand-new.test.mjs', 'tagged.test.mjs']);
  assert.deepEqual(await discoverTests(directory), ['tagged.test.mjs']);
  const selection = await readTestSelection(directory);
  assert.deepEqual(selection.testRunPolicy('brand-new.test.mjs'), { solo: false });
  assert.equal(selection.testRunPolicy('tagged.test.mjs').env.RS3_DATASET, 'open-f2p');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', file], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.match(output, /automatic default runs/);
  assert.match(output, /(?:#|ℹ) pass 1/);
  // Removing/renaming a migrated exception must not leave a registry gate.
  await writeFile(path.join(directory, 'renamed.test.mjs'), await readFile(file));
  assert.ok((await discoverTests(directory, 'full')).includes('renamed.test.mjs'));
  const port = '8' + '788';
  await writeFile(file, `const listener = { port: ${port} };`);
  await assert.rejects(discoverTests(directory), /Hard-coded test listen ports: brand-new/);
});

test('release inventory classifies committed and private bytes without loading a mirrored selector', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'classification-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const core = path.join(directory, 'core'), source = path.join(directory, 'private');
  for (const root of [core, source]) for (const name of ['scripts', 'tests']) await mkdir(path.join(root, name), { recursive: true });
  for (const name of ['test-classification.mjs', 'test-selection-exceptions.mjs', 'test-port-check.mjs']) {
    await writeFile(path.join(core, 'scripts', name), await readFile(new URL('../scripts/' + name, import.meta.url)));
  }
  await writeFile(path.join(core, 'tests/new.test.mjs'), '// An ordinary untagged file.\n');
  await writeFile(path.join(core, 'tests/reviewed.test.mjs'), '// @test quick\n');
  await writeFile(path.join(core, 'tests/detector.test.mjs'), '// @test differential\n');
  await writeFile(path.join(source, 'tests/new.private.test.mjs'), '// @test engine-differential\n');
  await writeFile(path.join(source, 'scripts/test-selection.mjs'), 'throw new Error("obsolete selector must not execute");\n');
  const git = (...args) => execFileSync('git', ['-C', core, '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=',
    '-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'Synthetic classification fixture');
  // Worktree bytes must not influence object-only inventory inspection.
  await writeFile(path.join(core, 'tests/reviewed.test.mjs'), '// @test full\n');
  const result = await releasePreflight({ core, source, packs: path.join(directory, 'absent-packs'), ref: 'HEAD', base: 'HEAD', objectOnly: true });
  for (const scope of ['public', 'private']) {
    const row = result.checks.find(row => row.id === `test-inventory-${scope}`);
    assert.equal(row.status, 'pass', JSON.stringify(row));
    assert.equal(row.inventory.find(row => row.name === 'new.test.mjs').lane, 'full-only');
    assert.equal(row.inventory.find(row => row.name === 'reviewed.test.mjs').lane, 'quick');
    assert.equal(row.inventory.find(row => row.name === 'detector.test.mjs').lane, 'differential-only');
    if (scope === 'private') assert.equal(row.inventory.find(row => row.name === 'new.private.test.mjs').lane, 'engine-differential-only');
  }
});

test('private source views and file evidence use the same automatic selector as assembly', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'classification-overlay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const core = path.join(directory, 'core'), privateSource = path.join(directory, 'private');
  for (const root of [core, privateSource]) await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(core, 'scripts/test-classification.mjs'), '// automatic classifier\n');
  await writeFile(path.join(core, 'scripts/test-selection.mjs'), '// core selector\n');
  await writeFile(path.join(privateSource, 'scripts/test-selection.mjs'), '// old private selector\n');
  const selector = 'scripts/test-selection.mjs';
  assert.equal((await (await openSources({ core, privateSource })).read(selector)).toString(), '// core selector\n');
  assert.equal((await fileProject({ coreRoot: core, privateRoot: privateSource })).entries.get(selector).source, path.join(core, selector));
  await rm(path.join(core, 'scripts/test-classification.mjs'));
  assert.equal((await (await openSources({ core, privateSource })).read(selector)).toString(), '// old private selector\n');
  assert.equal((await fileProject({ coreRoot: core, privateRoot: privateSource })).entries.get(selector).source, path.join(privateSource, selector));
});

test('file reuse binds automatic classification helpers and compatibility exceptions as runner policy', async t => {
  const f = await laneFixture(t);
  const helpers = ['test-classification.mjs', 'test-discovery.mjs', 'test-selection-exceptions.mjs'];
  for (const name of helpers) await put(path.join(f.release, 'core/scripts', name), '// synthetic ' + name);
  const plans = await planLane(f.options);
  for (const plan of plans) for (const name of helpers) {
    assert.equal(plan.contract.inputs.runnerPins['scripts/' + name], hash('// synthetic ' + name));
  }
  await put(path.join(f.release, 'core/scripts/test-selection-exceptions.mjs'), '// changed classification');
  assert.notDeepEqual((await planLane(f.options)).map(plan => plan.contract.key), plans.map(plan => plan.contract.key));
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
