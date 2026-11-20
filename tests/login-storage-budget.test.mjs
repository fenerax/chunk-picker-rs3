// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loginStorageBudget, DEFAULT_LOGIN_STORAGE_BUDGET, createLoginStorageBudget, assertPastMapFits } from '../app/storage/login-storage-budget.mjs';
import { storageBudget } from '../app/storage/storage-budget.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';
import { runtimeEnvironment } from '../scripts/linux/runtime.mjs';

const refusal = { status: 507, code: 'LOGIN_STORAGE_BUDGET_EXCEEDED' };
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

test('login map limit validates configuration and reaches Linux serving children', t => {
  assert.deepEqual(loginStorageBudget({}, {}), DEFAULT_LOGIN_STORAGE_BUDGET);
  assert.deepEqual(loginStorageBudget({}, { RS3_LOGIN_MAX_MAPS: '3' }), { maxMaps: 3 });
  assert.deepEqual(loginStorageBudget({ maxMaps: 4 }, { RS3_LOGIN_MAX_MAPS: '3' }), { maxMaps: 4 });
  for (const maxMaps of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => loginStorageBudget({ maxMaps }, {}), /Invalid/);
  assert.throws(() => loginStorageBudget({ unknown: 1 }, {}), /Invalid/);
  const previous = process.env.RS3_LOGIN_MAX_MAPS; process.env.RS3_LOGIN_MAX_MAPS = '7';
  t.after(() => { if (previous === undefined) delete process.env.RS3_LOGIN_MAX_MAPS; else process.env.RS3_LOGIN_MAX_MAPS = previous; });
  assert.deepEqual(loginStorageBudget({}, runtimeEnvironment({ datasetId: 'open-f2p' })), { maxMaps: 7 });
});

test('concurrent admissions which each fit alone cannot both spend the last map slot', async t => {
  const h = await fixture(t, { loginStorage: { maxMaps: 2 } }), f = h.f;
  const p = await f.registry.firstLogin('google', 'owner');
  const attempts = await Promise.allSettled(['second', 'third'].map(requestId => f.registry.addCharacter(p.account.id, { requestId })));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.code, refusal.code);
  const ledger = JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')));
  assert.equal(ledger.issuedPickerIds.length, 2); assert.equal(ledger.issuedCharacterIds.length, 2);
  await h.restart({ loginStorage: { maxMaps: 1 } });
  const before = await document(h.f);
  await assert.rejects(h.f.registry.addCharacter(p.account.id, { requestId: 'extra' }), refusal);
  assert.deepEqual(await document(h.f), before);
  assert.ok((await h.f.registry.firstLogin('google', 'owner')).picker);
});

test('joining an already controlled picker uses its existing map slot', async t => {
  const { f } = await fixture(t, { loginStorage: { maxMaps: 1 } }), p = await f.registry.firstLogin('google', 'owner');
  const invitation = await f.registry.createGroupInvite(p.account.id, p.picker.id);
  await f.join(invitation, p.account, {});
  assert.equal(f.registry.listCharacters(p.account.id).length, 2);
  assert.equal((await document(f)).pickers.length, 1);
});

test('retired onboarding maps, pending departure solo and Past map all consume map slots', async t => {
  const { f } = await fixture(t, { loginStorage: { maxMaps: 3 } }), { owner, player } = await group(f);
  const input = { requestId: randomUUID(), characterId: player.character.id };
  const before = await document(f), ledger = await readFile(path.join(f.options.tombstoneDir, 'ledger.json'));
  await assert.rejects(f.registry.beginDeparture(player.account.id, player.character.id, owner.picker.id, input), refusal);
  assert.deepEqual(await document(f), before);
  assert.deepEqual(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')), ledger);
});

test('pending departure reservations survive restart and finish after the map limit is lowered', async t => {
  const h = await fixture(t), { owner, player } = await group(h.f), f = h.f;
  const input = { requestId: randomUUID(), characterId: player.character.id };
  const intent = await f.registry.beginDeparture(player.account.id, player.character.id, owner.picker.id, input);
  await h.restart({ loginStorage: { maxMaps: 1 } });
  await assert.rejects(h.f.registry.addCharacter(player.account.id, { requestId: 'extra' }), refusal);
  await h.f.departures.recover();
  assert.ok(h.f.registry.getDeparture(intent.id).completedAt);
  assert.equal(h.f.registry.listPastMaps(player.account.id).length, 1);
  assert.equal(h.f.registry.getCharacter(player.character.id).placement.pickerId, intent.destination.pickerId);
});

test('new invite character and rejoin include retained maps before irreversible allocation', async t => {
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

test('an over-limit login can read, save, import into its existing map and delete a character', async t => {
  const h = await fixture(t), { owner, player } = await group(h.f);
  await h.restart({ loginStorage: { maxMaps: 1 } });
  const f = h.f, store = (await f.open(owner.picker.id)).store, saved = await store.backup();
  saved.state.members[0].notes = { '12341': 'Synthetic imported note' };
  await store.replace(saved, store.getInfo().revision);
  await store.command({ type: 'set-journal', memberId: 'owner', note: 'Synthetic saved note' }, store.getInfo().revision);
  assert.equal((await store.backup()).state.members[0].notes['12341'], 'Synthetic imported note');
  await assert.rejects(f.registry.addCharacter(player.account.id, { requestId: 'extra' }), refusal);
  const service = createCharacterDeletionService({ registry: f.registry, using: async (id, work) => work(await f.open(id)), purge: async () => {} });
  const selection = { kind: 'character', characterId: player.character.id, pickerId: owner.picker.id, deleteGroup: false };
  const review = await service.review(player.account.id, selection);
  await service.delete(player.account.id, { ...selection, requestId: randomUUID() }, review);
  assert.equal(f.registry.listCharacters(player.account.id).length, 0);
  assert.equal(store.getReadState().members.length, 1);
});

test('ordinary saves in two groups of one login progress independently while one publication is held', { timeout: 30000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let heldPicker;
  t.after(() => release.resolve());
  const { f } = await fixture(t, { loginStorage: { maxMaps: 2 }, async beforeCommit(change, { pickerId }) {
    if (change.operation === 'command' && pickerId === heldPicker) { entered.resolve(); await release.promise; }
  } });
  const p = await f.registry.firstLogin('google', 'owner'), other = await f.registry.addCharacter(p.account.id, { requestId: 'second' });
  const a = (await f.open(p.picker.id)).store, b = (await f.open(other.picker.id)).store;
  heldPicker = p.picker.id;
  const first = a.command({ type: 'set-journal', memberId: 'owner', note: 'Synthetic held save' }, a.getInfo().revision);
  await entered.promise;
  const second = b.command({ type: 'set-journal', memberId: 'owner', note: 'Synthetic independent save' }, b.getInfo().revision);
  let timer;
  try {
    await Promise.race([second, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Another group was blocked by the held save.')), 15000); })]);
    assert.equal(b.getInfo().revision, 1);
    assert.equal(a.getInfo().revision, 0);
  } finally { clearTimeout(timer); release.resolve(); await Promise.all([first, second]); }
  assert.equal(a.getInfo().revision, 1);
});

test('shared placements deduplicate; viewers and deleted pickers do not add retained maps', () => {
  const picker = 'synthetic-picker', account = 'synthetic-login';
  const doc = { accounts: [{ id: account, memberships: [{ pickerId: picker, role: 'player' }] }], pickers: [{ id: picker, kind: 'default', lifecycle: 'active', ownerAccountId: account }],
    characters: ['synthetic-one', 'synthetic-two'].map(id => ({ id, accountId: account, lifecycle: 'active', placement: { pickerId: picker } })) };
  const guard = createLoginStorageBudget({ read: () => doc, limits: { maxMaps: 1 } });
  const proposal = structuredClone(doc);
  proposal.accounts[0].memberships.push({ pickerId: 'synthetic-viewed-picker', role: 'viewer' });
  proposal.pickers.push({ id: 'synthetic-deleted-picker', kind: 'default', lifecycle: 'deleted', ownerAccountId: account });
  assert.doesNotThrow(() => guard.admit(proposal));
  proposal.pastMaps = [{ id: 'synthetic-snapshot', accountId: account }];
  assert.throws(() => guard.admit(proposal), refusal);
});

test('frozen snapshots have a byte bound separate from map-count admission', () => {
  const snapshot = { note: 'Synthetic snapshot' }, bytes = Buffer.byteLength(JSON.stringify(snapshot)) + 1;
  assert.doesNotThrow(() => assertPastMapFits(snapshot, bytes));
  assert.throws(() => assertPastMapFits(snapshot, bytes - 1), { status: 507, code: 'STORAGE_BUDGET_EXCEEDED' });
  assert.equal(DEFAULT_LOGIN_STORAGE_BUDGET.maxMaps * storageBudget({}, {}).maxBytes, 20 * 1024 ** 3);
});

test('capture refuses an oversized frozen copy without changing its source or writing a Past map', async t => {
  const { f } = await fixture(t), { owner, player } = await group(f);
  const store = (await f.open(owner.picker.id)).store, snapshot = await store.backup();
  const intent = await f.registry.beginDeparture(player.account.id, player.character.id, owner.picker.id, { requestId: randomUUID(), characterId: player.character.id });
  const previous = process.env.RS3_STORE_MAX_BYTES;
  process.env.RS3_STORE_MAX_BYTES = String(Buffer.byteLength(JSON.stringify(snapshot)));
  try {
    await assert.rejects(f.registry.capturePastMap({ id: intent.id, accountId: intent.accountId, characterId: intent.characterId,
      pickerId: intent.source.pickerId, memberId: intent.source.memberId, reason: intent.reason, createdAt: intent.createdAt }, snapshot), { status: 507, code: 'STORAGE_BUDGET_EXCEEDED' });
  } finally { if (previous === undefined) delete process.env.RS3_STORE_MAX_BYTES; else process.env.RS3_STORE_MAX_BYTES = previous; }
  assert.deepEqual((await store.backup()).state, snapshot.state);
  assert.deepEqual(f.registry.listPastMaps(player.account.id), []);
  await assert.rejects(readFile(path.join(f.options.registryDir, 'past-maps', intent.id + '.json')), { code: 'ENOENT' });
  await f.departures.recover();
  assert.ok(f.registry.getDeparture(intent.id).completedAt);
});

test('single-picker saves ignore login settings without a multi-picker registry', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'login-storage-legacy-'));
  const previous = process.env.RS3_LOGIN_MAX_MAPS; process.env.RS3_LOGIN_MAX_MAPS = 'invalid';
  let store;
  try {
    store = await openStore({ dataDir: dir, initialState: createGroupState([{ id: 'owner', name: 'Synthetic player' }]) });
    await store.command({ type: 'set-journal', memberId: 'owner', note: 'Synthetic legacy save' }, store.getInfo().revision);
    assert.equal(store.getInfo().revision, 1);
  } finally {
    if (previous === undefined) delete process.env.RS3_LOGIN_MAX_MAPS; else process.env.RS3_LOGIN_MAX_MAPS = previous;
    await store?.close(); await rm(dir, { recursive: true });
  }
});
