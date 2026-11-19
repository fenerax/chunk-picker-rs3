// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { DEPARTURE_POINTS, validateDepartures } from '../app/storage/group-departures.mjs';
import { registryRecoveryDocument } from '../app/storage/registry.mjs';
import { validateState } from '../app/core/state.mjs';
import { mapTransferRoster } from '../app/save-transfer.mjs';

async function fixture(t, options) {
  const root = await mkdtemp(path.join(tmpdir(), 'group-departures-')); let f = await inviteFixture(root, options);
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  return { root, get f() { return f; }, async restart(options, edit) { await f.close(); await edit?.(); f = await inviteFixture(root, options); return f; } };
}
const doc = f => readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8').then(JSON.parse);
test('recovery completes an older pending departure with an imported invalid actor label', async t => {
  const validation = { prepareState: state => validateState(state) };
  const h = await fixture(t, validation), { owner, players: [player] } = await roster(h.f, 2), pickerId = owner.picker.id;
  const context = await h.f.open(pickerId), backup = await context.store.backup(), name = '  ' + 'Imported display name '.repeat(7) + '  ';
  backup.state.members.find(m => m.id === player.character.placement.memberId).name = name;
  await context.store.replace(backup.state, context.store.getInfo().revision);
  const input = { requestId: randomUUID(), characterId: player.character.id, revision: context.store.getInfo().revision };
  // Persist the same intent an older release leaves behind before attempting
  // to build its invalid actor. No new transaction fields or migration needed.
  const intent = await h.f.registry.beginDeparture(player.account.id, player.character.id, pickerId, input);
  await h.f.registry.prepareDeparture(intent.id); await h.f.open(intent.destination.pickerId);
  await h.f.registry.capturePastMap({ id: intent.id, accountId: intent.accountId, characterId: intent.characterId, pickerId, memberId: intent.source.memberId, reason: intent.reason, createdAt: intent.createdAt }, await context.store.backup());
  await h.restart(validation); await h.f.departures.recover();
  assert.ok(h.f.registry.getDeparture(input.requestId).completedAt);
  assert.equal(h.f.registry.getCharacter(player.character.id).placement.pickerId, intent.destination.pickerId);
  assert.equal((await h.f.registry.readPastMap(player.account.id, input.requestId)).document.state.members.find(m => m.id === intent.source.memberId).name, name);
  assert.match((await h.f.departures.depart(player.account.id, player.character.id, pickerId, input)).message, /Left/);
  await h.restart(validation);
  const recovered = (await h.f.open(pickerId)).store.getReadState();
  assert.doesNotThrow(() => validateState(recovered));
  assert.ok(recovered.history.find(e => e.type === 'member-departed').actor.label.length <= 80);
});
async function roster(f, size) {
  const owner = await f.registry.firstLogin('google', 'owner'), players = [];
  for (let n = 1; n < size; n++) {
    const p = await f.registry.firstLogin('google', 'player-' + n), invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
    await f.join(invite, p.account, { characterId: p.character.id }); p.character = f.registry.getCharacter(p.character.id); players.push(p);
  }
  return { owner, players };
}
async function leave(f, actor, target, pickerId, requestId = randomUUID()) {
  const review = await f.departures.review(actor.account.id, actor.character.id, pickerId);
  return f.departures.depart(actor.account.id, actor.character.id, pickerId, { requestId, characterId: target.character.id, revision: review.revision });
}

test('a pending admission into a departure solo excludes another outgoing join inside the registry queue', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  await leave(f, player, player, owner.picker.id);
  const solo = f.registry.getCharacter(player.character.id).placement.pickerId;
  const newcomer = await f.registry.firstLogin('google', 'incoming'), incoming = await f.registry.createGroupInvite(player.account.id, solo);
  const outgoing = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.registry.beginGroupJoin(incoming.secret, newcomer.account.id, { characterId: newcomer.character.id });
  const before = await doc(f);
  assert.equal(f.registry.groupJoinEligible(player.account.id, player.character.id), false);
  await assert.rejects(f.registry.beginGroupJoin(outgoing.secret, player.account.id, { characterId: player.character.id }), { status: 409 });
  assert.deepEqual(await doc(f), before);
  await f.service.recover();
  assert.equal(f.registry.getCharacter(newcomer.character.id).placement.pickerId, solo);
});

for (const incomingFirst of [false, true]) test(`concurrent admission and rejoin have one registry winner (incoming first: ${incomingFirst})`, async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  await leave(f, player, player, owner.picker.id);
  const solo = f.registry.getCharacter(player.character.id).placement.pickerId;
  const newcomer = await f.registry.firstLogin('google', 'incoming'), incoming = await f.registry.createGroupInvite(player.account.id, solo);
  const outgoing = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  const admit = () => f.registry.beginGroupJoin(incoming.secret, newcomer.account.id, { characterId: newcomer.character.id });
  const move = () => f.registry.beginGroupJoin(outgoing.secret, player.account.id, { characterId: player.character.id });
  const attempts = await Promise.allSettled((incomingFirst ? [admit, move] : [move, admit]).map(work => work()));
  assert.equal(attempts[0].status, 'fulfilled'); assert.equal(attempts[1].status, 'rejected');
  assert.equal(f.registry.groupJoinTransactions().length, 1);
  await f.service.recover();
  assert.equal(f.registry.getCharacter(player.character.id).placement.pickerId, incomingFirst ? solo : owner.picker.id);
  assert.equal(f.registry.getCharacter(newcomer.character.id).placement.pickerId, incomingFirst ? solo : newcomer.picker.id);
  for (const p of (await doc(f)).pickers) assert.ok(p.seats.length + p.reservations.length <= 5);
});

for (const installed of [false, true]) for (const incomingComplete of [false, true]) for (const seam of [null, ...(installed ? ['departure-roster-prepared'] : []), 'invite-conflict-roster', 'departure-keys', 'departure-overlays', 'departure-sessions', 'invite-conflict-cancelled']) test(`recovery reconciles older overlapping intents (roster ${installed}, incoming complete ${incomingComplete}, interruption ${seam})`, async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2), f = h.f;
  await leave(f, player, player, owner.picker.id);
  const solo = f.registry.getCharacter(player.character.id).placement.pickerId;
  const newcomer = await f.registry.firstLogin('google', 'incoming'), incoming = await f.registry.createGroupInvite(player.account.id, solo);
  const outgoing = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.registry.beginGroupJoin(incoming.secret, newcomer.account.id, { characterId: newcomer.character.id });
  // Reproduce the durable document an older build published without the guard.
  if (installed) await f.registry.capturePastMap({ id: outgoing.id, accountId: player.account.id, characterId: player.character.id,
    pickerId: solo, memberId: 'owner', reason: 'rejoined', createdAt: outgoing.createdAt }, await (await f.open(solo)).store.backup());
  const old = await doc(f), i = old.groupInvites.find(i => i.id === outgoing.id), destination = old.pickers.find(p => p.id === i.pickerId);
  i.status = 'accepted'; i.terminalAt = i.createdAt; i.acceptingAccountId = player.account.id; i.acceptingCharacterId = player.character.id;
  i.transaction = { source: { pickerId: solo, memberId: 'owner' }, newCharacter: false, memberId: 'm_' + randomUUID().replaceAll('-', ''), runescapeName: null, pastMapId: i.id };
  destination.memberIds.push(i.transaction.memberId);
  if (installed) await (await f.open(destination.id)).store.installInvitedMember({ ...i.transaction, templateMemberId: 'owner' });
  let armed = false;
  await h.restart({ crashPoint(name) { if (armed && name === seam) { armed = false; throw new Error('Synthetic conflict recovery interruption'); } } },
    () => writeFile(path.join(f.options.registryDir, 'registry.json'), JSON.stringify(old)));
  if (incomingComplete) {
    const incomingIntent = h.f.registry.groupJoinTransactions().find(i => i.id === incoming.id);
    await (await h.f.open(solo)).store.installInvitedMember({ ...incomingIntent.transaction, templateMemberId: 'owner' });
    await h.f.registry.finishGroupJoin(incoming.id);
  }
  if (seam) { armed = true; await assert.rejects(h.f.service.recover(), /Synthetic conflict recovery interruption/); await h.restart(); }
  await h.f.service.recover();
  assert.equal(h.f.registry.getCharacter(player.character.id).placement.pickerId, solo);
  assert.equal(h.f.registry.getCharacter(newcomer.character.id).placement.pickerId, solo);
  assert.equal(h.f.registry.getPicker(solo).ownerCharacterId, player.character.id);
  assert.equal(h.f.registry.groupJoinTransactions().length, 0);
  assert.equal((await doc(h.f)).groupInvites.find(i => i.id === outgoing.id).status, 'revoked');
  const remaining = (await h.f.open(destination.id)).store;
  assert.equal(remaining.getReadState().members.some(m => m.id === i.transaction.memberId), false);
  if (installed) assert.ok((await remaining.listBackups()).length);
  assert.equal(h.f.registry.listPastMaps(player.account.id).length, installed ? 2 : 1);
  await assert.rejects(h.f.join(outgoing, player.account, { characterId: player.character.id }), /revoked/);
  assert.equal((await h.f.join(incoming, newcomer.account, { characterId: newcomer.character.id })).message, 'Already joined');
  await h.restart(); await h.f.service.recover();
  assert.equal(h.f.registry.getPicker(solo).seats.length, 2);
});

for (const size of [2, 3, 4, 5]) test(`post-departure assigned tasks survive restore, import and roster remapping for roster ${size}`, async t => {
  const h = await fixture(t, size % 2 ? { prepareState: state => validateState(state) } : undefined), { owner, players } = await roster(h.f, size), player = players.at(-1), pickerId = owner.picker.id;
  const store = (await h.f.open(pickerId)).store, memberId = player.character.placement.memberId;
  await store.command({ type: 'add-task', task: { id: 'custom:historical', label: 'Former assignment', category: 'Custom', memberIds: [memberId] } }, store.getInfo().revision);
  await leave(h.f, player, player, pickerId);
  const backup = await store.backup();
  await store.replace(backup, store.getInfo().revision);
  await store.replace(await store.backup(), store.getInfo().revision);
  await store.command({ type: 'update-task', taskId: 'custom:historical', task: { label: 'Reassigned temporarily', memberIds: ['owner'] } }, store.getInfo().revision);
  await store.command({ type: 'undo' }, store.getInfo().revision);
  const restored = (await store.backup()).state;
  assert.deepEqual(restored.tasks.find(t => t.id === 'custom:historical').memberIds, [memberId]);
  assert.doesNotThrow(() => validateState(restored));
  const collision = Object.fromEntries(restored.members.map((m, n) => [m.id, n ? 'new' + n : memberId]));
  assert.throws(() => mapTransferRoster(restored, restored.members.map((m, n) => ({ id: n ? 'new' + n : memberId })), collision), /historical departed member/);
  const mapping = Object.fromEntries(restored.members.map((m, n) => [m.id, 'new' + n]));
  const mapped = mapTransferRoster(restored, restored.members.map((m, n) => ({ id: 'new' + n, name: m.name })), mapping);
  assert.doesNotThrow(() => validateState(mapped));
  const imported = await h.f.registry.firstLogin('google', 'import-target'), importedStore = (await h.f.open(imported.picker.id)).store;
  await importedStore.replace(mapped, importedStore.getInfo().revision);
  await h.restart();
  assert.deepEqual((await h.f.open(imported.picker.id)).store.getReadState().tasks.find(t => t.id === 'custom:historical').memberIds, [memberId]);
});

test('handover and rejoin use canonical registry names while preserving imported display names', async t => {
  const { f } = await fixture(t, { prepareState: state => validateState(state) }), { owner, players: [player] } = await roster(f, 2), pickerId = owner.picker.id;
  const source = (await f.open(pickerId)).store, saved = await source.backup();
  saved.state.members.find(m => m.id === 'owner').name = '\u0000';
  const long = '  ' + 'Restored successor '.repeat(8) + '  ';
  saved.state.members.find(m => m.id === player.character.placement.memberId).name = long;
  await source.replace(saved.state, source.getInfo().revision);
  const offer = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, pickerId, { requestId: randomUUID(), targetCharacterId: player.character.id });
  await f.registry.resolveGroupHandover(player.account.id, player.character.id, pickerId, offer.id, 'accept');
  await leave(f, owner, owner, pickerId);
  assert.equal(source.getReadState().history.at(-1).actor.label, 'Departed character');
  const invite = await f.registry.createGroupInvite(player.account.id, pickerId);
  await f.join(invite, owner.account, { characterId: owner.character.id });
  const current = source.getReadState(); assert.doesNotThrow(() => validateState(current));
  assert.equal(current.members.find(m => m.id === player.character.placement.memberId).name, long);
  assert.equal(f.registry.getCharacter(owner.character.id).runescapeName, null);
  const retained = f.registry.listPastMaps(owner.account.id).find(m => m.reason === 'left');
  assert.equal((await f.registry.readPastMap(owner.account.id, retained.id)).document.state.members.find(m => m.id === 'owner').name, '\u0000');
});

test('solo and legacy departure refuse without allocating groups, fencing data or creating Past maps', async t => {
  const { f } = await fixture(t), { owner } = await roster(f, 1), before = await doc(f);
  await assert.rejects(leave(f, owner, owner, owner.picker.id), /handover|solo/);
  assert.deepEqual(await doc(f), before); assert.deepEqual(f.registry.listPastMaps(owner.account.id), []);
  const legacy = await f.registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [1, 2].map(n => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, identities: [{ provider: 'discord', subject: String(n) }], memberships: [{ role: 'player', memberId: n === 1 ? 'one' : 'two' }] })) });
  const member = f.registry.listCharacters('00000000-0000-4000-8000-000000000001')[0], saved = await doc(f);
  await assert.rejects(f.departures.review(member.accountId, member.id, legacy.id), /legacy/);
  await assert.rejects(f.registry.beginDeparture(member.accountId, member.id, legacy.id, { requestId: randomUUID(), characterId: member.id }), { status: 403 });
  assert.deepEqual(await doc(f), saved);
});

test('one same-login character leaves after designation without changing its other character authority', async t => {
  const { f } = await fixture(t), { owner } = await roster(f, 1), p = owner.picker.id;
  const invite = await f.registry.createGroupInvite(owner.account.id, p);
  await f.join(invite, owner.account, {});
  const other = f.registry.listCharacters(owner.account.id).find(c => c.id !== owner.character.id);
  await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, p, { requestId: randomUUID(), targetCharacterId: other.id });
  await leave(f, owner, owner, p);
  assert.equal(f.registry.getPicker(p).ownerCharacterId, other.id);
  assert.equal(f.registry.selectCharacter(owner.account.id, other.id, p).id, other.id);
  await f.registry.createGroupInvite(owner.account.id, p, undefined, other.id);
  assert.equal(f.registry.listCharacters(owner.account.id).length, 2);
});

test('concurrent fresh invitations compete for one returned solo placement', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2), p = owner.picker.id;
  await leave(f, player, player, p);
  const other = await f.registry.firstLogin('google', 'other-destination');
  const offers = await Promise.all([p, other.picker.id].map((id, n) => f.registry.createGroupInvite(n ? other.account.id : owner.account.id, id)));
  const reviews = await Promise.all(offers.map(i => f.service.review(i.secret, player.account.id)));
  const attempts = await Promise.allSettled(offers.map((i, n) => f.service.accept(i.secret, player.account.id, { characterId: player.character.id }, reviews[n].review.revision)));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.registry.listPastMaps(player.account.id).length, 2);
  const d = await doc(f);
  assert.equal(d.pickers.flatMap(p => p.seats).filter(s => s.characterId === player.character.id).length, 1);
  for (const p of d.pickers) assert.ok(p.seats.length + p.reservations.length <= 5);
});

test('compacted History retains departed attribution through restart, export and further Undo', async t => {
  const h = await fixture(t, { retention: { historyEntries: 2 } }), { owner, players: [player] } = await roster(h.f, 2), p = owner.picker.id;
  const store = (await h.f.open(p)).store;
  await store.command({ type: 'add-group-goal', goalId: 'group-goal:epoch', text: 'Every current player', completion: 'players' }, store.getInfo().revision);
  await store.command({ type: 'set-group-goal-done', goalId: 'group-goal:epoch', done: true }, store.getInfo().revision);
  await store.command({ type: 'set-journal', memberId: player.character.placement.memberId, note: 'Historical player' }, store.getInfo().revision);
  await leave(h.f, player, player, p);
  for (const done of [false, true]) await store.command({ type: 'set-group-goal-done', goalId: 'group-goal:epoch', memberId: 'owner', done }, store.getInfo().revision);
  for (let n = 0; n < 8; n++) await store.command({ type: 'set-journal', memberId: 'owner', note: String(n) }, store.getInfo().revision);
  assert.ok(store.getReadState().history.some(e => e.type === 'member-departed'));
  assert.ok(store.getReadState().provenance.historyArchive.length);
  const backup = await store.backup(); assert.doesNotThrow(() => validateState(backup.state));
  assert.ok(backup.state.history.some(e => e.command?.note === 'Historical player'));
  await h.restart({ retention: { historyEntries: 2 } });
  const reopened = (await h.f.open(p)).store;
  assert.deepEqual(await reopened.backup(), backup);
  await reopened.command({ type: 'undo' }, reopened.getInfo().revision);
  assert.equal(reopened.getReadState().members[0].journal, '6');
});

for (const size of [2, 3, 4, 5]) for (const removed of [false, true]) test(`${removed ? 'owner removal' : 'leave'} for roster ${size} retains history and snapshot, frees one seat and is idempotent`, async t => {
  const h = await fixture(t), f = h.f, { owner, players: [player] } = await roster(f, size), pickerId = owner.picker.id;
  const source = await f.open(pickerId), memberId = player.character.placement.memberId;
  await source.store.command({ type: 'set-journal', memberId, note: 'Synthetic saved journal' }, source.store.getInfo().revision);
  await source.store.command({ type: 'add-task', task: { id: 'personal:kept', label: 'Saved personal goal', category: 'Custom', memberIds: [memberId] } }, source.store.getInfo().revision);
  const frozen = await source.store.backup(), count = (await doc(f)).characters.length;
  await f.registry.setCapability({ kind: 'plugin-key', hash: 'b'.repeat(64), pickerId, accountId: player.account.id, memberId });
  await f.registry.setCapability({ kind: 'plugin-key', hash: 'a'.repeat(64), pickerId, accountId: owner.account.id, memberId: 'owner' });
  const actor = removed ? owner : player, review = await f.departures.review(actor.account.id, actor.character.id, pickerId);
  const input = { requestId: randomUUID(), characterId: player.character.id, revision: review.revision };
  const result = await f.departures.depart(actor.account.id, actor.character.id, pickerId, input);
  assert.match(result.message, removed ? /removed/ : /Left group/);
  assert.deepEqual(await f.departures.depart(actor.account.id, actor.character.id, pickerId, input), result);
  const c = f.registry.getCharacter(player.character.id), solo = f.registry.getPicker(c.placement.pickerId);
  assert.notEqual(solo.id, pickerId); assert.equal(solo.ownerCharacterId, c.id); assert.equal(solo.seats.length, 1);
  assert.equal((await f.open(solo.id)).store.getCalculationSnapshot().readState.members[0].unlocked.length, 0);
  assert.equal(f.registry.getPicker(pickerId).seats.length, size - 1); assert.equal((await doc(f)).characters.length, count);
  assert.equal(f.registry.resolveCapability('plugin-key', 'b'.repeat(64)), null); assert.ok(f.registry.resolveCapability('plugin-key', 'a'.repeat(64)));
  const past = f.registry.listPastMaps(player.account.id); assert.equal(past.length, 1); assert.equal(past[0].reason, removed ? 'removed' : 'left');
  const saved = await f.registry.readPastMap(player.account.id, past[0].id); assert.deepEqual(saved.document, frozen);
  assert.equal(f.registry.listPastMaps(owner.account.id).length, 0); await assert.rejects(f.registry.readPastMap(owner.account.id, past[0].id), { status: 404 });
  const current = source.store.getReadState();
  assert.equal(current.members.length, size - 1); assert.equal(current.members.some(m => m.id === memberId), false);
  assert.deepEqual(current.history.slice(0, -1), frozen.state.history); assert.equal(current.history.at(-1).type, 'member-departed');
  assert.doesNotThrow(() => validateState(current));
  assert.equal(source.store.getUndoEligibility().canUndo, false);
  await assert.rejects(source.store.command({ type: 'undo', undoRevision: frozen.state.history[0].revision }, current.revision), /past roster/);
  await source.store.command({ type: 'set-journal', memberId: 'owner', note: 'Remaining group continues' }, current.revision);
  await source.store.command({ type: 'undo' }, source.store.getInfo().revision);
  await f.registry.createGroupInvite(owner.account.id, pickerId);
  await h.restart(); assert.equal(h.f.registry.getCharacter(c.id).placement.pickerId, solo.id);
  assert.deepEqual((await h.f.registry.readPastMap(player.account.id, past[0].id)).document, frozen);
});

test('owner must hand over first, then can leave; exact same-login owner character stays designated', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  await assert.rejects(leave(f, owner, owner, owner.picker.id), /handover/);
  const offer = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), targetCharacterId: player.character.id });
  await f.registry.resolveGroupHandover(player.account.id, player.character.id, owner.picker.id, offer.id, 'accept');
  await leave(f, owner, owner, owner.picker.id);
  assert.equal(f.registry.getPicker(owner.picker.id).ownerCharacterId, player.character.id);
});

for (const size of [2, 3, 4, 5]) test(`fresh invite rejoin at roster ${size} uses a new slot, preserves solo history and rejects the old consumed offer`, async t => {
  const h = await fixture(t), f = h.f, { owner, players: [player] } = await roster(f, size), old = player.character.placement;
  await leave(f, player, player, owner.picker.id);
  const solo = f.registry.getCharacter(player.character.id).placement, soloStore = (await f.open(solo.pickerId)).store;
  await soloStore.command({ type: 'set-journal', memberId: 'owner', note: 'Solo progress is kept, never merged' }, 0);
  const frozen = await soloStore.backup();
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), review = await f.service.review(invite.secret, player.account.id);
  assert.equal(review.characters[0].eligible, true); assert.equal(review.characters[0].rejoining, true);
  await f.join(invite, player.account, { characterId: player.character.id });
  const c = f.registry.getCharacter(player.character.id); assert.equal(c.placement.pickerId, owner.picker.id); assert.notEqual(c.placement.memberId, old.memberId);
  const joined = (await f.open(owner.picker.id)).store.getCalculationSnapshot().readState.members.find(m => m.id === c.placement.memberId);
  assert.equal(joined.journal, undefined); assert.equal(f.registry.getPicker(solo.pickerId).lifecycle, 'retired');
  const maps = f.registry.listPastMaps(player.account.id); assert.equal(maps.length, 2); assert.deepEqual((await f.registry.readPastMap(player.account.id, invite.id)).document, frozen);
  assert.equal((await f.join(invite, player.account, { characterId: c.id })).message, 'Already joined');
  await leave(f, player, player, owner.picker.id);
  await assert.rejects(f.join(invite, player.account, { characterId: c.id }), /fresh|already|unavailable|joined/);
  assert.equal(f.registry.getCharacter(c.id).placement.pickerId === owner.picker.id, false);
  await h.restart(); assert.equal(h.f.registry.listPastMaps(player.account.id).length, 3);
});

test('a request cannot reuse an invitation/Past map ID, and backup capture refuses new placement changes before intent', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2), p = owner.picker.id;
  const invite = await f.registry.createGroupInvite(owner.account.id, p), review = await f.departures.review(player.account.id, player.character.id, p);
  const input = { requestId: invite.id, characterId: player.character.id, revision: review.revision };
  await assert.rejects(f.departures.depart(player.account.id, player.character.id, p, input), /already used/);
  await f.registry.withLifecycleCapture(async () => {
    await assert.rejects(f.departures.depart(player.account.id, player.character.id, p, { ...input, requestId: randomUUID() }), /backup is in progress/);
    assert.equal(f.registry.getCharacter(player.character.id).placement.pickerId, p);
  });
});

test('quota and changed-review refusals preserve placement; concurrent requests have one allocation and winner', async t => {
  const h = await fixture(t), f = h.f, { owner, players: [player] } = await roster(f, 2), p = owner.picker.id;
  const review = await f.departures.review(player.account.id, player.character.id, p);
  await (await f.open(p)).store.command({ type: 'set-journal', memberId: 'owner', note: 'Changed' }, review.revision);
  await assert.rejects(f.departures.depart(player.account.id, player.character.id, p, { requestId: randomUUID(), characterId: player.character.id, revision: review.revision }), /changed/);
  const count = f.registry.listPickers().length; await h.restart({ caps: { pickers: count } });
  await assert.rejects(leave(h.f, player, player, p), /picker limit/); assert.equal(h.f.registry.pickerJoining(p), false);
  await h.restart(); const same = await h.f.departures.review(player.account.id, player.character.id, p);
  const attempts = await Promise.allSettled([1, 2].map(() => h.f.departures.depart(player.account.id, player.character.id, p, { requestId: randomUUID(), characterId: player.character.id, revision: same.revision })));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.f.registry.listPickers().length, count + 1);
});

for (const removed of [false, true]) for (const seam of DEPARTURE_POINTS) test(`process crash/retry at ${seam} (${removed ? 'remove' : 'leave'}) preserves snapshot, ID and placement`, async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2), actor = removed ? owner : player;
  const p = owner.picker.id, review = await h.f.departures.review(actor.account.id, actor.character.id, p), input = { requestId: randomUUID(), characterId: player.character.id, revision: review.revision };
  await h.f.close(); await crash(h.root, seam, [actor.account.id, actor.character.id, p, input]);
  const f = await h.restart(), pending = f.registry.getDeparture(input.requestId), before = await doc(f); if (!pending.completedAt) assert.throws(() => registryRecoveryDocument(before), /Departure is pending/);
  await f.departures.recover();
  const result = await f.departures.depart(actor.account.id, actor.character.id, p, input);
  assert.match(result.message, removed ? /removed/ : /Left/);
  assert.equal(f.registry.listPastMaps(player.account.id).length, 1); assert.equal(f.registry.getPicker(p).seats.length, 1);
  assert.equal(f.registry.getCharacter(player.character.id).placement.pickerId, pending.destination.pickerId);
  const after = await doc(f); assert.doesNotThrow(() => validateDepartures(after));
});
for (const seam of ['invite-committed', 'departure-snapshot-file', 'departure-snapshot', 'departure-keys', 'departure-overlays', 'departure-sessions', 'rejoin-credentials', 'invite-roster-prepared', 'invite-roster', 'invite-placed']) test(`rejoin process crash/retry at ${seam} keeps one frozen solo and a fresh destination slot`, async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2), p = owner.picker.id;
  await leave(h.f, player, player, p);
  const solo = h.f.registry.getCharacter(player.character.id).placement;
  const source = (await h.f.open(solo.pickerId)).store;
  await source.command({ type: 'set-journal', memberId: 'owner', note: 'Before rejoin crash' }, 0); const frozen = await source.backup();
  const invite = await h.f.registry.createGroupInvite(owner.account.id, p), review = await h.f.service.review(invite.secret, player.account.id);
  await h.f.close(); await crash(h.root, seam, [invite.secret, player.account.id, { characterId: player.character.id }, review.review.revision], 'join');
  const f = await h.restart(); await f.departures.recover(); await f.service.recover();
  assert.equal((await f.join(invite, player.account, { characterId: player.character.id })).message, 'Already joined');
  assert.equal(f.registry.listPastMaps(player.account.id).length, 2);
  assert.deepEqual((await f.registry.readPastMap(player.account.id, invite.id)).document, frozen);
  assert.equal(f.registry.getCharacter(player.character.id).placement.pickerId, p);
});
async function crash(root, seam, args, action = 'leave') {
  const file = new URL('./fixtures/departure-crash.mjs', import.meta.url);
  const result = await new Promise((resolve, reject) => { const child = spawn(process.execPath, [fileURLToPath(file), JSON.stringify([root, seam, args, action])], { stdio: ['ignore', 'pipe', 'pipe'] }); let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('error',reject);child.on('close',code=>resolve({code,out})); });
  assert.equal(result.code,86,result.out);
}
