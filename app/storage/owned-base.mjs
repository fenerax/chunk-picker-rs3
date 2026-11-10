import path from 'node:path';
import { open, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { OWNED_BASE_FORMAT, OWNED_BASE_GENERATOR_VERSION, copyBaseJson, baseFailure,
  ownedBaseLimits, validateOwnedBase, resolveOwnedBasePin, validateOwnedBaseReference } from './owned-base-schema.mjs';

const decompress = promisify(gunzip);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
function serialize(base) {
  const { id, contractVersion, digest } = base.dataset;
  const { schemaVersion, entries, aliases, unresolved } = base.identityRegistry;
  return Buffer.from(JSON.stringify({ baseFormat: OWNED_BASE_FORMAT, generatorVersion: OWNED_BASE_GENERATOR_VERSION,
    dataset: { id, contractVersion, digest }, tasks: base.tasks,
    identityRegistry: { schemaVersion, entries, aliases, unresolved } }), 'utf8');
}

/** Input is ONLY the catalogue projection of pinned fresh owned preparation.
 * No save, members, saved registry, clock, dataset runtime or discovery is read.
 * Task/row/dictionary/candidate order is input order, never sorted or normalized.
 */
export function buildOwnedBase(projection, { limits: overrides } = {}) {
  const limits = ownedBaseLimits(overrides);
  const input = copyBaseJson(projection, 0, limits.depth);
  if (!input || Object.keys(input).length !== 3 || !['dataset', 'tasks', 'identityRegistry'].every(key => Object.hasOwn(input, key))) baseFailure('projection');
  const { dataset, tasks, identityRegistry } = input;
  const base = copyBaseJson({ baseFormat: OWNED_BASE_FORMAT, generatorVersion: OWNED_BASE_GENERATOR_VERSION, dataset, tasks, identityRegistry });
  validateOwnedBase(base, limits);
  const bytes = serialize(base);
  if (bytes.length > limits.bytes) baseFailure('byte limit');
  const pin = copyBaseJson({ dataset: base.dataset, sha256: sha(bytes), generatorVersion: base.generatorVersion });
  return { base, bytes, pin };
}

/** Verify exact decompressed bytes against an independently retained release pin. */
export function verifyOwnedBaseBytes(bytes, { dataset, manifest, limits: overrides } = {}) {
  const limits = ownedBaseLimits(overrides), pin = resolveOwnedBasePin(manifest, dataset);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > limits.bytes) baseFailure('byte limit');
  if (sha(bytes) !== pin.sha256) baseFailure('checksum mismatch');
  const value = copyBaseJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 0, limits.depth);
  validateOwnedBase(value, limits);
  if (value.dataset.id !== pin.dataset.id || value.dataset.contractVersion !== pin.dataset.contractVersion
    || value.dataset.digest !== pin.dataset.digest || value.generatorVersion !== pin.generatorVersion) baseFailure('dataset pin mismatch');
  if (!bytes.equals(serialize(value))) baseFailure('noncanonical bytes');
  return value;
}

/** Read-only cold-open verifier. It neither publishes nor repairs dependencies.
 * io is injectable for deterministic containment/replacement failure tests.
 */
export async function readOwnedBase(catalogueRoot, reference, { dataset, manifest, limits: overrides,
  io = { open, realpath, lstat } } = {}) {
  const limits = ownedBaseLimits(overrides), pin = resolveOwnedBasePin(manifest, dataset);
  validateOwnedBaseReference(reference, pin);
  // Capture trust inputs before the first await; callers cannot change the pin mid-open.
  const options = { dataset: pin.dataset, manifest: { schemaVersion: 1, bases: { [pin.dataset.digest]: pin } }, limits };
  const filename = `catalogue-${pin.sha256}.json.gz`;
  try {
    const root = await io.realpath(catalogueRoot), target = path.join(root, filename);
    const file = await io.realpath(target);
    if (path.dirname(file) !== root) baseFailure('location escapes catalogue root');
    const handle = await io.open(file, 'r');
    let compressed;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size < 1 || before.size > limits.compressedBytes) baseFailure('compressed byte limit');
      // A fixed allocation bounds even a file that grows after stat; one extra byte detects growth.
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== before.size || fingerprint(before) !== fingerprint(await handle.stat())
        || fingerprint(before) !== fingerprint(await io.lstat(file)) || await io.realpath(target) !== file) baseFailure('file changed during read');
      compressed = buffer.subarray(0, length);
    } finally { await handle.close(); }
    const bytes = await decompress(compressed, { maxOutputLength: limits.bytes });
    return verifyOwnedBaseBytes(bytes, options);
  } catch (error) {
    throw new Error(`Owned catalogue base unavailable: ${filename}; restore or rebuild the exact pinned release base.`, { cause: error });
  }
}
