import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { affectedSelection, importGraph, moduleReferences, selectAffected } from '../scripts/test-affected.mjs';
import { GiB, runAdaptive } from '../scripts/adaptive-test-runner.mjs';

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

test('affected sentinel order precedes solo work and a failure stops admission', async () => {
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
    assert.deepEqual(result.uncertain, [], 'The real repository must be scannable without a full fallback');
    return result.files;
  };
  for (const file of ['app/core/state.mjs', 'app/core/synthetic-new-browser-module.mjs']) {
    assert.ok(choose(file).includes('server.test.mjs'), file);
    assert.ok(choose(file).includes('browser-module-graph.test.mjs'), file);
  }
  const offhost = choose('scripts/linux/offhost-backup.mjs');
  for (const file of tests.filter(name => /^linux-offhost.*\.test\.mjs$/.test(name))) assert.ok(offhost.includes(file), file);
  assert.ok(choose('app/storage/store.mjs').includes('storage-static.test.mjs'));
  assert.ok(selectAffected({ graph, changed: ['app/storage/store.mjs'], tests, rules: [] }).files.includes('storage-static.test.mjs'), 'Storage is selected by the import graph itself');
  assert.deepEqual(selectAffected({ sources: new Map(), changed: ['tests/storage-static.test.mjs'], tests }).files, ['storage-static.test.mjs']);
  assert.ok(choose('docs/save-surface.json').includes('save-surface.test.mjs'));
  assert.ok(choose('.github/workflows/test.yml').includes('ci-coverage-gate.test.mjs'));
});
