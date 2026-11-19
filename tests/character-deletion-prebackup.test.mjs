// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { serviceOffhostFixture } from './helpers/offhost.mjs';
import { openRegistry } from '../app/storage/registry.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createGroupInviteService } from '../app/group-invite-service.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';
import { restoreServiceStopped, releaseServiceQuarantine } from '../scripts/linux/service-recovery.mjs';
import { runProbe } from '../scripts/linux/recovery.mjs';

async function contexts(registry) {
  const stores = new Map();
  return { async using(id, work) {
    if (!stores.has(id)) stores.set(id, await openStore({ dataDir: registry.pickerDirectory(id), retention: false,
      initialState: createGroupState(registry.getPicker(id).memberIds.map(id => ({ id, name: 'Synthetic Player' }))),
      registry: createRuleRegistry([]), world: { chunks: new Map([['100', { id: '100' }]]) } }));
    const store = stores.get(id);
    return work({ store, groupRuleDefinitions: () => [], withGroupAdmission: work => work(store),
      untouchedOnboarding: () => store.getInfo().revision === 0,
      revokeDepartedMember: memberId => registry.revokeMemberPluginKeys(id, memberId) });
  }, async close() { for (const store of stores.values()) await store.close(); } };
}

for (const mode of ['completed', 'pending', 'interrupted', 'quarantine']) test(`a pre-deletion service backup removes the retired member before roster validation (${mode})`, async t => {
  let player, pickerId, ownerMap;
  const f = await serviceOffhostFixture(t, { runtime: true, async prepare({ registry, pickers }) {
    pickerId = pickers[1].id;
    const ownerId = registry.getPicker(pickerId).ownerAccountId;
    player = await registry.firstLogin('discord', 'synthetic-backup-player');
    player.character = registry.listCharacters(player.account.id)[0];
    const c = await contexts(registry), invitations = createGroupInviteService({ registry,
      acquire: async id => ({ context: await c.using(id, value => value) }), release() {} });
    try {
      const invite = await registry.createGroupInvite(ownerId, pickerId), review = await invitations.review(invite.secret, player.account.id);
      await invitations.accept(invite.secret, player.account.id, { characterId: player.character.id }, review.review.revision);
      player.character = registry.getCharacter(player.character.id);
      await c.using(pickerId, context => { ownerMap = structuredClone(context.store.getReadState().members.find(m => m.id === 'owner')); });
    } finally { await invitations.close(); await c.close(); }
  } });
  const registry = await openRegistry({ ...f.settings.multiPicker, legacyDir: f.settings.dataDir }), c = await contexts(registry);
  const deletion = createCharacterDeletionService({ registry, using: c.using, purge: async () => {} });
  const selection = { kind: 'character', characterId: player.character.id, pickerId, deleteGroup: true, requestId: randomUUID() };
  try {
    const review = await deletion.review(player.account.id, selection);
    if (mode === 'pending') await registry.beginCharacterDeletion(player.account.id, { ...selection, revision: review.revision });
    else await deletion.delete(player.account.id, selection, review);
  } finally { await deletion.close(); await c.close(); await registry.close(); }
  const ledgerFile = path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json'), ledgerBytes = await readFile(ledgerFile);
  const root = path.join(f.dir, 'older-backup-target'), target = { ...f.settings,
    dataDir: path.join(root, 'legacy'), controlDir: path.join(root, 'control'), scratchRoot: path.join(root, 'scratch'), backupDir: path.join(root, 'backups'),
    multiPicker: Object.fromEntries(['registryDir', 'pickerRoot', 'tombstoneDir'].map(key => [key, path.join(root, key)])) };
  await mkdir(target.multiPicker.tombstoneDir, { recursive: true });
  await copyFile(ledgerFile, path.join(target.multiPicker.tombstoneDir, 'ledger.json'));
  let cleaned = false, interrupted = false;
  const options = { settings: target, backup: f.backup, release: f.release, assertStopped: async () => {},
    async step(label) { if (mode === 'interrupted' && cleaned && !interrupted && label === 'install.rename-store') { interrupted = true; throw new Error('Synthetic interruption after staged member cleanup'); } },
    async probe(release, dir, output, options) {
      if (mode === 'quarantine' && dir.includes(pickerId)) throw new Error('Synthetic runtime refusal before roster reconciliation');
      const result = await runProbe(release, dir, output, options);
      if (options?.memberDepartures.length) cleaned = true;
      return result;
    } };
  if (mode === 'interrupted') await assert.rejects(restoreServiceStopped(options), /Synthetic interruption/);
  const restored = await restoreServiceStopped(options);
  if (mode === 'quarantine') {
    assert.deepEqual(restored.quarantined, [pickerId]);
    await assert.rejects(releaseServiceQuarantine({ settings: target, id: pickerId, release: f.release, assertStopped: async () => {},
      async step(label) { if (label === 'release.intent') throw new Error('Synthetic release interruption after cleanup'); } }), /Synthetic release interruption/);
    assert.deepEqual(await releaseServiceQuarantine({ settings: target, id: pickerId, release: f.release, assertStopped: async () => {} }), { released: pickerId });
  } else { assert.deepEqual(restored.quarantined, []); assert.equal(restored.restored, 2); }
  assert.deepEqual(await readFile(path.join(target.multiPicker.tombstoneDir, 'ledger.json')), ledgerBytes);
  assert.deepEqual(await readFile(ledgerFile), ledgerBytes);
  const restoredRegistry = await openRegistry({ ...target.multiPicker, legacyDir: target.dataDir }), restoredContexts = await contexts(restoredRegistry);
  try {
    const service = createCharacterDeletionService({ registry: restoredRegistry, using: restoredContexts.using, purge: async () => {} });
    await service.recover(); await service.close();
    assert.equal(restoredRegistry.getCharacter(player.character.id).lifecycle, 'retired');
    await restoredContexts.using(pickerId, context => {
      const state = context.store.getReadState();
      assert.deepEqual(state.members, [ownerMap]);
      assert.ok(state.history.some(e => e.type === 'member-departed' && e.command.memberId === player.character.placement.memberId));
      assert.equal(state.history.filter(e => e.type === 'member-departed' && e.command.memberId === player.character.placement.memberId).length, 1);
      assert.ok(state.history.some(e => e.command?.type === 'set-note'));
    });
  } finally { await restoredContexts.close(); await restoredRegistry.close(); }
});
