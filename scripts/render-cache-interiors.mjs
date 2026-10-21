#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CacheCopy, loadDecoders, RSMV_COMMIT, fileSha256 } from './cache/cache-reader.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { loadSurfaceLayout } from './cache/surface.mjs';
import { rgbaPng, createDefinitionResolver } from './cache/pins.mjs';
import { loadFloorRenderer, makeFloorGrid, maskSurfacePixels } from './render-cache-terrain.mjs';
import { assembleInteriorSquare, interiorBounds } from './cache/interior-layout.mjs';
import { buildInteriorCandidates } from './cache/interior-catalogue.mjs';

const root = resolve(import.meta.dirname, '..');
const placesCopy = 'C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/places.2026-10-08.v3.copy.json';
const defaults = { 'cache-copy': 'C:/Users/User/Projects/rs3-cache-work/cache-copy', tool: 'C:/Users/User/Projects/rs3-cache-work/rsmv',
  rasterizer: 'C:/Users/User/Projects/rs3-cache-work/terrain-render-runtime-2026-10-08-v1/node_modules/@resvg/resvg-js/index.js' };
const json = file => JSON.parse(readFileSync(file, 'utf8'));
function definitions(cache, minor, kind) {
  const result = [];
  for (const [id, bytes] of cache.archive(2, minor)) result[id] = cache.decoders.decode(kind, bytes);
  return result;
}
export function interiorWalls(square, grid, resolver) {
  const walls = [];
  for (const loc of square.locations.locations) {
    const uses = loc.uses.filter(u => [0, 2, 9].includes(u.type));
    if (!uses.length) continue;
    const definition = resolver.resolveObject(loc.id).definition;
    if (definition.mapscene) continue;
    for (const u of uses) {
      const x = square.x * 64 + u.x, z = square.z * 64 + u.y, tile = grid.getTile(x, z, 0);
      if (tile) walls.push({ x, z, plane: 0, type: u.type, rotation: u.rotation, effectiveLevel: 0,
        forceVisible: !!(tile.settings & 8), location: definition });
    }
  }
  return walls;
}

export async function renderCacheInteriors(args) {
  args = { ...defaults, ...args };
  const placesPath = resolve(args.places ?? placesCopy);
  const output = resolve(args.output), directory = basename(output), tool = realpathSync(args.tool);
  if (!/^interiors\.cache-[a-zA-Z0-9_-]+$/.test(directory) || !/[\\/]\.local[\\/]map-assets[\\/]/.test(output)) throw new Error('Use a new .local/map-assets/interiors.cache-VERSION');
  if (existsSync(output)) throw new Error('Output version already exists');
  const cataloguePath = resolve(args.catalogue ?? join(root, 'app/data/cache-interiors.2026-10-08.v1.json'));
  if (existsSync(cataloguePath)) throw new Error('Catalogue version already exists');
  const commit = execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== RSMV_COMMIT) throw new Error('Unpinned renderer');
  execFileSync('git', ['-C', tool, 'diff', '--quiet', 'HEAD', '--', 'src/map/svgrender.ts', 'src/3d/mapsquare.ts', 'src/utils.ts', 'src/constants.ts', 'src/parser/opcode_reader.ts', 'src/opcodes']);
  const packageFile = join(resolve(args.rasterizer, '..'), 'package.json'), packageInfo = json(packageFile);
  if (packageInfo.name !== '@resvg/resvg-js' || packageInfo.version !== '2.6.2') throw new Error('Wrong rasterizer');
  const { Resvg } = await import(pathToFileURL(realpathSync(args.rasterizer)));
  const renderer = loadFloorRenderer(tool), decoders = await loadDecoders(tool, 950), cache = new CacheCopy(args['cache-copy'], decoders);
  const files = ['rs3-chunkpicker-chunkinfo-export.json', 'app/data/transport-routes.2026-10-08.v1.json', 'archive/data/map-connections.2026-10-08.v2.json'];
  const inputs = files.map(file => ({ file, sha256: sha256RepositoryText(readFileSync(join(root, file))), hashKind: 'repository-lf' }));
  inputs.push({ file: placesPath, sha256: sha256(readFileSync(placesPath)), hashKind: 'exact-bytes' });
  const generatorSourceHashes = Object.fromEntries(['scripts/render-cache-interiors.mjs', 'scripts/cache/interior-layout.mjs',
    'scripts/cache/interior-catalogue.mjs', 'scripts/render-cache-terrain.mjs', 'scripts/lib/provenance-hash.mjs']
    .map(file => [file, sha256RepositoryText(readFileSync(join(root, file)))]));
  const candidate = buildInteriorCandidates(json(join(root, files[0])), json(placesPath), json(join(root, files[1])), json(join(root, files[2])));
  const maps = [], errors = [];
  try {
    const engine = { mapUnderlays: definitions(cache, 1, 'underlay'), mapOverlays: definitions(cache, 4, 'overlay'),
      getFileById() { throw new Error('No sprites/models in interiors'); } };
    const resolver = createDefinitionResolver(id => cache.object(16, id, 'loc'), () => null);
    for (const map of candidate.maps) for (let plane = 0; plane < 4; plane++) {
      const layout = loadSurfaceLayout(cache, { mapId: map.id, plane });
      // Map164's encoded layout omits the upper source plane. Three reviewed
      // plane1 stair/exit placements and Wiki Map:The_Blood_Pact corroborate the
      // exact same XY source layer, so retain it as separate direct-source evidence.
      if (map.id === 164 && plane === 1 && !layout.blocks.size) {
        const base = loadSurfaceLayout(cache, { mapId: 164, plane: 0 });
        for (const [key, r] of base.blocks) layout.blocks.set(key, { ...r, source: { ...r.source, plane: 1 },
          destination: { ...r.destination, plane: 1 }, translation: { ...r.translation, plane: 0 },
          paste: { ...r.paste, sourceLayerOverride: 'reviewed-Blood-Pact-upper-plane1' } });
      }
      if (!layout.blocks.size) continue;
      const record = { mapId: map.id, name: map.name, internalName: map.internal_name, plane,
        bounds: interiorBounds(layout.blocks), boundsKind: map.id === 164 && plane === 1 ? 'reviewed-direct-source-XY-coverage' : 'exact-layout-coverage',
        layoutEvidence: { major: 23, mapId: map.id, zoneSha256: sha256(cache.archive(23, 0).get(map.id)),
          pasteSha256: sha256(cache.archive(23, 1).get(map.id)), blocks: layout.blocks.size,
          sourcePlaneOverride: map.id === 164 && plane === 1 ? 'reviewed-Blood-Pact-upper-plane1' : null }, tiles: [] };
      const coordinates = [...new Set([...layout.blocks.values()].map(r => `${Math.floor(r.destination.x / 64)},${Math.floor(r.destination.y / 64)}`))];
      mkdirSync(join(output, String(map.id), '2'), { recursive: true });
      for (const coord of coordinates) {
        const [x, y] = coord.split(',').map(Number);
        try {
          const square = assembleInteriorSquare(cache, layout, x, y), grid = makeFloorGrid(square, engine, renderer), walls = interiorWalls(square, grid, resolver);
          const svg = await renderer.svgfloor(engine, grid, walls, { x: x * 64, z: y * 64, xsize: 64, zsize: 64 }, 0, 4, false, false);
          if (/maplabel-|mapscene-|<text\b|<use\b/.test(svg)) throw new Error('Baked labels or icons');
          const raster = new Resvg(svg, { font: { loadSystemFonts: false }, logLevel: 'off' }).render();
          if (raster.width !== 256 || raster.height !== 256) throw new Error('Wrong PNG dimensions');
          const pixels = raster.pixels, coverage = maskSurfacePixels(pixels, grid, square), png = rgbaPng(256, 256, pixels);
          const filename = `${plane}_${x}_${y}.png`, path = `${directory}/${map.id}/2/${filename}`;
          writeFileSync(join(output, String(map.id), '2', filename), png, { flag: 'wx' });
          record.tiles.push({ x, y, plane, path, status: 'rendered', bytes: png.length, sha256: sha256(png), ...coverage,
            floorTiles: grid.floor.reduce((a, b) => a + b, 0), wallPlacements: walls.length, provenance: square.provenance });
        } catch (error) { errors.push({ mapId: map.id, plane, x, y, error: error.message.split('\n')[0] }); }
      }
      maps.push(record);
      console.log(`Interior map ${map.id} plane ${plane}: ${record.tiles.length}/${coordinates.length}; errors ${errors.length}`);
    }
    const sources = [];
    for (const [major, table] of cache.tables) sources.push({ major, path: table.path, bytes: table.size, sha256: await fileSha256(table.path) });
    const summary = { pickerAreas: candidate.areas.length, mappedAreas: candidate.areas.filter(a => a.status === 'mapped').length,
      unknownAreas: candidate.areas.filter(a => a.status === 'unknown').length, maps: new Set(maps.map(m => m.mapId)).size,
      mapPlanes: maps.length, tiles: maps.reduce((n, m) => n + m.tiles.length, 0), errors: errors.length };
    const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), directory, tileSize: 256, zoom: 2, iconFree: true,
      transparentWater: true, coordinateConvention: 'game tiles; x east, y north; bounds [minX,maxX) [minY,maxY); PNG north at top; filenames use 64-tile destination square indices',
      inputs, sources, generatorSourceHashes, renderer: { commit, sourceHashes: renderer.sourceHashes, decoderHashes: decoders.sourceHashes,
        rasterizer: { name: packageInfo.name, version: packageInfo.version, packageSha256: sha256(readFileSync(packageFile)) } }, maps, summary, errors,
      limits: ['Static copied cache, inferred build950, no player varbits.', 'Flat floors and basic walls; no sprites, models or icons.',
        'Planes rendered independently through exact 8x8 pastes; no access or membership inference.', 'Definition-backed shared #60769a water and void transparent; special water and real black/gray floors retained.'] };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(output, 'manifest.json'), manifestBytes, { flag: 'wx' });
    for (const area of candidate.areas) area.layers = maps.filter(m => area.mapIds.includes(m.mapId)).map(m => ({ mapId: m.mapId, plane: m.plane, bounds: m.bounds, boundsKind: m.boundsKind }));
    const catalogue = { schemaVersion: 1, version: '2026-10-08.v1', reviewedOn: '2026-10-08', displayOnly: true, accessEffect: 'none',
      assets: { directory, manifestPath: `${directory}/manifest.json`, manifestSha256: sha256(manifestBytes), tileSize: 256, zoom: 2, iconFree: true, transparentWater: true },
      coordinateConvention: manifest.coordinateConvention, inputs, generatorSourceHashes, summary,
      maps: maps.map(({ tiles, ...m }) => ({ ...m, tiles: tiles.map(({ provenance, ...t }) => t) })), areas: candidate.areas,
      specialCases: [{ name: 'Wilderness North Volcano', status: 'no-distinct-interior-verified', mapId: 28,
        evidence: ['https://runescape.wiki/w/Wilderness_North_Volcano'], note: 'Reviewed Wiki describes surface stepping stone and ledges; raw/effective plane shortcuts do not establish a cave or separate interior. No extra map or access added.' }],
      limitations: manifest.limits };
    writeFileSync(cataloguePath, JSON.stringify(catalogue, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, cataloguePath, ...summary }));
    return catalogue;
  } finally { cache.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const option = process.argv[i];
    if (!['--cache-copy', '--tool', '--rasterizer', '--output', '--catalogue', '--places'].includes(option) || !process.argv[i + 1]) throw new Error(`Invalid option ${option}`);
    options[option.slice(2)] = process.argv[i + 1];
  }
  if (!options.output) throw new Error('Required --output');
  renderCacheInteriors(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
