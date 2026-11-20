// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { serviceOffhostFixture, serviceRepository } from './helpers/offhost.mjs';
import { offhostBackup } from '../scripts/linux/offhost-backup.mjs';
import { restoreServiceStopped } from '../scripts/linux/service-recovery.mjs';
import { rehearseService } from '../scripts/linux/service-rehearsal.mjs';
import { verifyServiceBackup } from '../scripts/linux/service-checkpoint.mjs';
import { exists, json, sha } from '../scripts/linux/files.mjs';
import { openRegistry } from '../app/storage/registry.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createGroupInviteService } from '../app/group-invite-service.mjs';
import { createCharacterDeletionService } from '../app/character-deletion-service.mjs';

test('ledger 3 deletion and retired binding survive off-site capture, restore-clean and real rehearsal without resurrection', async t => {
  let retired, olderCheckpoint, accountId, pickerId;
  const f = await serviceOffhostFixture(t, { runtime: true, async prepare({ registry, pickers }) {
    pickerId = pickers[1].id;
    accountId = registry.listAccounts().find(a => a.memberships.some(m => m.pickerId === pickerId && m.role === 'owner')).id;
    const store = await openStore({ dataDir: registry.pickerDirectory(pickerId), registry: createRuleRegistry([]), world: { chunks: new Map([['100', { id: '100' }]]) } });
    const context = { store, groupRuleDefinitions: () => [], withGroupAdmission: work => work(store), revokeDepartedMember: memberId => registry.revokeMemberPluginKeys(pickerId, memberId) };
    const invitations = createGroupInviteService({ registry, acquire: async () => ({ context }), release() {} });
    try {
      const invitation = await registry.createGroupInvite(accountId, pickerId), review = await invitations.review(invitation.secret, accountId);
      await invitations.accept(invitation.secret, accountId, {}, review.review.revision);
      retired = registry.listCharacters(accountId).find(c => c.placement.memberId !== 'owner');
      assert.ok(retired); olderCheckpoint = await registry.withRecoveryCheckpoint(d => d);
      const deletion = createCharacterDeletionService({ registry, using: async (_id, work) => work(context), purge: async () => {} });
      const selection = { kind: 'character', characterId: retired.id, pickerId, deleteGroup: true }, confirmation = await deletion.review(accountId, selection);
      await deletion.delete(accountId, { ...selection, requestId: randomUUID() }, confirmation);
      assert.deepEqual(store.getReadState().members.map(m => m.id), ['owner']);
    } finally { await invitations.close(); await store.close(); }
  } });
  const manifest = await verifyServiceBackup(f.backup), sourceLedger = await readFile(path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json'));
  assert.equal(manifest.ledger.schemaVersion, 3); assert.equal(manifest.ledger.sha256, sha(sourceLedger));
  assert.deepEqual(await readFile(path.join(f.backup, 'ledger.json')), sourceLedger);
  const ledger = JSON.parse(sourceLedger);
  assert.ok(ledger.characters.some(c => c.characterId === retired.id));
  assert.ok(ledger.slots.some(s => s.pickerId === pickerId && s.memberId === retired.placement.memberId));
  await offhostBackup({ ...f, run: serviceRepository(f), config: {}, ping: async () => {} });
  const source = path.join(f.dir, 'remote-payload'), backup = path.join(source, 'snapshot'), root = path.join(f.dir, 'clean-target');
  const target = { ...f.settings, dataDir: path.join(root, 'legacy'), controlDir: path.join(root, 'control'), scratchRoot: path.join(root, 'scratch'), backupDir: path.join(root, 'backups'),
    multiPicker: { admission: 'open', ...Object.fromEntries(['registryDir', 'pickerRoot', 'tombstoneDir'].map(key => [key, path.join(root, key)])) } };
  const targetLedger = path.join(target.multiPicker.tombstoneDir, 'ledger.json'); assert.equal(await exists(targetLedger), false);
  const restored = await restoreServiceStopped({ settings: target, backup, release: f.release, initializeLedger: true, assertStopped: async () => {}, probe: async (_release, dir) => json(path.join(dir, 'state.json')) });
  assert.equal(restored.restored, 2); assert.deepEqual(restored.quarantined, []);
  assert.equal(restored.credentialsRestored, 0); assert.deepEqual(await readFile(targetLedger), sourceLedger);
  async function refusesResurrection(settings) {
    // Restore metadata older than deletion while retaining the initialized live
    // ledger. Gameplay remains the portable post-deletion checkpoint.
    await writeFile(path.join(settings.multiPicker.registryDir, 'registry.json'), JSON.stringify(olderCheckpoint));
    const registry = await openRegistry({ ...settings.multiPicker, legacyDir: settings.dataDir });
    try {
      assert.equal(registry.getCharacter(retired.id).lifecycle, 'retired');
      assert.throws(() => registry.selectCharacter(accountId, retired.id), /unavailable/);
      await assert.rejects(registry.reserveTransferMembers(pickerId, ['owner', retired.placement.memberId]), /Historical slots/);
    } finally { await registry.close(); }
    assert.deepEqual(await readFile(path.join(settings.multiPicker.tombstoneDir, 'ledger.json')), sourceLedger);
  }
  await refusesResurrection(target);
  // The rehearsal must rely on the downloaded snapshot/rebuild pair alone.
  for (const dir of [f.roots.releases, f.roots.packs, f.settings.dataDir, ...['registryDir', 'pickerRoot', 'tombstoneDir'].map(key => f.settings.multiPicker[key])]) await rm(dir, { recursive: true });
  await rm(f.settings.dataDir + '.dataset.json');
  const scratch = path.join(f.dir, 'rehearsal'), receipt = await rehearseService({ source, scratch });
  assert.equal(receipt.result, 'success'); assert.deepEqual(receipt.ledger, manifest.ledger);
  assert.equal(receipt.keys.freshKeyRevocation, true); assert.equal(receipt.credentials.imported, 0);
  const config = await json(path.join(scratch, 'config.json'));
  assert.deepEqual(await readFile(path.join(config.multiPicker.tombstoneDir, 'ledger.json')), sourceLedger);
  await refusesResurrection(config);
});
