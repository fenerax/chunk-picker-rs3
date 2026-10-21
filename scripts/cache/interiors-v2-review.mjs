#!/usr/bin/env node
// Join the independently reviewed identity and pinned Wiki evidence.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
const root = resolve(import.meta.dirname, '../..');
const scratch = join(root, '.local/interiors-v2-research');
const output = resolve(process.argv[2] ?? join(root, '.local/game-data/interiors-2026-10-08-v2'));
if (!output.startsWith(join(root, '.local', 'game-data')) || existsSync(output)) throw new Error('Use a NEW worktree .local/game-data version');
const read = name => JSON.parse(readFileSync(join(scratch, name), 'utf8'));
const identities = read('static-identities.reviewed.json'), wiki = read('wiki-entrances.json'), raw = read('static-identities.raw.json');
const anchor = id => wiki.anchors.find(a => a.id === id);
const placement = id => wiki.cacheEvidence.placements.find(p => p.objectId === id);
const source = title => wiki.sources.find(s => s.title.toLowerCase() === title.toLowerCase());
const coordinateEvidence = value => ({ kind: value.kind === 'explicit-player-arrival' ? 'wiki-explicit-player-arrival' : 'wiki-object-map',
  objectIds: value.objectIds ?? [], evidence: value.evidence, role: value.role ?? 'Scenery anchor, not a verified player arrival.' });
const station = (areaId, a, mapId = a.mapId) => ({ locationId: areaId, chunkId: /^\d+$/.test(areaId) ? areaId : null, areaId: /^\d+$/.test(areaId) ? null : areaId,
  name: a.name, x: a.x, y: a.y, plane: a.plane, mapId,
  precision: a.kind === 'explicit-player-arrival' ? 'exact-arrival' : 'exact-entrance', coordinateEvidence: coordinateEvidence(a) });
const cacheStation = (areaId, p) => ({ ...station(areaId, p), name: 'Copied-cache object anchor',
  coordinateEvidence: { kind: 'exact-cache-object-origin', placementId: p.id, objectId: p.objectId, source: p.source,
    transform: p.transform, scope: 'Exact scenery origin; player landing is unknown.' } });
const route = (id, from, to, provenance, unknowns = []) => ({ id, kind: 'retained-interior-display-route', from, to,
  bidirectional: null, precision: 'reviewed-scenery-counterparts', provenance, unknowns, accessEffect: 'none' });
const resolutions = structuredClone(identities.proposals);
for (const row of resolutions) {
  delete row.layers;
  row.evidence = [{ kind: 'reviewed-cache-scenery-signature', witnesses: row.evidence,
    scope: 'Independent exact scenery corroborates retained area/cache identity; no instance or access inference.' }];
  const summary = wiki.areas.find(a => a.pickerId === row.areaIds[0]);
  if (summary) row.evidence.push({ kind: 'pinned-rs3-wiki-review', sources: summary.sources, unknowns: summary.unknowns });
  row.entrances = []; row.sourceAnchors = [];
  if (row.mapId === 10003) {
    row.wikiMapId = 10003;
    // Continuous neighboring artwork and the documented broken bridge support a visual-only western island extension.
    const west = raw.neighborProbes?.find(p => p.areaId === '13214')?.squares?.find(s => s.x === 50 && s.y === 158);
    row.sourceSquares.push({ x: 50, y: 158 });
    row.evidence.push({ kind: 'reviewed-adjacent-static-artwork', sourceSquare: { x: 50, y: 158 },
      inference: 'Western part of the same island, supported by continuous source geometry, the west bridge and the Wiki map centre at x3263. No access is inferred across the broken bridge.',
      sources: [source("Broken bridge (War's Retreat)"), source("War's Retreat"), source("Map:War's Retreat")].filter(Boolean).map(({ title, revisionId, url }) => ({ title, revisionId, url })),
      archiveEvidence: west ? { major: 5, minor: west.minor, archiveSha256: west.archiveSha256, terrainSha256: west.terrainSha256,
        planes: west.planes.map(({ plane, floorTiles, floorBounds }) => ({ plane, floorTiles, floorBounds })) } : null });
    const arrival = station('13214', anchor('wars-arrival'));
    row.displayAnchor = { ...arrival, precision: 'map-marker-anchor' };
    row.entrances.push(route('interior-wars-insignia-draynor', station('12339', anchor('wars-insignia')), arrival, anchor('wars-arrival').evidence));
  } else if (row.mapId === 10004) {
    row.wikiMapId = -1;
    row.displayAnchor = { x: 414, y: 674, plane: 0, mapId: 10004, precision: 'area-center',
      coordinateEvidence: { kind: 'pinned-wiki-office-map-centre', source: source("Death's office"), scope: 'View centre, not an arrival.' } };
    const object = raw.probes.find(p => p.areaId === '1546').squares.flatMap(s => s.objects).find(o => o.objectId === 96782);
    const exit = { ...station('1546', anchor('deaths-hourglass-office'), 10004), plane: object.source.plane,
      coordinateEvidence: { ...coordinateEvidence(anchor('deaths-hourglass-office')), kind: 'exact-cache-object-origin', source: object.source, cacheEvidence: object.evidence } };
    row.sourceAnchors.push(exit);
    row.entrances.push(route('interior-deaths-hourglass-draynor', station('12339', anchor('deaths-hourglass-surface')), exit,
      anchor('deaths-hourglass-office').evidence, ['Exit scenery is anchored on source plane1; visible static floors are plane0. No exact player arrival or plane transform invented.']));
  } else if (row.mapId === 653) {
    const exit = cacheStation('5706', placement(10527)); row.displayAnchor = { ...exit, precision: 'map-marker-anchor' };
    row.entrances.push(route('interior-oldman-cellar-draynor', station('12339', anchor('oldman-trapdoor')), exit, anchor('oldman-trapdoor').evidence,
      ['Entrance depends on the Mysterious Old Man conversation and abduction; current instance unobserved.']));
  } else if (row.mapId === 168) {
    const centre = anchor('puro-map-centre'); row.displayAnchor = { ...station('10307', centre), precision: 'area-center' };
    for (const p of wiki.cacheEvidence.placements.filter(p => p.mapId === 168)) row.sourceAnchors.push(cacheStation('10307', p));
    // Four centre object origins are explicit; no one of them is chosen as a player landing tile.
    row.entrances.push(route('interior-puro-zanaris', cacheStation('Zanaris', placement(24991)), cacheStation('10307', placement(25014)), centre.evidence,
      ['The rotating Draynor crop circle has no verified active entrance/arrival pair. Portal origins are scenery anchors.']));
  } else if (row.mapId === 742) {
    const exit = cacheStation('23', placement(127269)); row.displayAnchor = { ...exit, precision: 'map-marker-anchor' };
    row.entrances.push(route('interior-um-draynor', station('12339', anchor('underworld-portal')), exit, anchor('overworld-portal').evidence,
      ['Wiki marker1023,1761/sourceplane1 differs from exact cache origin1020,1755; original evidence retained. Player landing is unknown.']));
  }
}
// Existing Skullery map gains exact counterpart anchors without changing its access gate.
const skull = cacheStation('5705', placement(75851));
resolutions.push({ areaIds: ['5705', 'The Skullery'], name: 'The Skullery', mapId: 320, planes: [0], renderKind: 'encoded-layout',
  evidence: [{ kind: 'wiki-and-exact-cache-scenery-counterparts', sources: anchor('skullery-trapdoor').evidence, placement: placement(75851) }],
  displayAnchor: { ...skull, precision: 'map-marker-anchor' }, entrances: [route('interior-skullery-draynor', station('12339', anchor('skullery-trapdoor')), skull,
    anchor('skullery-trapdoor').evidence, ['Stolen Hearts bouncer gate preserved; scenery anchors are not player arrivals.'])] });
const report = { schemaVersion: 1, displayOnly: true, accessEffect: 'none', resolutions,
  sources: wiki.sources.map(({ title, revisionId, url, wikitextSha256 }) => ({ title, revisionId, url, wikitextSha256 })),
  inputs: ['static-identities.reviewed.json', 'static-identities.raw.json', 'wiki-entrances.json'].map(file => ({ file: join(scratch, file), sha256: sha256(readFileSync(join(scratch, file))), hashKind: 'exact-bytes' })),
  generator: { file: 'scripts/cache/interiors-v2-review.mjs', sha256: sha256RepositoryText(readFileSync(import.meta.filename)), hashKind: 'repository-lf' } };
mkdirSync(output, { recursive: true });
for (const [file, name] of [['all-layout-coordinate-proposals.final.json', 'all-layout-coordinate-proposals.json'], ['priority.lf.json', 'priority.json'],
  ['wiki-entrances.json', 'wiki-entrances.json'], ['static-identities.reviewed.json', 'static-identities.reviewed.json']]) writeFileSync(join(output, name), readFileSync(join(scratch, file)), { flag: 'wx' });
writeFileSync(join(output, 'resolutions.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, resolutions: resolutions.length }));
