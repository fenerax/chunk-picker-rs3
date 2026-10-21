import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildWorld } from '../app/data/world.mjs';
import { compactChunkSections, SECTION_BUNDLE_DIRECTORY, SECTION_INPUTS } from '../app/core/chunk-sections.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [sourcePath, pinsPath, outputRoot = path.join(root, '.local', 'game-data')] = process.argv.slice(2);
if (!sourcePath) throw new Error('Usage: node scripts/build-chunk-sections.mjs <walkability.v1.json.gz> [pins.json] [output-game-data-directory]');
const sourceBytes = await readFile(sourcePath), sourceJSON = gunzipSync(sourceBytes);
const definitions = JSON.parse(await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
const world = buildWorld(definitions, { dataset: selectedDataset, cacheResources: false, cacheArchaeology: false });
const expected = world.cacheWalking.surfaceCorrections.provenance.walkabilitySha256;
if (sha256(sourceBytes) !== expected) throw new Error('Source walking masks differ from the audited runtime source.');
const pinsBytes = pinsPath ? await readFile(pinsPath) : null;
const repositoryHashes = Object.fromEntries(await Promise.all(SECTION_INPUTS.map(async file => [file, sha256RepositoryText(await readFile(path.join(root, file)))])));
const catalogue = compactChunkSections(JSON.parse(sourceJSON), world, { pins: pinsBytes ? JSON.parse(pinsBytes).pins : [],
  provenance: { sourceSnapshot: 'cache-audit-2026-10-07-v4', walkabilitySha256: expected, sourceJSONSha256: sha256(sourceJSON),
    pinsSha256: pinsBytes ? sha256(pinsBytes) : null, repositoryHashes } });
const bytes = gzipSync(Buffer.from(JSON.stringify(catalogue)), { level: 9 });
const directory = path.join(outputRoot, SECTION_BUNDLE_DIRECTORY);
await mkdir(outputRoot, { recursive: true });
await mkdir(directory);
await writeFile(path.join(directory, 'sections.v1.json.gz'), bytes, { flag: 'wx' });
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, sha256: sha256(bytes), bytes: bytes.length,
  componentCount: catalogue.components.length, provenance: catalogue.provenance }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory, components: catalogue.components.length, labelledComponents: catalogue.components.filter(component => component.labels.length).length,
  walkingTiles: catalogue.components.reduce((sum, component) => sum + component.walkableTileCount, 0), bytes: bytes.length }));
