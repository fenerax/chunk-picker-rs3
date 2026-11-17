import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRegistry } from '../app/storage/registry.mjs';
import { writeRegistryJson } from '../app/storage/registry-lock.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-registry-sync-'));
  const registries = [];
  t.after(async () => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    for (const registry of registries.reverse()) await registry.close();
    await rm(root, { recursive: true, force: true });
  });
  return { options: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') }, registries };
}

// Keep real file writes and rename, but provide a directory handle even on
// Windows so an EIO after the successful rename is exercised on every platform.
function failPublishedSync(t, file, publication = 1) {
  const { open, rename } = fs.promises;
  const failure = Object.assign(new Error('Synthetic directory sync failure'), { code: 'EIO' });
  let published = false, syncFailures = 0, publications = 0;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    await rename(from, to);
    if (to === file && ++publications === publication) published = true;
  });
  t.mock.method(fs.promises, 'open', async (target, flags, ...options) => {
    if (published && target === path.dirname(file) && flags === 'r') {
      return { async sync() { syncFailures++; throw failure; }, async close() {} };
    }
    return open(target, flags, ...options);
  });
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  syncBuiltinESMExports();
  const restore = () => { t.mock.restoreAll(); syncBuiltinESMExports(); };
  t.after(restore);
  return { failure, warnings, restore, get syncFailures() { return syncFailures; } };
}

test('registry JSON propagates a post-rename directory sync failure', async t => {
  const { options } = await fixture(t), file = path.join(path.dirname(options.registryDir), 'registry.json');
  const fault = failPublishedSync(t, file), document = { schemaVersion: 1, entries: [] };
  await assert.rejects(writeRegistryJson(file, document), error => error === fault.failure);
  assert.deepEqual(JSON.parse(await readFile(file)), document);
  assert.equal(fault.syncFailures, 1);
  assert.deepEqual(fault.warnings, []);
  assert.deepEqual(await readdir(path.dirname(file)), ['registry.json']);
});

for (const target of ['intent', 'ledger', 'registry']) test(`${target} post-rename sync failure stops allocation and fences the instance`, async t => {
  const { options, registries } = await fixture(t), points = [];
  const registry = await openRegistry({ ...options, crashPoint: name => points.push(name) });
  registries.push(registry);
  const account = await registry.ensureIdentity('discord', 'synthetic-sync-failure');
  const registryFile = path.join(options.registryDir, 'registry.json'), ledgerFile = path.join(options.tombstoneDir, 'ledger.json');
  const before = JSON.parse(await readFile(registryFile));
  const fault = failPublishedSync(t, target === 'ledger' ? ledgerFile : registryFile, target === 'registry' ? 2 : 1);
  const allocation = registry.ensureDefaultPicker(account.id);
  // A queued operation must also observe the failed-instance fence.
  const queued = registry.ensureIdentity('google', 'synthetic-queued');
  await assert.rejects(allocation, error => error === fault.failure);
  await assert.rejects(queued, /requires restart/);
  assert.throws(() => registry.listPickers(), /requires restart/);
  assert.throws(() => registry.getAccount(account.id), /requires restart/);
  await assert.rejects(registry.ensureDefaultPicker(account.id), /requires restart/);
  const ledger = JSON.parse(await readFile(ledgerFile)), disk = JSON.parse(await readFile(registryFile));
  const pending = disk.accounts[0].pendingCreation;
  assert.match(pending.pickerId, /^p_[0-9a-f]{32}$/);
  assert.match(pending.characterId, /^c_[0-9a-f]{32}$/);
  assert.deepEqual(ledger.issuedPickerIds, target === 'intent' ? [] : [pending.pickerId]);
  assert.deepEqual(ledger.issuedCharacterIds, target === 'intent' ? [] : [pending.characterId]);
  assert.deepEqual(await readdir(options.pickerRoot), []);
  assert.deepEqual(points, target === 'intent' ? [] : target === 'ledger' ? ['account-recorded'] : ['account-recorded', 'id-reserved']);
  if (target !== 'registry') {
    before.accounts[0].pendingCreation = pending;
    assert.deepEqual(disk, before);
  }
  else {
    assert.equal(disk.pickers.length, 1);
    assert.equal(disk.pickers[0].id, ledger.issuedPickerIds[0]);
    assert.equal(disk.pickers[0].provisioning, 'reserved');
    assert.equal(disk.characters[0].id, pending.characterId);
    assert.equal(disk.pickers[0].seats[0].characterId, pending.characterId);
  }
  assert.equal(fault.syncFailures, 1);
  assert.deepEqual(fault.warnings, []);
  fault.restore();
  await registry.close();
  const reopened = await openRegistry(options);
  registries.push(reopened);
  const picker = await reopened.ensureDefaultPicker(account.id);
  assert.equal(picker.provisioning, 'ready');
  assert.equal(picker.id, pending.pickerId);
  assert.equal(reopened.listCharacters(account.id).length, 1);
  assert.equal(reopened.listCharacters(account.id)[0].id, pending.characterId);
  assert.equal(reopened.getAccount(account.id).pendingCreation, null);
  const recoveredLedger = JSON.parse(await readFile(ledgerFile));
  assert.deepEqual(recoveredLedger.issuedPickerIds, [pending.pickerId]);
  assert.deepEqual(recoveredLedger.issuedCharacterIds, [pending.characterId]);
});
