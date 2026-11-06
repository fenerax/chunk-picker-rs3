import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { mergePluginHandledRecords, reconcilePluginHandled } from './storage/plugin-handled.mjs';
import { validRosterSourceId, validRosterDestinationId } from './import-output.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validEvidenceTypeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const invalid = () => { throw new TypeError('Invalid optional sidecar evidence.'); };

// Code-owned registrations only. A type may declare capture-only filenames,
// validate/merge a player's records, and materialize them into gameplay state.
// Imported payloads never select a filesystem path or cause a sidecar write.
export const optionalSidecarEvidenceTypes = Object.freeze({
  pluginReplaySuppression: {
    files: [],
    fromState: state => state.provenance?.pluginAutoHandled,
    mergePlayer: (...records) => mergePluginHandledRecords(...records),
    materialize: (state, players) => reconcilePluginHandled(state, { provenance: { pluginAutoHandled: players } }),
  },
});

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

function install(state, evidence) {
  if (!Object.keys(evidence.entries).length) return state;
  let next = { ...state, provenance: { ...state.provenance, optionalSidecarEvidence: evidence } };
  for (const [id, entry] of Object.entries(evidence.entries)) {
    const type = Object.hasOwn(optionalSidecarEvidenceTypes, id) ? optionalSidecarEvidenceTypes[id] : undefined;
    if (type?.materialize) next = type.materialize(next, entry.players);
  }
  return next;
}

export function reconcileOptionalSidecarEvidence(state, ...sources) {
  return install(state, merge(state.members, ...[state, ...sources].flatMap(source => [
    source.provenance?.optionalSidecarEvidence, fromState(source),
  ])));
}

export function materializeOptionalSidecarEvidence(state, evidence) {
  return evidence === undefined ? state : install(state, merge(state.members,
    state.provenance?.optionalSidecarEvidence, fromState(state), evidence));
}

export function mapOptionalSidecarEvidence(evidence, mapping) {
  if (evidence === undefined) return undefined;
  if (!object(mapping) || Object.entries(mapping).some(([source, target]) => !validRosterSourceId(source) || !validRosterDestinationId(target))
    || new Set(Object.values(mapping)).size !== Object.values(mapping).length) invalid();
  return { schemaVersion: 1, entries: Object.fromEntries(Object.entries(validate(evidence).entries).map(([id, entry]) => [id,
    { version: 1, players: Object.fromEntries(Object.entries(entry.players).filter(([player]) => Object.hasOwn(mapping, player))
      .map(([player, record]) => [mapping[player], structuredClone(record)])) }])) };
}

export async function captureOptionalSidecarEvidence(state, { dataDir } = {}) {
  const inputs = [state.provenance?.optionalSidecarEvidence, fromState(state)];
  for (const [id, type] of Object.entries(optionalSidecarEvidenceTypes)) {
    if (!type.capture || dataDir === undefined && type.files?.length) continue;
    const files = new Map(), unavailable = new Map();
    for (const name of type.files ?? []) {
      if (typeof name !== 'string' || !/^plugin-[a-z0-9-]+\.json$/.test(name)) invalid();
      try { files.set(name, await readFile(path.join(dataDir, name))); }
      catch (error) { if (error.code !== 'ENOENT') unavailable.set(name, error.code ?? 'READ_FAILED'); }
    }
    const players = await type.capture({ state, files, unavailable });
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
