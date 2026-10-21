#!/usr/bin/env node
// Immutable delta publication: existing renders are verified and plain-copied.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, basename, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CacheCopy, loadDecoders, RSMV_COMMIT, fileSha256 } from './cache/cache-reader.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { loadSurfaceLayout } from './cache/surface.mjs';
import { rgbaPng, createDefinitionResolver } from './cache/pins.mjs';
import { loadFloorRenderer, makeFloorGrid, maskSurfacePixels } from './render-cache-terrain.mjs';
import { interiorWalls } from './render-cache-interiors.mjs';
import { assembleInteriorSquare, interiorBounds } from './cache/interior-layout.mjs';
import { regionLayout, directSourceLayout, layoutAnchor, applyInteriorResolution, resolveNamedAliases } from './cache/interiors-v2-catalogue.mjs';
import { buildInteriorConnections } from './cache/interiors-v2-connections.mjs';
import { puroWheatFootprints, addWheatFootprints } from './cache/interiors-v2-scenery.mjs';

const root = resolve(import.meta.dirname, '..');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const defaults = { 'cache-copy': 'C:/Users/User/Projects/rs3-cache-work/cache-copy', tool: 'C:/Users/User/Projects/rs3-cache-work/rsmv',
  rasterizer: 'C:/Users/User/Projects/rs3-cache-work/terrain-render-runtime-2026-10-08-v1/node_modules/@resvg/resvg-js/index.js',
  'base-assets': 'C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets',
  places: 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json',
  proposals: join(root, '.local/interiors-v2-research/all-layout-coordinate-proposals.json'),
  review: join(root, '.local/interiors-v2-research/resolutions.json'),
  priority: join(root, '.local/interiors-v2-research/priority.json') };

export async function renderInteriorV2(options) {
  const args = { ...defaults, ...options }, output = resolve(args.output), directory = basename(output);
  if (!output.startsWith(join(root, '.local', 'map-assets') + '\\') && !output.startsWith(join(root, '.local', 'map-assets') + '/')) throw new Error('Output must be inside this worktree .local/map-assets');
  if (!/^interiors\.cache-[A-Za-z0-9_-]+$/.test(directory) || existsSync(output)) throw new Error('Use a new immutable interior asset directory');
  const cataloguePath = resolve(args.catalogue ?? join(root, 'app/data/cache-interiors.2026-10-08.v2.json'));
  const connectionsPath = resolve(args.connections ?? join(root, 'archive/data/map-connections.2026-10-08.v3.json'));
  for (const file of [cataloguePath, connectionsPath]) if (!file.startsWith(root + '\\') && !file.startsWith(root + '/') || existsSync(file)) throw new Error('Use new worktree catalogue/connection paths');
  const baseFile = resolve(args['base-catalogue'] ?? join(root, 'app/data/cache-interiors.2026-10-08.v1.json')), base = json(baseFile);
  const oldManifestFile = join(args['base-assets'], base.assets.manifestPath), oldManifestBytes = readFileSync(oldManifestFile);
  if (sha256(oldManifestBytes) !== base.assets.manifestSha256) throw new Error('Base asset manifest mismatch');
  const oldManifest = JSON.parse(oldManifestBytes), places = json(args.places), proposals = json(args.proposals), review = json(args.review), priority = json(args.priority);
  const tool = realpathSync(args.tool);
  if (execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== RSMV_COMMIT) throw new Error('Unpinned renderer');
  execFileSync('git', ['-C', tool, 'diff', '--quiet', 'HEAD', '--', 'src/map/svgrender.ts', 'src/3d/mapsquare.ts', 'src/utils.ts', 'src/constants.ts', 'src/parser/opcode_reader.ts', 'src/opcodes']);
  const packageFile = join(resolve(args.rasterizer, '..'), 'package.json'), packageInfo = json(packageFile);
  if (packageInfo.name !== '@resvg/resvg-js' || packageInfo.version !== '2.6.2') throw new Error('Wrong rasterizer');
  const { Resvg } = await import(pathToFileURL(realpathSync(args.rasterizer)));
  const renderer = loadFloorRenderer(tool), decoders = await loadDecoders(tool, 950), cache = new CacheCopy(args['cache-copy'], decoders);
  const maps = new Map(), layouts = new Map(), records = new Map(places.mapRecords.map(m => [m.id, m])), errors = [], rejections = [];
  const catalogue = structuredClone(base);
  const getLayout = (mapId, plane) => {
    const key = `${mapId}:${plane}`;
    if (!layouts.has(key)) layouts.set(key, loadSurfaceLayout(cache, { mapId, plane }));
    return layouts.get(key);
  };
  const register = layout => {
    const key = `${layout.mapId}:${layout.plane}`;
    if (!maps.has(key)) maps.set(key, { layout, record: records.get(layout.mapId), existing: null });
    else if (layout.mapId === 28) for (const [key, block] of layout.blocks) maps.get(`${layout.mapId}:${layout.plane}`).layout.blocks.set(key, block);
  };
  try {
    // Copy every historical verified tile into the new version; originals stay intact.
    const forceRerender = new Set([168]); // v2 adds exact named wheat footprints to the floor-only v1 view.
    for (const map of oldManifest.maps.filter(m => !forceRerender.has(m.mapId))) {
      const copy = structuredClone(map);
      for (const tile of copy.tiles) {
        const bytes = readFileSync(join(args['base-assets'], tile.path));
        if (bytes.length !== tile.bytes || sha256(bytes) !== tile.sha256) throw new Error(`Base tile mismatch ${tile.path}`);
        tile.reusedFrom = tile.path; tile.path = `${directory}/${map.mapId}/2/${map.plane}_${tile.x}_${tile.y}.png`;
        const file = join(output, tile.path.slice(directory.length + 1)); mkdirSync(resolve(file, '..'), { recursive: true });
        writeFileSync(file, bytes, { flag: 'wx' });
      }
      maps.set(`${map.mapId}:${map.plane}`, { existing: copy });
    }
    const ordered = [...proposals.rows].sort((a, b) => (priority.ranked.find(r => r.areaId === a.areaId)?.rank ?? 9999) - (priority.ranked.find(r => r.areaId === b.areaId)?.rank ?? 9999));
    for (const row of ordered.filter(r => r.status === 'coordinate-proposal')) {
      const area = catalogue.areas.find(a => a.areaId === row.areaId);
      if (!area || area.status !== 'unknown') continue;
      const layers = [];
      for (const mapId of row.proposedMapIds) for (let plane = 0; plane < 4; plane++) {
        let layout;
        try { layout = regionLayout(getLayout(mapId, plane), row.sourceRegion); }
        catch (error) { rejections.push({ areaId: row.areaId, mapId, plane, reason: error.message }); continue; }
        // Encoded source plane 4 in map742 is outside the four-plane terrain format.
        for (const [key, block] of layout.blocks) if (block.source.plane > 3) layout.blocks.delete(key);
        if (!layout.blocks.size) continue;
        const bounds = interiorBounds(layout.blocks);
        layers.push({ mapId, plane, bounds, boundsKind: 'exact-retained-source-region-paste-coverage' });
        if (mapId === 28) register(layout); else if (!maps.has(`${mapId}:${plane}`)) register(getLayout(mapId, plane));
      }
      if (!layers.length) { rejections.push({ areaId: row.areaId, reason: 'No active exact source paste found for coordinate proposal' }); continue; }
      const evidence = [{ kind: 'exact-retained-source-region-pastes', sourceRegion: row.sourceRegion,
        mapIds: row.proposedMapIds, witnesses: row.candidates.flatMap(c => c.evidence),
        scope: 'Retained numeric source reference projected by explicit active 8x8 pastes; semantic enclosure and live instance unknown.' }];
      const selected = regionLayout(getLayout(layers[0].mapId, layers[0].plane), row.sourceRegion);
      applyInteriorResolution(area, { mapIds: [...new Set(layers.map(l => l.mapId))], layers, evidence, displayAnchor: layoutAnchor(selected, evidence) });
    }
    // Reviewed identities include exact-name mismatches and two unzoned templates.
    for (const resolution of review.resolutions) {
      const layers = [];
      for (const plane of resolution.planes) {
        const layout = resolution.renderKind === 'direct-source' ? directSourceLayout(resolution.mapId, plane, resolution.sourceSquares, resolution.evidence)
          : getLayout(resolution.mapId, plane);
        for (const [key, block] of layout.blocks) if (block.source.plane > 3) layout.blocks.delete(key);
        if (!layout.blocks.size) continue;
        register(layout);
        if (resolution.renderKind === 'direct-source') maps.get(`${resolution.mapId}:${plane}`).record = resolution;
        layers.push({ mapId: resolution.mapId, plane, bounds: interiorBounds(layout.blocks),
          boundsKind: resolution.renderKind === 'direct-source' ? 'reviewed-static-source-template-coverage' : 'exact-layout-coverage' });
      }
      if (!layers.length) throw new Error(`Reviewed map has no layout: ${resolution.name}`);
      for (const area of catalogue.areas.filter(a => resolution.areaIds.includes(a.areaId) || a.name === resolution.name)) {
        applyInteriorResolution(area, { mapIds: [resolution.mapId], layers, evidence: resolution.evidence,
          displayAnchor: resolution.displayAnchor, entrances: resolution.entrances ?? [] });
        area.sourceAnchors = resolution.sourceAnchors ?? [];
      }
    }
    resolveNamedAliases(catalogue.areas);
    const defs = kind => { const result = []; for (const [id, bytes] of cache.archive(2, kind === 'underlay' ? 1 : 4)) result[id] = decoders.decode(kind, bytes); return result; };
    const engine = { mapUnderlays: defs('underlay'), mapOverlays: defs('overlay'), getFileById() { throw new Error('No sprites/models'); } };
    const resolver = createDefinitionResolver(id => cache.object(16, id, 'loc'), () => null);
    const rendered = [];
    for (const [key, entry] of maps) {
      if (entry.existing) { rendered.push(entry.existing); continue; }
      const { layout, record = {} } = entry, { mapId, plane } = layout;
      // New encoded maps use their whole independently rendered layer; map28 is a selected off-surface subset.
      const coordinates = [...new Set([...layout.blocks.values()].map(b => `${Math.floor(b.destination.x / 64)},${Math.floor(b.destination.y / 64)}`))];
      const direct = record.renderKind === 'direct-source';
      const map = { mapId, cacheMapId: direct ? null : mapId, wikiMapId: record.wikiMapId ?? null,
        name: record.name ?? layout.name, internalName: record.internal_name ?? `reviewed_source_${mapId}`, plane,
        offSurface: true, bounds: interiorBounds(layout.blocks),
        boundsKind: direct ? 'reviewed-static-source-template-coverage' : mapId === 28 ? 'exact-selected-off-surface-paste-coverage' : 'exact-layout-coverage',
        layoutEvidence: direct ? { kind: 'reviewed-direct-source-template', cacheMapId: null, blocks: layout.blocks.size, evidence: record.evidence }
          : { kind: 'encoded-cache-pastes', major: 23, mapId, zoneSha256: sha256(cache.archive(23, 0).get(mapId)),
            pasteSha256: sha256(cache.archive(23, 1).get(mapId)), blocks: layout.blocks.size }, tiles: [] };
      mkdirSync(join(output, String(mapId), '2'), { recursive: true });
      for (const coordinate of coordinates) {
        const [x, y] = coordinate.split(',').map(Number);
        try {
          const square = assembleInteriorSquare(cache, layout, x, y), grid = makeFloorGrid(square, engine, renderer), walls = interiorWalls(square, grid, resolver);
          let svg = await renderer.svgfloor(engine, grid, walls, { x: x * 64, z: y * 64, xsize: 64, zsize: 64 }, 0, 4, false, false);
          const wheat = mapId === 168 ? puroWheatFootprints(square, id => cache.object(16, id, 'loc')) : [];
          svg = addWheatFootprints(svg, square, wheat);
          if (/maplabel-|mapscene-|<text\b|<use\b/.test(svg)) throw new Error('Baked labels or icons');
          const raster = new Resvg(svg, { font: { loadSystemFonts: false }, logLevel: 'off' }).render();
          if (raster.width !== 256 || raster.height !== 256) throw new Error('Wrong PNG dimensions');
          const pixels = raster.pixels, coverage = maskSurfacePixels(pixels, grid, square), png = rgbaPng(256, 256, pixels);
          const path = `${directory}/${mapId}/2/${plane}_${x}_${y}.png`;
          writeFileSync(join(output, String(mapId), '2', `${plane}_${x}_${y}.png`), png, { flag: 'wx' });
          map.tiles.push({ x, y, plane, path, status: 'rendered', bytes: png.length, sha256: sha256(png), ...coverage,
            floorTiles: grid.floor.reduce((a, b) => a + b, 0), wallPlacements: walls.length,
            ...(wheat.length ? { sceneryFootprints: { kind: 'static-named-magical-wheat', count: wheat.length, rectangles: wheat,
              unknowns: ['Moving wheat/morph state and scenery models are unobserved; these are exact static ground footprints only.'] } } : {}),
            provenance: square.provenance });
        } catch (error) { errors.push({ mapId, plane, x, y, error: error.message.split('\n')[0] }); }
      }
      if (map.tiles.some(t => t.artworkPixels > 0)) rendered.push(map);
      console.log(`${key}: ${map.tiles.length} tiles; errors ${errors.length}`);
    }
    if (errors.length) throw new Error(`Incomplete render: ${JSON.stringify(errors)}`);
    catalogue.maps = rendered.map(({ tiles, ...map }) => ({ ...map, tiles: tiles.map(({ provenance, ...tile }) => tile) }));
    for (const area of catalogue.areas) {
      area.layers = area.layers.filter(l => catalogue.maps.some(m => m.mapId === l.mapId && m.plane === l.plane));
      if (area.status === 'mapped' && !area.layers.length) {
        area.status = 'unknown'; area.mapIds = []; area.displayAnchor = null;
        area.unknowns = ['No non-empty rendered static floor layer available for proposed source association.'];
        rejections.push({ areaId: area.areaId, reason: area.unknowns[0] });
      } else area.mapIds = [...new Set(area.layers.map(l => l.mapId))];
      const rank = priority.ranked.find(r => r.areaId === area.areaId);
      if (rank) area.researchPriority = { rank: rank.rank, kind: rank.priorityKind, distance: rank.distance, witness: rank.witness };
      if (area.status === 'unknown') {
        const proposal = proposals.rows.find(r => r.areaId === area.areaId);
        if (proposal) { area.resolutionReview = { status: proposal.status, candidateMapIds: proposal.candidates.map(c => c.mapId) }; area.unknowns.push(proposal.limits); }
        const wiki = review.unresolvedReviews?.find(row => row.pickerId === area.areaId);
        if (wiki) {
          area.resolutionReview = { ...area.resolutionReview, wikiReview: wiki };
          area.unknowns.push(...(wiki.unknowns ?? []), ...(wiki.evidence ? [wiki.evidence] : []));
          area.evidence.push({ kind: 'reviewed-unresolved-wiki-identity', sources: wiki.evidenceSources, status: wiki.status });
        }
      }
    }
    const inputFile = (file, hashKind = 'exact-bytes') => ({ file, sha256: (hashKind === 'repository-lf' ? sha256RepositoryText : sha256)(readFileSync(resolve(root, file))), hashKind });
    const inputs = [inputFile(relative(root, baseFile).replaceAll('\\', '/'), args['base-catalogue'] ? 'exact-bytes' : 'repository-lf'), inputFile('archive/data/map-connections.2026-10-08.v2.json', 'repository-lf'),
      inputFile('rs3-chunkpicker-chunkinfo-export.json', 'repository-lf'), inputFile('tests/fixtures/original-sync/capture.json', 'repository-lf'),
      ...['places', 'proposals', 'review', 'priority'].map(k => inputFile(args[k]))];
    const generatorSourceHashes = Object.fromEntries(['scripts/render-cache-interiors-v2.mjs', 'scripts/cache/interiors-v2-catalogue.mjs',
      'scripts/cache/interiors-v2-priority.mjs', 'scripts/cache/interiors-v2-layout-proposals.mjs', 'scripts/cache/interiors-v2-connections.mjs',
      'scripts/cache/interiors-v2-review.mjs', 'scripts/cache/interiors-v2-identities.mjs', 'scripts/cache/interiors-v2-wiki.mjs',
      'scripts/cache/interiors-v2-scenery.mjs', 'scripts/cache/interiors-v2-synthetic.mjs',
      'scripts/cache/interiors-v2-publish.mjs', 'scripts/cache/interiors-v2-wiki-synthetic.mjs', 'scripts/cache/interiors-v2-verification.py',
      'scripts/cache/interior-layout.mjs', 'scripts/render-cache-interiors.mjs', 'scripts/render-cache-terrain.mjs', 'scripts/lib/provenance-hash.mjs']
      .map(file => [file, sha256RepositoryText(readFileSync(join(root, file)))]));
    const summary = { pickerAreas: catalogue.areas.length, mappedAreas: catalogue.areas.filter(a => a.status === 'mapped').length,
      unknownAreas: catalogue.areas.filter(a => a.status === 'unknown').length, maps: new Set(rendered.map(m => m.mapId)).size, mapPlanes: rendered.length,
      tiles: rendered.reduce((n, m) => n + m.tiles.length, 0), errors: errors.length };
    const sources = [];
    for (const [major, table] of cache.tables) sources.push({ major, path: table.path, bytes: table.size, sha256: await fileSha256(table.path) });
    const manifest = { ...oldManifest, generatedAt: new Date().toISOString(), directory, inputs, sources, generatorSourceHashes,
      renderer: { ...oldManifest.renderer, commit: RSMV_COMMIT, sourceHashes: renderer.sourceHashes, decoderHashes: decoders.sourceHashes },
      maps: rendered, summary, errors, baseManifest: { path: oldManifestFile, sha256: sha256(oldManifestBytes) },
      limits: [...oldManifest.limits, 'Unzoned static templates have cacheMapId:null; catalogue IDs are explicit display identities, not invented JS5-23 records.',
        'Retained source-region associations do not prove semantic enclosure or current instance. Map28 layers here contain selected off-surface regions only.'] };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(output, 'manifest.json'), manifestBytes, { flag: 'wx' });
    Object.assign(catalogue, { version: '2026-10-08.v2', inputs, generatorSourceHashes, summary, limitations: manifest.limits,
      assets: { ...base.assets, directory, manifestPath: `${directory}/manifest.json`, manifestSha256: sha256(manifestBytes) },
      v2Review: { before: base.v2Review?.before ?? base.summary, newlyMapped: summary.mappedAreas - (base.v2Review?.before ?? base.summary).mappedAreas, rejections,
        priority: { ...priority, ranked: undefined }, selectedScope: 'Dated public fixture, never the private duo save',
        namedResolutions: review.resolutions.map(({ entrances, ...row }) => row) } });
    const connections = buildInteriorConnections(json(join(root, 'archive/data/map-connections.2026-10-08.v2.json')), catalogue,
      { inputs: [inputFile('app/data/cache-interiors.2026-10-08.v1.json', 'repository-lf')] });
    for (const area of catalogue.areas) area.declaredConnections = connections.connections.filter(e => [e.from, e.to].some(p => [p.areaId, p.chunkId, p.locationId, p.interiorMap?.areaId].includes(area.areaId)))
      .map(e => ({ id: e.id, kind: e.kind, from: e.from, to: e.to, precision: e.from.precision === 'unresolved' || e.to.precision === 'unresolved' ? 'unresolved' : 'display-evidence', provenance: e.provenance, accessEffect: 'none' }));
    writeFileSync(cataloguePath, JSON.stringify(catalogue, null, 2) + '\n', { flag: 'wx' });
    // Pin the final catalogue bytes without creating a catalogue/connection hash cycle.
    connections.inputs.push(inputFile(relative(root, cataloguePath).replaceAll('\\', '/'), 'repository-lf'));
    writeFileSync(connectionsPath, JSON.stringify(connections, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, cataloguePath, connectionsPath, ...summary }));
    return catalogue;
  } finally { cache.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw new Error('Use --name value options');
    options[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  if (!options.output) throw new Error('Required --output');
  renderInteriorV2(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
