import path from 'node:path';
import { mkdir, open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safeArtFile, PACK_VERSION } from '../app/packs.mjs';
import { datasetSourcePath } from '../app/datasets.mjs';

const defaultSource = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const invalid = () => new TypeError('Invalid private dataset profile input.');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

async function readBounded(root, relative, limit) {
  const filename = await safeArtFile(root, relative);
  const handle = await open(filename, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw invalid();
    const chunks = []; let length = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      length += chunk.length;
      if (length > limit) throw invalid();
      chunks.push(chunk);
    }
    await safeArtFile(root, relative);
    const after = await lstat(filename), current = await handle.stat();
    for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      if (before[field] !== after[field] || before[field] !== current[field]) throw invalid();
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

async function safeOutputParent(directory) {
  let ancestor = directory;
  while (true) {
    try { await safeArtFile(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  await mkdir(directory, { recursive: true });
  await safeArtFile(directory);
}

/** Private operator tool: freeze configuration only; never open gameplay storage. */
export async function buildDatasetProfile({ packsDir, output, sourceRoot = defaultSource } = {}) {
  if (typeof packsDir !== 'string' || !packsDir || typeof output !== 'string' || !output) throw invalid();
  packsDir = path.resolve(packsDir); output = path.resolve(output); sourceRoot = path.resolve(sourceRoot);
  if (['app', 'resources'].some(name => inside(path.join(sourceRoot, name), output)) || inside(packsDir, output)) {
    throw new TypeError('Profile output must stay outside source app/resources and installed packs.');
  }
  const selection = JSON.parse((await readBounded(packsDir, 'selection.json', 65536)).toString('utf8'));
  const choice = selection?.data;
  if (selection?.schemaVersion !== 1 || choice?.id !== 'duo-data' || !PACK_VERSION.test(choice.version ?? '')
    || !digestPattern.test(choice.sha256 ?? '')) throw invalid();
  const bytes = await readBounded(packsDir, `duo-data/${choice.version}/pack.json`, 8 * 1024 ** 2);
  if (sha256(bytes) !== choice.sha256) throw invalid();
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.id !== 'duo-data' || manifest.kind !== 'data' || manifest.version !== choice.version
    || manifest.distribution !== 'private-local' || manifest.requires?.datasetId !== 'duo-legacy'
    || !digestPattern.test(manifest.datasetDigest ?? '') || !digestPattern.test(manifest.ruleContractHash ?? '')) throw invalid();
  const catalogueModule = await safeArtFile(sourceRoot, 'app/dataset-inputs.mjs');
  const defaultsModule = await safeArtFile(sourceRoot, 'app/legacy-game-defaults.mjs');
  const catalogue = await import(pathToFileURL(catalogueModule).href);
  const { legacyGameDefaults } = await import(pathToFileURL(defaultsModule).href);
  const profile = {
    schemaVersion: 1, datasetId: 'duo-legacy', datasetDigest: manifest.datasetDigest, ruleContractHash: manifest.ruleContractHash,
    catalogue: { inputs: catalogue.DATASET_INPUTS, sourceInputs: catalogue.DATASET_SOURCE_INPUTS,
      valueKeys: catalogue.DATASET_VALUE_KEYS, ruleTextValueKeys: catalogue.RULE_TEXT_VALUE_KEYS,
      ruleContractValueKeys: catalogue.DATASET_RULE_CONTRACT_VALUE_KEYS,
      ...(catalogue.DATASET_DEFINITION_OVERLAYS?.length ? { definitionOverlays: catalogue.DATASET_DEFINITION_OVERLAYS } : {}) },
    gameDefaults: legacyGameDefaults,
  };
  if (Object.values(profile.catalogue).some(rows => !Array.isArray(rows) || rows.some(row => typeof row !== 'string'))
    || !legacyGameDefaults || !Array.isArray(legacyGameDefaults.members)) throw invalid();
  // Fail before suites/gallery if a source catalogue belongs to a future pack.
  // Optional cache inputs retain the resolver's existing absence semantics.
  const textChoice = selection.rulesText;
  if (textChoice?.id !== 'duo-rules-text' || !PACK_VERSION.test(textChoice.version ?? '')
    || !digestPattern.test(textChoice.sha256 ?? '')) throw invalid();
  const textBytes = await readBounded(packsDir, `duo-rules-text/${textChoice.version}/pack.json`, 8 * 1024 ** 2);
  if (sha256(textBytes) !== textChoice.sha256) throw invalid();
  const textManifest = JSON.parse(textBytes.toString('utf8'));
  if (textManifest.schemaVersion !== 1 || textManifest.id !== textChoice.id || textManifest.kind !== 'rules-text'
    || textManifest.version !== textChoice.version || textManifest.distribution !== 'private-local'
    || textManifest.requires?.datasetId !== profile.datasetId
    || textManifest.ruleContractHash !== profile.ruleContractHash
    || !Array.isArray(manifest.files) || !Array.isArray(textManifest.files)) throw invalid();
  const available = new Set([...manifest.files, ...textManifest.files]
    .filter(record => ['input', 'evidence'].includes(record.kind)).map(record => record.path));
  for (const key of [...profile.catalogue.inputs, ...profile.catalogue.sourceInputs]) {
    if (!datasetSourcePath(key, { root: sourceRoot }).optional && !available.has(key)) {
      throw new TypeError('Selected packs lack a required profile input.');
    }
  }
  const encoded = Buffer.from(`${JSON.stringify(profile, null, 2)}\n`);
  await safeOutputParent(path.dirname(output));
  const handle = await open(output, 'wx', 0o600);
  try { await handle.writeFile(encoded); } finally { await handle.close(); }
  return { output, sha256: sha256(encoded), counts: Object.fromEntries(Object.entries(profile.catalogue).map(([key, rows]) => [key, rows.length])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const names = new Map([['--packs-dir', 'packsDir'], ['--output', 'output'], ['--source-root', 'sourceRoot']]);
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = names.get(process.argv[index]), value = process.argv[index + 1];
      if (!key || !value || Object.hasOwn(options, key)) throw invalid();
      options[key] = value;
    }
    const result = await buildDatasetProfile(options);
    process.stdout.write(`${JSON.stringify({ sha256: result.sha256, counts: result.counts })}\n`);
  } catch {
    process.stderr.write('Private dataset profile build failed.\n'); process.exitCode = 1;
  }
}
