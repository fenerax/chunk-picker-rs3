// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { captureServiceCheckpoint, verifyServiceBackup } from '../scripts/linux/service-checkpoint.mjs';
import { restoreServiceStopped } from '../scripts/linux/service-recovery.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { snapshotPath } from '../app/storage/snapshot.mjs';
import { encode, sha, json } from '../scripts/linux/files.mjs';

test('service capture and stopped restore carry immutable Past maps independently of active gameplay', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'past-recovery-')), f = await inviteFixture(path.join(root, 'source'));
  const settingsAt = base => ({ dataDir: path.join(base, 'legacy'), controlDir: path.join(base, 'control'), backupDir: path.join(base, 'backups'), scratchRoot: path.join(base, 'scratch'), minFreeBytes: 0,
    multiPicker: { registryDir: path.join(base, 'registry'), pickerRoot: path.join(base, 'pickers'), tombstoneDir: path.join(base, 'ledger') } });
  const settings = settingsAt(path.join(root, 'source'));
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  await f.registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [], droppedMemberships: 0 });
  const owner = await f.registry.firstLogin('google', 'owner'), player = await f.registry.firstLogin('google', 'player');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id); await f.join(invite, player.account, { characterId: player.character.id });
  const review = await f.departures.review(player.account.id, player.character.id, owner.picker.id), id = randomUUID();
  await f.departures.depart(player.account.id, player.character.id, owner.picker.id, { requestId: id, characterId: player.character.id, revision: review.revision });
  const before = await f.registry.readPastMap(player.account.id, id);
  for (const p of f.registry.listPickers().filter(p => p.lifecycle === 'active')) {
    await (await f.open(p.id)).store.prepareSnapshot(); await writeFile(f.registry.pickerDirectory(p.id) + '.dataset.json', encode({ datasetId: 'synthetic' }));
  }
  const backupId = randomUUID(); await captureServiceCheckpoint({ settings, registry: f.registry, id: backupId, minFreeBytes: 0 });
  const backup = snapshotPath(settings.dataDir, backupId), manifest = await verifyServiceBackup(backup);
  assert.ok(manifest.files.some(r => r.path === `past-maps/${id}.json`));
  assert.deepEqual(JSON.parse(await readFile(path.join(backup, 'past-maps', id + '.json'))), before.document);
  for (const seam of ['capture.past-maps', 'capture.past-map', 'capture.registry']) {
    const interruptedId = randomUUID(), fault = new Error('Synthetic capture interruption');
    await assert.rejects(captureServiceCheckpoint({ settings, registry: f.registry, id: interruptedId, minFreeBytes: 0, step: async name => { if (name === seam) throw fault; } }), e => e === fault);
    // Existing capture recovery requires preserving an incomplete target for
    // inspection, then retrying. No partial capture is called complete.
    await rename(snapshotPath(settings.dataDir, interruptedId), path.join(root, interruptedId));
    await captureServiceCheckpoint({ settings, registry: f.registry, id: interruptedId, minFreeBytes: 0 });
    await verifyServiceBackup(snapshotPath(settings.dataDir, interruptedId));
  }
  const immutable = path.join(root, 'release'); await mkdir(immutable); await writeFile(path.join(immutable, 'synthetic.txt'), 'Synthetic release');
  const configFile = path.join(root, 'config.json'), pointer = path.join(root, 'current.json'), config = { dataDir: settings.dataDir, coreRoot: immutable };
  await writeFile(configFile, encode(config)); await writeFile(pointer, encode({ config: { path: configFile, sha256: sha(encode(config)) } }));
  const release = await readRelease(pointer, settings.dataDir);
  for (const seam of [null, 'restore.past-maps', 'restore.past-map', 'restore.registry-publish']) {
    const target = settingsAt(path.join(root, 'target-' + (seam ?? 'clean')));
    await mkdir(target.multiPicker.tombstoneDir, { recursive: true }); await writeFile(path.join(target.multiPicker.tombstoneDir, 'ledger.json'), await readFile(path.join(f.options.tombstoneDir, 'ledger.json')));
    const options = { settings: target, backup, release, assertStopped: async () => {}, probe: async (_release, dir) => { const saved = await json(path.join(dir, 'state.json')); return { state: saved.state ?? saved }; } };
    if (seam) {
      const fault = new Error('Synthetic restore interruption');
      await assert.rejects(restoreServiceStopped({ ...options, step: async name => { if (name === seam) throw fault; } }), e => e === fault);
      await assert.rejects(readFile(path.join(target.multiPicker.registryDir, 'registry.json')), { code: 'ENOENT' });
    }
    await restoreServiceStopped(options);
    assert.deepEqual(JSON.parse(await readFile(path.join(target.multiPicker.registryDir, 'past-maps', id + '.json'))), before.document);
    const restored = JSON.parse(await readFile(path.join(target.multiPicker.registryDir, 'registry.json'))); assert.equal(restored.pastMaps[0].digest, before.metadata.digest);
  }
});
