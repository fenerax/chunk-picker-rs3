#!/usr/bin/env node
// Finalize display metadata without changing immutable render artifacts.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { buildInteriorConnections } from './interiors-v2-connections.mjs';
const root = resolve(import.meta.dirname, '../..');
const catalogueFile = 'app/data/cache-interiors.2026-10-08.v2.json', connectionsFile = 'archive/data/map-connections.2026-10-08.v3.json';
const catalogue = JSON.parse(readFileSync(resolve(root, catalogueFile))), previousConnections = JSON.parse(readFileSync(resolve(root, connectionsFile)));
const baseConnections = JSON.parse(readFileSync(resolve(root, 'archive/data/map-connections.2026-10-08.v2.json')));
const role = 'Documented exact teleport/Insignia arrival from pinned Wiki evidence; live player arrival is unobserved.';
function correct(value) {
  if (!value || typeof value !== 'object') return 0;
  let changed = 0;
  if (value.kind === 'wiki-explicit-player-arrival' && value.role !== role) { value.role = role; changed++; }
  for (const child of Object.values(value)) changed += correct(child);
  return changed;
}
const corrections = { catalogue: correct(catalogue) };
const extraInputs = previousConnections.inputs.slice(baseConnections.inputs.length)
  .filter(input => !(input.file ?? input.path ?? '').replaceAll('\\', '/').endsWith(catalogueFile));
const connections = buildInteriorConnections(baseConnections, catalogue, { inputs: extraInputs });
corrections.connections = correct(connections);
for (const area of catalogue.areas) area.declaredConnections = connections.connections
  .filter(edge => [edge.from, edge.to].some(point => point.offSurface && point.interiorMap?.areaId === area.areaId))
  .map(edge => ({ id: edge.id, kind: edge.kind, from: edge.from, to: edge.to,
    precision: edge.from.precision === 'unresolved' || edge.to.precision === 'unresolved' ? 'unresolved' : 'display-evidence',
    provenance: edge.provenance, accessEffect: 'none' }));
const file = 'scripts/cache/interiors-v2-finalize.mjs', sourceSha256 = sha256RepositoryText(readFileSync(import.meta.filename));
catalogue.generatorSourceHashes[file] = sourceSha256;
const connectionGenerator = 'scripts/cache/interiors-v2-connections.mjs';
catalogue.generatorSourceHashes[connectionGenerator] = sha256RepositoryText(readFileSync(resolve(root, connectionGenerator)));
catalogue.evidenceFinalization = { file, sourceSha256, hashKind: 'repository-lf',
  connectionGenerator, connectionGeneratorSha256: catalogue.generatorSourceHashes[connectionGenerator],
  scope: 'Repair contradictory Wiki arrival role wording and rebuild display connections with typed exact surface walking witnesses preserved. Interior declarations require explicit interior identity; route/access fields and immutable image bytes unchanged.' };
const catalogueBytes = Buffer.from(JSON.stringify(catalogue, null, 2) + '\n');
writeFileSync(resolve(root, catalogueFile), catalogueBytes);
connections.inputs.push({ file: catalogueFile, sha256: sha256RepositoryText(catalogueBytes), hashKind: 'repository-lf' });
connections.evidenceFinalization = catalogue.evidenceFinalization;
writeFileSync(resolve(root, connectionsFile), JSON.stringify(connections, null, 2) + '\n');
console.log(JSON.stringify({ corrections, manifestUnchanged: catalogue.assets.manifestSha256 }));
