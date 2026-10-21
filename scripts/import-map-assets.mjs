#!/usr/bin/env node
// Explicit operator command only. Nothing imports or refreshes assets at startup.
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { enumerateTerrainTiles, normalizePins, SURFACE_CROP, PIN_COMMIT, PIN_SNAPSHOT_DATE } from '../app/data/map-pins.mjs';
import { MAP_PIN_CATEGORIES } from '../app/data/map-pin-categories.mjs';

export const TERRAIN_COMMIT = 'f1e12f444ddb0f7e594d9e213dd2758cb377cc46';
export const TERRAIN_COMMIT_DATE = '2026-07-03T20:18:21Z';
export const MAX_DOWNLOAD_BYTES = 400_000_000;
export const USER_AGENT = 'RS3ChunkPickerPrivateMapImporter/1.0 (private noncommercial duo map; https://github.com/source-chunk/chunk-picker-rs3)';
const terrainBase = `https://raw.githubusercontent.com/mejrs/layers_rs3/${TERRAIN_COMMIT}/map_squares/28/2/`;
const rawBase = `https://raw.githubusercontent.com/mejrs/data_rs3/${PIN_COMMIT}/`;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function isCompletePng(data, width, height) {
  return data.length >= 45 && data.subarray(0, 8).equals(pngSignature)
    && data.subarray(12, 16).toString() === 'IHDR'
    && data.subarray(-8, -4).toString() === 'IEND'
    && (width === undefined || data.readUInt32BE(16) === width)
    && (height === undefined || data.readUInt32BE(20) === height);
}
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - now) || 0;
}

/** Serialize start times, while permitting overlapping slow transfers. */
export function createRateLimiter(interval, pause = sleep, now = Date.now) {
  let next = 0;
  let queue = Promise.resolve();
  return () => {
    const ticket = queue.then(async () => {
      await pause(Math.max(0, next - now()));
      next = now() + interval;
    });
    queue = ticket.catch(() => {});
    return ticket;
  };
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  for (let attempt = 0; ; attempt++) {
    try { await rename(`${path}.tmp`, path); return; }
    catch (error) {
      // Windows scanners/readers can briefly deny replace while a file is open.
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await sleep(50 * 2 ** attempt);
    }
  }
}

async function verifiedFile(root, record) {
  if (record?.status !== 'downloaded' || !record.path || !record.sha256) return false;
  try {
    const bytes = await readFile(join(root, record.path));
    return bytes.length === record.bytes && sha256(bytes) === record.sha256;
  } catch { return false; }
}

function pinCounts(normalized) {
  return { rawPins: normalized.normalization.rawPins, normalizedPins: normalized.pins.length,
    excludedPins: normalized.exclusions.length, exclusionsByReason: normalized.normalization.exclusionsByReason,
    previousEligiblePins: normalized.normalization.previousEligiblePins,
    previousEligibleExclusionsByReason: normalized.normalization.previousEligibleExclusionsByReason,
    unmappedPins: normalized.pins.filter(pin => pin.categoryId === 'other').length,
    unmappedSpriteIds: [...new Set(normalized.pins.filter(pin => pin.categoryId === 'other').map(pin => pin.spriteId))].sort((a, b) => a - b) };
}

async function writeNormalizedPins(root, manifest, rawData) {
  const normalized = normalizePins(rawData.original_sprite_locations, { labels: rawData.map_labels,
    labelLocations: rawData.map_label_locations, terrainTiles: manifest.terrain.tiles });
  await atomicJson(join(root, 'pins.normalized.json'), normalized);
  const bytes = await readFile(join(root, 'pins.normalized.json'));
  Object.assign(manifest.pins, { path: 'pins.normalized.json', bytes: bytes.length, sha256: sha256(bytes), count: normalized.pins.length,
    normalizationVersion: normalized.normalizationVersion, excludedCount: normalized.exclusions.length,
    generatedAt: (await stat(join(root, 'pins.normalized.json'))).mtime.toISOString() });
  return normalized;
}

/** Offline repair of processed pins/manifest only. Raw assets are verified and never written. */
export async function rebuildMapPins({ output, log = console.log } = {}) {
  if (!output) throw new Error('Pass --output with an existing private local-assets directory.');
  const root = resolve(output);
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.terrain?.commit !== TERRAIN_COMMIT || manifest.pins?.commit !== PIN_COMMIT
    || manifest.terrain?.mapId !== 28 || manifest.terrain?.plane !== 0 || manifest.terrain?.zoom !== 2) {
    throw new Error('Offline rebuild requires the pinned surface map-28/plane-0/zoom-2 manifest.');
  }
  const rawData = {};
  for (const name of ['original_sprite_locations', 'map_labels', 'map_label_locations']) {
    const path = `raw/${name}.json`;
    const record = manifest.raw?.find(item => item.path === path);
    if (!await verifiedFile(root, record)) throw new Error(`Missing or unverified cached raw asset: ${path}`);
    rawData[name] = JSON.parse(await readFile(join(root, path), 'utf8'));
  }
  // A recorded downloaded tile must still exist and match its hash. Do not turn
  // corrupt/missing cached coverage into positive evidence or redownload it.
  for (const tile of manifest.terrain.tiles) {
    if (tile.status === 'downloaded' && !await verifiedFile(root, tile)) {
      throw new Error(`Missing or unverified cached terrain: ${tile.path}`);
    }
  }
  const normalized = await writeNormalizedPins(root, manifest, rawData);
  Object.assign(manifest.counts ??= {}, pinCounts(normalized), { transferredBytesThisRun: 0 });
  const counts = manifest.counts;
  counts.assetFiles = manifest.terrain.tiles.filter(tile => tile.status === 'downloaded').length
    + manifest.categories.filter(category => category.asset).length + manifest.raw.length + 1;
  counts.assetBytes = manifest.terrain.tiles.reduce((sum, tile) => sum + (tile.bytes ?? 0), 0)
    + manifest.categories.reduce((sum, category) => sum + (category.asset?.bytes ?? 0), 0)
    + manifest.raw.reduce((sum, record) => sum + record.bytes, 0) + manifest.pins.bytes;
  counts.manifestExcludedFromAssetTotals = true;
  manifest.limitations = [...new Set([...(manifest.limitations ?? []),
    'Untagged placements without downloaded surface terrain are excluded as surface-unverified; missing coverage does not prove a map identity.',
    'Duplicate coordinate/current-sprite rows produce one marker; alternate source records and conditions remain in variants and exclusions.'])];
  await atomicJson(manifestPath, manifest);
  log(JSON.stringify(counts, null, 2));
  return manifest;
}

export async function importMapAssets({ output, download = false, fetchImpl = fetch, log = console.log, rateLimiterFactory = createRateLimiter } = {}) {
  if (!output) throw new Error('Pass --output with a private local-assets directory.');
  const root = resolve(output);
  const manifestPath = join(root, 'manifest.json');
  let previous;
  try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (previous.terrain?.commit !== TERRAIN_COMMIT || previous.pins?.commit !== PIN_COMMIT)) {
    throw new Error('Existing assets use a different pinned version; choose another output directory.');
  }
  const terrainGate = rateLimiterFactory(250);
  const wikiGate = rateLimiterFactory(1000);
  let transferred = 0;
  async function request(url, gate, { png = false, allowMissing = false } = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await gate();
      const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 5) throw new Error(`${response.status} after retries: ${url}`);
        await response.arrayBuffer();
        await sleep(Math.max(retryAfterMilliseconds(response.headers.get('retry-after')), 1000 * 2 ** attempt));
        continue;
      }
      if (response.status === 404 && allowMissing) return null;
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      const data = Buffer.from(await response.arrayBuffer());
      transferred += data.length;
      if (transferred > MAX_DOWNLOAD_BYTES) throw new Error('Transferred data exceeds 400 MB cap; import stopped.');
      if (allowMissing && data.length === 0) return data;
      if (png && !isCompletePng(data)) throw new Error(`Not a complete PNG: ${url}`);
      return data;
    }
  }
  const slots = enumerateTerrainTiles(2);
  const oldTiles = new Map((previous?.terrain?.tiles ?? []).map(tile => [`${tile.x}:${tile.y}`, tile]));
  const tiles = slots.map(tile => ({ ...tile, status: 'pending', bytes: 0, sha256: null,
    ...(oldTiles.get(`${tile.x}:${tile.y}`) ?? {}) }));
  const manifest = { schemaVersion: 1, importedAt: new Date().toISOString(), complete: false,
    crop: SURFACE_CROP,
    terrain: { mapId: 28, zoom: 2, plane: 0, tileSize: 256, commit: TERRAIN_COMMIT, commitDate: TERRAIN_COMMIT_DATE, tiles },
    pins: { ...(previous?.pins ?? {}), path: 'pins.normalized.json', snapshotDate: PIN_SNAPSHOT_DATE, commit: PIN_COMMIT },
    categories: MAP_PIN_CATEGORIES.map(category => {
      const old = previous?.categories?.find(item => item.id === category.id);
      return { ...category, icon: old?.asset ? category.icon : null, ...(old?.asset ? { asset: old.asset } : {}) };
    }),
    raw: previous?.raw ?? [],
    sources: [
      { name: 'Mejrs community terrain', url: `https://github.com/mejrs/layers_rs3/tree/${TERRAIN_COMMIT}`, commit: TERRAIN_COMMIT, commitDate: TERRAIN_COMMIT_DATE },
      { name: 'Mejrs coordinate snapshot', url: `https://github.com/mejrs/data_rs3/tree/${PIN_COMMIT}`, commit: PIN_COMMIT, snapshotDate: PIN_SNAPSHOT_DATE },
      { name: 'RuneScape Wiki icon legend and file descriptions', url: 'https://runescape.wiki/w/Icon' },
    ],
    rights: { terrain: 'Jagex game artwork; community repository has no declared asset licence. Private duo use authorized by operator; redistribution rights unresolved.',
      pins: 'Community repository has no declared licence. Dated coordinate snapshot, adapted to picker crop; provisional surface mapping.',
      wikiText: 'RuneScape Wiki contributors, CC BY-NC-SA 3.0: https://creativecommons.org/licenses/by-nc-sa/3.0/',
      icons: 'Jagex game media, per-file Wiki description/licensing template; not presumed CC licensed.',
      policy: 'https://legal.jagex.com/docs/policies/fan-content-policy' },
    limitations: ['December 2021 pin data is incomplete and stale.', 'No global surface-instance transforms or conditional visibility resolution.', 'Untagged placements require downloaded surface terrain; uncovered coordinates remain surface-unverified.',
      'Duplicate coordinate/current-sprite markers are consolidated; alternate source rows and conditions are retained.', '404 records missing coverage; successful zero-byte or 204 responses record empty coverage. Neither is retried on resume.',
      'Coordinate-only label joins are provisional; conflicting labels remain candidates and do not replace category text.',
      'Only reviewed sprite mappings receive named categories; all others remain Other / unmapped.'],
  };
  let saveQueue = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(manifest);
    saveQueue = saveQueue.then(() => atomicJson(manifestPath, snapshot));
    return saveQueue;
  };
  async function terrain(tile) {
    if (tile.status === 'missing' || tile.status === 'empty') return false;
    if (await verifiedFile(root, tile)) return false;
    const url = `${terrainBase}0_${tile.x}_${tile.y}.png`;
    // A previous process may have written the PNG immediately before its next
    // manifest checkpoint. Recover that valid, version-scoped file locally.
    if (tile.status === 'pending') {
      try {
        const path = join(root, tile.path);
        const cached = await readFile(path);
        if (isCompletePng(cached, 256, 256)) {
          Object.assign(tile, { status: 'downloaded', bytes: cached.length, sha256: sha256(cached), url,
            retrievedAt: (await stat(path)).mtime.toISOString(), recoveredFromFile: true });
          return true;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const data = await request(url, terrainGate, { png: true, allowMissing: true });
    if (!data) Object.assign(tile, { status: 'missing', bytes: 0, sha256: null, url, retrievedAt: new Date().toISOString() });
    else if (data.length === 0) Object.assign(tile, { status: 'empty', bytes: 0, sha256: null, url, retrievedAt: new Date().toISOString() });
    else {
      if (!isCompletePng(data, 256, 256)) throw new Error(`Unexpected tile dimensions: ${url}`);
      const path = join(root, tile.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      Object.assign(tile, { status: 'downloaded', bytes: data.length, sha256: sha256(data), url, retrievedAt: new Date().toISOString() });
    }
    return true;
  }
  // Include urban/rural examples and all four crop corners; missing tiles count
  // as zero. Use twice the measured mean as a deliberately conservative budget.
  const sampleCoordinates = [[50, 50], [51, 53], [46, 52], [43, 54], [49, 56], [53, 46], [35, 50], [64, 50], [29, 22], [75, 22], [29, 71], [75, 71]];
  const sample = sampleCoordinates.map(([x, y]) => tiles.find(tile => tile.x === x && tile.y === y));
  for (const tile of sample) await terrain(tile);
  const mean = sample.reduce((sum, tile) => sum + tile.bytes, 0) / sample.length;
  const estimate = Math.ceil(mean * slots.length * 2 + 5 * 1024 * 1024);
  manifest.estimate = { sampleSlots: sample.length, meanSampleBytes: mean, estimatedDownloadBytes: estimate, capBytes: MAX_DOWNLOAD_BYTES,
    method: 'Twice the measured mean across 12 urban/rural/corner samples, plus 5 MiB for pins/icons. Estimate, not a guarantee.' };
  await save();
  log(`Estimate: ${(estimate / 1e6).toFixed(1)} MB for ${slots.length} terrain slots plus pins/icons (400 MB cap).`);
  if (estimate > MAX_DOWNLOAD_BYTES) throw new Error('Estimated download exceeds 400 MB; import aborted before full crop.');
  if (!download) {
    if (previous?.complete) {
      // An estimate is read-only for an already completed snapshot, apart from
      // recording its new estimate/coverage verification. Keep runtime metadata.
      Object.assign(manifest, { complete: true, counts: previous.counts });
      await save();
    }
    log('Estimate only. Repeat with --download to import/resume the selected crop.');
    return manifest;
  }
  let finished = 0;
  let cursor = 0;
  let terrainChanges = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < tiles.length) {
      const tile = tiles[cursor++];
      const changed = await terrain(tile);
      finished++;
      if (changed && ++terrainChanges >= 40) { terrainChanges = 0; await save(); }
      if (finished % 200 === 0) log(`Terrain ${finished}/${tiles.length}; ${(tiles.reduce((sum, item) => sum + item.bytes, 0) / 1024 ** 2).toFixed(1)} MiB cached.`);
    }
  }));
  await save();
  const rawData = {};
  for (const name of ['original_sprite_locations', 'map_labels', 'map_label_locations']) {
    const relative = `raw/${name}.json`;
    const old = manifest.raw.find(record => record.path === relative);
    let data;
    if (await verifiedFile(root, old)) data = await readFile(join(root, relative));
    else {
      data = await request(`${rawBase}${name}.json`, terrainGate);
      await mkdir(join(root, 'raw'), { recursive: true });
      await writeFile(join(root, relative), data);
    }
    rawData[name] = JSON.parse(data);
    const record = { path: relative, status: 'downloaded', bytes: data.length, sha256: sha256(data), url: `${rawBase}${name}.json`,
      retrievedAt: (await stat(join(root, relative))).mtime.toISOString() };
    manifest.raw = [...manifest.raw.filter(item => item.path !== relative), record];
  }
  const normalized = await writeNormalizedPins(root, manifest, rawData);
  await save();
  const api = new URL('https://runescape.wiki/api.php');
  const titles = MAP_PIN_CATEGORIES.filter(category => category.file).map(category => `File:${category.file}`);
  const apiBatches = [];
  const pages = [];
  for (let index = 0; index < titles.length; index += 40) {
    api.search = new URLSearchParams({ action: 'query', format: 'json', titles: titles.slice(index, index + 40).join('|'),
      prop: 'imageinfo|revisions', iiprop: 'url|size|extmetadata', rvprop: 'content', rvslots: 'main' });
    const response = JSON.parse(await request(api.href, wikiGate));
    if (response.error) throw new Error(`Wiki API: ${response.error.info}`);
    apiBatches.push({ url: api.href, response });
    pages.push(...Object.values(response.query?.pages ?? {}));
  }
  const apiData = Buffer.from(`${JSON.stringify({ schemaVersion: 1, retrievedAt: new Date().toISOString(), batches: apiBatches }, null, 2)}\n`);
  await writeFile(join(root, 'raw/wiki-icons.json'), apiData);
  manifest.raw = [...manifest.raw.filter(record => record.path !== 'raw/wiki-icons.json'),
    { path: 'raw/wiki-icons.json', status: 'downloaded', bytes: apiData.length, sha256: sha256(apiData), url: 'https://runescape.wiki/api.php', sourceUrls: apiBatches.map(batch => batch.url),
      retrievedAt: new Date().toISOString() }];
  await save();
  let iconIndex = 0;
  for (const category of manifest.categories) {
    if (!category.file) continue;
    const page = pages.find(item => item.title === `File:${category.file}`);
    const info = page?.imageinfo?.[0];
    const content = page?.revisions?.[0]?.slots?.main?.['*'] ?? '';
    const documentedSprite = Number(content.match(/\bid\s*=\s*(\d+)/)?.[1]);
    if (!info || !category.spriteIds.includes(documentedSprite)) throw new Error(`Wiki sprite evidence changed or missing: ${category.file}`);
    const relative = `icons/${category.id}.png`;
    const old = previous?.categories?.find(item => item.id === category.id)?.asset;
    let data;
    if (old?.url === info.url && old.width === info.width && old.height === info.height && await verifiedFile(root, old)) data = await readFile(join(root, relative));
    else {
      if (!old) {
        try {
          const orphan = await readFile(join(root, relative));
          if (orphan.length === info.size && isCompletePng(orphan, info.width, info.height)) data = orphan;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (!data) {
        data = await request(info.url, wikiGate, { png: true });
        await mkdir(join(root, 'icons'), { recursive: true });
        await writeFile(join(root, relative), data);
      }
    }
    if (!isCompletePng(data, info.width, info.height)) throw new Error(`Unexpected icon dimensions: ${category.file}`);
    category.asset = { path: relative, status: 'downloaded', bytes: data.length, sha256: sha256(data), url: info.url,
      descriptionUrl: info.descriptionurl, width: info.width, height: info.height, metadata: info.extmetadata, licensingWikitext: content,
      retrievedAt: (await stat(join(root, relative))).mtime.toISOString() };
    category.icon = `/assets/map/${relative}`;
    if (++iconIndex % 16 === 0) await save();
  }
  manifest.counts = {
    terrainSlots: tiles.length, terrainDownloaded: tiles.filter(tile => tile.status === 'downloaded').length,
    terrainMissing: tiles.filter(tile => tile.status === 'missing').length,
    terrainEmpty: tiles.filter(tile => tile.status === 'empty').length,
    terrainBytes: tiles.reduce((sum, tile) => sum + tile.bytes, 0),
    ...pinCounts(normalized),
    icons: manifest.categories.filter(category => category.asset).length,
    iconBytes: manifest.categories.reduce((sum, category) => sum + (category.asset?.bytes ?? 0), 0),
    transferredBytesThisRun: transferred,
  };
  manifest.counts.assetFiles = manifest.counts.terrainDownloaded + manifest.counts.icons + manifest.raw.length + 1;
  manifest.counts.assetBytes = manifest.counts.terrainBytes + manifest.counts.iconBytes + manifest.pins.bytes
    + manifest.raw.reduce((sum, record) => sum + record.bytes, 0);
  manifest.counts.manifestExcludedFromAssetTotals = true;
  manifest.complete = true;
  await save();
  log(JSON.stringify(manifest.counts, null, 2));
  return manifest;
}

export function parseImportArguments(argumentsList) {
  const options = { download: false, rebuildPins: false };
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === '--output') {
      const value = argumentsList[++index];
      if (!value || value.startsWith('--')) throw new Error('--output requires a directory.');
      options.output = value;
    } else if (argument === '--download') options.download = true;
    else if (argument === '--rebuild-pins') options.rebuildPins = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.download && options.rebuildPins) throw new Error('--rebuild-pins is offline and cannot be combined with --download.');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseImportArguments(process.argv.slice(2));
    await (options.rebuildPins ? rebuildMapPins(options) : importMapAssets(options));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
