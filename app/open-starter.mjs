import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { starterContract, starterCapabilities, starterGameDefaults, starterValues, starterJSON } from './open-starter-data.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => value === undefined ? { $datasetType: 'Undefined' }
  : value instanceof Set ? { $datasetType: 'Set', entries: [...value].map(encode) }
    : value instanceof Map ? { $datasetType: 'Map', entries: [...value].map(([key, row]) => [encode(key), encode(row)]) }
      : Array.isArray(value) ? value.map(encode)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, row]) => [key, encode(row)])) : value;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const row of value instanceof Map || value instanceof Set ? value.values() : Object.values(value)) freeze(row);
    Object.freeze(value);
  }
  return value;
};

/** Fixed, bundled data provider. It does not discover packs or private paths. */
export function resolveOpenStarter(options = {}) {
  const json = structuredClone(starterJSON), values = structuredClone(starterValues);
  const buffers = new Map(Object.entries(json).map(([key, row]) => [key, Buffer.from(JSON.stringify(row) + '\n')]));
  json['app/data/original-data.2026-10-13.v1.json'] = { schemaVersion: 1, version: 'open-starter-1',
    definitions: { path: 'app/open-starter-definitions.json', sha256: sha(buffers.get('app/open-starter-definitions.json')) },
    taskMap: { path: 'app/open-starter-task-map.json', sha256: sha(buffers.get('app/open-starter-task-map.json')) } };
  buffers.set('app/data/original-data.2026-10-13.v1.json', Buffer.from(JSON.stringify(json['app/data/original-data.2026-10-13.v1.json']) + '\n'));
  const sourceFiles = ['open-starter.mjs', 'open-starter-data.mjs'].map(name => {
    const bytes = readFileSync(new URL(name, import.meta.url));
    return { path: `app/${name}`, bytes: bytes.length, sha256: sha(bytes), kind: 'evidence' };
  });
  const files = Object.freeze([...buffers].map(([path, bytes]) => Object.freeze({ path, bytes: bytes.length, sha256: sha(bytes), kind: 'input' })).concat(sourceFiles));
  const ruleContractHash = sha(JSON.stringify(encode(Object.fromEntries(Object.entries(values).filter(([key]) => /ruleContract|:contract|actualDefaults|originalRuleDefaults|originalRulePresets/.test(key))))));
  const digest = sha(JSON.stringify({ contract: starterContract, capabilities: starterCapabilities, values: encode(values), files, ruleContractHash }));
  if (options.digest !== undefined && options.digest !== digest) throw Object.assign(new Error('The bundled starter dataset changed. Restart the game.'), { code: 'DATASET_PACK_INVALID' });
  freeze(json); freeze(values);
  const status = () => ({ id: 'open-starter', kind: 'data', version: '1.0.0', health: 'healthy', digest, contractVersion: 1,
    label: 'Open starter', displayName: 'Open starter', title: starterGameDefaults.title,
    description: 'A small invented grid with independently written goals.' });
  const provider = { ...starterContract, id: 'open-starter', contractVersion: 1, digest, ruleContractHash, packed: false,
    label: 'Open starter', displayName: 'Open starter', title: starterGameDefaults.title,
    description: 'A small invented world. It does not describe RuneScape geography or activities.',
    capabilities: starterCapabilities, gameDefaults: freeze(structuredClone(starterGameDefaults)), environment: Object.freeze({ RS3_DATASET: 'open-starter' }),
    overlayOrder: Object.freeze({ server: [], worker: [], tasks: [], world: [], skillGuides: 'unsupported' }), files, status,
    bytes(key) {
      if (!buffers.has(key)) throw Object.assign(new Error('Starter catalogue unavailable.'), { code: 'DATASET_PACK_INVALID' });
      return Buffer.from(buffers.get(key));
    },
    json(key) {
      if (!Object.hasOwn(json, key)) throw Object.assign(new Error('Starter catalogue unavailable.'), { code: 'DATASET_PACK_INVALID' });
      return json[key];
    },
    value(key) {
      if (!Object.hasOwn(values, key)) throw Object.assign(new Error(`Starter value unavailable: ${key}`), { code: 'DATASET_PACK_INVALID' });
      return freeze(structuredClone(values[key]));
    },
    metadataBytes: async () => null,
    sourceFile() { throw new Error('The bundled starter provider has no legacy builder sources.'); },
    materializeValues: () => encode(values),
    workerSelection: () => ({ datasetId: 'open-starter', digest }),
    serialize: () => provider.workerSelection(),
  };
  return Object.freeze(provider);
}
