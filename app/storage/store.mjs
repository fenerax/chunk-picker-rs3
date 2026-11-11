import { isMainThread } from 'node:worker_threads';
import { pluginTestingMode, withPluginTestingMode } from '../core/plugin-testing.mjs';
import { runImportJob, registryMetadata } from '../import-jobs.mjs';
import { MAX_PORTABLE_BACKUP_BYTES, BACKUP_LIMIT_LABEL } from '../backup-transfer.mjs';
import { parseJSONStream } from './json-stream.mjs';
import { withStoreWrite } from './snapshot.mjs';
import { hasPluginHandled, withPluginHandled, preserveCommittedPluginHandled } from './plugin-handled.mjs';
import { foldLegacyPluginHandled } from './plugin-handled-sidecars.mjs';
import { withPluginEvidence } from './plugin-evidence-lock.mjs';
import { appendOptionalSidecarEvidence, captureOptionalSidecarEvidence, materializeOptionalSidecarEvidence as materializeEvidenceRecords, reconcileOptionalSidecarEvidence as reconcileEvidenceRecords, withOptionalSidecarEvidence } from '../optional-sidecar-evidence.mjs';
import { withPluginItemEvidenceWrite } from './plugin-item-snapshot.mjs';
import { warnOptionalPluginData } from '../core/optional-plugin-data.mjs';
import { dismissPluginItemEvidence, exportPluginItemEvidence, hasPluginItemDecisions, hasLegacyPluginItemDecisions, recoverPluginItemDecisions, samePluginItemDecisions, stagePluginItemDecisions } from '../plugin-items.mjs';
import { reconcilePluginItemEvidence, pluginItemEvidenceFromEnvelope, retainPluginItemEvidence, mergePluginItemEvidence } from '../core/plugin-item-evidence.mjs';
import { COMPLETION_BACKUP_VERSION, createCompletionEncoder, decodeCompletionDocument } from './completion-codec.mjs';
import { mkdir, open, readFile, readdir, realpath, stat, unlink, utimes } from 'node:fs/promises';
import { warnDurability } from './publication.mjs';
import path from 'node:path';
import { acquireProcessGuard } from './process-guard.mjs';
import { acquireStoreFileLock as acquireLock } from './store-lock.mjs';
import { atomicWrite } from './atomic-write.mjs';
export { prepareStoreProcessIdentity } from './store-lock.mjs';
import { readStaticFieldBytes, validateStaticFieldReference } from './static-field.mjs';
import { createOwnedStorage } from './owned-storage.mjs';
import { cloneResidentState, isResidentState, shareResidentCatalogue, reconcileResidentIdentities, adoptResidentState, residentBase } from '../core/resident-copy.mjs';
import { applyResidentCommand, materializeResidentState, validateResidentState } from '../core/state.mjs';
import { identityValue, identityJSONParts } from '../tasks/identity-dictionary.mjs';
import { ownedCalculatorInput } from '../tasks/owned-transport.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { gzip, gunzip, constants } from 'node:zlib';
import { promisify, isDeepStrictEqual } from 'node:util';
import { applyValidatedCommand, BACKUP_FORMAT, SCHEMA_VERSION, createGroupState, createOwnedStateValidationCache, importBackup, validateState, validateOwnedState, validateHistoryActor, getUndoEligibility, hasRetainedSparseUndo, cancelTaskClaimUndo, hasRandomStartChoices } from '../core/state.mjs';
import { resolveSavedTaskId } from '../tasks/migration.mjs';
import { evaluateRollPool, partnerConnections, createRollPoolCache } from '../core/rules.mjs';
import { captureProgressSnapshot, buildProgressModel } from '../core/progress-timeline.mjs';
import { createGameplayFingerprint, canReuseGameplayFieldBytes } from './gameplay-fingerprint.mjs';
import { createTaskReuseFingerprint } from '../tasks/unlock-reuse.mjs';
import { projectPlayState, projectPlayStateSteps, PLAY_VIEW } from '../play-view.mjs';
import { projectBrowserState } from '../web/browser-state.mjs';
import { readHistoryEvents } from './history-reader.mjs';
import { computeRollStats, selectRollStatsEvent } from '../core/roll-stats.mjs';
import { describeHistoryEvent, historyChangeType, historyChangeTypes } from '../web/history-text.mjs';
import { loadGameDefaults } from '../game-defaults.mjs';
import { ACTION_CLIENT_SLOTS, loadActionReceipts, inspectActionReceipt, commitActionReceipt, openActionSession, acknowledgeActionSession } from './action-receipts.mjs';
import { reportActivationTiming } from '../live-swap-timing.mjs';
import { currencyAfterCommand, currencyAfterRestore, loadPluginCurrency, observePluginCurrency } from './plugin-currency.mjs';
import { boundedOutput, rosterOutput } from '../import-output.mjs';

const gzipAsync = promisify(gzip), gunzipAsync = promisify(gunzip);

// Unlike public importBackup(), this input comes only from our private file.
// JSON.parse already gives storage ownership; retain every envelope/schema
// check without serializing and copying the complete state a second time.
function parseSavedDocument(value) {
  try { return typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(value) : value; }
  catch { throw new TypeError('Backup is not valid JSON'); }
}
function pinSerializedDocument(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let end = bytes.length;
  while (end) {
    const byte = bytes[end - 1];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break;
    end--;
  }
  return Buffer.concat([bytes.subarray(0, end - 1), Buffer.from(',"retentionPinned":true}')]);
}
function importSavedState(bytes, registry, validationCache) {
  const backup = parseSavedDocument(bytes);
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new TypeError('backup must be an object');
  if (backup.format !== BACKUP_FORMAT) throw new TypeError('Unsupported backup format');
  if (backup.schemaVersion !== SCHEMA_VERSION) throw new TypeError(`Unsupported backup schema version: ${backup.schemaVersion}`);
  return importBackup(backup, registry, { owned: true, validationCache });
}
const BACKUP_ID = /^(\d{16})-[a-f0-9]{16}\.json(?:\.gz)?$/;
const HISTORY_ID = /^history-\d{16}-\d{16}-[a-f0-9]{16}\.json\.gz$/;
const ARCHIVE_ID = /^archive-[a-f0-9]{16}\.json\.gz$/;
const STATIC_ID = /^static-([a-f0-9]{64})\.json\.gz$/;
const STATIC_THRESHOLD = 256 * 1024;
// Decoded JSON budget, including the nominal 19 MiB task catalogue. Parsed
// fields, normalized strings and validation indexes live only while their
// weakly keyed field is reachable; one-off versions must not accumulate.
const RETENTION_STATIC_CACHE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_RETENTION = Object.freeze({ backupDays: 90, historyEntries: 1000 });
const COMPLETION_HISTORY_TYPES = new Set(['set-task-status', 'tick-active-tasks', 'complete-task', 'apply-runemetrics', 'apply-game-progress', 'sync-original']);
function taskCompletionEvent({ revision, type, at, command, undoneRevision }) {
  if (!command || !COMPLETION_HISTORY_TYPES.has(type)) return null;
  // Keep only ledger evidence, never undo snapshots, actor details or notes.
  return structuredClone({ revision, type, at, undoneRevision, command: type === 'sync-original'
    ? { members: (command.members ?? []).map(row => ({ memberId: row.memberId, tasks: { complete: row.tasks?.complete ?? [] } })) }
    : { memberId: command.memberId, taskId: command.taskId, taskIds: command.taskIds, completed: command.completed,
      ...(Object.hasOwn(command, 'challengeCompleted') ? { challengeCompleted: command.challengeCompleted } : {}),
      quests: command.quests?.map(row => ({ taskId: row.taskId })) } });
}
export class RevisionConflict extends Error {
  constructor(state) {
    super(`Revision conflict: the current revision is ${state.revision}. Refresh before saving.`);
    this.code = 'REVISION_CONFLICT';
    this.state = state;
  }
}

/** One durable, exclusively locked store. All writes share one revision queue. */
export async function openStore({ dataDir, world, registry, initialState, migrateState, prepareState, prepareImportState, beforeCommit, beforeLockRecovery, now, random, taskCatalogue, retention, progressQuestPoints, membersStartBanks, xpChoiceCatalogue, readOnly = false, importReader = false, liveSwapStrict = false, expectedCheckpoint, onActivationTiming, rollPoolCache, computeRollPool, completionCodec = process.env.RS3_COMPLETION_CODEC === '1', startupDiagnostics, ownedFormat2 = false, releaseCommandResponses = false } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required.');
  if (importReader && (isMainThread || !readOnly)) throw new TypeError('An import reader must be an isolated read-only worker.');
  if (typeof completionCodec !== 'boolean') throw new TypeError('completionCodec must be boolean.');
  if (typeof releaseCommandResponses !== 'boolean') throw new TypeError('releaseCommandResponses must be boolean.');
  const encodeCompletions = completionCodec ? createCompletionEncoder() : document => document;
  const policy = retention === false ? false : { ...DEFAULT_RETENTION, ...retention };
  if (policy) {
    if (!Number.isSafeInteger(policy.backupDays) || policy.backupDays < 1) throw new TypeError('retention.backupDays must be a positive safe integer.');
    if (!Number.isSafeInteger(policy.historyEntries) || policy.historyEntries < 1) throw new TypeError('retention.historyEntries must be a positive safe integer.');
    if (Object.keys(policy).some(key => !['backupDays', 'historyEntries'].includes(key))) throw new TypeError('Unknown retention policy setting.');
  }
  const directory = path.resolve(dataDir);
  const ownedStorage = ownedFormat2 === false ? undefined : createOwnedStorage(ownedFormat2, directory, { readOnly });
  if (ownedStorage) ownedStorage.validateCapture = async (dataDir, options) => {
    const { validateOwnedHistory } = await import('../../scripts/linux/probe.mjs');
    await validateOwnedHistory(dataDir, options, { importBackup: document => importBackup(document, registry), cancelTaskClaimUndo });
  };
  if (ownedStorage && completionCodec) throw new TypeError('Owned format 2 requires the schema-1 envelope (completionCodec off).');
  // Select adapters once. Format 1 retains its existing serialization loops.
  const copyState = ownedStorage ? materializeResidentState : structuredClone;
  const sameState = ownedStorage ? ownedStorage.sameState : isDeepStrictEqual;
  const withCatalogue = ownedStorage ? (work, mode = 'shared') => ownedStorage.withLease(work, { mode }) : work => work();
  const writeState = ownedStorage ? (bytes, options) => ownedStorage.writeState(stateFile, bytes, options)
    : (bytes, options) => atomicWrite(stateFile, bytes, options);
  const applyStoredCommand = ownedStorage ? applyResidentCommand : applyValidatedCommand;
  async function selectOwnedStartupBase(document) {
    if (document.storage?.schemaVersion === 2) await ownedStorage.select(document.storage.base);
    // Release hooks close over catalogue/world context the pinned base cannot
    // reconstruct. Refuse before recovery, currency proofs or preparation.
    // Isolated import readers retain their exact-load path without those hooks.
    if (ownedStorage.base && !importReader && (migrateState || prepareState)
      && ownedStorage.base.dataset.digest !== ownedStorage.readerOptions.dataset.digest) {
      throw Object.assign(new Error('Owned save dataset digest differs from the running release; release-bound startup preparation requires explicit upgrade staging (slice 7 pinned-dataset preparation gate).'), { code: 'OWNED_REBASE_REFUSED' });
    }
  }
  async function readOwnedStartupDocument() {
    // A mixed binding/state publication must never be admitted by a reader.
    try {
      await readFile(path.join(directory, 'owned-rebase-intent.json'));
      throw Object.assign(new Error('Owned rebase pending; explicitly reconcile the migration intent before opening this group.'), { code: 'OWNED_REBASE_PENDING' });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let bytes;
    try { bytes = await readFile(path.join(directory, 'state.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (bytes) await selectOwnedStartupBase(parseSavedDocument(bytes));
    return bytes;
  }
  // Even lock recovery and directory/token creation follow the owned gate.
  // Recheck under ownership below and load those same authoritative bytes.
  if (ownedStorage) await readOwnedStartupDocument();
  if (!readOnly) await mkdir(directory, { recursive: true });
  let releaseGuard = readOnly ? async () => {} : await acquireProcessGuard(directory);
  let releaseFileLock;
  try { releaseFileLock = readOnly ? async () => {} : await acquireLock(directory, beforeLockRecovery); }
  catch (error) { await releaseGuard(); throw error; }
  let unregisterArtifacts = !readOnly ? ownedStorage?.registerArtifacts() : undefined;
  const releaseLock = async () => { try { await releaseFileLock(); } finally { unregisterArtifacts?.(); await releaseGuard(); } };
  const stateFile = path.join(directory, 'state.json');
  const backupsDir = path.join(directory, 'backups');
  const historyDir = path.join(directory, 'history');
  const archivesDir = path.join(backupsDir, 'archives');
  const staticDir = path.join(directory, 'static');
  let importDependencies;
  let pendingPublication;
  async function writeDependency(file, bytes, at) {
    if (importDependencies) { importDependencies.push({ file: path.relative(directory, file), bytes: Buffer.from(bytes) }); return; }
    if (pendingPublication) { pendingPublication.dependencies.push({ file, bytes, at }); return; }
    reportDurability(await atomicWrite(file, bytes));
    if (at) await utimes(file, at, at);
  }
  async function publishDependencies(dependencies) {
    for (const { file, bytes, at } of dependencies) {
      await mkdir(path.dirname(file), { recursive: true });
      reportDurability(await atomicWrite(file, bytes));
      if (at) await utimes(file, at, at);
    }
  }
  const acknowledgementsFile = path.join(directory, 'action-acknowledgements.json');
  let durabilityWarnings = 0, lastDurabilityWarningAt;
  function reportDurability(publication) {
    if (publication?.durable !== false) return;
    durabilityWarnings++;
    lastDurabilityWarningAt = new Date().toISOString();
    warnDurability(publication, 'gameplay store');
  }
  let current;
  async function publicationState(state, previous) {
    const original = state;
    // A preparation hook may rebuild provenance. Already committed replay
    // decisions remain authoritative even before the legacy bridge catches up.
    if (current) state = preserveCommittedPluginHandled(state, current);
    state = materializeOptionalSidecarEvidence(state, state.provenance?.optionalSidecarEvidence);
    const retainCommittedReplay = previous && isDeepStrictEqual(state.members.map(m => m.id), previous.members.map(m => m.id))
      && isDeepStrictEqual(state.provenance?.pluginAutoHandled, previous.provenance?.pluginAutoHandled)
      && isDeepStrictEqual(state.provenance?.pluginItemEvidence, previous.provenance?.pluginItemEvidence);
    const captured = await captureOptionalSidecarEvidence(state, { dataDir: directory, retainCommittedReplay: !!retainCommittedReplay, storeOwned: true });
    const materialized = materializeOptionalSidecarEvidence(state, captured, { publication: true });
    const folded = await foldLegacyPluginHandled({ dataDir: directory, state: materialized, previous });
    let ready = sameState(folded, original) ? original : folded;
    if (ready !== original && coordination.has(original)) coordination.set(ready, coordination.get(original));
    if (ready !== original && journalRecovery.has(original)) journalRecovery.add(ready);
    if (ownedStorage && isResidentState(original)) ready = inheritStateMetadata(original, ready);
    if (ownedStorage && !isResidentState(ready)) {
      await ownedStorage.codec();
      ready = inheritStateMetadata(ready, shareResidentCatalogue(copyState(ready), ownedStorage.base));
    }
    return ready;
  }
  const importTickets = new WeakMap();
  // Receipts are private storage metadata, committed in the SAME replacement
  // as gameplay. Never evict IDs: an arbitrarily delayed retry must fail closed.
  let receipts, pluginCurrency;
  const currencyEpoch = randomBytes(16).toString('hex');
  let acknowledgements = [];
  function acknowledgementFor(slot, row) {
    return { slot, clientId: row.clientId, generation: row.generation, principal: row.principal,
      ...(row.scope ? { scope: row.scope } : {}), sequence: row.sequence,
      requestId: row.receipt.requestId, fingerprint: row.receipt.fingerprint, revision: row.receipt.revision };
  }
  async function acknowledgedReceipts(ledger) {
    let records;
    try {
      const bytes = await readFile(acknowledgementsFile);
      if (bytes.length > 64 * 1024) return { ledger, records: [] };
      const document = JSON.parse(bytes);
      records = document?.entries;
      if (document?.schemaVersion !== 1 || !Array.isArray(records) || records.length > ACTION_CLIENT_SLOTS
        || new Set(records.map(row => row?.slot)).size !== records.length
        || records.some(row => !row || typeof row !== 'object' || Array.isArray(row)
          || Object.keys(row).some(key => !['slot', 'clientId', 'generation', 'principal', 'scope', 'sequence', 'requestId', 'fingerprint', 'revision'].includes(key))
          || !Number.isSafeInteger(row.slot) || row.slot < 0 || row.slot >= ACTION_CLIENT_SLOTS)) return { ledger, records: [] };
    } catch {
      // ACKs only prune outcomes whose browser copy is already durable. Losing
      // or rejecting this optional optimization must retain the replay receipt.
      return { ledger, records: [] };
    }
    let slots;
    const retained = [];
    for (const record of records) {
      const row = ledger?.slots[record.slot];
      if (!row?.receipt || row.acknowledged >= row.sequence
        || !isDeepStrictEqual(record, acknowledgementFor(record.slot, row))) continue;
      slots ??= [...ledger.slots];
      const acknowledged = { ...row, acknowledged: row.sequence }; delete acknowledged.receipt;
      slots[record.slot] = acknowledged;
      retained.push(record);
    }
    return { ledger: slots ? { ...ledger, slots } : ledger, records: retained };
  }
  let receiptQuarantine;
  function receiptMetadata(value, revision) {
    try { return { ledger: loadActionReceipts(value, revision) }; }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // A damaged private ledger is not damaged gameplay. Keep the evidence
      // in memory until an explicit write would replace it; startup and standby
      // must keep the authoritative document and its checkpoint byte-for-byte.
      // Unknown outcomes cannot be replayed or inferred to be safe to retry.
      return { ledger: undefined, quarantine: Buffer.from(`${JSON.stringify({ schemaVersion: 1, revision,
        reason: error.message, actionReceipts: value })}\n`) };
    }
  }
  async function retainReceiptQuarantine() {
    if (!receiptQuarantine) return;
    const bytes = receiptQuarantine;
    const quarantineDirectory = path.join(directory, 'receipt-quarantine');
    const file = path.join(quarantineDirectory, `${createHash('sha256').update(bytes).digest('hex')}.json`);
    if (!importDependencies) await mkdir(quarantineDirectory, { recursive: true });
    let existing;
    try { existing = await readFile(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && !existing.equals(bytes)) throw new Error('Action receipt quarantine evidence changed.');
    if (!existing) {
      if (importDependencies) await writeDependency(file, bytes);
      else reportDurability(await atomicWrite(file, bytes));
    }
    receiptQuarantine = undefined;
  }
  let frozen = readOnly;
  let freezePending = false;
  let currentDiskSerialized;
  let token;
  let closing = false;
  let closePromise;
  let activationPending;
  let queue = Promise.resolve();
  let maintenanceQueue = Promise.resolve();
  let maintenancePending = 0;
  let maintenanceWrites = 0;
  let retentionFailure;
  let archiveIndex;
  const listeners = new Set();
  const envelope = ownedStorage ? state => ({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, state: copyState(state) })
    : state => ({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, state });
  const envelopePrefix = `${JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION }).slice(0, -1)},"state":`;
  let serializedFields = new WeakMap();
  const staticReferences = new WeakMap();
  const standbyStaticFields = new Map();
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
  // Commands publish immutable events. Reuse only an identical event prefix;
  // Undo, compaction and caller preparation fall back to full serialization.
  let historyEncoding;
  function historyJSON(events) {
    if (historyEncoding?.events === events) return historyEncoding.json;
    const previous = historyEncoding;
    const appended = previous && previous.events.length < events.length
      && previous.events.every((event, index) => event === events[index]);
    const json = appended ? previous.json.slice(0, -1)
      + (previous.events.length ? ',' : '')
      + events.slice(previous.events.length).map(event => JSON.stringify(event)).join(',') + ']'
      : JSON.stringify(events);
    historyEncoding = { events, json };
    return json;
  }
  const fieldJSON = ownedStorage ? (key, value) => {
    if (key === 'tasks') return JSON.stringify(value);
    if (key !== 'identityRegistry' || !value) return flatFieldJSON(key, value);
    return [...identityJSONParts(value)].join('');
  } : flatFieldJSON;
  function flatFieldJSON(key, value) {
    if (key === 'history') return historyJSON(value);
    if (!reusableFields.has(key) || value === null || typeof value !== 'object') return JSON.stringify(value);
    // Private state commands share these trees without mutating them. Hook
    // outputs cross validation into newly owned trees before reaching here.
    if (!serializedFields.has(value)) serializedFields.set(value, JSON.stringify(value));
    return serializedFields.get(value);
  }
  function* stateFields(state) {
    let first = true;
    for (const [key, value] of Object.entries(state)) {
      if (ownedStorage && key === 'identityRegistry' && value) {
        if (!first) yield ',';
        first = false;
        yield JSON.stringify(key); yield ':'; yield* identityJSONParts(value); continue;
      }
      const bytes = fieldJSON(key, value);
      if (bytes === undefined) continue;
      if (!first) yield ',';
      first = false;
      yield JSON.stringify(key); yield ':'; yield bytes;
    }
  }
  // Registries and exact migration archives can dwarf gameplay. Compact JSON
  // keeps durable writes bounded without changing portable backup semantics.
  const serialized = (state, ledger = receipts, currency = pluginCurrency, fields) => `${envelopePrefix}{${[...stateFields(state)].join('')}}${coordination.has(state) ? `,"coordination":${JSON.stringify(coordinationOf(state))}` : ''}${ledger ? `,"actionReceipts":${JSON.stringify(ledger)}` : ''}${currency ? `,"pluginCurrency":${JSON.stringify(currency)}` : ''}${fields ? `,"storage":${JSON.stringify({ schemaVersion: 1, fields })}` : ''}}\n`;
  async function importDocument(bytes) {
    const document = await parseJSONStream([bytes], { maxBytes: MAX_PORTABLE_BACKUP_BYTES });
    return document;
  }
  async function decodeStoredBytes(bytes, forImport) {
    try { return await gunzipAsync(bytes, forImport ? { maxOutputLength: MAX_PORTABLE_BACKUP_BYTES } : {}); }
    catch (error) { if (forImport && error.code === 'ERR_BUFFER_TOO_LARGE') (() => { throw Object.assign(new Error(`This backup is too large. The limit is ${BACKUP_LIMIT_LABEL} after decompression.`), { status: 413 }); })(); throw error; }
  }
  async function readStaticField(key, reference, forImport = false, retentionCache) {
    validateStaticFieldReference(key, reference);
    const cacheKey = `${key}:${reference?.id}`;
    if (retentionCache?.fields.has(cacheKey)) {
      const cached = retentionCache.fields.get(cacheKey);
      retentionCache.fields.delete(cacheKey);
      retentionCache.fields.set(cacheKey, cached);
      return cached;
    }
    if (readOnly && standbyStaticFields.has(cacheKey)) return standbyStaticFields.get(cacheKey);
    const bytes = await readStaticFieldBytes(directory, key, reference, { decompress: bytes => decodeStoredBytes(bytes, forImport) });
    const result = { value: forImport ? await importDocument(bytes) : JSON.parse(bytes.toString('utf8')), bytes: bytes.length };
    if (retentionCache && bytes.length <= RETENTION_STATIC_CACHE_BYTES) {
      while (retentionCache.bytes + bytes.length > RETENTION_STATIC_CACHE_BYTES) {
        const oldest = retentionCache.fields.keys().next().value;
        retentionCache.bytes -= retentionCache.fields.get(oldest).bytes;
        retentionCache.fields.delete(oldest);
      }
      retentionCache.validation.checkStaticField(result.value);
      retentionCache.bytes += bytes.length;
      retentionCache.fields.set(cacheKey, result);
    }
    if (readOnly) {
      if (standbyStaticFields.size >= reusableFields.size) standbyStaticFields.delete(standbyStaticFields.keys().next().value);
      standbyStaticFields.set(cacheKey, result);
    }
    return result;
  }
  async function hydrateStaticDocument(document, ownsDocument, forImport = false, retentionCache) {
    if (document?.storage === undefined) return ownsDocument ? document : { ...document, state: structuredClone(document?.state) };
    const metadata = document.storage;
    if (ownedStorage && metadata?.schemaVersion === 2) {
      const codec = await ownedStorage.read(metadata.base);
      const hydrated = await hydrateStaticDocument({ ...document, storage: { schemaVersion: 1, fields: metadata.fields === undefined ? {} : metadata.fields } }, ownsDocument, forImport, retentionCache);
      return codec.decode({ ...hydrated, storage: metadata });
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.schemaVersion !== 1
      || Object.keys(metadata).some(key => !['schemaVersion', 'fields'].includes(key))
      || !metadata.fields || typeof metadata.fields !== 'object' || Array.isArray(metadata.fields)
      || !document.state || typeof document.state !== 'object' || Array.isArray(document.state)) throw new TypeError('Invalid static storage metadata.');
    const state = ownsDocument ? { ...document.state } : structuredClone(document.state);
    for (const [key, reference] of Object.entries(metadata.fields)) {
      if (!reusableFields.has(key) || Object.hasOwn(state, key)) throw new TypeError(`Invalid stored static field: ${key}`);
      const loaded = await readStaticField(key, reference, forImport, retentionCache);
      state[key] = loaded.value;
    }
    return { ...document, state };
  }
  const journalRecovery = new WeakSet();
  function inheritStateMetadata(source, target) {
    if (source !== target) {
      if (coordination.has(source) && !coordination.has(target)) coordination.set(target, coordination.get(source));
      if (journalRecovery.has(source)) journalRecovery.add(target);
    }
    // serializedFields/staticReferences belong to immutable field objects,
    // not the root state. Shared fields already keep those verified caches;
    // cloned or changed fields must serialize/hash again, never inherit stale
    // bytes. Gameplay/view caches likewise recompute for a new root.
    return ownedStorage && isResidentState(source) && target !== source ? reconcileResidentIdentities(target, source) : target;
  }
  // Evidence adapters may replace the root without changing gameplay. Keep
  // store-owned Undo cancellation and archive metadata at this shared boundary,
  // including replacement previews that hydrate the destination's old History.
  function materializeOptionalSidecarEvidence(state, ...args) {
    return inheritStateMetadata(state, materializeEvidenceRecords(state, ...args));
  }
  function reconcileOptionalSidecarEvidence(state, ...sources) {
    return inheritStateMetadata(state, reconcileEvidenceRecords(state, ...sources));
  }
  async function importStoredBackup(document, ownsDocument = false, forImport = false, retentionCache) {
    document = decodeCompletionDocument(parseSavedDocument(document), undefined);
    document = await hydrateStaticDocument(document, ownsDocument, forImport, retentionCache);
    const reconciledJournals = document?.state?.provenance?.pluginItemEvidenceReconciled === 1;
    let state = materializeOptionalSidecarEvidence(reconcileOptionalSidecarEvidence(importSavedState(document, registry, retentionCache?.validation)), document.optionalSidecarEvidence ?? document.state?.provenance?.optionalSidecarEvidence);
    if (state.provenance?.pluginItemEvidence) {
      try { state = inheritStateMetadata(state, retainPluginItemEvidence(state,
        recoverPluginItemDecisions(state.provenance.pluginItemEvidence))); }
      catch { warnOptionalPluginData('item review recovery'); }
    }
    if (state.provenance?.pluginItemEvidenceReconciled === 1 && !reconciledJournals) journalRecovery.add(state);
    if (document.coordination !== undefined) coordination.set(state, validateCoordination(document.coordination, state.revision));
    for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
      const value = state[key];
      if (value === null || typeof value !== 'object') continue;
      if (retentionCache?.normalized.has(value)) continue;
      retentionCache?.normalized.add(value);
      const bytes = JSON.stringify(value);
      // Validation can normalize diagnostics. Reuse a loaded sidecar only when
      // its complete normalized field still has exactly the verified content.
      if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) continue;
      serializedFields.set(value, bytes);
      staticReferences.set(value, reference);
    }
    if (ownedStorage) { await ownedStorage.codec(); return shareResidentCatalogue(state, ownedStorage.base); }
    return state;
  }
  async function staticReference(key, value, bytes) {
    if (staticReferences.has(value)) return staticReferences.get(value);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const reference = { id: `static-${sha256}.json.gz`, sha256 };
    if (!pendingPublication) await mkdir(staticDir, { recursive: true });
    try { await readStaticField(key, reference); }
    catch (error) {
      if (error.cause?.code !== 'ENOENT') throw error;
      await writeDependency(path.join(staticDir, reference.id), await gzipAsync(bytes, { level: constants.Z_BEST_SPEED }));
    }
    staticReferences.set(value, reference);
    pendingPublication?.references.push(value);
    return reference;
  }
  const serializedDiskState = ownedStorage ? serializedOwnedDiskState : serializedFlatDiskState;
  async function serializedOwnedDiskState(state, ledger = receipts, currency = pluginCurrency) {
    await retainReceiptQuarantine();
    const encoded = (await ownedStorage.codec()).encode(state), fields = {};
    for (const key of ['legacy', 'provenance']) {
      const value = state[key];
      if (value === null || typeof value !== 'object') continue;
      const bytes = fieldJSON(key, value);
      if (!staticReferences.has(value) && Buffer.byteLength(bytes) < STATIC_THRESHOLD) continue;
      fields[key] = await staticReference(key, value, bytes);
      delete encoded.state[key];
    }
    if (Object.keys(fields).length) encoded.storage.fields = fields;
    return `${JSON.stringify(encodeCompletions({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, ...encoded,
      ...(coordination.has(state) ? { coordination: coordinationOf(state) } : {}),
      ...(ledger ? { actionReceipts: ledger } : {}), ...(currency ? { pluginCurrency: currency } : {}) }))}\n`;
  }
  async function serializedFlatDiskState(state, ledger = receipts, currency = pluginCurrency) {
    // Preserve rejected metadata before ANY replacement can drop it. Evidence
    // remains private, content addressed, and outside ordinary backup pruning.
    await retainReceiptQuarantine();
    const compact = inheritStateMetadata(state, { ...state }), fields = {};
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
    if (!Object.keys(fields).length && !completionCodec) return serialized(state, ledger, currency);
    if (!completionCodec) {
      return serialized(compact, ledger, currency, fields);
    }
    return `${JSON.stringify(encodeCompletions({ ...envelope(compact), ...(coordination.has(state) ? { coordination: coordinationOf(state) } : {}),
      ...(ledger ? { actionReceipts: ledger } : {}),
      ...(currency ? { pluginCurrency: currency } : {}),
      ...(Object.keys(fields).length ? { storage: { schemaVersion: 1, fields } } : {}) }))}\n`;
  }
  function gameplayFingerprint() {
    seedResidentFingerprint(current);
    return fingerprint(current);
  }
  const residentDigests = new WeakMap();
  function seedResidentFingerprint(state) {
    if (!ownedStorage || !state.identityRegistry) return;
    if (!residentDigests.has(state.identityRegistry)) {
      const hash = createHash('sha256');
      for (const part of identityJSONParts(state.identityRegistry)) hash.update(part);
      residentDigests.set(state.identityRegistry, hash.digest('hex'));
    }
    const digests = { identityRegistry: residentDigests.get(state.identityRegistry) };
    fingerprint.seedStatic(state, digests); taskReuseFingerprint.seedStatic(state, digests);
  }
  let poolState, fullPools, playPools, calculationSnapshot;
  const taskReuseFingerprint = createTaskReuseFingerprint();
  rollPoolCache ??= createRollPoolCache(world, registry, { inputKey: taskReuseFingerprint });
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
  const playProjectionJobs = new WeakMap();
  async function preparePlayProjection(state) {
    if (playProjections.has(state)) return;
    if (playProjectionJobs.has(state)) return playProjectionJobs.get(state);
    const job = (async () => {
      const steps = projectPlayStateSteps(state);
      let next, turn = performance.now();
      do {
        next = steps.next();
        if (performance.now() - turn >= 4) { await new Promise(resolve => setImmediate(resolve)); turn = performance.now(); }
      } while (!next.done);
      const projection = { state: next.value, tasksJSON: JSON.stringify(next.value.tasks) };
      await new Promise(resolve => setImmediate(resolve));
      projection.identityJSON = JSON.stringify(next.value.identityRegistry);
      playProjections.set(state, projection);
    })();
    playProjectionJobs.set(state, job);
    try { await job; } finally { playProjectionJobs.delete(state); }
  }
  let taskCompletionCache;
  const taskCompletionReads = new Set();
  function completionHistoryCache(since) {
    if (taskCompletionCache?.state === current && taskCompletionCache.since <= since) return taskCompletionCache;
    const captured = current, events = new Map();
    for (const event of captured.history) {
      const selected = taskCompletionEvent(event);
      if (selected) events.set(event.revision, selected);
    }
    const cache = taskCompletionCache = { state: captured, since, events, histories: new Map() };
    const references = captured.provenance?.historyArchive ?? [];
    const oldestLive = Date.parse(captured.history[0]?.at);
    if (references.length && (!Number.isFinite(oldestLive) || oldestLive > since) && !closing) {
      // Defer all archive I/O and decompression beyond the synchronous read reply.
      const reading = new Promise(resolve => setImmediate(resolve)).then(async () => {
        const events = new Map(cache.events), seen = new Set(captured.history.map(event => event.revision));
        const through = references.map(reference => {
          if (!HISTORY_ID.test(reference?.id)) throw new TypeError('Invalid history archive ID.');
          return Number(reference.id.split('-')[2]);
        });
        const remainingMax = [];
        for (let index = 0; index < through.length; index++) remainingMax[index] = Math.max(through[index], remainingMax[index - 1] ?? 0);
        let boundary = -1;
        for (let index = references.length - 1; index >= 0; index--) {
          if (closing || taskCompletionCache !== cache || current !== captured) return;
          // Newer segments and the live suffix win, including archived undo marks.
          for await (const event of readHistoryEvents(path.join(historyDir, references[index].id))) {
            if (closing || taskCompletionCache !== cache || current !== captured) return;
            const at = Date.parse(event.at);
            if (Number.isFinite(at) && at <= since) boundary = Math.max(boundary, event.revision);
            if (seen.has(event.revision)) continue;
            seen.add(event.revision);
            if (!Number.isFinite(at) || at < since) continue;
            const selected = taskCompletionEvent(event);
            if (selected) events.set(event.revision, selected);
          }
          // A late override of an old revision must not hide newer unread segments.
          if (index === 0 || remainingMax[index - 1] <= boundary) break;
        }
        if (!closing && taskCompletionCache === cache && current === captured) {
          cache.events = events;
          cache.histories.clear();
        }
      }).catch(() => { /* Unavailable archive evidence leaves live finishes readable. */ })
        .finally(() => taskCompletionReads.delete(reading));
      taskCompletionReads.add(reading);
    }
    return cache;
  }
  function refreshSnapshots() {
    if (poolState !== current) { poolState = current; fullPools = undefined; playPools = undefined; calculationSnapshot = undefined; }
  }
  function releaseObsoleteResponses(previous) {
    if (!releaseCommandResponses || previous === current) return;
    // Drop only store-owned references after publication. Captured responses
    // and calculation inputs remain intact for their in-flight callers.
    playProjections.delete(previous);
    refreshSnapshots();
  }
  function capturedCalculation() {
    refreshSnapshots();
    if (!calculationSnapshot) {
      const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...input } = current;
      // Preview section effects change when a random-start offer is created or
      // resolved. Keep its provenance and invalidate browser/ranking caches too.
      const randomStarts = current.members.filter(member => hasRandomStartChoices(current, member)).map(member => [member.id, member.pendingRoll]);
      input.history = randomStarts.length ? history : [];
      if (ownedStorage) adoptResidentState(input, residentBase(current));
      let state, stateJSON, taskInputKey, rollInputKey, residentState, ownedInput;
      const revision = current.revision, members = Object.freeze(current.members.map(member => Object.freeze({ id: member.id })));
      const inputKey = gameplayFingerprint();
      calculationSnapshot = { revision, members, inputKey, hasPendingRoll: current.members.some(member => member.pendingRoll.length > 0),
        get taskInputKey() {
          return taskInputKey ??= randomStarts.length
            ? createHash('sha256').update(JSON.stringify([taskReuseFingerprint(input), randomStarts])).digest('hex')
            : taskReuseFingerprint(input);
        },
        get rollInputKey() { return rollInputKey ??= rollPoolCache.input(input); },
        get residentState() { return ownedStorage ? residentState ??= cloneResidentState(input) : undefined; },
        get owned() { return ownedStorage ? ownedInput ??= ownedCalculatorInput(input) : undefined; },
        get state() { return state ??= copyState(input); },
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
    const input = current;
    fullPools ??= Object.fromEntries(input.members.map(member => [member.id,
      (rollPoolCache.get(input, member.id) ?? rollPoolCache.set(input, member.id,
        { pool: evaluateRollPool(world, input, member.id, registry) })).pool]));
    if (view !== PLAY_VIEW) return fullPools;
    playPools ??= Object.fromEntries(input.members.map(member => [member.id, { ...fullPools[member.id],
      partnerConnections: rollPoolCache.get(input, member.id)?.partnerConnections
        ?? partnerConnections(world, input, member.id, registry) }]));
    return playPools;
  }
  async function prepareRollPools() {
    refreshSnapshots();
    if (!computeRollPool || fullPools && playPools) return;
    const captured = current, values = [];
    const input = captured;
    for (const member of captured.members) values.push([member.id, await computeRollPool(input, member.id)]);
    if (current !== captured) return prepareRollPools();
    fullPools = Object.fromEntries(values.map(([id, value]) => [id, value.pool]));
    playPools = Object.fromEntries(values.map(([id, value]) => [id, { ...value.pool, partnerConnections: value.partnerConnections }]));
  }
  async function preparedCommandSnapshot(baseline, omitUnchanged, view) {
    for (;;) {
      const captured = current;
      await prepareRollPools();
      if (view === PLAY_VIEW) {
        await preparePlayProjection(captured);
        if (omitUnchanged && baseline) await preparePlayProjection(baseline);
      }
      if (current === captured) return commandSnapshot(baseline, omitUnchanged, view);
    }
  }
  function commandSnapshot(baseline, omitUnchanged = false, view) {
    const pools = rollPools(view);
    // Deleting omitted fields must never mutate the memoized full display view.
    const projection = view === PLAY_VIEW ? { ...playProjection(current).state } : { ...projectBrowserState(current) }, unchangedFields = [];
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
      pools: structuredClone(pools), ...(view === PLAY_VIEW ? { format: PLAY_VIEW, schemaVersion: 1 } : {}) };
  }
  async function retainBackup(state, operation, label) {
    // Every attempt keeps its own durable preimage, including a refused hook.
    // A retry must preserve that snapshot even at the same revision and time.
    const name = `${String(state.revision).padStart(16, '0')}-${randomBytes(8).toString('hex')}.json.gz`;
    // A members transition gets a portable, pinned full backup, including
    // archived History and fields normally stored in compact sidecars.
    const document = label ? JSON.stringify({ ...envelope((await hydrateHistory(state)).state), retentionPinned: true, retentionLabel: label })
      : ['replace', 'catalogue-refresh'].includes(operation)
      ? pinSerializedDocument(currentDiskSerialized) : currentDiskSerialized;
    // Retained checkpoints capture readable registered evidence. Optional
    // failures preserve current atomic policy and never veto the backup.
    const bytes = await gzipAsync(appendOptionalSidecarEvidence(document, await captureOptionalSidecarEvidence(state,
      { dataDir: directory, retainCommittedReplay: true, storeOwned: true })), { level: constants.Z_BEST_SPEED });
    const file = path.join(backupsDir, name);
    const at = new Date(timestamp());
    if (importDependencies) {
      await writeDependency(file, bytes, at);
      if (label) await writeDependency(`${file}.meta.json`, JSON.stringify({ label }));
    } else {
      await publishDependencies([{ file, bytes, at }, ...(label ? [{ file: `${file}.meta.json`, bytes: JSON.stringify({ label }) }] : [])]);
    }
    await ownedStorage?.crash?.('preimage-durable');
  }
  const timestamp = () => {
    const value = typeof now === 'function' ? now() : now ?? new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid store timestamp.');
    return date.toISOString();
  };
  function observeStartupProgress(state) {
    if (readOnly || liveSwapStrict || progressQuestPoints === undefined) return state;
    const observed = captureProgressSnapshot(state, { questPoints: progressQuestPoints, at: timestamp() });
    return inheritStateMetadata(state, observed);
  }
  function loadPreparationIsCurrent(state) {
    return (!prepareState || prepareState.isCurrent?.(state) === true)
      && (!migrateState || migrateState.isCurrent?.(state) === true);
  }
  async function prepared(state, operation) {
    // Explicit read-only proofs may repeat authorization before certifying a
    // no-op. Hooks without a proof keep their full copy/validation path.
    if (operation === 'command' && prepareState?.commandIsCurrent?.(state)
      && (!migrateState || migrateState.isCurrent?.(state))) return state;
    if (operation === 'load' && loadPreparationIsCurrent(state)) return state;
    // Gameplay commands start from an already migrated private state. Caller
    // preparation hooks still receive migration context and may require repair
    // of catalogue changes made by an earlier hook.
    if (!prepareState && (!migrateState || operation === 'command' || migrateState.isCurrent?.(state))) return state;
    // All callers pass a previously validated private state. Hooks receive a
    // separate clone and their output crosses the validation boundary once.
    const context = { operation, world, registry };
    let input = importReader && !ownedStorage ? state : copyState(state);
    // Only the explicit first-party migration stage may project saved history
    // onto new identities or establish an archived undo boundary. Caller hooks
    // receive that authoritative baseline, rather than permission to erase it.
    if (migrateState) {
      input = await migrateState(input, context) ?? input;
      input = validateOwnedState(input, registry);
      if (input.revision !== state.revision) throw new TypeError('Migration must preserve the authoritative revision.');
    }
    if (!prepareState) return inheritStateMetadata(state, input);
    const history = operation === 'load' ? JSON.stringify(input.history) : undefined;
    const output = await prepareState(input, context);
    const ready = importReader ? validateOwnedState(output ?? input, registry) : validateState(output ?? input, registry);
    if (operation === 'load' && (ready.revision !== state.revision || JSON.stringify(ready.history) !== history)) {
      throw new TypeError('Load preparation must preserve the authoritative revision and history.');
    }
    return inheritStateMetadata(state, ready);
  }
  async function hydrateHistory(state, cache, forImport = false, validationCache) {
    const archived = new Map();
    const references = state.provenance?.historyArchive ?? [];
    if (!Array.isArray(references)) throw new TypeError('Invalid history archive references.');
    for (const reference of references) {
      if (!HISTORY_ID.test(reference?.id)) throw new TypeError('Invalid history archive ID.');
      let document = cache?.documents.get(reference.id)?.document;
      if (!document) {
        const bytes = await decodeStoredBytes(await readFile(path.join(historyDir, reference.id)), forImport);
        document = forImport ? await importDocument(bytes) : JSON.parse(bytes.toString('utf8'));
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
    const history = [...events.values()].sort((a, b) => a.revision - b.revision);
    // Owned validation normalizes nested Undo values in place, including task
    // claim aliases and old stickers. Own the events too: cached archive JSON
    // must retain its original IDs for the next snapshot's identity registry.
    // The public validateState path already provides that isolation itself.
    const complete = { ...(ownedStorage && isResidentState(state) ? cloneResidentState(state) : state),
      history: ownedStorage || importReader || validationCache ? structuredClone(history) : history };
    if (complete.provenance?.historyArchive !== undefined) {
      complete.provenance = { ...complete.provenance };
      delete complete.provenance.historyArchive;
    }
    for (const [id, through] of Object.entries(coordinationOf(state).invalidatedUndo)) cancelTaskClaimUndo(complete, [id], through);
    if (forImport) await new Promise(resolve => setImmediate(resolve));
    if (ownedStorage && isResidentState(state)) inheritStateMetadata(state, complete);
    const validated = ownedStorage && isResidentState(complete) ? validateResidentState(complete, registry)
      : importReader || validationCache ? validateOwnedState(complete, registry, validationCache) : validateState(complete, registry);
    inheritStateMetadata(state, validated);
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
      await writeDependency(path.join(historyDir, id), bytes);
      references.push({ id });
    }
    const trimmed = { ...state, history: state.history.slice(cutoff), provenance: { ...state.provenance, historyArchive: references } };
    // The private input is already validated. The cutoff preserves pending-roll
    // and undo-marker dependencies; the only other change is authored durable
    // archive references. Keep untouched trees shared instead of cloning and
    // revalidating the complete catalogue/evidence at this retention boundary.
    return inheritStateMetadata(state, trimmed);
  }
  async function prepareLoadedState(state) {
    // Currency predicates have the same complete History contract as hooks.
    // Hydrate and validate once, then reuse that baseline for preparation and
    // the committed-dependency check, even when every hook is already current.
    const baseline = state.provenance?.historyArchive?.length ? (await hydrateHistory(state)).state : state;
    const ready = await prepared(baseline, 'load');
    if (ready === baseline) return state;
    if (baseline !== state && JSON.stringify(ready.history) === JSON.stringify(baseline.history)) {
      // Unchanged events retain the exact segments validated above. Hydration
      // alone must not rewrite the save or create a catalogue refresh.
      ready.history = structuredClone(state.history);
      ready.provenance = { ...ready.provenance, historyArchive: structuredClone(state.provenance.historyArchive) };
    } else if (ready.provenance?.historyArchive?.length) {
      // A hook introduced dependencies outside the validated baseline.
      await hydrateHistory(ready);
    }
    return inheritStateMetadata(state, ready);
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
  async function readDocument(file, compressed = true, forImport = false) {
    const source = await readFile(file);
    const bytes = compressed ? await decodeStoredBytes(source, forImport) : source;
    return forImport ? importDocument(bytes) : JSON.parse(bytes.toString('utf8'));
  }
  async function retainedArchiveIndex(forImport = false) {
    if (archiveIndex) return archiveIndex;
    const entries = await readdir(archivesDir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const index = new Map();
    for (const entry of entries) {
      if (!entry.isFile() || !ARCHIVE_ID.test(entry.name)) continue;
      const pack = await readDocument(path.join(archivesDir, entry.name), true, forImport);
      if (pack.format !== 'rs3-chunk-picker-retained-archive' || !Array.isArray(pack.snapshots)) throw new TypeError('Invalid retained backup archive.');
      for (const snapshot of pack.snapshots) {
        if (!BACKUP_ID.test(snapshot?.id)) throw new TypeError('Invalid archived backup ID.');
        const document = parseSavedDocument(snapshot.document);
        if (document?.format !== BACKUP_FORMAT) throw new TypeError('Unsupported backup format');
        if (![SCHEMA_VERSION, COMPLETION_BACKUP_VERSION].includes(document.schemaVersion)) throw new TypeError(`Unsupported backup schema version: ${document.schemaVersion}`);
        if (!Number.isSafeInteger(document?.state?.revision) || document.state.revision !== Number(BACKUP_ID.exec(snapshot.id)[1])) throw new TypeError('Archived backup revision does not match its ID.');
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
    // Cached immutable content is checked once while resident, never inherited
    // from the current save or a prior pass. Unknown-provenance candidates cross
    // the complete state/Undo boundary before any source can be removed.
    const retentionCache = { fields: new Map(), bytes: 0, normalized: new WeakSet(), validation: createOwnedStateValidationCache() };
    for (const backup of backups) {
      const day = backup.at.slice(0, 10);
      const checkpoint = !days.has(day);
      days.add(day);
      if (Date.parse(backup.at) >= cutoff || checkpoint || keep.has(backup.id)) continue;
      candidates.push(backup);
    }
    async function archiveSnapshots(removable) {
      if (!removable.length) return;
      const locations = new Map(removable.map(snapshot => [snapshot.id, archived.get(snapshot.id)]));
      const verifiedPacks = new Map();
      const snapshots = removable.filter(snapshot => !archived.has(snapshot.id));
      if (snapshots.length) {
        const packId = `archive-${randomBytes(8).toString('hex')}.json.gz`;
        const pack = { format: 'rs3-chunk-picker-retained-archive', snapshots };
        const json = JSON.stringify(pack);
        // Both this reader and frozen 06e1593 bound the WHOLE decompressed pack
        // during retained imports. Escaping document text can exceed that limit
        // even for a restorable standalone. Leave this batch's sources intact.
        if (Buffer.byteLength(json) > MAX_PORTABLE_BACKUP_BYTES) return;
        const bytes = await gzipAsync(json, { level: constants.Z_BEST_COMPRESSION });
        await mkdir(archivesDir, { recursive: true });
        reportDurability(await atomicWrite(path.join(archivesDir, packId), bytes));
        const reread = await decodeStoredBytes(await readFile(path.join(archivesDir, packId)), true);
        if (!reread.equals(Buffer.from(json))) throw new TypeError('Retained archive bytes differ after publication.');
        verifiedPacks.set(packId, parseSavedDocument(reread));
        for (const snapshot of snapshots) {
          locations.set(snapshot.id, { packId, metadata: { id: snapshot.id, revision: snapshot.revision, bytes: snapshot.bytes, at: snapshot.at } });
        }
      }
      // The synchronized and re-read archive is a second durable copy first.
      // Crashing midway leaves harmless duplicates; no sole snapshot is deleted.
      for (const snapshot of removable) {
        const archivedSnapshot = locations.get(snapshot.id);
        if (!verifiedPacks.has(archivedSnapshot.packId)) {
          const pack = await readDocument(path.join(archivesDir, archivedSnapshot.packId), true, true);
          if (pack.format !== 'rs3-chunk-picker-retained-archive' || !Array.isArray(pack.snapshots)) throw new TypeError('Invalid retained backup archive.');
          verifiedPacks.set(archivedSnapshot.packId, pack);
        }
        const verifiedPack = verifiedPacks.get(archivedSnapshot.packId);
        const copy = verifiedPack.snapshots.find(item => item.id === snapshot.id);
        if (!copy) throw new TypeError('Retained archive is missing its preserved snapshot.');
        // New packs preserve the exact decoded standalone JSON, including its
        // whitespace. Old object-valued packs retain their canonical comparison.
        const matches = typeof copy.document === 'string' ? copy.document === snapshot.document
          : JSON.stringify(copy.document) === JSON.stringify(parseSavedDocument(snapshot.document));
        if (!matches || copy.revision !== snapshot.revision || copy.bytes !== snapshot.bytes || copy.at !== snapshot.at) {
          throw new TypeError('Archived backup differs from its preserved standalone snapshot.');
        }
      }
      // Publish index entries only after the WHOLE batch rereads and matches.
      // A failed write/read/verification leaves every source in this batch.
      for (const [id, location] of locations) archived.set(id, location);
      for (const snapshot of removable) await unlink(path.join(backupsDir, snapshot.id));
    }
    let batch = [];
    let batchBytes = 0;
    for (const backup of candidates) {
      const source = await readFile(path.join(backupsDir, backup.id));
      const documentBytes = backup.id.endsWith('.gz') ? await decodeStoredBytes(source) : source;
      const document = parseSavedDocument(documentBytes);
      if (document.retentionPinned) continue;
      const state = await importStoredBackup(document, false, false, retentionCache);
      if (state.revision !== backup.revision) throw new TypeError('Retained backup revision does not match its ID.');
      if (state.provenance?.historyArchive !== undefined) await hydrateHistory(state, historyCache, false, retentionCache.validation);
      // JSON text has always been accepted by importStoredBackup, including the
      // frozen rollback reader. It also lets copy verification be byte-exact.
      const packedDocument = documentBytes.toString('utf8');
      if (!Buffer.from(packedDocument).equals(documentBytes)) throw new TypeError('Retained backup is not valid UTF-8.');
      const bytes = Buffer.byteLength(JSON.stringify(packedDocument));
      if (batch.length && (batch.length >= 32 || batchBytes + bytes > 8 * 1024 * 1024)) {
        await archiveSnapshots(batch);
        batch = [];
        batchBytes = 0;
      }
      batch.push({ ...backup, document: packedDocument });
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
  function enqueueMaintenance(work, { allowClosing = false, backupRead = false } = {}) {
    // Backup browsing remains a pure disk/cache read after an ordinary close.
    // A frozen handover still refuses new reads before writer ownership moves.
    if (!allowClosing && (frozen && !(importReader && backupRead) || (closing && !backupRead))) return Promise.reject(Object.assign(new Error('Please try again in a moment.'), { status: 503, code: 'PICKER_UPDATING' }));
    maintenancePending++;
    const result = maintenanceQueue.then(() => withStoreWrite(directory, () => withCatalogue(work))).finally(() => { maintenancePending--; });
    maintenanceQueue = releaseCommandResponses ? result.then(() => {}, () => {}) : result.catch(() => {});
    return result;
  }
  try { await withStoreWrite(directory, () => withCatalogue(() => withPluginEvidence(directory, async () => {
    const ownedStartupBytes = ownedStorage ? await readOwnedStartupDocument() : undefined;
    // Check the exact final document before ANY startup mutation. Hash includes
    // receipt/coordination metadata, not just the public revision number.
    if (expectedCheckpoint) {
      const bytes = await readFile(stateFile);
      if (createHash('sha256').update(bytes).digest('hex') !== expectedCheckpoint.sha256
        || parseSavedDocument(bytes)?.state?.revision !== expectedCheckpoint.revision) throw new Error('Handover checkpoint changed.');
    }
    if (!readOnly) { await mkdir(backupsDir, { recursive: true }); await mkdir(historyDir, { recursive: true }); }
    const tokenFile = path.join(directory, 'access-token');
    try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch (error) {
      if (error.code !== 'ENOENT' || readOnly) throw error;
      token = randomBytes(32).toString('base64url');
      reportDurability(await atomicWrite(tokenFile, `${token}\n`, { onPostPublishSyncError: 'warn' }));
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('The persisted access token is malformed; inspect the private data directory.');
    let existing = false;
    const hydrateStarted = startupDiagnostics && performance.now();
    try {
      const bytes = ownedStartupBytes ?? await readFile(stateFile), document = parseSavedDocument(bytes);
      current = await importStoredBackup(document, true);
      pluginCurrency = document.pluginCurrency === undefined ? undefined : loadPluginCurrency(document.pluginCurrency);
      const metadata = receiptMetadata(document.actionReceipts, current.revision);
      const acknowledged = await acknowledgedReceipts(metadata.ledger);
      receipts = acknowledged.ledger; acknowledgements = acknowledged.records; receiptQuarantine = metadata.quarantine;
      currentDiskSerialized = bytes; existing = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load the saved state: ${error.message}`, { cause: error });
      if (readOnly || expectedCheckpoint) throw error;
      const seed = initialState === undefined
        ? createGroupState((await loadGameDefaults()).members.map(({ id, name }) => ({ id, name })), registry)
        : validateState(initialState, registry);
      current = await publicationState(observeStartupProgress(await prepared(seed, 'initialize')));
      currentDiskSerialized = await serializedDiskState(current);
      reportDurability(await writeState(currentDiskSerialized, { onPostPublishSyncError: 'warn' }));
    }
    if (startupDiagnostics) startupDiagnostics.storeHydrateValidateMs = performance.now() - hydrateStarted;
    currentDiskSerialized ??= await serializedDiskState(current);
    // Recover surviving review markers as optional input. Neither capture nor
    // frozen lowering may prevent the current picker from serving.
    try {
      if (hasPluginItemDecisions(current.provenance?.pluginItemEvidence) || await hasLegacyPluginItemDecisions(directory)) {
        const recoveredItems = await exportPluginItemEvidence(directory,
          id => current.members.some(member => member.id === id) ? id : undefined,
          current.provenance?.pluginItemEvidence, { recoverReview: true });
        const recoveredState = inheritStateMetadata(current, hasPluginItemDecisions(recoveredItems) ? retainPluginItemEvidence(current, recoveredItems) : current);
        const lowering = await stagePluginItemDecisions(directory, recoveredItems,
          { checkOnly: true, memberIds: current.members.map(member => member.id) }).catch(() => undefined);
        if ((lowering || !samePluginItemDecisions(recoveredItems, current.provenance?.pluginItemEvidence)) && !readOnly && !liveSwapStrict) {
          try {
            const bytes = await serializedDiskState(recoveredState);
            reportDurability(await publishItemState(recoveredState, bytes, 'plugin-item-recovery'));
            currentDiskSerialized = bytes;
          } catch { warnOptionalPluginData('item review checkpoint'); }
        }
        current = recoveredState;
      }
    } catch { warnOptionalPluginData('item review capture'); }
    let pluginFoldPending = false;
    if (!readOnly && existing) {
      const folded = await publicationState(current);
      if (folded !== current) {
        if (coordination.has(current)) coordination.set(folded, coordination.get(current));
        // Preparation may still refuse a prospective suppression union. Keep
        // fold-back in memory until that validation has succeeded.
        current = folded; pluginFoldPending = true;
      }
    }
    if (existing) {
      const sealJournals = journalRecovery.has(current);
      const migrationStarted = startupDiagnostics && performance.now();
      let ready = await prepareLoadedState(current);
      if (startupDiagnostics) startupDiagnostics.storeMigrateValidateMs = performance.now() - migrationStarted;
      // Compare validated data directly: key ordering has no gameplay meaning,
      // and a changed projection should not stringify its large archive twice.
      // Exceptional numeric distinctions such as -0 conservatively refresh.
      if (!sameState(ready, current)) {
        if (readOnly || liveSwapStrict) throw Object.assign(new Error('Live swap refuses a save migration; use a reviewed offline migration.'), { code: 'LIVE_SWAP_MIGRATION_REQUIRED' });
        if (current.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('State revision limit reached.');
        ready.revision = current.revision + 1;
        ready.history.push({ id: `revision-${ready.revision}`, revision: ready.revision, type: 'catalogue-refresh', at: timestamp() });
        // prepared() validated the complete private state. The only changes
        // here are a checked revision increment and this authored history event.
        if (coordination.has(current)) coordination.set(ready, { ...coordinationOf(current), lastNonClaimRevision: ready.revision });
        // Include today's observation in this already-backed-up startup write.
        ready = await publicationState(observeStartupProgress(ready));
        await withPublicationPreparation(async pending => {
          await retainBackup(current, 'catalogue-refresh');
          const diskDocument = await serializedDiskState(ready);
          const publication = await writeState(diskDocument, { onPostPublishSyncError: 'warn', beforeRename: async () => {
            await beforeCommit?.({ operation: 'catalogue-refresh', state: copyState(ready) });
            await publishDependencies(pending.dependencies);
          } });
          pending.published = true;
          current = ready; currentDiskSerialized = diskDocument; pluginFoldPending = false;
          reportDurability(publication);
        });
      }
      // This is retention metadata, not gameplay. Persist the archive boundary
      // before accepting reports or exposing a copy an operator may later clear.
      if (sealJournals && !readOnly && !liveSwapStrict) {
        current = await publicationState(current);
        try { await withPublicationPreparation(async pending => {
          const diskDocument = await serializedDiskState(current);
          reportDurability(await writeState(diskDocument, { onPostPublishSyncError: 'warn',
            beforeRename: async () => {
              await beforeCommit?.({ operation: 'plugin-item-evidence', state: copyState(current) });
              await publishDependencies(pending.dependencies);
            } }));
          pending.published = true;
          currentDiskSerialized = diskDocument; pluginFoldPending = false;
        }); } catch { warnOptionalPluginData('item archive checkpoint'); }
      }
    }
    // Existing saves were checked by prepareLoadedState before publication.
    if (!existing && current.provenance?.historyArchive?.length) await hydrateHistory(current);
    // Daily observation metadata is independent of commands/catalogue changes.
    // Startup records today's counts without incrementing revision or History.
    if (!readOnly && !liveSwapStrict && progressQuestPoints !== undefined) {
      const observed = await publicationState(observeStartupProgress(current));
      if (observed !== current) {
        const diskDocument = await serializedDiskState(observed);
        // Observations keep the same revision, but still replace the durable save.
        await retainBackup(current, 'progress-snapshot');
        const publication = await writeState(diskDocument, { onPostPublishSyncError: 'warn' });
        current = observed; currentDiskSerialized = diskDocument;
        pluginFoldPending = false;
        reportDurability(publication);
      }
    }
    if (!readOnly) {
      const folded = await publicationState(current);
      if (folded !== current || pluginFoldPending) {
        if (coordination.has(current)) coordination.set(folded, coordination.get(current));
        try {
          const bytes = await serializedDiskState(folded);
          await writeState(bytes); currentDiskSerialized = bytes;
        }
        catch { warnOptionalPluginData('legacy fold checkpoint'); }
        current = folded;
      }
    }
    const retentionStarted = startupDiagnostics && performance.now();
    if (!readOnly && !liveSwapStrict) await maintainRetention();
    // Existing-base commands can enter shared admission immediately. A flat
    // save awaiting its explicit first format-2 write retains that write's
    // exclusive dependency-publication path.
    if (ownedStorage && !readOnly && ownedStartupBytes
      && parseSavedDocument(ownedStartupBytes).storage?.schemaVersion === 2) await ownedStorage.ensurePublished();
    if (startupDiagnostics) {
      startupDiagnostics.retentionMs = performance.now() - retentionStarted;
      startupDiagnostics.storeMigrateValidateMs ??= 0;
    }
  }), 'exclusive'));
  } catch (error) { await releaseLock(); throw error; }

  const cloneCurrent = () => copyState(current);
  const portableRetainedBackup = (state, forImport) => forImport ? envelope(state)
    // Internal imports map source identity before merging destination evidence.
    // Downloads instead enrich the historical checkpoint for portable replay.
    : withOptionalSidecarEvidence(envelope(reconcileOptionalSidecarEvidence(state, current)), { dataDir: directory });
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
    if (frozen) return Promise.reject(Object.assign(new Error('The picker is updating.'), { status: 503, code: 'PICKER_UPDATING' }));
    const result = queue.then(() => withStoreWrite(directory, () => withCatalogue(() => withPluginEvidence(directory, work))));
    // The caller owns the response; sequencing needs only its settlement.
    queue = releaseCommandResponses ? result.then(() => {}, () => {}) : result.catch(() => {});
    return result;
  }
  // Authoritative state publishes first. Frozen-readable review lowering is
  // best effort, under the shared reentrant evidence mutex.
  async function publishItemState(state, bytes, operation, details = {}) {
    return withPluginItemEvidenceWrite(directory, async () => {
      let staged;
      try { staged = await stagePluginItemDecisions(directory, state.provenance?.pluginItemEvidence,
        { memberIds: state.members.map(member => member.id) }); }
      catch { warnOptionalPluginData('item review lowering preparation'); }
      try {
        const result = await writeState(bytes, { onPostPublishSyncError: 'warn', beforeRename: async () => {
          await beforeCommit?.({ operation, state: details.summary ?? copyState(state), ...(details.digest ? { digest: details.digest } : {}) });
          await publishDependencies(details.dependencies ?? []);
        } });
        try { await staged?.publish(); } catch { warnOptionalPluginData('item review lowering'); }
        return result;
      } finally {
        try { await staged?.cancel(); } catch { warnOptionalPluginData('item review lowering cleanup'); }
      }
    });
  }
  async function persist(...args) {
    return withPublicationPreparation(() => persistState(...args));
  }
  async function withPublicationPreparation(work) {
    // Prepare gameplay dependencies before the authoritative rename. The
    // synced state temporary still precedes beforeCommit, preserving its crash
    // seam. Retained backups and quarantine diagnostics remain durable even
    // when that hook refuses the state replacement.
    const pending = { dependencies: [], references: [], quarantine: receiptQuarantine, published: false };
    pendingPublication = pending;
    try { return await work(pending); }
    finally {
      pendingPublication = undefined;
      if (!pending.published) {
        for (const value of pending.references) staticReferences.delete(value);
        receiptQuarantine = pending.quarantine;
      }
    }
  }
  async function persistState(next, operation, archived, serializedResult = false, baseline, omitUnchanged = false, view, { claimOnly = false, cleanup = false, backupLabel, receipt, noteEdit = false, reuseNoteProjection = false, currency = pluginCurrency, skipSnapshot = false } = {}) {
    // Every gameplay publication retains current atomic decisions and folds
    // usable optional input under the same mutex as legacy sidecar writers.
    next = await publicationState(next, operation === 'replace' ? undefined : current);
    if (operation === 'replace') currency = currencyAfterRestore(currency, next);
    const observed = inheritStateMetadata(next, cleanup || progressQuestPoints === undefined ? next : captureProgressSnapshot(next, { questPoints: progressQuestPoints, at: timestamp() }));
    const validated = cleanup ? observed : await compactHistory(observed, archived);
    const previousCoordination = operation === 'replace' ? { schemaVersion: 1, invalidatedUndo: {} }
      : coordination.get(next) ?? coordinationOf(current);
    if (claimOnly || coordination.has(next) || coordination.has(current)) coordination.set(validated,
      { ...previousCoordination, lastNonClaimRevision: claimOnly ? previousCoordination.lastNonClaimRevision : validated.revision });
    // Preserve the old durable state before replacing its revision.
    if (!cleanup) await retainBackup(current, operation, backupLabel);
    const { ledger: nextReceipts, result: receiptResult } = commitActionReceipt(receipts, receipt, validated);
    const diskDocument = await serializedDiskState(validated, nextReceipts, currency);
    const publication = await publishItemState(validated, diskDocument, operation,
      { dependencies: pendingPublication.dependencies });
    pendingPublication.published = true;
    const ownershipChanged = JSON.stringify(current.members.map(member => [member.id, member.unlocked]))
      !== JSON.stringify(validated.members.map(member => [member.id, member.unlocked]));
    const choicesChanged = JSON.stringify(current.members.map(member => [member.id, member.selected, member.pendingRoll]))
      !== JSON.stringify(validated.members.map(member => [member.id, member.selected, member.pendingRoll]));
    // A built-in note edit changes no saved task references. Reuse only the
    // cached catalogue and identity fields; display fields come from durable state.
    const previousPlay = reuseNoteProjection && validated.tasks === current.tasks
      && validated.identityRegistry === current.identityRegistry && playProjections.get(current);
    if (previousPlay) {
      const { provenance, identityRegistry, progressSnapshots, ...display } = validated;
      playProjections.set(validated, { ...previousPlay, state: { ...display,
        tasks: previousPlay.state.tasks, identityRegistry: previousPlay.state.identityRegistry } });
    }
    const previous = current;
    current = validated;
    releaseObsoleteResponses(previous);
    receipts = nextReceipts;
    pluginCurrency = currency;
    currentDiskSerialized = diskDocument;
    await ownedStorage?.crash?.('memory-published');
    reportDurability(publication);
    if (!cleanup && ++maintenanceWrites >= 50 && !frozen && !closing) { maintenanceWrites = 0; void enqueueMaintenance(maintainRetention); }
    for (const listener of listeners) {
      try { listener({ revision: current.revision, ...(operation === 'replace' ? { restored: true } : {}), ...(ownershipChanged ? { ownershipChanged: true } : {}), ...(noteEdit ? { noteEdit: true } : {}), ...(choicesChanged ? { choicesChanged: true } : {}) }); } catch { /* A subscriber cannot roll back a committed write. */ }
    }
    // Let already-requested task lanes receive the committed snapshot before
    // preparing the response pools.
    if (ownershipChanged) await new Promise(resolve => setImmediate(resolve));
    if (skipSnapshot) return;
    return cleanup ? structuredClone({ revision: current.revision, taskClaims: current.taskClaims, history: current.history })
      : serializedResult ? { ...await preparedCommandSnapshot(baseline, omitUnchanged, view), ...(receiptResult ? { receipt: receiptResult } : {}) } : cloneCurrent();
  }
  const commandReceipt = (command, actor, requestId, requestAck) => inspectActionReceipt(receipts, command, actor, requestId, requestAck);
  function runCommand(command, expectedRevision, serializedResult = false, omitUnchanged = false, actor, view, requestId, requestAck, pluginHandled, itemReview) {
    const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
    const suppression = pluginHandled === undefined ? undefined : structuredClone(pluginHandled);
    const work = async () => {
      const receipt = command && commandReceipt(command, attribution, requestId, requestAck);
      if (receipt) {
        if (receipt.replay) return serializedResult ? { ...await preparedCommandSnapshot(undefined, false, view), receipt: receipt.result } : cloneCurrent();
      }
      checkRevision(expectedRevision);
      const baseline = current;
      const reviewedItems = itemReview && dismissPluginItemEvidence(await exportPluginItemEvidence(directory,
        id => current.members.some(member => member.id === id) ? id : undefined, current.provenance?.pluginItemEvidence),
      itemReview.memberId, itemReview.taskIds, itemReview.unmappedIds, timestamp(), itemReview.taskWorlds);
      if (itemReview && !command) return persist(inheritStateMetadata(current, retainPluginItemEvidence(current, reviewedItems)), 'plugin-item-review', undefined,
        false, baseline, false, undefined, { cleanup: true });
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
      let precomputedPool;
      if (command.type === 'roll' && computeRollPool && [1, 2].includes(command.count)
        && input.state.members.some(member => member.id === command.memberId && !member.pendingRoll.length)) {
        await computeRollPool(input.state, command.memberId);
        if (!ownedStorage) precomputedPool = rollPoolCache.prepare(input.state, command.memberId);
      }
      const next = applyStoredCommand(input.state, command, { expectedRevision, world, registry, precomputedPool,
        random: ['go-members', 'setup-start'].includes(command.type) ? random ?? (() => randomBytes(6).readUIntBE(0, 6) / 2 ** 48) : random,
        now, taskCatalogue, actor: attribution, membersStartBanks, xpChoiceCatalogue });
      inheritStateMetadata(input.state, next);
      // Undo validates a saved inverse, runs preparation and observes progress.
      // Separate those stages so they cannot share one long HTTP-thread turn.
      if (command.type === 'undo') await new Promise(resolve => setImmediate(resolve));
      let ready = withPluginHandled(await prepared(next, 'command'), command, suppression);
      if (ready.revision !== next.revision) throw new TypeError('prepareState must preserve the authoritative revision.');
      if (reviewedItems) ready = inheritStateMetadata(ready, retainPluginItemEvidence(ready, mergePluginItemEvidence(ready.provenance?.pluginItemEvidence, reviewedItems)));
      if (command.type === 'undo') await new Promise(resolve => setImmediate(resolve));
      // Caller hooks can change more than the command requested. Only exact
      // authored coordination output keeps the conservative conflict proof.
      if (claimOnly && ready !== next) claimOnly = sameState(ready, next);
      if (command.type === 'undo' && !['claim-task', 'clear-task-claim', 'prune-task-claims'].includes(undoTarget?.type)) {
        const removed = Object.keys(baseline.taskClaims ?? {}).filter(id => !Object.hasOwn(ready.taskClaims ?? {}, id));
        if (removed.length) {
          const previous = coordinationOf(current), invalidatedUndo = { ...previous.invalidatedUndo };
          for (const id of removed) invalidatedUndo[id] = baseline.revision;
          coordination.set(ready, { ...previous, invalidatedUndo });
        }
      }
      return persist(ready, 'command', input.archived, serializedResult, baseline, omitUnchanged, view, { claimOnly,
        receipt, noteEdit: command.type === 'set-note', reuseNoteProjection: command.type === 'set-note' && ready === next,
        currency: currencyAfterCommand(pluginCurrency, command, input.state, ready),
        ...(command.type === 'go-members' ? { backupLabel: 'Before going members' } : {}) });
    };
    return enqueue(() => itemReview ? withPluginItemEvidenceWrite(directory, work) : work());
  }
  async function replacementState(document, base, actor) {
    if (isMainThread && !prepareState && !migrateState) return runImportJob({ kind: 'replacement', dataDir: directory, document, actor,
      baseRevision: base.revision, rules: registryMetadata(registry), options: { now: timestamp() },
      ...(ownedStorage ? { ownedFormat2: ownedStorage.readerOptions } : {}) });
    let incoming = document?.format || typeof document === 'string' ? importBackup(document, registry, { owned: importReader })
      : importReader ? validateOwnedState(document, registry) : validateState(document, registry);
    incoming = materializeOptionalSidecarEvidence(incoming, (typeof document === 'string' ? JSON.parse(document) : document)?.optionalSidecarEvidence);
    base = materializeOptionalSidecarEvidence(base, await captureOptionalSidecarEvidence(base, { dataDir: directory }));
    // Keep separate bounded validation/migration phases off the same event-loop turn.
    await new Promise(resolve => setImmediate(resolve));
    const ready = await prepared(incoming, 'replace');
    await new Promise(resolve => setImmediate(resolve));
    const revision = base.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new RangeError('State revision limit reached.');
    const previous = (await hydrateHistory(base, undefined, true)).state;
    const completeIncoming = (await hydrateHistory(ready, undefined, true)).state;
    const preceding = new Map(), precedingEvidence = [];
    for (const event of [...(previous.provenance?.restore?.previousHistory ?? []), ...previous.history]) {
      if (Number.isSafeInteger(event?.revision)) preceding.set(event.revision, event);
      else precedingEvidence.push(event);
    }
    const previousHistory = [...precedingEvidence, ...[...preceding.values()].sort((a, b) => a.revision - b.revision)];
    const evidence = reconcileOptionalSidecarEvidence(ready, base).provenance;
    const pluginAutoHandled = evidence?.pluginAutoHandled;
    ready.provenance = { ...(ready.provenance?.dataset ? { dataset: ready.provenance.dataset } : {}),
      ...(evidence?.optionalSidecarEvidence ? { optionalSidecarEvidence: evidence.optionalSidecarEvidence } : {}),
      ...(evidence?.pluginItemEvidence ? { pluginItemEvidence: evidence.pluginItemEvidence, pluginItemEvidenceReconciled: 1 } : {}),
      ...(pluginAutoHandled ? { pluginAutoHandled } : {}), restore: { incomingRevision: ready.revision, incomingHistory: completeIncoming.history, previousHistory,
      ...(completeIncoming.provenance !== undefined ? { incomingProvenance: completeIncoming.provenance } : {}) } };
    ready.revision = revision;
    // A replacement establishes a new undo boundary. Earlier snapshots may
    // describe another roster and must never rewrite the restored gameplay.
    ready.history = [{ id: `revision-${revision}`, revision, type: 'restore', at: timestamp(), ...(actor ? { actor } : {}) }];
    // Prepare the same additive ownership annotations that publication retains.
    // Preview must describe the exact replacement, including portable metadata.
    currencyAfterRestore(undefined, ready);
    return inheritStateMetadata(ready, importReader ? validateOwnedState(ready, registry) : validateState(ready, registry));
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
    const taskLabel = ownedStorage ? id => taskNames.get(id) ?? identityValue(captured.identityRegistry?.entries, id)?.label ?? labels.taskLabel?.(id) ?? id
      : id => taskNames.get(id) ?? captured.identityRegistry?.entries?.[id]?.label ?? labels.taskLabel?.(id) ?? id;
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
    async prepareImportPublication(next, operation, { validateBackup, currencySource } = {}) {
      if (!importReader) throw new TypeError('Import publication must be prepared in the isolated reader.');
      // All transfer routes publish the union with the exact destination
      // checkpoint. applyTransfer rejects a ticket if that checkpoint changes.
      const captured = await captureOptionalSidecarEvidence(current, { dataDir: directory });
      next = reconcileOptionalSidecarEvidence(next, materializeOptionalSidecarEvidence(current, captured));
      next = await publicationState(next);
      const command = next.history.at(-1)?.command;
      const restoredMemberIds = operation === 'command' && command?.type === 'replace-member' ? [command.memberId] : undefined;
      importDependencies = [];
      const observed = inheritStateMetadata(next, progressQuestPoints === undefined ? next : captureProgressSnapshot(next, { questPoints: progressQuestPoints, at: timestamp() }));
      // Export observes snapshots and hydrated History, not the compact disk
      // representation. Validate that complete envelope before preparing writes.
      if (validateBackup) await validateBackup(await withOptionalSidecarEvidence(envelope(observed.provenance?.historyArchive?.length
        ? (await hydrateHistory(observed)).state : observed), { dataDir: directory }));
      const state = await compactHistory(observed);
      if (coordination.has(current)) coordination.set(state, { ...(operation === 'replace' ? { schemaVersion: 1, invalidatedUndo: {} } : coordinationOf(current)), lastNonClaimRevision: state.revision });
      const currency = operation === 'replace' ? currencyAfterRestore(pluginCurrency, state)
        : currencyAfterCommand(pluginCurrency, state.history.at(-1)?.command ?? {}, current, state, currencySource);
      const disk = Buffer.from(await serializedDiskState(state, receipts, currency));
      const retained = appendOptionalSidecarEvidence(currentDiskSerialized, captured);
      const backup = await gzipAsync(operation === 'replace' ? pinSerializedDocument(retained) : retained, { level: constants.Z_BEST_SPEED });
      const fields = [...reusableFields].filter(key => state[key] && typeof state[key] === 'object').map(key => ({ key, json: staticReferences.has(state[key]) ? undefined : serializedFields.get(state[key]), reference: staticReferences.get(state[key]) }));
      const summary = boundedOutput({ revision: state.revision, members: rosterOutput(state.members), provenance: { dataset: state.provenance?.dataset } });
      // Large durable fields already have a verified digest. Reuse it when the
      // gameplay projection is identical, avoiding another large hash pass.
      const preparedDigests = Object.fromEntries(fields.filter(({ key, reference }) => reference
        && canReuseGameplayFieldBytes(key, state[key]))
        .map(({ key, reference }) => [key, reference.sha256]));
      fingerprint.seedStatic(state, preparedDigests);
      taskReuseFingerprint.seedStatic(state, preparedDigests);
      seedResidentFingerprint(state);
      return { state: ownedStorage ? copyState(state) : state, disk, backup, dependencies: importDependencies, fields, summary, restoredMemberIds, digest: createHash('sha256').update(disk).digest('hex'),
        fingerprints: { gameplay: fingerprint.exportStatic(state, serializedFields), tasks: taskReuseFingerprint.exportStatic(state, serializedFields) },
        coordination: coordination.get(state), receipts, pluginCurrency: currency,
        ownershipChanged: !isDeepStrictEqual(current.members.map(m => [m.id, m.unlocked]), state.members.map(m => [m.id, m.unlocked])),
        choicesChanged: !isDeepStrictEqual(current.members.map(m => [m.id, m.selected, m.pendingRoll]), state.members.map(m => [m.id, m.selected, m.pendingRoll])) };
    },
    getState: cloneCurrent,
    // Internal read-only consumers share the immutable catalogue. Public flat
    // snapshots remain an explicit compatibility/materialization boundary.
    getReadState: () => ownedStorage ? cloneResidentState(current) : cloneCurrent(),
    getPluginItemEvidence: () => structuredClone(current.provenance?.pluginItemEvidence),
    getPluginTestingMode: player => pluginTestingMode(current, player),
    getTaskClaimState() {
      const { schemaVersion, revision, rules, members, tasks, identityRegistry, taskClaims } = playProjection(current).state;
      // Select before cloning: History and private retained evidence can be large.
      return structuredClone({ schemaVersion, revision, rules, members, tasks, identityRegistry,
        ...(taskClaims !== undefined ? { taskClaims } : {}) });
    },
    // Stable per-revision views: an archive fill replaces the view on a later read.
    getTaskCompletionHistory(memberId, { since = Date.parse(timestamp()) - 7 * 24 * 60 * 60 * 1000 } = {}) {
      const cache = completionHistoryCache(since);
      if (!cache.histories.has(memberId)) cache.histories.set(memberId, Object.freeze([...cache.events.values()]
        .filter(event => event.command.memberId === memberId || event.command.members?.some(row => row.memberId === memberId))
        .sort((a, b) => a.revision - b.revision)));
      return cache.histories.get(memberId);
    },
    getTaskClaimSnapshot: () => ({ revision: current.revision, taskClaims: structuredClone(current.taskClaims ?? {}) }),
    getRules: () => ({ ...current.rules }),
    getStateSnapshot: ({ view } = {}) => computeRollPool ? preparedCommandSnapshot(undefined, false, view) : commandSnapshot(undefined, false, view),
    getCalculationState: () => capturedCalculation().residentState ?? capturedCalculation().state,
    getCalculationSnapshot: capturedCalculation,
    // Advisory clients may reuse an existing pool, never trigger travel/task work.
    peekRollPool(memberId) { refreshSnapshots(); return fullPools?.[memberId] ?? null; },
    // Computes the pool when no page has asked yet; memoized per state like the page's own pools.
    rollPool(memberId) {
      if (computeRollPool) { void prepareRollPools().catch(() => {}); return store.peekRollPool(memberId); }
      return rollPools()[memberId] ?? null;
    },
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
    getInfo: () => ({ revision: current.revision, durable: durabilityWarnings === 0,
      durabilityWarnings, ...(lastDurabilityWarningAt ? { lastDurabilityWarningAt } : {}), schemaVersion: current.schemaVersion,
      retention: { policy, activeHistoryEntries: current.history.length, historyArchives: current.provenance?.historyArchive?.length ?? 0,
        ...(retentionFailure ? { failure: retentionFailure } : {}) } }),
    prepareSnapshot: () => enqueueMaintenance(maintainRetention),
    backup: () => isMainThread ? enqueueMaintenance(() => runImportJob({ kind: 'backup', dataDir: directory,
      rules: registryMetadata(registry), retention: policy, completionCodec,
      ...(ownedStorage ? { ownedFormat2: ownedStorage.readerOptions } : {}) }), { backupRead: true })
      : hydrateHistory(current).then(({ state }) => withOptionalSidecarEvidence(envelope(state), { dataDir: directory })),
    exportBackup: ({ dataset, gzip = false, encoding } = {}) => enqueueMaintenance(() => runImportJob({ kind: 'export', dataDir: directory,
      exportDataset: dataset, gzip, encoding, rules: registryMetadata(registry), retention: policy, completionCodec,
      ...(ownedStorage ? { ownedFormat2: ownedStorage.readerOptions } : {}) }), { backupRead: true }),
    async listBackups() {
      return enqueueMaintenance(async () => {
        const byId = new Map([...(await retainedArchiveIndex()).values()].map(item => [item.metadata.id, { ...item.metadata }]));
        for (const backup of await standaloneBackups()) byId.set(backup.id, backup);
        const backups = [...byId.values()].map(backup => ({ ...backup }));
        const revisions = new Set(backups.map(backup => backup.revision)), events = new Map();
        await visitHistory(current, event => { if (revisions.has(event.revision)) events.set(event.revision, historyRecord(event)); });
        for (const backup of backups) backup.event = events.get(backup.revision) ?? null;
        return backups.sort((a, b) => b.revision - a.revision || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
      }, { backupRead: true });
    },
    async readBackup(id, { forImport = false } = {}) {
      if (typeof id !== 'string' || !BACKUP_ID.test(id)) throw new TypeError('Invalid retained backup ID.');
      return enqueueMaintenance(async () => {
        let file;
        try {
          const base = await realpath(backupsDir);
          file = await realpath(path.join(backupsDir, id));
          if (path.dirname(file) !== base) throw new TypeError('Invalid retained backup location.');
        } catch (error) {
          if (error.code === 'ENOENT') {
            const archived = (await retainedArchiveIndex(forImport)).get(id);
            if (!archived) throw Object.assign(new Error('Retained backup not found.'), { code: 'ENOENT' });
            const pack = await readDocument(path.join(archivesDir, archived.packId), true, forImport);
            const snapshot = pack.snapshots.find(item => item.id === id);
            if (!snapshot) throw new TypeError('Retained backup archive is missing its snapshot.');
            const state = await importStoredBackup(snapshot.document, false, forImport);
            if (state.revision !== Number(BACKUP_ID.exec(id)[1])) throw new TypeError('Retained backup revision does not match its ID.');
            return portableRetainedBackup((await hydrateHistory(state, undefined, forImport)).state, forImport);
          }
          throw error;
        }
        const bytes = await readFile(file);
        const decoded = id.endsWith('.gz') ? await decodeStoredBytes(bytes, forImport) : bytes;
        const document = forImport ? await importDocument(decoded) : decoded.toString('utf8');
        const state = await importStoredBackup(document, false, forImport);
        if (state.revision !== Number(BACKUP_ID.exec(id)[1])) throw new TypeError('Retained backup revision does not match its ID.');
        return portableRetainedBackup((await hydrateHistory(state, undefined, forImport)).state, forImport);
      }, { backupRead: true });
    },
    getAccessToken: () => token,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isPluginHandled: (player, kind, id) => hasPluginHandled(current, player, kind, id),
    setPluginTestingMode(player, enabled, expectedRevision) {
      return enqueue(async () => {
        checkRevision(expectedRevision);
        if (!current.members.some(member => member.id === player) || typeof enabled !== 'boolean') throw new TypeError('Choose a player and turn testing mode on or off.');
        const next = withPluginTestingMode(current, player, enabled);
        if (next === current) return;
        return persist(inheritStateMetadata(current, next), 'plugin-settings', undefined, false, current, false, undefined, { cleanup: true });
      });
    },
    command(command, expectedRevision, { actor, requestId, requestAck, pluginHandled } = {}) {
      return runCommand(command, expectedRevision, false, false, actor, undefined, requestId, requestAck, pluginHandled);
    },
    commitPluginReview({ memberId, taskIds, taskWorlds, unmappedIds, command }, expectedRevision, { actor } = {}) {
      if (!current.members.some(member => member.id === memberId)
        || command && (command.type !== 'apply-game-progress' || command.memberId !== memberId)
        || !Array.isArray(taskIds) || taskIds.length > 100 || taskIds.some(id => typeof id !== 'string' || id.length > 200)
        || taskWorlds !== undefined && (!Array.isArray(taskWorlds) || taskWorlds.length !== taskIds.length || taskWorlds.some(world => !['live', 'beta', 'unknown'].includes(world)))
        || !Array.isArray(unmappedIds) || unmappedIds.length > 30 || unmappedIds.some(id => !Number.isSafeInteger(id) || id < 0 || id > 1000000)) {
        return Promise.reject(new TypeError('Invalid plugin item review.'));
      }
      return runCommand(command, expectedRevision, false, false, actor, undefined, undefined, undefined,
        undefined, { memberId, taskIds: [...taskIds], taskWorlds: taskWorlds && [...taskWorlds], unmappedIds: [...unmappedIds] });
    },
    observePluginCurrency(observation) {
      return enqueue(async () => {
        const input = current;
        const result = observePluginCurrency(input, pluginCurrency, observation,
          { now: timestamp, epoch: currencyEpoch, world, registry, taskCatalogue, membersStartBanks, xpChoiceCatalogue });
        const ready = result.state === input ? current : await prepared(inheritStateMetadata(current, result.state), 'command');
        if (ready.revision !== result.state.revision) throw new TypeError('prepareState must preserve the authoritative revision.');
        await persist(ready, 'plugin-currency', undefined, false, current, false, undefined,
          { cleanup: ready === current, currency: result.metadata, skipSnapshot: !!ownedStorage });
        return { currencyRetry: result.retry };
      });
    },
    commandSerialized(command, expectedRevision, { omitUnchanged = false, actor, view, requestId, requestAck } = {}) { return runCommand(command, expectedRevision, true, omitUnchanged, actor, view, requestId, requestAck); },
    async replayCommandSerialized(command, requestId, { actor, view, requestAck } = {}) {
      const receipt = commandReceipt(command, actor, requestId, requestAck);
      return receipt?.replay ? { ...await preparedCommandSnapshot(undefined, false, view), receipt: receipt.result } : undefined;
    },
    openActionSession(clientId, { actor } = {}) {
      return enqueue(async () => {
        const result = openActionSession(receipts, clientId, actor);
        if (result.ledger !== receipts) {
          const next = await publicationState(current, current);
          const bytes = await serializedDiskState(next, result.ledger);
          const publication = await writeState(bytes, { onPostPublishSyncError: 'warn' });
          const previous = current;
          current = next; receipts = result.ledger; currentDiskSerialized = bytes;
          releaseObsoleteResponses(previous);
          reportDurability(publication);
        }
        return result.session;
      });
    },
    acknowledgeActionSession(clientId, input, { actor } = {}) {
      return enqueue(async () => {
        const result = acknowledgeActionSession(receipts, clientId, input, actor);
        if (result.ledger !== receipts) {
          const record = acknowledgementFor(input.slot, receipts.slots[input.slot]);
          const next = acknowledgements.filter(row => row.slot !== input.slot).concat(record);
          // Keep the action+outcome atomic in state.json. This small, bounded
          // file confirms only its exact durable receipt; the next gameplay
          // write naturally embeds the resulting watermark without extra I/O.
          const publication = await atomicWrite(acknowledgementsFile, `${JSON.stringify({ schemaVersion: 1, entries: next })}\n`, { onPostPublishSyncError: 'warn' });
          acknowledgements = next; receipts = result.ledger;
          reportDurability(publication);
        }
        return result.session;
      });
    },
    activate(checkpoint) {
      if (activationPending) return Promise.reject(new Error('Standby activation is already running.'));
      const activation = (async () => {
        if (!readOnly || closing) throw new Error('Only an open standby can acquire writer ownership.');
        if (!checkpoint || checkpoint.schemaVersion !== SCHEMA_VERSION) throw new Error('A compatible handover checkpoint is required.');
        if (ownedStorage) await readOwnedStartupDocument();
        // Reuse the warmed world, worker and verified immutable static fields.
        // Acquire the ORIGINAL locks before reading the final authoritative save.
        let phaseStarted = performance.now();
        const guard = await acquireProcessGuard(directory);
        reportActivationTiming(onActivationTiming, 'store.guard', phaseStarted);
        let fileLock;
        try {
          phaseStarted = performance.now();
          fileLock = await acquireLock(directory, beforeLockRecovery);
          reportActivationTiming(onActivationTiming, 'store.ownerLock', phaseStarted);
          phaseStarted = performance.now();
          const bytes = await readFile(stateFile), document = parseSavedDocument(bytes);
          if (createHash('sha256').update(bytes).digest('hex') !== checkpoint.sha256 || document?.state?.revision !== checkpoint.revision) throw new Error('Handover checkpoint changed.');
          if (ownedStorage) await selectOwnedStartupBase(document);
          const latest = await importStoredBackup(document, true);
          const metadata = receiptMetadata(document.actionReceipts, latest.revision);
          const acknowledged = await acknowledgedReceipts(metadata.ledger);
          reportActivationTiming(onActivationTiming, 'store.readValidate', phaseStarted);
          phaseStarted = performance.now();
          const ready = await prepareLoadedState(latest);
          if (!sameState(ready, latest)) throw Object.assign(new Error('Live swap refuses a save migration; use a reviewed offline migration.'), { code: 'LIVE_SWAP_MIGRATION_REQUIRED' });
          reportActivationTiming(onActivationTiming, 'store.prepare', phaseStarted);
          const checkShutdown = () => {
            if (closing) throw new Error('Standby activation was cancelled by shutdown.');
          };
          checkShutdown();
          if (ownedStorage) {
            await ownedStorage.activate(document.storage?.base, checkShutdown);
            checkShutdown();
          }
          const previous = current;
          current = latest; receipts = acknowledged.ledger; acknowledgements = acknowledged.records;
          releaseObsoleteResponses(previous);
          pluginCurrency = document.pluginCurrency === undefined ? undefined : loadPluginCurrency(document.pluginCurrency);
          receiptQuarantine = metadata.quarantine; currentDiskSerialized = bytes;
          releaseGuard = guard; releaseFileLock = fileLock;
          readOnly = false; frozen = false; liveSwapStrict = true;
          unregisterArtifacts ??= ownedStorage?.registerArtifacts();
          phaseStarted = performance.now();
          for (const listener of listeners) { try { listener({ revision: current.revision, ownershipChanged: true }); } catch {} }
          reportActivationTiming(onActivationTiming, 'store.listeners', phaseStarted);
          return { revision: current.revision, schemaVersion: SCHEMA_VERSION };
        } catch (error) {
          try { await fileLock?.(); } finally { await guard(); }
          throw error;
        } finally { standbyStaticFields.clear(); }
      })();
      activationPending = activation;
      void activation.finally(() => { if (activationPending === activation) activationPending = undefined; }).catch(() => {});
      return activation;
    },
    async freeze({ maxSaveBytes } = {}) {
      if (maxSaveBytes !== undefined && (!Number.isSafeInteger(maxSaveBytes) || maxSaveBytes <= 0)) throw new TypeError('maxSaveBytes must be a positive safe integer.');
      if (maintenancePending || freezePending) throw Object.assign(new Error('Save maintenance or a freeze is still running. Please try again in a moment.'), { status: 503, code: 'LIVE_SWAP_BUSY' });
      const wasFrozen = frozen;
      freezePending = true;
      frozen = true;
      try {
        await queue; await maintenanceQueue;
        if (maxSaveBytes !== undefined && Buffer.byteLength(currentDiskSerialized) > maxSaveBytes) throw Object.assign(new Error('The saved state exceeds the live update size limit. Please retry with a compatible release budget.'), { status: 503, code: 'LIVE_SWAP_BUSY' });
        // These are the exact bytes of the last completed, synced replacement.
        // The controller checks the physical file against this checkpoint before
        // unlock; rereading it here adds allocation and I/O to the frozen window.
        return { revision: current.revision, sha256: createHash('sha256').update(currentDiskSerialized).digest('hex'), schemaVersion: SCHEMA_VERSION };
      } catch (error) { frozen = wasFrozen; throw error; }
      finally { freezePending = false; }
    },
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
        const next = inheritStateMetadata(current, { ...current, revision: current.revision + 1, taskClaims: { ...current.taskClaims } });
        for (const id of taskIds) delete next.taskClaims[id];
        cancelTaskClaimUndo(next, taskIds);
        const previous = coordinationOf(current), invalidatedUndo = { ...previous.invalidatedUndo };
        for (const id of taskIds) invalidatedUndo[id] = current.revision;
        coordination.set(next, { ...previous, invalidatedUndo });
        return persist(next, 'claim-cleanup', undefined, false, undefined, false, undefined, { claimOnly: true, cleanup: true });
      });
    },
    async prepareTransfer(input, options) {
      const revision = current.revision;
      const checkpoint = currentDiskSerialized;
      const result = await runImportJob({ kind: 'transfer', dataDir: directory, input, options: { ...options, now: timestamp() },
        rules: registryMetadata(registry), baseRevision: revision, retention: policy, progressQuestPoints, completionCodec,
        ...(ownedStorage ? { ownedFormat2: ownedStorage.readerOptions } : {}) }, { budget: options.importBudget, userId: options.importUserId,
        prepareHook: prepareImportState && ((state, context) => prepareImportState(state, { ...context, world, registry })) });
      const ticket = {};
      importTickets.set(ticket, { publication: result.publication, operation: result.operation, revision, checkpoint });
      delete result.publication;
      return { ...result, ticket };
    },
    applyTransfer(ticket, expectedRevision) {
      return enqueue(() => withPluginEvidence(directory, async () => {
        const prepared = importTickets.get(ticket);
        importTickets.delete(ticket);
        if (!prepared?.publication) throw new TypeError('A validated import result is required.');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision must be a nonnegative safe integer.');
        if (expectedRevision !== current.revision || prepared.revision !== current.revision || prepared.checkpoint !== currentDiskSerialized) {
          throw Object.assign(new RevisionConflict({ revision: current.revision }), { importConflict: true });
        }
        const start = performance.now();
        const publication = prepared.publication;
        const dependencies = publication.dependencies.map(dependency => {
          const target = path.resolve(directory, dependency.file);
          if (!target.startsWith(directory + path.sep)) throw new TypeError('Invalid import dependency.');
          return { file: target, bytes: dependency.bytes };
        });
        const backupFile = path.join(backupsDir, `${String(current.revision).padStart(16, '0')}-${randomBytes(8).toString('hex')}.json.gz`);
        dependencies.push({ file: backupFile, bytes: publication.backup, at: new Date(timestamp()) });
        const diagnostic = dependencies.filter(row => path.dirname(row.file) === path.join(directory, 'receipt-quarantine') || row.file === backupFile);
        await publishDependencies(diagnostic);
        const published = await publishItemState(publication.state, publication.disk, prepared.operation,
          { ...publication, dependencies: dependencies.filter(row => !diagnostic.includes(row)) });
        const previous = current;
        current = ownedStorage ? shareResidentCatalogue(copyState(publication.state), ownedStorage.base) : publication.state;
        releaseObsoleteResponses(previous);
        currentDiskSerialized = publication.disk;
        receipts = publication.receipts;
        pluginCurrency = publication.pluginCurrency;
        receiptQuarantine = undefined;
        if (publication.coordination) coordination.set(current, publication.coordination);
        for (const { key, json, reference } of publication.fields) {
          if (json !== undefined) serializedFields.set(current[key], json);
          if (reference) staticReferences.set(current[key], reference);
        }
        // These digests came from this ticket's exact worker-owned publication,
        // never from upload metadata. Seed before synchronous save subscribers.
        fingerprint.seedStatic(current, publication.fingerprints.gameplay);
        taskReuseFingerprint.seedStatic(current, publication.fingerprints.tasks);
        reportDurability(published);
        for (const listener of listeners) {
          try { listener({ revision: current.revision, restored: true, restoredMemberIds: publication.restoredMemberIds, ...(publication.ownershipChanged ? { ownershipChanged: true } : {}), ...(publication.choicesChanged ? { choicesChanged: true } : {}) }); } catch { /* Already committed. */ }
        }
        return { state: ownedStorage ? copyState(current) : current, reply: publication.reply, applyMs: performance.now() - start };
      }));
    },
    replace(document, expectedRevision, { actor } = {}) {
      const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
      return enqueue(() => withPluginEvidence(directory, async () => {
        checkRevision(expectedRevision);
        const ready = await replacementState(document, inheritStateMetadata(current, cloneCurrent()), attribution);
        return persist(ready, 'replace');
      }));
    },
    async previewReplacement(document, { actor } = {}) {
      const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
      const base = inheritStateMetadata(current, cloneCurrent());
      return withPluginItemEvidenceWrite(directory, async () => {
        const state = await replacementState(document, base, attribution);
        // Restore comparison and worker transport require detached flat JSON.
        return ownedStorage ? { current: copyState(base), state: copyState(state) } : { current: base, state };
      });
    },
    close({ beforeUnlock } = {}) {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => { await activationPending?.catch(() => {}); await queue; await Promise.allSettled(taskCompletionReads); if (!readOnly && !frozen && !liveSwapStrict) await enqueueMaintenance(maintainRetention, { allowClosing: true }); else await maintenanceQueue; await (typeof beforeUnlock === 'function' ? beforeUnlock() : beforeUnlock); listeners.clear(); await releaseLock(); })();
      return closePromise;
    },
  };
  return store;
}
