// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { writeOlderLifecycleFixture } from './helpers/lifecycle-format-fixture.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';
import { openRegistry, registryRecoveryDocument } from '../app/storage/registry.mjs';
import { DELETION_POINTS, RETIREMENT_MIGRATION_POINTS } from '../app/storage/registry-retirements.mjs';
import { validateState } from '../app/core/state.mjs';

export function deletionService(f, point) { return createCharacterDeletionService({ registry: f.registry, using: async (id, work) => work(await f.open(id)), purge: async () => {}, point }); }
async function fixture(t, options) {
  const root = await mkdtemp(path.join(tmpdir(), 'character-deletion-')); let f = await inviteFixture(root, options);
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  return { root, get f() { return f; }, async restart(edit) { await f.close(); await edit?.(); f = await inviteFixture(root, options); return f; } };
}
async function roster(f, size, same = false) {
  const owner = await f.registry.firstLogin('google', 'owner'), players = [];
  for (let n = 1; n < size; n++) {
    const p = same ? owner : await f.registry.firstLogin('google', 'player' + n), invitation = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
    const previous = f.registry.listCharacters(p.account.id).map(c => c.id);
    await f.join(invitation, p.account, same ? {} : { characterId: p.character.id });
    const character = same ? f.registry.listCharacters(p.account.id).find(c => !previous.includes(c.id)) : f.registry.getCharacter(p.character.id);
    players.push({ ...p, character });
  }
  return { owner, players };
}
async function remove(f, accountId, selection, requestId = randomUUID()) {
  const service = deletionService(f), review = await service.review(accountId, selection);
  return service.delete(accountId, { ...selection, requestId }, review);
}
const selection = (p, kind = 'character') => ({ kind, characterId: p.character.id, pickerId: p.character.placement.pickerId, deleteGroup: true });
const json = file => readFile(file, 'utf8').then(JSON.parse);

for (const size of [2, 3, 4, 5]) test(`character deletion preserves surviving maps and historical attribution in roster ${size}`, async t => {
  const h = await fixture(t, { prepareState: state => validateState(state) }), { owner, players } = await roster(h.f, size), target = players.at(-1);
  const store = (await h.f.open(owner.picker.id)).store;
  const saved = await store.backup(); saved.state.members[0].notes = { '12341': 'Keep owner progress' }; await store.replace(saved, store.getInfo().revision);
  const other = store.getReadState().members.filter(m => m.id !== target.character.placement.memberId);
  const before = JSON.parse(JSON.stringify(other));
  await assert.rejects(remove(h.f, owner.account.id, selection(target)), { status: 403 });
  const requestId = randomUUID(), review = await deletionService(h.f).review(target.account.id, selection(target));
  await deletionService(h.f).delete(target.account.id, { ...selection(target), requestId }, review);
  assert.deepEqual(store.getReadState().members, before);
  assert.equal(store.getReadState().history.at(-1).type, 'member-departed');
  assert.equal(h.f.registry.listCharacters(target.account.id).length, 0);
  assert.equal(h.f.registry.getCharacter(target.character.id).lifecycle, 'retired');
  assert.ok(h.f.registry.getAccount(target.account.id).initialProvisioned);
  assert.equal((await h.f.registry.firstLogin('google', 'player' + (size - 1))).picker, null);
  await assert.rejects(store.command({ type: 'undo' }, store.getInfo().revision), /past roster|undo/i);
  const ledger = await json(path.join(h.f.options.tombstoneDir, 'ledger.json'));
  assert.equal(ledger.schemaVersion, 3); assert.equal((await json(path.join(h.f.options.registryDir, 'registry.json'))).schemaVersion, 5);
  assert.ok(ledger.characters.some(c => c.characterId === target.character.id));
  assert.ok(ledger.slots.some(s => s.pickerId === owner.picker.id && s.memberId === target.character.placement.memberId));
  await h.restart(); await deletionService(h.f).recover();
  assert.deepEqual((await h.f.open(owner.picker.id)).store.getReadState().members, before);
  assert.equal(h.f.registry.getDeletion(requestId).id, requestId);
});

test('designated owner needs handover; final character explicitly deletes its group and leaves an empty login', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  await assert.rejects(remove(f, owner.account.id, selection(owner)), /handover/);
  const offer = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), targetCharacterId: player.character.id });
  await f.registry.resolveGroupHandover(player.account.id, player.character.id, owner.picker.id, offer.id, 'accept');
  await remove(f, owner.account.id, selection(owner));
  await assert.rejects(remove(f, player.account.id, { ...selection(player), deleteGroup: false }), /Explicitly confirm/);
  const result = await remove(f, player.account.id, selection(player));
  assert.deepEqual(result.groups, [owner.picker.id]); assert.equal(f.registry.getPicker(owner.picker.id).lifecycle, 'deleting');
  assert.equal(f.registry.getAccount(player.account.id).initialProvisioned, true);
});

test('group deletion requires designated owner and every remaining character from that login', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  await assert.rejects(remove(f, player.account.id, selection(player, 'picker')), { status: 403 });
  await assert.rejects(remove(f, owner.account.id, selection(owner, 'picker')), /Other logins/);
  await f.departures.depart(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), characterId: player.character.id, revision: (await f.open(owner.picker.id)).store.getInfo().revision });
  const retained = f.registry.listPastMaps(player.account.id);
  await remove(f, owner.account.id, selection(owner, 'picker'));
  assert.equal(f.registry.listCharacters(player.account.id).length, 1); assert.deepEqual(f.registry.listPastMaps(player.account.id), retained);
});

for (const size of [1, 2, 3, 4, 5]) test(`group deletion lists all ${size} same-login characters`, async t => {
  const { f } = await fixture(t), { owner } = await roster(f, size, true);
  const r = await remove(f, owner.account.id, selection(owner, 'picker'));
  assert.equal(r.characters.length, size); assert.equal(f.registry.listCharacters(owner.account.id).length, 0);
  assert.ok(f.registry.getAccount(owner.account.id));
});

test('login deletion requires handover, retains other logins, deletes its complete character collection', async t => {
  const { f } = await fixture(t), { owner, players: [player] } = await roster(f, 2);
  await f.registry.addCharacter(owner.account.id, { requestId: 'extra' });
  const input = { kind: 'account', characterId: null, pickerId: null, deleteGroup: true };
  await assert.rejects(remove(f, owner.account.id, input), /handover/);
  const offer = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), targetCharacterId: player.character.id });
  await f.registry.resolveGroupHandover(player.account.id, player.character.id, owner.picker.id, offer.id, 'accept');
  const r = await remove(f, owner.account.id, input); assert.equal(r.characters.length, 2);
  assert.equal(f.registry.getAccount(owner.account.id), null); assert.ok(f.registry.getAccount(player.account.id));
  assert.equal(f.registry.getPicker(owner.picker.id).ownerCharacterId, player.character.id);
  assert.equal((await f.open(owner.picker.id)).store.getReadState().members.length, 1);
});

test('stale full target list, stale map and session recheck refuse before durable intent', async t => {
  const { f } = await fixture(t), { owner } = await roster(f, 1), service = deletionService(f), input = { kind: 'account', characterId: null, pickerId: null, deleteGroup: true };
  const old = await service.review(owner.account.id, input);
  await f.registry.addCharacter(owner.account.id, { requestId: 'late' });
  await assert.rejects(service.delete(owner.account.id, { ...input, requestId: randomUUID() }, old), /target list/);
  const review = await service.review(owner.account.id, input), store = (await f.open(owner.picker.id)).store;
  await store.command({ type: 'add-task', task: { id: 'custom:late', label: 'Late write', category: 'Custom' } }, store.getInfo().revision);
  await assert.rejects(service.delete(owner.account.id, { ...input, requestId: randomUUID() }, review), /map changed/i);
  const current = await service.review(owner.account.id, input);
  await assert.rejects(service.delete(owner.account.id, { ...input, requestId: randomUUID() }, current, () => { throw new Error('Session revoked'); }), /Session revoked/);
  assert.equal(f.registry.deletionTransactions().length, 0);
});

test('restoring older registry and gameplay never revives a deleted non-owner or its binding', async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2), store = (await h.f.open(owner.picker.id)).store;
  const registryFile = path.join(h.f.options.registryDir, 'registry.json'), before = await readFile(registryFile), backup = await store.backup();
  await remove(h.f, player.account.id, selection(player));
  await h.restart(() => writeFile(registryFile, before));
  assert.equal(h.f.registry.getCharacter(player.character.id).lifecycle, 'retired');
  assert.throws(() => h.f.registry.selectCharacter(player.account.id, player.character.id), /unavailable/);
  // A stopped gameplay restore is also older than the ledger. Startup cleanup
  // uses the existing departure operation before any server begins listening.
  const restored = (await h.f.open(owner.picker.id)).store;
  await restored.replace(backup.state, restored.getInfo().revision);
  await deletionService(h.f).recover();
  assert.equal(restored.getReadState().members.length, 1);
  await assert.rejects(h.f.registry.reserveTransferMembers(owner.picker.id, backup.state.members.map(m => m.id)), /Historical slots/);
  assert.ok(registryRecoveryDocument(await json(registryFile)).deletions.length);
});

for (const seam of [...RETIREMENT_MIGRATION_POINTS, ...DELETION_POINTS, 'departure-roster-prepared', 'departure-keys', 'departure-overlays', 'departure-sessions']) test(`process exit at ${seam} resumes once without resurrection`, async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2), input = { ...selection(player), requestId: randomUUID() };
  await writeFile(path.join(h.root, 'request.json'), JSON.stringify({ accountId: player.account.id, input }));
  await h.f.close();
  if (seam.startsWith('retirement-')) await writeOlderLifecycleFixture(h.f.options);
  const child = spawnSync(process.execPath, ['tests/helpers/deletion-crash-child.mjs', h.root, seam], { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 73, child.stderr + child.stdout);
  await h.restart();
  const service = deletionService(h.f);
  if (!h.f.registry.getDeletion(input.requestId)) await remove(h.f, player.account.id, selection(player), input.requestId);
  else await service.recover();
  assert.equal(h.f.registry.getCharacter(player.character.id).lifecycle, 'retired');
  assert.equal((await h.f.open(owner.picker.id)).store.getReadState().members.length, 1);
  assert.equal(h.f.registry.deletionTransactions().length, 1);
  await h.restart(); await deletionService(h.f).recover();
  assert.equal((await h.f.open(owner.picker.id)).store.getReadState().history.filter(e => e.type === 'member-departed').length, 1);
});

test('unknown future registry and ledger versions refuse startup', async t => {
  for (const which of ['registry', 'ledger']) {
    const h = await fixture(t), { owner } = await roster(h.f, 1); await remove(h.f, owner.account.id, selection(owner));
    await h.f.close(); const file = path.join(which === 'registry' ? h.f.options.registryDir : h.f.options.tombstoneDir, which === 'registry' ? 'registry.json' : 'ledger.json');
    const doc = await json(file); doc.schemaVersion = 99; await writeFile(file, JSON.stringify(doc));
    await assert.rejects(openRegistry(h.f.options), /Unsupported newer/);
  }
});

test('ten-character login deletion uses at most one resident group context', async t => {
  const { f } = await fixture(t), { owner } = await roster(f, 1);
  for (let i = 1; i < 10; i++) await f.registry.addCharacter(owner.account.id, { requestId: 'extra-' + i });
  let active = 0, peak = 0;
  const service = createCharacterDeletionService({ registry: f.registry, purge: async () => {}, using: async (id, work) => {
    active++; peak = Math.max(peak, active); try { return await work(await f.open(id)); } finally { active--; }
  } });
  const input = { kind: 'account', characterId: null, pickerId: null, deleteGroup: true }, review = await service.review(owner.account.id, input);
  assert.equal(review.targets.length, 10); assert.equal(review.groups.length, 10);
  await service.delete(owner.account.id, { ...input, requestId: randomUUID() }, review);
  assert.equal(peak, 1); assert.equal(f.registry.getAccount(owner.account.id), null);
});

test('retirement cap exhaustion refuses before another deletion intent or scope fence', async t => {
  const { f } = await fixture(t, { caps: { retiredCharacters: 1 } }), { owner, players } = await roster(f, 3);
  await remove(f, players[0].account.id, selection(players[0]));
  await assert.rejects(remove(f, players[1].account.id, selection(players[1])), /history limit/);
  assert.equal(f.registry.deletionTransactions().length, 1);
  assert.equal(f.registry.selectCharacter(players[1].account.id, players[1].character.id).id, players[1].character.id);
  assert.equal(f.registry.getPicker(owner.picker.id).seats.length, 2);
});

test('older registry restore refuses a retired move binding while keeping the live ledger intact', async t => {
  const h = await fixture(t), { owner, players } = await roster(h.f, 3);
  await remove(h.f, players[1].account.id, selection(players[1])); // upgrades both formats
  const file = path.join(h.f.options.registryDir, 'registry.json'), old = await readFile(file), player = players[0];
  await h.f.departures.depart(player.account.id, player.character.id, owner.picker.id, { requestId: randomUUID(), characterId: player.character.id, revision: (await h.f.open(owner.picker.id)).store.getInfo().revision });
  const current = await readFile(file), ledgerFile = path.join(h.f.options.tombstoneDir, 'ledger.json'), ledger = await readFile(ledgerFile);
  await h.f.close(); await writeFile(file, old);
  await assert.rejects(openRegistry(h.f.options), /retired character binding/);
  assert.deepEqual(await readFile(ledgerFile), ledger);
  await writeFile(file, current); await h.restart();
  assert.notEqual(h.f.registry.getCharacter(player.character.id).placement.pickerId, owner.picker.id);
});

test('slot retirement interrupted before a departure placement resumes the original intent', async t => {
  let armed = false;
  const h = await fixture(t, { crashPoint(name) { if (armed && name === 'retirement-slot') { armed = false; throw new Error('Interrupted slot retirement'); } } }), { owner, players } = await roster(h.f, 3);
  await remove(h.f, players[1].account.id, selection(players[1]));
  const player = players[0], requestId = randomUUID(); armed = true;
  await assert.rejects(h.f.departures.depart(player.account.id, player.character.id, owner.picker.id, { requestId, characterId: player.character.id, revision: (await h.f.open(owner.picker.id)).store.getInfo().revision }), /Interrupted slot retirement/);
  await h.restart(); await h.f.departures.recover();
  assert.ok(h.f.registry.getDeparture(requestId).completedAt);
  assert.notEqual(h.f.registry.getCharacter(player.character.id).placement.pickerId, owner.picker.id);
});

test('migration retains exact v4 and v2 preimages and refuses conflicting retained input', async t => {
  const h = await fixture(t), { owner, players: [player] } = await roster(h.f, 2);
  const offer = await h.f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), targetCharacterId: player.character.id });
  await h.f.registry.resolveGroupHandover(player.account.id, player.character.id, owner.picker.id, offer.id, 'decline');
  const file = path.join(h.f.options.registryDir, 'registry.json'), ledgerFile = path.join(h.f.options.tombstoneDir, 'ledger.json');
  await h.f.close(); await writeOlderLifecycleFixture(h.f.options);
  const before = await readFile(file), ledger = await readFile(ledgerFile); await h.restart();
  await remove(h.f, player.account.id, selection(player));
  assert.deepEqual(await readFile(path.join(h.f.options.registryDir, 'registry.pre-retirements-v4.json')), before);
  assert.deepEqual(await readFile(path.join(h.f.options.registryDir, 'ledger.pre-retirements-v2.json')), ledger);
  const other = await fixture(t), r = await roster(other.f, 1);
  await writeFile(path.join(other.f.options.registryDir, 'registry.pre-retirements-v4.json'), '{}');
  await assert.rejects(remove(other.f, r.owner.account.id, selection(r.owner)), /preimage differs/);
  assert.equal((await json(path.join(other.f.options.registryDir, 'registry.json'))).characters.filter(c => c.lifecycle === 'active').length, 1);
});

test('uncertain ledger migration publication fences the live writer until restart', async t => {
  const h = await fixture(t), { owner } = await roster(h.f, 1), ledgerFile = path.resolve(h.f.options.tombstoneDir, 'ledger.json');
  const failure = Object.assign(new Error('Synthetic post-publication I/O failure'), { code: 'EIO' }), rename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (...args) => { const result = await rename(...args); if (path.resolve(args[1]) === ledgerFile) throw failure; return result; });
  syncBuiltinESMExports();
  try {
    await assert.rejects(remove(h.f, owner.account.id, selection(owner)), e => e === failure);
    assert.throws(() => h.f.registry.getAccount(owner.account.id), /requires restart/);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  await h.restart(); assert.equal(h.f.registry.listCharacters(owner.account.id).length, 1);
  await remove(h.f, owner.account.id, selection(owner)); assert.equal(h.f.registry.listCharacters(owner.account.id).length, 0);
});
