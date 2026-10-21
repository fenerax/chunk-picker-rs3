import path from 'node:path';
import { mkdir, readdir, open, copyFile, writeFile, rename, lstat, realpath, readFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ART_BINDINGS, TASK_ARTWORK_DIRECTORY } from '../app/art-bindings.mjs';
import { loadArtPack, safeArtFile, packRelative, PACK_LIMITS, PACK_VERSION, validateArtPayload } from '../app/packs.mjs';
import { ICON_BUNDLES } from '../app/data/icons.mjs';
import { TERRAIN_BUNDLE } from '../app/data/terrain-assets.mjs';

const defaultSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function hashFile(filename) {
  const handle = await open(filename, 'r');
  try {
    const hash = createHash('sha256');
    for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
async function checkExistingOutputAncestor(directory) {
  let current = path.resolve(directory);
  while (true) {
    try { await lstat(current); await safeArtFile(current); return; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

/** Byte-preserving, explicit manual installation. No download, save access, or live selection refresh. */
export async function buildArtPack({ sourceRoot = defaultSource, packsDir, version = '1.0.0', select = true,
  selectionPath = packsDir && path.join(packsDir, 'selection.json'), mapAssetsDir, terrainAssetsDir, iconAssetsDir,
  bindings = ART_BINDINGS, nestedManifestPaths = [] } = {}) {
  if (!packsDir || !PACK_VERSION.test(version)) throw new TypeError('Provide packsDir and a semantic version.');
  mapAssetsDir ??= process.env.RS3_MAP_ASSETS_DIR || path.join(sourceRoot, '.local', 'map-assets');
  terrainAssetsDir ??= process.env.RS3_TERRAIN_ASSETS_DIR || mapAssetsDir;
  iconAssetsDir ??= process.env.RS3_ICON_ASSETS_DIR || mapAssetsDir;
  const artSources = [path.join(sourceRoot, 'resources'), path.join(sourceRoot, 'app', 'web', TASK_ARTWORK_DIRECTORY),
    path.join(sourceRoot, 'reference', 'original-picker'), mapAssetsDir, terrainAssetsDir, iconAssetsDir].filter(Boolean);
  const outputs = [path.resolve(packsDir), path.resolve(selectionPath ?? path.join(packsDir, 'selection.json'))];
  for (const source of artSources) for (const output of outputs) {
    const relative = path.relative(path.resolve(source), output);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new TypeError('Pack outputs must stay outside source art roots.');
  }
  // Validate existing ancestors before recursive mkdir can follow a junction.
  // Otherwise even a subsequently rejected installation could write into art.
  await checkExistingOutputAncestor(path.resolve(packsDir));
  await checkExistingOutputAncestor(path.dirname(outputs[1]));
  const destination = path.resolve(packsDir, 'duo-art', version);
  await mkdir(path.resolve(packsDir), { recursive: true });
  await safeArtFile(path.resolve(packsDir));
  await mkdir(path.resolve(packsDir, 'duo-art'), { recursive: true });
  await safeArtFile(path.resolve(packsDir, 'duo-art'));
  await mkdir(destination); // Existing versions are immutable, including incomplete installs.
  const sources = new Map([
    ['legacyResources', { source: path.join(sourceRoot, 'resources'), root: 'resources' }],
    ['taskArtwork', { source: path.join(sourceRoot, 'app', 'web', TASK_ARTWORK_DIRECTORY), root: TASK_ARTWORK_DIRECTORY }],
    ['worldImages', { source: path.join(sourceRoot, 'reference', 'original-picker'), root: 'world-images' }],
  ]);
  const optionalRoots = new Map();
  for (const [component, source] of [['mapAssets', mapAssetsDir], ['terrainAssets', terrainAssetsDir], ['iconAssets', iconAssetsDir]]) {
    if (!source) continue;
    try {
      const absolute = await safeArtFile(path.resolve(source));
      const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
      const root = optionalRoots.get(key) ?? component.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      optionalRoots.set(key, root); sources.set(component, { source: absolute, root });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const roots = {}, files = [], copied = new Set(), selectedBindings = [];
  const sourceParents = new Set(), destinationParents = new Set();
  const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  async function sourceFile(root, relative) {
    packRelative(relative);
    const filename = path.resolve(root, ...relative.split('/')), parent = path.dirname(filename);
    // Source topology is fixed for one operator build. Audit each parent chain
    // once, while every file still gets its own link/canonical-target checks.
    if (!sourceParents.has(parent)) { await safeArtFile(parent); sourceParents.add(parent); }
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(filename), filename)) throw new TypeError('Invalid art source file.');
    return filename;
  }
  async function destinationParent(directory) {
    if (!destinationParents.has(directory)) { await mkdir(directory, { recursive: true }); destinationParents.add(directory); }
  }
  let total = 0;
  async function copy(component, relative, pinned) {
    packRelative(relative);
    const entry = sources.get(component), payloadPath = `${entry.root}/${relative}`;
    if (copied.has(payloadPath)) return;
    const source = await sourceFile(entry.source, relative);
    const before = await lstat(source);
    if (before.size < 1 || before.size > PACK_LIMITS.fileBytes || total + before.size > PACK_LIMITS.totalBytes || files.length >= PACK_LIMITS.files) throw new TypeError('Art pack resource limit.');
    if (pinned && (pinned.bytes !== before.size || !/^[a-f0-9]{64}$/.test(pinned.sha256 ?? ''))) throw new TypeError('Nested art record mismatch.');
    const digest = pinned?.sha256 ?? await hashFile(source);
    if (pinned?.role === 'opaque-manifest' && await hashFile(source) !== digest) throw new TypeError('Interior manifest does not match its descriptor.');
    const record = { path: payloadPath, bytes: before.size, sha256: digest, ...(pinned?.role ? { role: pinned.role } : {}) };
    await validateArtPayload(source, record);
    await sourceFile(entry.source, relative);
    const target = path.join(destination, entry.root, ...relative.split('/'));
    await destinationParent(path.dirname(target));
    await copyFile(source, target);
    // Existing nested manifests already pin large trees. Their payload hashes are
    // verified lazily by the loader; avoid two additional full-tree hash passes.
    if ((await lstat(target)).size !== before.size
      || ((!pinned || pinned.role === 'opaque-manifest') && await hashFile(target) !== digest)) throw new TypeError('Source art changed while copying.');
    roots[component] = entry.root; copied.add(payloadPath); total += before.size; files.push(record);
  }
  for (const [route, binding] of bindings) {
    if (!sources.has(binding.component)) throw new TypeError('Unknown art binding component.');
    try { await copy(binding.component, binding.relative); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    selectedBindings.push({ route, component: binding.component, relative: binding.relative });
  }
  const manifestPaths = new Set([TERRAIN_BUNDLE.manifestPath, ...ICON_BUNDLES.map(bundle => `icons-${bundle.kind}.${bundle.version}/manifest.json`), ...nestedManifestPaths]);
  const interiorDescriptors = new Map();
  // The committed current interior descriptor remains owned by the legacy data
  // provider in milestone 1. Read its path only; never package its topology.
  if (['mapAssets', 'terrainAssets', 'iconAssets'].some(component => sources.has(component))) for (const relative of ['app/data/cache-interiors.2026-10-08.v2.json', 'app/data/cache-interiors.2026-10-08.v1.json']) {
    try {
      const descriptorFile = await safeArtFile(sourceRoot, relative);
      if ((await lstat(descriptorFile)).size > PACK_LIMITS.jsonBytes) throw new TypeError('Interior descriptor is too large.');
      const value = JSON.parse(await readFile(descriptorFile, 'utf8'));
      if (value.assets?.manifestPath) {
        const manifestPath = packRelative(value.assets.manifestPath);
        manifestPaths.add(manifestPath);
        interiorDescriptors.set(manifestPath, { assets: value.assets, maps: value.maps });
        break;
      }
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const visited = new Set();
  async function nested(component, relative) {
    const entry = sources.get(component), key = `${entry.root}/${relative}`;
    if (visited.has(key)) return; visited.add(key);
    let filename;
    try { filename = await safeArtFile(entry.source, relative); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const size = (await lstat(filename)).size, descriptor = interiorDescriptors.get(relative);
    if (!descriptor && size > PACK_LIMITS.jsonBytes) throw new TypeError('Nested manifest is too large.');
    // Reviewed interiors have a large diagnostic manifest. The committed
    // descriptor supplies tile receipts; never parse/retain diagnostic bytes.
    const manifest = descriptor ?? JSON.parse(await readFile(filename, 'utf8'));
    await copy(component, relative, descriptor ? { bytes: size, sha256: descriptor.assets.manifestSha256, role: 'opaque-manifest' } : undefined);
    const records = new Map();
    function collect(value) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.path === 'string' && /\.(?:png|webp)$/i.test(value.path) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[a-f0-9]{64}$/.test(value.sha256 ?? '')) {
        const artPath = packRelative(value.path.replace(/^\/assets\/map\//, ''));
        const previous = records.get(artPath);
        if (previous && (previous.bytes !== value.bytes || previous.sha256 !== value.sha256)) throw new TypeError('Conflicting nested art records.');
        records.set(artPath, value);
      }
      if (value.file && /\.png$/i.test(value.file) && manifest.assetDirectory && value.bytes && value.sha256) {
        const artPath = packRelative(`${manifest.assetDirectory}/${value.file}`), previous = records.get(artPath);
        if (previous && (previous.bytes !== value.bytes || previous.sha256 !== value.sha256)) throw new TypeError('Conflicting nested icon records.');
        records.set(artPath, value);
      }
      for (const [key, child] of Object.entries(value)) if (!['raw', 'sources', 'inputs', 'baseManifest', 'provenance'].includes(key)) collect(child);
    }
    collect(manifest);
    for (const [relativeArt, record] of records) {
      try { await copy(component, relativeArt, record); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  for (const component of ['mapAssets', 'terrainAssets', 'iconAssets']) if (sources.has(component)) {
    const entry = sources.get(component);
    await mkdir(path.join(destination, entry.root), { recursive: true }); roots[component] = entry.root;
    // Root manifests/pins are still display inputs for the current data provider.
    // Keep their exact bytes while excluding raw captures and unused source files.
    for (const item of await readdir(entry.source, { withFileTypes: true })) if (/^(?:manifest(?:[.-].*)?|pins(?:[.-].*)?)\.json$/.test(item.name)) {
      if (!item.isFile() || item.isSymbolicLink()) throw new TypeError('Art source metadata contains a link.');
      await nested(component, item.name);
    }
    for (const relative of manifestPaths) await nested(component, relative);
  }
  async function jsonPayload(relative, value) {
    const bytes = Buffer.from(encode(value)); await destinationParent(path.dirname(path.join(destination, relative)));
    await writeFile(path.join(destination, relative), bytes, { flag: 'wx' });
    files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await jsonPayload('indexes/art-bindings.json', { schemaVersion: 1, bindings: selectedBindings });
  await jsonPayload('provenance.json', { schemaVersion: 1, distribution: 'private-local', method: 'byte-preserving-copy',
    notice: 'Packaging does not establish acquisition, hosting or redistribution permission.', components: Object.keys(roots) });
  const manifest = { schemaVersion: 1, id: 'duo-art', kind: 'art', version,
    requires: { corePackApi: 1, datasetId: 'duo-legacy', datasetContractVersion: 1, coordinateSystem: 'surface-grid-v1' },
    roots, catalogues: { artBindings: 'indexes/art-bindings.json' }, files: files.sort((a, b) => a.path.localeCompare(b.path)),
    provenance: 'provenance.json', distribution: 'private-local' };
  await writeFile(path.join(destination, 'pack.json'), encode(manifest), { flag: 'wx' }); // Publish manifest last.
  const sha256 = await hashFile(path.join(destination, 'pack.json'));
  const selection = { schemaVersion: 1, art: { id: 'duo-art', version, sha256 } };
  const validationPath = path.join(packsDir, `.validate-${randomUUID()}.json`);
  await writeFile(validationPath, encode(selection), { flag: 'wx' });
  let provider;
  try { provider = await loadArtPack({ packsDir, selectionPath: validationPath }); }
  finally { await unlink(validationPath); }
  if (!provider.status().available) throw new TypeError('Completed art pack failed validation.');
  if (select) await selectArtPack({ packsDir, selectionPath, selection });
  return { directory: destination, manifest, selection, status: provider.status() };
}

/** Atomic deliberate selection, retaining the previous complete receipt for operator rollback. */
export async function selectArtPack({ packsDir, selectionPath = path.join(packsDir, 'selection.json'), selection }) {
  const absolute = path.resolve(selectionPath), parent = path.dirname(absolute);
  await safeArtFile(parent);
  try {
    const currentFile = await safeArtFile(parent, path.basename(absolute));
    const current = JSON.parse(await readFile(currentFile, 'utf8'));
    if (current.schemaVersion !== 1) throw new TypeError('Invalid existing pack selection.');
    selection = { ...current, ...selection };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(parent, `.selection-${randomUUID()}.json`);
  await writeFile(temporary, encode(selection), { flag: 'wx' });
  try {
    const provider = await loadArtPack({ packsDir, selectionPath: temporary });
    if (!provider.status().available) throw new TypeError('Selection does not name a valid art pack.');
    try {
      const current = await safeArtFile(parent, path.basename(absolute));
      const previous = `${absolute}.previous`, previousTemporary = `${temporary}.previous`;
      try { await safeArtFile(parent, path.basename(previous)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await copyFile(current, previousTemporary); await rename(previousTemporary, previous);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temporary, absolute);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const names = { '--source-root': 'sourceRoot', '--packs-dir': 'packsDir', '--version': 'version', '--selection': 'selectionPath', '--map-assets': 'mapAssetsDir', '--terrain-assets': 'terrainAssetsDir', '--icon-assets': 'iconAssetsDir' };
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === '--no-select') options.select = false;
    else if (names[argument] && process.argv[index + 1]) options[names[argument]] = process.argv[++index];
    else throw new TypeError('Unknown or incomplete art-pack option.');
  }
  buildArtPack(options).then(result => console.log(JSON.stringify({ ...result.status, files: result.manifest.files.length })))
    .catch(() => { console.error('Art pack build failed; selection was not changed. Check source paths, version, payloads and resource limits.'); process.exitCode = 1; });
}
