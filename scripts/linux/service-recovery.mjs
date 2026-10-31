import path from 'node:path';
import { chown, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { assertReleased, atomic, directory, encode, exists, headroom, inventory, json, noLinks, sha } from './files.mjs';
import { assertSameRelease } from './runtime.mjs';
import { runProbe } from './recovery.mjs';
import { openRegistry, registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { reconcileTombstones as reconcileMP5Tombstones } from '../../app/storage/tombstones.mjs';
import { openAccountStore } from '../../app/storage/accounts.mjs';
import { openInviteStore } from '../../app/storage/invites.mjs';
import { copyServiceTree, pickerId, pickerPath, validateServicePaths, verifyServiceBackup, syncRecoveryTree, syncRecoveryDirectory } from './service-checkpoint.mjs';

// MP5 owns deletion decisions and purge order. The checkpoint registry is
// disposable; the target's external ledger is always opened in place, never
// copied, initialized from a backup, or inferred from checkpoint lifecycle rows.
export async function reconcileServiceRecoveryTombstones({ settings, checkpoint, step = async label => {} }) {
  let interrupted = false;
  const before = async label => { try { await step(label); } catch (error) { interrupted = true; throw error; } };
  const change = async (label, work) => { await before(label); return work(); };
  validateServicePaths(settings);
  const document = registryRecoveryDocument(checkpoint);
  async function reconcile(purge, effectiveDocument = document) {
    const ledger = path.join(settings.multiPicker.tombstoneDir, 'ledger.json');
    if (!await exists(ledger)) throw new Error('Live tombstone ledger is required for service recovery.');
    await noLinks(ledger);
    const owners = [{ file: ledger, ...await lstat(ledger) }];
    await change('reconcile.control', () => directory(settings.controlDir));
    const scratch = await change('reconcile.scratch', () => mkdtemp(path.join(settings.controlDir, 'tombstone-reconcile-')));
    let registry, accounts, invites;
    try {
      const registryDir = path.join(scratch, 'registry'); await change('reconcile.directories', () => directory(registryDir));
      await change('reconcile.checkpoint', () => atomic(path.join(registryDir, 'registry.json'), encode(effectiveDocument)));
      // Planning provisions only disposable directories. Actual purge is deferred
      // until legacy preflight and destination checks have succeeded.
      const pickerRoot = purge ? settings.multiPicker.pickerRoot : path.join(scratch, 'pickers');
      await change('reconcile.directories', () => directory(pickerRoot));
      await before('reconcile.registry');
      registry = await openRegistry({ registryDir, pickerRoot,
        tombstoneDir: settings.multiPicker.tombstoneDir, caps: settings.multiPicker.caps });
      await before('reconcile.registry');
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
        await before('reconcile.purge');
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
        if (!interrupted) await before('reconcile.ownership');
        for (const owner of interrupted ? [] : owners) {
          const current = await lstat(owner.file);
          if (current.uid !== owner.uid || current.gid !== owner.gid) {
            await change('reconcile.ownership', () => chown(owner.file, owner.uid, owner.gid));
            const handle = await open(owner.file, process.platform === 'win32' ? 'r+' : 'r');
            try { await handle.sync(); } finally { await handle.close(); }
          }
        }
      } finally {
        try { await registry?.close(); }
        finally { if (!interrupted) await change('reconcile.cleanup', () => rm(scratch, { recursive: true, force: true })); }
      }
    }
  }
  const planned = await reconcile(false);
  // Planning has completed any MP1 reserved-directory provisioning in scratch;
  // application must not provision unrelated live directories on a refusal.
  return { ...planned, apply: () => reconcile(true, planned.checkpoint) };
}
const mutate = async (step, label, work) => { await step(label); return work(); };
const actionRequired = message => Object.assign(new Error(message), { code: 'OPERATOR_ACTION_REQUIRED' });
// Journal digests are taken after the probe, which may migrate the store. Backup
// bytes satisfy them only when the probe changed nothing; otherwise (or for an
// older journal that did not record it) reset the picker so the rerun copies
// and probes the verified backup again and journals fresh digests.
async function restoreBytes(settings, picker, row, file) {
  if (row.releaseIdentity) return releaseBytes(settings, picker, row);
  if (row.probeChanged === false) return actionRequired(`Restore ${file} from the verified backup after moving its current bytes aside; then rerun.`);
  const target = pickerPath(settings, picker), retained = path.join(quarantineRoot(settings), picker.id);
  const paths = [];
  for (const candidate of [target, target + '.dataset.json', row.installStage, retained, retained + '.dataset.json', retained + '.json']) {
    if (candidate && await exists(candidate)) paths.push(candidate);
  }
  return actionRequired(`Move ${paths.join(', ') || 'nothing'} aside for inspection; replace picker ${picker.id}'s entry in ${progressFile(settings)} with exactly ${JSON.stringify({ id: picker.id, status: 'pending' })}; then rerun.`);
}
// A release must re-probe quarantine, not install pre-probe backup bytes under
// post-probe digests. Cleanup may already have consumed either source endpoint.
async function releaseBytes(settings, picker, row) {
  const target = pickerPath(settings, picker), retained = path.join(quarantineRoot(settings), picker.id);
  const stage = path.join(settings.controlDir, 'release-' + picker.id), journal = path.join(stage, 'progress.json');
  const consumed = !await exists(retained) || !await exists(retained + '.dataset.json');
  const paths = [];
  for (const candidate of [target, target + '.dataset.json', installStage(settings, picker, row), stage,
    ...(consumed ? [retained, retained + '.dataset.json'] : [])]) {
    if (candidate && await exists(candidate)) paths.push(candidate);
  }
  const source = consumed ? `restore ${retained} and ${retained}.dataset.json from an offline copy of the quarantine source matching store digest ${row.quarantineDigest} and binding SHA-256 ${row.quarantineBindingSha256}; ` : '';
  return actionRequired(`Move ${paths.join(', ') || 'nothing'} aside for inspection; ${source}create ${target} containing only operator-quarantine.json with exactly ${JSON.stringify({ id: picker.id })}; write ${retained}.json containing exactly ${JSON.stringify({ id: picker.id, kind: picker.kind, reason: 'incompatible' })}; recreate ${stage} and write ${journal} containing exactly ${JSON.stringify({ id: picker.id, status: 'pending', releaseIdentity: row.releaseIdentity })}; then rerun quarantine release with the same picker and release.`);
}
const probeInput = async store => ({ digest: await identity(store), binding: await exists(store + '.dataset.json') ? sha(await readFile(store + '.dataset.json')) : null });
const probeChanged = async (store, before) => encode(await probeInput(store)) !== encode(before);
const legacyRefusal = () => Object.assign(new Error('Legacy picker is incompatible; service restore refused. Live data was not changed.'), { code: 'LEGACY_RESTORE_INCOMPATIBLE' });
const progressFile = settings => path.join(settings.controlDir, 'service-restore', 'progress.json');
const quarantineRoot = settings => path.join(settings.controlDir, 'quarantine');
const identity = async dir => sha(encode(await inventory(dir)));
async function checkedTarget(dir) { await noLinks(path.dirname(dir)); await assertReleased(dir); }
async function empty(dir) {
  if (await exists(dir)) { await noLinks(dir); if ((await readdir(dir)).length) throw actionRequired(`Service recovery requires empty targets. Move ${dir} aside after checking the verified backup; then rerun.`); }
}
function installStage(settings, picker, row) {
  if (!row.installStage) return;
  const target = pickerPath(settings, picker), prefix = '.' + path.basename(target) + '.restore-';
  if (path.dirname(row.installStage) !== path.dirname(target) || !path.basename(row.installStage).startsWith(prefix)
    || !/^[a-zA-Z0-9]{6}$/.test(path.basename(row.installStage).slice(prefix.length))) throw new Error('Invalid restore staging path.');
  return row.installStage;
}
async function cleanInstallStage(settings, picker, row, step, excluded = false) {
  const stage = installStage(settings, picker, row);
  if (stage && await exists(stage)) {
    await noLinks(stage);
    if (!excluded && (await readdir(stage)).length) throw actionRequired(`Move ${stage} aside after checking the installed target; then rerun.`);
    await mutate(step, 'install.cleanup', () => rm(stage, { recursive: true, force: true }));
    await syncRecoveryDirectory(path.dirname(stage));
  }
}
async function verifyInstalled(settings, picker, target, row) {
  const changed = async file => {
    const error = await restoreBytes(settings, picker, row, file);
    error.message = 'Restore destination changed. ' + error.message;
    return error;
  };
  try {
    if (!row.digest || await identity(target) !== row.digest) throw await changed(target);
  } catch (error) { throw error.code === 'OPERATOR_ACTION_REQUIRED' ? error : await changed(target); }
  if (row.bindingSha256) {
    const binding = target + '.dataset.json';
    try {
      await noLinks(binding);
      if (sha(await readFile(binding)) !== row.bindingSha256) throw await changed(binding);
    } catch (error) { throw error.code === 'OPERATOR_ACTION_REQUIRED' ? error : await changed(binding); }
  }
}
async function installPicker(settings, picker, stage, row, save, step) {
  const target = pickerPath(settings, picker), source = path.join(stage, 'store');
  await checkedTarget(target);
  if (row.status === 'restored') {
    await verifyInstalled(settings, picker, target, row); await cleanInstallStage(settings, picker, row, step); return;
  }
  if (!row.installing) {
    await empty(target);
    if (await exists(target + '.dataset.json')) throw new Error('Existing binding blocks service recovery.');
    row.digest = await identity(source);
    row.bindingSha256 = await exists(source + '.dataset.json') ? sha(await readFile(source + '.dataset.json')) : null;
  }
  if (row.installing && !row.destinationReady && !await exists(source)) throw actionRequired(`Repopulate ${source} from the verified backup; then rerun.`);
  // Keep the resumable journal in controlDir, but prepare both atomic renames
  // on the destination filesystem. No live directory changes before readiness.
  if (!row.installStage) {
    const parent = path.dirname(target), prefix = '.' + path.basename(target) + '.restore-';
    for (const name of await readdir(parent)) if (name.startsWith(prefix) && /^[a-zA-Z0-9]{6}$/.test(name.slice(prefix.length))) {
      throw actionRequired(`Move ${path.join(parent, name)} aside after checking target and source; then rerun.`);
    }
    row.installStage = await mutate(step, 'install.stage-directory', () => mkdtemp(path.join(parent, prefix)));
    await syncRecoveryDirectory(parent); await save('install.stage-intent');
  }
  const local = installStage(settings, picker, row), stageStore = path.join(local, 'store');
  await noLinks(local);
  if (!row.destinationReady) {
    if (!await exists(source)) throw actionRequired(`Repopulate ${source} from the verified backup; then rerun.`);
    if (await identity(source) !== row.digest) throw await restoreBytes(settings, picker, row, source);
    if (await exists(stageStore)) {
      const expected = new Map((await inventory(source)).map(file => [file.path, encode(file)]));
      if ((await inventory(stageStore)).some(file => expected.get(file.path) !== encode(file))) {
        throw actionRequired(`Move ${stageStore} aside after checking migration source ${source}; then rerun.`);
      }
    }
    if (await exists(stageStore + '.dataset.json') && sha(await readFile(stageStore + '.dataset.json')) !== row.bindingSha256) {
      throw actionRequired(`Move ${stageStore}.dataset.json aside after checking migration source ${source}; then rerun.`);
    }
    await mutate(step, 'install.reset-store', () => rm(stageStore, { recursive: true, force: true }));
    await mutate(step, 'install.reset-binding', () => rm(stageStore + '.dataset.json', { force: true }));
    const files = await inventory(source);
    await headroom(path.dirname(target), files.reduce((n, r) => n + (r.bytes ?? 0), 0), settings.minFreeBytes);
    await copyServiceTree(source, stageStore, step, 'install.copy-store');
    if (await identity(stageStore) !== row.digest) throw await restoreBytes(settings, picker, row, stageStore);
    if (row.bindingSha256 && await exists(source + '.dataset.json')) {
      await mutate(step, 'install.copy-binding', () => copyFile(source + '.dataset.json', stageStore + '.dataset.json', 1));
      if (sha(await readFile(stageStore + '.dataset.json')) !== row.bindingSha256) throw await restoreBytes(settings, picker, row, source + '.dataset.json');
    }
    await syncRecoveryTree(local);
    row.destinationReady = true; row.installing = true; await save('install.ready');
  }
  // The intent owns these exact bytes, including the window between store and
  // binding renames. The source copy remains available until installation ends.
  if (await exists(stageStore)) {
    if (await identity(stageStore) !== row.digest) throw await restoreBytes(settings, picker, row, stageStore);
    await empty(target); await mutate(step, 'install.remove-target', () => rm(target, { recursive: true, force: true }));
    await mutate(step, 'install.rename-store', () => rename(stageStore, target));
  }
  if (await exists(stageStore + '.dataset.json')) {
    // Any destination binding here is foreign (the staged one has not moved yet), so
    // backup bytes cannot clear it: it must go aside for the staged rename.
    if (await exists(target + '.dataset.json')) throw actionRequired(`Move ${target}.dataset.json aside after checking ${stageStore}.dataset.json; then rerun.`);
    if (sha(await readFile(stageStore + '.dataset.json')) !== row.bindingSha256) throw await restoreBytes(settings, picker, row, stageStore + '.dataset.json');
    await mutate(step, 'install.rename-binding', () => rename(stageStore + '.dataset.json', target + '.dataset.json'));
  }
  await verifyInstalled(settings, picker, target, row);
  await syncRecoveryDirectory(path.dirname(target)); await syncRecoveryDirectory(local);
  row.status = 'restored'; await save('install.restored');
  await cleanInstallStage(settings, picker, row, step);
}
function unverifiedQuarantine(settings, picker) {
  const target = path.join(quarantineRoot(settings), picker.id);
  return actionRequired(`Move ${target} and ${target}.dataset.json aside for inspection; set picker ${picker.id} status to pending in ${progressFile(settings)}; then rerun.`);
}
async function verifyQuarantined(settings, picker, row) {
  if (!row.digest) throw unverifiedQuarantine(settings, picker);
  const root = quarantineRoot(settings), target = path.join(root, picker.id);
  await verifyInstalled(settings, picker, target, row);
  await assertPlaceholder(settings, picker);
  // The record is small fixed metadata; the backup's gameplay bytes cannot repair it.
  const record = path.join(root, picker.id + '.json'), value = { id: picker.id, kind: picker.kind, reason: 'incompatible' }, expected = encode(value);
  let current; try { current = encode(await json(record)); } catch {}
  if (current !== expected) throw actionRequired(`Move ${record} aside for inspection and write it containing exactly ${JSON.stringify(value)}; then rerun.`);
}
// After quarantine the live picker directory holds only its placeholder; the
// gameplay copy is already verified in quarantine, so restoring backup bytes
// here could never satisfy this check. Name the exact placeholder instead.
async function assertPlaceholder(settings, picker) {
  const original = pickerPath(settings, picker), marker = path.join(original, 'operator-quarantine.json');
  let entries, id; try { entries = await readdir(original); id = (await json(marker)).id; } catch {}
  if (encode(entries ?? null) !== encode(['operator-quarantine.json']) || id !== picker.id)
    throw actionRequired(`Move every entry in ${original} aside for inspection, leaving only ${marker} containing exactly ${JSON.stringify({ id: picker.id })}; then rerun.`);
}
async function quarantine(settings, picker, stageStore, row, save, step) {
  if (picker.kind === 'legacy-shared') throw legacyRefusal();
  const root = quarantineRoot(settings), target = path.join(root, picker.id), original = pickerPath(settings, picker);
  await mutate(step, 'quarantine.directory', () => directory(root)); await noLinks(root); await checkedTarget(original);
  if (row.status !== 'quarantining') {
    row.digest = await identity(stageStore);
    row.bindingSha256 = await exists(stageStore + '.dataset.json') ? sha(await readFile(stageStore + '.dataset.json')) : null;
    row.status = 'quarantining'; await save('quarantine.intent');
  }
  if (!row.digest) throw unverifiedQuarantine(settings, picker);
  if (await exists(stageStore)) {
    if (await exists(target)) throw actionRequired(`Move ${target} aside after checking ${stageStore}; then rerun.`);
    if (await identity(stageStore) !== row.digest) throw await restoreBytes(settings, picker, row, stageStore);
    await mutate(step, 'quarantine.rename-store', () => rename(stageStore, target));
  }
  if (!await exists(target)) throw await restoreBytes(settings, picker, row, target);
  if (await identity(target) !== row.digest) throw await restoreBytes(settings, picker, row, target);
  if (await exists(stageStore + '.dataset.json')) {
    if (await exists(target + '.dataset.json')) throw actionRequired(`Move ${target}.dataset.json aside after checking ${stageStore}.dataset.json; then rerun.`);
    if (sha(await readFile(stageStore + '.dataset.json')) !== row.bindingSha256) throw await restoreBytes(settings, picker, row, stageStore + '.dataset.json');
    await mutate(step, 'quarantine.rename-binding', () => rename(stageStore + '.dataset.json', target + '.dataset.json'));
  }
  await verifyInstalled(settings, picker, target, row);
  if (await exists(original) && (await readdir(original)).length) await assertPlaceholder(settings, picker);
  await mutate(step, 'quarantine.placeholder-directory', () => directory(original));
  await mutate(step, 'quarantine.placeholder', () => atomic(path.join(original, 'operator-quarantine.json'), encode({ id: picker.id })));
  await mutate(step, 'quarantine.record', () => atomic(path.join(root, picker.id + '.json'), encode({ id: picker.id, kind: picker.kind, reason: 'incompatible' })));
  await syncRecoveryDirectory(root); await syncRecoveryDirectory(path.dirname(original));
  row.status = 'quarantined'; await save('quarantine.complete');
}
export async function restoreServiceStopped({ settings, backup, release, assertStopped,
  reconcileTombstones = reconcileServiceRecoveryTombstones, probe = runProbe, onProgress = async () => {}, step = async label => {} }) {
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
      await mutate(step, 'restore.archive', () => rename(progressFile(settings), path.join(work, `progress.complete-${Date.now()}.json`)));
      await syncRecoveryDirectory(work);
      resuming = false;
    } else if (progress.backupSha256 !== backupSha256 || progress.targetIdentity !== targetIdentity) throw new Error('Resume requires the same backup, targets and release.');
  }
  if (!resuming) progress = { backupSha256, targetIdentity, phase: 'prepared', pickers: manifest.pickers.map(p => ({ id: p.id, status: 'pending' })) };
  // MP5 planning call site: before even the legacy probe; no live store changes.
  const reconciled = await reconcileTombstones({ settings, backup, manifest, progress, checkpoint: structuredClone(document), step });
  const excludedPickerIds = new Set([...absent, ...(reconciled?.excludedPickerIds ?? [])]);
  if (reconciled?.checkpoint) {
    const { registryRecoveryDocument } = await import('../../app/storage/registry.mjs');
    document = registryRecoveryDocument(reconciled.checkpoint);
  }
  const legacies = manifest.pickers.filter(p => p.kind === 'legacy-shared');
  if (legacies.length !== 1 || legacies[0].absent || !legacies[0].initialized || !legacies[0].binding || excludedPickerIds.has(legacies[0].id)) throw legacyRefusal();
  const legacy = legacies[0], legacyRow = progress.pickers.find(p => p.id === legacy.id);
  if (['quarantining', 'quarantined'].includes(legacyRow.status)) throw legacyRefusal();
  await mutate(step, 'restore.directories', () => directory(settings.controlDir)); await mutate(step, 'restore.directories', () => directory(work));
  await headroom(settings.controlDir, manifest.files.reduce((n, r) => n + (r.bytes ?? 0), 0), settings.minFreeBytes);
  if (!legacyRow.checked) {
    const stage = path.join(work, legacy.id), store = path.join(stage, 'store');
    await mutate(step, 'restore.legacy-reset', () => rm(stage, { recursive: true, force: true })); await mutate(step, 'restore.directories', () => directory(stage));
    await copyServiceTree(path.join(backup, 'pickers', legacy.id), store, step, 'restore.legacy-copy');
    await mutate(step, 'restore.legacy-copy', () => copyFile(path.join(backup, 'pickers', legacy.id + '.dataset.json'), store + '.dataset.json', 1));
    try {
      const before = await probeInput(store);
      const checked = await probe(release, store, path.join(stage, 'portable.json'));
      legacyRow.probeChanged = await probeChanged(store, before);
      const expected = document.pickers.find(p => p.id === legacy.id)?.memberIds;
      if (!checked?.state?.members || encode(checked.state.members.map(m => m.id)) !== encode(expected)) throw legacyRefusal();
      legacyRow.checkedDigest = await identity(store);
      legacyRow.checkedBindingSha256 = sha(await readFile(store + '.dataset.json'));
      legacyRow.checked = true;
    } catch {
      await mutate(step, 'restore.legacy-reset', () => rm(stage, { recursive: true, force: true }));
      throw legacyRefusal();
    }
  }
  await assertStopped(); await assertSameRelease(release);
  // Nothing in the live registry, picker roots or legacy has changed before the
  // shared duo passes the preflight above. All actual probes use scratch copies.
  await mutate(step, 'restore.directories', () => directory(settings.multiPicker.pickerRoot)); await mutate(step, 'restore.directories', () => directory(settings.multiPicker.registryDir));
  if (!resuming) {
    await empty(settings.multiPicker.registryDir);
    for (const picker of manifest.pickers.filter(p => !excludedPickerIds.has(p.id))) {
      const dir = pickerPath(settings, picker); await checkedTarget(dir); await empty(dir);
      if (await exists(dir + '.dataset.json')) throw new Error('Existing binding blocks service recovery.');
    }
  }
  // Apply MP5's purge/revocation only after the shared duo and empty targets
  // pass. Re-read the live ledger on every attempt, including a resumed restore.
  const applied = await mutate(step, 'restore.reconcile', () => reconciled?.apply?.());
  if (applied) {
    document = registryRecoveryDocument(applied.checkpoint);
    for (const id of applied.excludedPickerIds) excludedPickerIds.add(id);
  }
  const save = async label => { await mutate(step, label, () => atomic(progressFile(settings), encode(progress))); await onProgress(structuredClone(progress)); };
  await save('restore.prepared');
  await assertStopped();
  for (const picker of [legacy, ...manifest.pickers.filter(p => p.kind !== 'legacy-shared')]) {
    const row = progress.pickers.find(r => r.id === picker.id);
    // Scope decisions belong exclusively to MP5 reconciliation.
    if (excludedPickerIds.has(picker.id)) {
      await cleanInstallStage(settings, picker, row, step, true);
      await mutate(step, 'restore.stage-cleanup', () => rm(path.join(work, picker.id), { recursive: true, force: true }));
      row.status = 'excluded'; await save('restore.excluded'); continue;
    }
    if (row.status === 'restored') {
      await verifyInstalled(settings, picker, pickerPath(settings, picker), row);
      await cleanInstallStage(settings, picker, row, step);
      await mutate(step, 'restore.stage-cleanup', () => rm(path.join(work, picker.id), { recursive: true, force: true }));
      continue;
    }
    if (row.status === 'quarantined') {
      await verifyQuarantined(settings, picker, row);
      await mutate(step, 'restore.stage-cleanup', () => rm(path.join(work, picker.id), { recursive: true, force: true }));
      continue;
    }
    const stage = path.join(work, picker.id), stageStore = path.join(stage, 'store');
    if (row.installing) {
      await installPicker(settings, picker, stage, row, save, step);
      await mutate(step, 'restore.stage-cleanup', () => rm(stage, { recursive: true, force: true })); continue;
    }
    if (row.status === 'quarantining') {
      await quarantine(settings, picker, stageStore, row, save, step);
      await mutate(step, 'restore.stage-cleanup', () => rm(stage, { recursive: true, force: true })); continue;
    }
    if (picker.kind === 'legacy-shared') {
      if (!row.checked || await identity(stageStore) !== row.checkedDigest || sha(await readFile(stageStore + '.dataset.json')) !== row.checkedBindingSha256) throw legacyRefusal();
    } else {
      await mutate(step, 'restore.stage-reset', () => rm(stage, { recursive: true, force: true })); await mutate(step, 'restore.stage-directory', () => directory(stage));
      await copyServiceTree(path.join(backup, 'pickers', picker.id), stageStore, step, 'restore.stage-copy');
      if (picker.binding) await mutate(step, 'restore.stage-copy', () => copyFile(path.join(backup, 'pickers', picker.id + '.dataset.json'), stageStore + '.dataset.json', 1));
    }
    let incompatible = false;
    if (picker.kind !== 'legacy-shared') row.probeChanged = false;
    if (picker.initialized && picker.kind !== 'legacy-shared') {
      // Child exits before the next picker starts; no calculator heaps coexist.
      const before = await probeInput(stageStore);
      try {
        const checked = await probe(release, stageStore, path.join(stage, 'portable.json'));
        const expected = document.pickers.find(p => p.id === picker.id).memberIds;
        if (!checked?.state?.members || encode(checked.state.members.map(m => m.id)) !== encode(expected)) throw new Error('Picker membership mismatch.');
      }
      catch { incompatible = true; }
      row.probeChanged = await probeChanged(stageStore, before);
    }
    await assertStopped(); await assertSameRelease(release);
    if (incompatible) await quarantine(settings, picker, stageStore, row, save, step);
    else await installPicker(settings, picker, stage, row, save, step);
    await mutate(step, 'restore.stage-cleanup', () => rm(stage, { recursive: true, force: true }));
  }
  await assertStopped(); await assertSameRelease(release); await verifyServiceBackup(backup);
  const registryFile = path.join(settings.multiPicker.registryDir, 'registry.json'), bytes = encode(document);
  const digest = sha(bytes), previous = await exists(registryFile) ? sha(await readFile(registryFile)) : null;
  if (previous && ![digest, progress.registrySha256, progress.previousRegistrySha256].includes(previous)) throw actionRequired(`Registry destination changed. Move ${registryFile} aside after checking the journal registry digests; then rerun.`);
  // A later tombstone may change our own previously published checkpoint.
  // Journal both hashes before replacement so that intent is also resumable.
  progress.previousRegistrySha256 = previous; progress.registrySha256 = digest; await save('restore.registry-intent');
  if (previous !== digest) await mutate(step, 'restore.registry-publish', () => atomic(registryFile, bytes));
  progress.phase = 'complete'; await save('restore.complete');
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
export async function releaseServiceQuarantine({ settings, id, release, assertStopped, reconcileTombstones = reconcileServiceRecoveryTombstones, probe = runProbe, step = async label => {} }) {
  if (!pickerId(id)) throw new Error('Invalid picker ID.');
  validateServicePaths(settings); await assertStopped();
  const root = quarantineRoot(settings), recordFile = path.join(root, id + '.json');
  const stage = path.join(settings.controlDir, 'release-' + id), journal = path.join(stage, 'progress.json');
  // Cleanup after the install is journaled first, so a retry after the record
  // is gone can still finish and let the operator repair ownership.
  const finish = async row => {
    await verifyInstalled(settings, { id, kind: 'default' }, pickerPath(settings, { id, kind: 'default' }), row);
    const retained = path.join(root, id);
    if (await exists(retained) && (!row.quarantineDigest || await identity(retained) !== row.quarantineDigest)) {
      throw actionRequired(`Move ${retained} aside after checking the installed target; then rerun.`);
    }
    if (await exists(retained + '.dataset.json') && (!row.quarantineBindingSha256 || sha(await readFile(retained + '.dataset.json')) !== row.quarantineBindingSha256)) {
      throw actionRequired(`Move ${retained}.dataset.json aside after checking the installed target; then rerun.`);
    }
    row.status = 'installed'; await mutate(step, 'release.installed', () => atomic(journal, encode(row)));
    await mutate(step, 'release.remove-quarantine', () => rm(path.join(root, id), { recursive: true, force: true })); await mutate(step, 'release.remove-binding', () => rm(path.join(root, id + '.dataset.json'), { force: true }));
    await mutate(step, 'release.remove-record', () => rm(recordFile, { force: true })); await syncRecoveryDirectory(root);
    for (const name of ['store', 'store.dataset.json', 'portable.json']) await mutate(step, 'release.stage-cleanup', () => rm(path.join(stage, name), { recursive: true, force: true }));
    row.status = 'released'; await mutate(step, 'release.complete', () => atomic(journal, encode(row)));
    return { released: id };
  };
  if (!await exists(recordFile)) {
    const done = await exists(journal) ? await json(journal) : null;
    if (done?.id !== id || done.releaseIdentity !== release.identity || !['installed', 'released'].includes(done.status)) throw new Error('No quarantine record for this picker.');
    // Legacy is never quarantine-released, so the install is an owned picker.
    // Startup stays blocked until ownership repair, so it can't have changed.
    await verifyInstalled(settings, { id, kind: 'default' }, pickerPath(settings, { id, kind: 'default' }), done);
    return finish(done);
  }
  const record = await json(recordFile);
  if (record.id !== id) throw new Error('Quarantine record mismatch.');
  if (record.kind === 'legacy-shared') throw legacyRefusal();
  let document = await json(path.join(settings.multiPicker.registryDir, 'registry.json'));
  const planned = await reconcileTombstones({ settings, pickerId: id, checkpoint: structuredClone(document), step });
  const reconciled = await mutate(step, 'release.reconcile', async () => await planned?.apply?.() ?? planned);
  if (reconciled?.excludedPickerIds?.includes(id)) throw new Error('Scope excluded from recovery.');
  document = reconciled?.checkpoint ?? document;
  const picker = document.pickers.find(p => p.id === id);
  if (!picker || picker.lifecycle !== 'active') throw new Error('Scope unavailable for recovery.');
  const target = pickerPath(settings, record), marker = path.join(target, 'operator-quarantine.json');
  await checkedTarget(target);
  await mutate(step, 'release.stage-directory', () => directory(stage));
  let row = await exists(journal) ? await json(journal) : null;
  if (row?.status === 'released') throw actionRequired(`Move ${journal} aside after checking quarantine ${path.join(root, id)}; then rerun.`);
  if (!row) row = { id, status: 'pending', releaseIdentity: release.identity };
  if (row.id !== id || row.releaseIdentity !== release.identity) throw new Error('Quarantine release identity changed.');
  const save = label => mutate(step, label, () => atomic(journal, encode(row)));
  if (row.status === 'installed') return finish(row);
  if (!row.installing) {
    if (encode(await readdir(target)) !== encode(['operator-quarantine.json']) || (await json(marker)).id !== id) throw new Error('Quarantine placeholder changed.');
    await mutate(step, 'release.reset-store', () => rm(path.join(stage, 'store'), { recursive: true, force: true })); await mutate(step, 'release.reset-binding', () => rm(path.join(stage, 'store.dataset.json'), { force: true }));
    await mutate(step, 'release.reset-portable', () => rm(path.join(stage, 'portable.json'), { force: true }));
    row.quarantineDigest = await identity(path.join(root, id));
    row.quarantineBindingSha256 = sha(await readFile(path.join(root, id + '.dataset.json')));
    await copyServiceTree(path.join(root, id), path.join(stage, 'store'), step, 'release.copy-store');
    await mutate(step, 'release.copy-binding', () => copyFile(path.join(root, id + '.dataset.json'), path.join(stage, 'store.dataset.json'), 1));
    const before = await probeInput(path.join(stage, 'store'));
    const checked = await probe(release, path.join(stage, 'store'), path.join(stage, 'portable.json'));
    row.probeChanged = await probeChanged(path.join(stage, 'store'), before);
    if (encode(checked?.state?.members?.map(m => m.id)) !== encode(picker.memberIds)) throw new Error('Quarantine membership mismatch.');
    await assertStopped(); await assertSameRelease(release);
    await syncRecoveryTree(path.join(stage, 'store'));
    row.installing = true; row.digest = await identity(path.join(stage, 'store'));
    row.bindingSha256 = sha(await readFile(path.join(stage, 'store.dataset.json'))); await save('release.intent');
  }
  if (await exists(marker)) {
    if (encode(await readdir(target)) !== encode(['operator-quarantine.json']) || (await json(marker)).id !== id) throw new Error('Quarantine placeholder changed.');
    await mutate(step, 'release.remove-marker', () => rm(marker));
  }
  await installPicker(settings, record, stage, row, save, step);
  return finish(row);
}
