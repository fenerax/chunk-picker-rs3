// Explicit stopped-service rollback tool. Never imported by startup or jobs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, readdir, rename, rm, statfs as diskSpace } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { importBackup, cancelTaskClaimUndo } from '../../app/core/state.mjs';
import { readHistoryEvents } from '../../app/storage/history-reader.mjs';
import { acquireProcessGuard } from '../../app/storage/process-guard.mjs';
import { lockRegistry } from '../../app/storage/registry-lock.mjs';
import { ownedRecoveryStates } from './owned-recovery.mjs';
import { assertReleased, atomic, copyTree, directory, encode, exists, inventory, json, noLinks, outside, sha } from './files.mjs';
import { syncRecoveryTree, syncRecoveryDirectory, pickerId, validateServicePaths } from './service-checkpoint.mjs';
import { serviceOperation } from './service-lock.mjs';
import { openFrozenRuntime, FROZEN_RELEASE } from '../lib/frozen-runtime.mjs';
import { isMain } from '../release/vps/entrypoint.mjs';

const tool = 'inflate-owned-format-1', limit = 256 * 1024 * 1024, reserve = 64 * 1024 * 1024;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const bytes = value => Buffer.from(JSON.stringify(value) + '\n');
const digest = value => sha(JSON.stringify(value));
const refuse = message => { throw new Error(`Owned inflater refused: ${message}`); };
const readDocument = async file => {
  await noLinks(file);
  if ((await lstat(file)).size > limit) refuse('document exceeds byte limit');
  const raw = await readFile(file);
  return JSON.parse(file.endsWith('.gz') ? gunzipSync(raw, { maxOutputLength: limit }) : raw);
};
async function* documents(store, relative = '') {
  if (!relative) { yield { file: 'state.json', saved: await readDocument(path.join(store, 'state.json')) }; relative = 'backups'; }
  const root = path.join(store, relative);
  if (!await exists(root)) return;
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = relative + '/' + entry.name;
    if (entry.isDirectory()) yield* documents(store, file);
    else if (/\.json(?:\.gz)?$/.test(entry.name) && !entry.name.endsWith('.meta.json')) yield { file, saved: await readDocument(path.join(store, file)) };
  }
}
async function completeState(store, saved, state) {
  const events = new Map();
  for (const reference of state.provenance?.historyArchive ?? []) {
    for await (const event of readHistoryEvents(path.join(store, 'history', reference.id))) events.set(event.revision, event);
  }
  for (const event of state.history) events.set(event.revision, event);
  const complete = { ...state, history: [...events.values()].sort((a, b) => a.revision - b.revision) };
  if (complete.provenance?.historyArchive !== undefined) {
    complete.provenance = { ...complete.provenance }; delete complete.provenance.historyArchive;
  }
  for (const [id, through] of Object.entries(saved.coordination?.invalidatedUndo ?? {})) cancelTaskClaimUndo(complete, [id], through);
  return importBackup({ ...saved, state: complete });
}
// Same embedded schema-1 envelope order as the format-1 writer. Retention and
// optional evidence stay envelope metadata, not gameplay or storage-2 fields.
function flatDocument(saved, state) {
  const { storage, state: ignored, format, schemaVersion, ...metadata } = saved;
  return { format, schemaVersion, state, ...metadata };
}
async function planStore(store, ownedFormat2) {
  const decoded = new Map();
  for await (const { saved, state } of ownedRecoveryStates(store, ownedFormat2)) decoded.set(JSON.stringify(saved), state);
  const changes = [], proofs = [];
  async function convert(saved) {
    const state = decoded.get(JSON.stringify(saved));
    if (!state) refuse('snapshot was not visited by the verified closure reader');
    const complete = await completeState(store, saved, state);
    const output = saved.storage?.schemaVersion === 2 ? flatDocument(saved, state) : saved;
    // Independently import the emitted flat document and hydrate its History.
    const inflated = saved.storage?.schemaVersion === 2 ? output.state : state;
    const check = await completeState(store, output, inflated);
    if (digest(check) !== digest(complete) || digest(check.history) !== digest(complete.history)) refuse('logical or History SHA-256 differs');
    proofs.push({ document: output, revision: complete.revision, logicalSHA256: digest(complete), historySHA256: digest(complete.history) });
    return output;
  }
  for await (const { file, saved } of documents(store)) {
    let output;
    if (saved.format === 'rs3-chunk-picker-retained-archive') {
      let changed = false;
      const snapshots = [];
      for (const snapshot of saved.snapshots) {
        const original = typeof snapshot.document === 'string' ? JSON.parse(snapshot.document) : snapshot.document;
        const result = await convert(original);
        changed ||= result !== original;
        snapshots.push(result === original ? snapshot : { ...snapshot,
          document: typeof snapshot.document === 'string' ? bytes(result).toString() : result });
      }
      if (changed) output = { ...saved, snapshots };
    } else { const result = await convert(saved); if (result !== saved) output = result; }
    if (output) changes.push({ file, bytes: file.endsWith('.gz') ? gzipSync(bytes(output)) : bytes(output) });
  }
  return { changes, proofs };
}
async function frozenProof(runtime, output, proofs, work) {
  if (runtime.release !== FROZEN_RELEASE) refuse('frozen release pin differs');
  const probe = path.join(work, 'probe-' + randomUUID());
  await copyTree(output, probe);
  for (const proof of proofs) {
    await atomic(path.join(probe, 'state.json'), bytes(proof.document));
    const store = await runtime.openStore({ dataDir: probe, readOnly: true, retention: false, completionCodec: false });
    try {
      const complete = (await store.backup()).state;
      if (store.getInfo().revision !== proof.revision || digest(complete) !== proof.logicalSHA256
        || digest(complete.history) !== proof.historySHA256) refuse('actual frozen loader revision, logical or History SHA-256 differs');
    } finally { await store.close(); }
  }
}
async function space(root, needed, statfs) {
  const info = await statfs(root, { bigint: true });
  if (info.bavail * info.bsize < BigInt(needed) + BigInt(reserve)) refuse('insufficient free space for staging, probes and reserve');
}
async function currentStores(settings) {
  const root = settings.multiPicker.pickerRoot, rows = [];
  await noLinks(root);
  // Scan the entire owned root, including retained/deleted trees. Never select
  // the legacy dataDir, and never infer that a caller-supplied subset is complete.
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (/^p_[a-f0-9]{32}\.dataset\.json$/.test(entry.name)) { await noLinks(path.join(root, entry.name)); continue; }
    if (!pickerId(entry.name)) refuse('unexpected entry in owned picker root');
    const dataDir = path.join(root, entry.name); await noLinks(dataDir);
    if (!entry.isDirectory()) refuse('owned picker is not a directory');
    if (await exists(path.join(dataDir, 'state.json'))) rows.push({ id: entry.name, dataDir });
    else if ((await readdir(dataDir)).length) refuse('nonempty owned picker has no current state');
  }
  return rows;
}
async function checkMixed(store, source, output) {
  const actual = await inventory(store), originals = new Map(source.map(row => [row.path, row]));
  if (actual.length !== source.length) refuse('source inventory changed');
  const results = new Map(output.map(row => [row.path, row]));
  for (const row of actual) if (encode(row) !== encode(originals.get(row.path)) && encode(row) !== encode(results.get(row.path))) refuse('source/output digest mismatch; inspect retained copies');
}
async function installFile(target, contents, temporary, crash) {
  const owner = await lstat(target);
  // Fixed temporary is safe under stopped-writer ownership; a crash may leave
  // it behind. Keep temps outside the store so source identity remains usable.
  if (await exists(temporary)) await noLinks(temporary);
  const handle = await open(temporary, 'w', owner.mode & 0o777);
  try {
    await handle.writeFile(await readFile(contents));
    await handle.chmod(owner.mode & 0o777);
    if (process.platform !== 'win32') await handle.chown(owner.uid, owner.gid);
    await handle.sync();
  } finally { await handle.close(); }
  // Source staging must share the destination filesystem; rename is atomic.
  await crash?.('install-temporary');
  await rename(temporary, target);
  await crash?.('install-renamed');
  await syncRecoveryDirectory(path.dirname(target));
}

/** Convert ALL stores below the service owned root. Inputs/pins are operator
 * supplied, never derived from save claims. Partial installation is explicitly
 * blocked by the existing maintenance gate; rerun with identical settings/pins.
 */
export async function inflateOwnedFormat1({ settings, controller, ownedFormat2, crash, statfs = diskSpace, frozen } = {}) {
  validateServicePaths(settings);
  if (!ownedFormat2 || ownedFormat2.pickerId === 'legacy-shared') refuse('explicit owned base pins required');
  for (const root of [settings.dataDir, settings.multiPicker.pickerRoot, settings.controlDir]) {
    outside(root, ownedFormat2.catalogueRoot); outside(ownedFormat2.catalogueRoot, root);
  }
  const stopped = async () => { if (!(await controller.state()).stopped) refuse('service is running or ownership is uncertain'); };
  await stopped(); await directory(settings.controlDir);
  return serviceOperation(settings, 'restore', async () => {
    const releases = [];
    let runtime;
    try {
      // Fence registry/deletion activity for the full inventory and installation.
      for (const root of [settings.multiPicker.registryDir, settings.multiPicker.tombstoneDir]) releases.push(await lockRegistry(root));
      const stores = await currentStores(settings);
      for (const row of stores) { await assertReleased(row.dataDir); releases.push(await acquireProcessGuard(row.dataDir)); }
      await noLinks(ownedFormat2.catalogueRoot);
      releases.push(await acquireProcessGuard(ownedFormat2.catalogueRoot));
      await stopped();
      const work = path.join(settings.controlDir, tool), journal = path.join(work, 'progress.json'), pause = path.join(settings.controlDir, 'maintenance.json');
      const marker = { operation: tool, warning: 'DO NOT START THE OLD RELEASE until progress.json says complete.', journal };
      if (await exists(pause) && encode(await json(pause)) !== encode(marker)) refuse('another maintenance transaction requires reconciliation');
      await directory(work);
      if ((await lstat(work)).dev !== (await lstat(settings.multiPicker.pickerRoot)).dev) refuse('journal staging and owned stores must share a filesystem');
      let progress = await exists(journal) ? await json(journal) : { schemaVersion: 1, release: FROZEN_RELEASE, phase: 'staging', stores: [] };
      if (progress.schemaVersion !== 1 || progress.release !== FROZEN_RELEASE || !['staging', 'verified', 'installing', 'complete'].includes(progress.phase)
        || progress.stores.some(row => !stores.some(store => store.id === row.id))) refuse('journal inventory or release differs');
      await atomic(pause, encode(marker)); await crash?.('maintenance');
      const save = async label => { await atomic(journal, encode(progress)); await crash?.(label); };
      await save('journal-created');
      runtime = frozen ?? await openFrozenRuntime({ repository, cacheRoot: path.join(work, 'frozen-cache'), workRoot: path.join(work, 'runtime') });
      for (const store of stores) {
        let row = progress.stores.find(row => row.id === store.id);
        if (!row) {
          if (progress.phase !== 'staging') refuse('owned inventory changed after verification');
          if (await exists(path.join(store.dataDir, 'owned-rebase-intent.json'))) refuse('reconcile the pending rebase first');
          const sourceInventory = await inventory(store.dataDir), plan = await planStore(store.dataDir, { ...ownedFormat2, pickerId: store.id });
          const needed = sourceInventory.reduce((sum, row) => sum + (row.bytes ?? 0), 0) * 3 + plan.changes.reduce((sum, row) => sum + row.bytes.length * 3, 0);
          await space(work, needed, statfs);
          const attempt = store.id + '-' + randomUUID(), stage = path.join(work, attempt); await directory(stage);
          const source = path.join(stage, 'source'), output = path.join(stage, 'output');
          await copyTree(store.dataDir, source); await syncRecoveryTree(source); await crash?.('source-staged');
          await copyTree(source, output);
          for (const change of plan.changes) await atomic(path.join(output, change.file), change.bytes);
          await syncRecoveryTree(output); await crash?.('output-staged');
          await frozenProof(runtime, output, plan.proofs, stage); await crash?.('frozen-verified');
          if (digest(sourceInventory) !== digest(await inventory(store.dataDir))) refuse('source changed during staging');
          row = { id: store.id, attempt, sourceDigest: digest(sourceInventory), outputDigest: digest(await inventory(output)), proofs: plan.proofs.map(({ document, ...proof }) => proof) };
          progress.stores.push(row); await save('store-verified');
        }
        if (!new RegExp('^' + store.id + '-[a-f0-9-]{36}$').test(row.attempt)) refuse('invalid journal staging path');
        const stage = path.join(work, row.attempt), source = path.join(stage, 'source'), output = path.join(stage, 'output');
        const originals = await inventory(source), results = await inventory(output);
        if (digest(originals) !== row.sourceDigest || digest(results) !== row.outputDigest) refuse('retained source/output digest differs');
        await checkMixed(store.dataDir, originals, results);
        // Reverify the original dependency closure/pins on EVERY resume, even
        // when a previous process journaled a successful frozen proof.
        const plan = await planStore(source, { ...ownedFormat2, pickerId: store.id });
        for (const change of plan.changes) if (sha(await readFile(path.join(output, change.file))) !== sha(change.bytes)) refuse('staged output differs from the source/pin conversion');
        await frozenProof(runtime, output, plan.proofs, stage);
      }
      if (progress.phase === 'staging') { progress.phase = 'verified'; await save('all-verified'); }
      await stopped();
      // Nothing live is replaced until every store/snapshot has passed both
      // validators and the real pinned loader. The maintenance marker survives.
      progress.phase = 'installing'; await save('install-intent');
      for (const store of stores) {
        const row = progress.stores.find(row => row.id === store.id), stage = path.join(work, row.attempt);
        const source = await inventory(path.join(stage, 'source')), output = await inventory(path.join(stage, 'output'));
        await checkMixed(store.dataDir, source, output);
        await space(work, output.reduce((size, row) => Math.max(size, row.bytes ?? 0), 0), statfs);
        for (const file of output.filter(row => !row.directory)) {
          const target = path.join(store.dataDir, file.path);
          if (sha(await readFile(target)) === file.sha256) continue;
          await stopped(); await crash?.('before-install');
          await installFile(target, path.join(stage, 'output', file.path), path.join(stage, 'install.tmp'), crash);
          await save('file-installed');
        }
        if (digest(await inventory(store.dataDir)) !== row.outputDigest) refuse('installed output digest differs');
        await save('store-installed');
      }
      progress.phase = 'complete'; await save('complete');
      await rm(pause); await syncRecoveryDirectory(settings.controlDir); await crash?.('maintenance-cleared');
      return { phase: 'complete', release: FROZEN_RELEASE, journal, stores: progress.stores.map(({ id, sourceDigest, outputDigest, proofs }) => ({ id, sourceDigest, outputDigest, proofs })) };
    } finally {
      try { if (!frozen) await runtime?.close(); }
      finally { for (const release of releases.reverse()) await release(); }
    }
  });
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/linux/inflate-owned-format-1.mjs ABSOLUTE_CONFIG_JSON');
    const { settings, ownedFormat2 } = await json(process.argv[2]);
    const { systemd } = await import('./operator.mjs');
    const result = await inflateOwnedFormat1({ settings, ownedFormat2, controller: systemd(settings) });
    process.stdout.write(encode(result));
  } catch (error) { process.stderr.write(`${error.message}\nDO NOT START THE OLD RELEASE while inflation is incomplete; inspect the journal and rerun explicitly.\n`); process.exitCode = 1; }
}
