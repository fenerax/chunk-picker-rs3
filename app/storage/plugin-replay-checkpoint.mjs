import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { acquireStoreOwnership } from './store-lock.mjs';
import { readStaticFieldBytes, validateStaticFieldReference } from './static-field.mjs';
import { decodeCompletionDocument } from './completion-codec.mjs';
import { materializeOptionalSidecarEvidence, reconcileOptionalSidecarEvidence } from '../optional-sidecar-evidence.mjs';
import { validRosterSourceId } from '../import-output.mjs';
import { legacyPluginHandledFiles, preparePluginHandledSidecars } from './plugin-handled-sidecars.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasReplayPlayers = players => players !== undefined && (!object(players) || Object.values(players).some(record => !object(record)
  || !Array.isArray(record.items) || !Array.isArray(record.achievements) || record.items.length || record.achievements.length));
const hasReplayEnvelope = evidence => {
  const entry = evidence?.entries?.pluginReplaySuppression;
  const items = evidence?.entries?.pluginItems;
  return entry !== undefined && (!object(entry) || entry.version !== 1 || !Object.hasOwn(entry, 'players') || hasReplayPlayers(entry.players))
    || items !== undefined && hasItemReplay(items.players);
};
const hasItemReplay = players => players !== undefined && (!object(players) || Object.values(players).some(record =>
  record?.records?.live?.handled !== undefined && (!Array.isArray(record.records.live.handled) || record.records.live.handled.length)));
function hasReplayProvenance(provenance) {
  const seen = new Set();
  for (let node = provenance; object(node); node = node.restore?.incomingProvenance) {
    if (seen.has(node)) throw new TypeError('Cyclic replay provenance.');
    seen.add(node);
    if (hasReplayPlayers(node.pluginAutoHandled) || hasReplayEnvelope(node.optionalSidecarEvidence)
      || hasItemReplay(node.pluginItemEvidence?.players)) return true;
  }
  return false;
}

async function hasLegacyReplay(dataDir) {
  let present = false;
  for (const name of legacyPluginHandledFiles) {
    let document;
    try { document = JSON.parse(await readFile(path.join(dataDir, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    // The gate owns replay decisions, not item baselines/bank/journal data.
    // Unreadable decision carriers still fail closed; an explicit empty set
    // does not require a gameplay checkpoint or a particular gameplay schema.
    if (!object(document?.players) || Object.values(document.players).some(record => !object(record) || !Array.isArray(record.handled)))
      throw new TypeError('Invalid legacy replay evidence.');
    present ||= Object.values(document.players).some(record => record.handled.length);
  }
  return present;
}
// Only the roster and provenance are needed to bridge replay decisions. Keep
// dataset initialization, credentials, migrations and gameplay writes out of
// the privileged operator package. Runtime loading validates gameplay normally.
export async function prepareStoppedPluginSuppression({ dataDir }) {
  const directory = path.resolve(dataDir);
  const { release, ensureFileLock } = await acquireStoreOwnership(directory, { existingOnly: true });
  try {
    let document;
    try { document = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const legacy = await hasLegacyReplay(directory);
    // Only native provenance references are ours to resolve. Other checkpoint
    // shapes without replay evidence belong to the selected runtime's loader.
    const provenanceReference = document?.format === 'rs3-chunk-picker' ? document.storage?.fields?.provenance : undefined;
    let provenance = document?.state?.provenance;
    if (provenanceReference !== undefined) {
      validateStaticFieldReference('provenance', provenanceReference);
      provenance = JSON.parse(await readStaticFieldBytes(directory, 'provenance', provenanceReference));
    }
    if (!legacy && !hasReplayProvenance(provenance) && !hasReplayEnvelope(document?.optionalSidecarEvidence))
      return { publications: [], release };
    // Reconciliation also excludes older runtimes that know only store.lock.
    await ensureFileLock();
    document = decodeCompletionDocument(document);
    const state = document?.state;
    if (document?.format !== 'rs3-chunk-picker' || document.schemaVersion !== 1 || !object(state)
      || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
      || !Array.isArray(state.members) || !state.members.length
      || state.members.some(member => !object(member) || !validRosterSourceId(member.id))
      || new Set(state.members.map(member => member.id)).size !== state.members.length) throw new TypeError('Invalid replay checkpoint.');
    const storage = document.storage;
    if (storage !== undefined) {
      if (!object(storage) || storage.schemaVersion !== 1 || !object(storage.fields)
        || Object.keys(storage).some(key => !['schemaVersion', 'fields'].includes(key))) throw new TypeError('Invalid static storage metadata.');
      for (const [key, reference] of Object.entries(storage.fields)) {
        if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(state, key)
          || !object(reference)) throw new TypeError('Invalid static field reference.');
        validateStaticFieldReference(key, reference);
        if (key === 'provenance') state.provenance = provenance;
      }
    }
    if (state.provenance !== undefined && !object(state.provenance)) throw new TypeError('Invalid replay provenance.');
    const ready = materializeOptionalSidecarEvidence(reconcileOptionalSidecarEvidence(state), document.optionalSidecarEvidence);
    return { publications: await preparePluginHandledSidecars({ dataDir: directory, state: ready }), release };
  } catch (error) { await release(); throw error; }
}
