import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { encode, inventory, json, sha } from '../scripts/linux/files.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { backupStopped, checkStoppedCompatibility } from '../scripts/linux/recovery.mjs';
import { deployPrechecked, runOperator } from '../scripts/linux/operator.mjs';
import { deriveVpsAdditions, newestVerifiedBackup } from '../scripts/release/vps/review.mjs';
import { releaseVps } from '../scripts/release/vps/release.mjs';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';
import { probeChain } from '../scripts/release/pc/quick-build.mjs';
import { compatibilityReports, syntheticAdditions, syntheticCore } from './helpers/release-compatibility.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'vps-additions-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const settings = { dataDir: path.join(scratch, 'live'), scratchRoot: path.join(scratch, 'scratch'), backupDir: path.join(scratch, 'backups'),
    controlDir: path.join(scratch, 'control'), current: path.join(scratch, 'current.json'), minFreeBytes: 0, keep: 5 };
  await mkdir(settings.dataDir); await mkdir(settings.controlDir);
  await writeFile(path.join(settings.dataDir, 'state.json'), encode({ format: 'rs3-chunk-picker', state: { members: [{ id: 'synthetic-member' }] } }));
  await writeFile(settings.dataDir + '.dataset.json', encode({ datasetId: 'open-starter' }));
  const release = async (name, additions) => {
    const core = path.join(scratch, name); await syntheticCore(core, { additions });
    const config = path.join(scratch, name + '-config.json'), bytes = encode({ coreRoot: core, dataDir: settings.dataDir, datasetId: 'open-starter', runtimeOptions: {} });
    await writeFile(config, bytes);
    const pointer = name === 'old' ? settings.current : path.join(scratch, name + '-pointer.json');
    await writeFile(pointer, encode({ config: { path: config, sha256: sha(bytes) } }));
    return readRelease(pointer, settings.dataDir);
  };
  const current = await release('old', false), candidate = await release('new', true);
  const receiptFile = path.join(scratch, 'verified.json');
  await writeFile(receiptFile, encode({ pointer: candidate.pointerFile, candidateIdentity: candidate.identity,
    previousPointerSha256: sha(current.pointerBytes), additionsReviewRequired: true }));
  const backup = async () => backupStopped({ ...settings, release: await readRelease(settings.current, settings.dataDir), probe: async (_release, dataDir, output) => {
    const portable = await readFile(path.join(dataDir, 'state.json')); await writeFile(output, portable);
  } });
  return { scratch, settings, current, candidate, receiptFile, backup, pointer: candidate.pointerFile };
}

test('VPS review derives on a verified backup copy, requires its exact digest, and preserves the backup and live store', async t => {
  const f = await fixture(t), backup = await f.backup();
  const before = await inventory(backup.target), liveBefore = await inventory(f.settings.dataDir);
  // An invalid newer recovery must not mask the newest verified one.
  const invalid = path.join(f.settings.backupDir, 'recovery-20990101T000000000Z-00000000-0000-0000-0000-000000000000');
  await mkdir(invalid); await writeFile(path.join(invalid, 'manifest.json'), '{}');
  assert.equal((await newestVerifiedBackup(f.settings.backupDir)).backup, backup.target);
  const result = await deriveVpsAdditions(f);
  assert.deepEqual(result.savedIdentityAdditions, syntheticAdditions);
  assert.equal(result.digest, digestValue(syntheticAdditions)); assert.equal(result.accepted, false);
  assert.equal((await json(f.receiptFile)).savedIdentityAdditions, undefined);
  await assert.rejects(deriveVpsAdditions({ ...f, acceptDigest: '0'.repeat(64) }), /digest differs/);
  assert.equal((await json(f.receiptFile)).savedIdentityAdditionsReviewed, undefined);
  const accepted = await deriveVpsAdditions({ ...f, acceptDigest: result.digest });
  assert.equal(accepted.accepted, true);
  const receipt = await json(f.receiptFile);
  assert.equal(receipt.savedIdentityAdditionsReviewed, true);
  assert.deepEqual(receipt.savedIdentityAdditions, syntheticAdditions);
  assert.equal(receipt.savedIdentityAdditionsDigest, result.digest);
  assert.deepEqual(await inventory(backup.target), before);
  assert.deepEqual(await inventory(f.settings.dataDir), liveBefore);
  assert.deepEqual(await readdir(f.settings.scratchRoot), []);
});

test('VPS review refuses absent verified backups and changed staged inputs', async t => {
  const f = await fixture(t); await mkdir(f.settings.backupDir);
  await assert.rejects(deriveVpsAdditions(f), /No verified/);
  await f.backup();
  const receipt = await json(f.receiptFile);
  await writeFile(f.receiptFile, encode({ ...receipt, candidateIdentity: 'changed' }));
  await assert.rejects(deriveVpsAdditions(f), /receipt changed/);
});

test('activation re-derives additions on a fresh snapshot and refuses a difference before stopping', async t => {
  const f = await fixture(t); await f.backup();
  const reviewed = await deriveVpsAdditions(f);
  await deriveVpsAdditions({ ...f, acceptDigest: reviewed.digest });
  // A newer VPS save already has the identities; the previously reviewed list
  // must no longer authorize this activation, even with the same candidate.
  const stateFile = path.join(f.settings.dataDir, 'state.json'), document = await json(stateFile);
  document.state.tasks = [{ id: 'rs3:task:existing' }, ...syntheticAdditions.map(row => ({ id: row.target }))];
  document.state.identityRegistry = Object.fromEntries(syntheticAdditions.map(row => [row.key, row.target]));
  document.state.history = [{ type: 'command', value: 'synthetic' }, { type: 'catalogue-refresh' }];
  await writeFile(stateFile, encode(document));
  let stops = 0, checks = 0;
  const receipt = await json(f.receiptFile), before = await inventory(f.settings.dataDir);
  const capture = async () => ({ dataDir: f.settings.dataDir, cleanup: async () => {} });
  await assert.rejects(deployPrechecked({ ...f, savedIdentityAdditions: receipt.savedIdentityAdditions, capture,
    controller: { stop: async () => { stops++; } },
    check: async options => { checks++; return checkStoppedCompatibility(options); } }), /reviewed list/);
  assert.equal(stops, 0); assert.equal(checks, 1);
  assert.deepEqual(await inventory(f.settings.dataDir), before);
  assert.deepEqual(await readFile(f.settings.current), f.current.pointerBytes);
  // Re-reviewing the newest backup now derives the empty list, independently
  // of any PC quick-build receipt.
  await f.backup();
  assert.deepEqual((await deriveVpsAdditions(f)).savedIdentityAdditions, []);
});

test('remote derive requires explicit acceptance and never invokes deploy', async () => {
  const values = { host: 'synthetic-alias', upload: '/var/tmp/upload', target: '/opt/picker/releases/new',
    'operator-config': '/etc/picker/operator.json', 'tools-root': '/opt/picker/tools', node: '/opt/node/bin/node' };
  const calls = [], execute = (file, args) => calls.push({ file, args });
  await releaseVps('derive', values, execute);
  assert.equal(calls.length, 1); assert.match(calls[0].args.at(-1), /review.mjs/);
  assert(!calls[0].args.at(-1).includes('operator.mjs'));
  await releaseVps('derive', { ...values, 'accept-additions': 'a'.repeat(64) }, execute);
  assert(calls[1].args.at(-1).endsWith("'" + 'a'.repeat(64) + "'"));
  await assert.rejects(releaseVps('derive', { ...values, 'accept-additions': 'unsafe' }, execute), /reviewed additions digest/);
  await assert.rejects(releaseVps('derive', { ...values, 'go-live': true }, execute), /cannot activate/);
});

test('PC Quick-Release still derives and checks its additions through its existing probe chain', async t => {
  const f = await fixture(t), { before, after } = compatibilityReports();
  const steps = ['old', 'new', 'rollback', 'forward'].map(name => ({ name, config: {}, binding: Buffer.from('{}') }));
  let index = 0;
  const options = { probe: async () => structuredClone(index++ ? after : before), declaredAdditions: syntheticAdditions };
  const proof = await probeChain(root, f.settings.dataDir, steps, () => {}, options);
  assert.deepEqual(proof.savedIdentityAdditions, syntheticAdditions);
  index = 0;
  await assert.rejects(probeChain(root, f.settings.dataDir, steps, () => {}, { ...options, declaredAdditions: [] }), /reviewed list/);
});

test('operator refuses unreviewed or tampered VPS receipts before service control', async t => {
  const f = await fixture(t), operatorFile = path.join(f.scratch, 'operator.json');
  await writeFile(operatorFile, encode({ ...f.settings, service: 'chunk-picker.service' }));
  const previous = process.env.RS3_OPERATOR_CONFIG;
  process.env.RS3_OPERATOR_CONFIG = operatorFile;
  t.after(() => { if (previous === undefined) delete process.env.RS3_OPERATOR_CONFIG; else process.env.RS3_OPERATOR_CONFIG = previous; });
  await assert.rejects(runOperator('deploy', f.pointer, f.receiptFile), { code: 'OPERATOR_ADDITIONS_REVIEW' });
  const receipt = await json(f.receiptFile);
  await writeFile(f.receiptFile, encode({ ...receipt, additionsReviewRequired: undefined, savedIdentityAdditions: syntheticAdditions }));
  await assert.rejects(runOperator('deploy', f.pointer, f.receiptFile), { code: 'OPERATOR_ADDITIONS_REVIEW' });
  await writeFile(f.receiptFile, encode({ ...receipt, savedIdentityAdditionsReviewed: true,
    savedIdentityAdditions: [], savedIdentityAdditionsDigest: digestValue(syntheticAdditions) }));
  await assert.rejects(runOperator('deploy', f.pointer, f.receiptFile), { code: 'OPERATOR_ADDITIONS_REVIEW' });
  assert.deepEqual(await readdir(f.settings.controlDir), []);
});

test('VPS derivation uses the candidate pack binding only on disposable forward copies', async t => {
  const f = await fixture(t);
  const descriptor = digest => ({ datasetId: 'open-starter', datasetContractVersion: 1, digest });
  const old = descriptor('a'.repeat(64)), next = descriptor('b'.repeat(64));
  for (const [name, selected, desc] of [['old', f.current, old], ['new', f.candidate, next]]) {
    const pins = {};
    for (const [key, value] of Object.entries({ data: { requires: { datasetId: desc.datasetId, datasetContractVersion: 1 }, datasetDigest: desc.digest, ruleContractHash: 'synthetic' },
      profile: { datasetId: desc.datasetId, datasetDigest: desc.digest, ruleContractHash: 'synthetic' }, selection: {} })) {
      const file = path.join(f.scratch, name + '-' + key + '.json'), bytes = encode(value);
      await writeFile(file, bytes); pins[key] = { path: file, sha256: sha(bytes) };
    }
    const bytes = encode({ ...selected.config, packs: { data: pins.data }, profile: pins.profile, selection: pins.selection });
    await writeFile(selected.pointer.config.path, bytes);
    await writeFile(selected.pointerFile, encode({ config: { path: selected.pointer.config.path, sha256: sha(bytes) } }));
  }
  f.current = await readRelease(f.settings.current, f.settings.dataDir);
  f.candidate = await readRelease(f.pointer, f.settings.dataDir);
  const binding = value => ({ schemaVersion: 1, ...value, requiresPack: true });
  await writeFile(f.settings.dataDir + '.dataset.json', encode(binding(old)));
  await writeFile(f.receiptFile, encode({ pointer: f.pointer, candidateIdentity: f.candidate.identity,
    previousPointerSha256: sha(f.current.pointerBytes), additionsReviewRequired: true }));
  // The portable export is synthetic; the real four-probe driver and child
  // protocol still run, with the candidate's explicitly pinned pack binding.
  await f.backup();
  const result = await deriveVpsAdditions({ ...f, check: async options => {
    assert.notEqual(options.dataDir, f.settings.dataDir);
    assert.deepEqual(await json(options.dataDir + '.dataset.json'), binding(old));
    assert.deepEqual(JSON.parse(options.candidateBinding), binding(next));
    return checkStoppedCompatibility(options);
  } });
  assert.deepEqual(result.savedIdentityAdditions, syntheticAdditions);
  assert.deepEqual(await json(f.settings.dataDir + '.dataset.json'), binding(old));
});
