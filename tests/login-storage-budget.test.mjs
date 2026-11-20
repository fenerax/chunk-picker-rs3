// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { loginStorageBudget, DEFAULT_LOGIN_STORAGE_BUDGET, createLoginStorageBudget, withLoginStorageRelief } from '../app/storage/login-storage-budget.mjs';
import { atomicWrite } from '../app/storage/atomic-write.mjs';
import { withStorageBudget, storageBudget, storageUsage } from '../app/storage/storage-budget.mjs';
import { replaceSidecar } from '../app/plugin-achievements.mjs';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';
import { runtimeEnvironment } from '../scripts/linux/runtime.mjs';

const refusal = { status: 507, code: 'LOGIN_STORAGE_BUDGET_EXCEEDED' };
async function root(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'login-storage-'));
  t.after(() => rm(directory, { recursive: true })); return directory;
}
async function fixture(t, options) {
  const directory = await mkdtemp(path.join(tmpdir(), 'login-storage-')); let f = await inviteFixture(directory, options);
  t.after(async () => { await f.close(); await rm(directory, { recursive: true }); });
  return { get f() { return f; }, async restart(options) { await f.close(); f = await inviteFixture(directory, options); } };
}
const document = f => readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8').then(JSON.parse);
async function group(f) {
  const owner = await f.registry.firstLogin('google', 'owner'), player = await f.registry.firstLogin('google', 'player');
  const invitation = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.join(invitation, player.account, { characterId: player.character.id });
  player.character = f.registry.getCharacter(player.character.id);
  return { owner, player };
}

test('login limits validate config independently of traffic and group budgets', () => {
  assert.deepEqual(loginStorageBudget({}, {}), DEFAULT_LOGIN_STORAGE_BUDGET);
  assert.deepEqual(loginStorageBudget({}, { RS3_LOGIN_MAX_BYTES: '42', RS3_LOGIN_MAX_MAPS: '3' }), { maxBytes: 42, maxMaps: 3 });
  for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => loginStorageBudget({ maxBytes: value }, {}), /Invalid/);
  assert.throws(() => loginStorageBudget({ maxMaps: 129 }, {}), /128/);
  assert.throws(() => loginStorageBudget({ unknown: 1 }, {}), /Invalid/);
});

test('Linux serving children receive the configured login budgets', t => {
  const values = { RS3_LOGIN_MAX_BYTES: '123456', RS3_LOGIN_MAX_MAPS: '7' };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  assert.deepEqual(loginStorageBudget({}, runtimeEnvironment({ datasetId: 'open-f2p' })), { maxBytes: 123456, maxMaps: 7 });
});

for (const loginStorage of [{ maxMaps: 2 }, { maxBytes: 2 * 1024 ** 3 }]) test(`concurrent character creation has one winner at ${JSON.stringify(loginStorage)}`, async t => {
  const h = await fixture(t, { loginStorage }), f = h.f;
  const p = await f.registry.firstLogin('google', 'owner');
  const attempts = await Promise.allSettled(['second', 'third'].map(requestId => f.registry.addCharacter(p.account.id, { requestId })));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.code, refusal.code);
  const ledger = JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')));
  assert.equal(ledger.issuedPickerIds.length, 2); assert.equal(ledger.issuedCharacterIds.length, 2);
  await h.restart({ loginStorage: { maxBytes: 1 } });
  const before = await document(h.f);
  await assert.rejects(h.f.registry.firstLogin('google', 'new-login'), refusal);
  await assert.rejects(h.f.registry.addCharacter(p.account.id, { requestId: 'extra' }), refusal);
  assert.deepEqual(await document(h.f), before);
  assert.ok((await h.f.registry.firstLogin('google', 'owner')).picker);
});

test('an import that fits its group but exceeds the login is refused before any preimage publication', async t => {
  const h = await fixture(t), p = await h.f.registry.firstLogin('google', 'owner');
  const store = (await h.f.open(p.picker.id)).store, save = await store.backup();
  const directory = h.f.registry.pickerDirectory(p.picker.id), before = await storageUsage(directory);
  await h.restart({ loginStorage: { maxBytes: before.bytes + 1024 } });
  const reopened = (await h.f.open(p.picker.id)).store;
  const originalNotes = save.state.members[0].notes;
  save.state.members[0].notes = { '12341': 'Synthetic note '.repeat(2000) };
  await assert.rejects(reopened.replace(save, reopened.getInfo().revision), refusal);
  assert.deepEqual(await storageUsage(directory), before);
  assert.deepEqual((await reopened.backup()).state.members[0].notes, originalNotes);
});

test('an invite adding a character to an already controlled picker still reserves its retained growth', async t => {
  const h = await fixture(t), p = await h.f.registry.firstLogin('google', 'owner');
  await h.f.open(p.picker.id);
  const invitation = await h.f.registry.createGroupInvite(p.account.id, p.picker.id);
  const usage = await storageUsage(h.f.registry.pickerDirectory(p.picker.id));
  await h.restart({ loginStorage: { maxBytes: usage.bytes + 1024 } });
  const before = await document(h.f), ledger = await readFile(path.join(h.f.options.tombstoneDir, 'ledger.json'));
  await assert.rejects(h.f.registry.beginGroupJoin(invitation.secret, p.account.id, {}), refusal);
  assert.deepEqual(await document(h.f), before);
  assert.deepEqual(await readFile(path.join(h.f.options.tombstoneDir, 'ledger.json')), ledger);
});

test('retired onboarding maps, pending departure solo and Past map all consume map slots', async t => {
  const { f } = await fixture(t, { loginStorage: { maxMaps: 3 } }), { owner, player } = await group(f);
  const input = { requestId: randomUUID(), characterId: player.character.id };
  const before = await document(f), ledger = await readFile(path.join(f.options.tombstoneDir, 'ledger.json'));
  await assert.rejects(f.registry.beginDeparture(player.account.id, player.character.id, owner.picker.id, input), refusal);
  assert.deepEqual(await document(f), before);
  assert.deepEqual(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')), ledger);
});

test('pending departure reserves bytes across restart and completes after limits are lowered', async t => {
  const h = await fixture(t), { owner, player } = await group(h.f), f = h.f;
  const input = { requestId: randomUUID(), characterId: player.character.id };
  const intent = await f.registry.beginDeparture(player.account.id, player.character.id, owner.picker.id, input);
  await h.restart({ loginStorage: { maxMaps: 1, maxBytes: 1 } });
  await assert.rejects(h.f.registry.addCharacter(player.account.id, { requestId: 'extra' }), refusal);
  await h.f.departures.recover();
  assert.ok(h.f.registry.getDeparture(intent.id).completedAt);
  assert.equal(h.f.registry.listPastMaps(player.account.id).length, 1);
  assert.equal(h.f.registry.getCharacter(player.character.id).placement.pickerId, intent.destination.pickerId);
});

test('new invite character and rejoin include their retained maps before irreversible allocation', async t => {
  const h = await fixture(t), { owner, player } = await group(h.f);
  const store = (await h.f.open(owner.picker.id)).store;
  await h.f.departures.depart(player.account.id, player.character.id, owner.picker.id, { requestId: randomUUID(), characterId: player.character.id, revision: store.getInfo().revision });
  const rejoin = await h.f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await h.restart({ loginStorage: { maxMaps: 4 } });
  const before = await document(h.f);
  await assert.rejects(h.f.registry.beginGroupJoin(rejoin.secret, player.account.id, { characterId: player.character.id }), refusal);
  assert.deepEqual(await document(h.f), before);
  await h.restart({ loginStorage: { maxMaps: 1 } });
  const newInvite = await h.f.registry.createGroupInvite(player.account.id, h.f.registry.getCharacter(player.character.id).placement.pickerId);
  const ledger = await readFile(path.join(h.f.options.tombstoneDir, 'ledger.json'));
  await assert.rejects(h.f.registry.beginGroupJoin(newInvite.secret, owner.account.id, {}), refusal);
  assert.deepEqual(await readFile(path.join(h.f.options.tombstoneDir, 'ledger.json')), ledger);
});

test('over-limit login keeps readable maps and can delete a character from a surviving group', async t => {
  const h = await fixture(t), { owner, player } = await group(h.f);
  await h.restart({ loginStorage: { maxMaps: 1, maxBytes: 1 } });
  const f = h.f, store = (await f.open(owner.picker.id)).store, saved = await store.backup();
  await assert.rejects(store.replace(saved, store.getInfo().revision), refusal);
  assert.deepEqual((await store.backup()).state.members, saved.state.members);
  const service = createCharacterDeletionService({ registry: f.registry, using: async (id, work) => work(await f.open(id)), purge: async () => {} });
  const selection = { kind: 'character', characterId: player.character.id, pickerId: owner.picker.id, deleteGroup: false };
  const review = await service.review(player.account.id, selection);
  await service.delete(player.account.id, { ...selection, requestId: randomUUID() }, review);
  assert.equal(f.registry.listCharacters(player.account.id).length, 0);
  assert.equal(store.getReadState().members.length, 1);
});

async function accountingFixture(t, limits) {
  const directory = await root(t), pickerRoot = path.join(directory, 'pickers'), registryDir = path.join(directory, 'registry');
  const ids = ['p_' + 'a'.repeat(32), 'p_' + 'b'.repeat(32)];
  const doc = { accounts: [{ id: 'synthetic-login', memberships: [] }], pickers: ids.map(id => ({ id, kind: 'default', lifecycle: 'active', ownerAccountId: 'synthetic-login' })), characters: [] };
  for (const id of ids) { await mkdir(path.join(pickerRoot, id), { recursive: true }); await writeFile(path.join(pickerRoot, id, 'state.json'), '12345'); }
  const guard = createLoginStorageBudget({ read: () => doc, pickerRoot, registryDir, limits, groupMaxBytes: 100 });
  t.after(() => guard.close());
  return { doc, guard, dirs: ids.map(id => path.join(pickerRoot, id)), registryDir };
}

test('concurrent publications to different pickers share the login byte allowance', async t => {
  const f = await accountingFixture(t, { maxMaps: 20, maxBytes: 18 });
  const attempts = await Promise.allSettled(f.dirs.map(dir => {
    const file = path.join(dir, 'private-evidence.json');
    return withStorageBudget(dir, [{ file, bytes: '123456' }], storageBudget({ minFreeBytes: 1 }), () => atomicWrite(file, '123456'));
  }));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.code, refusal.code);
  assert.equal((await readFile(path.join(f.dirs[0], 'state.json'), 'utf8')), '12345');
});

test('Past map bytes and sibling binding count; shrink is allowed after limits fall', async t => {
  const f = await accountingFixture(t, { maxMaps: 20, maxBytes: 20 });
  await writeFile(f.dirs[0] + '.dataset.json', '1234');
  await mkdir(path.join(f.registryDir, 'past-maps'), { recursive: true });
  f.doc.pastMaps = [{ id: 'snapshot', accountId: 'synthetic-login' }];
  await writeFile(path.join(f.registryDir, 'past-maps', 'snapshot.json'), '12345');
  await assert.rejects(atomicWrite(path.join(f.dirs[1], 'state.json'), '1234567'), refusal);
  await writeFile(path.join(f.dirs[0], 'existing.json'), '1234567890');
  await atomicWrite(path.join(f.dirs[0], 'existing.json'), '1');
  await assert.rejects(atomicWrite(path.join(f.dirs[1], 'new.json'), '1'), refusal);
});

test('corrupt plugin evidence archives its old bytes only when the full replacement fits', async t => {
  const f = await accountingFixture(t, { maxMaps: 20, maxBytes: 20 }), file = path.join(f.dirs[0], 'plugin-items.json');
  await writeFile(file, 'broken');
  await assert.rejects(replaceSidecar(file, '12345', true, () => 0), refusal);
  assert.equal(await readFile(file, 'utf8'), 'broken');
});

test('several characters in one picker are charged once and viewer grants add no map', async t => {
  const f = await accountingFixture(t, { maxMaps: 2, maxBytes: 20 });
  f.doc.characters = ['one', 'two'].map(id => ({ id, accountId: 'synthetic-login', lifecycle: 'active', placement: { pickerId: f.doc.pickers[0].id } }));
  const proposal = structuredClone(f.doc);
  proposal.accounts[0].memberships.push({ pickerId: 'uncontrolled', role: 'viewer' });
  await f.guard.run(() => f.guard.admit(proposal));
  await atomicWrite(path.join(f.dirs[0], 'state.json'), '123456');
});

test('deferred callbacks cannot retain deletion or publication quota exemptions', async t => {
  const f = await accountingFixture(t, { maxMaps: 20, maxBytes: 11 });
  let afterRelief, afterPublication;
  await withLoginStorageRelief(() => { afterRelief = AsyncLocalStorage.snapshot(); });
  await atomicWrite(path.join(f.dirs[0], 'state.json'), '123456', { beforeRename() { afterPublication = AsyncLocalStorage.snapshot(); } });
  for (const later of [afterRelief, afterPublication]) await assert.rejects(later(() => atomicWrite(path.join(f.dirs[1], 'extra.json'), '1')), refusal);
});

test('an unplanned nested sidecar must fit alongside every pending gameplay output', async t => {
  const f = await accountingFixture(t, { maxMaps: 20, maxBytes: 12 });
  const file = path.join(f.dirs[0], 'state.json'), sidecar = path.join(f.dirs[0], 'extra.json');
  await assert.rejects(atomicWrite(file, '123456', { beforeRename: () => atomicWrite(sidecar, '12') }), refusal);
  assert.equal(await readFile(file, 'utf8'), '12345');
  await assert.rejects(readFile(sidecar), { code: 'ENOENT' });
  await atomicWrite(file, '123456', { beforeRename: () => atomicWrite(sidecar, '1') });
  assert.equal(await readFile(sidecar, 'utf8'), '1');
});

test('malformed unbounded directory trees fail closed at the accounting ceiling', async t => {
  const f = await accountingFixture(t, { maxMaps: 20, maxBytes: 1000 });
  for (let n = 0; n < 4097; n++) await mkdir(path.join(f.dirs[0], String(n)));
  await assert.rejects(atomicWrite(path.join(f.dirs[1], 'new.json'), '1'), refusal);
});

test('single-picker writes ignore login limits without a multi-picker registry', async t => {
  const dir = await root(t), file = path.join(dir, 'state.json');
  const previous = process.env.RS3_LOGIN_MAX_BYTES; process.env.RS3_LOGIN_MAX_BYTES = 'invalid';
  try { await withStorageBudget(dir, [{ file, bytes: '12345' }], storageBudget({ minFreeBytes: 1 }), () => atomicWrite(file, '12345')); }
  finally { if (previous === undefined) delete process.env.RS3_LOGIN_MAX_BYTES; else process.env.RS3_LOGIN_MAX_BYTES = previous; }
  assert.equal(await readFile(file, 'utf8'), '12345');
});
