#!/usr/bin/env node
// Freeze reviewed additions and an immutable base snapshot before delta rendering.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
const root = resolve(import.meta.dirname, '../..'), scratch = join(root, '.local/interiors-v2-research');
const previous = join(root, '.local/game-data/interiors-2026-10-08-v2-final');
const output = resolve(process.argv[2] ?? join(root, '.local/game-data/interiors-2026-10-08-v2-complete'));
if (!output.startsWith(join(root, '.local/game-data') + '\\') || existsSync(output)) throw new Error('Use a NEW version inside worktree .local/game-data');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const review = json(join(previous, 'resolutions.json'));
const syntheticFile = join(scratch, 'synthetic-identities.reviewed.v1.json'), extraFile = join(scratch, 'synthetic-identities.extra.v1.json');
const wikiFile = join(scratch, 'wiki-synthetic.json'), wiki = json(wikiFile);
for (const file of [syntheticFile, extraFile]) {
  const data = json(file);
  for (const original of data.proposals) {
    const proposal = structuredClone(original);
    if (proposal.displayAnchor) proposal.displayAnchor = { ...proposal.displayAnchor, mapId: proposal.mapId, precision: 'map-label-anchor',
      coordinateEvidence: { kind: 'reviewed-cache-label-or-scenery-anchor', source: proposal.displayAnchor.source,
        evidence: proposal.evidence, scope: 'Static source/display anchor, not an exact player arrival.' } };
    if (proposal.mapId === 10005) {
      const row = wiki.areas.find(a => a.pickerId === '25'), entrance = wiki.cacheEvidence.placements.find(p => p.objectId === 126997);
      proposal.evidence.push({ kind: 'wiki-and-cache-cave-identity', sources: row.evidenceSources,
        scope: 'Same opening object IDs and source square independently corroborate cave identity. Wiki click coordinates and plane differ from cache origins; no landing alignment is inferred.' });
      const exit = { locationId: '25', chunkId: '25', mapId: 10005, x: 1155, y: 2024, plane: 0, precision: 'exact-entrance',
        coordinateEvidence: proposal.displayAnchor.coordinateEvidence };
      proposal.sourceAnchors = [exit];
      proposal.entrances = [{ id: 'interior-um-troll-cave', kind: 'retained-interior-display-route',
        from: { locationId: '23', chunkId: '23', mapId: 742, x: entrance.x, y: entrance.y, plane: entrance.plane,
          precision: 'exact-entrance', coordinateEvidence: { kind: 'exact-cache-object-origin', objectId: 126997, source: entrance.source, transform: entrance.transform } },
        to: exit, precision: 'reviewed-scenery-counterparts', provenance: row.evidenceSources, bidirectional: null, accessEffect: 'none',
        unknowns: ['Wiki exit1160,2026/plane1 and cache origin1155,2024/plane0 are distinct scenery coordinates. Exact player arrival remains unknown.'] }];
    }
    review.resolutions.push(proposal);
  }
  review.inputs.push({ file, sha256: sha256(readFileSync(file)), hashKind: 'exact-bytes' });
}
review.unresolvedReviews = wiki.areas;
review.sources.push(...wiki.sources.map(({ title, revisionId, url, wikitextSha256 }) => ({ title, revisionId, url, wikitextSha256 })));
review.inputs.push({ file: wikiFile, sha256: sha256(readFileSync(wikiFile)), hashKind: 'exact-bytes' });
review.generator = { file: 'scripts/cache/interiors-v2-publish.mjs', sha256: sha256RepositoryText(readFileSync(import.meta.filename)), hashKind: 'repository-lf' };
mkdirSync(output, { recursive: true });
const files = [];
for (const file of ['all-layout-coordinate-proposals.json', 'priority.json', 'wiki-entrances.json']) {
  const bytes = readFileSync(join(previous, file)); writeFileSync(join(output, file), bytes, { flag: 'wx' }); files.push({ file, sha256: sha256(bytes), bytes: bytes.length });
}
for (const file of [syntheticFile, extraFile, wikiFile]) {
  const name = file.slice(file.lastIndexOf('\\') + 1), bytes = readFileSync(file);
  writeFileSync(join(output, name), bytes, { flag: 'wx' }); files.push({ file: name, sha256: sha256(bytes), bytes: bytes.length });
}
const baseBytes = readFileSync(join(root, 'app/data/cache-interiors.2026-10-08.v2.json'));
writeFileSync(join(output, 'base-catalogue.json'), baseBytes, { flag: 'wx' }); files.push({ file: 'base-catalogue.json', sha256: sha256(baseBytes), bytes: baseBytes.length });
const bytes = Buffer.from(JSON.stringify(review, null, 2) + '\n'); writeFileSync(join(output, 'resolutions.json'), bytes, { flag: 'wx' });
files.push({ file: 'resolutions.json', sha256: sha256(bytes), bytes: bytes.length });
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, directory: output, files, generator: review.generator }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, resolutions: review.resolutions.length, files: files.length }));
