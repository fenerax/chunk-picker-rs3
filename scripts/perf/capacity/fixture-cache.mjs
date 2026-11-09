import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile, mkdir, utimes, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { digest } from './model.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sealName = 'fixture-complete.json';
const managed = name => ['registry', 'pickers', 'tombstones', 'legacy', 'legacy.dataset.json', 'fixture.json'].includes(name);

export const fixtureConfigDigest = (profile, datasetDigest) => digest({ seed: profile.seed, catalogue: profile.catalogue,
  fixture: profile.fixture, entityCaps: profile.entityCaps, datasetDigest });
export const logicalFixtureDigest = manifest => digest({ config: manifest.configDigest, plan: manifest.planDigest,
  catalogue: manifest.catalogueDigest, groups: manifest.groups.map(group => ({ index: group.index,
    state: group.logicalStateDigest, revision: group.revision, snapshots: group.retainedSnapshots, retention: group.retention })) });

// Appends one entry at a time. A sealed full-size fixture holds hundreds of
// thousands of files; spreading them into push() overflows the call stack.
export async function fixtureInventory(directory, { list = readdir, status = lstat } = {}) {
  const output = [];
  const walk = async prefix => {
    for (const name of (await list(path.join(directory, prefix))).sort()) {
      if (!prefix && !managed(name)) continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = await status(path.join(directory, relative));
      if (stat.isSymbolicLink()) throw new Error('Fixture contains a symbolic link.');
      if (stat.isDirectory()) await walk(relative);
      else if (stat.isFile()) output.push({ path: relative, bytes: stat.size, modifiedMs: stat.mtime.getTime() });
      else throw new Error('Fixture contains a non-regular file.');
    }
  };
  await walk('');
  return output;
}
async function fileDigest(filename) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
}
export async function fixtureImplementationDigest() {
  // Bind reuse to the code that produced it, including transitive app modules.
  const hash = createHash('sha256');
  for (const subdirectory of ['app', 'scripts/lib', 'scripts/perf/capacity']) {
    const entries = await readdir(path.join(root, subdirectory), { recursive: true, withFileTypes: true });
    for (const entry of entries.filter(entry => entry.isFile() && /\.(?:mjs|json)$/.test(entry.name))
      .sort((a, b) => path.join(a.parentPath, a.name).localeCompare(path.join(b.parentPath, b.name), 'en'))) {
      const filename = path.join(entry.parentPath, entry.name);
      hash.update(path.relative(root, filename).replaceAll('\\', '/')); hash.update(await readFile(filename));
    }
  }
  return hash.digest('hex');
}
export async function sealFixture(directory, manifest) {
  const inventory = await fixtureInventory(directory);
  for (const entry of inventory) entry.digest = await fileDigest(path.join(directory, entry.path));
  const seal = { schemaVersion: 1, complete: true, configDigest: manifest.configDigest,
    fixtureDigest: manifest.fixtureDigest, implementationDigest: await fixtureImplementationDigest(), files: inventory };
  seal.inventoryDigest = digest(seal.files);
  await writeFile(path.join(directory, sealName), JSON.stringify(seal), { flag: 'wx', mode: 0o600 });
  return seal;
}
async function inspect(directory, profile, datasetDigest) {
  const seal = JSON.parse(await readFile(path.join(directory, sealName), 'utf8'));
  if (seal.schemaVersion !== 1 || seal.complete !== true || seal.configDigest !== fixtureConfigDigest(profile, datasetDigest)
    || seal.implementationDigest !== await fixtureImplementationDigest() || seal.inventoryDigest !== digest(seal.files)) throw new Error('Fixture completion/configuration/code digest mismatch.');
  // Compare with an actual directory walk before trusting paths from the seal.
  const inventory = await fixtureInventory(directory);
  if (JSON.stringify(inventory) !== JSON.stringify(seal.files.map(({ path, bytes, modifiedMs }) => ({ path, bytes, modifiedMs })))) throw new Error('Fixture file inventory mismatch.');
  const manifest = JSON.parse(await readFile(path.join(directory, 'fixture.json'), 'utf8'));
  if (manifest.configDigest !== seal.configDigest || manifest.fixtureDigest !== seal.fixtureDigest
    || logicalFixtureDigest(manifest) !== seal.fixtureDigest) throw new Error('Fixture logical digest mismatch.');
  return { seal, manifest };
}
export async function verifyFixture(directory, profile, datasetDigest) {
  const result = await inspect(directory, profile, datasetDigest);
  for (const entry of result.seal.files) if (await fileDigest(path.join(directory, entry.path)) !== entry.digest) throw new Error(`Fixture file digest mismatch: ${entry.path}`);
  return result.manifest;
}
export async function copyFixture(source, destination, profile, datasetDigest) {
  source = path.resolve(source); destination = path.resolve(destination);
  const relative = path.relative(source, destination);
  if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Fixture output must be outside its source.');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const progress = async update => {
    const filename = path.join(destination, 'fixture-progress.json');
    await writeFile(filename + '.tmp', JSON.stringify({ ...update, updatedAt: new Date().toISOString() }));
    await rename(filename + '.tmp', filename);
  };
  await progress({ phase: 'verifying-reuse', groups: 0 });
  const { seal, manifest } = await inspect(source, profile, datasetDigest);
  let completedFiles = 0, copiedBytes = 0, lastAt = 0;
  // Only fixture-owned files are copied, never logs/profile/results from a run.
  // Hash the exact stream being copied, avoiding a second full read of snapshots.
  for (const entry of seal.files) {
    const target = path.join(destination, entry.path), hash = createHash('sha256');
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await pipeline(createReadStream(path.join(source, entry.path)), new Transform({ transform(bytes, encoding, callback) {
      hash.update(bytes); callback(null, bytes);
    } }), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    if (hash.digest('hex') !== entry.digest) throw new Error(`Fixture copy digest mismatch: ${entry.path}`);
    // Retention uses backup mtimes. A copy must preserve historical age.
    await utimes(target, new Date(entry.modifiedMs), new Date(entry.modifiedMs));
    completedFiles++; copiedBytes += entry.bytes;
    if (Date.now() - lastAt >= 1000 || completedFiles === seal.files.length) {
      await progress({ phase: 'copying', completedFiles, totalFiles: seal.files.length, copiedBytes, groups: 0 }); lastAt = Date.now();
    }
  }
  // Publish completion only after every copied byte has passed verification.
  await writeFile(path.join(destination, sealName), JSON.stringify(seal), { flag: 'wx', mode: 0o600 });
  await progress({ phase: 'reused', groups: manifest.groups.length,
    characters: manifest.characters, fixtureDigest: manifest.fixtureDigest, completedFiles, copiedBytes });
  return manifest;
}
