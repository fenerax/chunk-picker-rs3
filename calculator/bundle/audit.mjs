import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encode } from './codec.mjs';

const root = new URL('../../', import.meta.url);
const nameOf = url => fileURLToPath(url).slice(fileURLToPath(root).length).replaceAll('\\', '/');
const bytes = value => Buffer.byteLength(JSON.stringify(encode(value)));

/** Audit the calculator's static import closure, stopping at the provider and
 * diagnostics boundaries. Dynamic pack references are followed as data only. */
export async function auditInputs(dataset) {
  const seen = new Set(), inputs = new Map();
  const add = (module, kind, key) => {
    const id = `${kind}:${key}`;
    if (!inputs.has(id)) inputs.set(id, { kind, key, modules: [] });
    if (!inputs.get(id).modules.includes(module)) inputs.get(id).modules.push(module);
  };
  async function visit(url) {
    const module = nameOf(url);
    if (seen.has(module)) return;
    seen.add(module);
    if (['app/dataset-runtime.mjs', 'app/startup-timing.mjs'].includes(module)) return;
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/\b(datasetValue|datasetJSON|datasetRuleDefinitions|datasetRuleRecords)\(\s*['"]([^'"]+)['"]/g)) {
      const [, operation, key] = match;
      if (operation.startsWith('datasetRule')) {
        add(module, 'value', `${key}:contract`); add(module, 'value', `${key}:presentation`);
      } else add(module, operation === 'datasetJSON' ? 'json' : 'value', key);
    }
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) await visit(new URL(match[1], url));
    }
  }
  await visit(new URL('app/tasks/worker.mjs', root));
  for (const key of dataset.definitionOverlays ?? []) {
    add('app/data/selected-definition-overlays.mjs', 'json', key);
    for (const child of (await dataset.json(key)).retainedTaskCorrections ?? []) add('app/data/selected-definition-overlays.mjs', 'json', child);
  }
  for (const input of inputs.values()) input.bytes = bytes(input.kind === 'value' ? dataset.value(input.key) : await dataset.json(input.key));
  return { modules: [...seen].sort(), inputs: [...inputs.values()].sort((a, b) => a.key.localeCompare(b.key, 'en')),
    boundaries: [
      { module: 'app/dataset-runtime.mjs', input: 'selectedDataset', source: 'dataset.json and valueFiles',
        fields: ['datasetId', 'datasetContractVersion', 'identityNamespace', 'digest', 'capabilities', 'gameDefaults', 'definitionOverlays'] },
      { module: 'app/datasets.mjs', input: 'pack selection, environment, files', source: 'resolved before export; not read on bundle startup',
        environment: ['RS3_DATASET', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_MAP_ASSETS_DIR', 'RS3_GAME_DATA_DIR',
          'RS3_RESOURCE_CONTENTS', 'RS3_ARCHAEOLOGY_CONTENTS', 'RS3_CACHE_SHOP_CONTENTS', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_GAME_DEFAULTS_FILE'] },
      { module: 'app/startup-timing.mjs', input: 'RS3_STARTUP_TIMING_LOG', source: 'optional diagnostics only; no computational input' },
    ] };
}
