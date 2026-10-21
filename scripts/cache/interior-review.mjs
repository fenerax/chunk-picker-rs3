#!/usr/bin/env node
// Enrich the worker-owned catalogue with pinned sample evidence. This does not
// replace or modify any generated asset manifest, PNG or existing main file.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
const root = resolve(import.meta.dirname, '../..');
const scratch = 'C:/Users/User/Projects/rs3-cache-work/archmaps-interiors';
const args = process.argv.slice(2), source = args[0];
if (!source || args.length !== 1) throw new Error('Supply newly rendered scratch catalogue path');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const catalogue = json(source), places = json(`${scratch}/places.2026-10-08.v3.copy.json`), wiki = json(`${scratch}/wiki-samples.json`);
const normal = name => String(name).toLowerCase().replace(/[_\s]+/g, ' ').trim();
for (const area of catalogue.areas) {
  const page = area.name === 'Lumbridge Cellar' ? 'Lumbridge Castle' : area.name;
  for (const row of wiki.filter(r => r.page === page)) area.evidence.push({ kind: 'rs3-wiki-named-sample', title: row.title, revision: row.revision, url: row.url,
    scope: 'Named location and entrance description corroboration; cache map ID remains copied-cache evidence.' });
  if (area.mapIds.includes(164)) {
    const row = wiki.find(r => r.page === 'Map:The Blood Pact');
    area.evidence.push({ kind: 'rs3-wiki-source-plane', title: row.title, revision: row.revision, url: row.url, mapId: 164, plane: 1,
      scope: 'Wiki Upper Level explicitly plane1, backed by reviewed exact source stair/exit placements; no encoded paste-plane1 claim.' });
  }
  if (area.status === 'unknown') {
    const disabled = places.mapRecords.filter(m => normal(m.name) === normal(area.name) && !(m.declaredPastes?.squares + m.declaredPastes?.chunks));
    if (disabled.length) {
      area.identityMapIds = disabled.map(m => m.id);
      area.unknowns[0] = 'Named cache identity exists but no active static paste layout is encoded; no rendered map substituted.';
      area.evidence.push({ kind: 'cache-no-static-layout', mapIds: area.identityMapIds });
    }
  }
}
catalogue.specialCases[0].evidence = [wiki.find(r => r.page === 'Wilderness North Volcano').url];
catalogue.review = { source: 'scripts/cache/interior-review.mjs', sourceSha256: sha256RepositoryText(readFileSync(import.meta.filename)),
  wikiInputSha256: sha256(readFileSync(`${scratch}/wiki-samples.json`)), wikiSamples: wiki.map(({ wikitext, ...row }) => row),
  placesCopyOrigin: { path: 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json',
    copySha256: sha256(readFileSync(`${scratch}/places.2026-10-08.v3.copy.json`)), role: 'Existing extraction plain-copied into unique scratch before rendering' } };
const output = resolve(root, 'app/data/cache-interiors.2026-10-08.v1.json');
writeFileSync(output, JSON.stringify(catalogue, null, 2) + '\n');
console.log(JSON.stringify({ output, summary: catalogue.summary, bytes: readFileSync(output).length, sha256: sha256RepositoryText(readFileSync(output)) }));
