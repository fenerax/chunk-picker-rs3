import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { affectedSelection, feedbackOrder, importGraph, moduleReferences, selectAffected } from '../scripts/test-affected.mjs';
import { GiB, runAdaptive } from '../scripts/adaptive-test-runner.mjs';
import { checkedInputContract, inputContracts } from '../scripts/test-affected-contracts.mjs';

test('static graph follows imports, reexports and literal lazy imports transitively', () => {
  const sources = new Map([
    ['app/leaf.mjs', 'export const leaf = 1;'],
    ['app/mid.mjs', "export { leaf } from './leaf.mjs';"],
    ['tests/consumer.test.mjs', "const load = () => import('../app/mid.mjs');"],
    ['tests/side.test.mjs', "import '../app/leaf.mjs';"],
    ['tests/no.test.mjs', '// import "../app/leaf.mjs"\nconst text = `import("../app/leaf.mjs")`;'],
  ]);
  assert.deepEqual(selectAffected({ sources, changed: ['app/leaf.mjs'],
    tests: ['consumer.test.mjs', 'side.test.mjs', 'no.test.mjs'], rules: [] }).files,
  ['consumer.test.mjs', 'side.test.mjs']);
  assert.deepEqual(moduleReferences(`// import './comment.mjs'
    const pattern = /import('fake')/;
    import { one } from './one.mjs'; export * from './two.mjs';
    const lazy = import(/* literal */ './three.mjs', { with: { type: 'json' } });
    const template = import(\`./four.mjs\`);
    const nested = \`x\${import('./five.mjs')}\`;
  `), ['./one.mjs', './two.mjs', './three.mjs', './four.mjs', './five.mjs']);
});

test('a lexical failure conservatively selects all tests', () => {
  assert.deepEqual(selectAffected({ sources: new Map([['app/broken.mjs', '/* unfinished']]),
    changed: ['app/leaf.mjs'], tests: ['one.test.mjs', 'two.test.mjs'] }).files,
  ['one.test.mjs', 'two.test.mjs']);
});

test('global execution and data changes return the exact inventory before graph construction', () => {
  const tests = ['z.test.mjs', 'consumer.test.mjs', 'a.test.mjs'];
  const sources = { [Symbol.iterator]() { throw Error('Global changes must bypass the graph'); } };
  for (const file of ['.github/workflows/new.yml', '.github/workflows/nested/deleted.yml',
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'nested/Cargo.lock',
    'scripts/test.mjs', 'scripts/adaptive-test-runner.mjs', 'scripts/test-discovery.mjs',
    'scripts/test-classification.mjs', 'scripts/test-selection-exceptions.mjs',
    'scripts/test-affected.mjs', 'scripts/test-affected-rules.mjs', 'scripts/test-run-environment.mjs',
    'scripts/test-telemetry.mjs', 'scripts/ci/new-config.mjs', 'scripts/private-companion/neutral-lane.mjs',
    'app/dataset-runtime.mjs', 'app/dataset-inputs.mjs', 'app/datasets/new/input.json',
    '.github/packs/pack-pin.json', 'packs/new/selection.json', '.env.test', '.gitattributes']) {
    assert.deepEqual(selectAffected({ sources, changed: [file], tests }).files, [...tests].sort(), file);
  }
});

test('literal dataset keys, file reads and file URLs create transitive data edges', () => {
  const sources = new Map([
    ['app/catalogue.mjs', "export const evidence = datasetJSON('app/data/example.json');"],
    ['app/reader.mjs', "const text = readFileSync('fixtures/example.json');"],
    ['app/url-reader.mjs', "const text = readFile(new URL('../fixtures/url.json', import.meta.url));"],
    ['tests/consumer.test.mjs', "import '../app/catalogue.mjs'; import '../app/reader.mjs'; import '../app/url-reader.mjs';"],
  ]);
  const graph = importGraph(sources), tests = ['consumer.test.mjs', 'unrelated.test.mjs'];
  assert.deepEqual(graph.uncertain, []);
  assert.ok(graph.reverse.get('app/data/example.json').has('app/catalogue.mjs'));
  for (const file of ['fixtures/example.json', 'fixtures/url.json']) {
    assert.deepEqual(selectAffected({ graph, changed: [file], tests, rules: [] }).files, ['consumer.test.mjs'], file);
  }
  // Data can also be injected by a pack/environment without a source import.
  for (const file of ['app/data/example.json', 'unmodeled/environment.json']) {
    assert.deepEqual(selectAffected({ graph, changed: [file], tests, rules: [] }).files, [...tests].sort());
  }
});

test('directory edges and prefix contracts cover additions, deletions and both sides of renames', () => {
  const tests = ['tree.test.mjs', 'other.test.mjs'];
  const sources = new Map([['tests/tree.test.mjs', "const inspect = () => readdir(new URL('../docs/', import.meta.url));"]]);
  for (const changed of [['docs/added.md'], ['docs/deleted.md'], ['docs/old.md', 'docs/nested/renamed.md']]) {
    assert.deepEqual(selectAffected({ sources, changed, tests, rules: [] }).files, ['tree.test.mjs']);
    assert.deepEqual(selectAffected({ sources: new Map(), changed, tests,
      rules: [{ prefixes: ['docs/'], tests: /^tree\.test\.mjs$/ }] }).files, ['tree.test.mjs']);
  }
  for (const file of ['README.md', 'docs/deep/new.md', 'app/data/roadmap.json', 'app/web/new-menu.html', 'app/web/deleted-menu.mjs']) {
    assert.ok(selectAffected({ sources: new Map(), changed: [file], tests: ['docs-menu-paths.test.mjs', ...tests] }).files.includes('docs-menu-paths.test.mjs'), file);
  }
});

test('uncovered changes run everything; only explicitly inert changes can select nothing', () => {
  const sources = new Map([['app/orphan.mjs', 'export const one = 1;']]), tests = ['one.test.mjs', 'two.test.mjs'];
  for (const file of ['new/unknown.txt', 'app/orphan.mjs', 'fixtures/new-input.bin']) {
    assert.deepEqual(selectAffected({ sources, changed: [file], tests, rules: [] }).files, tests, file);
  }
  for (const file of ['.gitignore', '.local/scratch.mjs']) {
    assert.deepEqual(selectAffected({ sources, changed: [file], tests }).files, []);
  }
  assert.deepEqual(selectAffected({ sources, changed: ['.gitignore', 'unknown.json'], tests }).files, tests);
});

test('uncertainty selects only its transitive consumers, retaining other known edges', () => {
  const sources = new Map([
    ['app/known.mjs', 'export const value = 1;'],
    ['app/opaque.mjs', "import './known.mjs'; import(target);"],
    ['tests/opaque.test.mjs', "import '../app/opaque.mjs';"],
    ['tests/known.test.mjs', "import '../app/known.mjs';"],
    ['tests/unrelated.test.mjs', 'export const value = 1;'],
  ]);
  const graph = importGraph(sources), tests = ['opaque.test.mjs', 'known.test.mjs', 'unrelated.test.mjs'];
  assert.deepEqual(graph.uncertain, ['app/opaque.mjs']);
  assert.ok(graph.reverse.get('app/known.mjs').has('app/opaque.mjs'));
  assert.deepEqual(selectAffected({ graph, tests, changed: ['tests/known.test.mjs'], rules: [] }).files, ['known.test.mjs', 'opaque.test.mjs']);
  assert.deepEqual(selectAffected({ graph, tests, changed: ['app/known.mjs'], rules: [] }).files.sort(), ['known.test.mjs', 'opaque.test.mjs']);
});

test('audited finite-input loader contracts reject changes to reads or argument provenance', async () => {
  for (const file of Object.keys(inputContracts)) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.deepEqual(checkedInputContract(file, source), inputContracts[file].files, `Re-audit changed loader: ${file}`);
    // The only computed input is a member of this literal array. The complete
    // source guard also protects it from reassignment elsewhere in the body.
    assert.match(source, /\['open-(?:f2p|starter)\.mjs', 'open-starter-data\.mjs'\]\.map\(name =>/);
    assert.match(source, /readFileSync\(new URL\(name, import\.meta\.url\)\)/);
    for (const mutation of [
      source.replace("'open-starter-data.mjs'", "'../outside.json'"),
      source.replace('new URL(name, import.meta.url)', 'new URL(options.filename, import.meta.url)'),
      source + "\nreadFileSync('outside.json');\n",
    ]) assert.equal(checkedInputContract(file, mutation), undefined, 'An expanded read scope must invalidate the contract');
  }
});

test('referenced inert paths and literal filesystem percent/hash names select their consumers', () => {
  for (const file of ['.gitignore', '.local/input.txt', '.git/input.txt', 'app/web/tone%20raw.css', 'app/web/tone#raw.css']) {
    const sources = new Map([['tests/consumer.test.mjs', `import { readFileSync } from 'node:fs'; readFileSync('${file}', 'utf8');`]]);
    const graph = importGraph(sources);
    assert.deepEqual(graph.uncertain, [], file);
    assert.ok(graph.reverse.get(file).has('tests/consumer.test.mjs'), file);
    assert.ok(selectAffected({ graph, changed: [file], tests: ['consumer.test.mjs', 'server.test.mjs', 'docs-menu-paths.test.mjs'] }).files.includes('consumer.test.mjs'), file);
  }
});

test('directory operation establishes a prefix without a trailing slash, including glob patterns', () => {
  for (const call of ["readdirSync(new URL('../docs', import.meta.url))", "opendir('docs')", "glob('docs/*.md')"]) {
    const graph = importGraph(new Map([['tests/consumer.test.mjs', call]]));
    assert.deepEqual(graph.uncertain, [], call);
    for (const changed of [['docs/new.md'], ['docs/deleted.md'], ['docs/old.md', 'docs/new.md']]) {
      assert.deepEqual(selectAffected({ graph, changed, tests: ['consumer.test.mjs', 'other.test.mjs'], rules: [] }).files, ['consumer.test.mjs'], call);
    }
  }
  const graph = importGraph(new Map([['tests/consumer.test.mjs', "glob('README.md')"]]));
  assert.ok(selectAffected({ graph, changed: ['README.md'], tests: ['consumer.test.mjs', 'docs-menu-paths.test.mjs'] }).files.includes('consumer.test.mjs'));
});

test('unmodeled fs access stays local for aliases, computed members, parenthesized calls and module escape', () => {
  for (const code of [
    "import { readFileSync as read } from 'node:fs'; read(input);",
    "import * as fs from 'node:fs'; fs['readFileSync']('app/web/input.txt');",
    "import { readFileSync } from 'node:fs'; (readFileSync)('app/web/input.txt');",
    "import fs from 'fs/promises'; consume(fs);",
    "import { promises as fs } from 'node:fs'; consume(fs);",
    "export { readFileSync as load } from 'node:fs';",
  ]) {
    const graph = importGraph(new Map([['tests/opaque.test.mjs', code], ['tests/known.test.mjs', 'export const x = 1;']]));
    assert.deepEqual(graph.uncertain, ['tests/opaque.test.mjs'], code);
    assert.deepEqual(selectAffected({ graph, changed: ['tests/known.test.mjs'], tests: ['known.test.mjs', 'opaque.test.mjs', 'other.test.mjs'], rules: [] }).files, ['known.test.mjs', 'opaque.test.mjs']);
  }
});

test('parenthesized literal imports and URL-encoded filenames resolve like native file URLs', () => {
  for (const [expression, file] of [
    ["import((('../app/leaf.mjs')))", 'app/leaf.mjs'],
    ["import(('../app/leaf%20name.mjs'))", 'app/leaf name.mjs'],
    ["import '../app/leaf%20name.mjs';", 'app/leaf name.mjs'],
    ["export * from '../app/leaf%23name.mjs';", 'app/leaf#name.mjs'],
  ]) {
    const sources = new Map([[file, 'export const one = 1;'], ['tests/consumer.test.mjs', expression]]);
    const graph = importGraph(sources);
    assert.deepEqual(graph.uncertain, [], expression);
    assert.deepEqual(selectAffected({ graph, changed: [file], tests: ['consumer.test.mjs', 'other.test.mjs'], rules: [] }).files, ['consumer.test.mjs'], expression);
  }
});

test('computed, missing, escaped, external or invalid module loads force the entire inventory', () => {
  const tests = ['consumer.test.mjs', 'other.test.mjs'];
  for (const expression of ["import(target)", "import(('../app/' + name))", "import('../app/missing.mjs')",
    "import '../app/leaf%ZZ.mjs';", "import '../app/leaf%2Fname.mjs';", "import 'unmodeled-package';",
    "import '../app/leaf\\u0020name.mjs';", "require('../app/leaf.mjs')",
    "readFileSync(filename)", "datasetJSON(key)", "new URL('../app/leaf.mjs', unknownBase)"]) {
    const graph = importGraph(new Map([['tests/consumer.test.mjs', expression]]));
    assert.ok(graph.uncertain.length, expression);
    assert.deepEqual(selectAffected({ graph, changed: ['app/leaf.mjs'], tests, rules: [] }).files, tests, expression);
  }
});

test('affected sentinel order precedes solo work and a failure stops admission', async () => {
  const inventory = ['a.test.mjs', 'storage-static.test.mjs', 'server.test.mjs', 'browser-module-graph.test.mjs'];
  const full = selectAffected({ changed: ['package-lock.json'], tests: inventory });
  assert.deepEqual(feedbackOrder(full.files), ['browser-module-graph.test.mjs', 'server.test.mjs', 'storage-static.test.mjs', 'a.test.mjs']);
  const controller = new AbortController(), admitted = [];
  const result = await runAdaptive({ files: ['sentinel.mjs', 'solo.mjs', 'later.mjs'],
    cwd: fileURLToPath(new URL('../', import.meta.url)), soloFirst: false,
    policy: name => ({ solo: name === 'solo.mjs' }), minConcurrency: 1, maxConcurrency: 1,
    memory: () => 8 * GiB, signal: controller.signal, pollMs: 1,
    runFile: async ({ file }) => { admitted.push(file); return { file, passed: false }; },
    onFile: () => controller.abort() });
  assert.equal(result.passed, false);
  assert.deepEqual(admitted, ['sentinel.mjs']);
});

test('merge-base selection includes staged and untracked changes without running deleted tests', async t => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'affected-git-fixture-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await mkdir(path.join(cwd, 'app')); await mkdir(path.join(cwd, 'tests'));
  await writeFile(path.join(cwd, 'app/leaf.mjs'), 'export const leaf = 1;');
  await writeFile(path.join(cwd, 'tests/consumer.test.mjs'), "import '../app/leaf.mjs';");
  await writeFile(path.join(cwd, 'tests/deleted.test.mjs'), '// synthetic test');
  git(['init']); git(['add', '.']);
  git(['-c', 'user.name=fenerax', '-c', 'user.email=fenerax@users.noreply.github.com', 'commit', '-m', 'Synthetic selector fixture\n\nWritten by Codex.']);
  git(['branch', 'baseline']);
  await unlink(path.join(cwd, 'tests/deleted.test.mjs'));
  await writeFile(path.join(cwd, 'app/leaf.mjs'), 'export const leaf = 2;'); git(['add', 'app/leaf.mjs']);
  await writeFile(path.join(cwd, 'tests/new.test.mjs'), "import '../app/leaf.mjs';");
  assert.deepEqual((await affectedSelection({ cwd, base: 'baseline' })).files, ['consumer.test.mjs', 'new.test.mjs']);
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: 'leaf.mjs', encoding: 'utf8', windowsHide: true }).trim();
  git(['update-index', '--add', '--cacheinfo', `120000,${blob},app/alias.mjs`]);
  const linked = await affectedSelection({ cwd, base: 'baseline', changed: ['app/leaf.mjs'] });
  assert.equal(linked.symlinks.length, 1);
  assert.equal(linked.full, true);
  assert.deepEqual(linked.files, ['consumer.test.mjs', 'new.test.mjs']);
  await assert.rejects(affectedSelection({ cwd, base: 'missing-base' }));
});

test('today\'s missed regressions are selected against the actual repository graph', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const names = execFileSync('git', ['ls-files', '-z', '--', '*.mjs'], { cwd, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const sources = new Map(await Promise.all(names.map(async name => [name, await readFile(new URL(`../${name}`, import.meta.url), 'utf8')])));
  const tests = names.filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name)).map(name => name.slice(6));
  sources.set('app/core/state.mjs', sources.get('app/core/state.mjs') + "\nimport './synthetic-new-browser-module.mjs';\n");
  sources.set('app/core/synthetic-new-browser-module.mjs', 'export const synthetic = true;');
  const graph = importGraph(sources);
  const choose = file => {
    const result = selectAffected({ graph, changed: [file], tests });
    return result.files;
  };
  for (const file of ['app/core/state.mjs', 'app/core/synthetic-new-browser-module.mjs']) {
    assert.ok(choose(file).includes('server.test.mjs'), file);
    assert.ok(choose(file).includes('browser-module-graph.test.mjs'), file);
  }
  const offhost = choose('scripts/linux/offhost-backup.mjs');
  for (const file of tests.filter(name => /^linux-offhost.*\.test\.mjs$/.test(name))) assert.ok(offhost.includes(file), file);
  assert.ok(choose('app/storage/store.mjs').includes('storage-static.test.mjs'));
  assert.ok(selectAffected({ graph, changed: ['app/storage/store.mjs'], tests, rules: [] }).files.includes('storage-static.test.mjs'));
  assert.ok(graph.reverse.get('app/data/divination.2026-10-13.v1.json').has('app/data/divination-training.mjs'));
  assert.ok(choose('app/data/divination.2026-10-13.v1.json').includes('divination-training.test.mjs'));
  assert.ok(choose('README.md').includes('docs-menu-paths.test.mjs'));
  for (const file of ['.github/workflows/test.yml', 'package-lock.json', 'scripts/test-affected.mjs', 'scripts/ci/coverage-gate.mjs']) {
    assert.deepEqual(choose(file), [...tests].sort(), file);
  }
  assert.deepEqual(selectAffected({ sources: new Map(), changed: ['tests/storage-static.test.mjs'], tests }).files, ['storage-static.test.mjs']);
  assert.ok(choose('docs/save-surface.json').includes('save-surface.test.mjs'));
  assert.ok(choose('.github/workflows/test.yml').includes('ci-coverage-gate.test.mjs'));
});
