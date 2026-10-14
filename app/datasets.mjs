import path from 'node:path';
import { open, lstat, readFile } from 'node:fs/promises';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { safeArtFile, packRelative, PACK_VERSION } from './packs.mjs';
import { loadGameDefaults } from './game-defaults.mjs';
import { loadDatasetProfile } from './dataset-profile.mjs';

export const DATASET_CONTRACT = Object.freeze({ datasetId: 'duo-legacy', datasetContractVersion: 1, identityNamespace: 'rs3', coordinateSystem: 'surface-grid-v1', corePackApi: 1 });
export const DATASET_OVERLAY_ORDER = Object.freeze({
  server: Object.freeze(['equipment', 'shops']),
  worker: Object.freeze(['equipment-if-unprepared', 'retained']),
  tasks: Object.freeze(['divination', 'retained', 'unsupported', 'metadata', 'equipment', 'shops', 'archaeology']),
  world: Object.freeze(['map', 'topology', 'resources', 'archaeology']),
  skillGuides: 'opt-in-after-task-baseline',
});
export const DATASET_LIMITS = Object.freeze({ files: 10000, fileBytes: 128 * 1024 ** 2, manifestBytes: 8 * 1024 ** 2, totalBytes: 8 * 1024 ** 3 });
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function datasetFailure(message = 'The selected data pack is invalid.') { const error = new Error(message); error.code = 'DATASET_PACK_INVALID'; return error; }
const fail = () => { throw datasetFailure(); };

export function encodeDatasetValue(value) {
  if (value === undefined) return { $datasetType: 'Undefined' };
  if (value instanceof Set) return { $datasetType: 'Set', entries: [...value].map(encodeDatasetValue) };
  if (value instanceof Map) return { $datasetType: 'Map', entries: [...value].map(([key, entry]) => [encodeDatasetValue(key), encodeDatasetValue(entry)]) };
  if (Array.isArray(value)) return value.map(encodeDatasetValue);
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeDatasetValue(entry)]));
  return value;
}
export function decodeDatasetValue(value) {
  if (Array.isArray(value)) return value.map(decodeDatasetValue);
  if (plain(value)) {
    if (Object.hasOwn(value, '$datasetType')) {
      if (value.$datasetType === 'Undefined' && Object.keys(value).length === 1) return undefined;
      if (!Array.isArray(value.entries) || Object.keys(value).length !== 2) fail();
      if (value.$datasetType === 'Set') return new Set(value.entries.map(decodeDatasetValue));
      if (value.$datasetType === 'Map' && value.entries.every(entry => Array.isArray(entry) && entry.length === 2)) return new Map(value.entries.map(entry => entry.map(decodeDatasetValue)));
      fail();
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeDatasetValue(entry)]));
  }
  return value;
}
export function datasetEnvironment(environment = process.env) {
  return Object.freeze({ RS3_RESOURCE_CONTENTS: environment.RS3_RESOURCE_CONTENTS ?? 'expanded', RS3_ARCHAEOLOGY_CONTENTS: environment.RS3_ARCHAEOLOGY_CONTENTS ?? 'retained', RS3_CACHE_SHOP_CONTENTS: environment.RS3_CACHE_SHOP_CONTENTS ?? '0' });
}
export function datasetCapabilities(environment = process.env) {
  const chosen = datasetEnvironment(environment);
  return Object.freeze({ cacheWalking: true, cacheResources: chosen.RS3_RESOURCE_CONTENTS !== 'retained', cacheArchaeology: chosen.RS3_ARCHAEOLOGY_CONTENTS === 'game-data', cacheShops: chosen.RS3_CACHE_SHOP_CONTENTS === '1',
    mapCorrections: true, divinationTraining: true, retainedTaskCorrections: true, retainedUnsupportedCorrections: true, metadataCorrections: true, equipmentCorrections: true });
}
export function datasetDigest(files, capabilities) {
  const records = files.filter(record => ['input', 'evidence'].includes(record.kind)).map(({ path: name, bytes, sha256, kind }) => ({ path: name, bytes, sha256, kind })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return sha(JSON.stringify({ contract: DATASET_CONTRACT, capabilities, overlayOrder: DATASET_OVERLAY_ORDER, files: records }));
}
export function datasetRuleTextContract(capture) {
  const ruleKeys = ['key', 'default', 'hasDeclaredDefault', 'control', 'numericKey', 'parentKey', 'childKeys', 'childEnablePolicy', 'disabledChildPolicy'];
  return {
    rules: (capture.rules ?? []).map(rule => Object.fromEntries(ruleKeys.filter(key => Object.hasOwn(rule, key)).map(key => [key, rule[key]]))),
    presets: (capture.presets ?? []).map(preset => ({ name: preset.name, values: preset.values, effectiveValues: preset.effectiveValues })),
    inputs: capture.inputs ?? null, cascade: capture.cascade ?? null, selectAll: capture.selectAll ?? null,
  };
}
export function datasetRuleContractHash(values, keys = [], capturedContracts = {}) {
  const contract = Object.fromEntries([...keys].sort().map(key => { if (!Object.hasOwn(values, key)) fail(); return [key, encodeDatasetValue(values[key])]; }));
  return sha(JSON.stringify({ contractVersion: DATASET_CONTRACT.datasetContractVersion, values: contract, capturedContracts }));
}
export async function datasetCatalogue(options = {}) {
  const production = options.inputs === undefined || options.sourceInputs === undefined || options.valueKeys === undefined || options.ruleTextValueKeys === undefined || options.ruleContractValueKeys === undefined;
  const defaults = production ? await import('./dataset-inputs.mjs') : {};
  return {
    inputs: options.inputs ?? defaults.DATASET_INPUTS,
    sourceInputs: options.sourceInputs ?? defaults.DATASET_SOURCE_INPUTS,
    valueKeys: options.valueKeys ?? defaults.DATASET_VALUE_KEYS,
    ruleTextValueKeys: options.ruleTextValueKeys ?? defaults.RULE_TEXT_VALUE_KEYS,
    ruleContractValueKeys: options.ruleContractValueKeys ?? defaults.DATASET_RULE_CONTRACT_VALUE_KEYS,
  };
}
export function datasetSourcePath(key, { root, mapAssetsDir, gameDataDir }) {
  packRelative(key);
  if (key.startsWith('local-map/')) return { root: mapAssetsDir, relative: key.slice(10), optional: true };
  if (key.startsWith('local-game/')) return { root: gameDataDir, relative: key.slice(11), optional: true };
  return { root, relative: key, optional: false };
}
async function inspectFile(root, record, collect = false, limit = DATASET_LIMITS.fileBytes) {
  const filename = await safeArtFile(root, record.path), handle = await open(filename, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit || (record.bytes !== undefined && before.size !== record.bytes)) fail();
    const hash = createHash('sha256'), pieces = collect ? [] : null;
    for await (const bytes of handle.createReadStream({ autoClose: false })) { hash.update(bytes); if (pieces) pieces.push(bytes); }
    const digest = hash.digest('hex');
    if (record.sha256 !== undefined && record.sha256 !== digest) fail();
    await safeArtFile(root, record.path);
    if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await lstat(filename))) fail();
    return { filename, fingerprint: fingerprint(before), bytes: before.size, sha256: digest, ...(pieces ? { data: Buffer.concat(pieces) } : {}) };
  } finally { await handle.close(); }
}
function safeSyncFile(filename) {
  const base = path.parse(filename).root; let current = base;
  for (const segment of filename.slice(base.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment); const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !samePath(realpathSync(current), current) || (current !== filename && !stat.isDirectory())) fail();
  }
  if (!lstatSync(filename).isFile()) fail();
}
function validateSelection(selection) {
  if (!plain(selection) || selection.schemaVersion !== 1 || !['art', 'data', 'rulesText'].some(key => Object.hasOwn(selection, key))) fail();
  // Artwork owns its tolerant invalid/missing-pack fallback policy. Only data
  // and required rule text may block gameplay activation here.
  for (const kind of ['data', 'rulesText']) if (Object.hasOwn(selection, kind) && selection[kind] !== null) {
    const choice = selection[kind];
    if (!plain(choice) || choice.id !== ({ data: 'duo-data', rulesText: 'duo-rules-text' })[kind] || !PACK_VERSION.test(choice.version ?? '') || !digestPattern.test(choice.sha256 ?? '')) fail();
  }
  if (!selection.data && selection.rulesText) fail();
}
async function readSelection(selectionPath) {
  try {
    const checked = await inspectFile(path.dirname(selectionPath), { path: path.basename(selectionPath) }, true, 65536);
    if (checked.bytes > 65536) fail();
    return JSON.parse(checked.data.toString('utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function loadPack(packsDir, choice, kind) {
  const root = path.resolve(packsDir, choice.id, choice.version);
  const checked = await inspectFile(root, { path: 'pack.json', sha256: choice.sha256 }, true, DATASET_LIMITS.manifestBytes);
  if (checked.bytes > DATASET_LIMITS.manifestBytes) fail();
  const manifest = JSON.parse(checked.data.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.id !== choice.id || manifest.kind !== kind || manifest.version !== choice.version
    || manifest.distribution !== 'private-local' || !plain(manifest.requires) || !plain(manifest.catalogues) || !Array.isArray(manifest.files)
    || manifest.files.length > DATASET_LIMITS.files || !digestPattern.test(manifest.ruleContractHash ?? '')) fail();
  for (const [key, value] of Object.entries(DATASET_CONTRACT)) if (manifest.requires[key] !== value) fail();
  if (kind === 'data' && !isDeepStrictEqual(manifest.overlayOrder, DATASET_OVERLAY_ORDER)) fail();
  const records = new Map(), opened = new Map(); let total = 0;
  for (const record of manifest.files) {
    packRelative(record?.path);
    if (record.path === 'pack.json' || records.has(record.path.toLowerCase()) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > DATASET_LIMITS.fileBytes
      || !digestPattern.test(record.sha256 ?? '') || !['input', 'evidence', 'generated', 'provenance'].includes(record.kind)
      || (record.kind === 'evidence' ? !record.path.endsWith('.mjs') : record.kind === 'input' ? !/\.json(?:\.gz)?$/.test(record.path) : !record.path.endsWith('.json'))) fail();
    total += record.bytes; if (total > DATASET_LIMITS.totalBytes) fail();
    records.set(record.path.toLowerCase(), record);
    const { data: payload, ...checked } = await inspectFile(root, record, record.kind === 'input');
    if (record.kind === 'input') {
      const json = record.path.endsWith('.json.gz') ? gunzipSync(payload, { maxOutputLength: DATASET_LIMITS.fileBytes }) : payload;
      JSON.parse(json.toString('utf8')); // Validate eagerly; retain no parsed input tree.
    }
    opened.set(record.path, { ...checked, record });
  }
  if (![manifest.catalogues.values, manifest.provenance].every(key => typeof key === 'string' && opened.has(key))) fail();
  const valuesRecord = opened.get(manifest.catalogues.values);
  if (valuesRecord.record.kind !== 'generated' || opened.get(manifest.provenance).record.kind !== 'provenance') fail();
  const snapshot = JSON.parse((await inspectFile(root, valuesRecord.record, true)).data.toString('utf8'));
  if (snapshot.schemaVersion !== 1 || !plain(snapshot.values)) fail();
  return { root, manifest, opened, values: decodeDatasetValue(snapshot.values) };
}

/** Complete selection resolves and verifies before callers compile a world or open storage. */
export async function resolveDataset(options = {}) {
  try {
    const selectedId = options.datasetId ?? process.env.RS3_DATASET;
    if (selectedId === 'open-starter') return (await import('./open-starter.mjs')).resolveOpenStarter(options);
    if (selectedId === 'open-f2p') return (await import('./open-f2p.mjs')).resolveOpenF2P(options);
    if (selectedId !== undefined && selectedId !== '' && selectedId !== 'duo-legacy') throw datasetFailure('Unknown dataset selection.');
    const root = path.resolve(options.root ?? defaultRoot), packsDir = path.resolve(options.packsDir ?? process.env.RS3_PACKS_DIR ?? path.join(root, '.local', 'packs'));
    const selectionPath = path.resolve(options.selectionPath ?? process.env.RS3_PACK_SELECTION ?? path.join(packsDir, 'selection.json'));
    const configuredMapAssetsDir = options.legacyMetadataMapAssetsDir === null ? undefined
      : options.legacyMetadataMapAssetsDir ?? options.mapAssetsDir ?? process.env.RS3_MAP_ASSETS_DIR;
    if (configuredMapAssetsDir !== undefined && typeof configuredMapAssetsDir !== 'string') fail();
    const operatorMapAssetsDir = configuredMapAssetsDir ? path.resolve(configuredMapAssetsDir) : configuredMapAssetsDir;
    const mapAssetsDir = path.resolve(operatorMapAssetsDir ?? path.join(root, '.local', 'map-assets'));
    const gameDataDir = path.resolve(options.gameDataDir ?? process.env.RS3_GAME_DATA_DIR ?? path.join(root, '.local', 'game-data'));
    const installed = await loadDatasetProfile(options);
    const catalogue = installed ? installed.profile.catalogue : await datasetCatalogue(options);
    const receipt = options.selection === undefined ? await readSelection(selectionPath) : structuredClone(options.selection);
    if (receipt !== null) validateSelection(receipt);
    const packed = Boolean(receipt?.data), opened = new Map(), files = [], parsed = new Map(); let trackedValues, legacyMetadataFiles, legacyMetadataSnapshots, legacyMetadataResolver;
    if (installed && !packed) fail();
    const metadataKeys = catalogue.inputs.filter(key => key.startsWith('local-map/') && key.endsWith('.json'));
    const metadataResolver = () => legacyMetadataResolver ??= import('./legacy-dataset-metadata.mjs').then(({ createLegacyMetadataResolver }) =>
      createLegacyMetadataResolver({ root, packsDir, selectionPath, selection: receipt, mapAssetsDir: operatorMapAssetsDir, keys: metadataKeys }));
    let capabilities, environment, values = {}, ruleContractHash = null, version = 'tracked';
    if (packed) {
      if (options.legacyMetadataSnapshots !== undefined) fail();
      if (!receipt.rulesText) fail();
      const data = await loadPack(packsDir, receipt.data, 'data'), text = await loadPack(packsDir, receipt.rulesText, 'rules-text');
      if (data.manifest.ruleContractHash !== text.manifest.ruleContractHash || !plain(data.manifest.capabilities) || !plain(data.manifest.environment)) fail();
      environment = datasetEnvironment(data.manifest.environment); capabilities = datasetCapabilities(environment);
      if (JSON.stringify(capabilities) !== JSON.stringify(data.manifest.capabilities)) fail();
      for (const pack of [data, text]) for (const [key, entry] of pack.opened) {
        if (!['input', 'evidence'].includes(entry.record.kind)) continue;
        if (opened.has(key)) fail(); opened.set(key, entry); files.push(Object.freeze({ ...entry.record }));
      }
      for (const key of [...catalogue.inputs, ...catalogue.sourceInputs]) {
        const source = datasetSourcePath(key, { root, mapAssetsDir, gameDataDir });
        if (!source.optional && !opened.has(key)) fail();
      }
      const allowed = new Set([...catalogue.inputs, ...catalogue.sourceInputs]);
      if ([...opened.keys()].some(key => !allowed.has(key))) fail();
      if (Object.keys(data.values).some(key => catalogue.ruleTextValueKeys.includes(key)) || Object.keys(text.values).some(key => !catalogue.ruleTextValueKeys.includes(key))) fail();
      values = { ...data.values, ...text.values };
      if ([...catalogue.valueKeys, ...catalogue.ruleTextValueKeys].some(key => !Object.hasOwn(values, key))) fail();
      const allowedValues = new Set([...catalogue.valueKeys, ...catalogue.ruleTextValueKeys]);
      if (Object.keys(values).some(key => !allowedValues.has(key))) fail();
      // Generated indexes cannot change meaning without changing the frozen raw
      // inputs whose digest binds storage. Compare the authored transcriptions.
      for (const key of catalogue.inputs.filter(name => /(?:^|\/)legacy-(?:dataset|rules-text)-values\.[^/]+\.json$/.test(name))) {
        const entry = opened.get(key); if (!entry) fail();
        const pack = /legacy-rules-text-values/.test(key) ? text : data;
        const raw = JSON.parse((await inspectFile(pack.root, entry.record, true)).data.toString('utf8'));
        if (raw.schemaVersion !== 1 || !plain(raw.values)) fail();
        for (const [name, value] of Object.entries(decodeDatasetValue(raw.values))) if (!Object.hasOwn(values, name) || !isDeepStrictEqual(values[name], value)) fail();
      }
      const capturedContracts = {};
      for (const key of catalogue.inputs.filter(name => /(?:^|\/)original-rules-ui\.[^/]+\.json$/.test(name))) {
        const entry = opened.get(key); if (!entry) fail();
        const checked = await inspectFile(text.root, entry.record, true);
        capturedContracts[key] = datasetRuleTextContract(JSON.parse(checked.data.toString('utf8')));
      }
      ruleContractHash = datasetRuleContractHash(values, catalogue.ruleContractValueKeys, capturedContracts);
      if (ruleContractHash !== data.manifest.ruleContractHash) fail();
      version = data.manifest.version;
      if (datasetDigest(files, capabilities) !== data.manifest.datasetDigest) fail();
    } else {
      environment = datasetEnvironment(options.environment); capabilities = datasetCapabilities(environment);
      const inheritedSnapshots = options.legacyMetadataSnapshots;
      if (inheritedSnapshots !== undefined && (!plain(inheritedSnapshots) || !plain(options.legacyMetadataFiles) || !digestPattern.test(options.digest ?? ''))) fail();
      let metadata;
      if (options.legacyMetadataFiles !== undefined) {
        if (!plain(options.legacyMetadataFiles)) fail();
        metadata = new Map(Object.entries(options.legacyMetadataFiles));
        for (const [key, filename] of metadata) {
          packRelative(key);
          if (!metadataKeys.includes(key) || !key.endsWith('.json') || typeof filename !== 'string' || !path.isAbsolute(filename)) fail();
          if (inheritedSnapshots === undefined) await safeArtFile(path.dirname(filename), path.basename(filename));
        }
      } else {
        const resolver = await metadataResolver();
        metadata = new Map();
        for (const key of metadataKeys) { const filename = await resolver.file(key); if (filename) metadata.set(key, filename); }
      }
      legacyMetadataFiles = Object.freeze(Object.fromEntries(metadata));
      if (inheritedSnapshots !== undefined && (Object.keys(inheritedSnapshots).length !== metadata.size
        || Object.keys(inheritedSnapshots).some(key => !metadata.has(key)))) fail();
      legacyMetadataSnapshots = {};
      for (const key of [...catalogue.inputs, ...catalogue.sourceInputs]) {
        if (key.startsWith('local-map/') && !metadata.has(key)) continue;
        if (metadata.has(key) && inheritedSnapshots !== undefined) {
          const snapshot = inheritedSnapshots[key];
          if (!plain(snapshot) || Object.keys(snapshot).length !== 3 || !Number.isSafeInteger(snapshot.bytes) || snapshot.bytes < 0
            || snapshot.bytes > DATASET_LIMITS.fileBytes || !digestPattern.test(snapshot.sha256 ?? '') || typeof snapshot.data !== 'string'
            || snapshot.data.length !== Math.ceil(snapshot.bytes / 3) * 4) fail();
          const snapshotData = Buffer.from(snapshot.data, 'base64');
          if (snapshotData.length !== snapshot.bytes || snapshotData.toString('base64') !== snapshot.data || sha(snapshotData) !== snapshot.sha256) fail();
          const record = Object.freeze({ path: key, bytes: snapshot.bytes, sha256: snapshot.sha256, kind: 'input' });
          opened.set(key, { filename: metadata.get(key), snapshotData, record }); files.push(record);
          legacyMetadataSnapshots[key] = Object.freeze({ ...snapshot });
          continue;
        }
        const source = key.startsWith('local-map/')
          ? { root: path.dirname(metadata.get(key)), relative: path.basename(metadata.get(key)), optional: false }
          : datasetSourcePath(key, { root, mapAssetsDir, gameDataDir });
        try {
          const { data: snapshotData, ...entry } = await inspectFile(source.root, { path: source.relative }, metadata.has(key));
          const record = Object.freeze({ path: key, bytes: entry.bytes, sha256: entry.sha256, kind: catalogue.sourceInputs.includes(key) ? 'evidence' : 'input' });
          opened.set(key, { ...entry, record }); files.push(record);
          if (snapshotData) legacyMetadataSnapshots[key] = Object.freeze({ bytes: record.bytes, sha256: record.sha256, data: snapshotData.toString('base64') });
        } catch (error) { if (!source.optional || error.code !== 'ENOENT') throw error; }
      }
      legacyMetadataSnapshots = Object.freeze(legacyMetadataSnapshots);
    }
    const digest = datasetDigest(files, capabilities);
    if (options.digest !== undefined && options.digest !== digest) fail();
    if (installed && (installed.profile.datasetDigest !== digest || installed.profile.ruleContractHash !== ruleContractHash)) fail();
    const legacyGameDefaults = installed?.profile.gameDefaults ?? await loadGameDefaults('duo-legacy');
    const provider = {
      gameDefaults: legacyGameDefaults,
      ...DATASET_CONTRACT, id: DATASET_CONTRACT.datasetId, contractVersion: DATASET_CONTRACT.datasetContractVersion, digest, capabilities, overlayOrder: DATASET_OVERLAY_ORDER, environment, ruleContractHash, packed,
      ...(installed ? { capabilities: Object.freeze({ ...capabilities, features: Object.freeze({ originalSync: false, gallery: false, projectUpdates: false }) }),
        materializeValues: () => encodeDatasetValue(values) } : {}),
      files: Object.freeze(files),
      status: () => ({ id: DATASET_CONTRACT.datasetId, kind: 'data', version, health: 'healthy', digest, contractVersion: DATASET_CONTRACT.datasetContractVersion }),
      async metadataBytes(key) {
        if (!metadataKeys.includes(key)) return null;
        if (packed) return opened.has(key) ? provider.bytes(key) : null;
        // Optional legacy display metadata retains late-import availability.
        // Resolve current local files through the fixed operator/art choices;
        // this does not alter the startup catalogue, digest or builder snapshot.
        try {
          const resolver = await metadataResolver(), filename = await resolver.file(key);
          if (!filename) return null;
          const expected = resolver.expected(filename);
          const checked = await inspectFile(path.dirname(filename), { path: path.basename(filename), ...(expected ?? {}) }, true);
          return checked.data;
        } catch { return null; }
      },
      sourceFile(key) {
        try {
          packRelative(key); const entry = opened.get(key); if (!entry) fail();
          if (entry.snapshotData) fail(); // A worker snapshot is not a live builder source.
          safeSyncFile(entry.filename); if (fingerprint(lstatSync(entry.filename)) !== entry.fingerprint) fail();
          return entry.filename;
        } catch { throw datasetFailure(); }
      },
      bytes(key) {
        try {
          packRelative(key); const entry = opened.get(key); if (!entry || entry.record.kind === 'evidence') fail();
          if (entry.snapshotData) return Buffer.from(entry.snapshotData);
          safeSyncFile(entry.filename); const before = lstatSync(entry.filename); if (fingerprint(before) !== entry.fingerprint) fail();
          const bytes = readFileSync(entry.filename);
          if (bytes.length !== entry.record.bytes || sha(bytes) !== entry.record.sha256 || fingerprint(lstatSync(entry.filename)) !== entry.fingerprint) fail();
          return bytes;
        } catch { throw datasetFailure(); }
      },
      json(key) { try { if (!parsed.has(key)) parsed.set(key, JSON.parse(provider.bytes(key).toString('utf8'))); return parsed.get(key); } catch { throw datasetFailure(); } },
      value(key, fallback) {
        if (packed) { if (!Object.hasOwn(values, key)) fail(); return values[key]; }
        if (typeof fallback === 'function') return fallback(); // Only transcription before the tracked value records exist.
        if (!trackedValues) {
          trackedValues = {};
          for (const name of catalogue.inputs.filter(name => /(?:^|\/)legacy-(?:dataset|rules-text)-values\.[^/]+\.json$/.test(name))) {
            const snapshot = provider.json(name); if (snapshot.schemaVersion !== 1 || !plain(snapshot.values)) fail();
            const decoded = decodeDatasetValue(snapshot.values);
            for (const [valueKey, entry] of Object.entries(decoded)) { if (Object.hasOwn(trackedValues, valueKey)) fail(); trackedValues[valueKey] = entry; }
          }
        }
        if (!Object.hasOwn(trackedValues, key)) fail(); return trackedValues[key];
      },
      workerSelection: () => ({ root, packsDir, selection: structuredClone(receipt ?? { schemaVersion: 1, data: null }), mapAssetsDir, gameDataDir, environment, digest,
        ...(installed ? { profilePath: installed.profilePath, profileSha256: installed.profileSha256 } : {}),
        ...(!packed ? { legacyMetadataFiles, legacyMetadataSnapshots, legacyMetadataMapAssetsDir: operatorMapAssetsDir ?? null } : {}) }),
      serialize: () => provider.workerSelection(),
    };
    return Object.freeze(provider);
  } catch (error) { if (error.code === 'DATASET_PACK_INVALID') throw error; throw datasetFailure(); }
}
