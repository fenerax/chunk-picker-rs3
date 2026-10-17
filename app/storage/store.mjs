import { link, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { createServer as createNetServer } from 'node:net';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import { gzip, gunzip, constants } from 'node:zlib';
import { promisify, isDeepStrictEqual } from 'node:util';
import { applyValidatedCommand, BACKUP_FORMAT, SCHEMA_VERSION, createGroupState, importBackup, validateState, validateOwnedState, validateHistoryActor, getUndoEligibility, hasRetainedSparseUndo, cancelTaskClaimUndo } from '../core/state.mjs';
import { resolveSavedTaskId } from '../tasks/migration.mjs';
import { evaluateRollPool, partnerConnections } from '../core/rules.mjs';
import { captureProgressSnapshot, buildProgressModel } from '../core/progress-timeline.mjs';
import { createGameplayFingerprint } from './gameplay-fingerprint.mjs';
import { createTaskReuseFingerprint } from '../tasks/unlock-reuse.mjs';
import { projectPlayState, PLAY_VIEW } from '../play-view.mjs';
import { readHistoryEvents } from './history-reader.mjs';
import { computeRollStats, selectRollStatsEvent } from '../core/roll-stats.mjs';
import { describeHistoryEvent, historyChangeType, historyChangeTypes } from '../web/history-text.mjs';
import { loadGameDefaults } from '../game-defaults.mjs';

const gzipAsync = promisify(gzip), gunzipAsync = promisify(gunzip);

// Unlike public importBackup(), this input comes only from our private file.
// JSON.parse already gives storage ownership; retain every envelope/schema
// check without serializing and copying the complete state a second time.
function importSavedState(bytes, registry) {
  let backup;
  try { backup = typeof bytes === 'string' || Buffer.isBuffer(bytes) ? JSON.parse(bytes) : bytes; } catch { throw new TypeError('Backup is not valid JSON'); }
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new TypeError('backup must be an object');
  if (backup.format !== BACKUP_FORMAT) throw new TypeError('Unsupported backup format');
  if (backup.schemaVersion !== SCHEMA_VERSION) throw new TypeError(`Unsupported backup schema version: ${backup.schemaVersion}`);
  return validateOwnedState(backup.state, registry);
}
const BACKUP_ID = /^(\d{16})-[a-f0-9]{16}\.json(?:\.gz)?$/;
const HISTORY_ID = /^history-\d{16}-\d{16}-[a-f0-9]{16}\.json\.gz$/;
const ARCHIVE_ID = /^archive-[a-f0-9]{16}\.json\.gz$/;
const STATIC_ID = /^static-([a-f0-9]{64})\.json\.gz$/;
const STATIC_THRESHOLD = 256 * 1024;
export const DEFAULT_RETENTION = Object.freeze({ backupDays: 90, historyEntries: 1000 });
const host = hostname();
const execFileAsync = promisify(execFile);
let ownStart;
let ownStartVerified;
let ownIdentityPending;

export class RevisionConflict extends Error {
  constructor(state) {
    super(`Revision conflict: the current revision is ${state.revision}. Refresh before saving.`);
    this.code = 'REVISION_CONFLICT';
    this.state = state;
  }
}

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

async function processStartedAt(pid) {
  if (pid === process.pid && ownStart) return ownStartVerified ? ownStart : undefined;
  try {
    const result = process.platform === 'win32'
      ? await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { timeout: 3000, windowsHide: true })
      : await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 3000 });
    const time = Date.parse(result.stdout.trim());
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
  } catch { return undefined; }
}

/** Resolve this process's lock identity while other startup work is pending. */
export function prepareStoreProcessIdentity() {
  return ownIdentityPending ??= (async () => {
    ownStart = await processStartedAt(process.pid);
    ownStartVerified = ownStart !== undefined;
    ownStart ??= new Date(Date.now() - process.uptime() * 1000).toISOString();
  })();
}

async function ownerIsStale(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) return false;
  // A copied directory from another host is not evidence that its owner died.
  if (owner.host !== undefined && owner.host !== host) return false;
  if (!isAlive(owner.pid)) return true;
  if (owner.startVerified === false || typeof owner.startedAt !== 'string' || !Number.isFinite(Date.parse(owner.startedAt))) return false;
  const actual = await processStartedAt(owner.pid);
  return actual !== undefined && Date.parse(actual) !== Date.parse(owner.startedAt);
}

async function removeUnchanged(file, contents) {
  try {
    if (await readFile(file, 'utf8') !== contents) return false;
    await unlink(file);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Publish the complete synchronized owner record in one exclusive operation;
// interruption cannot leave an empty newly created lock/recovery marker.
async function createOwnerFile(file, contents) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await atomicWrite(temporary, contents);
    await link(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function acquireProcessGuard(directory) {
  const canonical = await realpath(directory);
  const digest = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const listener = createNetServer(socket => socket.destroy());
  // The kernel releases named-pipe/abstract-socket ownership after interruption.
  // A full-lifetime mutex serializes stale-file inspection and unlink, which
  // cannot be made safe with a read-then-unlink comparison alone.
  const address = process.platform === 'win32' ? { path: `\\\\.\\pipe\\rs3-picker-store-${digest}`, exclusive: true }
    : process.platform === 'linux' ? { path: `\0rs3-picker-store-${digest}`, exclusive: true }
      : { host: '127.0.0.1', port: 30_000 + parseInt(digest.slice(0, 8), 16) % 20_000, exclusive: true };
  try {
    await new Promise((resolve, reject) => {
      const failure = error => { listener.removeListener('listening', ready); reject(error); };
      const ready = () => { listener.removeListener('error', failure); resolve(); };
      listener.once('error', failure);
      listener.once('listening', ready);
      listener.listen(address);
    });
  } catch (error) {
    if (['EADDRINUSE', 'EACCES'].includes(error.code)) throw new Error('Another server already holds or is recovering this data-directory lock.', { cause: error });
    throw error;
  }
  listener.on('error', () => {});
  return () => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
}

async function acquireLock(directory, beforeLockRecovery) {
  const file = path.join(directory, 'store.lock');
  await prepareStoreProcessIdentity();
  const contents = JSON.stringify({ pid: process.pid, startedAt: ownStart, startVerified: ownStartVerified, host, nonce: randomBytes(16).toString('hex'), createdAt: new Date().toISOString() });
  const recoveryFile = `${file}.recovery`;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      // Recovery ownership also matters when a crash already removed store.lock.
      const marker = await readFile(recoveryFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (marker !== undefined) {
        let owner;
        try { owner = JSON.parse(marker); } catch { /* Legacy empty marker: require a dead lock owner and an age grace period. */ }
        let stale = owner && await ownerIsStale(owner);
        if (!owner) {
          let locked;
          try { locked = JSON.parse(await readFile(file, 'utf8')); } catch { /* Uncertain ownership requires manual recovery. */ }
          stale = locked && await ownerIsStale(locked) && Date.now() - (await stat(recoveryFile)).mtimeMs > 30_000;
        }
        if (!stale) throw new Error('Another server is recovering the data-directory lock, or its recovery owner cannot be verified. Inspect store.lock.recovery.');
        await removeUnchanged(recoveryFile, marker);
        continue;
      }
      await createOwnerFile(file, contents);
      return () => removeUnchanged(file, contents);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize stale-lock recovery too: a second process must not unlink the
      // fresh lock obtained by the first recovery contender.
      try { await createOwnerFile(recoveryFile, contents); } catch (recoveryError) {
        if (recoveryError.code === 'EEXIST') continue;
        throw recoveryError;
      }
      try {
        let previous;
        try { previous = await readFile(file, 'utf8'); } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
        let parsed;
        try { parsed = JSON.parse(previous); } catch { throw new Error('The store has an unreadable lock; inspect store.lock before restarting.'); }
        if (!await ownerIsStale(parsed)) throw new Error('Another server already holds this data-directory lock, or its owner cannot be verified.');
        if (beforeLockRecovery) await beforeLockRecovery({ lockFile: file, recoveryFile });
        await removeUnchanged(file, previous);
      } finally { await removeUnchanged(recoveryFile, contents); }
    }
  }
  throw new Error('Could not acquire the data-directory lock.');
}

async function atomicWrite(file, contents, beforeRename) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (beforeRename) await beforeRename();
    // Windows scanners can briefly hold the destination without delete-sharing.
    // Retry the same synchronized replacement; never remove the old state.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await delay(20 * 2 ** attempt);
      }
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** One durable, exclusively locked store. All writes share one revision queue. */
export async function openStore({ dataDir, world, registry, initialState, migrateState, prepareState, beforeCommit, beforeLockRecovery, now, random, taskCatalogue, retention, progressQuestPoints, membersStartBanks, xpChoiceCatalogue } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required.');
  const policy = retention === false ? false : { ...DEFAULT_RETENTION, ...retention };
  if (policy) {
    if (!Number.isSafeInteger(policy.backupDays) || policy.backupDays < 1) throw new TypeError('retention.backupDays must be a positive safe integer.');
    if (!Number.isSafeInteger(policy.historyEntries) || policy.historyEntries < 1) throw new TypeError('retention.historyEntries must be a positive safe integer.');
    if (Object.keys(policy).some(key => !['backupDays', 'historyEntries'].includes(key))) throw new TypeError('Unknown retention policy setting.');
  }
  const directory = path.resolve(dataDir);
  await mkdir(directory, { recursive: true });
  const releaseGuard = await acquireProcessGuard(directory);
  let releaseFileLock;
  try { releaseFileLock = await acquireLock(directory, beforeLockRecovery); }
  catch (error) { await releaseGuard(); throw error; }
  const releaseLock = async () => { try { await releaseFileLock(); } finally { await releaseGuard(); } };
  const stateFile = path.join(directory, 'state.json');
  const backupsDir = path.join(directory, 'backups');
  const historyDir = path.join(directory, 'history');
  const archivesDir = path.join(backupsDir, 'archives');
  const staticDir = path.join(directory, 'static');
  let current;
  let currentDiskSerialized;
  let token;
  let closing = false;
  let closePromise;
  let queue = Promise.resolve();
  let maintenanceQueue = Promise.resolve();
  let maintenanceWrites = 0;
  let retentionFailure;
  let archiveIndex;
  const listeners = new Set();
  const envelope = state => ({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, state });
  const envelopePrefix = `${JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION }).slice(0, -1)},"state":`;
  let serializedFields = new WeakMap();
  const staticReferences = new WeakMap();
  // Private commit metadata does not enter gameplay snapshots or portable
  // backups. Full backup/Undo hydration projects these cancelled claim leaves.
  const coordination = new WeakMap();
  const coordinationOf = state => coordination.get(state) ?? { schemaVersion: 1, lastNonClaimRevision: state.revision, invalidatedUndo: {} };
  function validateCoordination(value, revision) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
      || Object.keys(value).some(key => !['schemaVersion', 'lastNonClaimRevision', 'invalidatedUndo'].includes(key))
      || !Number.isSafeInteger(value.lastNonClaimRevision) || value.lastNonClaimRevision < 0 || value.lastNonClaimRevision > revision
      || !value.invalidatedUndo || typeof value.invalidatedUndo !== 'object' || Array.isArray(value.invalidatedUndo)) throw new TypeError('Invalid claim coordination metadata.');
    for (const [id, through] of Object.entries(value.invalidatedUndo)) {
      if (!id || ['__proto__', 'prototype', 'constructor'].includes(id) || !Number.isSafeInteger(through) || through < 0 || through > revision) throw new TypeError('Invalid claim Undo cancellation.');
    }
    return value;
  }
  const reusableFields = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
  const fingerprint = createGameplayFingerprint();
  function fieldJSON(key, value) {
    if (!reusableFields.has(key) || value === null || typeof value !== 'object') return JSON.stringify(value);
    // Private state commands share these trees without mutating them. Hook
    // outputs cross validation into newly owned trees before reaching here.
    if (!serializedFields.has(value)) serializedFields.set(value, JSON.stringify(value));
    return serializedFields.get(value);
  }
  function* stateFields(state) {
    let first = true;
    for (const [key, value] of Object.entries(state)) {
      const bytes = fieldJSON(key, value);
      if (bytes === undefined) continue;
      if (!first) yield ',';
      first = false;
      yield JSON.stringify(key); yield ':'; yield bytes;
    }
  }
  // Registries and exact migration archives can dwarf gameplay. Compact JSON
  // keeps durable writes bounded without changing portable backup semantics.
  const serialized = state => `${envelopePrefix}{${[...stateFields(state)].join('')}}${coordination.has(state) ? `,"coordination":${JSON.stringify(coordinationOf(state))}` : ''}}\n`;
  async function readStaticField(key, reference) {
    const match = STATIC_ID.exec(reference?.id ?? '');
    if (!match || reference?.sha256 !== match[1] || Object.keys(reference).some(name => !['id', 'sha256'].includes(name))) {
      throw new TypeError(`Invalid static field reference: ${key}`);
    }
    let compressed;
    try {
      const base = await realpath(staticDir);
      const file = await realpath(path.join(staticDir, reference.id));
      if (path.dirname(file) !== base) throw new TypeError(`Invalid static field location: ${key}`);
      compressed = await readFile(file);
    }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Missing static field dependency: ${reference.id}`, { cause: error });
      throw error;
    }
    const bytes = await gunzipAsync(compressed);
    if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new TypeError(`Static field checksum mismatch: ${key}`);
    return { value: JSON.parse(bytes.toString('utf8')), bytes: bytes.toString('utf8') };
  }
  async function hydrateStaticDocument(document, ownsDocument) {
    if (document?.storage === undefined) return ownsDocument ? document : { ...document, state: structuredClone(document?.state) };
    const metadata = document.storage;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.schemaVersion !== 1
      || Object.keys(metadata).some(key => !['schemaVersion', 'fields'].includes(key))
      || !metadata.fields || typeof metadata.fields !== 'object' || Array.isArray(metadata.fields)
      || !document.state || typeof document.state !== 'object' || Array.isArray(document.state)) throw new TypeError('Invalid static storage metadata.');
    const state = ownsDocument ? { ...document.state } : structuredClone(document.state);
    for (const [key, reference] of Object.entries(metadata.fields)) {
      if (!reusableFields.has(key) || Object.hasOwn(state, key)) throw new TypeError(`Invalid stored static field: ${key}`);
      const loaded = await readStaticField(key, reference);
      state[key] = loaded.value;
    }
    return { ...document, state };
  }
  async function importStoredBackup(document, ownsDocument = false) {
    if (typeof document === 'string') {
      try { document = JSON.parse(document); } catch { throw new TypeError('Backup is not valid JSON'); }
    }
    const state = importSavedState(await hydrateStaticDocument(document, ownsDocument), registry);
    if (document.coordination !== undefined) coordination.set(state, validateCoordination(document.coordination, state.revision));
    for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
      const value = state[key];
      if (value === null || typeof value !== 'object') continue;
      const bytes = JSON.stringify(value);
      // Validation can normalize diagnostics. Reuse a loaded sidecar only when
      // its complete normalized field still has exactly the verified content.
      if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) continue;
      serializedFields.set(value, bytes);
      staticReferences.set(value, reference);
    }
    return state;
  }
  async function staticReference(key, value, bytes) {
    if (staticReferences.has(value)) return staticReferences.get(value);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const reference = { id: `static-${sha256}.json.gz`, sha256 };
    await mkdir(staticDir, { recursive: true });
    try { await readStaticField(key, reference); }
    catch (error) {
      if (error.cause?.code !== 'ENOENT') throw error;
      await atomicWrite(path.join(staticDir, reference.id), await gzipAsync(bytes, { level: constants.Z_BEST_SPEED }));
    }
    staticReferences.set(value, reference);
    return reference;
  }
  async function serializedDiskState(state) {
    const compact = { ...state }, fields = {};
    for (const key of reusableFields) {
      const value = state[key];
      if (value === null || typeof value !== 'object') continue;
      if (staticReferences.has(value)) {
        fields[key] = staticReferences.get(value);
        delete compact[key];
        continue;
      }
      const bytes = fieldJSON(key, value);
      if (Buffer.byteLength(bytes) < STATIC_THRESHOLD) continue;
      fields[key] = await staticReference(key, value, bytes);
      delete compact[key];
    }
    if (!Object.keys(fields).length) return serialized(state);
    return `${JSON.stringify({ ...envelope(compact), ...(coordination.has(state) ? { coordination: coordinationOf(state) } : {}),
      ...(Object.keys(fields).length ? { storage: { schemaVersion: 1, fields } } : {}) })}\n`;
  }
  function gameplayFingerprint() {
    return fingerprint(current);
  }
  let poolState, fullPools, playPools, calculationSnapshot;
  const taskReuseFingerprint = createTaskReuseFingerprint();
  const playProjections = new WeakMap();
  function playProjection(state) {
    let projection = playProjections.get(state);
    if (!projection) {
      const display = projectPlayState(state);
      projection = { state: display, tasksJSON: JSON.stringify(display.tasks), identityJSON: JSON.stringify(display.identityRegistry) };
      playProjections.set(state, projection);
    }
    return projection;
  }
  function refreshSnapshots() {
    if (poolState !== current) { poolState = current; fullPools = undefined; playPools = undefined; calculationSnapshot = undefined; }
  }
  function capturedCalculation() {
    refreshSnapshots();
    if (!calculationSnapshot) {
      const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...input } = current;
      input.history = [];
      let state, stateJSON, taskInputKey;
      const revision = current.revision, members = Object.freeze(current.members.map(member => Object.freeze({ id: member.id })));
      const inputKey = gameplayFingerprint();
      calculationSnapshot = { revision, members, inputKey,
        get taskInputKey() { return taskInputKey ??= taskReuseFingerprint(input); },
        get state() { return state ??= structuredClone(input); },
        get stateJSON() {
          if (!stateJSON) {
            // Reuse the verified static-field strings rather than cloning the
            // registry/catalogue, joining a large string, then cloning again
            // at the native worker boundary. This captured revision owns all
            // references even if a later command changes the current state.
            const parts = ['{', ...stateFields(input), '}'];
            stateJSON = new SharedArrayBuffer(parts.reduce((size, part) => size + Buffer.byteLength(part), 0));
            const bytes = Buffer.from(stateJSON); let offset = 0;
            for (const part of parts) offset += bytes.write(part, offset);
          }
          return stateJSON;
        } };
    }
    return calculationSnapshot;
  }
  function rollPools(view) {
    refreshSnapshots();
    fullPools ??= Object.fromEntries(current.members.map(member => [member.id, evaluateRollPool(world, current, member.id, registry)]));
    if (view !== PLAY_VIEW) return fullPools;
    playPools ??= Object.fromEntries(current.members.map(member => [member.id, { ...fullPools[member.id],
      partnerConnections: partnerConnections(world, current, member.id, registry) }]));
    return playPools;
  }
  function commandSnapshot(baseline, omitUnchanged = false, view) {
    const pools = rollPools(view);
    // Deleting omitted fields must never mutate the memoized full display view.
    const projection = view === PLAY_VIEW ? { ...playProjection(current).state } : { ...current }, unchangedFields = [];
    if (omitUnchanged && view === PLAY_VIEW && baseline) {
      if (Object.hasOwn(current, 'legacy') && current.legacy === baseline.legacy) { unchangedFields.push('legacy'); delete projection.legacy; }
      if (playProjection(current).tasksJSON === playProjection(baseline).tasksJSON) { unchangedFields.push('tasks'); delete projection.tasks; }
      if (playProjection(current).identityJSON === playProjection(baseline).identityJSON) {
        unchangedFields.push('identityRegistry'); delete projection.identityRegistry;
      }
    }
    if (omitUnchanged && view !== PLAY_VIEW) for (const key of reusableFields) {
      const value = current[key];
      if (value === null || typeof value !== 'object' || !staticReferences.has(value) || baseline?.[key] !== value) continue;
      unchangedFields.push(key);
      delete projection[key];
    }
    const parts = ['{', ...stateFields(projection), '}'];
    let stateJSON;
    return { get stateJSON() { return stateJSON ??= parts.join(''); }, stateJSONParts: [...parts], revision: current.revision,
      ...(unchangedFields.length ? { baseRevision: baseline.revision, unchangedFields } : {}),
      pools, ...(view === PLAY_VIEW ? { format: PLAY_VIEW, schemaVersion: 1 } : {}) };
  }
  async function retainBackup(state, operation, label) {
    const name = `${String(state.revision).padStart(16, '0')}-${randomBytes(8).toString('hex')}.json.gz`;
    // A members transition gets a portable, pinned full backup, including
    // archived History and fields normally stored in compact sidecars.
    const document = label ? JSON.stringify({ ...envelope((await hydrateHistory(state)).state), retentionPinned: true, retentionLabel: label })
      : ['replace', 'catalogue-refresh'].includes(operation)
      ? `${currentDiskSerialized.trimEnd().slice(0, -1)},"retentionPinned":true}` : currentDiskSerialized;
    const bytes = await gzipAsync(document, { level: constants.Z_BEST_SPEED });
    const file = path.join(backupsDir, name);
    await atomicWrite(file, bytes);
    if (label) await atomicWrite(`${file}.meta.json`, JSON.stringify({ label }));
    const at = new Date(timestamp());
    await utimes(file, at, at);
  }
  const timestamp = () => {
    const value = typeof now === 'function' ? now() : now ?? new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid store timestamp.');
    return date.toISOString();
  };
  async function prepared(state, operation) {
    // Gameplay commands start from an already migrated private state. Caller
    // preparation hooks still receive migration context and may require repair
    // of catalogue changes made by an earlier hook.
    if (!prepareState && (!migrateState || operation === 'command' || migrateState.isCurrent?.(state))) return state;
    // All callers pass a previously validated private state. Hooks receive a
    // separate clone and their output crosses the validation boundary once.
    const context = { operation, world, registry };
    let input = structuredClone(state);
    // Only the explicit first-party migration stage may project saved history
    // onto new identities or establish an archived undo boundary. Caller hooks
    // receive that authoritative baseline, rather than permission to erase it.
    if (migrateState) {
      input = validateOwnedState(await migrateState(input, context) ?? input, registry);
      if (input.revision !== state.revision) throw new TypeError('Migration must preserve the authoritative revision.');
    }
    if (!prepareState) return input;
    const history = operation === 'load' ? JSON.stringify(input.history) : undefined;
    const output = await prepareState(input, context);
    const ready = validateState(output ?? input, registry);
    if (operation === 'load' && (ready.revision !== state.revision || JSON.stringify(ready.history) !== history)) {
      throw new TypeError('Load preparation must preserve the authoritative revision and history.');
    }
    return ready;
  }
  async function hydrateHistory(state, cache) {
    const archived = new Map();
    const references = state.provenance?.historyArchive ?? [];
    if (!Array.isArray(references)) throw new TypeError('Invalid history archive references.');
    for (const reference of references) {
      if (!HISTORY_ID.test(reference?.id)) throw new TypeError('Invalid history archive ID.');
      let document = cache?.documents.get(reference.id)?.document;
      if (!document) {
        const bytes = await gunzipAsync(await readFile(path.join(historyDir, reference.id)));
        document = JSON.parse(bytes.toString('utf8'));
        if (cache && bytes.length <= 8 * 1024 * 1024) {
          while (cache.bytes + bytes.length > 8 * 1024 * 1024 && cache.documents.size) {
            const oldest = cache.documents.keys().next().value;
            cache.bytes -= cache.documents.get(oldest).bytes;
            cache.documents.delete(oldest);
          }
          cache.documents.set(reference.id, { document, bytes: bytes.length });
          cache.bytes += bytes.length;
        }
      }
      if (document.format !== 'rs3-chunk-picker-history' || !Array.isArray(document.events)) throw new TypeError('Invalid history archive.');
      // Later committed segments contain overrides, including an old undo
      // target's undoneRevision. Unreferenced interrupted writes are ignored.
      for (const event of document.events) archived.set(event.revision, event);
    }
    const events = new Map(archived);
    for (const event of state.history) events.set(event.revision, event);
    const complete = structuredClone(state);
    complete.history = [...events.values()].sort((a, b) => a.revision - b.revision);
    if (complete.provenance?.historyArchive !== undefined) delete complete.provenance.historyArchive;
    for (const [id, through] of Object.entries(coordinationOf(state).invalidatedUndo)) cancelTaskClaimUndo(complete, [id], through);
    const validated = validateState(complete, registry);
    coordination.set(validated, coordinationOf(state));
    return { state: validated, archived };
  }
  async function compactHistory(state, archived) {
    if (!policy || state.history.length <= policy.historyEntries * 2) return state;
    let cutoff = state.history.length - policy.historyEntries;
    const indices = new Map(state.history.map((event, index) => [event.revision, index]));
    for (const member of state.members) {
      if (!member.pendingRoll.length) continue;
      for (let index = state.history.length - 1; index >= 0; index--) {
        const event = state.history[index];
        if (event.undoneRevision === undefined && event.command?.memberId === member.id && ['roll', 'random-start'].includes(event.type)) {
          cutoff = Math.min(cutoff, index);
          break;
        }
      }
    }
    const latestUndoable = state.history.findLastIndex(event => event.undo && event.undoneRevision === undefined && event.type !== 'undo');
    if (latestUndoable >= 0) cutoff = Math.min(cutoff, latestUndoable);
    // Retained undo markers and their targets form one validated suffix.
    for (let index = state.history.length - 1; index >= cutoff; index--) {
      const event = state.history[index];
      if (event.type === 'undo') cutoff = Math.min(cutoff, indices.get(event.command.undoRevision) ?? cutoff);
    }
    if (!cutoff) return state;
    const removed = state.history.slice(0, cutoff);
    const updates = removed.filter(event => !archived || JSON.stringify(archived.get(event.revision)) !== JSON.stringify(event));
    const references = [...(state.provenance?.historyArchive ?? current?.provenance?.historyArchive ?? [])];
    if (updates.length) {
      const id = `history-${String(updates[0].revision).padStart(16, '0')}-${String(updates.at(-1).revision).padStart(16, '0')}-${randomBytes(8).toString('hex')}.json.gz`;
      const bytes = await gzipAsync(JSON.stringify({ format: 'rs3-chunk-picker-history', events: updates }), { level: constants.Z_BEST_COMPRESSION });
      await atomicWrite(path.join(historyDir, id), bytes);
      references.push({ id });
    }
    const trimmed = { ...state, history: state.history.slice(cutoff), provenance: { ...state.provenance, historyArchive: references } };
    // The private input is already validated. The cutoff preserves pending-roll
    // and undo-marker dependencies; the only other change is authored durable
    // archive references. Keep untouched trees shared instead of cloning and
    // revalidating the complete catalogue/evidence at this retention boundary.
    return trimmed;
  }
  async function standaloneBackups() {
    const entries = await readdir(backupsDir, { withFileTypes: true });
    const metadata = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
    return Promise.all(entries.filter(entry => entry.isFile() && BACKUP_ID.test(entry.name)).map(async entry => {
      const info = await stat(path.join(backupsDir, entry.name));
      const label = metadata.has(`${entry.name}.meta.json`) ? (await readDocument(path.join(backupsDir, `${entry.name}.meta.json`), false)).label : undefined;
      return { id: entry.name, revision: Number(BACKUP_ID.exec(entry.name)[1]), bytes: info.size, at: info.mtime.toISOString(), ...(label ? { label } : {}) };
    }));
  }
  async function readDocument(file, compressed = true) {
    const bytes = await readFile(file);
    return JSON.parse((compressed ? await gunzipAsync(bytes) : bytes).toString('utf8'));
  }
  async function retainedArchiveIndex() {
    if (archiveIndex) return archiveIndex;
    const entries = await readdir(archivesDir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const index = new Map();
    for (const entry of entries) {
      if (!entry.isFile() || !ARCHIVE_ID.test(entry.name)) continue;
      const pack = await readDocument(path.join(archivesDir, entry.name));
      if (pack.format !== 'rs3-chunk-picker-retained-archive' || !Array.isArray(pack.snapshots)) throw new TypeError('Invalid retained backup archive.');
      for (const snapshot of pack.snapshots) {
        if (!BACKUP_ID.test(snapshot?.id)) throw new TypeError('Invalid archived backup ID.');
        const state = await importStoredBackup(snapshot.document);
        if (state.revision !== Number(BACKUP_ID.exec(snapshot.id)[1])) throw new TypeError('Archived backup revision does not match its ID.');
        index.set(snapshot.id, { packId: entry.name, metadata: { id: snapshot.id, revision: Number(BACKUP_ID.exec(snapshot.id)[1]), bytes: snapshot.bytes, at: snapshot.at } });
      }
    }
    archiveIndex = index;
    return index;
  }
  async function pruneBackups() {
    if (!policy) return;
    const backups = (await standaloneBackups()).sort((a, b) => b.revision - a.revision || b.at.localeCompare(a.at));
    if (backups.length < 2) return;
    const archived = await retainedArchiveIndex();
    const keep = new Set([backups[0].id, backups.at(-1).id]);
    const days = new Set();
    const cutoff = Date.parse(timestamp()) - policy.backupDays * 86_400_000;
    const candidates = [];
    const historyCache = { documents: new Map(), bytes: 0 };
    for (const backup of backups) {
      const day = backup.at.slice(0, 10);
      const checkpoint = !days.has(day);
      days.add(day);
      if (Date.parse(backup.at) >= cutoff || checkpoint || keep.has(backup.id)) continue;
      candidates.push(backup);
    }
    async function archiveSnapshots(removable) {
      if (!removable.length) return;
      const snapshots = removable.filter(snapshot => !archived.has(snapshot.id));
      if (snapshots.length) {
        const packId = `archive-${randomBytes(8).toString('hex')}.json.gz`;
        const pack = { format: 'rs3-chunk-picker-retained-archive', snapshots };
        const bytes = await gzipAsync(JSON.stringify(pack), { level: constants.Z_BEST_COMPRESSION });
        await mkdir(archivesDir, { recursive: true });
        await atomicWrite(path.join(archivesDir, packId), bytes);
        const verified = await readDocument(path.join(archivesDir, packId));
        for (const snapshot of verified.snapshots) {
          await importStoredBackup(snapshot.document);
          archived.set(snapshot.id, { packId, metadata: { id: snapshot.id, revision: snapshot.revision, bytes: snapshot.bytes, at: snapshot.at } });
        }
      }
      // The synchronized and re-read archive is a second durable copy first.
      // Crashing midway leaves harmless duplicates; no sole snapshot is deleted.
      let verifiedPackId;
      let verifiedPack;
      for (const snapshot of removable) {
        const archivedSnapshot = archived.get(snapshot.id);
        if (verifiedPackId !== archivedSnapshot.packId) {
          const pack = await readDocument(path.join(archivesDir, archivedSnapshot.packId));
          if (pack.format !== 'rs3-chunk-picker-retained-archive' || !Array.isArray(pack.snapshots)) throw new TypeError('Invalid retained backup archive.');
          verifiedPackId = archivedSnapshot.packId;
          verifiedPack = pack;
        }
        const copy = verifiedPack.snapshots.find(item => item.id === snapshot.id);
        if (!copy) throw new TypeError('Retained archive is missing its preserved snapshot.');
        const state = await importStoredBackup(copy.document);
        if (state.revision !== snapshot.revision) throw new TypeError('Archived backup revision does not match its ID.');
        if (JSON.stringify(copy.document) !== JSON.stringify(snapshot.document)) throw new TypeError('Archived backup differs from its preserved standalone snapshot.');
        await hydrateHistory(state, historyCache);
      }
      for (const snapshot of removable) await unlink(path.join(backupsDir, snapshot.id));
    }
    let batch = [];
    let batchBytes = 0;
    for (const backup of candidates) {
      const document = await readDocument(path.join(backupsDir, backup.id), backup.id.endsWith('.gz'));
      if (document.retentionPinned) continue;
      await importStoredBackup(document);
      const bytes = Buffer.byteLength(JSON.stringify(document));
      if (batch.length && (batch.length >= 32 || batchBytes + bytes > 8 * 1024 * 1024)) {
        await archiveSnapshots(batch);
        batch = [];
        batchBytes = 0;
      }
      batch.push({ ...backup, document });
      batchBytes += bytes;
    }
    await archiveSnapshots(batch);
  }
  async function maintainRetention() {
    try { await pruneBackups(); retentionFailure = undefined; }
    catch (error) { retentionFailure = error.message; }
  }
  // Backup readers share maintenance ownership so pruning cannot remove a
  // standalone file midway through a read or race archive-index initialization.
  // This queue is separate from gameplay: commits do not await packing.
  function enqueueMaintenance(work) {
    const result = maintenanceQueue.then(work);
    maintenanceQueue = result.catch(() => {});
    return result;
  }
  try {
    await mkdir(backupsDir, { recursive: true });
    await mkdir(historyDir, { recursive: true });
    const tokenFile = path.join(directory, 'access-token');
    try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      token = randomBytes(32).toString('base64url');
      await atomicWrite(tokenFile, `${token}\n`);
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('The persisted access token is malformed; inspect the private data directory.');
    let existing = false;
    try { current = await importStoredBackup(await readFile(stateFile, 'utf8'), true); existing = true; } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load the saved state: ${error.message}`, { cause: error });
      const seed = initialState === undefined
        ? createGroupState((await loadGameDefaults()).members.map(({ id, name }) => ({ id, name })), registry)
        : validateState(initialState, registry);
      current = await prepared(seed, 'initialize');
      currentDiskSerialized = await serializedDiskState(current);
      await atomicWrite(stateFile, currentDiskSerialized);
    }
    currentDiskSerialized ??= await serializedDiskState(current);
    if (existing && (prepareState || migrateState)) {
      // Project retained events together with active events. Leaving the old
      // segment references attached could revive pre-boundary undo on export.
      const baseline = migrateState && current.provenance?.historyArchive?.length ? (await hydrateHistory(current)).state : current;
      const ready = await prepared(baseline, 'load');
      if (baseline !== current && JSON.stringify(ready.history) === JSON.stringify(baseline.history)) {
        // Unchanged events can keep their existing retention segments. A
        // reusable migration must not turn mere hydration into a refresh.
        ready.history = structuredClone(current.history);
        ready.provenance = { ...ready.provenance, historyArchive: structuredClone(current.provenance.historyArchive) };
      }
      // Compare validated data directly: key ordering has no gameplay meaning,
      // and a changed projection should not stringify its large archive twice.
      // Exceptional numeric distinctions such as -0 conservatively refresh.
      if (!isDeepStrictEqual(ready, current)) {
        if (current.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('State revision limit reached.');
        ready.revision = current.revision + 1;
        ready.history.push({ id: `revision-${ready.revision}`, revision: ready.revision, type: 'catalogue-refresh', at: timestamp() });
        // prepared() validated the complete private state. The only changes
        // here are a checked revision increment and this authored history event.
        await retainBackup(current, 'catalogue-refresh');
        if (coordination.has(current)) coordination.set(ready, { ...coordinationOf(current), lastNonClaimRevision: ready.revision });
        const diskDocument = await serializedDiskState(ready);
        await atomicWrite(stateFile, diskDocument,
          beforeCommit ? () => beforeCommit({ operation: 'catalogue-refresh', state: structuredClone(ready) }) : undefined);
        current = ready;
        currentDiskSerialized = diskDocument;
      }
    }
    // Confirm committed dependencies before recording startup observations.
    if (current.provenance?.historyArchive?.length) await hydrateHistory(current);
    // Daily observation metadata is independent of commands/catalogue changes.
    // Startup records today's counts without incrementing revision or History.
    if (progressQuestPoints !== undefined) {
      const observed = captureProgressSnapshot(current, { questPoints: progressQuestPoints, at: timestamp() });
      if (observed !== current) {
        if (coordination.has(current)) coordination.set(observed, coordinationOf(current));
        const diskDocument = await serializedDiskState(observed);
        await atomicWrite(stateFile, diskDocument);
        current = observed; currentDiskSerialized = diskDocument;
      }
    }
    await maintainRetention();
  } catch (error) { await releaseLock(); throw error; }

  const cloneCurrent = () => structuredClone(current);
  function checkRevision(expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision must be a nonnegative safe integer.');
    if (expectedRevision !== current.revision) {
      const error = new RevisionConflict(cloneCurrent());
      error.claimOnlyChanges = expectedRevision < current.revision && expectedRevision >= coordinationOf(current).lastNonClaimRevision;
      throw error;
    }
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('State revision limit reached.');
  }
  function enqueue(work) {
    if (closing) return Promise.reject(new Error('The store is closed.'));
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  async function persist(next, operation, archived, serializedResult = false, baseline, omitUnchanged = false, view, { claimOnly = false, cleanup = false, backupLabel } = {}) {
    const observed = cleanup || progressQuestPoints === undefined ? next : captureProgressSnapshot(next, { questPoints: progressQuestPoints, at: timestamp() });
    const validated = cleanup ? observed : await compactHistory(observed, archived);
    const previousCoordination = operation === 'replace' ? { schemaVersion: 1, invalidatedUndo: {} }
      : coordination.get(next) ?? coordinationOf(current);
    if (claimOnly || coordination.has(next) || coordination.has(current)) coordination.set(validated,
      { ...previousCoordination, lastNonClaimRevision: claimOnly ? previousCoordination.lastNonClaimRevision : validated.revision });
    // Preserve the old durable state before replacing its revision.
    if (!cleanup) await retainBackup(current, operation, backupLabel);
    const diskDocument = await serializedDiskState(validated);
    await atomicWrite(stateFile, diskDocument,
      beforeCommit ? () => beforeCommit({ operation, state: structuredClone(validated) }) : undefined);
    const ownershipChanged = JSON.stringify(current.members.map(member => [member.id, member.unlocked]))
      !== JSON.stringify(validated.members.map(member => [member.id, member.unlocked]));
    current = validated;
    currentDiskSerialized = diskDocument;
    if (!cleanup && ++maintenanceWrites >= 50) { maintenanceWrites = 0; void enqueueMaintenance(maintainRetention); }
    for (const listener of listeners) {
      try { listener({ revision: current.revision, ...(ownershipChanged ? { ownershipChanged: true } : {}) }); } catch { /* A subscriber cannot roll back a committed write. */ }
    }
    // Let already-requested task lanes receive the committed snapshot before
    // synchronous travel/pool rebuilding occupies the HTTP process.
    if (ownershipChanged) await new Promise(resolve => setImmediate(resolve));
    return cleanup ? structuredClone({ revision: current.revision, taskClaims: current.taskClaims, history: current.history })
      : serializedResult ? commandSnapshot(baseline, omitUnchanged, view) : cloneCurrent();
  }
  function runCommand(command, expectedRevision, serializedResult = false, omitUnchanged = false, actor, view) {
    const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
    return enqueue(async () => {
      checkRevision(expectedRevision);
      const baseline = current;
      const sparseUndo = hasRetainedSparseUndo(current, command) && !current.provenance?.historyArchive?.length;
      const input = command.type === 'undo' && !sparseUndo ? await hydrateHistory(current) : { state: current };
      const undoTarget = command.type === 'undo' ? (command.undoRevision === undefined
        ? input.state.history.findLast(event => event.undo && event.undoneRevision === undefined && event.type !== 'undo')
        : input.state.history.find(event => event.revision === command.undoRevision)) : undefined;
      let claimOnly = ['claim-task', 'clear-task-claim', 'prune-task-claims'].includes(command.type)
        || command.type === 'undo' && undoTarget?.undo && Object.keys(undoTarget.undo).every(key => key === 'taskClaimChanges');
      if (attribution?.memberId && ['claim-task', 'clear-task-claim'].includes(undoTarget?.type)
        && undoTarget.command?.memberId !== attribution.memberId) {
        throw Object.assign(new Error('You can only undo task claims made by your signed-in player.'), { status: 403 });
      }
      const next = applyValidatedCommand(input.state, command, { expectedRevision, world, registry,
        random: command.type === 'go-members' ? random ?? (() => randomBytes(6).readUIntBE(0, 6) / 2 ** 48) : random,
        now, taskCatalogue, actor: attribution, membersStartBanks, xpChoiceCatalogue });
      const ready = await prepared(next, 'command');
      if (ready.revision !== next.revision) throw new TypeError('prepareState must preserve the authoritative revision.');
      // Caller hooks can change more than the command requested. Only exact
      // authored coordination output keeps the conservative conflict proof.
      if (claimOnly && ready !== next) claimOnly = isDeepStrictEqual(ready, next);
      if (command.type === 'undo' && !['claim-task', 'clear-task-claim', 'prune-task-claims'].includes(undoTarget?.type)) {
        const removed = Object.keys(baseline.taskClaims ?? {}).filter(id => !Object.hasOwn(ready.taskClaims ?? {}, id));
        if (removed.length) {
          const previous = coordinationOf(current), invalidatedUndo = { ...previous.invalidatedUndo };
          for (const id of removed) invalidatedUndo[id] = baseline.revision;
          coordination.set(ready, { ...previous, invalidatedUndo });
        }
      }
      return persist(ready, 'command', input.archived, serializedResult, baseline, omitUnchanged, view, { claimOnly,
        ...(command.type === 'go-members' ? { backupLabel: 'Before going members' } : {}) });
    });
  }
  async function replacementState(document, base, actor) {
    const incoming = document?.format ? importBackup(document, registry) : typeof document === 'string' ? importBackup(document, registry) : validateState(document, registry);
    const ready = await prepared(incoming, 'replace');
    const revision = base.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new RangeError('State revision limit reached.');
    const previous = (await hydrateHistory(base)).state;
    const completeIncoming = (await hydrateHistory(ready)).state;
    const preceding = new Map(), precedingEvidence = [];
    for (const event of [...(previous.provenance?.restore?.previousHistory ?? []), ...previous.history]) {
      if (Number.isSafeInteger(event?.revision)) preceding.set(event.revision, event);
      else precedingEvidence.push(event);
    }
    const previousHistory = [...precedingEvidence, ...[...preceding.values()].sort((a, b) => a.revision - b.revision)];
    ready.provenance = { ...(ready.provenance?.dataset ? { dataset: ready.provenance.dataset } : {}), restore: { incomingRevision: ready.revision, incomingHistory: completeIncoming.history, previousHistory,
      ...(completeIncoming.provenance !== undefined ? { incomingProvenance: completeIncoming.provenance } : {}) } };
    ready.revision = revision;
    // A replacement establishes a new undo boundary. Earlier snapshots may
    // describe another roster and must never rewrite the restored gameplay.
    ready.history = [{ id: `revision-${revision}`, revision, type: 'restore', at: timestamp(), ...(actor ? { actor } : {}) }];
    return validateState(ready, registry);
  }
  function historyRecord(event) {
    if (!event) return undefined;
    const { revision, type, at, actor, undoneRevision } = event;
    let command;
    if (event.command) {
      // Recent activity needs command identity, not imported maps, catalogue
      // evidence or entire sync payloads. Full History keeps those unchanged.
      const { member, rules, taskRules, facts, skills, quests, task, teleport, members, ...small } = event.command;
      command = { ...small,
        ...(task ? { task: { id: task.id, label: task.label } } : {}),
        ...(teleport ? { teleport: { id: teleport.id, label: teleport.label } } : {}),
        ...(members ? { members: members.map(target => ({ memberId: target.memberId, groups: target.groups })) } : {}),
        ...(skills ? { skillCount: skills.length } : {}), ...(quests ? { questCount: quests.length } : {}) };
    }
    return structuredClone({ revision, type, at, hasUndo: Boolean(event.undo), ...(actor ? { actor } : {}), ...(command ? { command } : {}),
      ...(undoneRevision !== undefined ? { undoneRevision } : {}) });
  }
  async function visitHistory(state, visit) {
    // These events belong to the preceding live revision chain. Imported
    // history has unrelated revision numbers and remains backup provenance.
    for (const event of state.provenance?.restore?.previousHistory ?? []) {
      if (event && Number.isSafeInteger(event.revision) && typeof event.type === 'string') visit(event);
    }
    for (const reference of state.provenance?.historyArchive ?? []) {
      if (!HISTORY_ID.test(reference?.id)) throw new TypeError('Invalid history archive ID.');
      for await (const event of readHistoryEvents(path.join(historyDir, reference.id))) visit(event);
    }
    // Later segments and the live suffix replace earlier copies. Undo usually
    // changes only undoneRevision; an identity migration can also project IDs.
    for (const event of state.history) visit(event);
  }
  async function getRollStats({ stateRevision } = {}) {
    if (stateRevision !== undefined && (!Number.isSafeInteger(stateRevision) || stateRevision < 0)) throw new TypeError('Roll stats stateRevision must be a nonnegative safe integer.');
    const captured = current;
    if (stateRevision !== undefined && stateRevision !== captured.revision) throw new RevisionConflict(captured);
    const events = new Map();
    await visitHistory(captured, event => {
      const selected = selectRollStatsEvent(event);
      if (selected) events.set(event.revision, selected);
      else events.delete(event.revision);
    });
    return { stateRevision: captured.revision, ...computeRollStats(captured, { history: [...events.values()], now: timestamp() }) };
  }
  async function queryHistory({ limit = 150, before, player, type, q = '', stateRevision, labels = {} } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError('History limit must be between 1 and 500.');
    for (const [name, value] of [['before', before], ['stateRevision', stateRevision]]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`History ${name} must be a nonnegative safe integer.`);
    }
    if (player !== undefined && (typeof player !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(player))) throw new TypeError('History player must be a player ID.');
    if (type !== undefined && !historyChangeTypes.some(row => row.id === type)) throw new TypeError('Unknown history change type.');
    if (typeof q !== 'string' || q.length > 200) throw new TypeError('History search must be at most 200 characters.');
    const captured = current;
    if (stateRevision !== undefined && stateRevision !== captured.revision) throw new RevisionConflict(captured);
    const plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, (_, label) => label.split('#')[0]).replace(/\[\+\]/g, '').replace(/<[^>]*>/g, '').trim();
    const search = q.trim().toLocaleLowerCase();
    const taskNames = search ? new Map(captured.tasks.map(task => [task.id, task.label])) : undefined;
    const memberName = id => captured.members.find(member => member.id === id)?.name ?? id;
    const taskLabel = id => taskNames.get(id) ?? captured.identityRegistry?.entries?.[id]?.label ?? labels.taskLabel?.(id) ?? id;
    const readable = Object.fromEntries(Object.entries({ ...labels, memberName, taskLabel }).map(([key, lookup]) => [key, id => plain(lookup(id))]));
    const matches = event => {
      if (player !== undefined && event.command?.memberId !== player && event.actor?.memberId !== player
        && !event.command?.affectedMemberIds?.includes(player)
        && !event.command?.members?.some(member => member.memberId === player)
        && !event.command?.starts?.some(member => member.memberId === player)) return false;
      if (type !== undefined && historyChangeType(event) !== type) return false;
      if (search) {
        const command = event.command ?? {};
        const text = [describeHistoryEvent(event, readable), event.actor?.label, command.taskLabel, command.task?.label,
          command.teleport?.label, command.name].map(plain).concat([command.note ?? '', command.backlogReason ?? '']).join(' ').toLocaleLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    };
    const rows = [];
    let boundary = before;
    while (rows.length < limit + 1) {
      const needed = limit + 1 - rows.length, selected = new Map();
      await visitHistory(captured, event => {
        if (boundary !== undefined && event.revision >= boundary) return;
        const matching = matches(event);
        if (!selected.has(event.revision)) {
          if (!matching) return;
          if (selected.size >= needed) {
            const oldest = Math.min(...selected.keys());
            if (event.revision <= oldest) return;
            selected.delete(oldest);
          }
        }
        // Retain a superseded candidate's place even if its latest projection
        // stops matching. Otherwise an older matching copy could leak back in.
        selected.set(event.revision, { matching, record: historyRecord(event) });
      });
      rows.push(...[...selected.values()].filter(row => row.matching).map(row => row.record));
      if (selected.size < needed) break;
      boundary = Math.min(...selected.keys());
      // A rare projected record can remove a match; fill the resulting hole
      // from the next older bounded batch instead of keeping an all-event Set.
      if (!boundary) break;
    }
    rows.sort((a, b) => b.revision - a.revision);
    const hasMore = rows.length > limit;
    const history = rows.slice(0, limit);
    return { stateRevision: captured.revision, history, nextBefore: hasMore ? history.at(-1).revision : null, hasMore };
  }
  async function readHistoryEvent(revision, { stateRevision } = {}) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('History revision must be a nonnegative safe integer.');
    if (stateRevision !== undefined && (!Number.isSafeInteger(stateRevision) || stateRevision < 0)) throw new TypeError('History stateRevision must be a nonnegative safe integer.');
    const captured = current;
    if (stateRevision !== undefined && stateRevision !== captured.revision) throw new RevisionConflict(captured);
    let found = captured.history.find(event => event.revision === revision);
    if (!found) await visitHistory(captured, event => { if (event.revision === revision) found = event; });
    if (!found) throw Object.assign(new Error('History change not found.'), { code: 'ENOENT' });
    const { undo, ...event } = found;
    return { stateRevision: captured.revision, event: structuredClone({ ...event, hasUndo: Boolean(undo) }) };
  }
  const store = {
    getState: cloneCurrent,
    getTaskClaimState() {
      const { schemaVersion, revision, rules, members, tasks, identityRegistry, taskClaims } = playProjection(current).state;
      // Select before cloning: History and private retained evidence can be large.
      return structuredClone({ schemaVersion, revision, rules, members, tasks, identityRegistry,
        ...(taskClaims !== undefined ? { taskClaims } : {}) });
    },
    getTaskClaimSnapshot: () => ({ revision: current.revision, taskClaims: structuredClone(current.taskClaims ?? {}) }),
    getRules: () => ({ ...current.rules }),
    getStateSnapshot: ({ view } = {}) => commandSnapshot(undefined, false, view),
    getCalculationState: () => capturedCalculation().state,
    getCalculationSnapshot: capturedCalculation,
    releaseTaskCaches() {
      calculationSnapshot = undefined; poolState = undefined; fullPools = undefined; playPools = undefined;
      serializedFields = new WeakMap();
      playProjections.delete(current);
    },
    getProgress: () => buildProgressModel(current, { questPoints: progressQuestPoints, now: timestamp() }),
    getHistory: () => structuredClone({ stateRevision: current.revision, history: current.history,
      previousHistory: current.provenance?.restore?.previousHistory ?? [] }),
    queryHistory,
    getRollStats,
    readHistoryEvent,
    getRecentHistory(limit = 100) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('History limit must be a positive safe integer.');
      return current.history.slice(-limit).map(historyRecord);
    },
    getHistoryEvent: revision => historyRecord(current.history.find(event => event.revision === revision)),
    getUndoEligibility: undoRevision => getUndoEligibility(current, undoRevision, { registry }),
    getStateJSONParts: () => ['{', ...stateFields(current), '}'],
    getGameplayFingerprint: gameplayFingerprint,
    getInfo: () => ({ revision: current.revision, durable: true, schemaVersion: current.schemaVersion,
      retention: { policy, activeHistoryEntries: current.history.length, historyArchives: current.provenance?.historyArchive?.length ?? 0,
        ...(retentionFailure ? { failure: retentionFailure } : {}) } }),
    backup: async () => envelope((await hydrateHistory(current)).state),
    async listBackups() {
      return enqueueMaintenance(async () => {
        const byId = new Map([...(await retainedArchiveIndex()).values()].map(item => [item.metadata.id, { ...item.metadata }]));
        for (const backup of await standaloneBackups()) byId.set(backup.id, backup);
        const backups = [...byId.values()].map(backup => ({ ...backup }));
        const revisions = new Set(backups.map(backup => backup.revision)), events = new Map();
        await visitHistory(current, event => { if (revisions.has(event.revision)) events.set(event.revision, historyRecord(event)); });
        for (const backup of backups) backup.event = events.get(backup.revision) ?? null;
        return backups.sort((a, b) => b.revision - a.revision || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
      });
    },
    async readBackup(id) {
      if (typeof id !== 'string' || !BACKUP_ID.test(id)) throw new TypeError('Invalid retained backup ID.');
      return enqueueMaintenance(async () => {
        let file;
        try {
          const base = await realpath(backupsDir);
          file = await realpath(path.join(backupsDir, id));
          if (path.dirname(file) !== base) throw new TypeError('Invalid retained backup location.');
        } catch (error) {
          if (error.code === 'ENOENT') {
            const archived = (await retainedArchiveIndex()).get(id);
            if (!archived) throw Object.assign(new Error('Retained backup not found.'), { code: 'ENOENT' });
            const pack = await readDocument(path.join(archivesDir, archived.packId));
            const snapshot = pack.snapshots.find(item => item.id === id);
            if (!snapshot) throw new TypeError('Retained backup archive is missing its snapshot.');
            const state = await importStoredBackup(snapshot.document);
            if (state.revision !== Number(BACKUP_ID.exec(id)[1])) throw new TypeError('Retained backup revision does not match its ID.');
            return envelope((await hydrateHistory(state)).state);
          }
          throw error;
        }
        const bytes = await readFile(file);
        const decoded = id.endsWith('.gz') ? await gunzipAsync(bytes) : bytes;
        const state = await importStoredBackup(decoded.toString('utf8'));
        if (state.revision !== Number(BACKUP_ID.exec(id)[1])) throw new TypeError('Retained backup revision does not match its ID.');
        return envelope((await hydrateHistory(state)).state);
      });
    },
    getAccessToken: () => token,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    command(command, expectedRevision, { actor } = {}) {
      return runCommand(command, expectedRevision, false, false, actor);
    },
    commandSerialized(command, expectedRevision, { omitUnchanged = false, actor, view } = {}) { return runCommand(command, expectedRevision, true, omitUnchanged, actor, view); },
    reconcileTaskClaims(activeTaskIds, expectedRevision) {
      const active = new Set(activeTaskIds);
      for (const id of active) if (typeof id !== 'string' || !id) throw new TypeError('Active task IDs must be nonempty strings.');
      return enqueue(async () => {
        checkRevision(expectedRevision);
        const canonicalActive = new Set([...active].map(id => resolveSavedTaskId(current.identityRegistry, id)));
        const taskIds = Object.keys(current.taskClaims ?? {}).filter(id => !canonicalActive.has(id)).sort();
        if (!taskIds.length) return null;
        // Cancel active inverses now and retain a small watermark for archived
        // ones. Archive replay belongs to actual Undo/export, never cleanup.
        const next = { ...current, revision: current.revision + 1, taskClaims: { ...current.taskClaims } };
        for (const id of taskIds) delete next.taskClaims[id];
        cancelTaskClaimUndo(next, taskIds);
        const previous = coordinationOf(current), invalidatedUndo = { ...previous.invalidatedUndo };
        for (const id of taskIds) invalidatedUndo[id] = current.revision;
        coordination.set(next, { ...previous, invalidatedUndo });
        return persist(next, 'claim-cleanup', undefined, false, undefined, false, undefined, { claimOnly: true, cleanup: true });
      });
    },
    replace(document, expectedRevision, { actor } = {}) {
      const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
      return enqueue(async () => {
        checkRevision(expectedRevision);
        const ready = await replacementState(document, cloneCurrent(), attribution);
        return persist(ready, 'replace');
      });
    },
    async previewReplacement(document, { actor } = {}) {
      const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
      const base = cloneCurrent();
      return { current: base, state: await replacementState(document, base, attribution) };
    },
    close({ beforeUnlock } = {}) {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => { await queue; await enqueueMaintenance(maintainRetention); await beforeUnlock; listeners.clear(); await releaseLock(); })();
      return closePromise;
    },
  };
  return store;
}
