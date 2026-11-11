// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRegistry, DEFAULT_REGISTRY_CAPS } from '../app/storage/registry.mjs';

const at = '2026-01-01T00:00:00.000Z';
const accountId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pickerId = n => 'p_' + n.toString(16).padStart(32, '0');
const account = n => ({ id: accountId(n), identities: [{ provider: 'google', subject: `synthetic-${n}` }], memberships: [], defaultPickerId: null, createdAt: at });
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'launch-registry-caps-'));
  const options = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'), ...overrides };
  const file = path.join(options.registryDir, 'registry.json'), ledger = path.join(options.tombstoneDir, 'ledger.json');
  let registry;
  const f = { options, file, ledger, get registry() { return registry; },
    async open(edit = {}) { registry = await openRegistry({ ...options, ...edit }); },
    async close() { await registry?.close(); registry = undefined; },
    async restart(edit = {}) { await f.close(); await f.open(edit); },
    async bytes() { return Promise.all([readFile(file, 'utf8'), readFile(ledger, 'utf8')]); },
    async seed(accounts, pickers = [], tombstones = [], capabilities = []) {
      await mkdir(options.registryDir, { recursive: true }); await mkdir(options.tombstoneDir, { recursive: true });
      await writeFile(file, JSON.stringify({ schemaVersion: 1, accounts, pickers, capabilities }));
      await writeFile(ledger, JSON.stringify({ schemaVersion: 1, issuedPickerIds: pickers.map(p => p.id), pickers: tombstones, accounts: [] }));
    },
  };
  t.after(async () => { await f.close(); await rm(root, { recursive: true, force: true }); });
  return f;
}
const denied = (operation, pattern) => assert.rejects(operation, failure => failure.status === 409 && pattern.test(failure.message));

test('adopted defaults keep defensive bounds and raise only entity/capability ceilings', () => {
  assert.deepEqual(DEFAULT_REGISTRY_CAPS, { accounts: 3000, pickers: 3500, capabilities: 20000, capabilitiesPerPicker: 100,
    issuedPickerIds: 1000000, retiredAccounts: 1000000, membershipsPerAccount: 1000, membersPerPicker: 100 });
});

test('the 3000th active login persists and the next login leaves records and ledger unchanged', async t => {
  const f = await fixture(t); await f.seed(Array.from({ length: 2999 }, (_, n) => account(n + 1))); await f.open();
  const last = await f.registry.ensureIdentity('discord', 'synthetic-last');
  assert.equal(f.registry.listAccounts().length, 3000);
  for (const restart of [false, true]) {
    if (restart) await f.restart();
    const before = await f.bytes();
    await denied(f.registry.firstLogin('discord', 'synthetic-overflow'), /login account limit/);
    assert.deepEqual(await f.bytes(), before);
    assert.equal(f.registry.findIdentity('discord', 'synthetic-last').id, last.id);
    assert.equal(f.registry.findIdentity('discord', 'synthetic-overflow'), null);
  }
  // Tombstoning frees active quota without removing the external non-reuse record.
  await f.registry.deleteAccount(last.id);
  const replacement = await f.registry.ensureIdentity('discord', 'synthetic-replacement');
  assert.notEqual(replacement.id, last.id); assert.equal(f.registry.isAccountDeleted(last.id), true);
  assert.equal(f.registry.listAccounts().length, 3000);
});

test('3500 non-deleted pickers include deleting and reserved records; overflow is atomic across restart', async t => {
  const f = await fixture(t), owner = account(1);
  const pickers = Array.from({ length: 3499 }, (_, n) => ({ id: pickerId(n + 1), kind: 'default', ownerAccountId: owner.id,
    lifecycle: 'deleting', provisioning: 'reserved', memberIds: ['owner'], createdAt: at }));
  const tombstones = pickers.map(p => ({ pickerId: p.id, lifecycle: 'deleting', deletingAt: at, deletedAt: null }));
  await f.seed([owner], pickers, tombstones); await f.open();
  const last = await f.registry.firstLogin('google', 'synthetic-1');
  assert.equal(f.registry.listPickers().length, 3500);
  for (const restart of [false, true]) {
    if (restart) await f.restart();
    const before = await f.bytes();
    await denied(f.registry.firstLogin('discord', 'synthetic-no-room'), /picker limit/);
    assert.deepEqual(await f.bytes(), before);
    assert.equal(f.registry.findIdentity('discord', 'synthetic-no-room'), null);
    assert.equal((await f.registry.firstLogin('google', 'synthetic-1')).picker.id, last.picker.id);
  }
});

test('beta admission serializes concurrent claims without allocating a refused account or ID', async t => {
  const f = await fixture(t, { betaPickerCap: 1 }); await f.open();
  const results = await Promise.allSettled(['one', 'two'].map(subject => f.registry.firstLogin('discord', subject)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /beta is full/);
  const first = results.find(r => r.status === 'fulfilled').value;
  assert.equal(f.registry.listAccounts().length, 1);
  assert.deepEqual(JSON.parse(await readFile(f.ledger, 'utf8')).issuedPickerIds, [first.picker.id]);
  await f.restart(); const before = await f.bytes();
  await denied(f.registry.firstLogin('google', 'synthetic-full'), /beta is full/);
  assert.deepEqual(await f.bytes(), before);
  assert.equal((await f.registry.firstLogin('discord', 'one')).picker.id, first.picker.id);
  // An unset beta cap admits additional pickers through the normal registry ceiling.
  await f.restart({ betaPickerCap: undefined });
  assert.notEqual((await f.registry.firstLogin('google', 'synthetic-unset')).picker.id, first.picker.id);
  await f.restart({ betaPickerCap: 1 });
  assert.equal(f.registry.listPickers().length, 2);
  assert.equal((await f.registry.firstLogin('google', 'synthetic-unset')).picker.provisioning, 'ready');
  await denied(f.registry.firstLogin('discord', 'synthetic-lowered'), /beta is full/);
});

test('a lowered full beta cap allows reserved provisioning recovery and deletion; IDs are never recycled', async t => {
  const f = await fixture(t, { betaPickerCap: 1 });
  await f.open({ crashPoint(name) { if (name === 'registry-reserved') throw new Error('synthetic interruption'); } });
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-pending'), /synthetic interruption/);
  await f.restart();
  const login = await f.registry.firstLogin('discord', 'synthetic-pending');
  assert.equal(login.picker.provisioning, 'ready');
  const directory = f.registry.pickerDirectory(login.picker.id);
  await writeFile(path.join(directory, 'synthetic-map'), 'kept at refusal');
  await denied(f.registry.firstLogin('google', 'synthetic-refused'), /beta is full/);
  assert.equal(await readFile(path.join(directory, 'synthetic-map'), 'utf8'), 'kept at refusal');
  await f.registry.beginPickerDeletion(login.picker.id);
  await denied(f.registry.firstLogin('google', 'synthetic-deleting'), /beta is full/);
  await rm(directory, { recursive: true }); await f.registry.completePickerDeletion(login.picker.id);
  await f.restart();
  const next = await f.registry.firstLogin('google', 'synthetic-after-deletion');
  assert.notEqual(next.picker.id, login.picker.id);
  assert.equal(f.registry.getPicker(login.picker.id).lifecycle, 'deleted');
  assert.equal(JSON.parse(await readFile(f.ledger, 'utf8')).issuedPickerIds.length, 2);
});

test('beta counts the legacy picker and never prunes it; configuration rejects invalid caps', async t => {
  const f = await fixture(t, { betaPickerCap: 1 }), legacyDir = path.join(f.options.pickerRoot, '..', 'legacy');
  await mkdir(legacyDir, { recursive: true }); await f.open({ legacyDir });
  const legacy = await f.registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [] });
  const before = await f.bytes();
  await denied(f.registry.firstLogin('discord', 'synthetic-legacy-full'), /beta is full/);
  assert.deepEqual(await f.bytes(), before); assert.equal(f.registry.getPicker(legacy.id).kind, 'legacy-shared');
  await f.close();
  for (const betaPickerCap of [null, 0, -1, 1.5, '50', Infinity]) {
    await assert.rejects(openRegistry({ ...f.options, betaPickerCap }), /betaPickerCap/);
  }
});

test('20000 registry capabilities persist at the boundary without pruning keys or exceeding the 100-per-picker bound', async t => {
  const f = await fixture(t), accounts = [], pickers = [], capabilities = [];
  for (let n = 1; n <= 201; n++) {
    const entry = account(n), id = pickerId(n);
    entry.defaultPickerId = id; entry.memberships.push({ pickerId: id, memberId: 'owner', role: 'owner' }); accounts.push(entry);
    pickers.push({ id, kind: 'default', ownerAccountId: entry.id, lifecycle: 'active', provisioning: 'ready', memberIds: ['owner'], createdAt: at });
    if (n <= 200) for (let k = 0; k < 100; k++) capabilities.push({ kind: 'overlay-capability', hash: ((n - 1) * 100 + k).toString(16).padStart(64, '0'),
      pickerId: id, accountId: entry.id, memberId: 'owner' });
  }
  await f.seed(accounts, pickers, [], capabilities); await f.open();
  const extra = { kind: 'plugin-key', hash: 'f'.repeat(64), pickerId: pickerId(201), accountId: accountId(201), memberId: 'owner' };
  for (const restart of [false, true]) {
    if (restart) await f.restart();
    const before = await f.bytes();
    await denied(f.registry.setCapability(extra), /access key limit/);
    assert.deepEqual(await f.bytes(), before);
    assert.deepEqual(f.registry.resolveCapability(capabilities[0].kind, capabilities[0].hash), capabilities[0]);
    assert.deepEqual(f.registry.resolveCapability(capabilities.at(-1).kind, capabilities.at(-1).hash), capabilities.at(-1));
  }
  // Global headroom does not bypass the unchanged per-picker representation bound.
  await f.registry.revokeCapability(capabilities.at(-1).kind, capabilities.at(-1).hash);
  await denied(f.registry.setCapability({ ...extra, pickerId: pickerId(1), accountId: accountId(1) }), /This picker.*access key limit/);
  await f.registry.setCapability(extra);
  assert.equal(f.registry.resolveCapability(extra.kind, extra.hash).pickerId, extra.pickerId);
});
