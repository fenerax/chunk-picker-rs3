// Packs for CI: downloads the release assets that pack-pin.json names, checks
// each against its pinned sha256 and size, unpacks them as a packs directory
// (selection.json plus <id>/<version>/), then places the pack files the
// checkout does not track where the app and tests look for them.
// With no pin, nothing is fetched and the tests that need pack or game-cache
// files skip.
// Usage: node fetch-packs.mjs <checkout> <packs work dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, copyFileSync, lstatSync, openSync, readSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const kinds = ['data', 'rulesText', 'art', 'cacheInputs'];

export function readPin(checkout) {
  const pin = JSON.parse(readFileSync(path.join(checkout, '.github/packs/pack-pin.json'), 'utf8'));
  if (pin.schema !== 'rs3-ci-pack-pin-v1' || !Array.isArray(pin.assets)) throw Error('Pack pin invalid.');
  if (pin.tag === null && pin.assets.length === 0 && pin.selection === null) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(pin.tag ?? '') || !pin.assets.length || typeof pin.selection !== 'object' || pin.selection === null) throw Error('Pack pin invalid.');
  for (const asset of pin.assets) if (!/^[A-Za-z0-9._-]+\.tar\.gz$/.test(asset.name ?? '') || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || !Number.isSafeInteger(asset.bytes)) throw Error('Pack asset pin invalid.');
  return pin;
}

// Where an untracked pack file lives in a checkout; null for files nothing reads there.
export function placedPath(kind, name) {
  // CI consumes cache inputs directly from the verified pack tree.
  if (kind === 'cacheInputs') return null;
  if (kind === 'art') {
    if (name.startsWith('resources/')) return name;
    if (name.startsWith('world-images/')) return 'reference/original-picker/' + name.slice('world-images/'.length);
    if (name.startsWith('map-assets/')) return '.local/' + name;
    if (name.startsWith('task-item-artwork.')) return 'app/web/' + name;
    return null;
  }
  if (name.startsWith('local-map/')) return '.local/map-assets/' + name.slice('local-map/'.length);
  if (name.startsWith('local-game/')) return '.local/game-data/' + name.slice('local-game/'.length);
  if (/^(?:indexes\/|provenance\.json$)/.test(name)) return null;
  return name;
}

const safeRelative = name => typeof name === 'string' && name !== '' && !path.isAbsolute(name) && !/^[A-Za-z]:/.test(name)
  && name.split(/[\\/]/).every(part => part !== '' && part !== '.' && part !== '..');

// A restored cache must contain ordinary files and directories, never links that
// make a pinned path resolve outside the verified pack tree.
function cacheFile(tree, name) {
  let current = tree;
  if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) throw Error('Cache input pack tree invalid.');
  const parts = name.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw Error('Cache input pack tree invalid.');
    }
  }
  return current;
}

// Expanded cache inputs can exceed a single Buffer's size. Verify them with
// bounded memory rather than loading the entire JSON payload at once.
function verifyCacheFile(source, record) {
  const handle = openSync(source, 'r'), hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  try {
    for (;;) {
      const count = readSync(handle, buffer, 0, buffer.length, null);
      if (!count) break;
      total += count;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(handle);
  }
  return total === record.bytes && hash.digest('hex') === record.sha256;
}

/** Verifies every selected pack file, then copies the ones the checkout lacks.
 * Tracked files always win; nothing is overwritten. */
export function placePacks({ checkout, tree, pinnedSelection }) {
  const selection = JSON.parse(readFileSync(path.join(tree, 'selection.json'), 'utf8'));
  if (pinnedSelection && !isDeepStrictEqual(selection, { schemaVersion: 1, ...pinnedSelection })) throw Error('Pack selection changed from pin.');
  const verified = [];
  for (const kind of kinds) {
    const choice = selection[kind];
    if (!choice) continue;
    if (!safeRelative(choice.id) || !safeRelative(choice.version)) throw Error('Pack selection invalid.');
    if (kind === 'cacheInputs' && (choice.id !== 'cache-inputs' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(choice.version)
      || !/^[a-f0-9]{64}$/.test(choice.sha256 ?? ''))) throw Error('Cache input pack selection invalid.');
    const root = path.join(tree, choice.id, choice.version);
    const manifestPath = kind === 'cacheInputs' ? cacheFile(tree, `${choice.id}/${choice.version}/pack.json`) : path.join(root, 'pack.json');
    const manifestBytes = readFileSync(manifestPath);
    if (choice.sha256 !== sha(manifestBytes)) throw Error(`Pack manifest changed: ${choice.id}`);
    const manifest = JSON.parse(manifestBytes);
    if (kind === 'cacheInputs' && (!manifest || manifest.schemaVersion !== 1 || manifest.id !== 'cache-inputs'
      || manifest.id !== choice.id || manifest.version !== choice.version || !Array.isArray(manifest.files)
      || manifest.files.length === 0)) throw Error('Cache input pack manifest invalid.');
    const seen = new Set();
    for (const record of manifest.files) {
      if (kind === 'cacheInputs' && (!record || typeof record !== 'object')) throw Error('Cache input pack file invalid.');
      if (!safeRelative(record.path)) throw Error('Pack file path invalid.');
      if (kind === 'cacheInputs' && (!record.path.startsWith('local-game/') || /[\\:]/.test(record.path)
        || record.path.split('/').some(part => /[. ]$/.test(part))
        || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')
        || seen.has(record.path))) throw Error('Cache input pack file invalid.');
      seen.add(record.path);
      const source = kind === 'cacheInputs' ? cacheFile(tree, `${choice.id}/${choice.version}/${record.path}`) : path.join(root, record.path);
      if (kind === 'cacheInputs') {
        if (!verifyCacheFile(source, record)) throw Error(`Pack file changed: ${choice.id}/${record.path}`);
      } else {
        const bytes = readFileSync(source);
        if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw Error(`Pack file changed: ${choice.id}/${record.path}`);
      }
      const name = placedPath(kind, record.path);
      if (name !== null) verified.push([name, source]);
    }
  }
  // Every file verifies before the first one is placed.
  let placed = 0, present = 0;
  for (const [name, source] of verified) {
    const target = path.join(checkout, name);
    if (existsSync(target)) { present++; continue; }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    placed++;
  }
  return { placed, present };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [checkout, destination] = process.argv.slice(2).map(item => path.resolve(item));
  const pin = readPin(checkout);
  if (!pin) console.log('No packs pinned; the tests that need pack or game-cache files skip.');
  else {
    const downloads = path.join(destination, 'download'), tree = path.join(destination, 'tree');
    // A restored cache holds the same verified assets; placePacks re-checks every file either way.
    if (!existsSync(path.join(tree, 'selection.json'))) {
      const repository = process.env.GITHUB_REPOSITORY;
      if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository ?? '')) throw Error('Pack source invalid.');
      mkdirSync(downloads, { recursive: true }); mkdirSync(tree, { recursive: true });
      for (const asset of pin.assets) {
        execFileSync('gh', ['release', 'download', pin.tag, '--repo', repository, '--pattern', asset.name, '--dir', downloads], { stdio: 'inherit' });
        const file = path.join(downloads, asset.name), bytes = readFileSync(file);
        if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw Error('Pack asset changed: ' + asset.name);
        execFileSync('tar', ['-xzf', asset.name, '-C', tree.replaceAll('\\', '/'), '--no-same-owner', '--no-same-permissions'], { cwd: downloads, stdio: 'inherit' });
        console.log(`${asset.name}: ${(bytes.length / 1024 ** 2).toFixed(1)} MiB verified`);
      }
      writeFileSync(path.join(tree, 'selection.json'), JSON.stringify({ schemaVersion: 1, ...pin.selection }, null, 2) + '\n');
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'fetched=true\n');
    }
    const { placed, present } = placePacks({ checkout, tree, pinnedSelection: pin.selection });
    console.log(`Packs ${pin.tag}: ${placed} files placed, ${present} already in the checkout.`);
  }
}
