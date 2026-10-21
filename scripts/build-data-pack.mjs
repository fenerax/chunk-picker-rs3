import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, lstat, rm, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safeArtFile, PACK_VERSION } from '../app/packs.mjs';
import { resolveDataset, datasetCatalogue, datasetSourcePath, datasetRuleContractHash, datasetRuleTextContract, encodeDatasetValue, DATASET_CONTRACT } from '../app/datasets.mjs';

const defaultSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const inside = (parent, child) => { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
async function safeOutputAncestor(directory) {
  let current = path.resolve(directory);
  while (true) { try { await safeArtFile(current); return; } catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(current); if (parent === current) throw error; current = parent; } }
}
async function snapshotValues(sourceRoot, provider, operatorMapAssetsDir) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'picker-dataset-values-'));
  try {
    const output = path.join(temporary, 'values.json'), ignoredSelection = path.join(temporary, 'snapshot-selection.json');
    const runtime = pathToFileURL(path.join(sourceRoot, 'app', 'dataset-runtime.mjs')).href;
    const script = `import {writeFile} from 'node:fs/promises'; const runtime=await import(${JSON.stringify(runtime)}); const catalogue=await import(${JSON.stringify(pathToFileURL(path.join(sourceRoot, "app", "dataset-inputs.mjs")).href)}); const values=await runtime.materializeDatasetValues(); for (const key of new Set([...catalogue.DATASET_VALUE_KEYS, ...catalogue.RULE_TEXT_VALUE_KEYS])) if (!Object.hasOwn(values,key)) values[key]=(await import(${JSON.stringify(pathToFileURL(path.join(sourceRoot,"app","datasets.mjs")).href)})).encodeDatasetValue(runtime.selectedDataset.value(key)); await writeFile(${JSON.stringify(output)},JSON.stringify(values));`;
    const descriptor = provider.workerSelection();
    await writeFile(ignoredSelection, JSON.stringify(descriptor.selection));
    const environment = { ...process.env, ...provider.environment, RS3_PACKS_DIR: descriptor.packsDir, RS3_PACK_SELECTION: ignoredSelection, RS3_GAME_DATA_DIR: descriptor.gameDataDir };
    if (operatorMapAssetsDir === undefined) delete environment.RS3_MAP_ASSETS_DIR;
    else environment.RS3_MAP_ASSETS_DIR = operatorMapAssetsDir;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      cwd: sourceRoot, windowsHide: true, maxBuffer: 1024 * 1024,
      env: environment,
    });
    return JSON.parse(await readFile(output, 'utf8'));
  } catch { throw new Error('Dataset value snapshot failed.'); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
async function installPack(packsDir, id, version, files, values, ruleContractHash, provider) {
  await mkdir(path.join(packsDir, id), { recursive: true }); await safeArtFile(path.join(packsDir, id));
  const directory = path.join(packsDir, id, version); await mkdir(directory); // Immutable even after an interrupted installation.
  const records = [];
  for (const { record, source } of files) {
    const target = path.join(directory, ...record.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target);
    const copied = await readFile(target);
    if (copied.length !== record.bytes || sha(copied) !== record.sha256) throw new Error('Dataset source changed while copying.');
    records.push({ ...record });
  }
  async function generated(relative, value, kind) {
    const bytes = encode(value), filename = path.join(directory, ...relative.split('/'));
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes, { flag: 'wx' });
    records.push({ path: relative, bytes: bytes.length, sha256: sha(bytes), kind });
  }
  await generated('indexes/values.json', { schemaVersion: 1, values: encodeDatasetValue(values) }, 'generated');
  await generated('provenance.json', { schemaVersion: 1, source: 'frozen-private-checkout', distribution: 'private-local', inputs: files.map(({ record }) => record.path) }, 'provenance');
  const manifest = { schemaVersion: 1, id, kind: id === 'duo-data' ? 'data' : 'rules-text', version, requires: DATASET_CONTRACT,
    distribution: 'private-local', ruleContractHash, ...(id === 'duo-data' ? { datasetDigest: provider.digest, capabilities: provider.capabilities, overlayOrder: provider.overlayOrder, environment: provider.environment } : {}),
    catalogues: { values: 'indexes/values.json' }, provenance: 'provenance.json', files: records.sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  const bytes = encode(manifest); await writeFile(path.join(directory, 'pack.json'), bytes, { flag: 'wx' });
  return { directory, manifest, choice: { id, version, sha256: sha(bytes) } };
}

/** Copies the complete frozen input catalogue without reading gameplay storage. */
export async function buildDataPack(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? defaultSource), packsDir = options.packsDir && path.resolve(options.packsDir), version = options.version ?? '1.0.0';
  const rulesTextVersion = options.rulesTextVersion ?? version;
  if (!packsDir || !PACK_VERSION.test(version) || !PACK_VERSION.test(rulesTextVersion)) throw new TypeError('Provide packsDir and semantic versions.');
  const selectionPath = path.resolve(options.selectionPath ?? path.join(packsDir, 'selection.json'));
  const operatorMapAssetsDir = options.mapAssetsDir ?? process.env.RS3_MAP_ASSETS_DIR;
  const mapAssetsDir = path.resolve(operatorMapAssetsDir ?? path.join(sourceRoot, '.local', 'map-assets'));
  const gameDataDir = path.resolve(options.gameDataDir ?? process.env.RS3_GAME_DATA_DIR ?? path.join(sourceRoot, '.local', 'game-data'));
  for (const inputRoot of [path.join(sourceRoot, 'app'), path.join(sourceRoot, 'reference'), path.join(sourceRoot, '.local', 'map-assets'), mapAssetsDir, gameDataDir])
    if ([packsDir, selectionPath].some(output => inside(inputRoot, output))) throw new TypeError('Pack outputs must stay outside dataset input roots.');
  await safeOutputAncestor(packsDir); await safeOutputAncestor(path.dirname(selectionPath));
  const catalogue = await datasetCatalogue(options);
  if (options.includeExplanations) {
    const key = 'app/data/rule-explanations.2026-10-17.v1.json';
    await safeArtFile(sourceRoot, key);
    catalogue.inputs = [...new Set([...catalogue.inputs, key])];
  }
  let sourceSelection = { schemaVersion: 1, data: null };
  try {
    const receipt = JSON.parse(await readFile(await safeArtFile(path.dirname(selectionPath), path.basename(selectionPath)), 'utf8'));
    if (receipt.schemaVersion !== 1) throw new TypeError('Invalid existing pack selection.');
    if (Object.hasOwn(receipt, 'art')) sourceSelection.art = receipt.art;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const providerMapAssetsDir = operatorMapAssetsDir === undefined ? undefined : mapAssetsDir;
  const providerOptions = { ...options, ...catalogue, root: sourceRoot, packsDir, mapAssetsDir: providerMapAssetsDir, gameDataDir, selection: sourceSelection };
  const provider = await resolveDataset(providerOptions);
  const values = options.values ?? await snapshotValues(sourceRoot, provider, providerMapAssetsDir);
  if (!values || typeof values !== 'object' || [...catalogue.valueKeys, ...catalogue.ruleTextValueKeys].some(key => !Object.hasOwn(values, key))) throw new TypeError('Dataset value snapshot is incomplete.');
  const capturedContracts = Object.fromEntries(catalogue.inputs.filter(name => /(?:^|\/)original-rules-ui\.[^/]+\.json$/.test(name)).map(key => [key, datasetRuleTextContract(provider.json(key))]));
  const ruleContractHash = datasetRuleContractHash(values, catalogue.ruleContractValueKeys, capturedContracts);
  const dataValues = Object.fromEntries(catalogue.valueKeys.filter(key => !catalogue.ruleTextValueKeys.includes(key)).map(key => [key, values[key]]));
  const textValues = Object.fromEntries(catalogue.ruleTextValueKeys.map(key => [key, values[key]]));
  const dataFiles = [], textFiles = [];
  for (const record of provider.files) {
    const filename = await provider.sourceFile(record.path);
    const destination = /(?:^|\/)(?:original-rules-ui|legacy-rules-text-values|rule-explanations)\.[^/]+\.json$/.test(record.path) ? textFiles : dataFiles;
    destination.push({ record, source: filename });
  }
  await mkdir(packsDir, { recursive: true }); await safeArtFile(packsDir);
  // Check both immutable version paths before beginning either installation.
  for (const [id, selectedVersion] of [['duo-data',version], ['duo-rules-text',rulesTextVersion]]) {
    try { await lstat(path.join(packsDir, id, selectedVersion)); const error = new Error('Pack version already exists.'); error.code = 'EEXIST'; throw error; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const data = await installPack(packsDir, 'duo-data', version, dataFiles, dataValues, ruleContractHash, provider);
  const rulesText = await installPack(packsDir, 'duo-rules-text', rulesTextVersion, textFiles, textValues, ruleContractHash, provider);
  const selection = { schemaVersion: 1, data: data.choice, rulesText: rulesText.choice };
  await resolveDataset({ ...providerOptions, selection });
  if (options.select !== false) await selectDataPack({ ...providerOptions, selectionPath, selection });
  return { directory: data.directory, rulesTextDirectory: rulesText.directory, manifest: data.manifest, rulesTextManifest: rulesText.manifest, selection, digest: provider.digest, ruleContractHash };
}

/** Preserve unrelated art selection and exact previous receipt bytes. */
export async function selectDataPack(options) {
  const selectionPath = path.resolve(options.selectionPath ?? path.join(options.packsDir, 'selection.json'));
  let prior = null, existing = {};
  try { await safeArtFile(path.dirname(selectionPath), path.basename(selectionPath)); prior = await readFile(selectionPath); existing = JSON.parse(prior.toString('utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const selection = { ...existing, ...options.selection };
  await resolveDataset({ ...options, selection });
  await safeOutputAncestor(path.dirname(selectionPath)); await mkdir(path.dirname(selectionPath), { recursive: true }); await safeArtFile(path.dirname(selectionPath));
  const temporary = `${selectionPath}.${randomUUID()}.tmp`, previousTemporary = `${selectionPath}.${randomUUID()}.previous.tmp`;
  try {
    if (prior) { await writeFile(previousTemporary, prior, { flag: 'wx' }); await rename(previousTemporary, `${selectionPath}.previous`); }
    await writeFile(temporary, encode(selection), { flag: 'wx' }); await rename(temporary, selectionPath);
  } finally { for (const filename of [temporary, previousTemporary]) await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return selection;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, flags = { '--source-root': 'sourceRoot', '--packs-dir': 'packsDir', '--version': 'version', '--rules-text-version':'rulesTextVersion', '--selection': 'selectionPath', '--map-assets': 'mapAssetsDir', '--game-data': 'gameDataDir' };
  try {
    for (let index = 2; index < process.argv.length; index++) {
      const flag = process.argv[index];
      if (flag === '--no-select') options.select = false;
      else if (flag === '--include-explanations') options.includeExplanations = true;
      else if (flags[flag] && process.argv[index + 1]) options[flags[flag]] = process.argv[++index];
      else throw new TypeError('Invalid data-pack builder arguments.');
    }
    const result = await buildDataPack(options);
    console.log(`Built duo-data and duo-rules-text ${result.manifest.version}; ${options.select === false ? 'selection unchanged' : 'selection pinned'}.`);
  } catch (error) { console.error(error.code === 'EEXIST' ? 'Pack version already exists.' : error.message.includes('source changed') ? error.message : 'Data pack build failed. Existing selection is unchanged.'); process.exitCode = 1; }
}
