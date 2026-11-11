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
import { hasOwnedStorage } from '../../app/storage/owned-detection.mjs';

const marker = 'owned-closure.json', limit = 256 * 1024 * 1024;
const baseName = pin => `catalogue-${pin.sha256}.json.gz`;
async function document(file) {
  await noLinks(file);
  if ((await lstat(file)).size > limit) throw new Error('Owned recovery document exceeds byte limit.');
  const bytes = await readFile(file);
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: limit }) : bytes).toString('utf8'));
}
const manifests = trust => trust?.bases ? [trust] : [trust?.manifest, ...(trust?.retainedManifests ?? [])];
const trustPin = pin => ({ dataset: pin.dataset, manifest: createOwnedBaseManifest([pin]) });
function pinFor(trust, reference) {
  for (const manifest of manifests(trust)) {
    const candidate = manifest?.bases?.[reference?.datasetDigest];
    if (candidate?.sha256 !== reference?.sha256) continue;
    const pin = resolveOwnedBasePin(manifest, candidate.dataset);
    validateOwnedBaseReference(reference, pin); return pin;
  }
  throw new Error('Owned recovery base reference has no retained release pin.');
}
function manifestSet(pins) {
  const primary = [], retainedManifests = [], seen = new Set();
  for (const pin of pins) {
    if (seen.has(pin.dataset.digest)) retainedManifests.push(createOwnedBaseManifest([pin]));
    else { primary.push(pin); seen.add(pin.dataset.digest); }
  }
  return { manifest: createOwnedBaseManifest(primary), ...(retainedManifests.length ? { retainedManifests } : {}) };
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
  if (!await exists(path.join(root, marker)) || !await hasOwnedStorage(path.join(dataDir, 'state.json'))) return undefined;
  const closure = await json(path.join(root, marker)), saved = await document(path.join(dataDir, 'state.json'));
  if (saved.storage?.schemaVersion !== 2) return undefined;
  const pin = pinFor(closure, saved.storage.base);
  return { pickerId: closure.stores.find(row => row.path === path.basename(dataDir))?.pickerId,
    catalogueRoot: path.join(root, 'catalogue'), dataset: pin.dataset, manifest: closure.manifest,
    ...(closure.retainedManifests ? { retainedManifests: closure.retainedManifests } : {}) };
}
export async function recoverySources(dataDirs, explicit) {
  return Promise.all(dataDirs.map(async dataDir => {
    const options = await ownedRecoveryOptions(dataDir, explicit);
    if (!options) return null;
    const storage = ownedArtifactSource(dataDir) ?? createOwnedStorage(options, dataDir);
    return { dataDir, options, storage, validate: options.validateCapture ?? storage.validateCapture };
  }));
}
// Acquire only AFTER draining group writers, otherwise a drained writer could
// itself be waiting for this catalogue lease. Hold through complete publication.
export async function withRecoveryLeases(sources, work) {
  const unique = [...new Map(sources.filter(Boolean).map(source => [path.resolve(source.options.catalogueRoot), source.storage])).entries()].sort();
  const enter = index => index === unique.length ? work() : unique[index][1].withLease(() => enter(index + 1), { mode: 'exclusive' });
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
    const base = await readOwnedBase(catalogueRoot, saved.storage.base, trustPin(pin));
    state = ownedCodec(base, pin).decode({ ...saved, state }).state;
    pins.set(pin.sha256, pin);
  }
  for (const reference of state.provenance?.historyArchive ?? []) {
    if (!/^history-\d{16}-\d{16}-[a-f0-9]{16}\.json\.gz$/.test(reference?.id ?? '')) throw new Error('Invalid recovery History reference.');
    const segment = await document(path.join(store, 'history', reference.id));
    if (segment.format !== 'rs3-chunk-picker-history' || !Array.isArray(segment.events)) throw new Error('Invalid recovery History segment.');
  }
  return state;
}
// Decoding only: release-scoped probes supply the existing semantic validators.
export async function* ownedRecoveryStates(store, options) {
  for await (const saved of documents(store)) yield { saved,
    state: await checkDocument(saved, store, options, options.catalogueRoot, new Map()) };
}
async function dependencyFiles(root, stores) {
  return (await inventory(root)).filter(row => !row.directory && (row.path.startsWith('catalogue/')
    || stores.some(store => row.path.startsWith(store + '/') || row.path === store + '.dataset.json')));
}
export async function captureOwnedClosure(root, stores, sources, { step = async () => {}, validate } = {}) {
  const pins = new Map(), rows = [];
  for (const [index, relative] of stores.entries()) {
    const source = sources[index], store = path.join(root, relative);
    if (!source) {
      if (await hasOwnedStorage(path.join(store, 'state.json'))) throw new Error('Owned recovery requires the pinned catalogue source.');
      continue;
    }
    for await (const saved of documents(store)) {
      await checkDocument(saved, store, source.options, source.options.catalogueRoot, pins);
    }
    rows.push({ path: relative, pickerId: source.options.pickerId });
  }
  if (!pins.size) return false;
  await mkdir(path.join(root, 'catalogue'), { mode: 0o700 });
  for (const pin of pins.values()) {
    const source = sources.find(row => row && manifests(row.options).some(manifest => manifest.bases[pin.dataset.digest]?.sha256 === pin.sha256));
    await step('capture.owned-base');
    await copyFile(path.join(source.options.catalogueRoot, baseName(pin)), path.join(root, 'catalogue', baseName(pin)), 1);
    await readOwnedBase(path.join(root, 'catalogue'), { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, trustPin(pin));
  }
  const { syncRecoveryTree } = await import('./service-checkpoint.mjs');
  await syncRecoveryTree(root);
  await step('capture.owned-dependencies-durable');
  await step('capture.owned-manifest');
  const closure = { schemaVersion: 1, validated: false, stores: rows, ...manifestSet(pins.values()),
    files: await dependencyFiles(root, rows.map(row => row.path)) };
  await atomic(path.join(root, marker), encode(closure));
  for (const row of rows) {
    const source = sources[stores.indexOf(row.path)], probe = validate ?? source.validate;
    if (typeof probe !== 'function') throw new Error('Owned capture requires a release-scoped validation probe.');
    await step('capture.owned-probe');
    await probe(path.join(root, row.path), { ...source.options, catalogueRoot: path.join(root, 'catalogue'),
      manifest: closure.manifest, retainedManifests: closure.retainedManifests ?? [] });
  }
  // The probe may use a scratch copy, but it may never bless changed inputs.
  // Recheck the original pins after validation, before any completion record.
  await step('capture.owned-validated');
  if (encode(closure.files) !== encode(await dependencyFiles(root, rows.map(row => row.path)))) throw new Error('Owned dependency hash or size mismatch after validation.');
  await atomic(path.join(root, marker), encode({ ...closure, validated: true }));
  await verifyOwnedClosure(root, stores);
  return true;
}
export async function verifyOwnedClosure(root, stores) {
  const present = await exists(path.join(root, marker));
  if (!present) {
    for (const store of stores) {
      if (await hasOwnedStorage(path.join(root, store, 'state.json'))) throw new Error('Owned recovery dependency closure is missing.');
    }
    return null;
  }
  await noLinks(path.join(root, marker));
  const closure = await json(path.join(root, marker));
  if (closure.schemaVersion !== 1 || closure.validated !== true || !Array.isArray(closure.stores)
    || closure.stores.some(row => !stores.includes(row.path) || typeof row.pickerId !== 'string' || row.pickerId === 'legacy-shared')
    || new Set(closure.stores.map(row => row.path)).size !== closure.stores.length) throw new Error('Invalid owned closure manifest.');
  if (!Array.isArray(closure.files) || encode(closure.files) !== encode(await dependencyFiles(root, closure.stores.map(row => row.path)))) {
    throw new Error('Owned dependency hash or size mismatch.');
  }
  if (await exists(path.join(root, 'manifest.json'))) {
    const manifest = await json(path.join(root, 'manifest.json'));
    if (manifest.format === 'picker-owned-capture-v1' && encode(manifest.files) !== encode((await inventory(root))
      .filter(row => !['manifest.json', 'complete.json'].includes(row.path)))) throw new Error('Owned capture manifest differs.');
  }
  const pins = new Map();
  for (const relative of stores) {
    if (!closure.stores.some(row => row.path === relative)) {
      if (await hasOwnedStorage(path.join(root, relative, 'state.json'))) throw new Error('Owned store missing from closure.');
      continue;
    }
    for await (const saved of documents(path.join(root, relative))) {
      await checkDocument(saved, path.join(root, relative), closure, path.join(root, 'catalogue'), pins);
    }
  }
  for (const pin of manifests(closure).flatMap(manifest => Object.values(manifest.bases))) {
    await readOwnedBase(path.join(root, 'catalogue'), { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, trustPin(pin));
  }
  return closure;
}
// Quarantine keeps post-probe bytes. Its journal pins the store before this
// reseal and records the new closure hash only after full dependency verification.
export async function resealOwnedQuarantine(root) {
  const file = path.join(root, marker);
  await noLinks(file);
  const closure = await json(file);
  const { syncRecoveryTree } = await import('./service-checkpoint.mjs');
  await syncRecoveryTree(root);
  await atomic(file, encode({ ...closure, files: await dependencyFiles(root, ['store']) }));
  await verifyOwnedClosure(root, ['store']);
}
export async function copyOwnedClosure(source, target, store) {
  if (!await exists(path.join(source, marker))) return;
  await copyTree(path.join(source, 'catalogue'), path.join(target, 'catalogue'));
  if (store) {
    const closure = await json(path.join(source, marker));
    closure.stores = closure.stores.filter(row => row.path === store).map(row => ({ ...row, path: 'store' }));
    closure.files = closure.files.filter(row => row.path.startsWith('catalogue/') || row.path.startsWith(store + '/') || row.path === store + '.dataset.json')
      .map(row => ({ ...row, path: row.path.startsWith('catalogue/') ? row.path : 'store' + row.path.slice(store.length) }));
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
  for (const pin of manifests(closure).flatMap(manifest => Object.values(manifest.bases))) {
    pinFor(options, { datasetDigest: pin.dataset.digest, sha256: pin.sha256 });
    const base = await readOwnedBase(path.join(root, 'catalogue'), { datasetDigest: pin.dataset.digest, sha256: pin.sha256 }, trustPin(pin));
    pending.push(createOwnedStorage({ ...options, ...trustPin(pin), releaseBytes: Buffer.from(JSON.stringify(base)) }, dataDir));
  }
  for (const storage of pending) await storage.withLease(() => storage.ensurePublished(), { mode: 'exclusive' });
}
// Used by the raw owned snapshot branch; the existing descriptor capture stays
// byte-for-byte on its old path. The caller holds group and catalogue barriers.
export async function captureOwnedStore(dataDir, target, id, source, step = async () => {}, started = performance.now()) {
  await noLinks(path.dirname(target));
  // The caller holds both writer barriers and the catalogue lease. Count the
  // same files we copy, including bases referenced only by retained documents.
  const files = await inventory(dataDir, { ignoreRoot: SNAPSHOT_EXCLUSIONS }), pins = new Map();
  for await (const saved of documents(dataDir)) {
    await checkDocument(saved, dataDir, source.options, source.options.catalogueRoot, pins);
  }
  let bytes = (await lstat(dataDir + '.dataset.json')).size + files.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  for (const pin of pins.values()) bytes += (await lstat(path.join(source.options.catalogueRoot, baseName(pin)))).size;
  await headroom(path.dirname(target), bytes, 64 * 1024 * 1024);
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
