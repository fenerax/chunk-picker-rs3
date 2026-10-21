#!/usr/bin/env node
// Offline surface floors/walls from a pinned renderer and read-only copied DBs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CacheCopy, loadDecoders, RSMV_COMMIT, sha256, fileSha256 } from './cache/cache-reader.mjs';
import { loadSurfaceLayout } from './cache/surface.mjs';
import { loadSurfaceSquares } from './import-rs3-cache.mjs';
import { rgbaPng, createDefinitionResolver } from './cache/pins.mjs';

export const CACHE_OCEAN_COLOR = '#60769a';
const TRANSPARENT_COLOR = [255, 0, 255];
const visibleColor = color => Array.isArray(color) && color.some((n, i) => n !== TRANSPARENT_COLOR[i]);
const overlayColor = tile => (tile.waterProps?.rawOverlay ?? tile.rawOverlay)?.secondary_colour
  ?? tile.waterProps?.props.color ?? tile.overlayprops.color;

/** Definition-backed coverage, independent of RGB shade: real gray/black floors
 * remain artwork. NXT's visible bit alone also occurs on unset underlay=overlay=0. */
export function hasVisibleFloor(tile) {
  return !!tile.underlayVisible || (visibleColor(overlayColor(tile))
    && (tile.waterProps?.shape ?? tile.shape.overlay).length > 0);
}

export function isSharedOcean(tile) {
  const color = tile.waterProps && overlayColor(tile);
  return !!color && color[0] === 96 && color[1] === 118 && color[2] === 154;
}

export function pointInFloorShape(shape, x, z) {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const a = shape[i], b = shape[j];
    if ((a.subz > z) !== (b.subz > z)
      && x < (b.subx - a.subx) * (z - a.subz) / (b.subz - a.subz) + a.subx) inside = !inside;
  }
  return inside;
}

/** Avoid polygon merging/rasterization for plain ocean and unset squares. Walls
 * are checked by the caller; any partial shore, special water or floor vetoes. */
export function isEmptyOceanSurface(grid, square) {
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let p = 0; p < 4; p++) {
    const tile = grid.getTile(square.x * 64 + x, square.z * 64 + z, p);
    if (!tile?.hasFloor || !(tile.effectiveLevel <= 0 || tile.settings & 8)) continue;
    const shape = tile.waterProps?.shape;
    if (!isSharedOcean(tile) || shape.length !== 4
      || new Set(shape.map(v => `${v.subx},${v.subz}`)).size !== 4
      || shape.some(v => ![0, 1].includes(v.subx) || ![0, 1].includes(v.subz))) return false;
  }
  return true;
}

/** Alpha follows tile definitions and the same rotated SVG water polygons.
 * Sampling each output pixel keeps partial shore tiles and floors above water. */
export function maskSurfacePixels(pixels, grid, square, pixelsPerTile = 4) {
  const size = 64 * pixelsPerTile;
  if (pixels.length !== size * size * 4) throw new Error('Wrong surface pixel dimensions');
  const counts = { artworkPixels: 0, oceanPixels: 0, voidPixels: 0 };
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) {
    const layers = [3, 2, 1, 0].map(plane => grid.getTile(square.x * 64 + x, square.z * 64 + z, plane))
      .filter(tile => tile?.hasFloor && (tile.effectiveLevel <= 0 || tile.settings & 8));
    for (let dx = 0; dx < pixelsPerTile; dx++) for (let dy = 0; dy < pixelsPerTile; dy++) {
      const px = (dx + 0.5) / pixelsPerTile, pz = 1 - (dy + 0.5) / pixelsPerTile;
      let kind = 'voidPixels';
      for (const tile of layers) {
        const vertices = tile.waterProps?.shape ?? tile.shape.overlay;
        if (visibleColor(overlayColor(tile)) && pointInFloorShape(vertices, px, pz)) {
          kind = isSharedOcean(tile) ? 'oceanPixels' : 'artworkPixels'; break;
        }
        // A magenta overlay is an explicit cut-out. The pinned SVG draws only
        // its complementary underlay polygon and lets lower floors show through.
        const cutout = (tile.waterProps || tile.rawOverlay) && !visibleColor(overlayColor(tile));
        if (tile.underlayVisible && (!cutout || pointInFloorShape(tile.shape.underlay, px, pz))) {
          kind = 'artworkPixels'; break;
        }
      }
      const offset = (((63 - z) * pixelsPerTile + dy) * size + x * pixelsPerTile + dx) * 4;
      // Crisp SVG polygons and pixel-centre tests can disagree on a shared
      // diagonal. Preserve the actual shoreline raster and wall antialiasing;
      // RGB is inspected only after definitions positively identify water.
      if (kind === 'oceanPixels' && pixels[offset + 3] !== 0
        && (pixels[offset] !== 96 || pixels[offset + 1] !== 118 || pixels[offset + 2] !== 154)) {
        kind = 'artworkPixels';
      }
      // Void uses the pinned SVG's opaque-black background. As above, retain
      // actual raster boundaries and strokes after definition-backed exclusion;
      // a legitimate black floor already has artwork coverage and stays opaque.
      if (kind === 'voidPixels' && pixels[offset + 3] !== 0
        && (pixels[offset] !== 0 || pixels[offset + 1] !== 0 || pixels[offset + 2] !== 0)) {
        kind = 'artworkPixels';
      }
      counts[kind]++;
      if (kind !== 'artworkPixels') {
        // Clear RGB as well as alpha for deterministic, colourless empty pixels.
        pixels.fill(0, offset, offset + 4);
      }
    }
  }
  return counts;
}

function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Pinned renderer boundary missing: ${start}`);
  return source.slice(a, b);
}

/** Load only reviewed floor/wall SVG code, tile properties/shapes and colour
 * conversion. No external CLI, downloader, Electron, cache backend or installer.
 * Image helpers are replaced by our existing dependency-free PNG encoder.
 */
export function loadFloorRenderer(tool) {
  const sources = Object.fromEntries(['map/svgrender.ts', '3d/mapsquare.ts', 'utils.ts']
    .map(name => [name, readFileSync(join(tool, 'src', name), 'utf8')]));
  const shapes = between(sources['3d/mapsquare.ts'], 'function generateTileShapes()', 'export function modifyMesh(');
  const properties = between(sources['3d/mapsquare.ts'], 'export class TileProps', 'type FloorMorph');
  const colours = between(sources['utils.ts'], 'export function HSL2RGBfloat', 'export function RGB2HSL')
    + between(sources['utils.ts'], 'export function packedHSL2HSL', 'export function hsl2hex');
  const svg = sources['map/svgrender.ts'].replace(/^import .*;\r?\n/gm, '');
  const source = `const tiledimensions=512, heightScale=1/16, squareLevels=4;
    const defaultVertexProp={material:-1,materialTiling:128,materialBleedpriority:-1,color:[255,0,255]};
    ${shapes}
    const {tileshapes,defaulttileshape,defaulttileshapeflipped}=generateTileShapes();
    ${properties}\n${colours}\n${svg}`;
  const js = stripTypeScriptTypes(source, { mode: 'strip' }).replace(/\bexport /g, '');
  const makeImageData = (data, width, height) => ({ data, width, height });
  const pixelsToDataUrl = async ({ data, width, height }) =>
    `data:image/png;base64,${rgbaPng(width, height, Buffer.from(data)).toString('base64')}`;
  const getOrInsert = (map, key, factory) => { if (!map.has(key)) map.set(key, factory()); return map.get(key); };
  const unavailable = () => { throw new Error('Sprites are forbidden in cache terrain'); };
  const renderer = new Function('makeImageData', 'pixelsToDataUrl', 'getOrInsert', 'parseSprite', 'cacheMajors',
    `${js}\nreturn {svgfloor,TileProps,tileshapes,defaulttileshape,invertTileShape,HSL2RGB,packedHSL2HSL};`)
    (makeImageData, pixelsToDataUrl, getOrInsert, unavailable, { sprites: 8 });
  return { ...renderer, sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, sha256(text)])) };
}

function definitions(cache, minor, kind) {
  const archive = cache.archive(2, minor);
  if (!archive) throw new Error(`Missing ${kind} config archive ${minor}`);
  const result = [];
  for (const [id, bytes] of archive) result[id] = cache.decoders.decode(kind, bytes);
  return result;
}

/** A per-square adapter follows the pinned addMapsquare NXT/Java field choices.
 * Surface pastes and plane offsets come from the existing exact layout loader.
 * NXT stores final underlay colours; Java underlay blending is not reproduced.
 */
export function makeFloorGrid(square, engine, renderer) {
  const tiles = new Array(4 * 4096), floor = new Uint8Array(4096);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) {
    const index = x * 64 + z;
    for (let plane = 0; plane < 4; plane++) {
      const java = square.tiles?.tiles?.[plane * 4096 + index];
      const nxt = square.nxttiles?.[`level${plane}`]?.[(x + 1) * 66 + z + 1];
      if (!java && !nxt) continue;
      let tile;
      if (nxt) {
        const flags = nxt.flags, water = !!(flags & 16);
        const settings = (flags & 2 ? 1 : 0) | (flags & 4 ? 2 : 0) | (flags & 8 ? 4 : 0)
          | (flags & 32 ? 8 : 0) | (flags & 64 ? 16 : 0) | (water ? 128 : 0);
        tile = new renderer.TileProps(0, settings, x, z, plane, false);
        tile.addUnderlay(engine, nxt.rest?.underlay_under ?? nxt.rest?.underlay);
        tile.addOverlay(engine, nxt.rest?.overlay_under ?? nxt.rest?.overlay,
          water ? renderer.invertTileShape(nxt.rest?.shape ?? 0) : nxt.rest?.shape);
        if (water) {
          tile.addUnderWater(engine, nxt.height, nxt.rest?.overlay, nxt.rest?.underlay);
          if (!tile.waterProps.shape.length) tile.waterProps.shape = renderer.tileshapes[0].overlay;
        }
        tile.underlayprops.color = renderer.HSL2RGB(renderer.packedHSL2HSL(nxt.rest?.underlaycolor ?? 0));
        tile.hasFloor = !!(flags & 1) && hasVisibleFloor(tile);
      } else {
        tile = new renderer.TileProps(0, java.settings ?? 0, x, z, plane, false);
        tile.addUnderlay(engine, java.underlay); tile.addOverlay(engine, java.overlay, java.shape);
        tile.hasFloor = hasVisibleFloor(tile);
      }
      tiles[plane * 4096 + index] = tile;
    }
    const bridge = !!(tiles[4096 + index]?.settings & 2);
    for (let plane = 0; plane < 4; plane++) {
      const tile = tiles[plane * 4096 + index];
      if (!tile) continue;
      tile.effectiveLevel = plane - (bridge ? 1 : 0);
      if (tile.hasFloor && (tile.effectiveLevel <= 0 || tile.settings & 8)) floor[index] = 1;
    }
  }
  return { floor, getTile(x, z, plane) {
    x -= square.x * 64; z -= square.z * 64;
    if (x < 0 || x >= 64 || z < 0 || z >= 64 || plane < 0 || plane > 3) return undefined;
    // Wall anchors can legitimately be on a floorless upper tile. Keep their
    // effective plane/settings available; the alpha mask owns floor coverage.
    return tiles[plane * 4096 + x * 64 + z];
  } };
}

function wallLocations(square, grid, resolver) {
  const result = [];
  for (const loc of square.locations?.locations ?? []) {
    const relevant = loc.uses.filter(use => [0, 2, 9].includes(use.type));
    if (!relevant.length) continue;
    const definition = resolver.resolveObject(loc.id).definition;
    // Never enter the pinned renderer's sprite branch, even for wall objects.
    if (definition.mapscene) continue;
    for (const use of relevant) {
      const x = square.x * 64 + use.x, z = square.z * 64 + use.y;
      const tile = grid.getTile(x, z, use.plane);
      if (!tile) continue;
      result.push({ x, z, plane: use.plane, type: use.type, rotation: use.rotation,
        effectiveLevel: tile.effectiveLevel, forceVisible: !!(tile.settings & 8), location: definition });
    }
  }
  return result;
}

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--cache-copy', '--tool', '--rasterizer', '--output', '--regions'].includes(key)) throw new Error(`Unknown option ${key}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value ${key}`);
    result[key.slice(2)] = argv[++i];
  }
  for (const key of ['cache-copy', 'tool', 'rasterizer', 'output']) if (!result[key]) throw new Error(`Required --${key}`);
  return result;
}

export async function renderCacheTerrain(args) {
  const tool = realpathSync(args.tool), output = resolve(args.output);
  const commit = execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== RSMV_COMMIT) throw new Error(`Renderer must be pinned to ${RSMV_COMMIT}`);
  try {
    execFileSync('git', ['-C', tool, 'diff', '--quiet', 'HEAD', '--', 'src/map/svgrender.ts',
      'src/3d/mapsquare.ts', 'src/utils.ts', 'src/constants.ts', 'src/parser/opcode_reader.ts', 'src/opcodes']);
  } catch { throw new Error('Pinned renderer/decoder sources have local changes'); }
  if (!/^terrain\.cache-[a-zA-Z0-9_-]+$/.test(basename(output))
    || !/[\\/]\.local[\\/]map-assets[\\/]/.test(output)) throw new Error('Use a new .local/map-assets/terrain.cache-VERSION directory');
  if (existsSync(output)) throw new Error('Output version already exists; choose a fresh version');
  const rasterizer = realpathSync(args.rasterizer);
  const packageFile = join(resolve(rasterizer, '..'), 'package.json');
  const packageInfo = JSON.parse(readFileSync(packageFile, 'utf8'));
  if (packageInfo.name !== '@resvg/resvg-js' || packageInfo.version !== '2.6.2') throw new Error('Expected @resvg/resvg-js 2.6.2');
  const { Resvg } = await import(pathToFileURL(rasterizer));
  const renderer = loadFloorRenderer(tool), decoders = await loadDecoders(tool, 950);
  const cache = new CacheCopy(args['cache-copy'], decoders);
  try {
    const layout = loadSurfaceLayout(cache);
    const engine = { mapUnderlays: definitions(cache, 1, 'underlay'), mapOverlays: definitions(cache, 4, 'overlay'),
      getFileById() { throw new Error('Terrain must not read sprites or model resources'); } };
    const resolver = createDefinitionResolver(id => cache.object(16, id, 'loc'), () => null);
    const directory = `${basename(output)}/28/2`, tiles = [], errors = [];
    const regions = args.regions ? new Set(args.regions.split(',')) : null;
    const groups = new Map();
    for (const [key, row] of layout.blocks) {
      if (row.destination.x < 1856 || row.destination.x >= 4864 || row.destination.y < 1408 || row.destination.y >= 4608) continue;
      const id = String(row.paste.new_regionX * 256 + row.paste.new_regionY);
      if (regions && !regions.has(id)) continue;
      const pasteKey = `${row.paste.kind}:${row.paste.index}`;
      if (!groups.has(pasteKey)) groups.set(pasteKey, new Map());
      groups.get(pasteKey).set(key, row);
    }
    const selected = [...groups.values()], coverage = [];
    mkdirSync(join(output, '28', '2'), { recursive: true });
    for (let i = 0; i < selected.length; i++) {
      // Keep only one decoded NXT square alive; bulk decoding can exceed RAM.
      const loaded = loadSurfaceSquares(cache, { ...layout, blocks: selected[i] });
      coverage.push(...loaded.coverage);
      if (loaded.squares.length !== 1) throw new Error('Expected one surface square per paste');
      const square = loaded.squares[0], record = { x: square.x, y: square.z, region: String(square.x * 256 + square.z),
        path: `${directory}/0_${square.x}_${square.z}.png`, provenance: square.provenance };
      if (square.error) { errors.push({ ...record, error: square.error }); continue; }
      try {
        const grid = makeFloorGrid(square, engine, renderer);
        record.floorTiles = grid.floor.reduce((a, b) => a + b, 0);
        const walls = wallLocations(square, grid, resolver);
        let pixels;
        if (!walls.length && isEmptyOceanSurface(grid, square)) {
          pixels = Buffer.alloc(256 * 256 * 4);
        } else {
          const svg = await renderer.svgfloor(engine, grid, walls,
            { x: square.x * 64, z: square.z * 64, xsize: 64, zsize: 64 }, 0, 4, false, false);
          if (/maplabel-|mapscene-|<text\b|<use\b/.test(svg)) throw new Error('Unexpected baked icon/text in SVG');
          const rendered = new Resvg(svg, { font: { loadSystemFonts: false }, logLevel: 'off' }).render();
          if (rendered.width !== 256 || rendered.height !== 256) throw new Error('Wrong PNG dimensions');
          pixels = rendered.pixels;
        }
        const coveragePixels = maskSurfacePixels(pixels, grid, square);
        const png = rgbaPng(256, 256, pixels);
        writeFileSync(join(output, '28', '2', `0_${square.x}_${square.z}.png`), png, { flag: 'wx' });
        tiles.push({ ...record, status: 'rendered', ...coveragePixels,
          wallPlacements: walls.length, bytes: png.length, sha256: sha256(png) });
      } catch (error) { errors.push({ ...record, error: error.message.split('\n')[0] }); }
      if ((i + 1) % 25 === 0 || i === selected.length - 1) console.log(`Terrain ${i + 1}/${selected.length}; rendered=${tiles.filter(t => t.status === 'rendered').length}; errors=${errors.length}`);
    }
    const sources = [];
    for (const [major, table] of cache.tables) sources.push({ major, path: table.path, bytes: table.size, sha256: await fileSha256(table.path) });
    const manifest = { version: 1, generatedAt: new Date().toISOString(), cacheTerrain: {
      mapId: 28, plane: 0, zoom: 2, tileSize: 256, iconFree: true,
      transparentWater: true, oceanColor: CACHE_OCEAN_COLOR,
      layoutComplete: !regions && errors.length === 0 && tiles.length === selected.length,
      directory, tiles },
      renderer: { commit, sourceHashes: renderer.sourceHashes, decoderHashes: decoders.sourceHashes,
        rasterizer: { name: packageInfo.name, version: packageInfo.version, packageSha256: sha256(readFileSync(packageFile)) } },
      sources, coverage, selectedRegions: selected.length, errors,
      limits: ['Static copied snapshot, inferred schema build 950; no current-player varbits.',
        'Flat pinned SVG floor colours and basic wall lines, without models, scenery sprites or POI icons.',
        'Java underlay smoothing, cross-square wall overdraw and NXT shore auto-linking are not reproduced.',
        'Unset/void cells and definition-backed #60769a water polygons are transparent for the shared ocean fill.',
        'Special-colour water, legitimate gray/black floors and partial shore artwork remain visible.'] };
    writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ output, selected: selected.length, rendered: tiles.filter(t => t.status === 'rendered').length,
      empty: tiles.filter(t => t.status === 'empty').length, errors: errors.length }));
    return manifest;
  } finally { cache.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  renderCacheTerrain(options(process.argv.slice(2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
