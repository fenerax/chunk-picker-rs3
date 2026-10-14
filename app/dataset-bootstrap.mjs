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
    const bytes = dataset.bytes(input.path);
    if (path.isAbsolute(input.path) || input.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new TypeError('Invalid dataset input path.');
    const digest = dataset.capabilities?.independent === true ? createHash('sha256').update(bytes).digest('hex') : sha256RepositoryText(bytes);
    if (digest !== input.sha256) throw new Error('Dataset input hash mismatch.');
    return bytes;
  };
  return { selection, definitionBytes: loadDefinitions ? pinned(selection.definitions) : undefined,
    taskBytes: loadTaskMap ? pinned(selection.taskMap) : undefined };
}

export async function loadOriginalSyncIntegration(dataset,
  load = () => import(originalSyncModule)) {
  if (dataset.capabilities?.features?.originalSync === false) return null;
  return load();
}
