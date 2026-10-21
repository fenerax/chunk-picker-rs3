#!/usr/bin/env node
/** Offline research ranking. Graph reachability is never gameplay access. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

const base = id => String(id).replace(/-\d+$/, '');
const numeric = id => /^[1-9]\d*$/.test(id);
const region = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
const compare = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const nameKey = s => String(s ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
function surface(id, record) {
  if (!numeric(id) || record?.Name) return false;
  const x = Math.ceil((Number(id) - 7495) / 256) || 0, y = x * 256 + 7495 - Number(id);
  return x >= 0 && x < 47 && y >= 0 && y < 50;
}
const ids = value => Array.isArray(value) ? value.map(String) : Object.keys(value ?? {});

/** Accept only an explicitly supplied public/synthetic fixture. No state discovery. */
export function fixtureSeeds(fixture, definitions) {
  const members = fixture.members ?? Object.values(fixture.maps ?? {});
  const unlocked = new Set(), selected = new Set();
  for (const member of members) {
    for (const id of ids(member.unlocked ?? member.chunks?.unlocked)) if (surface(id, definitions.chunks[id])) unlocked.add(id);
    for (const id of ids(member.selected ?? member.chunks?.selected)) if (surface(id, definitions.chunks[id])) selected.add(id);
  }
  const candidate = new Set([...selected].filter(id => !unlocked.has(id)));
  const ring = new Set();
  for (const id of new Set([...unlocked, ...candidate])) for (const delta of [-256, -1, 1, 256]) {
    const target = String(Number(id) + delta);
    if (!definitions.chunks[target] || !surface(target, definitions.chunks[target])) continue;
    if (Math.abs(Math.floor(Number(id) / 256) - Math.floor(Number(target) / 256)) + Math.abs(Number(id) % 256 - Number(target) % 256) !== 1) continue;
    if (!unlocked.has(target) && !candidate.has(target)) ring.add(target);
  }
  return { unlocked: [...unlocked].sort(compare), selected: [...selected].sort(compare), candidate: [...candidate].sort(compare), oneRing: [...ring].sort(compare) };
}

export function buildInteriorPriority({ definitions, catalogue, connections, fixture = {} }) {
  const graph = new Map(), sources = new Map();
  const add = (a, b, kind) => {
    a = base(a); b = base(b);
    if (!definitions.chunks[a] || !definitions.chunks[b] || a === b) return;
    for (const [from, to] of [[a, b], [b, a]]) { if (!graph.has(from)) graph.set(from, new Set()); graph.get(from).add(to); }
    sources.set(kind, (sources.get(kind) ?? 0) + 1);
  };
  for (const [id, record] of Object.entries(definitions.chunks)) {
    for (const target of Object.keys(record.Connect ?? {})) add(id, target, 'Connect');
    for (const [part, section] of Object.entries(record.Sections ?? {})) for (const target of Object.keys(section.Connect ?? {})) add(`${id}-${part}`, target, 'section-Connect');
  }
  for (const [id, sections] of Object.entries(definitions.sections ?? {})) for (const [part, incoming] of Object.entries(sections)) for (const source of incoming) add(source, `${id}-${part}`, 'section-dependency');
  const endpoint = row => row?.sectionId ?? row?.areaId ?? row?.chunkId;
  for (const edge of connections.connections ?? []) { const a = endpoint(edge.from), b = endpoint(edge.to); if (a && b) add(a, b, 'map-connection'); }
  const seeds = fixtureSeeds(fixture, definitions);
  const allSurface = Object.keys(definitions.chunks).filter(id => surface(id, definitions.chunks[id])).sort(compare);
  const bfs = starts => {
    const distance = new Map(), witness = new Map(), queue = [];
    for (const id of starts) { distance.set(id, 0); witness.set(id, { seed: id, path: [id] }); queue.push(id); }
    for (let i = 0; i < queue.length; i++) for (const next of [...(graph.get(queue[i]) ?? [])].sort(compare)) if (!distance.has(next)) {
      distance.set(next, distance.get(queue[i]) + 1);
      const prev = witness.get(queue[i]); witness.set(next, { seed: prev.seed, path: [...prev.path, next] }); queue.push(next);
    }
    return { distance, witness };
  };
  const lanes = [['unlocked', seeds.unlocked], ['selected-candidate', seeds.candidate], ['one-ring', seeds.oneRing], ['general-surface', allSurface]].map(([kind, starts]) => ({ kind, ...bfs(starts) }));
  const ranked = catalogue.areas.filter(row => row.status === 'unknown').map(row => {
    const matches = lanes.map((lane, tier) => ({ tier, kind: lane.kind, distance: lane.distance.get(row.areaId) ?? null, witness: lane.witness.get(row.areaId) ?? null }));
    const local = matches.slice(0, 3).filter(row => row.distance != null).sort((a, b) => a.distance - b.distance || a.tier - b.tier);
    const best = local[0] ?? (matches[3].distance != null ? matches[3] : null);
    return { areaId: row.areaId, name: row.name, numeric: numeric(row.areaId), priorityTier: best?.tier ?? 4, priorityKind: best?.kind ?? 'disconnected', distance: best?.distance ?? null, witness: best?.witness ?? null, distances: Object.fromEntries(matches.map(row => [row.kind, row.distance])), candidateMapIds: row.candidateMapIds ?? [] };
  }).sort((a, b) => Number(a.priorityTier >= 3) - Number(b.priorityTier >= 3) || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.priorityTier - b.priorityTier || compare(a.areaId, b.areaId));
  ranked.forEach((row, index) => row.rank = index + 1);
  const counts = Object.fromEntries(lanes.map(row => [row.kind, ranked.filter(area => area.priorityKind === row.kind).length]));
  counts.disconnected = ranked.filter(area => area.priorityKind === 'disconnected').length;
  return { schemaVersion: 1, displayOnly: true, accessEffect: 'none', seedScope: Object.keys(fixture).length ? 'explicit-public-or-synthetic-fixture' : 'general-surface-fallback', fixtureCapturedAt: fixture.metadata?.capturedAt ?? null,
    methodology: 'Undirected BFS over retained Connect, sections and map connections, with section IDs collapsed to parent records. Fixture neighbourhoods precede general-surface fallback; within each group shortest declaration distance ranks first, with unlocked then selected candidates then one-ring breaking ties. This is research relevance, not reachable gameplay or a roll candidate calculation.',
    seeds, summary: { unknown: ranked.length, numericUnknown: ranked.filter(row => row.numeric).length, surfaceSeeds: allSurface.length, graphNodes: graph.size, declarations: Object.fromEntries(sources), byPriorityKind: counts }, topNamedAreas: ranked.filter(row => !row.numeric || row.name !== row.areaId).slice(0, 40), ranked };
}

/** Coordinate proposals use explicit source region coverage, never map centres.
 * Small synthetic IDs (<256) cannot be treated as packed region coordinates.
 * Multiple templates, planes and maps remain candidates, never auto-resolved. */
export function proposeCoordinateMappings({ catalogue, places, manifest = { maps: [] }, travel = {} }) {
  const maps = new Map(places.mapRecords.map(row => [row.id, row]));
  const witnesses = new Map();
  const add = (id, mapId, evidence) => {
    if (!witnesses.has(id)) witnesses.set(id, new Map());
    const candidates = witnesses.get(id); if (!candidates.has(mapId)) candidates.set(mapId, []);
    candidates.get(mapId).push(evidence);
  };
  // Exact 8x8 source pastes from selected immutable rendered assets.
  const seen = new Set();
  for (const map of manifest.maps ?? []) for (const tile of map.tiles ?? []) for (const block of tile.provenance?.blocks ?? []) {
    const key = JSON.stringify([map.mapId, block.source, block.destination]); if (seen.has(key)) continue; seen.add(key);
    add(region(block.source.x, block.source.y), map.mapId, { kind: 'explicit-source-paste-block', source: block.source, destination: block.destination, size: 8, paste: block.paste });
  }
  // Explicit source/destination label positions supply witnesses even for maps
  // outside the selected v1 renders. Source coordinates are already unpacked.
  for (const row of places.placements ?? []) if (Number.isFinite(row.source?.x) && Number.isFinite(row.source?.y)) add(region(row.source.x, row.source.y), row.mapId, { kind: 'explicit-label-source-coordinate', label: row.label, elementId: row.elementId, source: row.source, destination: { x: row.x, y: row.y, plane: row.plane }, transform: row.transform });
  // Raw labels can belong to dormant templates or unmapped blocks. Only their
  // projected rows above establish a map association; keep raw-only data out.
  for (const row of travel.coordinateStructs ?? []) for (const coordinate of row.coordinates ?? []) for (const projection of coordinate.mapProjections ?? []) add(region(coordinate.x, coordinate.y), projection.mapId, { kind: 'typed-coordinate-map-projection', structId: row.id, strings: row.strings, source: { x: coordinate.x, y: coordinate.y, plane: coordinate.plane, param: coordinate.param }, destination: projection });
  const numericUnknown = catalogue.areas.filter(row => row.status === 'unknown' && numeric(row.areaId));
  const rows = numericUnknown.map(area => {
    const packedRegion = Number(area.areaId) >= 256;
    const x = Math.floor(Number(area.areaId) / 256) * 64, y = Number(area.areaId) % 256 * 64;
    const coverage = places.mapRecords.flatMap(map => (map.bounds ?? []).filter(bound => bound.src.xstart < x + 64 && bound.src.xend >= x && bound.src.zstart < y + 64 && bound.src.zend >= y).map(bound => ({ mapId: map.id, name: map.name, bound })));
    const candidates = packedRegion ? [...(witnesses.get(area.areaId) ?? [])].map(([mapId, evidence]) => {
      const all = evidence, names = all.filter(row => nameKey(row.label) === nameKey(area.name) || row.strings?.some(s => nameKey(s.value) === nameKey(area.name)));
      return { mapId, mapName: maps.get(mapId)?.name ?? null, exactNameWitness: names.length > 0, witnessCount: all.length,
        planes: [...new Set(all.map(row => row.source.plane))].sort(), evidence: [...names, ...all.filter(row => !names.includes(row))].slice(0, 8), evidenceTruncated: all.length > 8 };
    }).sort((a, b) => a.mapId - b.mapId) : [];
    const names = candidates.filter(row => row.exactNameWitness);
    const proposal = names.length === 1 ? [names[0].mapId] : candidates.length === 1 ? [candidates[0].mapId] : [];
    return { areaId: area.areaId, name: area.name, packedRegionAssumption: packedRegion ? 'retained numeric region; coordinate-only association requires review' : 'small synthetic ID; packed-region inference rejected',
      sourceRegion: packedRegion ? { minX: x, minY: y, maxX: x + 64, maxY: y + 64 } : null,
      status: !packedRegion ? 'unresolved-synthetic-id' : proposal.length ? 'coordinate-proposal' : candidates.length ? 'ambiguous-coordinate-candidates' : 'no-explicit-coordinate-witness',
      proposedMapIds: proposal, candidates, mapBoundsOverlaps: packedRegion ? coverage : [], bounds: null, boundsKind: 'semantic-area-enclosure-unknown', accessEffect: 'none',
      limits: 'A packed source region does not identify a semantic enclosure, current instance, entrance or access. Bounds overlap alone never produces a proposal. Repeated map templates remain unresolved unless an explicit coordinate/name witness singles out one map.' };
  });
  const aliasRows = catalogue.areas.filter(area => area.status === 'unknown' && !numeric(area.areaId)).flatMap(area => {
    const aliases = rows.filter(row => nameKey(row.name) === nameKey(area.name) && row.candidates.length);
    if (!aliases.length) return [];
    const proposals = [...new Set(aliases.flatMap(row => row.proposedMapIds))].sort((a, b) => a - b);
    const unresolved = aliases.some(row => row.status !== 'coordinate-proposal');
    return [{ areaId: area.areaId, name: area.name, sourceNumericAreaIds: aliases.map(row => row.areaId),
      status: proposals.length === 1 && !unresolved ? 'exact-name-numeric-alias-proposal' : 'ambiguous-numeric-alias-candidates',
      proposedMapIds: proposals.length === 1 && !unresolved ? proposals : [], candidateMapIds: [...new Set(aliases.flatMap(row => row.candidates.map(candidate => candidate.mapId)))].sort((a, b) => a - b),
      bounds: null, boundsKind: 'semantic-area-enclosure-unknown', accessEffect: 'none', evidence: { kind: 'exact-retained-name-numeric-alias', numericAreaIds: aliases.map(row => row.areaId) },
      limits: 'Retained equal-name alias propagation of coordinate proposals; no independent semantic enclosure, instance or access verification.' }];
  });
  return { schemaVersion: 1, displayOnly: true, accessEffect: 'none', summary: { numericUnknown: rows.length, coordinateProposals: rows.filter(row => row.status === 'coordinate-proposal').length, ambiguous: rows.filter(row => row.status === 'ambiguous-coordinate-candidates').length, synthetic: rows.filter(row => row.status === 'unresolved-synthetic-id').length, noWitness: rows.filter(row => row.status === 'no-explicit-coordinate-witness').length, proposedSurface: rows.filter(row => row.proposedMapIds.includes(28)).length, aliasProposals: aliasRows.filter(row => row.status === 'exact-name-numeric-alias-proposal').length, ambiguousAliases: aliasRows.filter(row => row.status === 'ambiguous-numeric-alias-candidates').length }, rows, aliasRows };
}

function main() {
  const args = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) { if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error('Expected --name value options'); opts[args[i].slice(2)] = args[i + 1]; }
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const read = path => JSON.parse(readFileSync(path));
  const input = { definitions: resolve(repo, opts.definitions ?? 'rs3-chunkpicker-chunkinfo-export.json'), catalogue: resolve(repo, opts.catalogue ?? 'app/data/cache-interiors.2026-10-08.v1.json'), connections: resolve(repo, opts.connections ?? 'archive/data/map-connections.2026-10-08.v2.json'), fixture: resolve(repo, opts.fixture ?? 'tests/fixtures/original-sync/capture.json') };
  if (/\/\.local\/duo(?:\/|$)/i.test(input.fixture.replaceAll('\\', '/'))) throw new Error('Private live state is outside this offline research workflow; supply a public or synthetic fixture.');
  const priority = buildInteriorPriority(Object.fromEntries(Object.entries(input).map(([key, path]) => [key, read(path)])));
  const generator = { file: 'scripts/cache/interiors-v2-priority.mjs', sha256: sha256RepositoryText(readFileSync(fileURLToPath(import.meta.url))), hashKind: 'repository-lf' };
  priority.generator = generator;
  priority.inputs = Object.entries(input).map(([kind, path]) => ({ kind, path, sha256: sha256RepositoryText(readFileSync(path)), hashKind: 'repository-lf' }));
  const output = resolve(repo, opts.output ?? '.local/interiors-v2-research/priority.json'); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(priority, null, 2) + '\n');
  if (opts.places) {
    const proposals = proposeCoordinateMappings({ catalogue: read(input.catalogue), places: read(resolve(opts.places)), manifest: opts.manifest ? read(resolve(opts.manifest)) : undefined, travel: opts.travel ? read(resolve(opts.travel)) : undefined });
    proposals.generator = generator;
    proposals.inputs = ['places', 'manifest', 'travel'].filter(key => opts[key]).map(kind => ({ kind, path: resolve(opts[kind]), sha256: sha256(readFileSync(resolve(opts[kind]))), hashKind: 'exact-bytes' }));
    const proposalOutput = resolve(repo, opts['coordinate-output'] ?? '.local/interiors-v2-research/coordinate-proposals.json'); mkdirSync(dirname(proposalOutput), { recursive: true }); writeFileSync(proposalOutput, JSON.stringify(proposals, null, 2) + '\n');
    console.log(JSON.stringify({ priority: priority.summary, coordinates: proposals.summary, output, proposalOutput }));
  } else console.log(JSON.stringify({ ...priority.summary, output }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
