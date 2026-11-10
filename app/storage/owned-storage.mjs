import path from 'node:path';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
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

const bases = new Map(), verifiedRoots = new Map(), admissions = new Map(), durableRoots = new Set(), lease = new AsyncLocalStorage();
const contains = (parent, child) => { const relative = path.relative(parent, child); return !relative || !relative.startsWith('..') && !path.isAbsolute(relative); };
/** Inert unless explicitly injected by a caller. No environment/startup flag. */
export function createOwnedStorage(options, dataDir, { readOnly = false } = {}) {
  if (!options || typeof options !== 'object' || !options.pickerId || options.pickerId === 'legacy-shared'
    || typeof options.catalogueRoot !== 'string') throw new TypeError('Owned storage requires an owned picker and external catalogueRoot.');
  const pin = resolveOwnedBasePin(options.manifest, options.dataset), root = path.resolve(options.catalogueRoot);
  if (contains(dataDir, root) || contains(root, dataDir)) throw new TypeError('Owned catalogueRoot must be outside picker/deletion trees.');
  const trust = { dataset: pin.dataset, manifest: { schemaVersion: 1, bases: { [pin.dataset.digest]: pin } } };
  const reference = { datasetDigest: pin.dataset.digest, sha256: pin.sha256 };
  const crash = options.crash;
  let base, compressed, published = false;
  const filename = path.join(root, `catalogue-${pin.sha256}.json.gz`);
  // Retain one parsed/encoded base per hash, not a release Buffer per group.
  function remember(value, bytes) {
    if (!bases.has(pin.sha256)) bases.set(pin.sha256, { base: value, compressed: bytes && gzipSync(bytes) });
    const shared = bases.get(pin.sha256);
    if (bytes && !shared.compressed) shared.compressed = gzipSync(bytes);
    base = shared.base;
    compressed = shared.compressed;
    return ownedCodec(base, pin);
  }
  if (options.releaseBytes !== undefined) {
    if (!Buffer.isBuffer(options.releaseBytes) || createHash('sha256').update(options.releaseBytes).digest('hex') !== pin.sha256) throw new TypeError('Owned release base checksum mismatch.');
    remember(bases.get(pin.sha256)?.base ?? verifyOwnedBaseBytes(options.releaseBytes, trust), options.releaseBytes);
  }
  async function read(referenceToRead) {
    validateOwnedBaseReference(referenceToRead, pin);
    const canonical = await realpath(root), key = `${canonical}:${pin.sha256}`;
    if (!verifiedRoots.has(key)) {
      const value = await readOwnedBase(root, referenceToRead, trust);
      remember(value);
      verifiedRoots.set(key, base);
    } else base = verifiedRoots.get(key);
    published = true;
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
  async function ensurePublished() {
    if (published) return;
    try {
      await lstat(filename); await read(reference); published = false;
      // A previous publisher may have renamed successfully but failed its sync.
      await syncDirectory(root); published = true; return;
    } catch (error) { published = false; if (error.code !== 'ENOENT') throw error; }
    if (!base) await read(reference); // Never seed an empty/missing dependency.
    compressed ??= bases.get(pin.sha256).compressed ??= gzipSync(Buffer.from(JSON.stringify(base)));
    await atomicWrite(filename, compressed, { beforeRename: () => crash?.('base-temporary-synced') });
    await crash?.('base-durable');
    // Only a successful verified cold open may populate the root cache.
    await read(reference);
  }
  async function withLease(work) {
    // Isolated readers run under the writer/capture admission; they never
    // publish a dependency. Standby activation switches to writer admission.
    if (readOnly || lease.getStore() === root) return work();
    const previous = admissions.get(root) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(() => withStoreWrite(root, async () => {
      const first = readOnly ? undefined : await mkdir(root, { recursive: true });
      if (!readOnly && !durableRoots.has(root)) {
        // Sync the ancestry even when a prior process left partially created
        // directories. Existence after a failed sync is not a durability proof.
        for (let directory = root; ; directory = path.dirname(directory)) {
          await syncDirectory(directory);
          if (directory === path.dirname(directory)) break;
        }
        durableRoots.add(root);
      }
      if (first) await crash?.('catalogue-root-durable');
      const canonical = await realpath(root), group = await realpath(dataDir);
      if (contains(group, canonical) || contains(canonical, group)) throw new TypeError('Owned catalogueRoot overlaps the picker tree.');
      // Kernel lease dies with a crashed publisher. A concurrent process refuses
      // safely; in-isolate publishers queue and deduplicate verified content.
      const release = await acquireProcessGuard(canonical);
      try { return await lease.run(root, work); } finally { await release(); }
    }));
    admissions.set(root, result);
    try { return await result; } finally { if (admissions.get(root) === result) admissions.delete(root); }
  }
  async function writeState(file, bytes, options = {}) {
    return withLease(() => atomicWrite(file, bytes, { ...options,
      beforeRename: async () => {
        await crash?.('state-temporary-synced');
        await options.beforeRename?.();
        await crash?.('commit-hook-complete');
        await ensurePublished();
        await crash?.('dependencies-durable');
      }, afterRename: () => crash?.('state-renamed'), afterDirectorySync: () => crash?.('state-directory-synced') }));
  }
  return { codec, read, withLease, writeState, sameState, crash,
    readerOptions: { pickerId: options.pickerId, catalogueRoot: root, ...trust },
    activate() { readOnly = false; }, get base() { return base; } };
}
