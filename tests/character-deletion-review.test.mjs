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
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual((await h.f.open(owner.picker.id)).store.getReadState(), state);
  assert.equal(h.f.registry.pickerAdmissionPending(owner.picker.id), false);
  await h.restart(); await service(h.f).recover(); assert.ok(h.f.registry.selectCharacter(p.account.id, p.character.id));
});
