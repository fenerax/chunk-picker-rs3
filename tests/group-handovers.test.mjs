// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { HANDOVER_POINTS, validateHandovers } from '../app/storage/group-handovers.mjs';
import { registryRecoveryDocument } from '../app/storage/registry.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { stage2RegistryVersionGate } from './fixtures/registry-v3-version-gate.mjs';

async function fixture(t, extra) {
  const root = await mkdtemp(path.join(tmpdir(), 'group-handovers-'));
  let f = await inviteFixture(root, extra);
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  return { root, get f() { return f; }, async restart(extra) { await f.close(); f = await inviteFixture(root, extra); return f; } };
}
const doc = f => readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8').then(JSON.parse);
const propose = (f, owner, target, requestId = randomUUID()) => f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId, targetCharacterId: target.id });
const resolve = (f, player, pickerId, id, action) => f.registry.resolveGroupHandover(player.account.id, player.character.id, pickerId, id, action);

async function roster(f, size, sameLogin = false) {
  const owner = await f.registry.firstLogin('google', 'owner'), players = [];
  for (let n = 1; n < size; n++) {
    const player = sameLogin ? owner : await f.registry.firstLogin('google', `player-${n}`);
    const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
    const joined = await f.join(invite, player.account, sameLogin ? {} : { characterId: player.character.id });
    players.push({ ...player, character: f.registry.getCharacter(joined.character.id) });
  }
  return { owner, players };
}

test('solo has no successor; invalid target, viewer and legacy requests preserve ownership and formats', async t => {
  const { f } = await fixture(t), { owner } = await roster(f, 1), outsider = await f.registry.firstLogin('google', 'outsider');
  const before = await doc(f);
  await assert.rejects(propose(f, owner, owner.character), /another existing/);
  await assert.rejects(propose(f, owner, outsider.character), { status: 403 });
  await assert.rejects(propose(f, owner, { id: 'not-a-character' }), { status: 400 });
  assert.deepEqual(await doc(f), before);
  assert.deepEqual(f.registry.listGroupHandovers(owner.account.id, owner.character.id, owner.picker.id).candidates, []);
  const legacy = await f.registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [1, 2].map(n => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, identities: [{ provider: 'discord', subject: String(n) }], memberships: [{ role: 'player', memberId: n === 1 ? 'one' : 'two' }] })) });
  const member = f.registry.listCharacters('00000000-0000-4000-8000-000000000001')[0];
  await assert.rejects(f.registry.proposeGroupHandover(member.accountId, member.id, legacy.id, { requestId: randomUUID(), targetCharacterId: owner.character.id }), { status: 403 });
  assert.equal(f.registry.getPicker(legacy.id).ownerCharacterId, null);
});

for (const size of [2, 3, 4, 5]) for (const sameLogin of [false, true]) test(`handover preserves roster ${size}, maps, seats, IDs and exact capabilities (${sameLogin ? 'same' : 'other'} login)`, async t => {
  const h = await fixture(t), f = h.f, { owner, players } = await roster(f, size, sameLogin), player = players[0];
  const store = (await f.open(owner.picker.id)).store;
  await store.command({ type: 'set-journal', memberId: owner.character.placement.memberId, note: 'Synthetic retained history' }, store.getInfo().revision);
  await f.registry.setCapability({ kind: 'plugin-key', hash: 'a'.repeat(64), pickerId: owner.picker.id, accountId: owner.account.id, memberId: owner.character.placement.memberId });
  const pending = size < 5 ? await f.registry.createGroupInvite(owner.account.id, owner.picker.id) : null;
  const before = await doc(f), state = store.getCalculationSnapshot().readState, bytes = await readFile(path.join(f.registry.pickerDirectory(owner.picker.id), 'state.json'));
  const requestId = randomUUID(), proposal = await propose(f, owner, player.character, requestId);
  assert.equal(proposal.status, sameLogin ? 'accepted' : 'pending');
  if (!sameLogin) {
    assert.equal(f.registry.getPicker(owner.picker.id).ownerCharacterId, owner.character.id);
    if (pending) assert.equal(f.registry.previewGroupInvite(pending.secret).status, 'pending');
    await assert.rejects(resolve(f, owner, owner.picker.id, proposal.id, 'accept'), { status: 403 });
    await resolve(f, player, owner.picker.id, proposal.id, 'accept');
  }
  assert.deepEqual(await propose(f, owner, player.character, requestId), { ...proposal, status: 'accepted' });
  assert.equal((await resolve(f, player, owner.picker.id, proposal.id, 'accept')).status, 'accepted');
  const after = await doc(f), p = f.registry.getPicker(owner.picker.id);
  assert.equal(after.schemaVersion, 4); assert.equal(p.ownerCharacterId, player.character.id); assert.equal(p.ownerAccountId, player.account.id);
  assert.deepEqual(p.seats, before.pickers.find(p => p.id === owner.picker.id).seats);
  assert.deepEqual(after.characters, before.characters); assert.deepEqual(after.capabilities, before.capabilities);
  assert.equal(after.accounts.flatMap(a => a.memberships).filter(m => m.pickerId === p.id && m.role === 'owner').length, 1);
  assert.equal(f.registry.listCharacters(owner.account.id).find(c => c.id === owner.character.id).role, 'player');
  assert.deepEqual(store.getCalculationSnapshot().readState, state); assert.deepEqual(await readFile(path.join(f.registry.pickerDirectory(p.id), 'state.json')), bytes);
  if (!sameLogin) assert.equal(f.registry.getAccount(owner.account.id).defaultPickerId, null);
  assert.equal(f.registry.getAccount(player.account.id).defaultPickerId, p.id);
  if (pending) { assert.equal(f.registry.previewGroupInvite(pending.secret).status, 'revoked'); assert.equal(p.reservations.length, 0); }
  await assert.rejects(f.registry.createGroupInvite(owner.account.id, p.id, undefined, owner.character.id), { status: 403 });
  if (size < 5) await f.registry.createGroupInvite(player.account.id, p.id, undefined, player.character.id);
  await assert.rejects(propose(f, owner, players.at(-1).character), { status: 403 });
  await h.restart(); assert.equal(h.f.registry.getPicker(p.id).ownerCharacterId, player.character.id);
  assert.equal((await resolve(h.f, player, p.id, proposal.id, 'accept')).status, 'accepted');
});

test('cancel/decline and competing successors have one winner, durable retry receipts and unchanged authority', async t => {
  const h = await fixture(t), f = h.f, { owner, players } = await roster(f, 3), [a, b] = players;
  const attempts = await Promise.allSettled(players.map(p => propose(f, owner, p.character)));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  const pending = attempts[0].value;
  await assert.rejects(resolve(f, b, owner.picker.id, pending.id, 'decline'), { status: 403 });
  await resolve(f, a, owner.picker.id, pending.id, 'decline');
  await h.restart(); assert.equal((await resolve(h.f, a, owner.picker.id, pending.id, 'decline')).status, 'declined');
  await assert.rejects(resolve(h.f, a, owner.picker.id, pending.id, 'accept'), /already declined/);
  const next = await propose(h.f, owner, b.character);
  const race = await Promise.allSettled([resolve(h.f, owner, owner.picker.id, next.id, 'cancel'), resolve(h.f, b, owner.picker.id, next.id, 'accept')]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await resolve(h.f, owner, owner.picker.id, next.id, 'cancel')).status, 'cancelled');
  assert.equal(h.f.registry.getPicker(owner.picker.id).ownerCharacterId, owner.character.id);
});

test('accept against accept and accept against cancellation serialize to one terminal result', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2), h = await propose(f, owner, player.character);
  const results = await Promise.all([resolve(f, player, owner.picker.id, h.id, 'accept'), resolve(f, player, owner.picker.id, h.id, 'accept')]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(resolve(f, owner, owner.picker.id, h.id, 'cancel'), /already accepted/);
  assert.equal(f.registry.getPicker(owner.picker.id).ownerCharacterId, player.character.id);
});

test('accepted admissions must finish before handover; another owned default is never replaced', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  const extra = await f.registry.addCharacter(player.account.id, { requestId: 'separate-solo' });
  // The first solo retired during admission; designate this existing owned one
  // as its default, just as subsequent firstLogin does through creation.
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  const transaction = await f.registry.beginGroupJoin(invite.secret, owner.account.id, {});
  await assert.rejects(propose(f, owner, player.character), /admission is completing/);
  await f.service.recover();
  assert.equal(f.registry.getCharacter(transaction.acceptingCharacterId).placement.pickerId, owner.picker.id);
  const proposal = await propose(f, owner, player.character);
  await resolve(f, player, owner.picker.id, proposal.id, 'accept');
  assert.equal(f.registry.getAccount(player.account.id).defaultPickerId, extra.picker.id);
});

test('v3 migration retains preimage, gameplay and the legacy picker; sanitized restore cannot revive a pending offer', async t => {
  const h = await fixture(t), f = h.f, { owner, players: [player] } = await roster(f, 2);
  const legacy = await f.registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [1, 2].map(n => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, identities: [{ provider: 'discord', subject: String(n) }], memberships: [{ role: 'player', memberId: n === 1 ? 'one' : 'two' }] })) });
  const gameplay = JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1, state: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]) });
  await writeFile(path.join(f.options.legacyDir, 'state.json'), gameplay);
  const old = await readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8'), ledger = await readFile(path.join(f.options.tombstoneDir, 'ledger.json'), 'utf8');
  const offer = await propose(f, owner, player.character);
  assert.equal(await readFile(path.join(f.options.registryDir, 'registry.pre-handovers-v3.json'), 'utf8'), old);
  assert.equal(await readFile(path.join(f.options.tombstoneDir, 'ledger.json'), 'utf8'), ledger);
  const saved = await doc(f); assert.throws(() => stage2RegistryVersionGate(saved), /Unsupported newer registry/);
  for (const edit of [d => { delete d.handovers; }, d => { d.handovers[0].status = 'unknown'; }, d => { d.handovers.push(d.handovers[0]); }]) {
    const corrupt = structuredClone(saved); edit(corrupt); assert.throws(() => validateHandovers(corrupt), /Invalid ownership/);
  }
  const recovered = registryRecoveryDocument(saved); assert.equal(recovered.handovers[0].status, 'cancelled');
  assert.equal(recovered.accounts.every(a => a.identities.length === 0), true);
  await f.close(); await writeFile(path.join(f.options.registryDir, 'registry.json'), JSON.stringify(recovered));
  const restored = await h.restart();
  await assert.rejects(resolve(restored, player, owner.picker.id, offer.id, 'accept'), /already cancelled/);
  assert.equal(restored.registry.getPicker(legacy.id).ownerCharacterId, null); assert.equal(restored.registry.getPicker(legacy.id).seats.length, 2);
  assert.equal(await readFile(path.join(f.options.legacyDir, 'state.json'), 'utf8'), gameplay);
  assert.equal(restored.registry.getPicker(owner.picker.id).ownerCharacterId, owner.character.id);
});

test('damaged migration preimage refuses upgrade before a proposal or role change', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2), before = await doc(f);
  await writeFile(path.join(f.options.registryDir, 'registry.pre-handovers-v3.json'), 'damaged');
  await assert.rejects(propose(f, owner, player.character), /preimage differs/);
  assert.deepEqual(await doc(f), before);
});

test('stage-1 roster upgrades through v3 before direct same-login designation, retaining both preimages', async t => {
  const h = await fixture(t), f = h.f, owner = await f.registry.firstLogin('google', 'owner');
  await f.registry.reserveTransferMembers(owner.picker.id, ['owner', 'second']);
  await f.registry.attachMembership(owner.account.id, { pickerId: owner.picker.id, memberId: 'second', role: 'player' });
  const before = await readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8'); assert.equal(JSON.parse(before).schemaVersion, 2);
  const target = f.registry.listCharacters(owner.account.id).find(c => c.placement.memberId === 'second');
  assert.equal((await propose(f, owner, target)).status, 'accepted');
  assert.equal(await readFile(path.join(f.options.registryDir, 'registry.pre-invites-v2.json'), 'utf8'), before);
  const middle = JSON.parse(await readFile(path.join(f.options.registryDir, 'registry.pre-handovers-v3.json'), 'utf8'));
  assert.equal(middle.schemaVersion, 3); assert.deepEqual(middle.groupInvites, []);
  await h.restart(); assert.equal(h.f.registry.getPicker(owner.picker.id).ownerCharacterId, target.id);
});

test('handover expires elapsed offers without reviving them; checkpoint retains completed ownership and receipt', async t => {
  let at = Date.parse('2026-01-01T00:00:00Z');
  const { f } = await fixture(t, { now: () => at }), { owner, players: [player] } = await roster(f, 2);
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), offer = await propose(f, owner, player.character);
  at += 7 * 86400000;
  await resolve(f, player, owner.picker.id, offer.id, 'accept');
  assert.equal(f.registry.previewGroupInvite(invite.secret).status, 'expired');
  assert.equal(f.registry.getPicker(owner.picker.id).reservations.length, 0);
  const recovered = registryRecoveryDocument(await doc(f));
  assert.equal(recovered.handovers[0].status, 'accepted'); assert.equal(recovered.handovers[0].id, offer.id);
  assert.equal(recovered.pickers.find(p => p.id === owner.picker.id).ownerCharacterId, player.character.id);
});

for (const sameLogin of [false, true]) for (const seam of HANDOVER_POINTS.slice(0, 4)) test(`process crash/retry ${seam}, ${sameLogin ? 'designation' : 'proposal'}`, async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2, sameLogin), input = { requestId: randomUUID(), targetCharacterId: player.character.id };
  await h.f.close();
  await crash(h.root, seam, 'proposeGroupHandover', [owner.account.id, owner.character.id, owner.picker.id, input]);
  const f = await h.restart();
  const result = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, input);
  assert.equal(result.id, input.requestId); assert.equal(result.status, sameLogin ? 'accepted' : 'pending');
  assert.equal((await doc(f)).handovers.length, 1);
  assert.equal(f.registry.getPicker(owner.picker.id).ownerCharacterId, sameLogin ? player.character.id : owner.character.id);
});
for (const action of ['accept', 'decline', 'cancel']) for (const seam of HANDOVER_POINTS.slice(4)) test(`process crash/retry ${seam}, ${action}`, async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2), offer = await propose(h.f, owner, player.character), actor = action === 'cancel' ? owner : player;
  const args = [actor.account.id, actor.character.id, owner.picker.id, offer.id, action];
  await h.f.close(); await crash(h.root, seam, 'resolveGroupHandover', args);
  const f = await h.restart(), result = await f.registry.resolveGroupHandover(...args);
  assert.equal(result.status, { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action]);
  assert.equal((await doc(f)).handovers.length, 1);
  assert.equal(f.registry.getPicker(owner.picker.id).ownerCharacterId, action === 'accept' ? player.character.id : owner.character.id);
});

async function crash(root, seam, method, args) {
  const url = new URL('./helpers/owner-invite-fixture.mjs', import.meta.url).href;
  const script = `import { inviteFixture } from ${JSON.stringify(url)}; const [root,seam,method,args]=JSON.parse(process.argv[1]); const f=await inviteFixture(root,{crashPoint(name){if(name===seam)process.exit(86);}}); await f.registry[method](...args); await f.close();`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([root, seam, method, args])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 86, result.output);
}
