// Disposable contract integration. The fixture runners are synthetic, never product suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashTree } from '../scripts/private-companion/release-identity.mjs';
import { bindingBytes, checkPackTransition } from '../scripts/private-companion/release-pack-check.mjs';
import { prune } from '../scripts/private-companion/release-v2.mjs';
const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
import { stageReleaseKit } from '../scripts/private-companion/stage-release-v2.mjs';
import { pipelineTests, orderedEarly, earlyBudgetMs } from '../scripts/private-companion/release-early.mjs';
import { literalModuleReferences } from '../scripts/private-companion/tooling-module-graph.mjs';
import { fixture, invoke, hash, json, put, git } from './helpers/release-pipeline.mjs';
test('every module copied flat into a PC kit resolves its literal imports inside the kit layout', async () => {
  // stageReleaseKit copies every top-level companion module into kit/tools.
  // Check the complete inventory, rather than this lifecycle fixture's subset.
  const copied = new Set((await readdir(scripts)).filter(name => name.endsWith('.mjs')
    || ['approved-workflows.json', 'approved-neutral-workflow.json'].includes(name)));
  const check = (owner, source) => {
    for (const ref of literalModuleReferences(source).references) {
      if (ref.startsWith('node:')) continue;
      const target = path.posix.normalize(path.posix.join('tools', ref));
      assert(ref.startsWith('./') && target.startsWith('tools/') && copied.has(target.slice(6)), `${owner}: ${ref} escapes flat PC kit layout`);
    }
  };
  for (const name of copied) if (name.endsWith('.mjs')) check(name, await readFile(path.join(scripts, name), 'utf8'));
  for (const syntax of ["import {isMain} from '../release/vps/entrypoint.mjs';", "export * from '../outside.mjs';", "await import('../outside.mjs');"])
    assert.throws(() => check('synthetic.mjs', syntax), /escapes flat PC kit layout/);
  for (const relative of ['pc/ci-inputs.mjs', 'pc/quick-build.mjs', 'verify-ci-evidence.mjs']) {
    const source = await readFile(new URL('../scripts/release/' + relative, import.meta.url), 'utf8');
    assert(!literalModuleReferences(source).references.some(ref => /(?:^|\/)vps\//.test(ref)), relative);
  }
});

test('PC quick-build and pack-check execute their CLI through a symlink', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pc-main-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('../', import.meta.url)), alias = path.join(root, 'checkout');
  await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const [entry, diagnostic] of [
    ['scripts/release/pc/quick-build.mjs', 'Quick build refused: Use build, verify or prepare-swap.'],
    ['scripts/private-companion/release-pack-check.mjs', 'Pack compatibility refused; storage unchanged. Cause: Pack check command refused.'],
  ]) {
    const result = await invoke(path.join(alias, entry), [], { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' });
    assert.equal(result.code, 1, entry + ' silently exited without its action');
    assert.equal(result.output.trim(), diagnostic, entry);
  }
});

test('PC flat-kit helpers import safely when eval argv contains a missing path', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pc-main-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const relative of ['../scripts/release/pc/quick-build.mjs', '../scripts/private-companion/release-pack-check.mjs']) {
    const source = 'await import(' + JSON.stringify(new URL(relative, import.meta.url).href) + ');';
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', source, path.join(root, 'missing-argument')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } }), '');
  }
});

test('PC helpers exclude eval and print clusters even with their own entrypoint path in argv', () => {
  for (const relative of ['../scripts/release/pc/quick-build.mjs', '../scripts/private-companion/release-pack-check.mjs',
    '../scripts/release/vps/entrypoint.mjs']) {
    const url = new URL(relative, import.meta.url);
    const source = 'void import(' + JSON.stringify(url.href) + ')' + (relative.endsWith('/entrypoint.mjs')
      ? '.then(({isMain}) => { if (isMain(' + JSON.stringify(url.href) + ')) throw Error("Eval was treated as CLI"); })' : '');
    for (const flag of ['-e', '-p', '-pe', '-ep', '-xep', '--eval', '--print', '--eval=', '--print=']) {
      // Cluster/equals parsing varies by Node version. Inject those guard
      // inputs inside a child; -pe and the ordinary flags remain real CLI calls.
      const simulated = ['-ep', '-xep'].includes(flag) || flag.endsWith('=');
      const args = simulated ? ['-e', 'process.execArgv.splice(0, process.execArgv.length, ' + JSON.stringify(flag + (flag.endsWith('=') ? 'synthetic' : '')) + ');' + source]
        : [flag, source];
      const output = execFileSync(process.execPath, [...args, fileURLToPath(url)], { encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
      assert.equal(output, !simulated && /p/.test(flag) ? 'undefined\n' : '', relative + ': ' + flag);
    }
  }
});

test('early checks run in order, collect every failure, and stop starting checks once the budget is spent', async () => {
  assert.equal(earlyBudgetMs, 30 * 60000);
  let clock = 0; const ran = [], step = (name, seconds, error) => async remaining => { ran.push([name, remaining]); clock += seconds * 1000; if (error) throw Error(error); };
  const result = await orderedEarly({ gallery: step('gallery', 296), startup: step('startup', 30), pipeline: step('pipeline', 60), previous: step('previous', 10), now: () => clock });
  assert.equal(result.passed, true); assert.deepEqual(ran.map(([name]) => name), ['gallery', 'startup', 'pipeline', 'previous']);
  assert.equal(ran[1][1], earlyBudgetMs - 296000, 'each check gets only what is left');
  clock = 0; ran.length = 0;
  const refused = await orderedEarly({ budgetMs: 300000, gallery: step('gallery', 296), startup: step('startup', 30, 'slow'), pipeline: step('pipeline', 1), previous: step('previous', 1), now: () => clock }).then(() => null, error => error);
  assert.match(refused.message, /^Early release checks failed: copied-synthetic-startup, pipeline-integration, previous-failures$/);
  assert.deepEqual(refused.earlyResult.checks.map(check => check.reason ?? 'passed'), ['passed', 'slow', 'early-budget-exhausted', 'early-budget-exhausted']);
  assert.deepEqual(ran.map(([name]) => name), ['gallery', 'startup'], 'no check starts after the budget is spent');
});

test('staging accepts an isolated pack build and hashes every copied payload into kit identity', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'stage-packs-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'), accepted=path.join(root,'accepted'), packs=path.join(root,'rebuilt-packs');
  await put(path.join(source,'scripts/private-companion/release-v2.mjs'),'// synthetic tooling');
  await put(path.join(source,'scripts/private-companion/requests/request.json'),{});
  await put(path.join(accepted,'packs/selection.json'),{version:'old'});
  await put(path.join(accepted,'release-gate/corpus/input.txt'),'synthetic corpus');
  await put(path.join(accepted,'tools/gallery-browser-check.mjs'),'// synthetic checker');
  await put(path.join(packs,'selection.json'),{version:'new'});
  await put(path.join(packs,'data/payload.json'),{correction:true});
  const wrapper=path.join(root,'lock.ps1');await put(wrapper,'# synthetic wrapper, never executed');
  const options={source,accepted,packs,heavyLock:wrapper,lightLock:wrapper,concurrency:1};
  const output=path.join(root,'kit');await stageReleaseKit({...options,output});
  const kit=await json(path.join(output,'kit.json'));
  assert.deepEqual(kit.selection,{version:'new'});
  assert.equal(kit.packsDigest,(await hashTree(packs)).digest);
  assert.equal(kit.packsDigest,(await hashTree(path.join(output,'packs'))).digest);
  assert.equal(kit.sourceTreeDigest,(await hashTree(source)).digest);
  await put(path.join(packs,'unselected-extra.json'),{alsoHashed:true});
  const second=path.join(root,'second-kit');await stageReleaseKit({...options,output:second});
  assert.notEqual((await json(path.join(second,'kit.json'))).packsDigest,kit.packsDigest);
  await assert.rejects(stageReleaseKit({...options,output}),/absent/);
  await assert.rejects(stageReleaseKit({...options,output:path.join(packs,'kit')}),/overlap/);
  const legacy=path.join(root,'legacy-kit');await stageReleaseKit({...options,packs:undefined,output:legacy});
  assert.deepEqual((await json(path.join(legacy,'kit.json'))).selection,{version:'old'});
});

const windows = { skip: process.platform !== 'win32', timeout: 240000 };
async function accepted(f) {
  const manifest = await json(path.join(f.release, 'release.json'));
  await put(path.join(f.release, 'release-gate/accepted.json'), { schemaVersion: 2, inputDigest: manifest.identity.digest, completedAt: new Date().toISOString() });
  return manifest;
}
async function identity(f, extra = [], env) {
  return invoke(f.cli, ['assert-identity', '--kit', f.kit, '--release', f.release, ...extra], env);
}
async function unchanged(files, action) {
  const before = await Promise.all(files.map(file => readFile(file)));
  const result = await action();
  for (const [i, file] of files.entries()) assert.deepEqual(await readFile(file), before[i], file);
  return result;
}

test('committed export and closed PowerShell owners earn exact reusable gates; mutations refuse', windows, async t => {
  const f = await fixture(t);
  await f.prepare();
  const receipt = await json(path.join(f.release, 'companion.json'));
  assert.equal(receipt.packsDir, path.join(f.release, 'packs'));
  assert.equal((await json(path.join(f.release, 'config.json'))).packsDir, receipt.packsDir);
  assert.equal((await hashTree(receipt.packsDir)).digest, (await hashTree(path.join(f.kit, 'packs'))).digest);
  assert.match(await readFile(path.join(f.release, 'core/app/server.mjs'), 'utf8'), /committed core/);
  assert(!(await readdir(path.join(f.release, 'core'))).includes('untracked-private.txt'));
  await f.gates();
  const first = await json(path.join(f.release, 'release-gate/gates.json'));
  assert.equal(first.passed, true); assert.equal(first.flakeRetryEnabled, false);
  assert.equal(first.startup.record.cleanupVerified, true);
  assert.equal(f.control.observations.length, 3);
  const owners = f.control.observations.map(row => row.owner);
  assert.deepEqual(owners[1], owners[2], 'both full suites inherit one live PowerShell owner');
  assert.notEqual(owners[0].token, owners[1].token, 'early owner closes before the full owner starts');
  assert(!(await readdir(path.join(f.kit, '.local'))).includes('fixture-owner'));
  const observations = f.control.observations.length;
  await f.gates();
  assert.equal(f.control.observations.length, observations, 'exact evidence reuse starts no producer');
  const reused = await json(path.join(f.release, 'release-gate/gates.json'));
  for (const lane of ['public-full', 'private-full']) {
    const row = reused.timings.find(row => row.stage === lane);
    assert.equal(row.fresh, 0); assert.equal(row.reused, pipelineTests.length + 1);
  }
  const inspection = await f.api.inspectFullLaneReuse({ kit: f.kit, release: f.release, retryOnceInIsolation: false });
  for (const lane of ['public-full', 'private-full']) { assert.equal(inspection.lanes[lane].accepted, true); assert.equal(inspection.lanes[lane].fresh, 0); }
  await accepted(f);
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: process.env[pathKey] + path.delimiter + f.root };
  for (const args of [[], ['--rollback']]) {
    const result = await identity(f, args, env); assert.equal(result.code, 0, JSON.stringify(result));
  }
  await rm(f.previous);
  assert.equal((await identity(f, ['--rollback'])).code, 0);
  assert.notEqual((await identity(f)).code, 0);
  await put(path.join(f.release, 'core/app/server.mjs'), 'changed after gates');
  assert.notEqual((await identity(f, ['--rollback'])).code, 0);
  await assert.rejects(f.gates(), /changed/i);
});

test('a failed build closes its child, retains the cause, and never publishes a release', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  await put(path.join(f.kit, 'tools/companion-check.mjs'), "console.error('synthetic build failure');process.exitCode=1;");
  const result = await invoke(f.cli, ['prepare', '--kit', f.kit, '--repo', f.repo, '--ref', f.revision, '--base', f.revision, '--previous-config', f.previous, '--input', f.input]);
  assert.equal(result.code, 1, JSON.stringify(result)); assert.equal(result.signal, null); assert.equal(result.error, undefined);
  assert.match(result.output, /Release child exited with code 1/);
  const failure = await json(path.join(f.release, '.local/prepare-failure.json'));
  assert.match(failure.cause.message, /Release child exited with code 1/);
  assert.match(await readFile(path.join(f.release, '.local/prepare.log'), 'utf8'), /synthetic build failure/);
  assert(!(await readdir(f.release)).includes('release.json'));
  assert(!(await readdir(path.join(f.kit, '.local'))).includes('release.lock'));
});

test('freeze seals current and retained startup evidence after both acknowledged dry runs', { ...windows, timeout: 180000 }, async t => {
  const f = await fixture(t);
  await f.prepare(); await f.gates(); await accepted(f);
  const current = path.join(f.root, 'current.json'); await cp(path.join(f.release, 'pointer.json'), current);
  const previousGates = path.join(f.release, 'release-gate/gates.json');
  await put(path.join(f.repo, 'app/server.mjs'), git(f.repo, 'show', f.revision + ':app/server.mjs') + '\n// second committed core\n');
  git(f.repo, 'add', 'app/server.mjs'); git(f.repo, 'commit', '-m', 'Second synthetic core');
  await put(f.input, { releaseId: 'next', changelog: { date: '2026-01-03', title: 'Second', items: ['Second item'] }, roadmap: { id: 'A1', note: 'Second note' } });
  await unchanged([current, previousGates, path.join(f.dataDir, 'state.json')], async () => {
    const next = await f.prepare({ ref: git(f.repo, 'rev-parse', 'HEAD'), current });
    assert.equal((await json(path.join(next, 'release.json'))).lane, 'full');
    await f.gates(next, { current });
    const frozen = await f.api.freezeCandidate({ kit: f.kit, release: next, current });
    assert.equal(frozen.seal.prepared, false); assert.equal(frozen.seal.rollback.release, f.release);
    assert.deepEqual((await readFile(path.join(f.kit, '.local/dry-runs.txt'), 'utf8')).trim().split(/\r?\n/), ['False', 'True']);
    const { readFrozenSeal } = await import(pathToFileURL(path.join(f.kit, 'tools/frozen-release.mjs')));
    await readFrozenSeal({ filename: frozen.filename, kit: f.kit, release: next, current, identityDigest: frozen.seal.identityDigest, verifyBytes: true });
    await put(path.join(next, 'core/app/server.mjs'), 'changed after freeze');
    await assert.rejects(readFrozenSeal({ filename: frozen.filename, kit: f.kit, release: next, current, identityDigest: frozen.seal.identityDigest, verifyBytes: true }), /bytes changed/);
  });
});

test('bounded text assembly copies exact private text without packs or scratch', { timeout: 120000 }, async t => {
  const f = await fixture(t), checker = path.join(f.kit, 'tools/companion-check.mjs');
  await cp(path.join(scripts, 'companion-check.mjs'), checker);
  await cp(path.join(scripts, 'core-overlay-guard.mjs'), path.join(f.kit, 'tools/core-overlay-guard.mjs'));
  const inventory = await hashTree(path.join(f.kit, 'checks/private-source'));
  const receipt = path.join(f.kit, 'releases/text-receipt.json');
  await put(receipt, { schemaVersion: 1, coreRoot: f.repo, privateFiles: inventory.files.map(({ path, sha256 }) => ({ path, sha256 })), packs: await json(path.join(f.kit, 'packs/selection.json')) });
  const output = path.join(f.kit, '.local/text-assembly');
  const result = await invoke(checker, ['--core', f.repo, '--receipt', receipt, '--lane', 'prepare-text', '--output', output]);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.deepEqual(await readFile(path.join(output, 'scripts/secret-scan/scan.mjs')), await readFile(path.join(f.kit, 'checks/private-source/scripts/secret-scan/scan.mjs')));
  for (const name of ['packs', '.local']) assert(!(await readdir(output)).includes(name));
});

test('changed-pack new kit earns fresh pack keys while retaining the current save, frozen packs and exact evidence', { ...windows, timeout: 360000 }, async t => {
  const old = await fixture(t), next = await fixture(t, { version: '1.0.1', digit: '2' });
  // Shared wrappers are immutable inputs, and their later policy change must
  // refuse forward reuse without invalidating retained rollback evidence.
  const shared = path.join(old.root, 'shared'), locks = {};
  for (const lane of ['heavy', 'light']) {
    const file = path.join(shared, lane + '.ps1'); await mkdir(shared, { recursive: true });
    await cp(path.join(old.kit, 'operator/with-' + lane + '.ps1'), file);
    locks[lane] = { path: file, sha256: hash(await readFile(file)) };
  }
  await put(path.join(old.kit, 'kit.json'), { schemaVersion: 2, locks, concurrency: 1, browser: { path: old.browser } });
  await old.prepare(); await old.gates(); await accepted(old);
  await writeFile(locks.heavy.path, '\n# changed shared policy\n', { flag: 'a' });
  await assert.rejects(old.gates(), /wrapper changed/i);
  let retained = await invoke(next.cli, ['assert-identity', '--kit', next.kit, '--release', old.release, '--rollback']);
  assert.equal(retained.code, 0, JSON.stringify(retained));
  const prior = await json(path.join(old.release, 'release-gate/gates.json'));
  const receiptFile = prior.suites.private.filename, receiptBytes = await readFile(receiptFile);
  for (const change of [value => ({ ...value, inputDigest: 'f'.repeat(64) }), value => ({ ...value, startedAt: new Date(Date.parse(value.startedAt) - 1000).toISOString() })]) {
    await put(receiptFile, change(JSON.parse(receiptBytes)));
    try { retained = await invoke(next.cli, ['assert-identity', '--release', old.release, '--rollback']); assert.notEqual(retained.code, 0); }
    finally { await writeFile(receiptFile, receiptBytes); }
  }
  const current = path.join(old.root, 'current.json'); await cp(path.join(old.release, 'pointer.json'), current);
  const request = await json(next.input);
  await put(next.input, { ...request, releaseId: 'upgrade',
    changelog: { date: '2026-01-03', title: 'Upgrade packs', items: ['New pack selection'] },
    roadmap: { id: 'A1', note: 'Pack upgrade checked' },
    packTransition: { old: old.descriptor, new: next.descriptor } });
  const oldPacks = (await hashTree(path.join(old.release, 'packs'))).digest;
  await unchanged([current, receiptFile, path.join(old.dataDir, 'state.json'), old.dataDir + '.dataset.json'], async () => {
    const release = await next.prepare({ repo: old.repo, ref: old.revision, current });
    const manifest = await json(path.join(release, 'release.json')), transition = await json(path.join(release, 'pack-transition.json'));
    assert.equal(manifest.packUpgrade, true); assert.equal(manifest.lane, 'full'); assert.equal(manifest.previousRelease, old.release);
    assert.equal(transition.compatibility.bothDirections, true); assert.equal(transition.compatibility.forwardAfterRollback, true);
    assert.equal(transition.compatibility.probes.length, 4); assert.equal(transition.compatibility.tasksServed, true);
    assert.equal((await json(path.join(release, 'config.json'))).packsDir, path.join(release, 'packs'));
    await next.gates(release, { current });
    const gates = await json(path.join(release, 'release-gate/gates.json'));
    assert.equal(gates.suites.public.record.key, prior.suites.public.record.key);
    assert.notEqual(gates.suites.private.record.key, prior.suites.private.record.key);
    assert.notEqual(gates.gallery.record.key, prior.gallery.record.key);
    for (const lane of ['public', 'private']) assert.notEqual(gates.suites[lane].reused, true);
    assert.equal(gates.startup.record.cleanupVerified, true);
    assert.equal((await hashTree(path.join(old.release, 'packs'))).digest, oldPacks);
  });
});

test('incomplete acknowledged file stage cannot publish gates or release the owner early', windows, async t => {
  const f = await fixture(t); await f.prepare();
  const held = f.control.hold();
  const gating = f.gates();
  const outcome = gating.then(() => null, error => error);
  const stage = await held;
  try {
    assert(stage.files.length > 1);
    assert.equal((await json(path.join(f.release, 'release-gate/latest-attempt.json'))).pending, true);
    assert(!(await readdir(path.join(f.release, 'release-gate'))).includes('gates.json'));
    assert.equal((await json(path.join(stage.owner.path, 'owner.json'))).token, stage.owner.token);
    f.control.complete(stage.files.slice(1));
  } catch (error) { f.control.complete(stage.files); await outcome; throw error; }
  const error = await outcome;
  assert(error, 'a successful process exit cannot acknowledge an incomplete file set');
  assert.equal((await json(path.join(f.release, 'release-gate/latest-attempt.json'))).passed, false);
  assert(!(await readdir(path.join(f.release, 'release-gate'))).includes('gates.json'));
  assert(!(await readdir(path.join(f.kit, '.local'))).includes('fixture-owner'));
});

test('native compatibility atomically owns port zero and closes before returning its save witness', async t => {
  const f = await fixture(t), report = path.join(f.root, 'probe.json');
  await put(path.join(f.repo, 'app/server.mjs'), git(f.repo, 'show', f.revision + ':app/server.mjs'));
  const before = await readFile(path.join(f.dataDir, 'state.json'));
  const result = await invoke(path.join(scripts, 'release-pack-check.mjs'), ['probe', f.repo, f.dataDir, report]);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.signal, null); assert.equal(result.error, undefined);
  assert.equal((await json(report)).tasksServed, true);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), before);
});

test('failed compatibility retains the original child error, exit, signal and stderr after close', async t => {
  const old = await fixture(t), next = await fixture(t, { version: '1.0.1', digit: '2' });
  const pin = async file => ({ path: file, sha256: hash(await readFile(file)) });
  for (const f of [old, next]) {
    const profile = path.join(f.root, 'profile.json');
    await put(profile, { datasetId: f.descriptor.datasetId, datasetDigest: f.descriptor.digest, ruleContractHash: 'a'.repeat(64) });
    await put(f.previous, { ...await json(f.previous), dataDir: old.dataDir, profile: await pin(profile) });
  }
  await put(path.join(old.repo, 'app/server.mjs'), "export const createServer=async()=>{throw Error('synthetic original startup failure');};");
  const transition = { schemaVersion: 1, old: old.descriptor, new: next.descriptor, oldConfig: await pin(old.previous), newConfig: await pin(next.previous), oldBindingBase64: bindingBytes(old.descriptor).toString('base64'), newBindingBase64: bindingBytes(next.descriptor).toString('base64') };
  const error = await checkPackTransition({ fromConfig: old.previous, toConfig: next.previous, transition }).then(() => null, error => error);
  assert.equal(error.childResult.exitCode, 1); assert.equal(error.childResult.signal, null);
  assert.equal(error.childResult.error, null); assert.equal(error.childResult.timedOut, false);
  assert.match(error.childResult.stderrTail, /synthetic original startup failure/);
  await put(old.previous, { ...await json(old.previous), nodePath: path.join(old.root, 'missing-node.exe') });
  transition.oldConfig = await pin(old.previous);
  const missing = await checkPackTransition({ fromConfig: old.previous, toConfig: next.previous, transition }).then(() => null, error => error);
  assert.equal(missing.childResult.error.code, 'ENOENT'); assert.equal(missing.childResult.signal, null);
});

test('corrupt evidence is retained byte for byte before a fresh observation is published', async t => {
  const f = await fixture(t), directory = path.join(f.root, 'evidence');
  const { gateContract, publishEvidence, lookupEvidence } = await import('../scripts/private-companion/release-evidence.mjs');
  const contract = gateContract('gallery', { synthetic: true }, { digest: 'a'.repeat(64) });
  const first = await publishEvidence(directory, contract, { startedAt: new Date().toISOString() });
  await put(first.filename, { ...first.record, cleanupVerified: false });
  const corrupt = await readFile(first.filename), expanded = await readFile(first.filename + '.identity.json');
  assert.equal(await lookupEvidence(directory, contract), null);
  const second = await publishEvidence(directory, contract, { startedAt: new Date().toISOString() });
  assert.equal(second.reused, false); assert.equal(second.record.cleanupVerified, true);
  const names = await readdir(directory);
  const rejected = names.filter(name => name.startsWith(path.basename(first.filename) + '.rejected-'));
  assert.equal(rejected.length, 1); assert.deepEqual(await readFile(path.join(directory, rejected[0])), corrupt);
  const identities = names.filter(name => name.startsWith(path.basename(first.filename) + '.identity.json.rejected-'));
  assert.equal(identities.length, 1); assert.deepEqual(await readFile(path.join(directory, identities[0])), expanded);
});

test('pack-only identity changes invalidate private and gallery keys while preserving the public core key', windows, async t => {
  const f = await fixture(t); await f.prepare();
  const manifest = await json(path.join(f.release, 'release.json'));
  const before = await f.api.stableSpecs(f.kit, f.release, manifest);
  const changed = structuredClone(manifest);
  for (const component of changed.identity.components) if (['packs', 'releasePacks'].includes(component.name)) component.digest = 'f'.repeat(64);
  const after = await f.api.stableSpecs(f.kit, f.release, changed);
  assert.equal(before.public.key, after.public.key);
  for (const lane of ['private', 'gallery', 'startup', 'install']) assert.notEqual(before[lane].key, after[lane].key, lane);
});

test('pruning retains both endpoints and evidence of an unaccepted upgrade after later code releases', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pack-retention-v2-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const kit=path.join(root,'kit'),releases=path.join(kit,'releases');
  const old=path.join(releases,'old'),failed=path.join(releases,'failed-upgrade');
  for(const [i,name] of ['old','obsolete','previous','current'].entries()){
    const directory=path.join(releases,name);await put(path.join(directory,'config.json'),{name});
    await put(path.join(directory,'release-gate/accepted.json'),{completedAt:`2026-01-0${i+1}`});
  }
  await put(path.join(failed,'config.json'),{name:'unaccepted'});
  const transitionFile=path.join(failed,'pack-transition.json');
  const oldPath=path.join(old,'config.json');
  const retainedPath=process.platform==='win32'?oldPath.replaceAll('\\','/').toUpperCase():oldPath;
  await put(transitionFile,{oldConfig:{path:retainedPath},newConfig:{path:path.join(failed,'config.json')}});
  const evidence=await readFile(transitionFile);
  const current=path.join(root,'current.json'),config=path.join(releases,'current/config.json');
  await put(current,{schemaVersion:2,releaseId:'current',config:{path:config,sha256:hash(await readFile(config))}});
  await put(path.join(releases,'current/release.json'),{previousRelease:path.join(releases,'previous')});
  await prune(kit,current);
  assert.deepEqual(await readFile(transitionFile),evidence);
  assert.equal((await json(path.join(old,'config.json'))).name,'old');
  assert.equal((await json(path.join(failed,'config.json'))).name,'unaccepted');
  assert.ok(!(await readdir(releases)).includes('obsolete'));
});


test('release lanes pin a modest heap after environment sanitization', async () => {
  const {laneEnvironment} = await import('../scripts/private-companion/release-evidence.mjs');
  const env = await laneEnvironment(path.dirname(scripts),process.execPath,{NODE_OPTIONS:'--inspect'});
  assert.equal(env.NODE_OPTIONS,'--max-old-space-size=1536');
  if (process.platform === 'win32') {
    const pwsh = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell/7');
    assert.equal(env.PATH.split(path.delimiter).includes(pwsh), existsSync(path.join(pwsh, 'pwsh.exe')), 'pwsh resolves exactly when PowerShell 7 is installed');
    assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0], ['1', 'core.longpaths', 'true'], 'deep lane temp paths stay usable by git');
  }
});
