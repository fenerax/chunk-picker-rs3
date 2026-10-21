#!/usr/bin/env node
import { selectedDataset } from '../app/dataset-runtime.mjs';
// Deliberately offline and advisory: nothing in app/ imports these outputs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { CacheCopy, loadDecoders, RSMV_COMMIT, sha256, fileSha256 } from './cache/cache-reader.mjs';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { loadSurfaceLayout, mapsquareId, inCrop } from './cache/surface.mjs';
import { analyzeSurfaceCollision, serializeCollision } from './cache/collision.mjs';
import { buildWorld } from '../app/data/world.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGINAL = 'C:/ProgramData/Jagex/RuneScape';

function options(argv) {
  const result = { build: 950 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--cache-copy', '--tool', '--output', '--build', '--baseline', '--publish-new', '--openable-evidence'].includes(key))
      throw new Error(`Unknown option ${key}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
    result[key.slice(2)] = argv[++i];
  }
  for (const name of ['cache-copy', 'tool', 'output']) if (!result[name]) throw new Error(`Required --${name}`);
  result.build = Number(result.build);
  if (!Number.isInteger(result.build) || result.build < 936) throw new Error('This importer requires a modern jagx cache build >=936');
  return result;
}

export function loadDefinitions(cache, major, kind, groupSize = 256) {
  const definitions = new Map(), errors = [];
  for (const minor of cache.table(major).entries.keys()) {
    let archive;
    try { archive = cache.archive(major, minor); }
    catch (error) { errors.push({ major, minor, message: error.message }); continue; }
    if (!archive) { errors.push({ major, minor, message: 'Missing local archive' }); continue; }
    for (const [subid, bytes] of archive) {
      const id = minor * groupSize + subid;
      try { definitions.set(id, cache.decoders.decode(kind, bytes)); }
      catch (error) { errors.push({ major, minor, subid, id, message: error.message }); }
    }
  }
  return { definitions, errors };
}

export function loadSurfaceSquares(cache, layout) {
  const sources = new Map(), squares = [], coverage = [];
  const pasted = new Map([...layout.blocks.values()].filter(row => inCrop(row.destination.x, row.destination.y))
    .map(row => [`${row.paste.kind}:${row.paste.index}`, row.paste]));
  for (const paste of pasted.values()) {
    if (paste.original_chunkX !== undefined) throw new Error('Chunk pastes need a new collision transform implementation');
    const sourceId = mapsquareId(paste.original_regionX, paste.original_regionY);
    if (!sources.has(sourceId)) {
      const source = { x: paste.original_regionX, z: paste.original_regionY };
      try {
        const a = cache.archive(5, sourceId);
        if (!a?.has(3)) source.error = 'Missing tile subfile 3';
        else {
          source.tiles = cache.decoders.decode('tiles', a.get(3));
          source.locations = a.has(0) ? cache.decoders.decode('locations', a.get(0)) : { locations: [] };
          if (a.has(5)) source.nxttiles = cache.decoders.decode('nxt', a.get(5));
          source.archive = { major: 5, minor: sourceId, version: cache.table(5).entries.get(sourceId)?.version,
            sha256: sha256(cache.file(5, sourceId)), subfiles: [...a.keys()] };
        }
      } catch (error) { source.error = error.message; }
      sources.set(sourceId, source);
    }
    const source = sources.get(sourceId);
    const offset = paste.original_plane - paste.new_plane;
    let tiles = source.tiles, nxttiles = source.nxttiles, locations = source.locations;
    if (offset !== 0) {
      tiles = tiles ? { ...tiles, tiles: Array.from({ length: 4 * 4096 }, (_, i) => tiles.tiles[i + offset * 4096]) } : null;
      nxttiles = nxttiles ? Object.fromEntries([0, 1, 2, 3].map(p => [`level${p}`, nxttiles[`level${p + offset}`]])) : null;
      locations = locations ? { locations: locations.locations.map(loc => ({ ...loc,
        uses: loc.uses.map(use => ({ ...use, plane: use.plane - offset })).filter(use => use.plane >= 0 && use.plane < 4) })) } : null;
    }
    const square = { ...source, x: paste.new_regionX, z: paste.new_regionY, tiles, nxttiles, locations,
      provenance: { sourceX: source.x, sourceY: source.z, sourcePlane: paste.original_plane,
        destinationPlane: paste.new_plane, mapId: 28, paste, archive: source.archive ?? null } };
    squares.push(square);
    coverage.push({ region: String(square.x * 256 + square.z), sourceId, error: source.error ?? null });
  }
  return { sources, squares, coverage };
}

/** Objects just west/south of a pasted square can extend into it. Width/length
 * opcodes are bytes (max255); walls also need the east/north reciprocal anchor.
 * Load declared archives in this halo even when their anchors have no map paste. */
export function loadSourceHalo(cache, sources, { radius = 4, progress = () => {} } = {}) {
  const needed = new Set();
  for (const source of sources.values()) for (let dx = -radius; dx <= 1; dx++) for (let dz = -radius; dz <= 1; dz++) {
    const x = source.x + dx, z = source.z + dz;
    if (x < 0 || x >= 128 || z < 0) continue;
    const id = mapsquareId(x, z);
    if (!sources.has(id) && cache.table(5).entries.has(id)) needed.add(id);
  }
  const errors = [], noLocationSubfile = [];
  let loaded = 0;
  for (const id of needed) {
    const source = { x: id % 128, z: Math.floor(id / 128), halo: true };
    try {
      const archive = cache.archive(5, id);
      if (!archive) throw new Error('Missing declared halo archive');
      // Environment/metadata-only map archives omit both terrain and locations.
      // The decoded index positively lists their subfiles; omission of0 means
      // no location payload, distinct from a missing copied archive/blob.
      if (!archive.has(0)) { noLocationSubfile.push(id); continue; }
      if (!archive.has(3)) throw new Error('Locations present without bridge terrain');
      source.locations = cache.decoders.decode('locations', archive.get(0));
      source.tiles = cache.decoders.decode('tiles', archive.get(3));
      // Only plane1 bridge flags are needed at original collision anchors.
      source.tiles.tiles.length = 8192;
      if (archive.has(5)) {
        source.nxttiles = cache.decoders.decode('nxt', archive.get(5));
        delete source.nxttiles.level2; delete source.nxttiles.level3;
      }
      sources.set(id, source); loaded++;
    } catch (error) { errors.push({ major: 5, minor: id, message: error.message }); }
    if (loaded && loaded % 100 === 0 && sources.has(id)) progress({ loaded, needed: needed.size });
  }
  if (errors.length) throw new Error(`Cannot certify source-border clipping: ${errors.length} halo decode failures (${JSON.stringify(errors.slice(0, 3))})`);
  return { radiusRegionsWestSouth: radius, reciprocalRegionsEastNorth: 1, loaded, declaredNeeded: needed.size,
    noLocationSubfile, absentIndexEntries: 'No declared archive: no source locations to load', errors };
}

export function comparePicker(analysis, definitions) {
  const world = buildWorld(definitions, { dataset: selectedDataset }), discrepancies = { unwalkableWithTiles: [], walkableWithoutTiles: [], unknownWalkable: [],
    undefinedWithTiles: [], missingRegionConnections: [], extraRegionConnections: [], nonWalkingDependencies: [], sectionCandidates: [] };
  const pair = (a, b) => [String(a), String(b)].sort((x, y) => Number(x) - Number(y)).join('|');
  const observed = new Map();
  for (const e of analysis.edges) {
    const a = e.from.split(':')[0], b = e.to.split(':')[0], key = pair(a, b);
    if (!observed.has(key)) observed.set(key, []);
    observed.get(key).push(e);
  }
  const recorded = new Map();
  for (const [id, sections] of world.sectionTopology) {
    for (const [section, dependencies] of sections) for (const dependency of dependencies) {
      const [other] = dependency.split('-');
      if (other === id) continue;
      const routeKind = world.sectionRoutes.get(`${id}-${section}`)?.get(dependency);
      if (!world.neighbors.get(id)?.includes(other) || ['transport', 'unresolved', 'typo'].includes(routeKind)) {
        discrepancies.nonWalkingDependencies.push({ region: id, section, dependency, routeKind: routeKind ?? 'non-orthogonal' }); continue;
      }
      const key = pair(id, other);
      if (!recorded.has(key)) recorded.set(key, []);
      recorded.get(key).push({ region: id, section, dependency });
    }
  }
  for (const r of analysis.regions.values()) {
    const count = r.components.reduce((n, c) => n + c.tiles, 0), row = { region: r.id,
      name: world.chunks.get(r.id)?.name ?? null, status: r.status, tiles: count, components: r.components.length };
    if (world.surface.has(r.id)) {
      if (!world.walkable.has(r.id) && count) discrepancies.unwalkableWithTiles.push(row);
      if (world.walkable.has(r.id) && !count) (r.status === 'decoded' ? discrepancies.walkableWithoutTiles : discrepancies.unknownWalkable).push(row);
    } else if (count) discrepancies.undefinedWithTiles.push(row);
    // Legacy sections have no tile masks. Match neighbour signatures provisionally;
    // never silently equate scan-order component numbers with legacy section IDs.
    if (world.sectionTopology.has(r.id)) for (const [section, deps] of world.sectionTopology.get(r.id)) {
      const neighbors = [...new Set(deps.map(d => d.split('-')[0]).filter(n => n !== r.id && world.neighbors.get(r.id)?.includes(n)))].sort();
      const candidates = r.components.map(c => {
        const touches = [...new Set(analysis.edges.filter(e => e.from === c.id || e.to === c.id)
          .map(e => (e.from === c.id ? e.to : e.from).split(':')[0]))].sort();
        const hits = neighbors.filter(n => touches.includes(n)).length;
        return { component: c.id, tiles: c.tiles, touches, hits, missing: neighbors.filter(n => !touches.includes(n)) };
      }).filter(c => c.hits || neighbors.length === 0);
      discrepancies.sectionCandidates.push({ region: r.id, section, neighbors,
        sectionF2p: world.sectionMembership.get(r.id)?.get(section) ?? null, candidates });
    }
  }
  for (const [key, edges] of observed) if (!recorded.has(key)) {
    const [a, b] = key.split('|');
    discrepancies.missingRegionConnections.push({ regions: [a, b], defined: [world.surface.has(a), world.surface.has(b)],
      components: edges.map(e => [e.from, e.to]), portals: edges.reduce((n, e) => n + e.portals.length, 0),
      witness: edges[0].portals[0] });
  }
  for (const [key, dependencies] of recorded) if (!observed.has(key)) {
    const regions = key.split('|');
    discrepancies.extraRegionConnections.push({ regions, dependencies,
      statuses: regions.map(id => analysis.regions.get(id)?.status ?? 'outside-crop'),
      confidence: regions.every(id => analysis.regions.get(id)?.status === 'decoded') ? 'review-static-or-conditional' : 'unknown-coverage' });
  }
  return { baseline: { walkable: world.walkable.size, f2p: world.f2p.size, surfaceRecords: world.surface.size,
    topologyBases: world.sectionTopology.size }, counts: Object.fromEntries(Object.entries(discrepancies).map(([k, v]) => [k, v.length])), ...discrepancies };
}

export function validateLandmarks(analysis) {
  // Landmark expectations are independent game-geography assertions. Exact clipping
  // at a courtyard/road point is also inspected in the output; no expected mask is authored.
  const checks = [
    { name: 'Lumbridge castle courtyard', x: 3222, z: 3218, expected: true },
    { name: 'Lumbridge river interior', x: 3244, z: 3223, expected: false },
    { name: 'Port Sarim surface approach', x: 3032, z: 3247, expected: true },
    { name: 'Draynor surface approach', x: 3076, z: 3247, expected: true },
    { name: 'Draynor-Port Sarim northern road west', x: 3033, z: 3275, expected: true },
    { name: 'Draynor-Port Sarim northern road east', x: 3076, z: 3275, expected: true },
  ].map(check => ({ ...check, observed: analysis.query(check.x, check.z) }));
  const wall = { name: 'Varrock masonry wall reciprocal clipping', a: analysis.query(3201, 3400),
    b: analysis.query(3202, 3400) };
  wall.pass = wall.a.known && wall.b.known && !!(wall.a.wallMask & 4) && !!(wall.b.wallMask & 1);
  const roadReach = analysis.reachable({ starts: [{ x: 3032, z: 3247 }], claimed: ['12082', '12338', '12083'] });
  const road = { name: 'Port Sarim-Draynor surface route around the inlet', claimed: ['12082', '12338', '12083'],
    reachedComponents: roadReach.components, target: analysis.query(3076, 3247).component,
    pass: roadReach.components.includes(analysis.query(3076, 3247).component) };
  const northReach = analysis.reachable({ starts: [{ x: 3033, z: 3275 }], claimed: ['12083', '12339'] });
  const northRoad = { name: 'Draynor-Port Sarim northern road through two claimed regions', claimed: ['12083', '12339'],
    reachedComponents: northReach.components, target: analysis.query(3076, 3275).component,
    pass: northReach.components.includes(analysis.query(3076, 3275).component) };
  return { checks: checks.map(check => ({ ...check, pass: check.observed.known && check.observed.walkable === check.expected })),
    walls: [wall], routes: [road, northRoad],
    pass: checks.every(check => check.observed.known && check.observed.walkable === check.expected) && wall.pass && road.pass && northRoad.pass,
    scope: 'Offline decoded landmark observations; no client movement performed' };
}

function writeNew(path, bytes) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, bytes, { flag: 'wx' });
  return { path: path.replaceAll('\\', '/'), bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) };
}

export async function importCache(opt) {
  const output = resolve(opt.output), tool = resolve(opt.tool), copy = resolve(opt['cache-copy']);
  if (copy.replaceAll('\\', '/').toLowerCase() === ORIGINAL.toLowerCase()) throw new Error('Original cache prohibited');
  if (existsSync(output)) throw new Error('Output directory already exists; use a new version');
  const commit = execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== RSMV_COMMIT) throw new Error(`Tool must be pinned at ${RSMV_COMMIT}`);
  if (execFileSync('git', ['-C', tool, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Tool source has local changes');
  const decoders = await loadDecoders(tool, opt.build), cache = new CacheCopy(copy, decoders);
  try {
    console.log('Reading map28 surface layout and copied map squares');
    const layout = loadSurfaceLayout(cache), decoded = loadSurfaceSquares(cache, layout);
    console.log(`Decoded ${decoded.sources.size} source regions into ${decoded.squares.length} surface regions`);
    console.log('Reading object/location definitions');
    const { definitions: locDefinitions, errors: locErrors } = loadDefinitions(cache, 16, 'loc');
    console.log(`Decoded ${locDefinitions.size} location definitions (${locErrors.length} errors)`);
    const halo = loadSourceHalo(cache, decoded.sources, { progress: row => console.log(`Source object halo ${row.loaded}/${row.needed}`) });
    console.log(`Loaded ${halo.loaded} additional source regions for border clipping`);
    const openableEvidence = opt['openable-evidence'] ? new Map(JSON.parse(readFileSync(opt['openable-evidence'], 'utf8'))) : new Map();
    const analysis = analyzeSurfaceCollision({ squares: decoded.squares, sourceSquares: decoded.sources, locDefinitions, openableEvidence });
    const definitions = JSON.parse(readFileSync(join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
    const comparison = comparePicker(analysis, definitions), validations = validateLandmarks(analysis);
    const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), purpose: 'private advisory cache audit',
      tool: { name: 'rsmv opcode interpreter/schemas only', repository: 'https://github.com/skillbert/rsmv',
        commit, buildSchema: opt.build, node: process.version, sourceHashes: decoders.sourceHashes },
      sources: [], layout: { mapId: 28, plane: 0, name: layout.name, blocks: layout.blocks.size,
        disabled: layout.disabled, squareCount: decoded.squares.length, sourceCount: decoded.sources.size, halo },
      decoderErrors: locErrors, validation: validations, outputs: [],
      reference: { file: 'rs3-chunkpicker-chunkinfo-export.json', sha256: sha256RepositoryText(readFileSync(join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'))) },
      limits: ['A copied local snapshot, not guaranteed latest live game data',
        'No player variables or server scripts. Closed doors/conditional morphs can withhold real routes.',
        'Legacy sections have no tile geometry; neighbor-signature correspondences are provisional.'] };
    // Membership and pins modules are kept independent of gameplay code.
    const membershipModule = await import('./cache/membership.mjs');
    const membership = membershipModule.analyzeMembership(analysis, decoded.squares, comparison);
    const pinModule = await import('./cache/pins.mjs');
    const pinResult = await pinModule.extractSurfacePins({ cache, layout, locDefinitions, squares: decoded.sources });
    const baseline = opt.baseline ? JSON.parse(readFileSync(opt.baseline, 'utf8')) : null;
    const pinComparison = baseline ? pinModule.comparePins(pinResult.pins, baseline.pins) : null;
    if (baseline) manifest.baselinePins = { path: resolve(opt.baseline).replaceAll('\\', '/'),
      sha256: sha256(readFileSync(opt.baseline)), pins: baseline.pins.length,
      method: baseline.reconstruction?.method ?? baseline.provenance?.method ?? 'Caller-supplied normalized baseline',
      reconstruction: baseline.reconstruction ?? null, provenance: baseline.provenance ?? null };
    const waterAudit = rows => rows.filter(pin => pin.spriteId != null).map(pin => ({ id: pin.id, x: pin.x, y: pin.y,
      label: pin.label, spriteId: pin.spriteId, category: pin.category ?? pin.categoryId,
      collision: analysis.query(pin.x, pin.y) })).filter(row => row.collision.water || !row.collision.known);
    const ocean = { method: 'Decoded water-rendering presence and collision coverage; blocked water is a review candidate, not proof of erroneous facility placement',
      current: waterAudit(pinResult.pins), baseline: baseline ? waterAudit(baseline.pins) : [],
      limits: ['Coastal/shallow water can be walkable. Boats, fishing symbols and label anchors can intentionally lie in water.',
        'Unknown layout or clipping is not classified as ocean. No pin is relocated by guessed offsets.'] };
    const spriteResult = pinModule.exportPinSprites(cache, pinResult);
    const spriteManifest = { requested: spriteResult.requested, missing: spriteResult.missing, sprites: [], limits: spriteResult.limits };
    mkdirSync(output, { recursive: true });
    manifest.outputs.push(writeNew(join(output, 'walkability.v1.json.gz'), gzipSync(Buffer.from(JSON.stringify(serializeCollision(analysis))))));
    manifest.outputs.push(writeNew(join(output, 'picker-comparison.v1.json'), JSON.stringify(comparison)));
    manifest.outputs.push(writeNew(join(output, 'membership.v1.json'), JSON.stringify(membership)));
    manifest.outputs.push(writeNew(join(output, 'pins.cache-v1.json'), JSON.stringify(pinResult)));
    if (pinComparison) manifest.outputs.push(writeNew(join(output, 'pins-comparison.v1.json'), JSON.stringify(pinComparison)));
    manifest.outputs.push(writeNew(join(output, 'pins-water-audit.v1.json'), JSON.stringify(ocean)));
    for (const sprite of spriteResult.sprites) {
      const frames = sprite.frames.map(({ png, ...frame }) => {
        const asset = png ? writeNew(join(output, 'sprites', `${sprite.spriteId}-${frame.index}.png`), png) : null;
        return { ...frame, asset };
      });
      spriteManifest.sprites.push({ spriteId: sprite.spriteId, sourceSha256: sprite.sourceSha256, frames });
    }
    manifest.outputs.push(writeNew(join(output, 'sprites-manifest.v1.json'), JSON.stringify(spriteManifest)));
    for (const [major, table] of cache.tables) manifest.sources.push({ major, name: `js5-${major}.jcache`, bytes: statSync(table.path).size,
      sha256: await fileSha256(table.path), indexTimestamp: table.index.timestamp,
      indexDate: new Date(table.index.timestamp * 1000).toISOString(), archives: table.entries.size,
      presentArchives: table.db.prepare('SELECT COUNT(*) AS n FROM cache').get().n });
    const compact = { schemaVersion: 1, provenance: { toolCommit: commit, buildSchema: opt.build,
      snapshot: manifest.sources.map(s => [s.major, s.sha256, s.indexTimestamp]), mapId: 28, plane: 0,
      referenceSha256: manifest.reference.sha256, advisory: true, maskOrder: 'x*64+z' },
      schema: { regions: '[id,status,walkableTileCount,components]', component: '[label,tiles,minX,minY,maxX,maxY]',
        edges: '[fromComponent,toComponent,portalCount,witnessX,witnessY]' },
      regions: [...analysis.regions.values()].map(r => [r.id, r.status,
        r.components.reduce((n, c) => n + c.tiles, 0), r.components.map(c => [c.label, c.tiles, c.minX, c.minZ, c.maxX, c.maxZ])]),
      edges: analysis.edges.map(e => [e.from, e.to, e.portals.length, e.portals[0].x, e.portals[0].z]), summary: analysis.summary };
    manifest.outputs.push(writeNew(join(output, 'regions.compact.v1.json'), JSON.stringify(compact)));
    manifest.outputs.push(writeNew(join(output, 'validation.v1.json'), JSON.stringify({ ...validations, summary: analysis.summary })));
    writeNew(join(output, 'manifest.v1.json'), JSON.stringify(manifest, null, 2));
    if (opt['publish-new']) {
      const { publishCacheAssets } = await import('./cache/publish.mjs');
      publishCacheAssets({ output, publish: opt['publish-new'] });
    }
    console.log(JSON.stringify({ output, summary: analysis.summary, comparison: comparison.counts,
      validation: validations, compactBytes: Buffer.byteLength(JSON.stringify(compact)), pins: pinResult.summary ?? pinResult.counts }, null, 2));
    return { output, manifest, analysis, comparison, membership, pinResult, pinComparison, compact };
  } finally { cache.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  importCache(options(process.argv.slice(2))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
