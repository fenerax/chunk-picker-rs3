#!/usr/bin/env node
// Assemble a compact index of independently inspected category reports.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cliOptions, writeDataset } from './game-data-common.mjs';
import { sha256, RSMV_COMMIT } from './cache-reader.mjs';
import { sha256RepositoryText } from '../lib/provenance-hash.mjs';

const options = cliOptions();
if (!options.verification || !options.output) throw new Error('Supply --verification completed hash report --output NEW_INDEX_FILE');
const repo = resolve(import.meta.dirname, '../..'), categories = {};
const verificationBytes = readFileSync(options.verification), verification = JSON.parse(verificationBytes);
if (verification.verified.length !== 5) throw new Error('Final verification must cover all five domain exports (objects include transitions)');
const manifestNames = { objects: 'objects.manifest.v1.json', items: 'items.manifest.v1.json',
  quests: 'quests-achievements.manifest.v1.json', recipes: 'recipes-manifest.v1.json', places: 'manifest.v1.json' };
for (const category of ['objects', 'items', 'quests', 'recipes', 'places']) {
  const name = `cache-game-data-${category}.2026-10-08.v1.json`, path = join(repo, 'docs/research', name);
  const bytes = readFileSync(path), report = JSON.parse(bytes);
  const verified = verification.verified.find(row => row.manifest === manifestNames[category]);
  if (!verified) throw new Error(`Missing verified ${category} manifest`);
  const reportManifestHash = report.manifestSha256 ?? report.manifest?.sha256;
  const reportDirectory = report.datasetDirectory ?? report.localOutput ?? (report.manifest?.path && resolve(report.manifest.path, '..'));
  if (reportManifestHash !== verified.manifestSha256 || !reportDirectory || resolve(reportDirectory) !== resolve(verified.directory))
    throw new Error(`Compact ${category} report does not bind to its verified export`);
  const manifestBytes = readFileSync(join(verified.directory, verified.manifest));
  if (sha256(manifestBytes) !== verified.manifestSha256) throw new Error(`Verified ${category} manifest changed`);
  const manifest = JSON.parse(manifestBytes), counts = report.summary ?? report.counts;
  if (!isDeepStrictEqual(counts, manifest.summary ?? manifest.counts)) throw new Error(`Compact ${category} counts differ from its manifest`);
  if (manifest.decoder?.commit !== RSMV_COMMIT || manifest.decoder?.buildSchema !== 950)
    throw new Error(`Unexpected ${category} decoder provenance`);
  categories[category] = { report: `docs/research/${name}`, reportSha256: sha256RepositoryText(bytes),
    counts, datasetDirectory: verified.directory,
    manifest: verified.manifest, manifestSha256: verified.manifestSha256 };
}
const sourcePaths = ['scripts/import-rs3-game-data.mjs', ...readdirSync(join(repo, 'scripts/cache'))
  .filter(name => /^(?:game-data-|report-game-data|verify-game-data)/.test(name)).map(name => `scripts/cache/${name}`)];
const reproductionSources = sourcePaths.map(path => ({ path, sha256: sha256RepositoryText(readFileSync(join(repo, path))) }));
const output = resolve(options.output);
const result = writeDataset(resolve(output, '..'), output.split(/[/\\]/).at(-1), { schemaVersion: 1,
  generatedAt: new Date().toISOString(), purpose: 'private advisory static game-data research; no application integration',
  decoderCommit: RSMV_COMMIT, inferredSchemaBuild: 950,
  reference: { file: 'rs3-chunkpicker-chunkinfo-export.json', sha256: sha256RepositoryText(readFileSync(join(repo, 'rs3-chunkpicker-chunkinfo-export.json'))) },
  categories, reproductionSources, verification: { path: resolve(options.verification).replaceAll('\\', '/'),
    sha256: sha256(verificationBytes), ...verification },
  limits: ['Counts include variants, conditional states, aliases and production candidates. Read each domain report before replacement.',
    'No server spawns, drops, ordinary shop stock, complete access gates, weights or throughput were inferred.'] });
console.log(JSON.stringify(result, null, 2));
