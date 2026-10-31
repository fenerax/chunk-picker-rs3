import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chown, readFile, rm } from 'node:fs/promises';
import { snapshotPath } from '../../app/storage/snapshot.mjs';
import { openRegistry, registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { lockRegistry } from '../../app/storage/registry-lock.mjs';
import { assertReleased, atomic, directory, encode, exists, headroom, inventory, json, noLinks } from './files.mjs';
import { assertSameRelease, readRelease } from './runtime.mjs';
import { captureServiceCheckpoint, pickerPath, publishServiceBackup, validateServicePaths } from './service-checkpoint.mjs';
import { listServicePickers, releaseServiceQuarantine, restoreServiceStopped } from './service-recovery.mjs';
import { captureOnline } from './online.mjs';
import { serviceOperation } from './service-lock.mjs';
import { checkStoppedCompatibility, writeBackupStatus } from './recovery.mjs';

// Hands restored service files back to the service user. The tombstone
// ledger is repaired explicitly: an operator that died after MP5 replaced it
// leaves it root-owned, and a resumed reconcile would preserve that owner.
// The rest of tombstoneDir keeps its owners.
export async function repairServiceOwnership({ settings, uid, gid, change = chown, step = async label => {} }) {
  const repair = async file => { await step('ownership.change'); await change(file, uid, gid); };
  for (const root of [settings.dataDir, settings.multiPicker.registryDir, settings.multiPicker.pickerRoot]) {
    if (!await exists(root)) continue;
    for (const row of await inventory(root)) await repair(path.join(root, row.path));
    await repair(root);
  }
  if (await exists(settings.dataDir + '.dataset.json')) await repair(settings.dataDir + '.dataset.json');
  const ledger = path.join(settings.multiPicker.tombstoneDir, 'ledger.json');
  if (await exists(ledger)) { await noLinks(ledger); await repair(ledger); }
}

export async function assertServiceStopped(settings, controller) {
  if (!(await controller.state()).stopped) throw new Error('Service ownership is uncertain.');
  const releases = [];
  try {
    for (const root of [settings.multiPicker.registryDir, settings.multiPicker.tombstoneDir]) {
      await noLinks(await exists(root) ? root : path.dirname(root));
      if (!await exists(root)) continue;
      const file = path.join(root, 'registry.lock');
      if (await exists(file)) await noLinks(file);
      // The kernel guard plus MP1's PID/host proof can reclaim a dead local
      // operator. Existence alone must not strand an interrupted reconciliation.
      try { releases.push(await lockRegistry(root)); }
      catch (cause) { throw Object.assign(new Error('Registry ownership has not been released.', { cause }), { code: cause.code }); }
    }
    await assertReleased(settings.dataDir);
    const file = path.join(settings.multiPicker.registryDir, 'registry.json');
    if (await exists(file)) {
      await noLinks(file);
      for (const picker of registryRecoveryDocument(await json(file)).pickers) await assertReleased(pickerPath(settings, picker));
    }
  } finally {
    const results = await Promise.allSettled(releases.reverse().map(release => release()));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

export async function serviceBackupWarnings(settings, { now = Date.now(), write = text => process.stderr.write(text) } = {}) {
  try { await headroom(settings.backupDir, 0, settings.minFreeBytes); } catch { write('Recovery disk free-space reserve is unavailable.\n'); }
  let status;
  try { status = await json(path.join(path.dirname(settings.dataDir), 'backup-status.json')); } catch {}
  if (!status?.lastSuccessAt || !Number.isFinite(Date.parse(status.lastSuccessAt)) || now - Date.parse(status.lastSuccessAt) > 172800000) write('Recovery backup is missing or older than two days.\n');
}
function sameService(settings, release) {
  for (const key of ['registryDir', 'pickerRoot', 'tombstoneDir']) if (settings.multiPicker[key] !== release.config.multiPicker?.[key]) throw new Error('Service roots differ from the pinned release.');
}
export async function serviceBackup({ settings, release, request, stopped = false, assertStopped }) {
  let snapshot;
  if (!stopped) snapshot = await captureOnline({ settings, release, request });
  else {
    await assertStopped();
    const id = randomUUID(), source = snapshotPath(settings.dataDir, id);
    const file = path.join(settings.multiPicker.registryDir, 'registry.json'); await noLinks(file);
    const awaitedDocument = await json(file);
    await captureServiceCheckpoint({ settings, id, inputs: release.config.multiPicker.recoveryInputs ?? {
      ...release.config.packs, ...(release.config.selection ? { selection: release.config.selection } : {}),
      ...(release.config.profile ? { profile: release.config.profile } : {}), ...(release.config.addons ? { addons: release.config.addons } : {}) },
    registry: { withRecoveryCheckpoint: work => work(registryRecoveryDocument(awaitedDocument)) } });
    snapshot = { serviceDir: source, cleanup: () => rm(source, { recursive: true, force: true }) };
  }
  try {
    if (stopped) await assertStopped();
    return await publishServiceBackup({ source: snapshot.serviceDir, settings, release, assertRelease: assertSameRelease });
  } finally { await snapshot.cleanup(); }
}
export async function runServiceOperator({ settings, command, argument, evidence, release, controller, request, healthRecovery, deployStopped, serviceIdentity }) {
  validateServicePaths(settings); sameService(settings, release);
  await directory(settings.controlDir);
  const pause = path.join(settings.controlDir, 'maintenance.json');
  return serviceOperation(settings, command, async () => {
    if (command === 'inspect' && !argument) throw new Error('Inspect requires a picker ID.');
    if (['list', 'inspect'].includes(command)) return listServicePickers(settings, command === 'inspect' ? argument : undefined);
    const stopped = () => assertServiceStopped(settings, controller);
    if (await exists(pause)) {
      const previous = await json(pause);
      if (!(command === 'restore' && previous.command === 'service-restore' && previous.backup === path.resolve(argument) || command === 'quarantine-release' && previous.command === command && previous.id === argument)) throw new Error('Reconcile maintenance evidence before continuing.');
    }
    if (command === 'relink-code') {
      if (!argument) throw new Error('Relink-code requires an account ID.');
      if ((await controller.state()).active) return request(release, '/api/operator/relink-code', 'POST', { accountId: argument });
      await stopped();
      const origin = (await readFile(release.config.publicOriginFile, 'utf8')).trim();
      if (new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:') throw new Error('An HTTPS public origin is required.');
      const identity = await serviceIdentity();
      let registry, result;
      try {
        registry = await openRegistry({ ...settings.multiPicker, legacyDir: settings.dataDir });
        result = await registry.issueRelinkCode(argument);
      } finally {
        // Opening the registry replaces protected files even if issuance refuses.
        try { await registry?.close(); }
        finally { await repairServiceOwnership({ settings, ...identity }); }
      }
      return { claimLink: `${origin}/auth/reclaim?code=${result.code}`, expiresAt: result.expiresAt };
    }
    if (command === 'health') {
      // Same operator warnings as the single-duo path, from the same status file.
      await serviceBackupWarnings(settings);
      return healthRecovery({ settings, release, controller, request, assertStopped: stopped });
    }
    if (!['backup', 'restore', 'quarantine-release', 'deploy'].includes(command)) throw new Error('Use health, backup, restore, deploy, list, inspect, relink-code or quarantine-release.');
    const wasActive = (await controller.state()).active;
    if (['restore', 'quarantine-release'].includes(command) && wasActive) throw new Error('Recovery requires a deliberately stopped service.');
    if (command === 'backup' && argument && argument !== '--stopped') throw new Error('Use backup or backup --stopped.');
    if (command === 'backup' && argument !== '--stopped' && !wasActive) throw new Error('Online backup requires an active service.');
    await atomic(pause, encode({ command: command === 'restore' ? 'service-restore' : command, ...(command === 'restore' ? { backup: path.resolve(argument) } : command === 'quarantine-release' ? { id: argument } : {}) }));
    let result;
    if (command === 'backup') {
      if (argument === '--stopped') { await controller.stop(); await stopped(); }
      // Same service-readable status the admin UI and single-duo backups use.
      const at = new Date().toISOString();
      await atomic(path.join(path.dirname(settings.dataDir), 'backup-destination'), 'managed\n', 0o644);
      try {
        result = await serviceBackup({ settings, release, request, stopped: argument === '--stopped', assertStopped: stopped });
        await writeBackupStatus(settings.dataDir, { result: 'success', byteSize: result.byteSize, at });
      } catch (error) { await writeBackupStatus(settings.dataDir, { result: 'failed', at }); throw error; }
      finally { if (argument === '--stopped' && wasActive) { await stopped(); await controller.start(); } }
    } else if (command === 'restore') {
      await stopped();
      result = await restoreServiceStopped({ settings, backup: argument, release, assertStopped: stopped });
    } else if (command === 'quarantine-release') {
      result = await releaseServiceQuarantine({ settings, id: argument, release, assertStopped: stopped });
    } else {
      const candidate = await readRelease(argument, settings.dataDir); sameService(settings, candidate);
      if (release.config.datasetId !== candidate.config.datasetId || ['data', 'rulesText', 'art'].some(key => release.config.packs?.[key]?.sha256 !== candidate.config.packs?.[key]?.sha256) || ['profile', 'addons', 'selection'].some(key => release.config[key]?.sha256 !== candidate.config[key]?.sha256)) throw new Error('Service pack changes require sequential recovery; in-place deploy refused.');
      let savedIdentityAdditions;
      if (evidence && evidence !== '--stopped') {
        const receipt = await json(evidence);
        const { sha } = await import('./files.mjs');
        if (receipt.previousPointerSha256 !== sha(release.pointerBytes) || receipt.candidateIdentity !== candidate.identity || path.resolve(receipt.pointer) !== path.resolve(argument)) throw new Error('Staged deployment receipt changed.');
        savedIdentityAdditions = receipt.savedIdentityAdditions;
      }
      // Every store is probed sequentially while stopped. No per-picker heap is
      // left alive across iterations. The existing pointer CAS/rollback remains.
      const check = async options => {
        await stopped();
        const document = registryRecoveryDocument(await json(path.join(settings.multiPicker.registryDir, 'registry.json')));
        for (const picker of document.pickers.filter(p => p.lifecycle === 'active')) {
          const dataDir = pickerPath(settings, picker);
          if (await exists(path.join(dataDir, 'operator-quarantine.json'))) continue;
          if (await exists(path.join(dataDir, 'state.json'))) await checkStoppedCompatibility({ ...options, dataDir, assertStopped: stopped });
        }
      };
      result = await deployStopped({ settings, current: release, candidate, controller, request, check, savedIdentityAdditions });
    }
    if (['restore', 'quarantine-release'].includes(command)) await repairServiceOwnership({ settings, ...await serviceIdentity() });
    await rm(pause); return result;
  });
}
