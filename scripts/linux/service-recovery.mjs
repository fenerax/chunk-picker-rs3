import path from 'node:path';
import { copyFile, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { assertReleased, atomic, copyTree, directory, encode, exists, headroom, inventory, json, noLinks, sha } from './files.mjs';
import { assertSameRelease } from './runtime.mjs';
import { runProbe } from './recovery.mjs';
import { pickerId, pickerPath, validateServicePaths, verifyServiceBackup, syncRecoveryTree, syncRecoveryDirectory } from './service-checkpoint.mjs';

// MP5 integration point. Fail closed before ANY probe opens a restored store.
// MP5 supplies this callback; it must retain/reconcile the external live ledger,
// block deleted scopes and revoke credentials before returning. No ledger is
// copied from a backup, initialized here, or inferred from registry rows.
export async function reconcileServiceRecoveryTombstones() {
  throw new Error('MP5 tombstone reconciliation is required before service recovery can open stores.');
}
const legacyRefusal = () => Object.assign(new Error('Legacy picker is incompatible; service restore refused. Live data was not changed.'), { code: 'LEGACY_RESTORE_INCOMPATIBLE' });
const progressFile = settings => path.join(settings.controlDir, 'service-restore', 'progress.json');
const quarantineRoot = settings => path.join(settings.controlDir, 'quarantine');
const identity = async dir => sha(encode(await inventory(dir)));
async function checkedTarget(dir) { await noLinks(path.dirname(dir)); await assertReleased(dir); }
async function empty(dir) {
  if (await exists(dir)) { await noLinks(dir); if ((await readdir(dir)).length) throw new Error('Service recovery requires empty targets.'); }
}
async function installPicker(settings, picker, stage, row, save) {
  const target = pickerPath(settings, picker), stageStore = path.join(stage, 'store');
  await checkedTarget(target);
  if (!row.installing) {
    await empty(target);
    if (await exists(target + '.dataset.json')) throw new Error('Existing binding blocks service recovery.');
    await syncRecoveryTree(stageStore);
    row.installing = true; row.digest = await identity(stageStore);
    row.bindingSha256 = await exists(stageStore + '.dataset.json') ? sha(await readFile(stageStore + '.dataset.json')) : null;
    await save();
  }
  // Durable intent precedes both renames. Resume accepts only exact bytes owned
  // by this operation, including the crash window between store and binding.
  if (await exists(stageStore)) {
    await empty(target); await rm(target, { recursive: true, force: true });
    await rename(stageStore, target);
  }
  if (await identity(target) !== row.digest) throw new Error('Restore destination changed; keep service stopped.');
  if (row.bindingSha256) {
    if (await exists(stageStore + '.dataset.json')) {
      if (await exists(target + '.dataset.json')) throw new Error('Restore binding destination changed.');
      await rename(stageStore + '.dataset.json', target + '.dataset.json');
    }
    await noLinks(target + '.dataset.json');
    if (sha(await readFile(target + '.dataset.json')) !== row.bindingSha256) throw new Error('Restore binding changed.');
  }
  await syncRecoveryDirectory(path.dirname(target)); await syncRecoveryDirectory(stage);
  row.status = 'restored'; await save();
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
  const resuming = await exists(progressFile(settings));
  if (resuming) {
    progress = await json(progressFile(settings));
    if (progress.backupSha256 !== backupSha256 || progress.targetIdentity !== targetIdentity) throw new Error('Resume requires the same backup, targets and release.');
  } else progress = { backupSha256, targetIdentity, phase: 'prepared', pickers: manifest.pickers.map(p => ({ id: p.id, status: 'pending' })) };
  // MP5 integration call site: remains pending, before even the legacy probe.
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
  const save = async () => { await atomic(progressFile(settings), encode(progress)); await onProgress(structuredClone(progress)); };
  await save();
  await assertStopped();
  for (const picker of [legacy, ...manifest.pickers.filter(p => p.kind !== 'legacy-shared')]) {
    const row = progress.pickers.find(r => r.id === picker.id);
    // Scope decisions belong exclusively to the injected MP5 reconciler.
    if (excludedPickerIds.has(picker.id)) { row.status = 'excluded'; await save(); continue; }
    if (row.status === 'restored') {
      const target = pickerPath(settings, picker);
      if (await identity(target) !== row.digest || row.bindingSha256 && sha(await readFile(target + '.dataset.json')) !== row.bindingSha256) throw new Error('Completed restore destination changed.');
      continue;
    }
    if (row.status === 'quarantined') continue;
    const stage = path.join(work, picker.id), stageStore = path.join(stage, 'store');
    if (row.installing) { await installPicker(settings, picker, stage, row, save); continue; }
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
  if (await exists(registryFile) && sha(await readFile(registryFile)) !== sha(bytes)) throw new Error('Registry destination changed.');
  if (!await exists(registryFile)) await atomic(registryFile, bytes);
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
  const root = quarantineRoot(settings), record = await json(path.join(root, id + '.json'));
  if (record.id !== id) throw new Error('Quarantine record mismatch.');
  if (record.kind === 'legacy-shared') throw legacyRefusal();
  let document = await json(path.join(settings.multiPicker.registryDir, 'registry.json'));
  const reconciled = await reconcileTombstones({ settings, pickerId: id, checkpoint: structuredClone(document) });
  if (reconciled?.excludedPickerIds?.includes(id)) throw new Error('Scope excluded from recovery.');
  document = reconciled?.checkpoint ?? document;
  const picker = document.pickers.find(p => p.id === id);
  if (!picker || picker.lifecycle !== 'active') throw new Error('Scope unavailable for recovery.');
  const target = pickerPath(settings, record), marker = path.join(target, 'operator-quarantine.json');
  await checkedTarget(target);
  const stage = path.join(settings.controlDir, 'release-' + id), journal = path.join(stage, 'progress.json');
  await directory(stage);
  let row = await exists(journal) ? await json(journal) : { id, status: 'pending', releaseIdentity: release.identity };
  if (row.id !== id || row.releaseIdentity !== release.identity) throw new Error('Quarantine release identity changed.');
  const save = () => atomic(journal, encode(row));
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
  await rm(path.join(root, id), { recursive: true, force: true }); await rm(path.join(root, id + '.dataset.json'), { force: true });
  await rm(path.join(root, id + '.json')); await syncRecoveryDirectory(root);
  await rm(stage, { recursive: true, force: true });
  return { released: id };
}
