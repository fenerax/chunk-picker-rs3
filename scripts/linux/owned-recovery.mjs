// Format-2 only. Format-1 callers retain their original artifact/manifest bytes.
import path from 'node:path';
import { copyFile, mkdir, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { readOwnedBase } from '../../app/storage/owned-base.mjs';
import { createOwnedBaseManifest, resolveOwnedBasePin, validateOwnedBaseReference } from '../../app/storage/owned-base-schema.mjs';
import { createOwnedStorage, ownedArtifactSource } from '../../app/storage/owned-storage.mjs';
import { ownedCodec } from '../../app/storage/owned-codec.mjs';
import { readStaticFieldBytes } from '../../app/storage/static-field.mjs';
import { atomic, copyTree, encode, exists, inventory, json, noLinks, outside, headroom } from './files.mjs';
import { SNAPSHOT_EXCLUSIONS } from '../../app/storage/store-identity-policy.mjs';
import { capturePluginItemFiles, pluginItemFiles } from '../../app/storage/plugin-item-snapshot.mjs';

const marker = 'owned-closure.json', limit = 256 * 1024 * 1024;
const baseName = pin => `catalogue-${pin.sha256}.json.gz`;
async function document(file) {
  await noLinks(file);
  if ((await lstat(file)).size > limit) throw new Error('Owned recovery document exceeds byte limit.');
  const bytes = await readFile(file);
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: limit }) : bytes).toString('utf8'));
}
function pinFor(manifest, reference) {
  const dataset = manifest?.bases?.[reference?.datasetDigest]?.dataset;
  const pin = resolveOwnedBasePin(manifest, dataset);
  validateOwnedBaseReference(reference, pin);
  return pin;
}
// Discovery includes exact string-valued packed preimages, not just state.json.
async function* documents(store) {
  yield await document(path.join(store, 'state.json'));
  async function* walk(dir) {
    if (!await exists(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(file);
      else if (/\.json(?:\.gz)?$/.test(entry.name) && !entry.name.endsWith('.meta.json')) {
        const value = await document(file);
        if (value.format === 'rs3-chunk-picker-retained-archive') {
          if (!Array.isArray(value.snapshots)) throw new Error('Invalid retained archive.');
          for (const snapshot of value.snapshots) yield typeof snapshot.document === 'string' ? JSON.parse(snapshot.document) : snapshot.document;
        } else yield value;
      }
    }
  }
  yield* walk(path.join(store, 'backups'));
}
export async function ownedRecoveryOptions(dataDir, explicit) {
  if (explicit) return explicit;
  const live = ownedArtifactSource(dataDir);
  if (live) return live.readerOptions;
  const root = path.dirname(dataDir);
  if (!await exists(path.join(root, marker))) return undefined;
  const closure = await json(path.join(root, marker)), saved = await document(path.join(dataDir, 'state.json'));
  if (saved.storage?.schemaVersion !== 2) return undefined;
  const pin = pinFor(closure.manifest, saved.storage.base);
  return { pickerId: closure.stores.find(row => row.path === path.basename(dataDir))?.pickerId,
    catalogueRoot: path.join(root, 'catalogue'), dataset: pin.dataset, manifest: closure.manifest };
}
export async function recoverySources(dataDirs, explicit) {
  return Promise.all(dataDirs.map(async dataDir => {
    const options = await ownedRecoveryOptions(dataDir, explicit);
    return options ? { dataDir, options, storage: ownedArtifactSource(dataDir) ?? createOwnedStorage(options, dataDir) } : null;
  }));
}
// Acquire only AFTER draining group writers, otherwise a drained writer could
// itself be waiting for this catalogue lease. Hold through complete publication.
export async function withRecoveryLeases(sources, work) {
  const unique = [...new Map(sources.filter(Boolean).map(source => [path.resolve(source.options.catalogueRoot), source.storage])).entries()].sort();
  const enter = index => index === unique.length ? work() : unique[index][1].withLease(() => enter(index + 1));
  return enter(0);
}
async function checkDocument(saved, store, manifest, catalogueRoot, pins) {
  if (!saved?.state) throw new Error('Invalid owned recovery document.');
  let state = { ...saved.state };
  for (const [key, reference] of Object.entries(saved.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(state, key)) throw new Error('Invalid recovery static field.');
    state[key] = JSON.parse(await readStaticFieldBytes(store, key, reference));
  }
  if (saved.storage?.schemaVersion === 2) {
    const pin = pinFor(manifest, saved.storage.base);
    const base = await readOwnedBase(catalogueRoot, saved.storage.base, { dataset: pin.dataset, manifest });
    state = ownedCodec(base, pin).decode({ ...saved, state }).state;
    pins.set(pin.sha256, pin);
  }
  for (const reference of state.provenance?.historyArchive ?? []) {
    if (!/^history-\d{16}-\d{16}-[a-f0-9]{16}\.json\.gz$/.test(reference?.id ?? '')) throw new Error('Invalid recovery History reference.');
    const segment = await document(path.join(store, 'history', reference.id));
    if (segment.format !== 'rs3-chunk-picker-history' || !Array.isArray(segment.events)) throw new Error('Invalid recovery History segment.');
  }
}
export async function captureOwnedClosure(root, stores, sources, { step = async () => {} } = {}) {
  const pins = new Map(), rows = [];
  for (const [index, relative] of stores.entries()) {
    const source = sources[index], store = path.join(root, relative);
    for await (const saved of documents(store)) {
      if (saved.storage?.schemaVersion === 2 && !source) throw new Error('Owned recovery requires the pinned catalogue source.');
      if (source) await checkDocument(saved, store, source.options.manifest, source.options.catalogueRoot, pins);
    }
    if (source) rows.push({ path: relative, pickerId: source.options.pickerId });
  }
  if (!pins.size) return false;
  await mkdir(path.join(root, 'catalogue'), { mode: 0o700 });
  for (const pin of pins.values()) {
    const source = sources.find(row => row?.options.manifest.bases[pin.dataset.digest]?.sha256 === pin.sha256);
    await step('capture.owned-base');
    await copyFile(path.join(source.options.catalogueRoot, baseName(pin)), path.join(root, 'catalogue', baseName(pin)), 1);
    await readOwnedBase(path.join(root, 'catalogue'), { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, { dataset: pin.dataset, manifest: source.options.manifest });
  }
  const { syncRecoveryTree } = await import('./service-checkpoint.mjs');
  await syncRecoveryTree(root);
  await step('capture.owned-dependencies-durable');
  await step('capture.owned-manifest');
  await atomic(path.join(root, marker), encode({ schemaVersion: 1, stores: rows, manifest: createOwnedBaseManifest([...pins.values()]) }));
  await verifyOwnedClosure(root, stores);
  return true;
}
export async function verifyOwnedClosure(root, stores) {
  const present = await exists(path.join(root, marker));
  if (!present) {
    for (const store of stores) {
      // Preserve format-1 verifier behavior even for opaque old state bytes.
      let saved; try { saved = await document(path.join(root, store, 'state.json')); } catch { continue; }
      if (saved.storage?.schemaVersion === 2) throw new Error('Owned recovery dependency closure is missing.');
    }
    return null;
  }
  await noLinks(path.join(root, marker));
  const closure = await json(path.join(root, marker));
  if (closure.schemaVersion !== 1 || !Array.isArray(closure.stores)
    || closure.stores.some(row => !stores.includes(row.path) || typeof row.pickerId !== 'string' || row.pickerId === 'legacy-shared')
    || new Set(closure.stores.map(row => row.path)).size !== closure.stores.length) throw new Error('Invalid owned closure manifest.');
  if (await exists(path.join(root, 'manifest.json'))) {
    const manifest = await json(path.join(root, 'manifest.json'));
    if (manifest.format === 'picker-owned-capture-v1' && encode(manifest.files) !== encode((await inventory(root))
      .filter(row => !['manifest.json', 'complete.json'].includes(row.path)))) throw new Error('Owned capture manifest differs.');
  }
  const pins = new Map();
  for (const relative of stores) for await (const saved of documents(path.join(root, relative))) {
    if (saved.storage?.schemaVersion === 2 && !closure.stores.some(row => row.path === relative)) throw new Error('Owned store missing from closure.');
    await checkDocument(saved, path.join(root, relative), closure.manifest, path.join(root, 'catalogue'), pins);
  }
  for (const pin of Object.values(closure.manifest.bases)) {
    await readOwnedBase(path.join(root, 'catalogue'), { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, { dataset: pin.dataset, manifest: closure.manifest });
  }
  return closure;
}
export async function copyOwnedClosure(source, target, store) {
  if (!await exists(path.join(source, marker))) return;
  await copyTree(path.join(source, 'catalogue'), path.join(target, 'catalogue'));
  if (store) {
    const closure = await json(path.join(source, marker));
    closure.stores = closure.stores.filter(row => row.path === store).map(row => ({ ...row, path: 'store' }));
    await atomic(path.join(target, marker), encode(closure));
  } else await copyFile(path.join(source, marker), path.join(target, marker), 1);
}
export async function installOwnedClosure(root, stores, options, dataDir) {
  const closure = await verifyOwnedClosure(root, stores);
  if (!closure) return;
  if (!options) throw new Error('Owned restore requires explicit target catalogue options; flag remains off.');
  outside(root, options.catalogueRoot); outside(options.catalogueRoot, root);
  // Verify ALL dependencies against retained release pins before publishing any.
  const pending = [];
  for (const pin of Object.values(closure.manifest.bases)) {
    pinFor(options.manifest, { datasetDigest: pin.dataset.digest, sha256: pin.sha256 });
    const base = await readOwnedBase(path.join(root, 'catalogue'), { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, { dataset: pin.dataset, manifest: options.manifest });
    pending.push(createOwnedStorage({ ...options, dataset: pin.dataset, releaseBytes: Buffer.from(JSON.stringify(base)) }, dataDir));
  }
  for (const storage of pending) await storage.withLease(() => storage.ensurePublished());
}
// Used by the raw owned snapshot branch; the existing descriptor capture stays
// byte-for-byte on its old path. The caller holds group and catalogue barriers.
export async function captureOwnedStore(dataDir, target, id, source, step = async () => {}, started = performance.now()) {
  await noLinks(path.dirname(target));
  await headroom(path.dirname(target), 0, 64 * 1024 * 1024);
  await mkdir(target, { mode: 0o700 });
  try {
  const evidence = await capturePluginItemFiles(dataDir);
  await copyTree(dataDir, path.join(target, 'store'), { ignoreRoot: [...SNAPSHOT_EXCLUSIONS, 'state.json', ...pluginItemFiles] });
  for (const [name, bytes] of Object.entries(evidence)) await atomic(path.join(target, 'store', name), bytes);
  await copyFile(dataDir + '.dataset.json', path.join(target, 'store.dataset.json'), 1);
  await captureOwnedClosure(target, ['store'], [source], { step });
  const { syncRecoveryTree } = await import('./service-checkpoint.mjs');
  await syncRecoveryTree(target);
  await atomic(path.join(target, 'manifest.json'), encode({ format: 'picker-owned-capture-v1', files: await inventory(target) }));
  await verifyOwnedClosure(target, ['store']);
  await step('capture.owned-complete');
  const result = { id, heldMs: performance.now() - started };
  await atomic(path.join(target, 'complete.json'), encode(result));
  return result;
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}
