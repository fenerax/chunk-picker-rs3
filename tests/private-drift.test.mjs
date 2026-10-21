// Source-only checks: fixtures never import application modules, start a server,
// assemble a release, or read a gameplay save. All writes stay in job scratch.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkPrivateDrift } from '../scripts/private-companion/check-private-drift.mjs';
import { stageReleaseKit } from '../scripts/private-companion/stage-release-v2.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const checker = path.join(repository, 'scripts/private-companion/check-private-drift.mjs');
const scratchBase = path.resolve(process.env.RS3_DRIFT_TEST_ROOT ?? path.join(repository, '.local/private-drift-tests'));
const sha = value => createHash('sha256').update(value.replaceAll('\r\n', '\n')).digest('hex');
const put = async (root, name, value) => {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
};
const gitBytes = (repo, ...args) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], {
  windowsHide: true, maxBuffer: 16 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'],
});
const git = (repo, ...args) => gitBytes(repo, ...args).toString('utf8').trim();
async function fixture(t) {
  await mkdir(scratchBase, { recursive: true });
  const root = await mkdtemp(path.join(scratchBase, 'drift-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), scratchBase, 'cleanup remains inside job scratch');
    await rm(root, { recursive: true, force: true });
  });
  const core = path.join(root, 'core'), privateRoot = path.join(root, 'private');
  await mkdir(core); await mkdir(privateRoot);
  git(core, 'init', '-q'); git(core, 'config', 'core.autocrlf', 'false');
  git(core, 'config', 'user.name', 'Synthetic fixture'); git(core, 'config', 'user.email', 'fixture@example.invalid');
  const commitCore = () => { git(core, 'add', '.'); git(core, 'commit', '--allow-empty', '-qm', 'Synthetic core state'); };
  commitCore();
  return { root, core, privateRoot, commitCore, check: () => { commitCore(); return checkPrivateDrift({ core, privateRoot }); } };
}
function hasFinding(result, id, name) {
  assert.equal(result.passed, false);
  const row = result.findings.find(row => row.id === id && (!name || row.path === name));
  assert.ok(row, `expected ${id} at ${name ?? 'any path'}; got ${JSON.stringify(result.findings)}`);
  assert.equal(typeof row.message, 'string'); assert.ok(row.message.length);
  assert.equal(typeof row.fixHint, 'string'); assert.ok(row.fixHint.length);
  return row;
}
function clean(result) { assert.equal(result.passed, true, JSON.stringify(result.findings)); assert.deepEqual(result.findings, []); }

test('same-name overlays have caught and clean twins, including identical bytes and stale pins', async t => {
  const f = await fixture(t), name = 'tests/shared.test.mjs', original = 'export const fixture = true;\n';
  await put(f.core, name, original); await put(f.privateRoot, name, original);
  hasFinding(await f.check(), 'overlay-unreviewed', name);
  await put(f.privateRoot, 'tests/core-overlays.json', { schemaVersion: 1, files: { [name]: { coreSha256: sha(original) } } });
  clean(await f.check());
  await put(f.core, name, original + '// core changed\n');
  hasFinding(await f.check(), 'overlay-stale', name);
  await put(f.privateRoot, 'tests/core-overlays.json', { schemaVersion: 1, files: { [name]: { coreSha256: sha(original + '// core changed\n') } } });
  clean(await f.check());
});

test('private app code cannot replace a shared implementation; moving it to a private path is clean', async t => {
  const f = await fixture(t), name = 'app/shared.mjs';
  await put(f.core, name, 'export const value = 1;');
  await put(f.privateRoot, name, 'export const value = 2;');
  hasFinding(await f.check(), 'private-overwrite', name);
  await rm(path.join(f.privateRoot, name));
  await put(f.privateRoot, 'app/private-only.mjs', 'export const value = 2;');
  clean(await f.check());
});

test('literal relative imports catch missing paths and named exports without executing imported code', async t => {
  const f = await fixture(t), name = 'tests/import.private.test.mjs';
  await put(f.privateRoot, name, "import { present as alias } from '../app/contract.mjs';\n");
  hasFinding(await f.check(), 'import-missing', name);
  // A deliberate throw proves success uses source inspection, not module import.
  await put(f.core, 'app/contract.mjs', "throw new Error('must never execute fixture application code');\nexport const other = 1;\n");
  hasFinding(await f.check(), 'named-export-missing', name);
  await put(f.core, 'app/contract.mjs', "throw new Error('must never execute fixture application code');\nexport const present = 1;\n");
  clean(await f.check());
  await put(f.privateRoot, 'scripts/private-parser.mjs', "export function parse(word) { return word === 'import' ? '.' : 'export'; }\nconst options = { import: './generated-output.mjs' };\n");
  await put(f.privateRoot, name, "import { present } from '../app/contract.mjs';\nimport { parse } from '../scripts/private-parser.mjs';\n");
  clean(await f.check());
  await put(f.core, 'app/contract.mjs', "const words = ['export', 'default']; export const other = 1;\n");
  await put(f.privateRoot, name, "import chosen from '../app/contract.mjs';\n");
  hasFinding(await f.check(), 'named-export-missing', name);
  await put(f.core, 'app/contract.mjs', 'export default 1;\n');
  clean(await f.check());


});

test('literal test fixture reads have missing and present twins', async t => {
  const f = await fixture(t), name = 'tests/fixture.private.test.mjs';
  await put(f.privateRoot, name, "import { readFile } from 'node:fs/promises';\nconst data = await readFile(new URL('./fixtures/synthetic.json', import.meta.url), 'utf8');\n");
  hasFinding(await f.check(), 'fixture-missing', name);
  await put(f.privateRoot, 'tests/fixtures/synthetic.json', { synthetic: true });
  clean(await f.check());
});

test('private test-selection registrations must resolve to core or private test files', async t => {
  const f = await fixture(t);
  await put(f.privateRoot, 'scripts/test-selection.mjs', "export const quickTests = new Set(['registered.private.test.mjs']);\nexport const fullOnlyTests = new Set([]);\n");
  hasFinding(await f.check(), 'registered-test-missing');
  await put(f.privateRoot, 'tests/registered.private.test.mjs', '// Source-only synthetic registered test.\n');
  clean(await f.check());
});

test('public-export allowlist entries have missing and present core twins', async t => {
  const f = await fixture(t), name = 'scripts/public-export/allowlist.json';
  await put(f.privateRoot, name, { schemaVersion: 1, rulesVersion: 'fixture-1', entries: [{ path: 'app/public-module.mjs', reason: 'synthetic source' }] });
  hasFinding(await f.check(), 'public-export-missing');
  await put(f.core, 'app/public-module.mjs', 'export const synthetic = true;\n');
  clean(await f.check());
});

test('mirrored original-sync VM harness reports missing core collaborators while accepting named-import shorthand', async t => {
  const f = await fixture(t), name = 'tests/original-sync-web.test.mjs';
  await put(f.core, 'app/core/group-goal-types.mjs', 'export const groupGoalCommandTypes = [];\n');
  await put(f.core, 'app/web/screen-commands.mjs', `import { groupGoalCommandTypes } from '../core/group-goal-types.mjs';
export function createScreenCommands(c) {
  async function recoverPendingCommand() {}
  async function command() { await recoverPendingCommand(); document.activeElement; return groupGoalCommandTypes; }
  return { command };
}\n`);
  await put(f.core, 'tests/browser-screen-harness.mjs', 'export const screenFunctionSource = () => "";\nexport const readScreenGraph = () => new Map();\n');
  const harness = extra => `import { createContext, runInContext } from 'node:vm';
import { readScreenGraph, screenFunctionSource } from './browser-screen-harness.mjs';
import { groupGoalCommandTypes } from '../app/core/group-goal-types.mjs';
const graph = await readScreenGraph();
const helperSource = screenFunctionSource(graph, 'command');
function commandHarness() {
  const ctx = createContext({ groupGoalCommandTypes, ${extra} });
  runInContext(helperSource, ctx);
  return ctx;
}\n`;
  await put(f.privateRoot, name, harness(''));
  const failed = await f.check();
  hasFinding(failed, 'vm-stub-missing', name);
  assert.match(JSON.stringify(failed.findings), /recoverPendingCommand/);
  assert.doesNotMatch(JSON.stringify(failed.findings.filter(row => row.id === 'vm-stub-missing')), /missing[^\n]*groupGoalCommandTypes/i);
  await put(f.privateRoot, name, harness('') + '\nconst unrelated = createContext({ document: { activeElement: null }, recoverPendingCommand: async () => {} });\n');
  const unrelated = await f.check();
  hasFinding(unrelated, 'vm-stub-missing', name);
  assert.deepEqual(unrelated.findings.filter(row => row.id === 'vm-stub-missing').map(row => row.dependency).sort(), ['document', 'recoverPendingCommand']);
  await put(f.privateRoot, name, harness('document: { activeElement: null }, recoverPendingCommand: async () => {}'));
  clean(await f.check());
  await put(f.core, 'app/web/screen-commands.mjs', "throw new Error('source-only fixture must never execute');\nexport function createScreenCommands(c) { return {}; }\n");
  const removed = await f.check();
  const missingFunction = hasFinding(removed, 'vm-stub-missing', name);
  assert.equal(missingFunction.function, 'command');
  assert.match(missingFunction.message, /function command is absent/);
});

test('private pack requires pins follow the shared dataset schema contract', async t => {
  const f = await fixture(t);
  await put(f.core, 'app/datasets.mjs', "export const DATASET_CONTRACT = Object.freeze({ datasetId: 'fixture', datasetContractVersion: 2, identityNamespace: 'fixture', coordinateSystem: 'fixture-grid', corePackApi: 1 });\n");
  const builder = version => `const manifest = { requires: { datasetId: 'fixture', datasetContractVersion: ${version}, identityNamespace: 'fixture', coordinateSystem: 'fixture-grid', corePackApi: 1 } };\n`;
  await put(f.privateRoot, 'scripts/build-art-pack.mjs', builder(1));
  hasFinding(await f.check(), 'pack-contract-mismatch');
  await put(f.privateRoot, 'scripts/build-art-pack.mjs', builder(2));
  clean(await f.check());
  await put(f.privateRoot, 'scripts/build-art-pack.mjs', 'const manifest = { requires: computedContract() };');
  hasFinding(await f.check(), 'pack-contract-unsupported');
  await put(f.privateRoot, 'scripts/build-art-pack.mjs', builder(2));
  await put(f.core, 'app/datasets.mjs', 'export const DATASET_CONTRACT = computedContract();');
  hasFinding(await f.check(), 'pack-contract-unsupported');
  await rm(path.join(f.core, 'app/datasets.mjs'));
  hasFinding(await f.check(), 'pack-contract-unsupported');

});

test('Git revision inspection ignores dirty checkout code and CLI returns actionable JSON', async t => {
  const f = await fixture(t);
  git(f.core, 'init', '-q'); git(f.core, 'config', 'core.autocrlf', 'false');
  git(f.core, 'config', 'user.name', 'Synthetic fixture'); git(f.core, 'config', 'user.email', 'fixture@example.invalid');
  await put(f.core, 'app/public.mjs', 'export const present = 1;\n');
  git(f.core, 'add', '.'); git(f.core, 'commit', '-qm', 'Synthetic core');
  const revision = git(f.core, 'rev-parse', 'HEAD');
  await put(f.privateRoot, 'tests/immutable.private.test.mjs', "import { present } from '../app/public.mjs';\n");
  await put(f.core, 'app/public.mjs', 'export const other = 1;\n');
  clean(await checkPrivateDrift({ core: revision, coreRepo: f.core, privateRoot: f.privateRoot }));
  clean(await checkPrivateDrift({ core: git(f.core, 'rev-parse', `${revision}^{tree}`), coreRepo: f.core, privateRoot: f.privateRoot }));
  clean(await checkPrivateDrift({ core: f.core, privateRoot: f.privateRoot }));
  f.commitCore();
  hasFinding(await checkPrivateDrift({ core: f.core, privateRoot: f.privateRoot }), 'named-export-missing');
  const good = spawnSync(process.execPath, [checker, '--core', revision, '--core-repo', f.core, '--private', f.privateRoot, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(good.status, 0, good.stderr); clean(JSON.parse(good.stdout));
  const bad = spawnSync(process.execPath, [checker, '--core', f.core, '--private', f.privateRoot, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1, bad.stderr);
  hasFinding(JSON.parse(bad.stdout), 'named-export-missing');
});

test('staging refuses drift before intake, copying or kit creation', async t => {
  const f = await fixture(t), accepted = path.join(f.root, 'accepted'), packs = path.join(f.root, 'packs'), output = path.join(f.root, 'absent-kit');
  await mkdir(accepted); await mkdir(packs);
  git(f.core, 'init', '-q'); git(f.core, 'config', 'core.autocrlf', 'false');
  git(f.core, 'config', 'user.name', 'Synthetic fixture'); git(f.core, 'config', 'user.email', 'fixture@example.invalid');
  await put(f.core, 'app/shared.mjs', 'export const shared = true;\n');
  git(f.core, 'add', '.'); git(f.core, 'commit', '-qm', 'Synthetic core');
  await put(f.privateRoot, 'tests/missing.private.test.mjs', "import { removed } from '../app/removed.mjs';\n");
  await assert.rejects(stageReleaseKit({ source: f.privateRoot, coreRepo: f.core, coreRef: git(f.core, 'rev-parse', 'HEAD'), base: 'deliberately-invalid-base', accepted, packs, output }), error => {
    assert.match(error.message, /drift|missing|removed/i);
    assert.match(error.message, /check-private-drift\.mjs|import-missing|removed\.mjs/);
    return true;
  });
  const cli = spawnSync(process.execPath, [path.join(repository, 'scripts/private-companion/stage-release-v2.mjs'),
    '--source', f.privateRoot, '--core-repo', f.core, '--core-ref', git(f.core, 'rev-parse', 'HEAD'),
    '--base', 'deliberately-invalid-base', '--accepted', accepted, '--packs', packs, '--output', output],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Private source drift:/);
  assert.match(cli.stderr, /removed\.mjs/);
  assert.doesNotMatch(cli.stderr, /^Release kit staging refused\.$/m);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  assert.deepEqual(await readdir(accepted), []); assert.deepEqual(await readdir(packs), []);
  // Paired intake must refuse before even looking for export metadata/tooling.
  // This Git source deliberately has neither capture.json nor an exporter.
  git(f.privateRoot, 'init', '-q'); git(f.privateRoot, 'config', 'core.autocrlf', 'false');
  git(f.privateRoot, 'config', 'user.name', 'Synthetic fixture');
  git(f.privateRoot, 'config', 'user.email', 'fixture@example.invalid');
  git(f.privateRoot, 'add', '.'); git(f.privateRoot, 'commit', '-qm', 'Synthetic private source');
  const privateCommit = git(f.privateRoot, 'rev-parse', 'HEAD');
  await put(f.privateRoot, 'tests/missing.private.test.mjs', '// A dirty checkout cannot repair the selected commit.');
  hasFinding(await checkPrivateDrift({ core: git(f.core, 'rev-parse', 'HEAD'), coreRepo: f.core, privateRepo: f.privateRoot, privateCommit }), 'import-missing');
  await assert.rejects(stageReleaseKit({ privateRepo: f.privateRoot, privateCommit,
    coreRepo: f.core, coreRef: git(f.core, 'rev-parse', 'HEAD'), base: 'deliberately-invalid-base', accepted, packs, output }),
    error => { assert.equal(error.privateDrift, true); assert.match(error.message, /removed\.mjs/); return true; });
  await assert.rejects(lstat(output), { code: 'ENOENT' });

});

test('the in-repository exporter copies one exact commit and needs no private tooling', async t => {
  const f = await fixture(t), repo = f.privateRoot, out = path.join(f.root, 'export', 'source');
  git(repo, 'init', '-q'); git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.name', 'Synthetic fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
  await put(repo, 'app/kept.mjs', 'export const kept = 1;\n');
  await put(repo, 'tests/kept.test.mjs', '// kept\n');
  await put(repo, 'README.md', 'management file\n');
  await put(repo, 'docs/excluded.md', 'listed exclusion\n');
  await put(repo, '.private-source/exclusions.json', [{ path: 'docs/excluded.md' }]);
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'Synthetic one-repository source');
  const commit = git(repo, 'rev-parse', 'HEAD');
  await put(repo, 'app/kept.mjs', '// a dirty checkout never reaches the export\n');
  const { exportSource } = await import('../scripts/private-companion/export-repo-source.mjs');
  await assert.rejects(exportSource({ repo, commit: 'HEAD', out }), /Exact 40-character commit/);
  await mkdir(path.dirname(out));
  const receipt = await exportSource({ repo, commit, out });
  assert.equal(receipt.schema, 'rs3-private-export-v1'); assert.equal(receipt.commit, commit); assert.equal(receipt.output, out);
  assert.equal(receipt.fileCount, 2);
  assert.deepEqual((await readdir(out)).sort(), ['app', 'tests']);
  assert.equal(await readFile(path.join(out, 'app/kept.mjs'), 'utf8'), 'export const kept = 1;\n');
  await assert.rejects(exportSource({ repo, commit, out }), /already exists/);
  await assert.rejects(lstat(path.join(repo, 'tools')), { code: 'ENOENT' });
});

function historicalRepositories() {
  const projects = process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Projects');
  const privateRepo = process.env.RS3_DRIFT_PRIVATE_REPO ?? (projects && path.join(projects, 'chunk-picker-rs3-private-src'));
  const coreRepo = process.env.RS3_DRIFT_CORE_REPO ?? (projects && path.join(projects, 'chunk-picker-rs3-core'));
  if (!privateRepo || !coreRepo) return null;
  try {
    for (const ref of ['c9c07b0^', 'c9c07b0', 'fcbe7ff']) git(privateRepo, 'cat-file', '-e', `${ref}^{commit}`);
    for (const ref of ['8ae68b1', '6a1ae1e']) git(coreRepo, 'cat-file', '-e', `${ref}^{commit}`);
    return { privateRepo, coreRepo };
  } catch { return null; }
}

// Project immutable historical source without exporting large private data. All
// JavaScript and small JSON are exact Git blobs; large data/assets become empty
// existence markers. No data parser or application loader runs in these tests.
async function projectHistoricalSource(repo, ref, destination) {
  const records = gitBytes(repo, 'ls-tree', '-rlz', ref).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t([\s\S]+)$/.exec(row);
    assert.ok(match, 'historical source has regular blobs only');
    return { mode: match[1], oid: match[2], size: Number(match[3]), name: match[4] };
  }).filter(row => /^(app|archive|docs|reference|resources|scripts|tests)\//.test(row.name) || !row.name.includes('/'));
  assert.ok(records.length > 100, 'replay is a real source inventory');
  const exact = records.filter(row => /\.(?:mjs|cjs|js)$/.test(row.name)
    || row.name.endsWith('.json') && row.size <= 128 * 1024
    || row.name === 'scripts/public-export/allowlist.json');
  const result = spawnSync('git', ['--no-optional-locks', '-C', repo, 'cat-file', '--batch'], {
    input: exact.map(row => row.oid).join('\n') + '\n', windowsHide: true, maxBuffer: 32 * 1024 ** 2,
  });
  assert.equal(result.status, 0, 'historical source blob read succeeds');
  const contents = new Map(); let offset = 0;
  for (const record of exact) {
    const end = result.stdout.indexOf(10, offset);
    assert.ok(end >= offset);
    assert.equal(result.stdout.subarray(offset, end).toString(), `${record.oid} blob ${record.size}`);
    offset = end + 1;
    contents.set(record.name, result.stdout.subarray(offset, offset + record.size));
    offset += record.size + 1;
  }
  for (const record of records) {
    assert.ok(['100644', '100755'].includes(record.mode), 'projection refuses links or special entries');
    assert.ok(!record.name.split('/').includes('..'));
    await put(destination, record.name, contents.get(record.name) ?? Buffer.alloc(0));
  }
  return { exactFiles: exact.length, existenceOnlyFiles: records.length - exact.length };
}

test('real first-kit history catches the original-sync stub omission and accepts its committed repair', async t => {
  const repos = historicalRepositories();
  if (!repos) { t.skip('Historical private/core Git mirrors unavailable; configure RS3_DRIFT_PRIVATE_REPO and RS3_DRIFT_CORE_REPO.'); return; }
  const f = await fixture(t);
  await projectHistoricalSource(repos.privateRepo, 'c9c07b0^', f.privateRoot);
  const result = await checkPrivateDrift({ core: '8ae68b1', coreRepo: repos.coreRepo, privateRoot: f.privateRoot });
  const finding = hasFinding(result, 'vm-stub-missing', 'tests/original-sync-web.test.mjs');
  assert.match(finding.message + finding.fixHint, /recoverPendingCommand/);
  // Replace just the exact file fixed by c9c07b0, preserving all other historical
  // drift so a legacy overlay failure cannot accidentally masquerade as a pass.
  await put(f.privateRoot, 'tests/original-sync-web.test.mjs', gitBytes(repos.privateRepo, 'show', 'c9c07b0:tests/original-sync-web.test.mjs'));
  const repaired = await checkPrivateDrift({ core: '8ae68b1', coreRepo: repos.coreRepo, privateRoot: f.privateRoot });
  assert.deepEqual(repaired.findings.filter(row => row.id === 'vm-stub-missing' && row.path === 'tests/original-sync-web.test.mjs'), []);
});

test('real accepted rel7 private fcbe7ff and core 6a1ae1e pair passes the source-only drift check', async t => {
  const repos = historicalRepositories();
  if (!repos) { t.skip('Historical private/core Git mirrors unavailable; configure RS3_DRIFT_PRIVATE_REPO and RS3_DRIFT_CORE_REPO.'); return; }
  const f = await fixture(t);
  const projection = await projectHistoricalSource(repos.privateRepo, 'fcbe7ff', f.privateRoot);
  assert.ok(projection.exactFiles > 100);
  clean(await checkPrivateDrift({ core: '6a1ae1e', coreRepo: repos.coreRepo, privateRoot: f.privateRoot }));
  clean(await checkPrivateDrift({ core: '6a1ae1e', coreRepo: repos.coreRepo, privateRepo: repos.privateRepo, privateCommit: git(repos.privateRepo, 'rev-parse', 'fcbe7ff') }));
  const cli = spawnSync(process.execPath, [checker, '--core', '6a1ae1e', '--private', f.privateRoot, '--json'],
    { cwd: repository, encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  clean(JSON.parse(cli.stdout));

});
