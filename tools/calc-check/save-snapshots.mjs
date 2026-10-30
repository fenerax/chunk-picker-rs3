import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash } from './compare.mjs';

const backupId = /^(\d{16})-[a-f0-9]{16}\.json(?:\.gz)?$/;
const historyId = /^history-\d{16}-\d{16}-[a-f0-9]{16}\.json\.gz$/;
const archiveId = /^archive-[a-f0-9]{16}\.json\.gz$/;
const staticId = /^static-([a-f0-9]{64})\.json\.gz$/;
const staticKeys = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
const invalid = () => { throw new TypeError('invalid-save-snapshot'); };

// Read only a verified gameplay copy. Storage's public validators remain the
// normalization boundary; parsed sidecars are cached and cloned before use.
export async function saveSnapshots(directory, registry) {
  const { BACKUP_FORMAT, SCHEMA_VERSION, validateOwnedState, validateState, cancelTaskClaimUndo } = await import('../../app/core/state.mjs');
  const staticCache = new Map(), historyCache = new Map(), backups = [];
  let cachedBytes = 0;
  async function safeFile(base, name) {
    const root = await realpath(path.join(directory, base));
    const file = await realpath(path.join(root, name));
    if (path.dirname(file) !== root) invalid();
    return file;
  }
  async function document(base, name) {
    const bytes = await readFile(await safeFile(base, name));
    return JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'));
  }
  async function importDocument(input) {
    const doc = typeof input === 'string' ? JSON.parse(input) : input;
    if (!doc || doc.format !== BACKUP_FORMAT || doc.schemaVersion !== SCHEMA_VERSION || !doc.state || typeof doc.state !== 'object' || Array.isArray(doc.state)) invalid();
    const state = structuredClone(doc.state);
    if (doc.storage !== undefined) {
      const metadata = doc.storage;
      if (!metadata || metadata.schemaVersion !== 1 || Object.keys(metadata).some(key => !['schemaVersion', 'fields'].includes(key)) || !metadata.fields || typeof metadata.fields !== 'object' || Array.isArray(metadata.fields)) invalid();
      for (const [key, reference] of Object.entries(metadata.fields)) {
        const match = staticId.exec(reference?.id ?? '');
        if (!staticKeys.has(key) || Object.hasOwn(state, key) || !match || reference.sha256 !== match[1] || Object.keys(reference).some(key => !['id','sha256'].includes(key))) invalid();
        if (!staticCache.has(reference.id)) {
          const bytes = gunzipSync(await readFile(await safeFile('static', reference.id)));
          if (hash(bytes) !== reference.sha256) invalid();
          // Bound retained parsed inputs even on saves with many sidecar versions.
          if (cachedBytes + bytes.length > 128 * 1024 * 1024) { staticCache.clear(); cachedBytes = 0; }
          staticCache.set(reference.id, JSON.parse(bytes)); cachedBytes += bytes.length;
        }
        state[key] = structuredClone(staticCache.get(reference.id));
      }
    }
    const validated = validateOwnedState(state, registry), events = new Map();
    const references = validated.provenance?.historyArchive ?? [];
    if (!Array.isArray(references)) invalid();
    for (const reference of references) {
      if (!historyId.test(reference?.id)) invalid();
      if (!historyCache.has(reference.id)) {
        const doc = await document('history', reference.id);
        if (doc.format !== 'rs3-chunk-picker-history' || !Array.isArray(doc.events)) invalid();
        if (historyCache.size >= 8) historyCache.delete(historyCache.keys().next().value);
        historyCache.set(reference.id, doc);
      }
      for (const event of historyCache.get(reference.id).events) events.set(event.revision, event);
    }
    for (const event of validated.history) events.set(event.revision, event);
    const complete = { ...validated, history: [...events.values()].sort((a,b) => a.revision - b.revision) };
    if (complete.provenance?.historyArchive !== undefined) { complete.provenance = { ...complete.provenance }; delete complete.provenance.historyArchive; }
    if (doc.coordination !== undefined) {
      const c = doc.coordination;
      if (!c || typeof c !== 'object' || Array.isArray(c) || c.schemaVersion !== 1 || Object.keys(c).some(k => !['schemaVersion','lastNonClaimRevision','invalidatedUndo'].includes(k)) || !Number.isSafeInteger(c.lastNonClaimRevision) || c.lastNonClaimRevision < 0 || c.lastNonClaimRevision > validated.revision || !c.invalidatedUndo || typeof c.invalidatedUndo !== 'object' || Array.isArray(c.invalidatedUndo)) invalid();
      for (const [id, through] of Object.entries(c.invalidatedUndo)) {
        if (!id || ['__proto__','prototype','constructor'].includes(id) || !Number.isSafeInteger(through) || through < 0 || through > validated.revision) invalid();
        cancelTaskClaimUndo(complete, [id], through);
      }
    }
    return validateState(complete, registry);
  }
  const byId = new Map(), archiveCache = new Map();
  // The listing keeps only archive names and snapshot ids; a shard decompresses
  // just the archives holding its own states, two at a time.
  async function archive(name) {
    if (!archiveCache.has(name)) {
      const pack = await document('backups/archives', name);
      if (pack.format !== 'rs3-chunk-picker-retained-archive' || !Array.isArray(pack.snapshots)) invalid();
      if (archiveCache.size >= 2) archiveCache.delete(archiveCache.keys().next().value);
      archiveCache.set(name, pack);
    }
    return archiveCache.get(name);
  }
  async function archivedSnapshot(name, id) {
    const snapshot = (await archive(name)).snapshots.find(row => row?.id === id);
    if (!snapshot) invalid();
    return importDocument(snapshot.document);
  }
  for (const name of (await readdir(path.join(directory, 'backups', 'archives')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).sort()) {
    if (!archiveId.test(name)) continue;
    const pack = await document('backups/archives', name);
    if (pack.format !== 'rs3-chunk-picker-retained-archive' || !Array.isArray(pack.snapshots)) invalid();
    for (const snapshot of pack.snapshots) {
      if (!backupId.test(snapshot?.id)) invalid();
      const id = snapshot.id;
      byId.set(id, { id, revision: Number(backupId.exec(id)[1]), at: snapshot.at, load: () => archivedSnapshot(name, id) });
    }
  }
  for (const name of (await readdir(path.join(directory, 'backups'))).sort()) {
    const match = backupId.exec(name);
    if (!match) continue;
    const info = await stat(await safeFile('backups', name));
    byId.set(name, { id: name, revision: Number(match[1]), at: info.mtime.toISOString(), load: async () => importDocument(await document('backups', name)) });
  }
  for (const entry of byId.values()) backups.push(entry);
  backups.sort((a,b) => b.revision - a.revision || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  // Hash source bytes once, without normalizing every historical snapshot.
  async function inventory(base) {
    const rows = [];
    // Storage creates static/ and history/ only when a save needs them.
    const entries = await readdir(path.join(directory, base), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      const relative = path.join(base, entry.name);
      if (entry.isDirectory()) rows.push(...await inventory(relative));
      else if (entry.isFile()) rows.push([relative.split(path.sep).join('/'), hash(await readFile(path.join(directory, relative)))]);
      else invalid();
    }
    return rows;
  }
  const files = [['state.json', hash(await readFile(path.join(directory, 'state.json')))]];
  for (const name of ['static','history','backups']) files.push(...await inventory(name));
  const identity = hash(JSON.stringify(files));
  return { identity, listBackups: async () => backups, async readBackup(entry) {
    const owned = byId.get(entry?.id);
    if (!owned) invalid();
    const state = await owned.load();
    if (state.revision !== owned.revision) invalid();
    return state;
  } };
}
