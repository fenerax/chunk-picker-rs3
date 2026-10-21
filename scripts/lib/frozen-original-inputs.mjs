import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { safeArtFile } from '../../app/packs.mjs';
import { sha256RepositoryText } from './provenance-hash.mjs';

export const FROZEN_ORIGINAL_SELECTION_PATH = 'app/data/original-data.2026-10-13.v1.json';

/** Trusted offline comparison/adoption reader. This does not select gameplay
 * data, import runtime modules, or inspect any storage directory. */
export async function loadFrozenOriginalInputs({ root, selection, loadDefinitions = true, loadTaskMap = true } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('Provide an explicit frozen-input root.');
  const base = path.resolve(root);
  selection ??= JSON.parse(await readFile(await safeArtFile(base, FROZEN_ORIGINAL_SELECTION_PATH), 'utf8'));
  async function pinned(input) {
    if (!input || typeof input.path !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new TypeError('Invalid original data selection.');
    const target = path.resolve(base, input.path);
    if (target === base || !target.startsWith(base + path.sep) || path.isAbsolute(input.path)) throw new TypeError('Original data path must stay inside the repository.');
    const bytes = await readFile(await safeArtFile(base, input.path));
    if (sha256RepositoryText(bytes) !== input.sha256) throw new Error(`Original data hash mismatch: ${input.path}`);
    return bytes;
  }
  const definitionBytes = loadDefinitions ? await pinned(selection.definitions) : undefined;
  const taskBytes = loadTaskMap ? await pinned(selection.taskMap) : undefined;
  return { definitionBytes, taskBytes, selection };
}
