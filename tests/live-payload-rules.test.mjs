import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, writeFile, readFile, cp, rm, access } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hashTree, digestValue } from '../scripts/private-companion/release-identity.mjs';
import { createLivePayloadContext, reopenLivePayloadContext, liveRuleHandling, defineLivePayloadRule,
  reviewLivePayloadOverlays, assertLivePayloadTarget } from '../scripts/private-companion/live-payload-rules.mjs';
import { practiceInventoryCapability, inventoryMissing } from '../scripts/private-companion/practice-inventory.mjs';

const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const scratch = path.resolve(process.env.RS3_DRIFT_TEST_ROOT ?? fileURLToPath(new URL('../.local/live-payload-tests/', import.meta.url)));
const revision = '1'.repeat(40), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put = async (root, name, value) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
async function fixture(t, count = 1) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'rules-'));
  t.after(async () => { assert.equal(path.dirname(root), scratch); await rm(root, { recursive: true, force: true }); });
  const liveSource = path.join(root, 'live-source'), liveCore = path.join(root, 'live-core');
  const source = path.join(root, 'practice-source'), kit = path.join(root, 'tooling-kit');
  const tooling = path.join(kit, 'checks/private-source');
  for (const directory of [liveSource, liveCore, tooling]) await mkdir(directory, { recursive: true });
  const coreFiles = new Map(), privateFiles = new Set();
  for (let index = 0; index < count; index++) {
    const name = `tests/old-${String(index).padStart(3, '0')}.test.mjs`;
    const core = Buffer.from(`// old core ${index}\n`), privateBytes = index < 57 ? core : Buffer.from(`// old private ${index}\n`);
    await put(liveSource, name, privateBytes); await put(liveCore, name, core);
    coreFiles.set(name, core); privateFiles.add(name);
  }
  await put(liveSource, 'scripts/test-selection.mjs', '// original selector\n');
  await put(tooling, 'scripts/test-selection.mjs', '// new selector with explicit tooling registrations\n');
  await put(tooling, 'tests/new-private.test.mjs', '// new tooling private scenario\n');
  await cp(liveSource, source, { recursive: true });
  await cp(path.join(tooling, 'scripts'), path.join(source, 'scripts'), { recursive: true });
  const manifest = { schemaVersion: 2, sourceTreeDigest: (await hashTree(tooling)).digest };
  await put(kit, 'kit.json', JSON.stringify(manifest));
  const toolingInputs = { schema: 'rs3-practice-inputs-v1', kit, coreRepo: path.join(root, 'git-core'), kitSha256: sha(await readFile(path.join(kit, 'kit.json'))) };
  const options = { liveSource, liveCore, liveRevision: revision, source, toolingInputs, liveIdentity: { digest: '2'.repeat(64) } };
  const proof = await createLivePayloadContext(options), livePayload = await reopenLivePayloadContext(proof);
  return { root, liveSource, liveCore, source, kit, tooling, toolingInputs, options, proof, livePayload, coreFiles, privateFiles };
}

test('r19 bounded replay: 236 historical overlays retain 57 identical and 179 different copies without a generated manifest', async t => {
  // Counts and capability boundary reproduce NOTE-r19-practice.md. Synthetic
  // bytes exercise exact matching; this does not claim a replay of old suites.
  const f = await fixture(t, 236);
  const inputs = { coreFiles: f.coreFiles, privateFiles: f.privateFiles };
  assert.equal(reviewLivePayloadOverlays(inputs).findings.length, 236);
  const review = reviewLivePayloadOverlays({ ...inputs, livePayload: f.livePayload });
  assert.deepEqual(review.findings, []); assert.equal(review.tolerated.length, 236);
  assert.equal(review.tolerated.filter(row => row.liveCoreSha256 === row.privateSha256).length, 57);
  assert.ok(review.tolerated.every(row => row.reason && row.identity === f.proof.digest && row.revision === revision));
  await assert.rejects(access(path.join(f.source, 'tests/core-overlays.json')), { code: 'ENOENT' });
  assert.equal((await hashTree(f.source)).digest, f.proof.source.digest);
  const candidateCore = new Map(f.coreFiles); candidateCore.set('tests/old-000.test.mjs', Buffer.from('// changed candidate\n'));
  assert.equal(reviewLivePayloadOverlays({ ...inputs, coreFiles: candidateCore, livePayload: f.livePayload }).findings.length, 1);
});

test('r18 bounded replay: private-live-swap and release-request-v2 registrations are absent from the original live inventories', async t => {
  const f = await fixture(t);
  // Verified read-only against staging/r18/practice-practfix3/source and its
  // original relpipe-v2-staged-r18-practfix2 kit, core 8ae68b1. Both missing
  // registrations are private tooling tests; no historical test code is run.
  const names = ['private-live-swap.test.mjs', 'release-request-v2.test.mjs'];
  for (const name of names) await put(f.tooling, 'tests/' + name, '// bounded tooling scenario\n');
  await put(f.kit, 'kit.json', JSON.stringify({ schemaVersion: 2, sourceTreeDigest: (await hashTree(f.tooling)).digest }));
  const inputs = { ...f.toolingInputs, kitSha256: sha(await readFile(path.join(f.kit, 'kit.json'))) };
  const proof = await createLivePayloadContext({ ...f.options, toolingInputs: inputs });
  const capability = await practiceInventoryCapability({ ...inputs, livePayload: proof });
  const result = inventoryMissing(['old-000.test.mjs', ...names], ['old-000.test.mjs'], capability);
  assert.deepEqual(result.missing, []); assert.deepEqual(result.tolerated.map(row => row.name), names);
  assert.ok(result.tolerated.every(row => row.side === 'private-source' && row.sha256 && row.reason && row.identity === proof.digest));
  assert.equal(inventoryMissing(names, [], await practiceInventoryCapability(inputs)).missing.length, 2);
});

test('registration provenance also reopens exact pinned Git core tests and refuses erased old live tests', async t => {
  const f = await fixture(t);
  const git = (...args) => execFileSync('git', ['-C', f.toolingInputs.coreRepo, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  await mkdir(f.toolingInputs.coreRepo); git('init', '--quiet');
  await put(f.toolingInputs.coreRepo, 'tests/new-core.test.mjs', '// tooling pinned core scenario\n');
  git('add', 'tests'); git('-c', 'user.name=Fixture', '-c', 'user.email=fenerax@users.noreply.github.com', 'commit', '-qm', 'Synthetic tooling core');
  await put(f.tooling, 'tests/old-000.test.mjs', await readFile(path.join(f.liveSource, 'tests/old-000.test.mjs')));
  const manifest = { schemaVersion: 2, sourceTreeDigest: (await hashTree(f.tooling)).digest, coreRevision: git('rev-parse', 'HEAD') };
  await put(f.kit, 'kit.json', JSON.stringify(manifest));
  const toolingInputs = { ...f.toolingInputs, kitSha256: sha(await readFile(path.join(f.kit, 'kit.json'))) };
  const liveProof = await createLivePayloadContext({ ...f.options, toolingInputs });
  const capability = await practiceInventoryCapability({ ...toolingInputs, livePayload: liveProof });
  const registered = ['old-000.test.mjs', 'new-private.test.mjs', 'new-core.test.mjs', 'unknown.test.mjs'];
  const result = inventoryMissing(registered, ['old-000.test.mjs'], capability);
  assert.deepEqual(result.missing, ['unknown.test.mjs']); assert.equal(result.tolerated.length, 2);
  assert.ok(result.tolerated.every(row => row.rule === 'registered-test-inventory' && row.reason && row.identity === liveProof.digest));
  const coreEvidence = result.tolerated.find(row => row.side === 'core');
  assert.match(coreEvidence.blobOid, /^[a-f0-9]{40}$/);
  assert.equal(coreEvidence.revision, manifest.coreRevision); assert.equal(coreEvidence.liveRevision, revision);
  // A bare tooling kit proves provenance but cannot assert historical absence.
  assert.equal(inventoryMissing(registered, ['old-000.test.mjs'], await practiceInventoryCapability(toolingInputs)).missing.length, 3);
  const erased = inventoryMissing(['old-000.test.mjs'], [], capability);
  assert.deepEqual(erased.missing, ['old-000.test.mjs']);
  await put(f.tooling, 'tests/new-private.test.mjs', '// changed tooling input\n');
  await assert.rejects(practiceInventoryCapability({ ...toolingInputs, livePayload: liveProof }), /private input changed/);
});

test('new declarations default strict, unknown rules and forged capabilities fail, environment flags cannot weaken candidates', async t => {
  const f = await fixture(t);
  assert.equal(defineLivePayloadRule({ id: 'future-rule', capability: 'future-capability' }).priorLive.treatment, 'must-satisfy');
  assert.throws(() => defineLivePayloadRule({ id: 'bad', capability: 'bad', priorLive: { treatment: 'grandfather' } }), /declaration refused/);
  assert.throws(() => liveRuleHandling(f.livePayload, 'unknown'), /Unknown live payload rule/);
  assert.throws(() => liveRuleHandling({}, 'core-test-overlay-review'), /capability refused/);
  const previous = process.env.RS3_PRACTICE_ALLOW_OLD_LIVE;
  process.env.RS3_PRACTICE_ALLOW_OLD_LIVE = '1';
  try { assert.equal(reviewLivePayloadOverlays({ coreFiles: f.coreFiles, privateFiles: f.privateFiles }).findings.length, 1); }
  finally { if (previous === undefined) delete process.env.RS3_PRACTICE_ALLOW_OLD_LIVE; else process.env.RS3_PRACTICE_ALLOW_OLD_LIVE = previous; }
});

test('live context rejects added manifests, manually mixed runtime and test deletion, and supports exact source relocation', async t => {
  const f = await fixture(t), moved = path.join(f.root, 'relocated');
  await cp(f.source, moved, { recursive: true });
  await reopenLivePayloadContext(f.proof, { source: moved, core: f.liveCore, revision });
  await assert.rejects(assertLivePayloadTarget(f.livePayload, { revision: '3'.repeat(40) }), /revision differs/);
  await put(moved, 'tests/core-overlays.json', '{"schemaVersion":1,"files":{}}');
  await assert.rejects(reopenLivePayloadContext(f.proof, { source: moved }), /input changed/);
  await assert.rejects(createLivePayloadContext({ ...f.options, source: moved }), /declared tooling substitutions/);
  const forged = { ...f.proof, rulesDigest: '0'.repeat(64) }; delete forged.digest; forged.digest = digestValue(forged);
  await assert.rejects(reopenLivePayloadContext(forged), /identity differs/);
  await put(f.source, 'tests/old-000.test.mjs', '// new runtime test\n');
  await assert.rejects(reopenLivePayloadContext(f.proof), /input changed/);
});

test('an existing live overlay manifest preserves strict review, including stale records', async t => {
  const f = await fixture(t);
  const manifest = { schemaVersion: 1, files: { 'tests/old-000.test.mjs': { coreSha256: '0'.repeat(64) } } };
  for (const root of [f.liveSource, f.source]) await put(root, 'tests/core-overlays.json', JSON.stringify(manifest));
  const proof = await createLivePayloadContext(f.options), livePayload = await reopenLivePayloadContext(proof);
  const review = reviewLivePayloadOverlays({ livePayload, manifest, coreFiles: f.coreFiles, privateFiles: f.privateFiles });
  assert.equal(review.findings[0].id, 'overlay-stale'); assert.deepEqual(review.tolerated, []);
});

test('declared tooling contracts use pinned branch substitutions while ordinary candidates and changed core remain strict', async t => {
  const f = await fixture(t), name = 'tests/test-selection.test.mjs';
  const original = Buffer.from('// original live tooling contract\n'), target = Buffer.from('// updated branch tooling contract\n'), core = Buffer.from('// exact old core contract\n');
  await put(f.liveSource, name, original); await put(f.liveCore, name, core);
  await put(f.tooling, name, target); await put(f.source, name, target);
  await put(f.kit, 'kit.json', JSON.stringify({ schemaVersion: 2, sourceTreeDigest: (await hashTree(f.tooling)).digest }));
  const toolingInputs = { ...f.toolingInputs, kitSha256: sha(await readFile(path.join(f.kit, 'kit.json'))) };
  const proof = await createLivePayloadContext({ ...f.options, toolingInputs }), livePayload = await reopenLivePayloadContext(proof);
  const coreFiles = new Map(f.coreFiles); coreFiles.set(name, core);
  const privateFiles = new Set([...f.privateFiles, name]), inputs = { coreFiles, privateFiles };
  assert.ok(reviewLivePayloadOverlays(inputs).findings.some(row => row.path === name && row.id === 'overlay-unreviewed'));
  const review = reviewLivePayloadOverlays({ ...inputs, livePayload });
  assert.deepEqual(review.findings, []);
  const substitution = review.tolerated.find(row => row.path === name);
  assert.equal(substitution.rule, 'declared-tooling-contract-overlay');
  assert.equal(substitution.input, 'declared-tooling-contract-substitution');
  assert.equal(substitution.livePrivateSha256, sha(original));
  assert.equal(substitution.targetPrivateSha256, sha(target));
  assert.equal(substitution.branchToolingSha256, sha(target));
  assert.equal(substitution.branchKitSha256, toolingInputs.kitSha256);
  const changedCore = new Map(coreFiles); changedCore.set(name, Buffer.from('// candidate core drift\n'));
  assert.ok(reviewLivePayloadOverlays({ ...inputs, coreFiles: changedCore, livePayload }).findings.some(row => row.path === name));
  for (const manifest of [null, { schemaVersion: 1, files: { [name]: { coreSha256: '0'.repeat(64) } } }, { schemaVersion: 1, files: { 'tests/unused.test.mjs': { coreSha256: '0'.repeat(64) } } }]) {
    const result = reviewLivePayloadOverlays({ ...inputs, manifest, livePayload });
    assert.ok(result.findings.some(row => ['overlay-manifest-invalid', 'overlay-stale', 'overlay-unused'].includes(row.id)));
  }
  await put(f.tooling, name, '// changed branch slot after proof\n');
  await assert.rejects(reopenLivePayloadContext(proof), /tooling changed/);
  await put(f.tooling, name, target);
  const existingManifest = { schemaVersion: 1, files: {} };
  for (const root of [f.liveSource, f.source]) await put(root, 'tests/core-overlays.json', JSON.stringify(existingManifest));
  const existingProof = await createLivePayloadContext({ ...f.options, toolingInputs }), existingContext = await reopenLivePayloadContext(existingProof);
  const existingReview = reviewLivePayloadOverlays({ ...inputs, manifest: existingManifest, livePayload: existingContext });
  assert.ok(existingReview.findings.some(row => row.path === name && row.id === 'overlay-unreviewed'));
  assert.deepEqual(existingReview.tolerated, [], 'an established live review mechanism remains strict');
});

test('actual companion assembly requires the practice release identity before applying old-live handling', async t => {
  const f = await fixture(t), companion = path.join(f.root, 'companion'), privateRoot = path.join(companion, 'checks/private-source');
  const release = path.join(companion, 'releases/practice-candidate'), core = path.join(release, 'core');
  await cp(f.source, privateRoot, { recursive: true }); await cp(f.liveCore, core, { recursive: true });
  for (const name of ['companion-check.mjs', 'core-overlay-guard.mjs', 'live-payload-rules.mjs', 'release-identity.mjs']) await put(companion, 'tools/' + name, await readFile(path.join(scripts, name)));
  const proof = await createLivePayloadContext({ ...f.options, source: privateRoot });
  const files = await hashTree(privateRoot), receipt = { schemaVersion: 1, coreRoot: core,
    privateFiles: files.files.map(({ path, sha256 }) => ({ path, sha256 })), practiceInventory: { proof: { ...f.toolingInputs, livePayload: proof }, tolerated: [] } };
  await put(release, 'companion.json', JSON.stringify(receipt));
  await put(release, 'release.json', JSON.stringify({ practice: false, releaseId: 'ordinary-candidate', revision }));
  const output = path.join(companion, '.local/assembled');
  const run = () => spawnSync(process.execPath, [path.join(companion, 'tools/companion-check.mjs'), '--core', core, '--receipt', path.join(release, 'companion.json'), '--lane', 'prepare-text', '--output', output], { windowsHide: true, encoding: 'utf8' });
  const denied = run(); assert.notEqual(denied.status, 0); assert.match(denied.stderr, /matching practice release/);
  await assert.rejects(access(output), { code: 'ENOENT' });
  await put(release, 'release.json', JSON.stringify({ practice: true, releaseId: 'practice-candidate', revision }));
  const allowed = run(); assert.equal(allowed.status, 0, allowed.stderr); assert.match(allowed.stdout, /unchanged-live-overlay/);
  assert.deepEqual(await readFile(path.join(output, 'tests/old-000.test.mjs')), await readFile(path.join(f.liveSource, 'tests/old-000.test.mjs')));
  await assert.rejects(access(path.join(output, 'tests/core-overlays.json')), { code: 'ENOENT' });
});
