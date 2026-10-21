// Packs for CI: downloads the release assets that pack-pin.json names, checks
// each against its pinned sha256 and size, unpacks them as a packs directory
// (selection.json plus <id>/<version>/), then places the pack files the
// checkout does not track where the app and tests look for them.
// With no pin, nothing is fetched and the tests that need pack or game-cache
// files skip.
// Usage: node fetch-packs.mjs <checkout> <packs work dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, copyFileSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const kinds = ['data', 'rulesText', 'art'];

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

/** Verifies every selected pack file, then copies the ones the checkout lacks.
 * Tracked files always win; nothing is overwritten. */
export function placePacks({ checkout, tree }) {
  const selection = JSON.parse(readFileSync(path.join(tree, 'selection.json'), 'utf8'));
  const verified = [];
  for (const kind of kinds) {
    const choice = selection[kind];
    if (!choice) continue;
    if (!safeRelative(choice.id) || !safeRelative(choice.version)) throw Error('Pack selection invalid.');
    const root = path.join(tree, choice.id, choice.version), manifestBytes = readFileSync(path.join(root, 'pack.json'));
    if (choice.sha256 !== sha(manifestBytes)) throw Error(`Pack manifest changed: ${choice.id}`);
    for (const record of JSON.parse(manifestBytes).files) {
      if (!safeRelative(record.path)) throw Error('Pack file path invalid.');
      const source = path.join(root, record.path), bytes = readFileSync(source);
      if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw Error(`Pack file changed: ${choice.id}/${record.path}`);
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
        execFileSync('tar', ['-xzf', file, '-C', tree, '--no-same-owner', '--no-same-permissions'], { stdio: 'inherit' });
        console.log(`${asset.name}: ${(bytes.length / 1024 ** 2).toFixed(1)} MiB verified`);
      }
      writeFileSync(path.join(tree, 'selection.json'), JSON.stringify({ schemaVersion: 1, ...pin.selection }, null, 2) + '\n');
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'fetched=true\n');
    }
    const { placed, present } = placePacks({ checkout, tree });
    console.log(`Packs ${pin.tag}: ${placed} files placed, ${present} already in the checkout.`);
  }
}
