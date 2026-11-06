import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { acquireProcessGuard } from './process-guard.mjs';
import { readStaticFieldBytes, validateStaticFieldReference } from './static-field.mjs';
import { decodeCompletionDocument } from './completion-codec.mjs';
import { materializeOptionalSidecarEvidence } from '../optional-sidecar-evidence.mjs';
import { validRosterSourceId } from '../import-output.mjs';
import { preparePluginHandledSidecars } from './plugin-handled-sidecars.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Only the roster and provenance are needed to bridge replay decisions. Keep
// dataset initialization, credentials, migrations and gameplay writes out of
// the privileged operator package. Runtime loading validates gameplay normally.
export async function prepareStoppedPluginSuppression({ dataDir }) {
  const directory = path.resolve(dataDir), release = await acquireProcessGuard(directory);
  try {
    const document = decodeCompletionDocument(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')));
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
        if (key === 'provenance') state.provenance = JSON.parse(await readStaticFieldBytes(directory, key, reference));
      }
    }
    if (state.provenance !== undefined && !object(state.provenance)) throw new TypeError('Invalid replay provenance.');
    const ready = materializeOptionalSidecarEvidence(state, document.optionalSidecarEvidence);
    return { publications: await preparePluginHandledSidecars({ dataDir: directory, state: ready }), release };
  } catch (error) { await release(); throw error; }
}
