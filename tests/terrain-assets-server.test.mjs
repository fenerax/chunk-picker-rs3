import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createServer } from '../app/server.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';
import { createTerrainAssetCatalogue, TERRAIN_MANIFEST_PATH } from '../app/data/terrain-assets.mjs';

const root = fileURLToPath(new URL('../.local/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = Buffer.from('{"fixture":"PNG source"}\n');
const imageBytes = Buffer.from('RIFF synthetic WebP');
const directoryName = 'terrain.optimized-2026-10-08-0123456789abcdef';
const minX = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride), maxY = SURFACE_GRID.startId % SURFACE_GRID.stride;

function bundleFixture() {
  const tiles = [], pages = [];
  const file = relative => ({ path: `${directoryName}/${relative}`, bytes: imageBytes.length, sha256: sha256(imageBytes) });
  for (let row = 0; row < SURFACE_GRID.rows; row++) for (let column = 0; column < SURFACE_GRID.columns; column++) {
    const x = minX + column, y = maxY - row;
    tiles.push({ x, y, width: 256, height: 256, status: 'rendered', ...file(`native/0_${x}_${y}.webp`) });
  }
  for (let y = 0; y < Math.ceil(SURFACE_GRID.rows / 4); y++) for (let x = 0; x < Math.ceil(SURFACE_GRID.columns / 4); x++) {
    const regions = tiles.filter(tile => Math.floor((tile.x - minX) / 4) === x && Math.floor((maxY - tile.y) / 4) === y)
      .map(({ x, y }) => ({ x, y }));
    pages.push({ x, y, left: x * 512, top: y * 512, width: 512, height: 512,
      pixelWidth: 256, pixelHeight: 256, regions, ...file(`overview/${x}_${y}.webp`) });
  }
  return { schemaVersion: 1, mapId: 28, plane: 0, zoom: 2, tileSize: 256, iconFree: true,
    layoutComplete: true, transparentWater: true, oceanColour: [96, 118, 154], directory: directoryName,
    tiles, pages, provenance: { sourceManifestSha256: sha256(sourceBytes) } };
}
const nativePath = `${directoryName}/native/0_${minX}_${maxY}.webp`;
const nativeRoute = `/assets/map/${nativePath}`;
const pagePath = `${directoryName}/overview/0_0.webp`;
const pageRoute = `/assets/map/${pagePath}`;

async function fixture(t, { installed = true, corrupt = false, malformed = false, stale = false } = {}) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'test-terrain-assets-'));
  const mapAssetsDir = path.join(directory, 'original'), terrainAssetsDir = path.join(directory, 'optimized');
  await mkdir(mapAssetsDir);
  await writeFile(path.join(mapAssetsDir, 'manifest.json'), stale ? '{}' : sourceBytes);
  const bundle = bundleFixture();
  if (malformed) bundle.pages[0].regions.pop();
  const manifestBytes = Buffer.from(JSON.stringify(bundle));
  const terrainBundle = { directory: directoryName, manifestPath: `${directoryName}/manifest.json`, manifestSha256: sha256(manifestBytes) };
  if (installed) {
    await mkdir(path.join(terrainAssetsDir, directoryName, 'native'), { recursive: true });
    await mkdir(path.join(terrainAssetsDir, directoryName, 'overview'), { recursive: true });
    await writeFile(path.join(terrainAssetsDir, terrainBundle.manifestPath), corrupt ? '{}' : manifestBytes);
    await writeFile(path.join(terrainAssetsDir, nativePath), imageBytes);
    await writeFile(path.join(terrainAssetsDir, pagePath), imageBytes);
    await writeFile(path.join(terrainAssetsDir, directoryName, 'private.json'), 'private');
  }
  const app = await createServer({ dataDir: path.join(directory, 'state'), mapAssetsDir, terrainAssetsDir, terrainBundle,
    definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] }, taskMap: {}, port: 0 });
  t.after(async () => {
    await app.close();
    assert.ok(directory.startsWith(`${root.replace(/[\\/]$/, '')}${path.sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const headers = { authorization: `Bearer ${app.store.getAccessToken()}` };
  const get = (route, options = {}) => fetch(`${origin}${route}`, { ...options, headers: { ...headers, ...options.headers } });
  const raw = route => new Promise((resolve, reject) => {
    const request = http.get(`${origin}/`, { path: route, headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
  });
  return { app, origin, get, raw, directory, terrainAssetsDir, terrainBundle };
}

test('optimized manifest, native and overview files use authentication before conditional/HEAD responses', async t => {
  const { origin, get } = await fixture(t);
  for (const route of [TERRAIN_MANIFEST_PATH, nativeRoute, pageRoute]) {
    const response = await get(route);
    assert.equal(response.status, 200);
    const etag = response.headers.get('etag');
    assert.equal((await get(route, { headers: { 'if-none-match': etag } })).status, 304);
    const head = await get(route, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    for (const method of ['GET', 'HEAD']) {
      assert.equal((await fetch(`${origin}${route}`, { method, headers: { 'if-none-match': etag } })).status, 401);
    }
  }
  const manifest = await get(TERRAIN_MANIFEST_PATH);
  assert.equal(manifest.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  const payload = await manifest.json();
  assert.equal(payload.available, true); assert.equal(payload.tiles.length, 2350); assert.equal(payload.pages.length, 156);
  assert.equal(payload.provenance, undefined, 'large offline provenance is separate from the browser manifest');
  const native = await get(nativeRoute);
  assert.equal(native.headers.get('content-type'), 'image/webp');
  assert.equal(native.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await native.arrayBuffer()), imageBytes);
});

test('missing, corrupt, malformed and stale bundles quietly retain the PNG fallback without caching absence', async t => {
  for (const options of [{ installed: false }, { corrupt: true }, { malformed: true }, { stale: true }]) {
    const { get } = await fixture(t, options);
    const response = await get(TERRAIN_MANIFEST_PATH);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { available: false });
    assert.equal((await get(nativeRoute)).status, 404);
  }
});

test('revoked invitation sessions cannot revalidate optimized terrain or fetch HEAD', async t => {
  const { origin, get } = await fixture(t);
  const createdResponse = await get('/api/invites', { method: 'POST', body: JSON.stringify({ label: 'Fixture terrain viewer' }),
    headers: { origin, 'content-type': 'application/json' } });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const joined = await fetch(`${origin}${new URL(created.link).pathname}`, { redirect: 'manual' });
  assert.equal(joined.status, 303);
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const etags = new Map();
  for (const route of [TERRAIN_MANIFEST_PATH, nativeRoute, pageRoute]) {
    const response = await fetch(`${origin}${route}`, { headers: { cookie } });
    assert.equal(response.status, 200); etags.set(route, response.headers.get('etag'));
  }
  assert.equal((await get(`/api/invites/${created.invite.id}/revoke`, { method: 'POST', body: '{}',
    headers: { origin, 'content-type': 'application/json' } })).status, 200);
  for (const [route, etag] of etags) for (const method of ['GET', 'HEAD']) {
    assert.equal((await fetch(`${origin}${route}`, { method, headers: { cookie, 'if-none-match': etag } })).status, 401);
  }
});

test('terrain serving rejects unlisted paths, traversal, missing files, symlinks and changed bytes before 304', async t => {
  const { directory, terrainAssetsDir, get, raw } = await fixture(t);
  const response = await get(nativeRoute), etag = response.headers.get('etag');
  for (const route of [`/assets/map/${directoryName}/private.json`, `/assets/map/${directoryName}/native/1_${minX}_${maxY}.webp`,
    `/assets/map/${directoryName}/native/0_0_0.webp`, `/assets/map/${directoryName}/../manifest.json`,
    `/assets/map/${directoryName}/%2e%2e/manifest.json`, `/assets/map/${directoryName}%5cnative%5c0_${minX}_${maxY}.webp`]) {
    assert.equal(await raw(route), 404, route);
  }
  assert.equal((await get(`/assets/map/${directoryName}/native/0_${minX + 1}_${maxY}.webp`)).status, 404);
  assert.equal((await get(nativeRoute, { method: 'POST' })).status, 405);
  const file = path.join(terrainAssetsDir, nativePath);
  await writeFile(file, 'altered');
  assert.equal((await get(nativeRoute, { headers: { 'if-none-match': etag } })).status, 404);
  assert.equal((await get(nativeRoute, { method: 'HEAD' })).status, 404);
  await rm(file);
  const outside = path.join(directory, 'outside.webp'); await writeFile(outside, imageBytes);
  await symlink(outside, file, 'file');
  assert.equal((await get(nativeRoute)).status, 404);
});

test('terrain catalogue enforces exact crop/page coverage, dimensions, hashes and pinned paths', () => {
  const bundle = bundleFixture(), descriptor = { directory: directoryName,
    manifestPath: `${directoryName}/manifest.json`, manifestSha256: sha256('fixture') };
  assert.equal(createTerrainAssetCatalogue(bundle, descriptor).files.size, 2506);
  for (const change of [data => data.tiles.pop(), data => data.pages.pop(), data => { data.tiles[0].width = 128; },
    data => { data.tiles[0].path = '../secret.webp'; }, data => { data.tiles[0].sha256 = 'invalid'; },
    data => { data.pages[0].regions[0].x = minX + 4; }, data => { data.pages[0].regions.push(data.pages[0].regions[0]); },
    data => { data.pages[0].left = 1; }, data => { data.oceanColour = [0, -1, 256]; }]) {
    const altered = structuredClone(bundle); change(altered);
    assert.throws(() => createTerrainAssetCatalogue(altered, descriptor), TypeError);
  }
  assert.throws(() => createTerrainAssetCatalogue(bundle, { ...descriptor, manifestPath: '../manifest.json' }), TypeError);
  assert.throws(() => createTerrainAssetCatalogue(bundle, { ...descriptor, directory: 'terrain.optimized-2026-10-08' }), TypeError);
});
