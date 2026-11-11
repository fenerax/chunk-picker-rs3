import path from 'node:path';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { readOwnedBase, verifyOwnedBaseBytes } from './owned-base.mjs';
import { resolveOwnedBasePin, validateOwnedBaseReference } from './owned-base-schema.mjs';
import { ownedCodec } from './owned-codec.mjs';
import { atomicWrite } from './atomic-write.mjs';
import { syncDirectory } from './publication.mjs';
import { acquireProcessGuard } from './process-guard.mjs';
import { withStoreWrite } from './snapshot.mjs';
import { registerOwnedCalculatorBase } from '../tasks/owned-transport.mjs';
import { createCatalogueLease, catalogueLeaseMode } from './catalogue-lease.mjs';

const bases = new Map(), verifiedRoots = new Map(), admissions = new Map(), durableRoots = new Set();
const newlyCreatedRoots = new Set();
const artifactSources = new Map();
export function ownedArtifactSource(dataDir) { return artifactSources.get(path.resolve(dataDir)); }
// Bigint stats: NTFS file IDs exceed 2^53 and ms timestamps lose precision. ctime
// cannot be set from userland, so a rewrite always changes this fingerprint.
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const lstatExact = file => lstat(file, { bigint: true });
const contains = (parent, child) => { const relative = path.relative(parent, child); return !relative || !relative.startsWith('..') && !path.isAbsolute(relative); };
function rootAdmission(root) {
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  // Keep root coordination independent of a group's codec/release-byte scope.
  if (!admissions.has(key)) admissions.set(key, createCatalogueLease(async () => {
    if (await mkdir(root, { recursive: true })) newlyCreatedRoots.add(key);
    if (!durableRoots.has(key)) {
      for (let directory = root; ; directory = path.dirname(directory)) {
        await syncDirectory(directory);
        if (directory === path.dirname(directory)) break;
      }
      durableRoots.add(key);
    }
    return acquireProcessGuard(root);
  }));
  return { key, admission: admissions.get(key) };
}
/** Inert unless explicitly injected by a caller. No environment/startup flag. */
export function createOwnedStorage(options, dataDir, { readOnly = false } = {}) {
  // Trust comes from retained release manifests, never from a saved document.
  // Reading a backup must not switch the writer away from its current base.
  const release = createPinnedStorage(options, dataDir, { readOnly });
  const readers = new Map(), manifests = [options.manifest, ...(options.retainedManifests ?? [])];
  let active = release;
  function reader(reference) {
    const key = `${reference?.datasetDigest}:${reference?.sha256}`;
    if (readers.has(key)) return readers.get(key);
    for (const manifest of manifests) {
      const pin = manifest?.bases?.[reference?.datasetDigest];
      if (!pin || pin.sha256 !== reference?.sha256) continue;
      if (pin.dataset.id !== options.dataset.id || pin.dataset.contractVersion !== options.dataset.contractVersion) break;
      const value = createPinnedStorage({ ...options, manifest, dataset: pin.dataset,
        releaseBytes: pin.sha256 === release.readerOptions.manifest.bases[options.dataset.digest].sha256 ? options.releaseBytes : undefined }, dataDir, { readOnly });
      readers.set(key, value); return value;
    }
    throw new TypeError('Owned base reference has no matching retained release pin.');
  }
  async function selectBase(reference, beforeEnable = () => {}) {
    const previous = active;
    try {
      if (reference) {
        const selected = reader(reference); await selected.read(reference); active = selected;
        await options.crash?.('catalogue-base-selected');
      }
      beforeEnable();
    } catch (error) { active = previous; throw error; }
  }
  const storage = {
    read: reference => reader(reference).read(reference),
    select: reference => release.withLease(() => selectBase(reference), { mode: 'exclusive' }),
    codec: () => active.codec(), ensurePublished: () => active.ensurePublished(),
    async withLease(work, { mode = 'exclusive', ...admission } = {}) {
      // A first-publication command keeps its original preimage -> dependency
      // -> state order, entirely exclusive. Never upgrade at a rename boundary.
      const selectedMode = mode === 'shared' && !readOnly && !active.published ? 'exclusive' : mode;
      return release.withLease(async () => {
        if (selectedMode === 'shared' && !readOnly) await active.assertPublished();
        return work();
      }, { ...admission, mode: selectedMode });
    }, writeState: (...args) => active.writeState(...args),
    sameState: (a, b) => active.sameState(a, b), crash: options.crash,
    readerOptions: { ...release.readerOptions, retainedManifests: structuredClone(options.retainedManifests ?? []) },
    activate: (reference, beforeEnable = () => {}) => release.withLease(async () => {
      // Standby verification may bypass writer admission; choosing the writer's
      // authoritative base and enabling publication may not.
      await selectBase(reference, beforeEnable);
      readOnly = false; release.activate(); for (const value of readers.values()) value.activate();
    }, { mode: 'exclusive', writerAdmission: true }),
    get base() { return active.base; },
    registerArtifacts() {
      artifactSources.set(path.resolve(dataDir), storage);
      return () => { if (artifactSources.get(path.resolve(dataDir)) === storage) artifactSources.delete(path.resolve(dataDir)); };
    },
  };
  return storage;
}
function createPinnedStorage(options, dataDir, { readOnly = false } = {}) {
  if (!options || typeof options !== 'object' || !options.pickerId || options.pickerId === 'legacy-shared'
    || typeof options.catalogueRoot !== 'string') throw new TypeError('Owned storage requires an owned picker and external catalogueRoot.');
  const pin = resolveOwnedBasePin(options.manifest, options.dataset), root = path.resolve(options.catalogueRoot);
  if (contains(dataDir, root) || contains(root, dataDir)) throw new TypeError('Owned catalogueRoot must be outside picker/deletion trees.');
  const trust = { dataset: pin.dataset, manifest: { schemaVersion: 1, bases: { [pin.dataset.digest]: pin } } };
  const reference = { datasetDigest: pin.dataset.digest, sha256: pin.sha256 };
  const crash = options.crash;
  let base, compressed, verifiedIdentity, durableIdentity;
  const filename = path.join(root, `catalogue-${pin.sha256}.json.gz`);
  const { key, admission } = rootAdmission(root);
  // Retain one parsed/encoded base per hash, not a release Buffer per group.
  function remember(value, bytes) {
    if (!bases.has(pin.sha256)) bases.set(pin.sha256, { base: value, compressed: bytes && gzipSync(bytes) });
    const shared = bases.get(pin.sha256);
    if (bytes && !shared.compressed) shared.compressed = gzipSync(bytes);
    base = shared.base;
    registerOwnedCalculatorBase(base, pin);
    compressed = shared.compressed;
    return ownedCodec(base, pin);
  }
  if (options.releaseBytes !== undefined) {
    if (!Buffer.isBuffer(options.releaseBytes) || createHash('sha256').update(options.releaseBytes).digest('hex') !== pin.sha256) throw new TypeError('Owned release base checksum mismatch.');
    remember(bases.get(pin.sha256)?.base ?? verifyOwnedBaseBytes(options.releaseBytes, trust), options.releaseBytes);
  }
  async function read(referenceToRead) {
    validateOwnedBaseReference(referenceToRead, pin);
    try {
      const canonical = await realpath(root), file = await realpath(filename), key = `${canonical}:${pin.sha256}`;
      const stat = await lstatExact(file), identity = `${file}:${fingerprint(stat)}`;
      if (path.dirname(file) !== canonical || !stat.isFile()) throw new TypeError('Invalid owned base location or file.');
      const cached = verifiedRoots.get(key);
      if (cached?.identity !== identity) {
        const value = await readOwnedBase(root, referenceToRead, trust);
        if (fingerprint(stat) !== fingerprint(await lstatExact(file)) || await realpath(filename) !== file) throw new TypeError('Owned base changed during verification.');
        remember(value);
        verifiedRoots.set(key, { identity, base });
      } else remember(cached.base);
      verifiedIdentity = identity;
    } catch (cause) {
      throw new Error(`Owned catalogue base unavailable: ${path.basename(filename)}; restore or rebuild the exact pinned release base.`, { cause });
    }
    // Verified content is not proof that its directory entry was synced.
    return ownedCodec(base, pin);
  }
  async function codec() {
    if (!base) return read(reference);
    return ownedCodec(base, pin);
  }
  function sameState(a, b) {
    if (a === b) return true;
    if (!base) return isDeepStrictEqual(a, b);
    const { tasks: aTasks, identityRegistry: aRegistry, ...aPayload } = a;
    const { tasks: bTasks, identityRegistry: bRegistry, ...bPayload } = b;
    if (!isDeepStrictEqual(aPayload, bPayload)) return false;
    if (aTasks === bTasks && aRegistry === bRegistry) return true;
    const encoder = ownedCodec(base, pin), one = encoder.encode(a).storage.delta, two = encoder.encode(b).storage.delta;
    return isDeepStrictEqual(one.tasks, two.tasks) && isDeepStrictEqual(one.identityRegistry, two.identityRegistry);
  }
  async function publish() {
    try {
      await read(reference);
    } catch (error) {
      // Only an unpublished release seed may create a missing dependency.
      // Never repair a base already referenced or found to be corrupt.
      if (verifiedIdentity || !base || error.cause?.code !== 'ENOENT') throw error;
      compressed ??= bases.get(pin.sha256).compressed ??= gzipSync(Buffer.from(JSON.stringify(base)));
      await atomicWrite(filename, compressed, { beforeRename: () => crash?.('base-temporary-synced') });
      await crash?.('base-durable');
      await read(reference);
      durableIdentity = verifiedIdentity;
      return;
    }
    if (durableIdentity === verifiedIdentity) return;
    // Under the publication lease, retry even after a verified reopen: an
    // earlier rename may have succeeded while its directory sync failed.
    await syncDirectory(root);
    durableIdentity = verifiedIdentity;
  }
  async function assertPublished() {
    await read(reference);
    if (!durableIdentity || durableIdentity !== verifiedIdentity) throw new Error('Owned catalogue requires exclusive publication before a shared save.');
  }
  function ensurePublished() {
    if (catalogueLeaseMode(admission) === 'shared') return assertPublished();
    return withLease(publish, { mode: 'exclusive' });
  }
  async function withLease(work, { mode = 'exclusive', signal, onQueued, writerAdmission = false } = {}) {
    // Isolated readers run under the writer/capture admission; they never
    // publish a dependency. Standby activation switches to writer admission.
    if (readOnly && !writerAdmission) return work();
    return withStoreWrite(root, () => admission(async () => {
      if (newlyCreatedRoots.delete(key)) await crash?.('catalogue-root-durable');
      await crash?.(`catalogue-${mode}-admitted`);
      const canonical = await realpath(root), group = await realpath(dataDir);
      if (contains(group, canonical) || contains(canonical, group)) throw new TypeError('Owned catalogueRoot overlaps the picker tree.');
      try { return await work(); }
      finally { await crash?.(`catalogue-${mode}-releasing`); }
    }, { mode, signal, onQueued }));
  }
  async function writeState(file, bytes, options = {}) {
    return withLease(() => atomicWrite(file, bytes, { ...options,
      beforeRename: async () => {
        await crash?.('state-temporary-synced');
        await options.beforeRename?.();
        await crash?.('commit-hook-complete');
        await ensurePublished();
        await crash?.('dependencies-durable');
      }, afterRename: () => crash?.('state-renamed'), afterDirectorySync: () => crash?.('state-directory-synced') }),
    { mode: durableIdentity ? 'shared' : 'exclusive' });
  }
  const storage = { codec, read, withLease, writeState, sameState, crash, ensurePublished, assertPublished,
    readerOptions: { pickerId: options.pickerId, catalogueRoot: root, ...trust, manifest: structuredClone(options.manifest) },
    activate() { readOnly = false; }, get base() { return base; }, get published() { return !!durableIdentity; } };
  storage.registerArtifacts = () => {
    artifactSources.set(path.resolve(dataDir), storage);
    return () => { if (artifactSources.get(path.resolve(dataDir)) === storage) artifactSources.delete(path.resolve(dataDir)); };
  };
  return storage;
}
