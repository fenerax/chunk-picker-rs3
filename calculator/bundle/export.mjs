import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { encode } from './codec.mjs';
import { auditInputs } from './audit.mjs';
import { CONTRACT_VERSION, sha256, relativeFile, loadBundle } from './load.mjs';

/** Build the same init boundary as the server, without opening a save/store. */
export async function defaultInit(dataset) {
  const [{ loadDatasetInputs }, pipeline, { buildWorld }] = await Promise.all([
    import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'), import('../../app/data/world.mjs'),
  ]);
  const { definitionBytes } = await loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(definitionBytes), dataset);
  const world = buildWorld(definitions, { dataset, reviewedOverlays: true });
  return { definitions, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: pipeline.preparedDefinitionStages(definitions),
    world: { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) }, extraRules: [] };
}

export async function exportBundle(directory, { dataset, init } = {}) {
  const started = performance.now();
  dataset ??= (await import('../../app/dataset-runtime.mjs')).selectedDataset;
  init ??= await defaultInit(dataset);
  if (init.datasetDigest !== dataset.digest) throw new Error('Calculator bundle dataset mismatch.');
  const definitions = init.definitionBytes === undefined ? init.definitions
    : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(init.definitionBytes));
  if (!definitions) throw new TypeError('Calculator definitions are required.');
  // Paths in a legacy worker selection are host-specific. Bundle identity is
  // portable; the preload resolves it without consulting any source path.
  const { definitionBytes, ...fields } = init;
  const portableInit = { ...fields, definitions, datasetSelection: { datasetId: dataset.datasetId, digest: dataset.digest } };
  const audit = await auditInputs(dataset);
  const jsonFiles = audit.inputs.filter(row => row.kind === 'json').map(row => row.key);
  const valueFiles = dataset.datasetId === 'duo-legacy'
    ? dataset.files.filter(row => /(?:^|\/)legacy-(?:dataset|rules-text)-values\.[^/]+\.json$/.test(row.path)).map(row => row.path)
    : ['values.json'];
  if (!valueFiles.length) throw new Error('Calculator bundle value source missing.');
  const metadataFields = ['datasetId', 'datasetContractVersion', 'identityNamespace', 'coordinateSystem', 'corePackApi', 'id',
    'contractVersion', 'digest', 'capabilities', 'overlayOrder', 'gameDefaults', 'definitionOverlays', 'ruleContractHash', 'packed', 'files'];
  const metadata = { ...Object.fromEntries(metadataFields.filter(key => dataset[key] !== undefined).map(key => [key, dataset[key]])),
    status: dataset.status(), valueFiles, jsonFiles };
  const root = path.resolve(directory);
  // A fresh directory prevents overwriting a bundle or an unrelated destination.
  await mkdir(root, { recursive: false });
  const files = [];
  async function put(file, data) {
    relativeFile(file);
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), data, { flag: 'wx', mode: 0o600 });
    files.push({ file, sha256: sha256(data), bytes: data.length });
  }
  const putJSON = (file, value) => put(file, Buffer.from(JSON.stringify(value) + '\n'));
  await putJSON('init.json', encode(portableInit));
  await putJSON('dataset.json', metadata);
  await putJSON('audit.json', audit);
  for (const key of new Set([...jsonFiles, ...valueFiles])) {
    if (key === 'values.json') await putJSON(key, { schemaVersion: 1, values: await dataset.materializeValues() });
    else await put(key, dataset.bytes(key));
  }
  await putJSON('manifest.json', { contractVersion: CONTRACT_VERSION, datasetContractVersion: dataset.datasetContractVersion,
    datasetDigest: dataset.digest, files: [...files].sort((a, b) => a.file.localeCompare(b.file, 'en')) });
  const loaded = await loadBundle(root, { expectedDatasetDigest: dataset.digest });
  return { files: loaded.manifest.files.length + 1, bytes: loaded.bytes, datasetDigest: dataset.digest,
    manifestSha256: loaded.manifestSha256, exportMs: performance.now() - started, inputs: audit.inputs.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), outputIndex = args.indexOf('--output'), initIndex = args.indexOf('--init');
    if (outputIndex < 0 || !args[outputIndex + 1] || args.some((arg, index) => !['--output', '--init'].includes(arg) && !['--output', '--init'].includes(args[index - 1]))) throw new Error('Invalid options.');
    const init = initIndex < 0 ? undefined : (await import('./codec.mjs')).decode(JSON.parse(await readFile(args[initIndex + 1], 'utf8')));
    console.log(JSON.stringify(await exportBundle(args[outputIndex + 1], { init })));
  } catch { console.error('Calculator bundle export failed.'); process.exitCode = 1; }
}
