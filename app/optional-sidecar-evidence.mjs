import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { mergePluginHandledRecords, reconcilePluginHandled } from './storage/plugin-handled.mjs';
import { validRosterSourceId, validRosterDestinationId } from './import-output.mjs';
import { legacyPluginHandledFiles, decodeLegacyPluginHandled } from './storage/plugin-handled-sidecars.mjs';
import { pluginItemFiles, capturePluginItemFiles, exportCapturedPluginItemEvidence } from './plugin-items.mjs';
import { mergePluginItemEvidence, portablePluginItemEvidence, reconcilePluginItemEvidence } from './core/plugin-item-evidence.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validEvidenceTypeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const invalid = () => { throw new TypeError('Invalid optional sidecar evidence.'); };

// Code-owned registrations only. A type may declare capture-only filenames,
// validate/merge a player's records, and materialize them into gameplay state.
// Imported payloads never select a filesystem path or cause a sidecar write.
export const optionalSidecarEvidenceTypes = Object.freeze({
  pluginReplaySuppression: {
    files: legacyPluginHandledFiles,
    capture: ({ state, files, unavailable, retainCommittedReplay }) => decodeLegacyPluginHandled(state, files,
      retainCommittedReplay ? new Map([...unavailable].filter(([, code]) => !['EACCES', 'EPERM', 'EISDIR', 'EBUSY'].includes(code))) : unavailable).provenance?.pluginAutoHandled,
    fromState: state => state.provenance?.pluginAutoHandled,
    mergePlayer: (...records) => mergePluginHandledRecords(...records),
    materialize: (state, players) => reconcilePluginHandled(state, { provenance: { pluginAutoHandled: players } }),
  },
  pluginItems: {
    files: pluginItemFiles,
    // The dedicated generation-marked carrier is authoritative, including
    // reviewed fact removal. Do not keep a second stale fact copy in the capsule.
    capsule: false,
    // Preserve #133's generation-coherent capture, including the exact pinned
    // inherited state for worker exports. A store-owned publication already
    // supplies that authoritative state and holds the shared evidence mutex.
    captureFiles: async ({ dataDir, storeOwned, retainCommittedReplay }) => new Map(Object.entries(
      await capturePluginItemFiles(dataDir, { includeState: !storeOwned, retainCommittedReplay, allowUnavailableJournals: storeOwned }))),
    capture: async ({ state, dataDir, files }) => {
      const members = new Set(state.members.map(member => member.id));
      const evidence = await exportCapturedPluginItemEvidence(dataDir, Object.fromEntries(files),
        id => members.has(id) ? id : undefined, portablePluginItemEvidence(state));
      return Object.keys(evidence.players).length ? evidence.players : undefined;
    },
    fromState: state => portablePluginItemEvidence(state)?.players,
    mergePlayer: (...records) => mergePluginItemEvidence(...records.map(record => ({ v: 1, players: { evidence: record } }))).players.evidence,
    // Ordinary state writes validate all readable file evidence, but retain
    // facts in their existing sidecars. Import/export materializes the full
    // portable carrier; only live replay decisions fold back on ordinary writes.
    materializePublication: (state, players) => materializeLiveDecisions(state, players),
    materialize: (state, players) => {
      const next = reconcilePluginItemEvidence(state, { provenance: { pluginItemEvidence: { v: 1, players } } });
      // Live handled decisions also bind frozen controllers. Beta/unknown
      // decisions keep their own world scope and cannot suppress live progress.
      return materializeLiveDecisions(next, next.provenance.pluginItemEvidence.players);
    },
  },
});

function materializeLiveDecisions(state, players) {
  const live = Object.fromEntries(Object.entries(players)
    .filter(([, record]) => record.records.live?.handled.length)
    .map(([id, record]) => [id, { items: record.records.live.handled, achievements: [] }]));
  return Object.keys(live).length ? reconcilePluginHandled(state, { provenance: { pluginAutoHandled: live } }) : state;
}

function validate(evidence) {
  if (!object(evidence) || evidence.schemaVersion !== 1 || !object(evidence.entries)
    || Object.keys(evidence).some(key => !['schemaVersion', 'entries'].includes(key))) invalid();
  for (const [id, entry] of Object.entries(evidence.entries)) {
    if (!validEvidenceTypeId(id) || !object(entry) || entry.version !== 1 || !object(entry.players)
      || Object.keys(entry).some(key => !['version', 'players'].includes(key))) invalid();
    for (const [player, record] of Object.entries(entry.players)) if (!validRosterSourceId(player) || !object(record)) invalid();
  }
  return evidence;
}

function fromState(state) {
  const entries = {};
  for (const [id, type] of Object.entries(optionalSidecarEvidenceTypes)) {
    const players = type.fromState?.(state);
    if (players !== undefined) entries[id] = { version: 1, players };
  }
  return { schemaVersion: 1, entries };
}

function merge(members, ...inputs) {
  const live = new Set(members.map(member => member.id)), entries = new Map();
  for (const input of inputs) {
    if (input === undefined) continue;
    for (const [id, entry] of Object.entries(validate(input).entries)) {
      const players = entries.get(id) ?? new Map(), type = Object.hasOwn(optionalSidecarEvidenceTypes, id) ? optionalSidecarEvidenceTypes[id] : undefined;
      for (const [player, record] of Object.entries(entry.players)) {
        if (!live.has(player)) continue;
        const prior = players.get(player);
        if (type) {
          const merged = type.mergePlayer(...(prior === undefined ? [record] : [prior, record]));
          if (!object(merged)) invalid();
          players.set(player, merged);
        }
        else {
          // Preserve opaque future evidence, never guess how to combine two
          // conflicting records of an unregistered type.
          if (prior !== undefined && !isDeepStrictEqual(prior, record)) throw new TypeError('Cannot merge conflicting unregistered sidecar evidence.');
          players.set(player, structuredClone(record));
        }
      }
      entries.set(id, players);
    }
  }
  return { schemaVersion: 1, entries: Object.fromEntries([...entries].map(([id, players]) => [id, { version: 1, players: Object.fromEntries(players) }])) };
}

function install(state, evidence, { publication = false } = {}) {
  if (!Object.keys(evidence.entries).length) return state;
  const retained = Object.fromEntries(Object.entries(evidence.entries).filter(([id]) => optionalSidecarEvidenceTypes[id]?.capsule !== false));
  let next = Object.keys(retained).length ? { ...state, provenance: { ...state.provenance,
    optionalSidecarEvidence: { schemaVersion: 1, entries: retained } } } : state;
  if (!Object.keys(retained).length && state.provenance?.optionalSidecarEvidence) {
    const { optionalSidecarEvidence: discarded, ...provenance } = state.provenance;
    next = { ...state, provenance };
  }
  for (const [id, entry] of Object.entries(evidence.entries)) {
    const type = Object.hasOwn(optionalSidecarEvidenceTypes, id) ? optionalSidecarEvidenceTypes[id] : undefined;
    const materialize = publication && type?.materializePublication || type?.materialize;
    if (materialize) next = materialize(next, entry.players);
  }
  return next;
}

export function reconcileOptionalSidecarEvidence(state, ...sources) {
  return install(state, merge(state.members, ...[state, ...sources].flatMap(source => [
    source.provenance?.optionalSidecarEvidence, fromState(source),
  ])));
}

export function materializeOptionalSidecarEvidence(state, evidence, options) {
  return evidence === undefined ? state : install(state, merge(state.members,
    state.provenance?.optionalSidecarEvidence, fromState(state), evidence), options);
}

export function mapOptionalSidecarEvidence(evidence, mapping) {
  if (evidence === undefined) return undefined;
  if (!object(mapping) || Object.entries(mapping).some(([source, target]) => !validRosterSourceId(source) || !validRosterDestinationId(target))
    || new Set(Object.values(mapping)).size !== Object.values(mapping).length) invalid();
  return { schemaVersion: 1, entries: Object.fromEntries(Object.entries(validate(evidence).entries).map(([id, entry]) => [id,
    { version: 1, players: Object.fromEntries(Object.entries(entry.players).filter(([player]) => Object.hasOwn(mapping, player))
      .map(([player, record]) => [mapping[player], structuredClone(record)])) }])) };
}

export async function captureOptionalSidecarEvidence(state, { dataDir, retainCommittedReplay = false, storeOwned = false } = {}) {
  const inputs = [state.provenance?.optionalSidecarEvidence, fromState(state)];
  for (const [id, type] of Object.entries(optionalSidecarEvidenceTypes)) {
    if (!type.capture || dataDir === undefined && type.files?.length) continue;
    const context = { state, dataDir, retainCommittedReplay, storeOwned };
    const files = type.captureFiles ? await type.captureFiles(context) : new Map(), unavailable = new Map();
    for (const name of type.captureFiles ? [] : type.files ?? []) {
      if (typeof name !== 'string' || !/^plugin-[a-z0-9-]+\.json$/.test(name)) invalid();
      try { files.set(name, await readFile(path.join(dataDir, name))); }
      catch (error) { if (error.code !== 'ENOENT') unavailable.set(name, error.code ?? 'READ_FAILED'); }
    }
    const players = await type.capture({ ...context, files, unavailable });
    if (players !== undefined) inputs.push({ schemaVersion: 1, entries: { [id]: { version: 1, players } } });
  }
  const evidence = merge(state.members, ...inputs);
  return Object.keys(evidence.entries).length ? evidence : undefined;
}

export async function withOptionalSidecarEvidence(backup, context) {
  const evidence = await captureOptionalSidecarEvidence(backup.state, context);
  if (!evidence) return backup;
  // Keep the state carrier as well: older releases ignore the envelope extension
  // but preserve unknown provenance through loading, Undo and re-export.
  return { ...backup, state: materializeOptionalSidecarEvidence(backup.state, evidence), optionalSidecarEvidence: evidence };
}

// Canonical storage envelopes end in an object brace. Append small optional
// evidence without parsing/copying a potentially large compact state tree.
export function appendOptionalSidecarEvidence(document, evidence) {
  if (evidence === undefined) return document;
  validate(evidence);
  const bytes = Buffer.isBuffer(document) ? document : Buffer.from(document);
  let end = bytes.length;
  while (end && [0x20, 0x09, 0x0a, 0x0d].includes(bytes[end - 1])) end--;
  if (bytes[end - 1] !== 0x7d) invalid();
  return Buffer.concat([bytes.subarray(0, end - 1), Buffer.from(`,"optionalSidecarEvidence":${JSON.stringify(evidence)}}\n`)]);
}
