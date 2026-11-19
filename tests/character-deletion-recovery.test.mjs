// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';
import { registryRecoveryDocument } from '../app/storage/registry.mjs';
import { reconcileServiceRecoveryTombstones } from '../scripts/linux/service-recovery.mjs';

const service = (f, point) => createCharacterDeletionService({ registry: f.registry, using: async (id, work) => work(await f.open(id)), purge: async () => {}, point });
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'character-recovery-')); let f = await inviteFixture(root);
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  const owner = await f.registry.firstLogin('google', 'owner'), player = await f.registry.firstLogin('google', 'player'), invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.join(invite, player.account, { characterId: player.character.id }); player.character = f.registry.getCharacter(player.character.id);
  const settings = { dataDir: f.options.legacyDir, controlDir: path.join(root, 'control'), backupDir: path.join(root, 'backups'), scratchRoot: path.join(root, 'scratch'), minFreeBytes: 0,
    multiPicker: { registryDir: f.options.registryDir, pickerRoot: f.options.pickerRoot, tombstoneDir: f.options.tombstoneDir } };
  return { root, owner, player, settings, get f() { return f; }, async reopen() { f = await inviteFixture(root); return f; },
    async checkpoint() { return registryRecoveryDocument(JSON.parse(await readFile(path.join(f.options.registryDir, 'registry.json')))); } };
}
const input = c => ({ kind: 'character', characterId: c.id, pickerId: c.placement.pickerId, deleteGroup: true, requestId: randomUUID() });

for (const pending of [false, true]) test(`stopped recovery preserves live ledger decisions (${pending ? 'pending' : 'completed'} deletion)`, async t => {
  const h = await setup(t), checkpoint = await h.checkpoint(), request = input(h.player.character), s = service(h.f), review = await s.review(h.player.account.id, request);
  if (pending) await h.f.registry.beginCharacterDeletion(h.player.account.id, { ...request, revision: review.revision });
  else await s.delete(h.player.account.id, request, review);
  const ledgerFile = path.join(h.f.options.tombstoneDir, 'ledger.json'), bytes = await readFile(ledgerFile); await h.f.close();
  const plan = await reconcileServiceRecoveryTombstones({ settings: h.settings, checkpoint }), applied = await plan.apply();
  assert.deepEqual(await readFile(ledgerFile), bytes);
  assert.equal(applied.checkpoint.deletions.length, 1);
  assert.equal(applied.checkpoint.characters.find(c => c.id === h.player.character.id).lifecycle, pending ? 'active' : 'retired');
  await writeFile(path.join(h.f.options.registryDir, 'registry.json'), JSON.stringify(applied.checkpoint));
  const f = await h.reopen(); await service(f).recover();
  assert.equal(f.registry.getCharacter(h.player.character.id).lifecycle, 'retired');
  assert.equal((await f.open(h.owner.picker.id)).store.getReadState().members.length, 1);
});

test('stopped recovery refuses an obsolete owner mapping without altering the live ledger', async t => {
  const h = await setup(t), checkpoint = await h.checkpoint(), { f, owner, player } = h;
  const offer = await f.registry.proposeGroupHandover(owner.account.id, owner.character.id, owner.picker.id, { requestId: randomUUID(), targetCharacterId: player.character.id });
  await f.registry.resolveGroupHandover(player.account.id, player.character.id, owner.picker.id, offer.id, 'accept');
  const s = service(f), request = input(owner.character), review = await s.review(owner.account.id, request); await s.delete(owner.account.id, request, review);
  const file = path.join(f.options.tombstoneDir, 'ledger.json'), bytes = await readFile(file); await f.close();
  await assert.rejects(reconcileServiceRecoveryTombstones({ settings: h.settings, checkpoint }), /ownership handover/);
  assert.deepEqual(await readFile(file), bytes);
});

test('operator account retirement retains its owned-group cascade with ledger 3', async t => {
  const { f, owner, player } = await setup(t);
  await f.registry.deleteAccount(owner.account.id, { runtimePurge: true });
  assert.equal(f.registry.getAccount(owner.account.id), null); assert.ok(f.registry.getAccount(player.account.id));
  assert.equal(f.registry.getPicker(owner.picker.id).lifecycle, 'deleting');
  assert.equal(f.registry.getCharacter(owner.character.id).lifecycle, 'retired');
  assert.equal(f.registry.getCharacter(player.character.id).lifecycle, 'retired');
  const ledger = JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')));
  assert.equal(ledger.schemaVersion, 3); assert.equal(ledger.characters.length, 2);
});

for (const pendingCreation of [false, true]) test(`restoring an early login checkpoint cannot reprovision a deliberately emptied login (creation intent ${pendingCreation})`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'empty-login-restore-')); let f, armed = false;
  const point = name => { if (armed && name === 'account-recorded') { armed = false; throw new Error('Synthetic initial creation interruption'); } };
  f = await inviteFixture(root, { crashPoint: point });
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  const account = await f.registry.ensureIdentity('google', 'empty-after-restore'), registryFile = path.join(f.options.registryDir, 'registry.json');
  if (pendingCreation) { armed = true; await assert.rejects(f.registry.firstLogin('google', 'empty-after-restore'), /Synthetic initial creation/); }
  const checkpoint = await readFile(registryFile); await f.close(); f = await inviteFixture(root);
  const created = await f.registry.firstLogin('google', 'empty-after-restore'), request = input(created.character), s = service(f), review = await s.review(account.id, request);
  await s.delete(account.id, request, review); await f.close(); await writeFile(registryFile, checkpoint); f = await inviteFixture(root);
  await service(f).recover(); const before = JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')));
  assert.equal(f.registry.getAccount(account.id).initialProvisioned, true); assert.equal(f.registry.getAccount(account.id).pendingCreation, null);
  const signedIn = await f.registry.firstLogin('google', 'empty-after-restore'); assert.equal(signedIn.picker, null); assert.deepEqual(f.registry.listCharacters(account.id), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json'))).issuedCharacterIds, before.issuedCharacterIds);
  const sanitized = registryRecoveryDocument(JSON.parse(await readFile(registryFile))); await f.close(); await writeFile(registryFile, JSON.stringify(sanitized)); f = await inviteFixture(root);
  const code = await f.registry.issueRelinkCode(account.id), reclaimed = await f.registry.claimIdentity(code.code, 'google', 'reclaimed-empty');
  assert.equal(reclaimed.id, account.id); assert.equal((await f.registry.firstLogin('google', 'reclaimed-empty')).picker, null);
  assert.deepEqual(f.registry.listCharacters(account.id), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json'))).issuedCharacterIds, before.issuedCharacterIds);
});
