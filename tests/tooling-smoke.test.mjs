import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, rm, lstat, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runNativeRunnerSmoke, assertToolingSmokeResult, toolingSmokeChecks, toolingSmokeScope, runToolingSmoke, gallerySupervisorSource, assertScratchGalleryPorts, prepareToolingSmokeSource } from '../scripts/private-companion/tooling-smoke.mjs';
import { sanitizeExecutionEnvironment, hashTree } from '../scripts/private-companion/release-identity.mjs';
import { reopenLivePayloadContext, createLivePayloadContext, reviewLivePayloadOverlays } from '../scripts/private-companion/live-payload-rules.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = 'a'.repeat(64);
test('mixed feature/tooling changes materialize only the exact live payload and declared branch tooling', async t => {
  const scratch = process.env.RS3_TEST_SCRATCH_ROOT ?? path.join(os.tmpdir(), 'rs3-test-scratch');
  assert.ok(path.isAbsolute(scratch ?? ''), 'explicit job scratch required');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'smoke-source-lineage-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(scratch)); await rm(root, { recursive: true, force: true }); });
  const liveSource = path.join(root, 'live-source'), liveCore = path.join(root, 'live-core'), repo = path.join(root, 'core-objects');
  const kit = path.join(root, 'branch-kit'), branch = path.join(kit, 'checks/private-source');
  const put = async (directory, name, text) => { const file = path.join(directory, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };
  for (const directory of [liveSource, liveCore, repo, branch]) await mkdir(directory, { recursive: true });
  await put(liveSource, 'app/feature.mjs', '// immutable live application\n');
  await put(liveSource, 'tests/ordinary.test.mjs', '// immutable live test\n');
  await put(liveSource, 'scripts/obsolete.mjs', '// retired tooling\n');
  await put(liveSource, 'scripts/tool.mjs', '// original tooling\n');
  await put(liveSource, 'tests/test-selection.test.mjs', '// original tooling contract\n');
  await put(liveCore, 'app/server.mjs', '// immutable core; never imported\n');
  await put(liveCore, 'tests/test-selection.test.mjs', '// exact old core tooling contract\n');
  await put(branch, 'app/feature.mjs', '// pending candidate feature\n');
  await put(branch, 'tests/ordinary.test.mjs', '// pending candidate test change\n');
  await put(branch, 'tests/new-feature.test.mjs', '// pending new candidate test\n');
  await put(branch, 'scripts/tool.mjs', '// next tooling\n');
  await put(branch, 'tests/test-selection.test.mjs', '// next tooling contract\n');
  const pinManifest = async () => put(kit, 'kit.json', JSON.stringify({ schemaVersion: 2, sourceTreeDigest: (await hashTree(branch)).digest }));
  await pinManifest();
  const inputs = { kit, repo, liveSource, liveCore, liveRevision: 'c'.repeat(40) };
  const first = await prepareToolingSmokeSource({ ...inputs, source: path.join(root, 'first') });
  assert.equal(await readFile(path.join(first.source, 'app/feature.mjs'), 'utf8'), '// immutable live application\n');
  assert.equal(await readFile(path.join(first.source, 'tests/ordinary.test.mjs'), 'utf8'), '// immutable live test\n');
  assert.equal(await readFile(path.join(first.source, 'scripts/tool.mjs'), 'utf8'), '// next tooling\n');
  assert.equal(await readFile(path.join(first.source, 'tests/test-selection.test.mjs'), 'utf8'), '// next tooling contract\n');
  await assert.rejects(lstat(path.join(first.source, 'scripts/obsolete.mjs')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(first.source, 'tests/new-feature.test.mjs')), { code: 'ENOENT' });
  const firstContext = await reopenLivePayloadContext(first.proof);
  const overlay = reviewLivePayloadOverlays({ livePayload: firstContext, privateFiles: new Set(['tests/test-selection.test.mjs']),
    coreFiles: new Map([['tests/test-selection.test.mjs', await readFile(path.join(liveCore, 'tests/test-selection.test.mjs'))]]) });
  assert.deepEqual(overlay.findings, []);
  assert.equal(overlay.tolerated[0].rule, 'declared-tooling-contract-overlay');
  await assert.rejects(createLivePayloadContext({ ...inputs, source: branch, toolingInputs: first.toolingInputs }), /exact live payload/);
  await put(branch, 'app/feature.mjs', '// another unrelated candidate feature\n'); await pinManifest();
  const second = await prepareToolingSmokeSource({ ...inputs, source: path.join(root, 'second') });
  assert.equal((await hashTree(second.source)).digest, (await hashTree(first.source)).digest, 'candidate feature bytes cannot affect the no-op fixture');
  await put(branch, 'scripts/tool.mjs', '// revised tooling\n'); await pinManifest();
  const third = await prepareToolingSmokeSource({ ...inputs, source: path.join(root, 'third') });
  assert.equal(await readFile(path.join(third.source, 'scripts/tool.mjs'), 'utf8'), '// revised tooling\n');
  assert.equal(await readFile(path.join(third.source, 'app/feature.mjs'), 'utf8'), '// immutable live application\n');
  await put(third.source, 'app/feature.mjs', '// illicit mixed candidate\n');
  await assert.rejects(reopenLivePayloadContext(third.proof), /input changed/);
});

test('gallery observations require distinct bounded application and debugging ports in both modes',()=>{
  const valid=()=>({plain:{applicationPort:8900,cdpPort:8901},framed:{applicationPort:8900,cdpPort:8901}});
  assert.equal(assertScratchGalleryPorts(valid()).plain.cdpPort,8901);
  for(const alter of [g=>{g.plain.cdpPort=0;},g=>{g.framed.cdpPort=g.framed.applicationPort;},g=>{g.plain.applicationPort=9000;},g=>{delete g.framed;}]) {
    const proof=valid();alter(proof);assert.throws(()=>assertScratchGalleryPorts(proof),/bounded scratch ports/);
  }
});
const receipt = () => ({ schema: 'rs3-tooling-smoke-v1', passed: true, cleanupVerified: true, inputDigest: digest, scope: toolingSmokeScope,
  checks: toolingSmokeChecks.map(name => ({ name, passed: true, evidenceDigest: 'b'.repeat(64) })) });

test('capability proof requires every executable subsystem and cleanup', () => {
  assert.equal(assertToolingSmokeResult(receipt(), digest).passed, true);
  for (const alter of [r => { r.checks.pop(); }, r => { r.checks.reverse(); }, r => { r.cleanupVerified = false; },
    r => { r.checks[0].passed = false; }, r => { r.checks[0].evidenceDigest = 'not-a-hash'; }, r => { r.inputDigest = 'c'.repeat(64); }]) {
    const value = receipt(); alter(value); assert.throws(() => assertToolingSmokeResult(value, digest), /incomplete/);
  }
});

test('native bounded fixtures observe failure and real isolated retry, then remove their state', async t => {
  const scratch = process.env.RS3_TEST_SCRATCH_ROOT ?? path.join(os.tmpdir(), 'rs3-test-scratch');
  assert.ok(path.isAbsolute(scratch ?? ''), 'explicit job scratch required');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'tooling-smoke-test-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(scratch)); await rm(root, { recursive: true, force: true }); });
  const output = path.join(root, 'fixtures');
  const observed = await runNativeRunnerSmoke({ output, runner: path.join(source, 'scripts/adaptive-test-runner.mjs'), retry: path.join(source, 'scripts/private-companion/retry-failed-files.mjs') });
  assert.equal(observed.initial.passed, false);
  assert.equal(observed.initial.files.length, 2);
  assert.equal(observed.initial.summary.counts.failed, 1);
  assert.equal(observed.result.passed, true);
  assert.equal(observed.result.summary.counts.failed, 0);
  assert.equal(observed.result.flakyFiles.length, 1);
  assert.equal(observed.result.files.find(f => f.flaky).attempts.length, 2);
  assert.equal(observed.result.files.find(f => !f.flaky).attempts, undefined);
  assert.equal(observed.retried.length, 1);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('native fixtures refuse existing state without replacing it', async t => {
  const scratch = process.env.RS3_TEST_SCRATCH_ROOT ?? path.join(os.tmpdir(), 'rs3-test-scratch');
  assert.ok(path.isAbsolute(scratch ?? ''), 'explicit job scratch required');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'tooling-smoke-existing-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(scratch)); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(runNativeRunnerSmoke({ output: root, runner: path.join(source, 'scripts/adaptive-test-runner.mjs'), retry: path.join(source, 'scripts/private-companion/retry-failed-files.mjs') }), /must be absent/);
  assert.equal((await lstat(root)).isDirectory(), true);
});

test('smoke rejects relative inputs before loading application state', async () => {
  await assert.rejects(runToolingSmoke({ kit: '.', repo: '.', current: '.', output: '.', evidenceDir: '.', toolingDigest: digest }), /absolute/);
});

test('gallery deadline terminates its exact owned child and records verified cleanup on failure', async t => {
  const scratch = process.env.RS3_TEST_SCRATCH_ROOT ?? path.join(os.tmpdir(), 'rs3-test-scratch');
  assert.ok(path.isAbsolute(scratch ?? ''), 'explicit job scratch required');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'gallery-supervisor-test-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(scratch)); await rm(root, { recursive: true, force: true }); });
  const worker = path.join(root, 'worker.mjs'), gallery = path.join(root, 'synthetic-gallery.mjs'), envelope = path.join(root, 'envelope.json');
  const cleanup = path.join(root, 'cleanup.json'), pidFile = path.join(root, 'owned-child.json');
  await writeFile(worker, gallerySupervisorSource, { flag: 'wx' });
  await writeFile(gallery, "import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});await writeFile(new URL('./owned-child.json',import.meta.url),JSON.stringify({pid:child.pid}));await new Promise(()=>{});\n", { flag: 'wx' });
  await writeFile(envelope, JSON.stringify({ gallery, cleanup, stopModule: path.join(source, 'scripts/perf/cdp.mjs'), args: [], timeoutMs: 3000 }), { flag: 'wx' });
  await assert.rejects(promisify(execFile)(process.execPath, [worker, envelope], { cwd: root, env: sanitizeExecutionEnvironment(), windowsHide: true, timeout: 25000 }), error => error.code === 1);
  const proof = JSON.parse(await readFile(cleanup, 'utf8')), { pid } = JSON.parse(await readFile(pidFile, 'utf8'));
  assert.equal(proof.passed, false);
  assert.equal(proof.cleanupVerified, true);
  assert.equal(proof.deadlineExceeded, true);
  assert.equal(proof.ownedChildren, 1);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
