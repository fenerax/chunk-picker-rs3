import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chown, readFile, rm } from 'node:fs/promises';
import { snapshotPath } from '../../app/storage/snapshot.mjs';
import { registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { lockRegistry } from '../../app/storage/registry-lock.mjs';
import { assertReleased, atomic, directory, encode, exists, inventory, json, noLinks } from './files.mjs';
import { assertSameRelease, readRelease } from './runtime.mjs';
import { captureServiceCheckpoint, pickerPath, publishServiceBackup, validateServicePaths } from './service-checkpoint.mjs';
import { listServicePickers, releaseServiceQuarantine, restoreServiceStopped } from './service-recovery.mjs';
import { captureOnline } from './online.mjs';
import { serviceOperation } from './service-lock.mjs';
import { checkStoppedCompatibility } from './recovery.mjs';

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
    if (command === 'health') return healthRecovery({ settings, release, controller, request, assertStopped: stopped });
    if (!['backup', 'restore', 'quarantine-release', 'deploy'].includes(command)) throw new Error('Use health, backup, restore, deploy, list, inspect or quarantine-release.');
    const wasActive = (await controller.state()).active;
    if (['restore', 'quarantine-release'].includes(command) && wasActive) throw new Error('Recovery requires a deliberately stopped service.');
    if (command === 'backup' && argument && argument !== '--stopped') throw new Error('Use backup or backup --stopped.');
    if (command === 'backup' && argument !== '--stopped' && !wasActive) throw new Error('Online backup requires an active service.');
    await atomic(pause, encode({ command: command === 'restore' ? 'service-restore' : command, ...(command === 'restore' ? { backup: path.resolve(argument) } : command === 'quarantine-release' ? { id: argument } : {}) }));
    let result;
    if (command === 'backup') {
      if (argument === '--stopped') { await controller.stop(); await stopped(); }
      try { result = await serviceBackup({ settings, release, request, stopped: argument === '--stopped', assertStopped: stopped }); }
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
    if (['restore', 'quarantine-release'].includes(command)) {
      const { uid, gid } = await serviceIdentity();
      for (const root of [settings.dataDir, settings.multiPicker.registryDir, settings.multiPicker.pickerRoot]) {
        if (!await exists(root)) continue;
        for (const row of await inventory(root)) await chown(path.join(root, row.path), uid, gid);
        await chown(root, uid, gid);
      }
      if (await exists(settings.dataDir + '.dataset.json')) await chown(settings.dataDir + '.dataset.json', uid, gid);
    }
    if (command === 'backup') await atomic(path.join(settings.controlDir, 'service-backup-status.json'), encode({ lastSuccessAt: new Date().toISOString(), byteSize: result.byteSize, pickerCount: result.pickerCount }));
    await rm(pause); return result;
  });
}
