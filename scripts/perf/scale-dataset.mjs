// Deterministic synthetic companion for load profiling. It scales open-f2p's
// shape (definitions, task map, catalogue rows, values, rule text) into a
// hash-pinned duo-legacy data pack, rules-text pack and installed profile, the
// same seams a private dataset uses. Every name and number is replaced by a
// same-shaped synthetic token; only field names and structure are kept.
//
//   node scripts/perf/scale-dataset.mjs --out <empty dir> [--target-mb 130 | --scale 116] [--seed 1]
//
// companion.json uses the RS3_PERF_COMPANION_ROOT receipt format (scripts/perf/inputs.mjs);
// profile it with scripts/perf/dataset-load.mjs.
import path from 'node:path';
import { mkdir, readdir, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolveOpenF2P } from '../../app/open-f2p.mjs';
import { DATASET_CONTRACT, DATASET_OVERLAY_ORDER, datasetCapabilities, datasetEnvironment, datasetDigest,
  datasetRuleContractHash, datasetRuleTextContract, decodeDatasetValue, encodeDatasetValue } from '../../app/datasets.mjs';
import { seededRandom } from './inputs.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const prefix = 'app/datasets/open-f2p/';
export const SCALED_PATHS = Object.freeze({
  definitions: 'app/data/original-definitions.synthetic.v1.json',
  taskMap: 'app/data/original-task-map.synthetic.v1.json',
  selection: 'app/data/original-data.2026-10-13.v1.json',
  rulesUi: 'app/data/original-rules-ui.2026-10-08.v1.json',
  dataValues: 'app/data/legacy-dataset-values.synthetic.v1.json',
  textValues: 'app/data/legacy-rules-text-values.synthetic.v1.json',
  overlay: 'app/data/definition-overlay.synthetic.v1.json',
  selectedRetained: 'app/data/selected-retained-corrections.synthetic.v1.json',
  gzipCatalogue: 'app/data/synthetic-catalogue-gzip.v1.json.gz',
  evidence: 'app/synthetic-evidence.mjs',
});
const catalogueFiles = 4;
const cataloguePath = index => `app/data/synthetic-catalogue-${index}.v1.json`;
// Measured generator output: fixed stubs plus bytes per open-f2p-sized replica.
const fixedBytes = 0.37e6, replicaBytes = 1.09e6;

function preservedKeys(documents, structural, extra) {
  const counts = new Map(), values = new Set();
  const visit = value => {
    if (Array.isArray(value)) { for (const row of value) visit(row); return; }
    if (typeof value === 'string') { values.add(value); return; }
    if (!plain(value)) return;
    for (const [key, row] of Object.entries(value)) { counts.set(key, (counts.get(key) ?? 0) + 1); visit(row); }
  };
  for (const document of documents) visit(document);
  const preserved = new Set(extra);
  for (const document of structural) for (const key of Object.keys(document)) preserved.add(key);
  for (const [key, count] of counts) if (count >= 3 && !values.has(key)) preserved.add(key);
  return preserved;
}

/** One replica's consistent renaming: equal source tokens stay equal, so
 * cross references survive, and lengths, punctuation and types are kept. */
function synthesizer(seed, replica, preserved) {
  const tokens = new Map(), random = seededRandom((seed * 7919 + replica * 104729) >>> 0);
  const token = run => {
    let value = tokens.get(run);
    if (value !== undefined) return value;
    const digest = createHash('sha256').update(`${seed}\0${replica}\0${run}`).digest();
    value = '';
    for (let index = 0; index < run.length; index++) {
      const code = run.charCodeAt(index), byte = (digest[index % 32] + index * 131) & 255;
      if (code >= 48 && code <= 57) value += String.fromCharCode(48 + (index === 0 && run.length > 1 ? 1 + byte % 9 : byte % 10));
      else value += String.fromCharCode((code >= 65 && code <= 90 ? 65 : 97) + byte % 26);
    }
    tokens.set(run, value);
    return value;
  };
  // The duo profile needs permanent task IDs; preserve that structural prefix.
  const text = value => preserved.has(value) ? value : value.startsWith('rs3:open-f2p:')
    ? `rs3:task:synthetic:${value.slice('rs3:open-f2p:'.length).replace(/[A-Za-z]+|[0-9]+/g, token)}`
    : value.replace(/[A-Za-z]+|[0-9]+/g, token);
  const number = value => Number.isInteger(value) ? Math.max(value < 0 ? value - 2 : 0, value + Math.floor(random() * 5) - 2)
    : Math.round(value * (0.5 + random()) * 1e6) / 1e6;
  const map = value => {
    if (typeof value === 'string') return text(value);
    if (typeof value === 'number') return number(value);
    if (Array.isArray(value)) return value.map(map);
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, row]) => [text(key), map(row)]));
    return value;
  };
  return map;
}

function merge(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) { for (const row of source) target.push(row); return target; }
  if (plain(target) && plain(source)) {
    for (const [key, row] of Object.entries(source)) target[key] = Object.hasOwn(target, key) ? merge(target[key], row) : row;
    return target;
  }
  return target;
}

const json = value => Buffer.from(`${JSON.stringify(value)}\n`);
async function writeChunked(filename, write) {
  const handle = await open(filename, 'wx');
  try { await write(async text => { await handle.write(text); }); } finally { await handle.close(); }
}
async function hashFile(filename) {
  const hash = createHash('sha256'); let bytes = 0;
  const handle = await open(filename, 'r');
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length; } }
  finally { await handle.close(); }
  return { bytes, sha256: hash.digest('hex') };
}

/** Writes packs/, profile.json and companion.json into an empty directory.
 * `edit(path, bytes)` lets tests change one file before it is hash-pinned. */
export async function writeScaledCompanion(out, { scale = 1, seed = 1, version, edit = (_path, bytes) => bytes } = {}) {
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 1000) throw new RangeError('Scale must be 1 to 1000.');
  const root = path.resolve(out);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error('Choose an empty output directory.');
  const template = resolveOpenF2P();
  const templateDefinitions = template.json(`${prefix}definitions.json`), templateTaskMap = template.json(`${prefix}task-map.json`);
  const templateRows = template.json(`${prefix}wiki-derived/dataset.json`);
  const preserved = preservedKeys([templateDefinitions, templateTaskMap, templateRows], [templateDefinitions, templateRows],
    Object.keys(templateDefinitions.challenges));
  const packVersion = version ?? `1.0.0-synthetic.${scale}.${seed}`;
  const dataRoot = path.join(root, 'packs', 'duo-data', packVersion), textRoot = path.join(root, 'packs', 'duo-rules-text', packVersion);
  const records = { data: [], text: [] };
  async function put(pack, relative, bytes, kind) {
    const filename = path.join(pack === 'data' ? dataRoot : textRoot, ...relative.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    const content = edit(relative, bytes);
    await writeFile(filename, content, { flag: 'wx' });
    records[pack].push({ path: relative, bytes: content.length, sha256: sha(content), kind });
  }

  // Definitions and the task map merge into one catalogue, as a full dataset does.
  const definitions = {}, taskMap = {};
  const catalogueHandles = [];
  for (let index = 0; index < catalogueFiles; index++) {
    const filename = path.join(dataRoot, ...cataloguePath(index).split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    catalogueHandles.push({ filename, rows: [] });
  }
  for (let replica = 0; replica < scale; replica++) {
    const map = synthesizer(seed, replica, preserved);
    merge(definitions, map(templateDefinitions));
    merge(taskMap, map(templateTaskMap));
    catalogueHandles[replica % catalogueFiles].rows.push(replica);
  }
  // Large catalogues hold whole synthetic replicas of the row shape, streamed.
  for (const [index, file] of catalogueHandles.entries()) {
    const relative = cataloguePath(index);
    await writeChunked(file.filename, async write => {
      await write('{"schemaVersion":1,"replicas":[');
      for (const [position, replica] of file.rows.entries()) {
        await write(`${position ? ',' : ''}${JSON.stringify(synthesizer(seed, replica, preserved)(templateRows))}`);
      }
      await write(']}\n');
    });
    const checked = await hashFile(file.filename);
    records.data.push({ path: relative, ...checked, kind: 'input' });
  }
  await put('data', SCALED_PATHS.gzipCatalogue, gzipSync(json({ schemaVersion: 1, replicas: [synthesizer(seed, scale, preserved)(templateRows)] })), 'input');

  // Reviewed-correction shapes touch a proportional number of records.
  const labels = Object.entries(definitions.challenges).flatMap(([category, rows]) => Object.keys(rows).map(label => [category, label]));
  const hash = value => sha(JSON.stringify(value));
  const counts = { retained: 13 * scale, metadata: 13 * scale, overlay: 17 * scale, selected: 6 * scale };
  const take = (start, count) => labels.slice(start, start + count);
  const retainedCorrection = ([category, label]) => {
    const record = definitions.challenges[category][label];
    return { category, label, beforeRecordSha256: hash(record),
      changes: [{ field: 'Description', beforePresent: Object.hasOwn(record, 'Description'), before: record.Description ?? null, after: `${record.Description ?? ''} Synthetic note.` }] };
  };
  const retained = take(0, counts.retained).map(retainedCorrection);
  // Overlay-selected corrections, some repeating reviewed ones, as selections do.
  const selected = take(counts.retained + counts.metadata + counts.overlay, counts.selected).map(retainedCorrection);
  const metadata = take(counts.retained, counts.metadata).filter(([category, label]) => !Object.hasOwn(definitions.challenges[category][label], 'Difficulty'))
    .map(([category, label]) => ({ category, label, changes: [{ field: 'Difficulty', before: null, after: 'Synthetic' }] }));
  const patches = take(counts.retained + counts.metadata, counts.overlay).map(([category, label]) => {
    const before = definitions.challenges[category][label].Description;
    return { path: ['challenges', category, label, 'Description'], beforePresent: before !== undefined,
      ...(before !== undefined ? { before, beforeRecordSha256: hash(before) } : {}), afterPresent: true, after: `${before ?? ''} Synthetic review.` };
  });
  // The normal server consumes topology counts and identity history even
  // when a synthetic companion has no walking edges or historical aliases.
  const stub = key => ({ ...template.json(key), ...(key.includes('cache-walkability.') ? { summary: { doors: 0, conditionalMorphs: 0 } } : {}) });
  const stubs = new Map(template.files.filter(row => row.kind === 'input' && row.path.startsWith('app/') && !row.path.startsWith(prefix)
    && row.path !== SCALED_PATHS.selection && row.path !== SCALED_PATHS.rulesUi).map(row => [row.path, stub(row.path)]));
  stubs.set('app/data/legacy-task-history.json', { schemaVersion: 1, currentNextIndex: 1, mappings: {} });
  stubs.get('app/data/retained-task-corrections.2026-10-09.v1.json').corrections = retained;
  stubs.get('app/data/metadata-corrections.2026-10-08.v1.json').corrections = metadata;

  // Values keep open-f2p's authored keys; identities follow the synthetic tasks.
  const values = decodeDatasetValue(template.materializeValues());
  values['app/data/identity-registry.mjs#authoredTasks'] = labels.map(([category, label]) => [definitions.challenges[category][label].PickerId ?? `synthetic:${label}`, category, label]);
  const textKeys = Object.keys(values).filter(key => key.endsWith(':presentation'));
  const dataValues = Object.fromEntries(Object.entries(values).filter(([key]) => !textKeys.includes(key)));
  const textValues = Object.fromEntries(textKeys.map(key => [key, values[key]]));
  const contractKeys = Object.keys(values).filter(key => /ruleContract|:contract|actualDefaults|originalRuleDefaults|originalRulePresets/.test(key));

  const definitionBytes = json(definitions), taskMapBytes = json(taskMap);
  await put('data', SCALED_PATHS.definitions, definitionBytes, 'input');
  await put('data', SCALED_PATHS.taskMap, taskMapBytes, 'input');
  await put('data', SCALED_PATHS.selection, json({ schemaVersion: 1, version: `synthetic-${scale}`,
    definitions: { path: SCALED_PATHS.definitions, sha256: sha(definitionBytes) }, taskMap: { path: SCALED_PATHS.taskMap, sha256: sha(taskMapBytes) } }), 'input');
  for (const [key, value] of stubs) await put('data', key, json(value), 'input');
  await put('data', SCALED_PATHS.overlay, json({ schemaVersion: 1, id: 'synthetic-review', version: '1', guards: [], patches,
    retainedTaskCorrections: [SCALED_PATHS.selectedRetained] }), 'input');
  await put('data', SCALED_PATHS.selectedRetained, json({ schemaVersion: 1, corrections: [...selected, ...retained.slice(0, 3 * scale)] }), 'input');
  // The raw transcription is formatted differently from the generated snapshot.
  await put('data', SCALED_PATHS.dataValues, Buffer.from(`${JSON.stringify({ schemaVersion: 1, values: encodeDatasetValue(dataValues) }, null, 1)}\n`), 'input');
  await put('data', SCALED_PATHS.evidence, Buffer.from('// Synthetic builder evidence; never imported.\nexport const synthetic = true;\n'), 'evidence');
  await put('data', 'generated/dataset-values.json', json({ schemaVersion: 1, values: encodeDatasetValue(dataValues) }), 'generated');
  const rulesUi = template.json(SCALED_PATHS.rulesUi);
  await put('text', SCALED_PATHS.rulesUi, json(rulesUi), 'input');
  await put('text', SCALED_PATHS.textValues, Buffer.from(`${JSON.stringify({ schemaVersion: 1, values: encodeDatasetValue(textValues) }, null, 1)}\n`), 'input');
  await put('text', 'generated/rules-text-values.json', json({ schemaVersion: 1, values: encodeDatasetValue(textValues) }), 'generated');
  for (const pack of ['data', 'text']) await put(pack, 'provenance.json', json({ schemaVersion: 1, synthetic: true, generator: 'scripts/perf/scale-dataset.mjs', seed, scale }), 'provenance');

  const environment = datasetEnvironment({}), capabilities = datasetCapabilities(environment);
  const decoded = decodeDatasetValue(encodeDatasetValue(values));
  const ruleContractHash = datasetRuleContractHash(decoded, contractKeys, { [SCALED_PATHS.rulesUi]: datasetRuleTextContract(rulesUi) });
  const definitionOverlays = [SCALED_PATHS.overlay];
  const inputs = [...records.data, ...records.text].filter(row => row.kind === 'input' || row.kind === 'evidence');
  const digest = datasetDigest(inputs, capabilities, definitionOverlays);
  const manifest = (pack, id, kind) => ({ schemaVersion: 1, id, kind, version: packVersion, distribution: 'private-local',
    requires: { ...DATASET_CONTRACT }, catalogues: { values: pack === 'data' ? 'generated/dataset-values.json' : 'generated/rules-text-values.json' },
    provenance: 'provenance.json', ruleContractHash, files: records[pack],
    ...(pack === 'data' ? { overlayOrder: DATASET_OVERLAY_ORDER, environment, capabilities, datasetDigest: digest } : {}) });
  const selection = { schemaVersion: 1 };
  for (const [pack, id, kind, key] of [['data', 'duo-data', 'data', 'data'], ['text', 'duo-rules-text', 'rules-text', 'rulesText']]) {
    const bytes = json(manifest(pack, id, kind));
    await writeFile(path.join(pack === 'data' ? dataRoot : textRoot, 'pack.json'), bytes, { flag: 'wx' });
    selection[key] = { id, version: packVersion, sha256: sha(bytes) };
  }
  const profile = json({ schemaVersion: 1, datasetId: 'duo-legacy', datasetDigest: digest, ruleContractHash,
    catalogue: { inputs: inputs.filter(row => row.kind === 'input').map(row => row.path), sourceInputs: inputs.filter(row => row.kind === 'evidence').map(row => row.path),
      valueKeys: Object.keys(dataValues), ruleTextValueKeys: textKeys, ruleContractValueKeys: contractKeys, definitionOverlays },
    gameDefaults: { members: [{ id: 'explorer-1', name: 'Explorer 1' }, { id: 'explorer-2', name: 'Explorer 2' }], masterLabel: 'Administrator' } });
  await writeFile(path.join(root, 'profile.json'), profile, { flag: 'wx' });
  await writeFile(path.join(root, 'selection.json'), json(selection), { flag: 'wx' });
  const receipt = { packs: selection, profile: { path: 'profile.json', sha256: sha(profile) } };
  await writeFile(path.join(root, 'companion.json'), json(receipt), { flag: 'wx' });
  const inputBytes = inputs.filter(row => row.kind === 'input').reduce((total, row) => total + row.bytes, 0);
  return { root, scale, seed, digest, ruleContractHash, inputBytes, files: records.data.length + records.text.length,
    corrections: { retained: retained.length, metadata: metadata.length, overlay: patches.length, selected: selected.length },
    environment: { RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(root, 'profile.json'), RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256,
      RS3_PACKS_DIR: path.join(root, 'packs'), RS3_PACK_SELECTION: path.join(root, 'selection.json') } };
}

export const scaleForMegabytes = megabytes => Math.max(1, Math.round((megabytes * 1e6 - fixedBytes) / replicaBytes));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const option = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };
  const out = option('out');
  if (!out) throw new Error('Pass --out <empty directory>.');
  const scale = option('scale') ? Number(option('scale')) : scaleForMegabytes(Number(option('target-mb') ?? 130));
  const result = await writeScaledCompanion(out, { scale, seed: Number(option('seed') ?? 1) });
  console.log(JSON.stringify({ ...result, inputMiB: Math.round(result.inputBytes / 1048576 * 10) / 10 }, null, 2));
}
