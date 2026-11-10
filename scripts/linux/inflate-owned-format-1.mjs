// Explicit stopped-service rollback tool. Never imported by startup or jobs.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, open, readFile, readdir, rename, rm, utimes, statfs as diskSpace } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readHistoryEvents } from '../../app/storage/history-reader.mjs';
import { createOwnedStorage } from '../../app/storage/owned-storage.mjs';
import { acquireProcessGuard } from '../../app/storage/process-guard.mjs';
import { lockRegistry } from '../../app/storage/registry-lock.mjs';
import { ownedRecoveryStates } from './owned-recovery.mjs';
import { assertReleased, atomic, copyTree, directory, encode, exists, inventory, json, noLinks, outside, sha } from './files.mjs';
import { syncRecoveryTree, syncRecoveryDirectory, pickerId, validateServicePaths } from './service-checkpoint.mjs';
import { serviceOperation } from './service-lock.mjs';
import { openFrozenRuntime, FROZEN_RELEASE } from '../lib/frozen-runtime.mjs';
import { isMain } from '../release/vps/entrypoint.mjs';

const tool = 'inflate-owned-format-1', limit = 256 * 1024 * 1024, reserve = 64 * 1024 * 1024;
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
async function completeState(store, saved, state, { importBackup, validateState, cancelTaskClaimUndo }) {
  const events = new Map();
  for (const reference of state.provenance?.historyArchive ?? []) {
    for await (const event of readHistoryEvents(path.join(store, 'history', reference.id))) events.set(event.revision, event);
  }
  for (const event of state.history) events.set(event.revision, event);
  const complete = { ...state, history: structuredClone([...events.values()].sort((a, b) => a.revision - b.revision)) };
  if (complete.provenance?.historyArchive !== undefined) {
    complete.provenance = { ...complete.provenance }; delete complete.provenance.historyArchive;
  }
  for (const [id, through] of Object.entries(saved.coordination?.invalidatedUndo ?? {})) cancelTaskClaimUndo(complete, [id], through);
  validateState(complete); // Full schema and Undo validation, independent of the codec.
  return importBackup({ ...saved, state: complete });
}
// Same embedded schema-1 envelope order as the format-1 writer. Retention and
// optional evidence stay envelope metadata, not gameplay or storage-2 fields.
function flatDocument(saved, state) {
  const { storage, state: ignored, format, schemaVersion, ...metadata } = saved;
  return { format, schemaVersion, state, ...metadata };
}
async function planStore(store, ownedFormat2, validators, readStates) {
  const decoded = new Map();
  for await (const { saved, state } of readStates(store, ownedFormat2)) decoded.set(JSON.stringify(saved), state);
  // Verification reads the retained pin; it must never seed a missing base.
  const storage = createOwnedStorage({ ...ownedFormat2, releaseBytes: undefined }, store, { readOnly: true });
  const changes = [], proofs = [];
  async function convert(saved) {
    const state = decoded.get(JSON.stringify(saved));
    if (!state) refuse('snapshot was not visited by the verified closure reader');
    if (saved.storage?.schemaVersion === 2) {
      // The encoder is a separate check on the closure decoder. Reconstruct
      // the original static-field placement before comparing exact JSON bytes.
      const encoded = (await storage.read(saved.storage.base)).encode(state);
      for (const key of Object.keys(saved.storage.fields ?? {})) delete encoded.state[key];
      if (Object.hasOwn(saved.storage, 'fields')) encoded.storage.fields = saved.storage.fields;
      for (const role of ['entries', 'aliases']) {
        const original = saved.storage.delta.identityRegistry[role], next = encoded.storage.delta.identityRegistry[role];
        if (!original || !next) continue;
        // Resident edit insertion order is wire metadata, separate from the
        // materialized dictionary's logical order. Restore only that layout;
        // every replacement value still comes from the independent encoder.
        const keys = Object.keys(original.replacements), produced = Object.keys(next.replacements);
        if (JSON.stringify([...keys].sort()) === JSON.stringify([...produced].sort())) {
          next.replacements = Object.fromEntries(keys.map(key => [key, next.replacements[key]]));
        }
        if (JSON.stringify([...original.deleted].sort()) === JSON.stringify([...next.deleted].sort())) next.deleted = [...original.deleted];
        if (Object.hasOwn(original, 'order')) next.order = Object.keys(state.identityRegistry[role]);
      }
      if (JSON.stringify(encoded) !== JSON.stringify({ state: saved.state, storage: saved.storage })) refuse('codec round-trip state/storage bytes differ');
    }
    const complete = await completeState(store, saved, state, validators);
    const output = saved.storage?.schemaVersion === 2 ? flatDocument(saved, state) : saved;
    // Independently import the emitted flat document and hydrate its History.
    const inflated = saved.storage?.schemaVersion === 2 ? output.state : state;
    const check = await completeState(store, output, inflated, validators);
    if (digest(check) !== digest(complete) || digest(check.history) !== digest(complete.history)) refuse('logical or History SHA-256 differs');
    proofs.push({ document: output, revision: complete.revision, logicalSHA256: digest(complete), historySHA256: digest(complete.history) });
    return output;
  }
  const entries = [];
  for await (const entry of documents(store)) entries.push(entry);
  const standalone = new Map();
  // Convert standalone files first, so coexisting packed entries can use the
  // exact new compressed size and the preserved original timestamp.
  for (const { file, saved } of entries.filter(row => row.saved.format !== 'rs3-chunk-picker-retained-archive')) {
    const output = await convert(saved), converted = output !== saved;
    const content = converted ? bytes(output) : null;
    const result = converted ? (file.endsWith('.gz') ? gzipSync(content) : content) : await readFile(path.join(store, file));
    if (/^backups\/[^/]+$/.test(file)) standalone.set(path.posix.basename(file), { saved, bytes: result, at: (await lstat(path.join(store, file))).mtime.toISOString() });
    if (converted) changes.push({ file, bytes: result });
  }
  for (const { file, saved } of entries.filter(row => row.saved.format === 'rs3-chunk-picker-retained-archive')) {
    let output;
    let changed = false;
    const snapshots = [];
    for (const snapshot of saved.snapshots) {
      const original = typeof snapshot.document === 'string' ? JSON.parse(snapshot.document) : snapshot.document;
      const result = await convert(original);
      let next = result === original ? snapshot : { ...snapshot,
        document: typeof snapshot.document === 'string' ? bytes(result).toString() : result };
      const pair = standalone.get(snapshot.id);
      if (pair) {
        if (JSON.stringify(pair.saved) !== JSON.stringify(original)) refuse('packed and standalone source documents differ');
        next = { ...next, bytes: pair.bytes.length, at: pair.at };
      } else if (result !== original && Object.hasOwn(snapshot, 'bytes')) {
        next = { ...next, bytes: snapshot.id.endsWith('.gz') ? gzipSync(bytes(result)).length : bytes(result).length };
      }
      changed ||= JSON.stringify(next) !== JSON.stringify(snapshot);
      snapshots.push(next);
    }
    if (changed) output = { ...saved, snapshots };
    if (output) changes.push({ file, bytes: file.endsWith('.gz') ? gzipSync(bytes(output)) : bytes(output) });
  }
  return { changes, proofs };
}
const fileBytes = rows => rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
function probeSpace(rows, proofs) {
  const largest = Math.max(...proofs.map(proof => bytes(proof.document).length));
  // During atomic state replacement both the previous and next document exist.
  return fileBytes(rows) - rows.find(row => row.path === 'state.json').bytes + largest * 2;
}
async function frozenProof(runtime, output, proofs, work, statfs, syncDirectory) {
  if (runtime.release !== FROZEN_RELEASE) refuse('frozen release pin differs');
  await space(work, probeSpace(await inventory(output), proofs), statfs);
  const probe = path.join(work, 'probe-' + randomUUID());
  try {
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
  } finally {
    await rm(probe, { recursive: true, force: true });
    await syncDirectory(work);
  }
}
async function preservedTree(source, target) {
  return copyTree(source, target, { copy: async (from, to, flags) => {
    const info = await lstat(from);
    await copyFile(from, to, flags); await utimes(to, info.atime, info.mtime);
  } });
}
async function durableDirectory(root, syncDirectory) {
  await directory(root);
  for (let current = path.resolve(root); ; current = path.dirname(current)) {
    await syncDirectory(current);
    if (path.dirname(current) === current) break;
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
async function installFile(target, contents, temporary, crash, syncDirectory) {
  const owner = await lstat(target);
  // Fixed temporary is safe under stopped-writer ownership; a crash may leave
  // it behind. Keep temps outside the store so source identity remains usable.
  if (await exists(temporary)) await noLinks(temporary);
  const handle = await open(temporary, 'w', owner.mode & 0o777);
  try {
    await handle.writeFile(await readFile(contents));
    await handle.chmod(owner.mode & 0o777);
    if (process.platform !== 'win32') await handle.chown(owner.uid, owner.gid);
    await handle.utimes(owner.atime, owner.mtime);
    await handle.sync();
  } finally { await handle.close(); }
  // Source staging must share the destination filesystem; rename is atomic.
  await syncDirectory(path.dirname(temporary));
  await crash?.('install-temporary');
  await rename(temporary, target);
  await crash?.('install-renamed');
  await syncDirectory(path.dirname(target));
  await syncDirectory(path.dirname(temporary));
}

/** Convert ALL stores below the service owned root. Inputs/pins are operator
 * supplied, never derived from save claims. Partial installation is explicitly
 * blocked by the existing maintenance gate; rerun with identical settings/pins.
 */
export async function inflateOwnedFormat1({ settings, controller, ownedFormat2, crash, statfs = diskSpace, frozen,
  frozenRepository = process.env.RS3_FROZEN_REPOSITORY, syncDirectory = syncRecoveryDirectory, syncTree = syncRecoveryTree,
  readStates = ownedRecoveryStates } = {}) {
  validateServicePaths(settings);
  if (!frozen && (typeof frozenRepository !== 'string' || !path.isAbsolute(frozenRepository))) refuse(`provision a local Git repository containing ${FROZEN_RELEASE}; set --frozen-repository or RS3_FROZEN_REPOSITORY`);
  if (!ownedFormat2 || ownedFormat2.pickerId === 'legacy-shared') refuse('explicit owned base pins required');
  for (const root of [settings.dataDir, settings.multiPicker.pickerRoot, settings.controlDir]) {
    outside(root, ownedFormat2.catalogueRoot); outside(ownedFormat2.catalogueRoot, root);
  }
  const stopped = async () => { if (!(await controller.state()).stopped) refuse('service is running or ownership is uncertain'); };
  await stopped(); await durableDirectory(settings.controlDir, syncDirectory);
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
      await durableDirectory(work, syncDirectory);
      if ((await lstat(work)).dev !== (await lstat(settings.multiPicker.pickerRoot)).dev) refuse('journal staging and owned stores must share a filesystem');
      let progress = await exists(journal) ? await json(journal) : { schemaVersion: 1, release: FROZEN_RELEASE, phase: 'staging', stores: [] };
      if (progress.schemaVersion !== 1 || progress.release !== FROZEN_RELEASE || !['staging', 'verified', 'installing', 'complete'].includes(progress.phase)
        || progress.stores.some(row => !stores.some(store => store.id === row.id))) refuse('journal inventory or release differs');
      const publish = async (file, value) => { await atomic(file, value); await syncDirectory(path.dirname(file)); };
      await publish(pause, encode(marker)); await crash?.('maintenance');
      const save = async label => { await publish(journal, encode(progress)); await crash?.(label); };
      await save('journal-created');
      runtime = frozen ?? await openFrozenRuntime({ repository: frozenRepository, cacheRoot: path.join(work, 'frozen-cache'), workRoot: path.join(work, 'runtime') });
      for (const store of stores) {
        let row = progress.stores.find(row => row.id === store.id);
        if (!row) {
          if (progress.phase !== 'staging') refuse('owned inventory changed after verification');
          if (await exists(path.join(store.dataDir, 'owned-rebase-intent.json'))) refuse('reconcile the pending rebase first');
          const sourceInventory = await inventory(store.dataDir), plan = await planStore(store.dataDir, { ...ownedFormat2, pickerId: store.id }, runtime.core, readStates);
          const replacements = new Map(plan.changes.map(row => [row.file, row.bytes.length]));
          const outputRows = sourceInventory.map(row => replacements.has(row.path) ? { ...row, bytes: replacements.get(row.path) } : row);
          const sourceBytes = fileBytes(sourceInventory), outputBytes = fileBytes(outputRows);
          let copiedBytes = sourceBytes, needed = sourceBytes * 2;
          for (const change of plan.changes) {
            // Output starts as another source copy. Include atomic-write peaks
            // even when an unusual format-2 delta shrinks on conversion.
            needed = Math.max(needed, sourceBytes + copiedBytes + change.bytes.length);
            copiedBytes += change.bytes.length - sourceInventory.find(row => row.path === change.file).bytes;
          }
          needed = Math.max(needed, sourceBytes + outputBytes
            + Math.max(probeSpace(outputRows, plan.proofs), ...plan.changes.map(row => row.bytes.length)));
          await space(work, needed, statfs);
          const attempt = store.id + '-' + randomUUID(), stage = path.join(work, attempt); await durableDirectory(stage, syncDirectory);
          const source = path.join(stage, 'source'), output = path.join(stage, 'output');
          await preservedTree(store.dataDir, source); await syncTree(source); await syncDirectory(stage); await crash?.('source-staged');
          await preservedTree(source, output);
          for (const change of plan.changes) await atomic(path.join(output, change.file), change.bytes);
          await syncTree(output); await syncDirectory(stage); await crash?.('output-staged');
          await frozenProof(runtime, output, plan.proofs, stage, statfs, syncDirectory); await crash?.('frozen-verified');
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
        const plan = await planStore(source, { ...ownedFormat2, pickerId: store.id }, runtime.core, readStates);
        for (const change of plan.changes) if (sha(await readFile(path.join(output, change.file))) !== sha(change.bytes)) refuse('staged output differs from the source/pin conversion');
        await frozenProof(runtime, output, plan.proofs, stage, statfs, syncDirectory);
        // Also repair directory durability for intents written by older tools.
        await syncTree(source); await syncTree(output); await durableDirectory(stage, syncDirectory);
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
          await installFile(target, path.join(stage, 'output', file.path), path.join(stage, 'install.tmp'), crash, syncDirectory);
          await save('file-installed');
        }
        if (digest(await inventory(store.dataDir)) !== row.outputDigest) refuse('installed output digest differs');
        await save('store-installed');
      }
      progress.phase = 'complete'; await save('complete');
      await rm(pause); await syncDirectory(settings.controlDir); await crash?.('maintenance-cleared');
      return { phase: 'complete', release: FROZEN_RELEASE, journal, stores: progress.stores.map(({ id, sourceDigest, outputDigest, proofs }) => ({ id, sourceDigest, outputDigest, proofs })) };
    } finally {
      try { if (!frozen) await runtime?.close(); }
      finally { for (const release of releases.reverse()) await release(); }
    }
  });
}

if (isMain(import.meta.url)) {
  try {
    const [configFile, flag, repository, ...extra] = process.argv.slice(2);
    if (!configFile || flag !== undefined && (flag !== '--frozen-repository' || !repository) || extra.length) throw new Error('Usage: node scripts/linux/inflate-owned-format-1.mjs ABSOLUTE_CONFIG_JSON [--frozen-repository ABSOLUTE_GIT_REPOSITORY]');
    const { settings, ownedFormat2, frozenRepository } = await json(configFile);
    const { systemd } = await import('./operator.mjs');
    const result = await inflateOwnedFormat1({ settings, ownedFormat2, frozenRepository: repository ?? frozenRepository ?? process.env.RS3_FROZEN_REPOSITORY, controller: systemd(settings) });
    process.stdout.write(encode(result));
  } catch (error) { process.stderr.write(`${error.message}\nDO NOT START THE OLD RELEASE while inflation is incomplete; inspect the journal and rerun explicitly.\n`); process.exitCode = 1; }
}
