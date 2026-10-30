import path from 'node:path';
import { copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { packRelative } from '../../app/packs.mjs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { snapshotPath, snapshotRoot, withDirectoryBarriers } from '../../app/storage/snapshot.mjs';
import { atomic, copyTree, directory, encode, exists, headroom, inventory, json, noLinks, outside, sha } from './files.mjs';

export const serviceFormat = 'picker-service-recovery-v1';
export const pickerId = id => /^p_[0-9a-f]{32}$/.test(id);
const gameplayRoots = new Set(['state.json', 'static', 'history', 'backups', 'plugin-achievements.json', 'plugin-items.json']);
export function pickerPath(settings, picker) {
  if (!pickerId(picker.id) || !['default', 'legacy-shared'].includes(picker.kind)) throw new Error('Invalid picker manifest.');
  return picker.kind === 'legacy-shared' ? settings.dataDir : path.join(settings.multiPicker.pickerRoot, picker.id);
}
export async function syncRecoveryTree(root) {
  const rows = await inventory(root);
  for (const file of [...rows.filter(r => !r.directory).map(r => path.join(root, r.path)),
    ...rows.filter(r => r.directory).map(r => path.join(root, r.path)).reverse(), root]) {
    if (process.platform === 'win32' && (file === root || rows.some(r => r.directory && path.join(root, r.path) === file))) continue;
    // Windows only flushes a file through a handle opened for writing.
    const handle = await open(file, process.platform === 'win32' ? 'r+' : 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
}
export async function syncRecoveryDirectory(root) {
  if (process.platform === 'win32') return;
  const handle = await open(root, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
export function validateServicePaths(settings) {
  if (['registryDir', 'pickerRoot', 'tombstoneDir'].some(key => !path.isAbsolute(settings.multiPicker?.[key] ?? ''))) throw new Error('Complete absolute service roots required.');
  const roots = [settings.dataDir, settings.multiPicker.registryDir, settings.multiPicker.pickerRoot,
    settings.multiPicker.tombstoneDir, snapshotRoot(settings.dataDir), settings.controlDir, settings.scratchRoot, settings.backupDir].filter(Boolean);
  if (roots.some(root => !path.isAbsolute(root))) throw new Error('Absolute service roots required.');
  for (const [index, root] of roots.entries()) for (const other of roots.slice(index + 1)) { outside(root, other); outside(other, root); }
}
// A strict gameplay allowlist prevents new credential sidecars from silently
// entering the service export. Raw single-picker recoveries remain unchanged.
async function copyGameplay(source, target) {
  const files = await inventory(source);
  await mkdir(target, { mode: 0o700 });
  for (const row of files.filter(row => gameplayRoots.has(row.path.split('/')[0]))) {
    const to = path.join(target, row.path);
    if (row.directory) await mkdir(to, { mode: 0o700 });
    else await copyFile(path.join(source, row.path), to, 1);
  }
}
async function checkpointBinding(source) {
  const file = source + '.dataset.json';
  if (!await exists(file)) return null;
  await noLinks(file);
  if ((await lstat(file)).size > 65536) throw new Error('Invalid picker binding size.');
  return json(file);
}
const captures = new WeakSet();
export async function captureServiceCheckpoint({ settings, registry, checkpoint, id, inputs = {}, minFreeBytes = 67108864,
  onPhase = async () => {} }) {
  validateServicePaths(settings);
  const target = snapshotPath(settings.dataDir, id);
  if (captures.has(registry)) throw Object.assign(new Error('A service backup is already running.'), { status: 503 });
  captures.add(registry);
  let created = false;
  try {
    const started = performance.now();
    // No file copying, hashing, syncing or pack reads under global admission.
    const roster = async document => {
      const pickers = [];
      for (const p of document.pickers.filter(p => p.lifecycle === 'active')) {
        const source = pickerPath(settings, p);
        pickers.push({ id: p.id, kind: p.kind, initialized: await exists(path.join(source, 'state.json')),
          binding: await checkpointBinding(source), absent: false });
      }
      return { document, pickers };
    };
    const initial = checkpoint ? await checkpoint.capture(roster) : await registry.withRecoveryCheckpoint(roster);
    const globalBarrierMs = checkpoint ? checkpoint.timings().globalBarrierMs : performance.now() - started;
    const { document, pickers: manifestPickers } = initial;
    await onPhase('manifest', { pickerCount: manifestPickers.length });
    await directory(snapshotRoot(settings.dataDir));
    await headroom(snapshotRoot(settings.dataDir), 0, minFreeBytes);
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(path.join(target, 'pickers'), { mode: 0o700 });
    const pickerBarriers = [], errors = new Map();
    for (const picker of manifestPickers) {
      const source = pickerPath(settings, picker), to = path.join(target, 'pickers', picker.id);
      const began = performance.now();
      try {
        await withDirectoryBarriers([source], async () => {
          await onPhase('picker-barrier', { id: picker.id });
          await noLinks(source);
          picker.initialized = await exists(path.join(source, 'state.json'));
          const binding = await checkpointBinding(source);
          if (picker.binding && encode(binding) !== encode(picker.binding)) throw new Error('Picker binding changed during backup.');
          picker.binding = binding;
          if (picker.initialized && !picker.binding) throw new Error('Initialized picker has no binding.');
          await copyGameplay(source, to);
          if (picker.binding) await writeFile(to + '.dataset.json', encode(picker.binding), { flag: 'wx', mode: 0o600 });
          await syncRecoveryTree(to);
        });
      } catch (error) { errors.set(picker.id, error); }
      const heldMs = performance.now() - began;
      pickerBarriers.push({ id: picker.id, heldMs });
      await onPhase('picker-copied', { id: picker.id, heldMs });
    }
    await mkdir(path.join(target, 'inputs'), { mode: 0o700 });
    const pins = [];
    for (const [key, pin] of Object.entries(inputs)) {
      const name = key === 'rulesText' ? 'rules-text' : key;
      if (!['data', 'rules-text', 'art', 'profile', 'selection', 'addons'].includes(name) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error('Invalid recovery input pin.');
      await noLinks(pin.path);
      if (sha(await readFile(pin.path)) !== pin.sha256) throw new Error('Recovery input pin changed.');
      const pack = ['data', 'rules-text', 'art'].includes(name);
      if (pack) {
        const manifest = await json(pin.path), dest = path.join(target, 'inputs', name);
        if (!Array.isArray(manifest.files)) throw new Error('Pack file manifest required.');
        await directory(dest); await copyFile(pin.path, path.join(dest, 'pack.json'), 1);
        for (const row of manifest.files) {
          packRelative(row.path);
          if (row.path === 'pack.json') throw new Error('Invalid pack file.');
          const source = path.join(path.dirname(pin.path), row.path), output = path.join(dest, row.path);
          await noLinks(source); await directory(path.dirname(output)); await copyFile(source, output, 1);
        }
        const copied = await inventory(dest);
        for (const row of manifest.files) if (!copied.some(actual => actual.path === row.path && actual.sha256 === row.sha256 && actual.bytes === row.bytes)) throw new Error('Pack file verification failed.');
      } else await copyFile(pin.path, path.join(target, 'inputs', name), 1);
      pins.push({ name, sha256: pin.sha256, pack });
    }

    // The first roster is authoritative for inclusion. The final registry read
    // only removes scopes that disappeared; it never adds a newly created ID.
    const present = await registry.withRecoveryCheckpoint(current => current.pickers.filter(p => p.lifecycle === 'active').map(p => p.id));
    const active = new Set(present);
    for (const picker of manifestPickers) {
      if (!active.has(picker.id)) {
        if (picker.kind === 'legacy-shared') throw new Error('Legacy picker became unavailable during backup.');
        picker.absent = true;
        await rm(path.join(target, 'pickers', picker.id), { recursive: true, force: true });
        await rm(path.join(target, 'pickers', picker.id + '.dataset.json'), { force: true });
      } else if (errors.has(picker.id)) throw errors.get(picker.id);
    }
    await writeFile(path.join(target, 'registry.json'), encode(document), { flag: 'wx', mode: 0o600 });
    await syncRecoveryTree(target);
    const files = await inventory(target);
    const timing = checkpoint?.timings() ?? { waitedRequests: 0, maxRequestWaitMs: 0, totalRequestWaitMs: 0 };
    const result = { id, heldMs: globalBarrierMs, globalBarrierMs, pickerCount: manifestPickers.length,
      absentPickerCount: manifestPickers.filter(p => p.absent).length, pickerBarriers,
      waitedRequests: timing.waitedRequests, maxRequestWaitMs: timing.maxRequestWaitMs, totalRequestWaitMs: timing.totalRequestWaitMs };
    await atomic(path.join(target, 'manifest.json'), encode({ format: serviceFormat, pickers: manifestPickers, inputs: pins, files }));
    await atomic(path.join(target, 'complete.json'), encode(result));
    return result;
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
  finally { captures.delete(registry); }
}
export async function verifyServiceBackup(backup) {
  await noLinks(backup);
  const manifest = await json(path.join(backup, 'manifest.json'));
  const actual = (await inventory(backup)).filter(row => !['manifest.json', 'complete.json'].includes(row.path));
  if (manifest.format !== serviceFormat || encode(actual) !== encode(manifest.files) || !Array.isArray(manifest.pickers) || !Array.isArray(manifest.inputs)) throw new Error('Service recovery manifest verification failed.');
  const document = await json(path.join(backup, 'registry.json'));
  const { registryRecoveryDocument } = await import('../../app/storage/registry.mjs');
  if (encode(document) !== encode(registryRecoveryDocument(document))) throw new Error('Service recovery contains sign-in or capability records.');
  const ids = new Set();
  const inputNames = new Set(), inputPaths = new Set();
  for (const pin of manifest.inputs) {
    if (!['data', 'rules-text', 'art', 'profile', 'selection', 'addons'].includes(pin.name) || inputNames.has(pin.name)) throw new Error('Invalid recovery input.');
    inputNames.add(pin.name);
    const file = 'inputs/' + pin.name + (pin.pack ? '/pack.json' : '');
    if (!actual.some(row => row.path === file && row.sha256 === pin.sha256)) throw new Error('Recovery input missing.');
    inputPaths.add(file);
    if (pin.pack) {
      inputPaths.add('inputs/' + pin.name);
      for (const row of (await json(path.join(backup, file))).files) {
        packRelative(row.path);
        const relative = 'inputs/' + pin.name + '/' + row.path;
        if (!actual.some(r => r.path === relative && r.sha256 === row.sha256 && r.bytes === row.bytes)) throw new Error('Recovery pack file missing.');
        inputPaths.add(relative);
        for (let parent = path.posix.dirname(relative); parent !== 'inputs'; parent = path.posix.dirname(parent)) inputPaths.add(parent);
      }
    }
  }
  for (const picker of manifest.pickers) {
    if (!pickerId(picker.id) || ids.has(picker.id) || picker.absent !== undefined && typeof picker.absent !== 'boolean') throw new Error('Invalid picker manifest.');
    ids.add(picker.id);
    const registered = document.pickers.find(p => p.id === picker.id);
    if (!registered || registered.kind !== picker.kind || registered.lifecycle !== 'active') throw new Error('Picker checkpoint mismatch.');
    const root = 'pickers/' + picker.id;
    if (picker.absent) {
      if (picker.kind === 'legacy-shared' || actual.some(row => row.path === root || row.path.startsWith(root + '/') || row.path === root + '.dataset.json')) throw new Error('Absent picker has retained data.');
      continue;
    }
    if (picker.initialized !== actual.some(row => row.path === root + '/state.json')) throw new Error('Picker state missing.');
    if (picker.binding && encode(picker.binding) !== encode(await json(path.join(backup, root + '.dataset.json')))) throw new Error('Picker binding mismatch.');
  }
  if (document.pickers.filter(p => p.lifecycle === 'active').some(p => !ids.has(p.id))) throw new Error('Picker checkpoint incomplete.');
  for (const row of actual) {
    if (row.path === 'registry.json' || row.path === 'pickers' || row.path === 'inputs') continue;
    const parts = row.path.split('/');
    if (inputPaths.has(row.path)) continue;
    if (parts[0] === 'pickers' && (ids.has(parts[1]) && (parts.length === 2 || gameplayRoots.has(parts[2]))
      || parts.length === 2 && parts[1].endsWith('.dataset.json') && ids.has(parts[1].slice(0, -13)))) continue;
    throw new Error('Service recovery contains an unapproved file.');
  }
  return manifest;
}
export async function publishServiceBackup({ source, settings, release, assertRelease, keep = settings.keep ?? 30 }) {
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('Backup count must be positive.');
  validateServicePaths(settings);
  const manifest = await verifyServiceBackup(source), size = manifest.files.reduce((n, row) => n + (row.bytes ?? 0), 0);
  await directory(settings.backupDir); await headroom(settings.backupDir, size, settings.minFreeBytes);
  const target = path.join(settings.backupDir, 'service-' + randomUUID());
  const stage = target + '.pending';
  try {
    await copyTree(source, stage); await verifyServiceBackup(stage); await assertRelease(release);
    await syncRecoveryTree(stage); await rename(stage, target); await syncRecoveryDirectory(settings.backupDir);
    // Keep only verified service recoveries; never prune legacy recoveries.
    const { readdir, stat } = await import('node:fs/promises');
    const candidates = [];
    for (const name of await readdir(settings.backupDir)) if (/^service-[a-f0-9-]{36}$/.test(name)) {
      const dir = path.join(settings.backupDir, name); candidates.push({ dir, time: (await stat(dir)).mtimeMs });
    }
    candidates.sort((a, b) => b.time - a.time);
    for (const old of candidates.slice(keep)) { await verifyServiceBackup(old.dir); await rm(old.dir, { recursive: true }); }
    return { target, byteSize: size, pickerCount: manifest.pickers.length };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
