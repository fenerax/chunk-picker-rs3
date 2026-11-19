// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'deletion-review-')); let f = await inviteFixture(root, options);
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  return { get f() { return f; }, async restart() { await f.close(); f = await inviteFixture(root, options); },
    bytes: () => Promise.all(['registryDir', 'tombstoneDir'].map((dir, i) => readFile(path.join(f.options[dir], i ? 'ledger.json' : 'registry.json')))) };
}
const selection = (kind, c = null) => ({ kind, characterId: kind === 'account' ? null : c.id, pickerId: kind === 'account' ? null : c.placement.pickerId, deleteGroup: true });
const service = f => createCharacterDeletionService({ registry: f.registry, using: async (id, work) => work(await f.open(id)), purge: async () => {} });
async function begin(f, login, input) {
  const review = await service(f).review(login.account.id, input);
  return f.registry.beginCharacterDeletion(login.account.id, { ...input, requestId: randomUUID(), revision: review.revision });
}

test('pending login deletion fences every character/placement allocation before any publication and survives restart', async t => {
  const h = await fixture(t), { f } = h, login = await f.registry.firstLogin('google', 'deleting'), other = await f.registry.firstLogin('google', 'other');
  const invite = await f.registry.createGroupInvite(other.account.id, other.picker.id), d = await begin(f, login, selection('account'));
  const before = await h.bytes();
  const operations = [
    () => f.registry.addCharacter(login.account.id, { requestId: 'late' }),
    () => f.registry.firstLogin('google', 'deleting'),
    () => f.registry.ensureDefaultPicker(login.account.id),
    () => f.registry.createGroupInvite(login.account.id, login.picker.id),
    () => f.registry.beginGroupJoin(invite.secret, login.account.id, {}),
    () => f.registry.beginGroupJoin(invite.secret, login.account.id, { characterId: login.character.id }),
    () => f.registry.beginDeparture(login.account.id, login.character.id, login.picker.id, { requestId: randomUUID(), characterId: login.character.id }),
    () => f.registry.attachMembership(login.account.id, { pickerId: login.picker.id, memberId: 'owner', role: 'owner' }),
    () => f.registry.registerLegacy({ memberIds: ['player1', 'player2'], droppedMemberships: 0,
      accounts: [{ id: login.account.id, identities: [], memberships: [{ role: 'player', memberId: 'player1' }] }] }),
  ];
  for (const operation of operations) {
    await assert.rejects(operation(), e => e.status === 409 && /Login deletion is completing/.test(e.message));
    assert.deepEqual(await h.bytes(), before);
  }
  await h.restart();
  await assert.rejects(h.f.registry.addCharacter(login.account.id, { requestId: 'after-restart' }), /Login deletion is completing/);
  await service(h.f).recover();
  assert.ok(h.f.registry.getDeletion(d.id).completedAt); assert.equal(h.f.registry.getAccount(login.account.id), null);
  assert.ok(h.f.registry.selectCharacter(other.account.id, other.character.id));
});

test('completed service retries return their receipt without opening contexts, revoking scopes or purging', async t => {
  const { f } = await fixture(t), login = await f.registry.firstLogin('google', 'retry'), s = service(f), input = selection('account');
  const review = await s.review(login.account.id, input), request = { ...input, requestId: randomUUID() };
  const expected = await s.delete(login.account.id, request, review);
  const retry = createCharacterDeletionService({ registry: f.registry, using() { assert.fail('Completed receipt opened a context'); }, purge() { assert.fail('Completed receipt purged'); } });
  assert.deepEqual(await retry.delete(login.account.id, request, review), expected);
});

test('pending login deletion reserves retired-account capacity against other deletion intents and operator retirement', async t => {
  const h = await fixture(t, { caps: { retiredAccounts: 1 } }), { f } = h;
  const first = await f.registry.firstLogin('google', 'first'), second = await f.registry.firstLogin('google', 'second');
  const d = await begin(f, first, selection('account')), before = await h.bytes();
  await assert.rejects(begin(f, second, selection('account')), e => e.status === 409 && /retired account record limit/.test(e.message));
  await assert.rejects(f.registry.deleteAccount(second.account.id), /retired account record limit/);
  assert.deepEqual(await h.bytes(), before); assert.equal(f.registry.pickerAdmissionPending(second.picker.id), false);
  await service(f).recover(); await h.restart();
  assert.ok(h.f.registry.getDeletion(d.id).completedAt); assert.ok(h.f.registry.selectCharacter(second.account.id, second.character.id));
});

for (const cap of ['retiredAccounts', 'retiredCharacters', 'retiredSlots']) test(`${cap} exhaustion refuses before a second intent, roster change or credential cleanup`, async t => {
  const options = { caps: {} }, h = await fixture(t, options), owner = await h.f.registry.firstLogin('google', 'owner'), players = [];
  for (const name of ['one', 'two']) {
    const p = await h.f.registry.firstLogin('google', name), invite = await h.f.registry.createGroupInvite(owner.account.id, owner.picker.id);
    await h.f.join(invite, p.account, { characterId: p.character.id }); players.push(p);
  }
  const ledger = JSON.parse(await readFile(path.join(h.f.options.tombstoneDir, 'ledger.json')));
  options.caps[cap] = cap === 'retiredSlots' ? ledger.slots.length + 1 : 1;
  await h.restart();
  const inputFor = p => selection(cap === 'retiredAccounts' ? 'account' : 'character', h.f.registry.getCharacter(p.character.id));
  const first = players[0], input = inputFor(first), s = service(h.f), review = await s.review(first.account.id, input);
  await s.delete(first.account.id, { ...input, requestId: randomUUID() }, review);
  const bytes = await h.bytes(), state = structuredClone((await h.f.open(owner.picker.id)).store.getReadState()), p = players[1];
  await assert.rejects(begin(h.f, p, inputFor(p)), e => e.status === 409 && /limit/.test(e.message));
  await assert.rejects(h.f.registry.deleteAccount(p.account.id), e => e.status === 409 && /limit/.test(e.message));
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual((await h.f.open(owner.picker.id)).store.getReadState(), state);
  assert.equal(h.f.registry.pickerAdmissionPending(owner.picker.id), false);
  await h.restart(); await service(h.f).recover(); assert.ok(h.f.registry.selectCharacter(p.account.id, p.character.id));
});

for (const existing of [false, true]) test(`login deletion refuses an out-of-group pending invitation (existing character ${existing}) inside the queue`, async t => {
  const h = await fixture(t), { f } = h, login = await f.registry.firstLogin('google', 'pending-login'), owner = await f.registry.firstLogin('google', 'pending-destination');
  const input = selection('account'), review = f.registry.deletionPlan(login.account.id, input);
  const reclaim = await f.registry.firstLogin('google', 'pending-reclaim'); await f.registry.unlinkIdentity(reclaim.account.id, 'google');
  const code = await f.registry.issueRelinkCode(reclaim.account.id);
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.registry.beginGroupJoin(invite.secret, login.account.id, existing ? { characterId: login.character.id } : {});
  const bytes = await h.bytes();
  await assert.rejects(f.registry.beginCharacterDeletion(login.account.id, { ...input, requestId: randomUUID(), revision: review.revision }), /lifecycle change is pending/);
  await assert.rejects(f.registry.deleteAccount(login.account.id), /lifecycle change is pending/);
  await assert.rejects(f.registry.beginPickerDeletion(owner.picker.id), /lifecycle change is pending/);
  await assert.rejects(f.registry.claimIdentity(code.code, 'google', 'pending-login', { emptyAccountId: login.account.id }), /lifecycle change is pending/);
  assert.deepEqual(await h.bytes(), bytes); assert.equal(f.registry.deletionTransactions().length, 0);
  await h.restart(); await h.f.service.recover();
  assert.ok(h.f.registry.getAccount(login.account.id)); assert.equal(h.f.registry.groupJoinTransactions().length, 0);
});

test('login deletion refuses pending handover and departure participation without publishing an intent', async t => {
  const h = await fixture(t), { f } = h, owner = await f.registry.firstLogin('google', 'pending-owner'), player = await f.registry.firstLogin('google', 'pending-player');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id); await f.join(invite, player.account, { characterId: player.character.id });
  const offer = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), targetCharacterId: player.character.id });
  for (const login of [owner, player]) await assert.rejects(begin(f, login, selection('account')), /lifecycle change is pending/);
  await f.registry.resolveGroupHandover(owner.account.id, owner.character.id, owner.picker.id, offer.id, 'cancel');
  await f.registry.beginDeparture(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), characterId: player.character.id });
  const bytes = await h.bytes();
  for (const login of [owner, player]) await assert.rejects(begin(f, login, selection('account')), /lifecycle change is pending/);
  assert.deepEqual(await h.bytes(), bytes); assert.equal(f.registry.deletionTransactions().length, 0);
  await h.restart(); await h.f.departures.recover();
  assert.ok(h.f.registry.getAccount(player.account.id)); assert.equal(h.f.registry.departureTransactions().length, 0);
});

test('slot retirement reservations survive restart and fence other departures, moves, deletions and operator retirement', async t => {
  const options = { caps: {} }, h = await fixture(t, options), groups = [], players = [];
  for (const suffix of ['a', 'b']) {
    const owner = await h.f.registry.firstLogin('google', 'slot-owner-' + suffix), player = await h.f.registry.firstLogin('google', 'slot-player-' + suffix);
    const invite = await h.f.registry.createGroupInvite(owner.account.id, owner.picker.id); await h.f.join(invite, player.account, { characterId: player.character.id });
    groups.push(owner); players.push(player);
  }
  const ledger = JSON.parse(await readFile(path.join(h.f.options.tombstoneDir, 'ledger.json')));
  options.caps.retiredSlots = ledger.slots.length + 1;
  await h.restart();
  const intent = await h.f.registry.beginDeparture(players[0].account.id, players[0].character.id, groups[0].picker.id, { requestId: randomUUID(), characterId: players[0].character.id });
  await h.restart();
  const f = h.f, second = players[1], destination = groups[1], solo = await f.registry.firstLogin('google', 'slot-moving-solo');
  const invite = await f.registry.createGroupInvite(destination.account.id, destination.picker.id), bytes = await h.bytes();
  for (const remove of [false, true]) await assert.rejects(f.registry.beginDeparture(remove ? destination.account.id : second.account.id, remove ? destination.character.id : second.character.id, destination.picker.id,
    { requestId: randomUUID(), characterId: second.character.id }), /retired slot history limit/);
  await assert.rejects(f.registry.beginGroupJoin(invite.secret, solo.account.id, { characterId: solo.character.id }), /retired slot history limit/);
  await assert.rejects(begin(f, second, selection('account')), /retired slot history limit/);
  await assert.rejects(f.registry.deleteAccount(second.account.id), /retired slot history limit/);
  assert.deepEqual(await h.bytes(), bytes); assert.equal(f.registry.pickerAdmissionPending(destination.picker.id), false);
  await f.departures.recover(); assert.ok(f.registry.getDeparture(intent.id).completedAt);
  await h.restart(); assert.ok(h.f.registry.selectCharacter(second.account.id, second.character.id));
});

test('a pending existing-character invitation reserves its retired source slot against another move', async t => {
  const options = { caps: { retiredSlots: 1 } }, h = await fixture(t, options), { f } = h;
  const owners = [], players = [];
  for (const suffix of ['a', 'b']) { owners.push(await f.registry.firstLogin('google', 'invite-owner-' + suffix)); players.push(await f.registry.firstLogin('google', 'invite-player-' + suffix)); }
  const invites = [];
  for (const owner of owners) invites.push(await f.registry.createGroupInvite(owner.account.id, owner.picker.id));
  await f.registry.beginGroupJoin(invites[0].secret, players[0].account.id, { characterId: players[0].character.id });
  const before = await h.bytes();
  await assert.rejects(f.registry.beginGroupJoin(invites[1].secret, players[1].account.id, { characterId: players[1].character.id }), /retired slot history limit/);
  assert.deepEqual(await h.bytes(), before);
  await h.restart(); await h.f.service.recover();
  assert.equal(h.f.registry.getCharacter(players[0].character.id).placement.pickerId, owners[0].picker.id);
});
