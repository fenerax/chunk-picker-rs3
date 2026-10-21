#!/usr/bin/env node
// Verify local artifacts without reading private application state.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { cliOptions, writeDataset } from './game-data-common.mjs';
import { fileSha256 } from './cache-reader.mjs';

const options = cliOptions();
if (!options.root || !options.directories || !options.report) throw new Error('Supply --root --directories comma-separated --report NEW_FILE');
const root = realpathSync(options.root), copy = realpathSync(options['cache-copy'] ?? 'C:/Users/User/Projects/rs3-cache-work/cache-copy');
if (/[/\\]ProgramData[/\\]Jagex[/\\]RuneScape(?:[/\\]|$)/i.test(copy)) throw new Error('Original cache is prohibited');
const verified = [], sourceHashes = new Map();
for (const name of options.directories.split(',')) {
  const directory = realpathSync(join(root, name)), rel = relative(root, directory);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Input must stay in the data root');
  const manifestName = readdirSync(directory).find(file => /(?:^|\.)manifest\.v1\.json$/.test(file) || file === 'recipes-manifest.v1.json');
  if (!manifestName) throw new Error(`No manifest in ${directory}`);
  const manifestPath = join(directory, manifestName), manifest = JSON.parse(readFileSync(manifestPath));
  const outputs = [];
  for (const output of manifest.outputs) {
    const path = realpathSync(output.path), rel = relative(directory, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Output escapes category directory: ${path}`);
    const hash = await fileSha256(path);
    if (hash !== output.sha256 || statSync(path).size !== output.bytes) throw new Error(`Output mismatch: ${path}`);
    outputs.push({ file: rel.replaceAll('\\', '/'), bytes: output.bytes, sha256: hash });
  }
  for (const source of manifest.sources) {
    const path = join(copy, `js5-${source.major}.jcache`);
    if (realpathSync(path) !== path) throw new Error('Copied sources must be regular, unredirected paths');
    if (!sourceHashes.has(source.major)) sourceHashes.set(source.major, await fileSha256(path));
    if (sourceHashes.get(source.major) !== source.sha256) throw new Error(`Copied source mismatch: ${source.major}`);
  }
  verified.push({ directory: directory.replaceAll('\\', '/'), manifest: manifestName,
    manifestSha256: await fileSha256(manifestPath), outputs, sourceMajors: manifest.sources.map(s => s.major),
    archiveHashes: manifest.archives.length });
}
const report = resolve(options.report);
writeDataset(resolve(report, '..'), report.split(/[/\\]/).at(-1), { schemaVersion: 1,
  generatedAt: new Date().toISOString(), verified, copiedSources: [...sourceHashes].map(([major, sha256]) => ({ major, sha256 })) });
console.log(JSON.stringify({ categories: verified.length, outputs: verified.reduce((n, r) => n + r.outputs.length, 0),
  bytes: verified.reduce((n, r) => n + r.outputs.reduce((m, f) => m + f.bytes, 0), 0), report }, null, 2));
