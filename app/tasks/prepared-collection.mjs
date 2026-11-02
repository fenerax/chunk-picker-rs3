import { createHash } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { preparationSourceDigest } from '../preparation-key.mjs';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// One immutable entry per scheduler, shared by native lanes. This fixed cap is
// separate from the existing snapshot/result byte ledger. Files contain only
// the definition-derived graph, never a state or dataset game defaults.
export const PREPARED_COLLECTION_LIMIT = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function preparedCollectionKey(data) {
  try {
    if (typeof data?.datasetDigest !== 'string') return;
    const bytes = data.definitionBytes === undefined ? Buffer.from(JSON.stringify(data.definitions)) : Buffer.from(data.definitionBytes);
    return hash(JSON.stringify([1, data.datasetDigest, preparationSourceDigest(), process.versions.node, process.versions.v8,
      data.datasetOptions ?? {}, data.preparedDatasetStages ?? [], hash(bytes)]));
  } catch { /* An optional preparation miss, including unreadable sources. */ }
}
export function validPreparedCollectionEntry(entry, key) {
  try {
    return typeof key === 'string' && entry?.key === key && entry.bytes instanceof Uint8Array
      && entry.bytes.byteLength > 0 && entry.bytes.byteLength <= PREPARED_COLLECTION_LIMIT && hash(entry.bytes) === entry.sha256;
  } catch { return false; }
}
export function encodePreparedCollection(key, value) {
  try {
    if (typeof key !== 'string') return;
    const bytes = serialize(value);
    if (bytes.length > PREPARED_COLLECTION_LIMIT) return;
    // The process transport copies once across IPC, then shares this backing
    // buffer between its relay and calculator thread instead of cloning it.
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
    shared.set(bytes);
    return { key, bytes: shared, sha256: hash(bytes) };
  } catch { /* Rebuild later. No native compressors in a terminable worker. */ }
}
export function decodePreparedCollection(entry, key) {
  try {
    if (!validPreparedCollectionEntry(entry, key)) return;
    const value = deserialize(entry.bytes);
    if (!Array.isArray(value?.channels) || !(value.catalogue instanceof Map) || !(value.completionGroups instanceof Map)) return;
    if (value.channels.some(row => !row || typeof row.kind !== 'string' || typeof row.name !== 'string')) return;
    for (const [id, row] of value.catalogue) if (typeof id !== 'string' || row?.id !== id || !Array.isArray(row.aliases)) return;
    for (const [name, ids] of value.completionGroups) if (typeof name !== 'string' || !Array.isArray(ids) || ids.some(id => !value.catalogue.has(id))) return;
    return value;
  } catch { /* Mismatched, truncated and corrupt entries are ordinary misses. */ }
}
export function readPreparedCollectionFile(reference, key) {
  try {
    if (typeof key !== 'string' || reference?.key !== key || typeof reference.file !== 'string'
      || !Number.isSafeInteger(reference.bytes) || reference.bytes <= 0 || reference.bytes > PREPARED_COLLECTION_LIMIT) return;
    const info = lstatSync(reference.file);
    if (!info.isFile() || info.size !== reference.bytes) return;
    return { key, sha256: reference.sha256, bytes: readFileSync(reference.file) };
  } catch { /* Missing, unreadable and corrupt files fall back to compilation. */ }
}
export function createWorkerPreparation(data, { mode = process.env.RS3_WORKER_PREPARATION_MODE ?? 'file',
  directory = process.env.RS3_WORKER_PREPARATION_DIR ?? tmpdir() } = {}) {
  const key = preparedCollectionKey(data);
  let entry, reference, cacheDirectory, pending, closed = false;
  let disabled = !key || !['file', 'memory'].includes(mode);
  return {
    input() {
      if (disabled || closed) return data;
      return mode === 'memory' ? { ...data, preparedCollection: entry, collectPreparedCollection: !entry }
        : { ...data, preparedCollectionFile: reference, collectPreparedCollection: !reference };
    },
    accept(message) {
      const value = message.preparedCollection;
      delete message.preparedCollection;
      if (disabled || closed || !validPreparedCollectionEntry(value, key)) return;
      if (mode === 'memory') { entry = value; return; }
      if (pending || reference) return;
      pending = (async () => {
        // Own a fresh private directory. Publish only after the complete write;
        // worker retirement never owns an in-progress write or native codec.
        await mkdir(directory, { recursive: true });
        cacheDirectory = await mkdtemp(path.join(directory, 'rs3-prepared-'));
        const temporary = path.join(cacheDirectory, `${key}.tmp`), file = path.join(cacheDirectory, `${key}.bin`);
        await writeFile(temporary, value.bytes, { flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
        if (!closed) reference = { file, key, sha256: value.sha256, bytes: value.bytes.byteLength };
      })().catch(() => { disabled = true; }).finally(() => { pending = undefined; });
    },
    settled() { return pending ?? Promise.resolve(); },
    async clear() {
      closed = true; entry = undefined; reference = undefined;
      await pending;
      if (cacheDirectory) { try { await rm(cacheDirectory, { recursive: true, force: true }); } catch {} }
    },
  };
}
