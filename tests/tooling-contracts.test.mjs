import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mandatoryToolingContractTests, toolingContractTests } from '../scripts/private-companion/tooling-certificate.mjs';
import { toolingContractIdentity, toolingContractSupportScripts, assertToolingContracts, runToolingContracts, failedContractFiles } from '../scripts/private-companion/tooling-contracts.mjs';
import { prepareToolingContractWorkspace } from '../scripts/private-companion/tooling-contract-workspace.mjs';
import { hashTree, digestValue } from '../scripts/private-companion/release-identity.mjs';

async function supportFixture(source) {
  const directory = path.join(source, 'scripts/private-companion'); await mkdir(directory, { recursive: true });
  for (const name of toolingContractSupportScripts) await writeFile(path.join(directory, name), '// synthetic focused support\n');
}
async function catalogFixture(kit) {
  await mkdir(path.join(kit, 'tools'), { recursive: true });
  await writeFile(path.join(kit, 'tools/tooling-contract-catalog.mjs'), 'export const additionalToolingContractTests = Object.freeze([]);\n');
  await writeFile(path.join(kit, 'tools/tooling-certificate.mjs'), 'export const mandatoryToolingContractTests = Object.freeze(' + JSON.stringify(mandatoryToolingContractTests) + ');\n');
}

test('assertion-only edits require focused evidence without issuing another capability certificate', async t => {
  const root = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'tooling-contracts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit'), source = path.join(kit, 'checks/private-source/tests'); await mkdir(source, { recursive: true }); await mkdir(path.join(kit, 'operator'));
  await mkdir(path.join(kit, 'checks/private-source/scripts'));
  await supportFixture(path.join(kit, 'checks/private-source'));
  await catalogFixture(kit);
  for (const name of toolingContractTests) await writeFile(path.join(source, name), '// fixture contract');
  await writeFile(path.join(source,toolingContractTests[0]),"const fixturePath='tools/synthetic-only.mjs';");
  const options = { kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'one'), toolingDigest: 'a'.repeat(64) };
  let runs = 0;
  const dependencies = { exec: async () => { runs++; return { cleanupVerified: true, stdout: '# tests 7\n# fail 0\n# skipped 0\n# cancelled 0\n' }; } };
  const before = await toolingContractIdentity(kit);
  const first = await runToolingContracts(options, dependencies); assert.equal(first.reused, false);
  assert.equal((await runToolingContracts(options, dependencies)).reused, true);
  await writeFile(path.join(source, toolingContractTests[0]), '// changed assertion');
  assert.notEqual((await toolingContractIdentity(kit)).digest, before.digest);
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
  assert.equal((await runToolingContracts({ ...options, output: path.join(root, 'two') }, dependencies)).reused, false);
  await writeFile(path.join(kit,'operator','RELEASING.md'),'Changed tooling instructions.');
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
  assert.equal((await runToolingContracts({ ...options, output: path.join(root,'docs') }, dependencies)).reused, false);
  assert.equal(runs, 3); assert.equal(first.record.toolingDigest, options.toolingDigest);
});

test('incomplete focused runs cannot authorize a contract change', async t => {
  const root = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'tooling-contract-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit'), source = path.join(kit, 'checks/private-source/tests'); await mkdir(source, { recursive: true }); await mkdir(path.join(kit, 'operator'));
  await mkdir(path.join(kit, 'checks/private-source/scripts'));
  await supportFixture(path.join(kit, 'checks/private-source'));
  await catalogFixture(kit);
  for (const name of toolingContractTests) await writeFile(path.join(source, name), '// fixture');
  const options = { kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'run'), toolingDigest: 'b'.repeat(64) };
  await assert.rejects(runToolingContracts(options, { exec: async () => ({ cleanupVerified: true, stdout: '# fail 0\n# skipped 1\n' }) }), /complete pass/);
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
});

async function helperFixture(t) {
  const scratch = path.resolve(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir());
  const root = await mkdtemp(path.join(scratch, 'contract-workspace-'));
  t.after(async () => { assert.equal(path.dirname(root), scratch); await rm(root, { recursive: true, force: true }); });
  const kit = path.join(root, 'kit'), source = path.join(kit, 'checks/private-source'), repo = path.join(root, 'core');
  for (const directory of [path.join(source, 'scripts'), path.join(source, 'tests'), path.join(source, 'app/data'), path.join(kit, 'operator'), path.join(repo, 'scripts'), path.join(repo, 'app')]) await mkdir(directory, { recursive: true });
  await supportFixture(source);
  await catalogFixture(kit);
  for (const name of toolingContractTests) await writeFile(path.join(source, 'tests', name), '// synthetic focused contract\n');
  await writeFile(path.join(source, 'tests', toolingContractTests[0]), "import { marker } from '../scripts/core-contract-helper.mjs';\n");
  await writeFile(path.join(source, 'app/data/feature.json'), 'private feature payload');
  const helper = 'export const marker = "committed helper bytes";\n';
  await writeFile(path.join(repo, 'scripts/core-contract-helper.mjs'), helper);
  await writeFile(path.join(repo, 'scripts/test-selection.mjs'), "import { guard } from './selector-helper.mjs';\nexport const quickTests = new Set(['first.test.mjs']);\nexport const fullOnlyTests = new Set(['heavy.test.mjs']);\nexport const marker = guard;\n");
  await writeFile(path.join(repo, 'scripts/selector-helper.mjs'), 'export const guard = true;\n');
  await writeFile(path.join(repo, 'app/feature.mjs'), '// initial product feature\n');
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); git('config', 'core.longpaths', 'true');
  const commit = () => { git('add', '.'); git('-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic committed tooling helper'); return git('rev-parse', 'HEAD'); };
  const manifest = revision => writeFile(path.join(kit, 'kit.json'), JSON.stringify({ schemaVersion: 2, coreRevision: revision, toolingCoreRepo: repo }));
  await manifest(commit());
  return { root, kit, source, repo, helper, commit, manifest };
}

test('focused workspace hydrates only exact committed helpers without changing its additive private source', async t => {
  const fixture = await helperFixture(t), { root, kit, source, helper } = fixture;
  const identity = await toolingContractIdentity(kit), original = (await hashTree(kit)).digest;
  const workspace = await prepareToolingContractWorkspace({ kit, output: path.join(root, 'one'), identity });
  assert.equal(workspace.identity, identity, 'raw focused identity remains unchanged');
  assert.equal(workspace.contractDigest, identity.digest);
  assert.equal(await readFile(path.join(workspace.cwd, 'scripts/core-contract-helper.mjs'), 'utf8'), helper);
  assert.equal(workspace.treeDigest, (await hashTree(workspace.cwd)).digest);
  assert.deepEqual(workspace.materialized, [{ path: 'scripts/core-contract-helper.mjs', sha256: createHash('sha256').update(helper).digest('hex') }]);
  await assert.rejects(access(path.join(source, 'scripts/core-contract-helper.mjs')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(workspace.cwd, 'app')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(workspace.cwd, 'committed-core-tooling')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(workspace.cwd, 'scripts/selector-helper.mjs')), { code: 'ENOENT' });
  assert.equal((await hashTree(kit)).digest, original, 'kit and original additive source remain immutable');
  await writeFile(path.join(fixture.repo, 'app/feature.mjs'), '// unrelated product change\n');
  await writeFile(path.join(source, 'app/data/feature.json'), 'unrelated private feature change');
  await fixture.manifest(fixture.commit());
  const nextIdentity = await toolingContractIdentity(kit);
  assert.equal(nextIdentity.digest, identity.digest, 'unused app changes do not change raw focused identity');
  const next = await prepareToolingContractWorkspace({ kit, output: path.join(root, 'two'), identity: nextIdentity });
  assert.equal(next.digest, workspace.digest, 'core feature SHA does not enter workspace byte identity');
});

test('forged core hashes, product fallbacks and private helper collisions refuse before copying', async t => {
  const { root, kit, source } = await helperFixture(t), identity = await toolingContractIdentity(kit);
  const rewrite = mutate => { const { digest, ...body } = structuredClone(identity); mutate(body); return { ...body, digest: digestValue(body) }; };
  const forged = rewrite(body => { body.dependencies.find(row => row.origin === 'committed-core-tooling').sha256 = '0'.repeat(64); });
  await assert.rejects(prepareToolingContractWorkspace({ kit, output: path.join(root, 'forged'), identity: forged }), /raw contract identity/);
  await assert.rejects(access(path.join(root, 'forged')), { code: 'ENOENT' });
  const product = rewrite(body => { body.dependencies.find(row => row.origin === 'committed-core-tooling').path = 'checks/private-source/app/feature.mjs'; });
  await assert.rejects(prepareToolingContractWorkspace({ kit, output: path.join(root, 'product'), identity: product }), /explicit script helper/);
  for (const [name, mutate] of [['support-hash', row => { row.sha256 = '0'.repeat(64); }], ['support-mode', row => { row.mode ^= 0o100; }]]) {
    const support = rewrite(body => mutate(body.rawSupport[0]));
    await assert.rejects(prepareToolingContractWorkspace({ kit, output: path.join(root, name), identity: support }), /support differs from its raw identity/);
    await assert.rejects(access(path.join(root, name)), { code: 'ENOENT' });
  }
  const privateHelper = path.join(source, 'scripts/core-contract-helper.mjs');
  await writeFile(privateHelper, 'private helper must remain untouched\n');
  await assert.rejects(prepareToolingContractWorkspace({ kit, output: path.join(root, 'collision'), identity }), /replace private source/);
  assert.equal(await readFile(privateHelper, 'utf8'), 'private helper must remain untouched\n');
});

test('a focused child changing its workspace cannot publish a passing contract receipt', async t => {
  const { root, kit, source } = await helperFixture(t), before = (await hashTree(kit)).digest;
  const options = { kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'run'), toolingDigest: 'c'.repeat(64) };
  await assert.rejects(runToolingContracts(options, { exec: async (_command, _args, execution) => {
    assert.notEqual(execution.cwd, source);
    assert.ok(execution.env.RS3_TEST_SCRATCH_ROOT.startsWith(options.output));
    assert.equal(execution.env.RS3_TEST_SCRATCH_ROOT.startsWith(execution.cwd + path.sep), false);
    await writeFile(path.join(execution.cwd, 'scripts/core-contract-helper.mjs'), '// modified in child\n');
    return { cleanupVerified: true, stdout: '# fail 0\n# skipped 0\n# cancelled 0\n' };
  } }), /workspace changed during execution/);
  assert.equal((await hashTree(kit)).digest, before);
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
});

test('raw focused inputs are rechecked after an otherwise passing immutable workspace run', async t => {
  const { root, kit, source } = await helperFixture(t);
  const options = { kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'run'), toolingDigest: 'd'.repeat(64) };
  await assert.rejects(runToolingContracts(options, { exec: async () => {
    await writeFile(path.join(source, 'tests', toolingContractTests[0]), '// assertion changed while running\n');
    return { cleanupVerified: true, stdout: '# fail 0\n# skipped 0\n# cancelled 0\n' };
  } }), /inputs changed during execution/);
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
});

test('real focused identity tracks core selector registrations and helpers without changing private inputs', async t => {
  const fixture = await helperFixture(t), { kit, source, repo } = fixture;
  const before = await toolingContractIdentity(kit), privateBefore = (await hashTree(source)).digest;
  assert.deepEqual(before.rawCommittedCore.map(row => row.path), [
    'committed-core-tooling/scripts/selector-helper.mjs', 'committed-core-tooling/scripts/test-selection.mjs',
  ]);
  const selector = path.join(repo, 'scripts/test-selection.mjs');
  await writeFile(selector, (await readFile(selector, 'utf8')).replace('first.test.mjs', 'second.test.mjs'));
  await fixture.manifest(fixture.commit());
  const registered = await toolingContractIdentity(kit);
  assert.notEqual(registered.digest, before.digest, 'registration-only core edit invalidates the real focused entrypoint');
  assert.deepEqual(registered.dependencies, before.dependencies, 'private dependency closure is unchanged');
  await writeFile(path.join(repo, 'scripts/selector-helper.mjs'), 'export const guard = false;\n');
  await fixture.manifest(fixture.commit());
  assert.notEqual((await toolingContractIdentity(kit)).digest, registered.digest, 'raw selector helper bytes are included');
  assert.equal((await hashTree(source)).digest, privateBefore);
});

test('raw nonimport support changes invalidate cached focused proof with operator bytes unchanged', async t => {
  const { root, kit, source } = await helperFixture(t);
  const options = { kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'run'), toolingDigest: 'e'.repeat(64) };
  const before = await toolingContractIdentity(kit), operatorBefore = (await hashTree(path.join(kit, 'operator'))).digest;
  await runToolingContracts(options, { exec: async () => ({ cleanupVerified: true, stdout: '# fail 0\n# skipped 0\n# cancelled 0\n' }) });
  for (const name of ['Resource-Admission.ps1', 'companion-check.mjs', 'release-worker.mjs']) {
    const file = path.join(source, 'scripts/private-companion', name), original = await readFile(file);
    await writeFile(file, '// changed raw support only\n');
    const changed = await toolingContractIdentity(kit);
    assert.notEqual(changed.digest, before.digest, name + ' is part of actual focused identity');
    const row = changed.rawSupport.find(row => row.path.endsWith('/' + name));
    assert.equal(row.mode, (await lstat(file)).mode & 0o777);
    assert.equal(row.sha256, createHash('sha256').update(await readFile(file)).digest('hex'));
    await assert.rejects(assertToolingContracts(options), /ENOENT/);
    await writeFile(file, original);
  }
  await writeFile(path.join(source, 'scripts/private-companion/New-Support.ps1'), '# future parser input\n');
  assert.notEqual((await toolingContractIdentity(kit)).digest, before.digest, 'new top-level parser input is tracked');
  await rm(path.join(source, 'scripts/private-companion/Resource-Admission.ps1'));
  await assert.rejects(toolingContractIdentity(kit), /ENOENT/, 'required support cannot silently disappear');
  assert.equal((await hashTree(path.join(kit, 'operator'))).digest, operatorBefore);
});

test('selected kit catalog is read fresh as literal data and drives focused Node arguments', async t => {
  const { root, kit, source } = await helperFixture(t), before = await toolingContractIdentity(kit);
  const catalog = path.join(kit, 'tools/tooling-contract-catalog.mjs'), extra = 'new-selected-contract.test.mjs';
  const literal = names => 'export const additionalToolingContractTests = Object.freeze(' + JSON.stringify(names) + ');\n';
  await writeFile(catalog, literal([extra]));
  await assert.rejects(toolingContractIdentity(kit), /Required tooling contract is absent/);
  await writeFile(path.join(source, 'tests', extra), '// selected kit assertion\n');
  const changed = await toolingContractIdentity(kit);
  assert.notEqual(changed.digest, before.digest);
  assert.equal(changed.files.at(-1).path, 'tests/' + extra);
  assert.notEqual(changed.catalog.sha256, before.catalog.sha256);
  let argumentsSeen;
  await runToolingContracts({ kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'run'), toolingDigest: 'f'.repeat(64) }, {
    exec: async (_command, args) => { argumentsSeen = args; return { cleanupVerified: true, stdout: '# fail 0\n# skipped 0\n# cancelled 0\n' }; },
  });
  assert.ok(argumentsSeen.includes('tests/' + extra), 'loaded consumer executes freshly selected catalog entry');
  for (const invalid of [literal([extra, extra]), literal([mandatoryToolingContractTests[0]]),
    "export const additionalToolingContractTests = Object.freeze([process.env.TEST]);\n",
    literal([extra]) + 'globalThis.catalogWasEvaluated = true;\n',
    "export const additionalToolingContractTests = (() => { globalThis.catalogWasEvaluated = true; return []; })();\n"]) {
    await writeFile(catalog, invalid);
    await assert.rejects(toolingContractIdentity(kit), /catalog/i);
    assert.equal(globalThis.catalogWasEvaluated, undefined, 'selected source is never evaluated');
  }
  await writeFile(catalog, literal([]));
  await writeFile(path.join(kit, 'tools/tooling-certificate.mjs'), 'export const mandatoryToolingContractTests = Object.freeze([]);\n');
  await assert.rejects(toolingContractIdentity(kit), /mandatory tooling contract floor differs/);
});

async function retryFixture(t, manifest) {
  const root = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'tooling-contract-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit'), source = path.join(kit, 'checks/private-source/tests'); await mkdir(source, { recursive: true }); await mkdir(path.join(kit, 'operator'));
  await mkdir(path.join(kit, 'checks/private-source/scripts'));
  await supportFixture(path.join(kit, 'checks/private-source'));
  await catalogFixture(kit);
  for (const name of toolingContractTests) await writeFile(path.join(source, name), '// fixture');
  if (manifest) await writeFile(path.join(kit, 'kit.json'), JSON.stringify(manifest));
  return { root, kit, options: { kit, evidenceDir: path.join(root, 'evidence'), output: path.join(root, 'run'), toolingDigest: '9'.repeat(64) } };
}
const passing = 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\n';
// Shape of node's spec summary for a test that hit its deadline on a busy PC.
const slowFailure = (name, extra = {}) => Object.assign(Error('Owned command failed; owned job cleaned.'), {
  stdout: 'ℹ tests 40\nℹ pass 39\nℹ fail 0\nℹ cancelled 1\nℹ skipped 0\n\n✖ failing tests:\n\n'
    + 'test at ' + path.join('tests', name) + ":12:1\n✖ slow contract (180012ms)\n  'test timed out after 180000ms'\n",
  stderr: '', cleanupVerified: true, timedOut: false, code: 1, forcedDescendants: 0, ...extra,
});

test('failure attribution reads the pinned node spec summary, including timeouts and file crashes', async t => {
  const root = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'tooling-contract-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tests'));
  const files = { 'pass.test.mjs': "import test from 'node:test'; test('passes', () => {});\n",
    'slow.test.mjs': "import test from 'node:test'; test('outer', { timeout: 50 }, async t => { await t.test('inner', () => new Promise(r => setTimeout(r, 400))); });\n",
    'crash.test.mjs': "throw new Error('top-level crash');\n" };
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, 'tests', name), text);
  const selected = Object.keys(files).map(name => 'tests/' + name);
  // Like the sanitized contract environment, drop the outer runner's child protocol.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  let stdout;
  try { stdout = execFileSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...selected], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'); }
  catch (error) { stdout = error.stdout.toString('utf8'); }
  assert.deepEqual(failedContractFiles(stdout, root, selected).sort(), ['tests/crash.test.mjs', 'tests/slow.test.mjs']);
  assert.equal(failedContractFiles(stdout, root, ['tests/pass.test.mjs', 'tests/slow.test.mjs']), null, 'a failure outside the selection refuses');
  assert.equal(failedContractFiles(stdout.replace(/^test at .*$/m, ''), root, selected), null, 'an unattributed failure refuses');
  assert.equal(failedContractFiles(stdout.replace(/ℹ skipped 0/, 'ℹ skipped 1'), root, selected), null, 'a skip is never retried away');
  assert.equal(failedContractFiles(passing, root, selected), null);
});

test('a contract that fails once on a busy PC passes on one isolated retry and is recorded as flaky', async t => {
  const { options } = await retryFixture(t), calls = [], slow = toolingContractTests[3];
  const { record } = await runToolingContracts(options, { exec: async (_command, args, execution) => {
    calls.push({ args, temp: execution.env.TEMP });
    if (calls.length === 1) throw slowFailure(slow);
    return { cleanupVerified: true, stdout: passing };
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['--test', '--test-concurrency=1', '--test-reporter=spec', 'tests/' + slow]);
  assert.notEqual(calls[1].temp, calls[0].temp, 'the retry gets fresh scratch');
  assert.ok(calls[1].temp.startsWith(options.output));
  assert.deepEqual(record.flakyFiles, ['tests/' + slow]);
  assert.deepEqual(record.checks[0].flakyFiles, ['tests/' + slow]);
  assert.deepEqual(record.retryPolicy, { version: 'retry-once-in-fresh-isolation-default-on-v1', enabled: true });
  assert.match(await readFile(path.join(options.output, 'tooling-contracts.log'), 'utf8'), /timed out after 180000ms/);
  assert.equal(await readFile(path.join(options.output, 'tooling-contracts.retry-1.log'), 'utf8'), passing);
  assert.equal((await assertToolingContracts(options)).record.digest, record.digest);
});

test('a contract retry happens once and failed or unattributable runs still refuse', async t => {
  const { options } = await retryFixture(t), slow = toolingContractTests[0];
  let runs = 0;
  await assert.rejects(runToolingContracts(options, { exec: async () => { runs++; throw slowFailure(slow); } }), /failed again in isolation/);
  assert.equal(runs, 2, 'one initial run and one isolated retry');
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
  for (const [name, error] of [['timeout', slowFailure(slow, { timedOut: true })], ['leak', slowFailure(slow, { forcedDescendants: 1 })],
    ['cleanup', slowFailure(slow, { cleanupVerified: false })], ['unattributed', slowFailure(slow, { stdout: 'Owned host crashed\n' })]]) {
    runs = 0;
    await assert.rejects(runToolingContracts({ ...options, output: path.join(path.dirname(options.output), name) }, { exec: async () => { runs++; throw error; } }), /contracts failed; certificate refused/);
    assert.equal(runs, 1, name + ' is never retried');
  }
  await assert.rejects(assertToolingContracts(options), /ENOENT/);
});

test('kit.json can disable the contract retry and the practice switch overrides it', async t => {
  const { root, options } = await retryFixture(t, { retryOnceInIsolation: false }), slow = toolingContractTests[1];
  let runs = 0;
  const exec = async () => { if (++runs === 1) throw slowFailure(slow); return { cleanupVerified: true, stdout: passing }; };
  await assert.rejects(runToolingContracts(options, { exec }), /certificate refused/);
  assert.equal(runs, 1);
  runs = 0;
  const { record } = await runToolingContracts({ ...options, output: path.join(root, 'explicit'), retryOnceInIsolation: true }, { exec });
  assert.equal(runs, 2); assert.deepEqual(record.flakyFiles, ['tests/' + slow]);
});
