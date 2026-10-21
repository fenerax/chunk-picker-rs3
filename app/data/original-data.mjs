import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectedDataset, datasetJSON } from '../dataset-runtime.mjs';
const selection = await datasetJSON('app/data/original-data.2026-10-13.v1.json');
import { sha256RepositoryText } from '../../scripts/lib/provenance-hash.mjs';

export const originalDataSelection = selection;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Runtime input bytes always come from the selected dataset provider. */
export async function loadOriginalData({ root = ROOT, selection = originalDataSelection,
  loadDefinitions = true, loadTaskMap = true, dataset = selectedDataset } = {}) {
  if (path.resolve(root) !== path.resolve(ROOT)) throw new TypeError('Alternate roots require an explicit dataset provider; offline tools use the frozen-original-inputs reader.');
  async function pinned(input) {
    if (!input || typeof input.path !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new TypeError('Invalid original data selection.');
    const base = path.resolve(root), target = path.resolve(base, input.path);
    if (target === base || !target.startsWith(base + path.sep)) throw new TypeError('Original data path must stay inside the repository.');
    const bytes = dataset.bytes(input.path);
    if (sha256RepositoryText(bytes) !== input.sha256) throw new Error(`Original data hash mismatch: ${input.path}`);
    return bytes;
  }
  const definitionBytes = loadDefinitions ? await pinned(selection.definitions) : undefined;
  const taskBytes = loadTaskMap ? await pinned(selection.taskMap) : undefined;
  return { definitionBytes, taskBytes, selection };
}
