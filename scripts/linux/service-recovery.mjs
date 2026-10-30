import path from 'node:path';
import { chown, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { assertReleased, atomic, copyTree, directory, encode, exists, headroom, inventory, json, noLinks, sha } from './files.mjs';
import { assertSameRelease } from './runtime.mjs';
import { runProbe } from './recovery.mjs';
import { openRegistry, registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { reconcileTombstones as reconcileMP5Tombstones } from '../../app/storage/tombstones.mjs';
import { openAccountStore } from '../../app/storage/accounts.mjs';
import { openInviteStore } from '../../app/storage/invites.mjs';
import { pickerId, pickerPath, validateServicePaths, verifyServiceBackup, syncRecoveryTree, syncRecoveryDirectory } from './service-checkpoint.mjs';

// MP5 owns deletion decisions and purge order. The checkpoint registry is
// disposable; the target's external ledger is always opened in place, never
// copied, initialized from a backup, or inferred from checkpoint lifecycle rows.
export async function reconcileServiceRecoveryTombstones({ settings, checkpoint }) {
  validateServicePaths(settings);
  const document = registryRecoveryDocument(checkpoint);
  async function reconcile(purge, effectiveDocument = document) {
    const ledger = path.join(settings.multiPicker.tombstoneDir, 'ledger.json');
    if (!await exists(ledger)) throw new Error('Live tombstone ledger is required for service recovery.');
    await noLinks(ledger);
    const owners = [{ file: ledger, ...await lstat(ledger) }];
    await directory(settings.controlDir);
    const scratch = await mkdtemp(path.join(settings.controlDir, 'tombstone-reconcile-'));
    let registry, accounts, invites;
    try {
      const registryDir = path.join(scratch, 'registry'); await directory(registryDir);
      await atomic(path.join(registryDir, 'registry.json'), encode(effectiveDocument));
      // Planning provisions only disposable directories. Actual purge is deferred
      // until legacy preflight and destination checks have succeeded.
      const pickerRoot = purge ? settings.multiPicker.pickerRoot : path.join(scratch, 'pickers');
      await directory(pickerRoot);
      registry = await openRegistry({ registryDir, pickerRoot,
        tombstoneDir: settings.multiPicker.tombstoneDir, caps: settings.multiPicker.caps });
      const decisions = await registry.reconcileTombstones();
      if (effectiveDocument.pickers.some(p => p.kind === 'legacy-shared' && decisions.blockedPickerIds.includes(p.id))) throw legacyRefusal();
      if (purge) {
        // These sidecar APIs do not open gameplay or calculators. No credentials
        // from a backup enter them; missing issuer files remain missing.
        for (const name of ['accounts.json', 'invites.json']) {
          const file = path.join(settings.dataDir, name);
          if (await exists(file)) {
            await checkedTarget(settings.dataDir); await noLinks(file);
            owners.push({ file, ...await lstat(file) });
          }
        }
        if (await exists(path.join(settings.dataDir, 'accounts.json'))) accounts = await openAccountStore({ dataDir: settings.dataDir });
        if (await exists(path.join(settings.dataDir, 'invites.json'))) invites = await openInviteStore({ dataDir: settings.dataDir, masterLabel: 'Administrator', pickerRegistry: registry });
        const revokeAccount = async accountId => {
          await invites?.revokeDeletion({ accountId }); await accounts?.revokeDeletion(accountId);
        };
        await reconcileMP5Tombstones({ registry,
          revokeSessions: scope => invites?.revokeDeletion(scope), revokeAccount,
          drainPicker: async id => {
            const dir = registry.deletionDirectory(id);
            await checkedTarget(dir);
            if (await exists(dir)) await noLinks(dir);
            if (await exists(dir + '.dataset.json')) await noLinks(dir + '.dataset.json');
          } });
        // Older retired-account records have no runtime-purge marker. Recovery
        // still must not retain their issuer credentials or legacy account rows.
        for (const id of decisions.deletedAccountIds) await revokeAccount(id);
        if (invites || accounts) await syncRecoveryDirectory(settings.dataDir);
      }
      return { checkpoint: await registry.withRecoveryCheckpoint(value => value), excludedPickerIds: decisions.blockedPickerIds };
    } finally {
      try {
        await invites?.close(); await accounts?.close();
        // Preserve service ownership after atomic replacement, even when a
        // root-run operator refuses recovery or quarantine release.
        for (const owner of owners) {
          const current = await lstat(owner.file);
          if (current.uid !== owner.uid || current.gid !== owner.gid) {
            await chown(owner.file, owner.uid, owner.gid);
            const handle = await open(owner.file, process.platform === 'win32' ? 'r+' : 'r');
            try { await handle.sync(); } finally { await handle.close(); }
          }
        }
      } finally {
        try { await registry?.close(); }
        finally { await rm(scratch, { recursive: true, force: true }); }
      }
    }
  }
  const planned = await reconcile(false);
  // Planning has completed any MP1 reserved-directory provisioning in scratch;
  // application must not provision unrelated live directories on a refusal.
  return { ...planned, apply: () => reconcile(true, planned.checkpoint) };
}
const legacyRefusal = () => Object.assign(new Error('Legacy picker is incompatible; service restore refused. Live data was not changed.'), { code: 'LEGACY_RESTORE_INCOMPATIBLE' });
const progressFile = settings => path.join(settings.controlDir, 'service-restore', 'progress.json');
const quarantineRoot = settings => path.join(settings.controlDir, 'quarantine');
const identity = async dir => sha(encode(await inventory(dir)));
async function checkedTarget(dir) { await noLinks(path.dirname(dir)); await assertReleased(dir); }
async function empty(dir) {
  if (await exists(dir)) { await noLinks(dir); if ((await readdir(dir)).length) throw new Error('Service recovery requires empty targets.'); }
}
function installStage(settings, picker, row) {
  if (!row.installStage) return;
  const target = pickerPath(settings, picker), prefix = '.' + path.basename(target) + '.restore-';
  if (path.dirname(row.installStage) !== path.dirname(target) || !path.basename(row.installStage).startsWith(prefix)
    || !/^[a-zA-Z0-9]{6}$/.test(path.basename(row.installStage).slice(prefix.length))) throw new Error('Invalid restore staging path.');
  return row.installStage;
}
async function cleanInstallStage(settings, picker, row) {
  const stage = installStage(settings, picker, row);
  if (stage && await exists(stage)) {
    await noLinks(stage); await rm(stage, { recursive: true, force: true });
    await syncRecoveryDirectory(path.dirname(stage));
  }
}
async function verifyInstalled(target, row) {
  if (await identity(target) !== row.digest) throw new Error('Restore destination changed; keep service stopped.');
  if (row.bindingSha256) {
    await noLinks(target + '.dataset.json');
    if (sha(await readFile(target + '.dataset.json')) !== row.bindingSha256) throw new Error('Restore binding changed.');
  }
}
async function installPicker(settings, picker, stage, row, save) {
  const target = pickerPath(settings, picker), source = path.join(stage, 'store');
  await checkedTarget(target);
  if (row.status === 'restored') {
    await verifyInstalled(target, row); await cleanInstallStage(settings, picker, row); return;
  }
  if (!row.installing) {
    await empty(target);
    if (await exists(target + '.dataset.json')) throw new Error('Existing binding blocks service recovery.');
    row.digest = await identity(source);
    row.bindingSha256 = await exists(source + '.dataset.json') ? sha(await readFile(source + '.dataset.json')) : null;
  }
  // Keep the resumable journal in controlDir, but prepare both atomic renames
  // on the destination filesystem. No live directory changes before readiness.
  if (!row.installStage) {
    row.installStage = await mkdtemp(path.join(path.dirname(target), '.' + path.basename(target) + '.restore-'));
    await syncRecoveryDirectory(path.dirname(target)); await save();
  }
  const local = installStage(settings, picker, row), stageStore = path.join(local, 'store');
  await noLinks(local);
  if (!row.destinationReady) {
    await rm(stageStore, { recursive: true, force: true }); await rm(stageStore + '.dataset.json', { force: true });
    if (await exists(source)) {
      const files = await inventory(source);
      await headroom(path.dirname(target), files.reduce((n, r) => n + (r.bytes ?? 0), 0), settings.minFreeBytes);
      await copyTree(source, stageStore);
      if (await identity(stageStore) !== row.digest) throw new Error('Restore source changed.');
    } else {
      // Upgrade an older intent whose store rename already completed, but whose
      // binding was still in controlDir (including an earlier EXDEV refusal).
      if (!row.installing || await identity(target) !== row.digest) throw new Error('Restore source is missing.');
    }
    if (row.bindingSha256 && await exists(source + '.dataset.json')) {
      await copyFile(source + '.dataset.json', stageStore + '.dataset.json', 1);
      if (sha(await readFile(stageStore + '.dataset.json')) !== row.bindingSha256) throw new Error('Restore source binding changed.');
    }
    await syncRecoveryTree(local);
    row.destinationReady = true; row.installing = true; await save();
  }
  // The intent owns these exact bytes, including the window between store and
  // binding renames. The source copy remains available until installation ends.
  if (await exists(stageStore)) {
    if (await identity(stageStore) !== row.digest) throw new Error('Restore staged data changed.');
    await empty(target); await rm(target, { recursive: true, force: true });
    await rename(stageStore, target);
  }
  if (await exists(stageStore + '.dataset.json')) {
    if (await exists(target + '.dataset.json')) throw new Error('Restore binding destination changed.');
    if (sha(await readFile(stageStore + '.dataset.json')) !== row.bindingSha256) throw new Error('Restore staged binding changed.');
    await rename(stageStore + '.dataset.json', target + '.dataset.json');
  }
  await verifyInstalled(target, row);
  await syncRecoveryDirectory(path.dirname(target)); await syncRecoveryDirectory(local);
  row.status = 'restored'; await save();
  await cleanInstallStage(settings, picker, row);
}
async function quarantine(settings, picker, stageStore, row, save) {
  if (picker.kind === 'legacy-shared') throw legacyRefusal();
  const root = quarantineRoot(settings), target = path.join(root, picker.id), original = pickerPath(settings, picker);
  await directory(root); await noLinks(root); await checkedTarget(original);
  row.status = 'quarantining'; await save();
  if (await exists(stageStore)) {
    if (await exists(target)) throw new Error('Quarantine destination occupied.');
    await rename(stageStore, target);
  }
  if (await exists(stageStore + '.dataset.json')) await rename(stageStore + '.dataset.json', target + '.dataset.json');
  if (await exists(original) && (await readdir(original)).length) {
    if (encode(await readdir(original)) !== encode(['operator-quarantine.json']) || (await json(path.join(original, 'operator-quarantine.json'))).id !== picker.id) throw new Error('Quarantine placeholder changed.');
  }
  await directory(original);
  await atomic(path.join(original, 'operator-quarantine.json'), encode({ id: picker.id }));
  await atomic(path.join(root, picker.id + '.json'), encode({ id: picker.id, kind: picker.kind, reason: 'incompatible' }));
  await syncRecoveryDirectory(root); await syncRecoveryDirectory(path.dirname(original));
  row.status = 'quarantined'; await save();
}
export async function restoreServiceStopped({ settings, backup, release, assertStopped,
  reconcileTombstones = reconcileServiceRecoveryTombstones, probe = runProbe, onProgress = async () => {} }) {
  validateServicePaths(settings);
  if (typeof assertStopped !== 'function') throw new Error('Stopped-service proof required.');
  await assertStopped();
  const manifest = await verifyServiceBackup(backup), backupSha256 = sha(await readFile(path.join(backup, 'manifest.json')));
  let document = await json(path.join(backup, 'registry.json'));
  const absent = new Set(manifest.pickers.filter(p => p.absent).map(p => p.id));
  // This is a projection of the backup manifest, not a tombstone decision.
  // Omitted data must not be initialized as a fresh game under a captured ID.
  document.pickers = document.pickers.filter(p => !absent.has(p.id));
  for (const account of document.accounts) {
    account.memberships = account.memberships.filter(m => !absent.has(m.pickerId));
    if (absent.has(account.defaultPickerId)) account.defaultPickerId = null;
  }
  const work = path.dirname(progressFile(settings));
  let progress;
  const targetIdentity = sha(encode({ dataDir: settings.dataDir, multiPicker: settings.multiPicker, releaseIdentity: release.identity }));
  let resuming = await exists(progressFile(settings));
  if (resuming) {
    progress = await json(progressFile(settings));
    // A finished restore is history, not an operation to resume, once a
    // different backup or target is chosen or its registry is gone (the disks
    // were recovered again). Archive it; the empty-target checks below apply.
    // The same completed restore still resumes, so an operator that died before
    // ownership repair can finish.
    const registryGone = !await exists(path.join(settings.multiPicker.registryDir, 'registry.json'));
    if (progress.phase === 'complete' && (registryGone || progress.backupSha256 !== backupSha256 || progress.targetIdentity !== targetIdentity)) {
      await rename(progressFile(settings), path.join(work, `progress.complete-${Date.now()}.json`));
      await syncRecoveryDirectory(work);
      resuming = false;
    } else if (progress.backupSha256 !== backupSha256 || progress.targetIdentity !== targetIdentity) throw new Error('Resume requires the same backup, targets and release.');
  }
  if (!resuming) progress = { backupSha256, targetIdentity, phase: 'prepared', pickers: manifest.pickers.map(p => ({ id: p.id, status: 'pending' })) };
  // MP5 planning call site: before even the legacy probe; no live store changes.
  const reconciled = await reconcileTombstones({ settings, backup, manifest, progress, checkpoint: structuredClone(document) });
  const excludedPickerIds = new Set([...absent, ...(reconciled?.excludedPickerIds ?? [])]);
  if (reconciled?.checkpoint) {
    const { registryRecoveryDocument } = await import('../../app/storage/registry.mjs');
    document = registryRecoveryDocument(reconciled.checkpoint);
  }
  const legacies = manifest.pickers.filter(p => p.kind === 'legacy-shared');
  if (legacies.length !== 1 || legacies[0].absent || !legacies[0].initialized || !legacies[0].binding || excludedPickerIds.has(legacies[0].id)) throw legacyRefusal();
  const legacy = legacies[0], legacyRow = progress.pickers.find(p => p.id === legacy.id);
  if (['quarantining', 'quarantined'].includes(legacyRow.status)) throw legacyRefusal();
  await directory(settings.controlDir); await directory(work);
  await headroom(settings.controlDir, manifest.files.reduce((n, r) => n + (r.bytes ?? 0), 0), settings.minFreeBytes);
  if (!legacyRow.checked) {
    const stage = path.join(work, legacy.id), store = path.join(stage, 'store');
    await rm(stage, { recursive: true, force: true }); await directory(stage);
    await copyTree(path.join(backup, 'pickers', legacy.id), store);
    await copyFile(path.join(backup, 'pickers', legacy.id + '.dataset.json'), store + '.dataset.json', 1);
    try {
      const checked = await probe(release, store, path.join(stage, 'portable.json'));
      const expected = document.pickers.find(p => p.id === legacy.id)?.memberIds;
      if (!checked?.state?.members || encode(checked.state.members.map(m => m.id)) !== encode(expected)) throw legacyRefusal();
      legacyRow.checkedDigest = await identity(store);
      legacyRow.checkedBindingSha256 = sha(await readFile(store + '.dataset.json'));
      legacyRow.checked = true;
    } catch {
      await rm(stage, { recursive: true, force: true });
      throw legacyRefusal();
    }
  }
  await assertStopped(); await assertSameRelease(release);
  // Nothing in the live registry, picker roots or legacy has changed before the
  // shared duo passes the preflight above. All actual probes use scratch copies.
  await directory(settings.multiPicker.pickerRoot); await directory(settings.multiPicker.registryDir);
  if (!resuming) {
    await empty(settings.multiPicker.registryDir);
    for (const picker of manifest.pickers.filter(p => !excludedPickerIds.has(p.id))) {
      const dir = pickerPath(settings, picker); await checkedTarget(dir); await empty(dir);
      if (await exists(dir + '.dataset.json')) throw new Error('Existing binding blocks service recovery.');
    }
  }
  // Apply MP5's purge/revocation only after the shared duo and empty targets
  // pass. Re-read the live ledger on every attempt, including a resumed restore.
  const applied = await reconciled?.apply?.();
  if (applied) {
    document = registryRecoveryDocument(applied.checkpoint);
    for (const id of applied.excludedPickerIds) excludedPickerIds.add(id);
  }
  const save = async () => { await atomic(progressFile(settings), encode(progress)); await onProgress(structuredClone(progress)); };
  await save();
  await assertStopped();
  for (const picker of [legacy, ...manifest.pickers.filter(p => p.kind !== 'legacy-shared')]) {
    const row = progress.pickers.find(r => r.id === picker.id);
    // Scope decisions belong exclusively to MP5 reconciliation.
    if (excludedPickerIds.has(picker.id)) {
      await cleanInstallStage(settings, picker, row);
      await rm(path.join(work, picker.id), { recursive: true, force: true });
      row.status = 'excluded'; await save(); continue;
    }
    if (row.status === 'restored') {
      await verifyInstalled(pickerPath(settings, picker), row);
      await cleanInstallStage(settings, picker, row);
      await rm(path.join(work, picker.id), { recursive: true, force: true });
      continue;
    }
    if (row.status === 'quarantined') continue;
    const stage = path.join(work, picker.id), stageStore = path.join(stage, 'store');
    if (row.installing) {
      await installPicker(settings, picker, stage, row, save);
      await rm(stage, { recursive: true, force: true }); continue;
    }
    if (row.status === 'quarantining') { await quarantine(settings, picker, stageStore, row, save); continue; }
    if (picker.kind === 'legacy-shared') {
      if (!row.checked || await identity(stageStore) !== row.checkedDigest || sha(await readFile(stageStore + '.dataset.json')) !== row.checkedBindingSha256) throw legacyRefusal();
    } else {
      await rm(stage, { recursive: true, force: true }); await directory(stage);
      await copyTree(path.join(backup, 'pickers', picker.id), stageStore);
      if (picker.binding) await copyFile(path.join(backup, 'pickers', picker.id + '.dataset.json'), stageStore + '.dataset.json', 1);
    }
    let incompatible = false;
    if (picker.initialized && picker.kind !== 'legacy-shared') {
      // Child exits before the next picker starts; no calculator heaps coexist.
      try {
        const checked = await probe(release, stageStore, path.join(stage, 'portable.json'));
        const expected = document.pickers.find(p => p.id === picker.id).memberIds;
        if (!checked?.state?.members || encode(checked.state.members.map(m => m.id)) !== encode(expected)) throw new Error('Picker membership mismatch.');
      }
      catch { incompatible = true; }
    }
    await assertStopped(); await assertSameRelease(release);
    if (incompatible) await quarantine(settings, picker, stageStore, row, save);
    else await installPicker(settings, picker, stage, row, save);
    await rm(stage, { recursive: true, force: true });
  }
  await assertStopped(); await assertSameRelease(release); await verifyServiceBackup(backup);
  const registryFile = path.join(settings.multiPicker.registryDir, 'registry.json'), bytes = encode(document);
  const digest = sha(bytes), previous = await exists(registryFile) ? sha(await readFile(registryFile)) : null;
  if (previous && ![digest, progress.registrySha256, progress.previousRegistrySha256].includes(previous)) throw new Error('Registry destination changed.');
  // A later tombstone may change our own previously published checkpoint.
  // Journal both hashes before replacement so that intent is also resumable.
  progress.previousRegistrySha256 = previous; progress.registrySha256 = digest; await save();
  if (previous !== digest) await atomic(registryFile, bytes);
  progress.phase = 'complete'; await save();
  return { restored: progress.pickers.filter(p => p.status === 'restored').length,
    quarantined: progress.pickers.filter(p => p.status === 'quarantined').map(p => p.id), excluded: progress.pickers.filter(p => p.status === 'excluded').length, credentialsRestored: 0 };
}
export async function listServicePickers(settings, id) {
  validateServicePaths(settings);
  const { registryRecoveryDocument } = await import('../../app/storage/registry.mjs');
  await noLinks(path.join(settings.multiPicker.registryDir, 'registry.json'));
  const document = registryRecoveryDocument(await json(path.join(settings.multiPicker.registryDir, 'registry.json')));
  if (id !== undefined && (!pickerId(id) || !document.pickers.some(p => p.id === id))) throw new Error('Unknown picker ID.');
  const rows = [];
  for (const picker of document.pickers.filter(p => id === undefined || p.id === id)) {
    const dir = pickerPath(settings, picker);
    const files = await exists(dir) ? await inventory(dir) : [];
    const quarantined = await exists(path.join(quarantineRoot(settings), picker.id + '.json'));
    const quarantineFiles = quarantined && await exists(path.join(quarantineRoot(settings), picker.id)) ? await inventory(path.join(quarantineRoot(settings), picker.id)) : [];
    rows.push({ id: picker.id, lifecycle: picker.lifecycle, provisioning: picker.provisioning, quarantined,
      quarantineFiles: quarantineFiles.filter(r => !r.directory).length, quarantineBytes: quarantineFiles.reduce((n, r) => n + (r.bytes ?? 0), 0),
      files: files.filter(r => !r.directory).length, bytes: files.reduce((n, r) => n + (r.bytes ?? 0), 0) });
  }
  return { pickerCount: rows.length, files: rows.reduce((n, r) => n + r.files, 0), bytes: rows.reduce((n, r) => n + r.bytes, 0), pickers: rows };
}
export async function releaseServiceQuarantine({ settings, id, release, assertStopped, reconcileTombstones = reconcileServiceRecoveryTombstones, probe = runProbe }) {
  if (!pickerId(id)) throw new Error('Invalid picker ID.');
  validateServicePaths(settings); await assertStopped();
  const root = quarantineRoot(settings), recordFile = path.join(root, id + '.json');
  const stage = path.join(settings.controlDir, 'release-' + id), journal = path.join(stage, 'progress.json');
  // Cleanup after the install is journaled first, so a retry after the record
  // is gone can still finish and let the operator repair ownership.
  const finish = async row => {
    row.status = 'installed'; await atomic(journal, encode(row));
    await rm(path.join(root, id), { recursive: true, force: true }); await rm(path.join(root, id + '.dataset.json'), { force: true });
    await rm(recordFile, { force: true }); await syncRecoveryDirectory(root);
    for (const name of ['store', 'store.dataset.json', 'portable.json']) await rm(path.join(stage, name), { recursive: true, force: true });
    row.status = 'released'; await atomic(journal, encode(row));
    return { released: id };
  };
  if (!await exists(recordFile)) {
    const done = await exists(journal) ? await json(journal) : null;
    if (done?.id !== id || done.releaseIdentity !== release.identity || !['installed', 'released'].includes(done.status)) throw new Error('No quarantine record for this picker.');
    // Legacy is never quarantine-released, so the install is an owned picker.
    // Startup stays blocked until ownership repair, so it can't have changed.
    if (done.status === 'installed') await verifyInstalled(pickerPath(settings, { id, kind: 'default' }), done);
    return finish(done);
  }
  const record = await json(recordFile);
  if (record.id !== id) throw new Error('Quarantine record mismatch.');
  if (record.kind === 'legacy-shared') throw legacyRefusal();
  let document = await json(path.join(settings.multiPicker.registryDir, 'registry.json'));
  const planned = await reconcileTombstones({ settings, pickerId: id, checkpoint: structuredClone(document) });
  const reconciled = await planned?.apply?.() ?? planned;
  if (reconciled?.excludedPickerIds?.includes(id)) throw new Error('Scope excluded from recovery.');
  document = reconciled?.checkpoint ?? document;
  const picker = document.pickers.find(p => p.id === id);
  if (!picker || picker.lifecycle !== 'active') throw new Error('Scope unavailable for recovery.');
  const target = pickerPath(settings, record), marker = path.join(target, 'operator-quarantine.json');
  await checkedTarget(target);
  await directory(stage);
  let row = await exists(journal) ? await json(journal) : null;
  // A journal left by an earlier, finished release of the same ID is history.
  if (!row || row.status === 'released') row = { id, status: 'pending', releaseIdentity: release.identity };
  if (row.id !== id || row.releaseIdentity !== release.identity) throw new Error('Quarantine release identity changed.');
  const save = () => atomic(journal, encode(row));
  if (row.status === 'installed') return finish(row);
  if (!row.installing) {
    if (encode(await readdir(target)) !== encode(['operator-quarantine.json']) || (await json(marker)).id !== id) throw new Error('Quarantine placeholder changed.');
    await rm(path.join(stage, 'store'), { recursive: true, force: true }); await rm(path.join(stage, 'store.dataset.json'), { force: true });
    await rm(path.join(stage, 'portable.json'), { force: true });
    await copyTree(path.join(root, id), path.join(stage, 'store'));
    await copyFile(path.join(root, id + '.dataset.json'), path.join(stage, 'store.dataset.json'), 1);
    const checked = await probe(release, path.join(stage, 'store'), path.join(stage, 'portable.json'));
    if (encode(checked?.state?.members?.map(m => m.id)) !== encode(picker.memberIds)) throw new Error('Quarantine membership mismatch.');
    await assertStopped(); await assertSameRelease(release);
    await syncRecoveryTree(path.join(stage, 'store'));
    row.installing = true; row.digest = await identity(path.join(stage, 'store'));
    row.bindingSha256 = sha(await readFile(path.join(stage, 'store.dataset.json'))); await save();
  }
  if (await exists(marker)) {
    if (encode(await readdir(target)) !== encode(['operator-quarantine.json']) || (await json(marker)).id !== id) throw new Error('Quarantine placeholder changed.');
    await rm(marker);
  }
  await installPicker(settings, record, stage, row, save);
  return finish(row);
}
