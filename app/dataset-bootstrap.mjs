import { createHash } from 'node:crypto';
import path from 'node:path';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const legacyInputsModule = './data/original-data.mjs';
const originalSyncModule = './integrations/original-sync.mjs';

// Compatibility selections are provider data, including independently authored
// catalogues. Only legacy providers need the original-format loader.
export async function loadDatasetInputs(dataset, { loadDefinitions = true, loadTaskMap = true } = {},
  loadLegacy = () => import(legacyInputsModule)) {
  if (!dataset.packed && dataset.capabilities?.independent !== true) {
    return (await loadLegacy()).loadOriginalData({ dataset, loadDefinitions, loadTaskMap });
  }
  const selection = await dataset.json('app/data/original-data.2026-10-13.v1.json');
  const pinned = input => {
    if (typeof input?.path !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new TypeError('Invalid dataset input selection.');
    const { bytes, sha256: verified } = typeof dataset.verifiedBytes === 'function' ? dataset.verifiedBytes(input.path) : { bytes: dataset.bytes(input.path) };
    if (path.isAbsolute(input.path) || input.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new TypeError('Invalid dataset input path.');
    // A provider's verified digest is of these exact bytes. Repository text
    // hashes the same bytes unless it has CRLF pairs to normalize.
    const digest = dataset.capabilities?.independent === true ? verified ?? createHash('sha256').update(bytes).digest('hex')
      : verified !== undefined && !bytes.includes('\r\n') ? verified : sha256RepositoryText(bytes);
    if (digest !== input.sha256) throw new Error('Dataset input hash mismatch.');
    return bytes;
  };
  return { selection, definitionBytes: loadDefinitions ? pinned(selection.definitions) : undefined,
    taskBytes: loadTaskMap ? pinned(selection.taskMap) : undefined };
}

export async function loadOriginalSyncIntegration(dataset,
  load = () => import(originalSyncModule), addon = null) {
  if (dataset.capabilities?.features?.originalSync === false) return null;
  if (addon?.features.originalSync) {
    const [datasetRuntime, migration, collection, settings, identity] = await Promise.all([
      import('./dataset-runtime.mjs'), import('./tasks/migration.mjs'), import('./tasks/collection.mjs'),
      import('./data/settings.mjs'), import('./tasks/identity.mjs'),
    ]);
    return addon.loadServerIntegration({ datasetRuntime, migration, collection, settings, identity });
  }
  return load();
}
