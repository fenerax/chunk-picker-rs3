// One immutable provider per process/isolate. Resolve it before any dependent
// module materializes identities, rules or indexes. Packs contain data only.
const node = typeof process !== 'undefined' && !!process.versions?.node;
const recorded = new Map();
let encode = value => value;
export let selectedDataset = await (async () => {
  if (node) {
    const [{ resolveDataset, encodeDatasetValue }, { workerData }] = await Promise.all([
      import('./datasets.mjs'), import('node:worker_threads'),
    ]);
    encode = encodeDatasetValue;
    return resolveDataset(workerData?.datasetSelection ?? {});
  }
  // About 3 MB of game data: revalidate so an unchanged copy costs a 304, not a download on every load.
  const response = await fetch('/data/dataset-runtime.json', { credentials: 'same-origin', cache: 'no-cache' });
  if (!response.ok) throw new Error('Game data could not be loaded. Reload the picker.');
  const payload = await response.json();
  const decode = value => {
    if (value?.$datasetType === 'Undefined') return undefined;
    if (value?.$datasetType === 'Set') return new Set(value.entries.map(decode));
    if (value?.$datasetType === 'Map') return new Map(value.entries.map(([key, row]) => [decode(key), decode(row)]));
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, decode(row)]));
    return value;
  };
  const values = decode(payload.values), cache = new Map();
  return Object.freeze({ ...payload.dataset, capabilities: payload.capabilities,
    gameDefaults: payload.gameDefaults, definitionOverlays: payload.definitionOverlays ?? [],
    status: () => payload.dataset,
    value(key) {
      if (!Object.hasOwn(values, key)) throw new Error('Game data does not contain the requested catalogue.');
      return values[key];
    },
    json(key) {
      const route = key.startsWith('app/data/') ? `/data/${key.slice('app/data/'.length)}`
        : key === 'app/web/gallery-fixture-data.json' ? '/gallery-fixture-data.json'
          : `/api/dataset-input?key=${encodeURIComponent(key)}`;
      if (!cache.has(key)) cache.set(key, fetch(`${route}${route.includes('?') ? '&' : '?'}digest=${payload.dataset.digest}`, {
        credentials: 'same-origin', cache: 'no-cache',
      }).then(async result => {
        if (!result.ok) throw new Error('Game data changed. Reload the picker.');
        return result.json();
      }));
      return cache.get(key);
    },
  });
})();

export const datasetJSON = key => selectedDataset.json(key);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    if (value instanceof Map) for (const row of value.values()) freeze(row);
    else if (value instanceof Set) for (const row of value) freeze(row);
    else for (const row of Object.values(value)) freeze(row);
    Object.freeze(value);
  }
  return value;
}
export function datasetValue(key, trackedValue) {
  if (!recorded.has(key)) recorded.set(key, freeze(selectedDataset.value(key, trackedValue)));
  return recorded.get(key);
}

const presentationFields = new Set(['label', 'description', 'section', 'help', 'tooltip']);
export function datasetRuleDefinitions(key, trackedValue) {
  let tracked;
  const rows = () => tracked ??= trackedValue();
  const contract = datasetValue(`${key}:contract`, trackedValue && (() => rows().map(row => Object.fromEntries(Object.entries(row)
    .filter(([field]) => !presentationFields.has(field))))));
  const text = datasetValue(`${key}:presentation`, trackedValue && (() => rows().map(row => ({ id: row.id,
    ...Object.fromEntries(Object.entries(row).filter(([field]) => presentationFields.has(field))) }))));
  const byId = new Map(text.map(row => [row.id, row]));
  return Object.freeze(contract.map(row => Object.freeze({ ...row, ...Object.fromEntries(Object.entries(byId.get(row.id) ?? {})
    .filter(([field]) => presentationFields.has(field))) })));
}

export function datasetRuleRecords(key) {
  const contract = datasetValue(`${key}:contract`), text = datasetValue(`${key}:presentation`);
  return freeze(Object.fromEntries(Object.entries(contract).map(([id, row]) => [id, { ...row,
    ...Object.fromEntries(Object.entries(text[id] ?? {}).filter(([field]) => presentationFields.has(field))),
  }])));
}

export function requireSelectedDataset(dataset = selectedDataset) {
  if (dataset.digest !== selectedDataset.digest) throw new Error('Dataset switching requires a new process.');
  return dataset;
}

// Worlds are also copied into protected rule-hook and worker contexts. Carry
// the selected contract without embedding the provider's executable methods.
export function datasetEngineContext(dataset = selectedDataset) {
  requireSelectedDataset(dataset);
  return Object.freeze({ datasetId: dataset.datasetId, datasetContractVersion: dataset.datasetContractVersion,
    digest: dataset.digest, capabilities: dataset.capabilities });
}

// Constructor injection may choose legacy display-metadata roots. All compiled
// gameplay/rule/identity inputs must already be identical to the bootstrap.
export function adoptLegacyMetadataProvider(dataset) {
  const core = provider => JSON.stringify({ capabilities: provider.capabilities,
    definitionOverlays: provider.definitionOverlays ?? [],
    files: provider.files.filter(file => !file.path.startsWith('local-map/') && !file.path.startsWith('local-game/'))
      .map(({ path, bytes, sha256, kind }) => ({ path, bytes, sha256, kind })).sort((a, b) => a.path.localeCompare(b.path)),
  });
  if (dataset.digest !== selectedDataset.digest && core(dataset) !== core(selectedDataset)) {
    throw new Error('Choose the data pack before importing the application, then restart.');
  }
  selectedDataset = dataset;
  return dataset;
}

/** Build indexes from trusted tracked initializers; never evaluate pack code. */
export async function materializeDatasetValues() {
  if (!node) throw new Error('Dataset snapshots are operator-only.');
  if (selectedDataset.materializeValues) return selectedDataset.materializeValues();
  const { DATASET_VALUE_MODULES } = await import('./dataset-inputs.mjs');
  for (const filename of DATASET_VALUE_MODULES) await import(new URL(`../${filename}`, import.meta.url));
  return encode(Object.fromEntries(recorded));
}
