import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { PIN_COMMIT, SURFACE_CROP, gameToWorld, chunkIdForGame, enumerateTerrainTiles, normalizePins } from '../app/data/map-pins.mjs';
import { MAP_PIN_CATEGORIES, categoryForSprite } from '../app/data/map-pin-categories.mjs';
import { importMapAssets, rebuildMapPins, parseImportArguments, retryAfterMilliseconds, createRateLimiter, sha256, isCompletePng, TERRAIN_COMMIT, MAX_DOWNLOAD_BYTES } from '../scripts/import-map-assets.mjs';

test('surface crop is derived from SURFACE_GRID, with integer game tile centres', () => {
  assert.deepEqual(SURFACE_CROP, { minX: 1856, maxX: 4864, minY: 1408, maxY: 4608, pixelsPerGameTile: 2 });
  assert.deepEqual(gameToWorld(1856, 4607), { x: 1, y: 1 });
  assert.deepEqual(gameToWorld(4863, 1408), { x: 6015, y: 6399 });
  assert.deepEqual(gameToWorld(1856.5, 4607.5, { centred: true }), { x: 1, y: 1 });
  assert.equal(chunkIdForGame(1856, 4607), '7495');
  assert.equal(chunkIdForGame(4864, 1408), null);
  assert.equal(chunkIdForGame(1856, 4608), null);
  assert.equal(chunkIdForGame(1855, 1408), null);
});

test('zoom 2 imports exactly the crop, without other planes/maps/resolutions', () => {
  const tiles = enumerateTerrainTiles();
  assert.equal(tiles.length, 2350);
  assert.deepEqual(tiles[0], { x: 29, y: 22, path: 'terrain/28/2/0_29_22.png' });
  assert.deepEqual(tiles.at(-1), { x: 75, y: 71, path: 'terrain/28/2/0_75_71.png' });
  assert.equal(enumerateTerrainTiles(1).length, 600);
  assert.throws(() => enumerateTerrainTiles(4), RangeError);
});

// Coordinates read from actual original_sprite_locations.json at b8424a43...;
// Lumbridge ground-floor bank, Varrock east bank, altar north of Falador.
const landmarks = [
  { name: 'Lumbridge bank', x: 3215, y: 3257, sprite: 18952, chunk: '12850', world: [2719, 2701], category: 'bank' },
  { name: 'Varrock east bank', x: 3254, y: 3420, sprite: 18952, chunk: '12853', world: [2797, 2375], category: 'bank' },
  { name: 'Falador north altar', x: 2978, y: 3407, sprite: 22405, chunk: '11829', world: [2245, 2401], category: 'altar' },
];
const coverageFor = rows => rows.map(row => ({ x: Math.floor(row.x / 64), y: Math.floor(row.y / 64), status: 'downloaded' }));

test('downloaded landmark coordinates map to reference chunks with half-tile anchors', () => {
  const raw = landmarks.map(point => ({ type: 'object', x: point.x, y: point.y, plane: 0, iconData: { icon: { iconSprite: point.sprite } } }));
  const { pins } = normalizePins(raw, { terrainTiles: coverageFor(raw) });
  landmarks.forEach((point, index) => {
    assert.equal(pins[index].chunkId, point.chunk, point.name);
    assert.deepEqual([pins[index].worldX, pins[index].worldY], point.world, point.name);
    assert.equal(pins[index].categoryId, point.category, point.name);
  });
  // Falador Castle's actual altar is upstairs: coordinates align, but a plane-0
  // pin layer must exclude it rather than pretending it is a surface facility.
  assert.deepEqual(gameToWorld(2982, 3346), { x: 2253, y: 2523 });
  assert.equal(chunkIdForGame(2982, 3346), '11828');
  assert.equal(normalizePins([{ type: 'object', x: 2982, y: 3346, plane: 2,
    iconData: { icon: { iconSprite: 22405 } } }]).pins.length, 0);
});

test('normalization respects explicit maplink transform, filters floors, preserves duplicates/conditions', () => {
  const row = { type: 'maplink', x: 2632, y: 9694, plane: 0, labelId: 19,
    maplink: { mapId: 28, x: 2632, y: 3294, plane: 0 },
    iconData: { properties: { requiredQuest: 7 }, icon: { iconSprite: 999999, vb9: [1, 2] } } };
  const input = [row, structuredClone(row), { ...row, maplink: { ...row.maplink, mapId: 29 } },
    { ...row, maplink: { ...row.maplink, plane: 1 } }];
  const { pins } = normalizePins(input, { labels: [{ id: 19, text: 'Dungeon<br><script>text</script>' }] });
  assert.equal(pins.length, 1);
  assert.equal(pins[0].variants.length, 2);
  assert.notEqual(pins[0].variants[0].id, pins[0].variants[1].id);
  assert.equal(pins[0].y, 3294);
  assert.equal(pins[0].source.y, 9694);
  assert.equal(pins[0].source.transform, 'explicit-maplink');
  assert.equal(pins[0].label, 'Dungeon text');
  assert.equal(pins[0].categoryId, 'other');
  assert.deepEqual(pins[0].conditions.icon.vb9, [1, 2]);
  assert.deepEqual(pins[0].conditions.properties, { requiredQuest: 7 });
});

test('tooltip/explicit labels become plain text and unknown sprites remain Other', () => {
  const row = { type: 'object', x: 2000, y: 2000, plane: 0, tooltip: 'Mine<br>Level 10', iconData: { icon: { iconSprite: 7 } } };
  assert.equal(normalizePins([row], { terrainTiles: coverageFor([row]) }).pins[0].label, 'Mine Level 10');
  delete row.tooltip;
  const normalized = normalizePins([row], { terrainTiles: coverageFor([row]), labels: [{ id: 8, text: 'A named location' }], labelLocations: [{ labelId: 8, location: { plane: 0, x: 2000, y: 2000 } }] });
  assert.equal(normalized.pins[0].label, 'A named location');
  assert.equal(categoryForSprite(7).id, 'other');
  assert.equal(new Set(MAP_PIN_CATEGORIES.map(category => category.id)).size, MAP_PIN_CATEGORIES.length);
  assert.equal(MAP_PIN_CATEGORIES.find(category => category.id === 'other').icon, null);
});

test('request limiter spaces concurrent starts and Retry-After supports seconds/dates', async () => {
  let clock = 0;
  const waits = [];
  const gate = createRateLimiter(250, async ms => { waits.push(ms); clock += ms; }, () => clock);
  await Promise.all([gate(), gate(), gate(), gate()]);
  assert.deepEqual(waits, [0, 250, 250, 250]);
  assert.equal(retryAfterMilliseconds('3'), 3000);
  assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:03 GMT', 1000), 2000);
  assert.equal(retryAfterMilliseconds('nonsense'), 0);
  assert.match(TERRAIN_COMMIT, /^[a-f0-9]{40}$/);
  assert.equal(MAX_DOWNLOAD_BYTES, 400000000);
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('resuming recognizes only complete PNG files with the requested dimensions', () => {
  const bytes = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(256, 16);
  bytes.writeUInt32BE(256, 20);
  bytes.write('IEND', bytes.length - 8);
  assert.equal(isCompletePng(bytes, 256, 256), true);
  assert.equal(isCompletePng(bytes.subarray(0, -1), 256, 256), false);
  assert.equal(isCompletePng(bytes, 512, 256), false);
});

function samplePng(size = 64) {
  const bytes = Buffer.alloc(size);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(256, 16);
  bytes.writeUInt32BE(256, 20);
  bytes.write('IEND', bytes.length - 8);
  return bytes;
}

async function testAssetRoot(t) {
  const base = resolve('.local/map-assets-import-tests');
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(join(base, 'run-'));
  // Verify the absolute recursive-cleanup target stays under this test workspace.
  assert.ok(resolve(output).startsWith(`${base}${sep}`));
  t.after(() => rm(output, { recursive: true, force: true }));
  return output;
}

test('estimate/resume caches hashes, 404/204 coverage, and interrupted orphan files', async t => {
  const output = await testAssetRoot(t);
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 404 });
    if (calls === 2) return new Response(null, { status: 204 });
    return new Response(samplePng(), { status: 200 });
  };
  const options = { output, fetchImpl, rateLimiterFactory: () => async () => {}, log: () => {} };
  const initial = await importMapAssets(options);
  assert.equal(calls, 12);
  assert.equal(initial.complete, false);
  assert.equal(initial.terrain.tiles.filter(tile => tile.status === 'missing').length, 1);
  assert.equal(initial.terrain.tiles.filter(tile => tile.status === 'empty').length, 1);
  const interrupted = initial.terrain.tiles.find(tile => tile.status === 'downloaded');
  const priorHash = interrupted.sha256;
  Object.assign(interrupted, { status: 'pending', bytes: 0, sha256: null });
  await writeFile(join(output, 'manifest.json'), JSON.stringify(initial));
  await importMapAssets(options);
  assert.equal(calls, 12, 'no cached sample, missing, empty or orphan file was downloaded again');
  const resumed = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  const recovered = resumed.terrain.tiles.find(tile => tile.path === interrupted.path);
  assert.equal(recovered.recoveredFromFile, true);
  assert.equal(recovered.sha256, priorHash);
});

test('estimate above 400 MB stops after the small sample, before full crop', async t => {
  const output = await testAssetRoot(t);
  let calls = 0;
  await assert.rejects(importMapAssets({ output, download: true,
    fetchImpl: async () => { calls++; return new Response(samplePng(140000)); },
    rateLimiterFactory: () => async () => {}, log: () => {},
  }), /Estimated download exceeds 400 MB/);
  assert.equal(calls, 12);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.ok(manifest.estimate.estimatedDownloadBytes > MAX_DOWNLOAD_BYTES);
  assert.equal(manifest.complete, false);
  assert.equal(manifest.terrain.tiles.filter(tile => tile.status === 'pending').length, 2338);
});


test('untagged plane-zero coordinates need terrain evidence; missing coverage does not assign a map ID', () => {
  const row = { type: 'object', x: 2958, y: 1661, plane: 0, iconData: { icon: { iconSprite: 22423 } } };
  const defaultResult = normalizePins([row]);
  assert.equal(defaultResult.pins.length, 0);
  assert.equal(defaultResult.exclusions[0].reason, 'surface-unverified');
  assert.equal(defaultResult.exclusions[0].mapId, null);
  assert.equal(defaultResult.exclusions[0].source.mapId, null);
  for (const status of ['missing', 'empty', 'pending']) {
    const result = normalizePins([row], { terrainTiles: [{ x: 46, y: 25, status }] });
    assert.equal(result.exclusions[0].reason, 'surface-unverified', status);
    assert.equal(result.exclusions[0].coverageStatus, status);
  }
  const supported = normalizePins([row], { terrainTiles: coverageFor([row]) });
  assert.equal(supported.pins[0].surfaceEvidence, 'downloaded-terrain-coverage');
  assert.equal(supported.pins[0].source.mapId, null, 'coverage must not invent source identity');
});

test('explicit maps, floors and transformed instances use destination evidence', () => {
  const row = { type: 'object', x: 3000, y: 3300, plane: 0, iconData: { icon: { iconSprite: 18952 } } };
  const input = [{ ...row, mapId: 28 }, { ...row, mapId: 24 }, { ...row, plane: 2, mapId: 28 },
    { ...row, x: 1000, mapId: 28 },
    { ...row, type: 'maplink', x: 4576, y: 2665, mapId: 24, plane: 1,
      maplink: { mapId: 28, x: 2200, y: 3300, plane: 0 } },
    { ...row, type: 'maplink', mapId: 28, maplink: { mapId: 24, x: 2200, y: 3300, plane: 0 } },
    { ...row, type: 'maplink', maplink: { x: 2200, y: 3300, plane: 0 } }];
  const result = normalizePins(input, { terrainTiles: coverageFor(input) });
  assert.equal(result.pins.length, 2);
  assert.deepEqual(result.exclusions.map(row => row.reason), ['non-surface-map', 'non-surface-plane', 'outside-crop', 'non-surface-map', 'surface-unverified']);
  assert.equal(result.pins[1].source.mapId, 24);
  assert.equal(result.pins[1].source.plane, 1);
  assert.equal(result.pins[1].mapId, 28);
  assert.equal(result.pins[1].x, 2200);
  assert.equal(result.pins[1].source.x, 4576);
  assert.deepEqual(result.normalization.exclusionsByReason, { 'non-surface-map': 2, 'non-surface-plane': 1, 'outside-crop': 1, 'surface-unverified': 1 });
});

test('identical current sprites consolidate conditions while other sprites at that location remain distinct', () => {
  const row = { type: 'icon', x: 3000, y: 3300, plane: 0, mapId: 28, labelId: 7,
    iconData: { icon: { iconSprite: 25254, vb9: [9, 65535, 1, 1] } } };
  const alternate = { ...row, labelId: 8, iconData: { icon: { iconSprite: 25254, vb9: [9, 65535, 2, 2] } } };
  const different = { ...row, iconData: { icon: { iconSprite: 25253, vb9: [9, 65535, 0, 0] } } };
  const result = normalizePins([row, alternate, different]);
  assert.equal(result.pins.length, 2);
  assert.equal(result.pins[0].variants.length, 2);
  assert.deepEqual(result.pins[0].variants[1].conditions.icon.vb9, [9, 65535, 2, 2]);
  assert.equal(result.exclusions[0].reason, 'duplicate-current-sprite');
  assert.equal(result.exclusions[0].retainedPinId, result.pins[0].id);
  assert.equal(result.exclusions[0].source.index, 1);
  assert.deepEqual(result.exclusions[0].conditions.icon, alternate.iconData.icon);
  assert.equal(result.normalization.previousEligiblePins, 3);
  assert.deepEqual(result.normalization.previousEligibleExclusionsByReason, { 'duplicate-current-sprite': 1 });
});

test('offline rebuild changes only processed pins and manifest; cached raw integrity is required', async t => {
  const output = await testAssetRoot(t);
  const rawData = { original_sprite_locations: [
    { type: 'object', x: 3000, y: 3300, plane: 0, mapId: 28, iconData: { icon: { iconSprite: 18952 } } },
    { type: 'object', x: 2958, y: 1661, plane: 0, iconData: { icon: { iconSprite: 22423 } } },
  ], map_labels: [], map_label_locations: [] };
  const raw = [];
  await mkdir(join(output, 'raw'));
  const cachedBytes = new Map();
  for (const [name, data] of Object.entries(rawData)) {
    const path = `raw/${name}.json`;
    const bytes = Buffer.from(JSON.stringify(data));
    await writeFile(join(output, path), bytes);
    cachedBytes.set(path, bytes);
    raw.push({ path, status: 'downloaded', sha256: sha256(bytes), bytes: bytes.length });
  }
  const tilePath = 'terrain/28/2/0_50_51.png';
  const tileBytes = samplePng();
  await mkdir(join(output, 'terrain/28/2'), { recursive: true });
  await writeFile(join(output, tilePath), tileBytes);
  cachedBytes.set(tilePath, tileBytes);
  const manifest = { complete: true, terrain: { commit: TERRAIN_COMMIT, mapId: 28, plane: 0, zoom: 2, tiles: [
    { x: 50, y: 51, path: tilePath, status: 'downloaded', sha256: sha256(tileBytes), bytes: tileBytes.length },
  ] },
    pins: { path: 'pins.normalized.json', commit: PIN_COMMIT }, raw, categories: [], counts: {} };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
  const result = await rebuildMapPins({ output, log: () => {} });
  assert.equal(result.complete, true);
  assert.equal(result.counts.normalizedPins, 1);
  assert.equal(result.counts.excludedPins, 1);
  assert.equal(result.counts.transferredBytesThisRun, 0);
  const processed = await readFile(join(output, 'pins.normalized.json'));
  assert.equal(result.pins.sha256, sha256(processed));
  assert.equal(result.pins.bytes, processed.length);
  assert.equal(result.counts.assetFiles, 5);
  assert.equal(result.counts.assetBytes, processed.length + tileBytes.length + raw.reduce((n, row) => n + row.bytes, 0));
  for (const [path, bytes] of cachedBytes) assert.deepEqual(await readFile(join(output, path)), bytes);
  const manifestBeforeFailure = await readFile(join(output, 'manifest.json'));
  await writeFile(join(output, raw[0].path), '{}');
  await assert.rejects(rebuildMapPins({ output, log: () => {} }), /unverified cached raw/);
  assert.deepEqual(await readFile(join(output, 'pins.normalized.json')), processed);
  assert.deepEqual(await readFile(join(output, 'manifest.json')), manifestBeforeFailure);
  await writeFile(join(output, raw[0].path), cachedBytes.get(raw[0].path));
  await writeFile(join(output, tilePath), 'corrupt');
  await assert.rejects(rebuildMapPins({ output, log: () => {} }), /unverified cached terrain/);
  assert.deepEqual(await readFile(join(output, 'pins.normalized.json')), processed);
  assert.deepEqual(await readFile(join(output, 'manifest.json')), manifestBeforeFailure);
});


test('offline command arguments reject network combinations and missing output values', () => {
  assert.deepEqual(parseImportArguments(['--output', '.local/cached', '--rebuild-pins']),
    { output: '.local/cached', download: false, rebuildPins: true });
  assert.throws(() => parseImportArguments(['--rebuild-pins', '--download']), /offline/);
  assert.throws(() => parseImportArguments(['--output']), /requires a directory/);
  assert.throws(() => parseImportArguments(['--output', '--rebuild-pins']), /requires a directory/);
  assert.throws(() => parseImportArguments(['--surprise']), /Unknown argument/);
});
