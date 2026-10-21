import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createInteriorAssetCatalogue } from '../app/data/interior-assets.mjs';
import { sha256 } from '../scripts/lib/provenance-hash.mjs';

const root = fileURLToPath(new URL('../.local/archmaps-api-tests/', import.meta.url));
const directoryName = 'interiors.cache-fixture-v1';
const tileBytes = Buffer.from([137, 80, 78, 71]);
const manifestBytes = Buffer.from('{"fixture":"interior render"}\n');
const relative = `${directoryName}/31/2/0_50_50.png`;
const route = `/assets/map/${relative}`;
const catalogue = {
  schemaVersion: 1, displayOnly: true, accessEffect: 'none',
  assets: { directory: directoryName, manifestPath: `${directoryName}/manifest.json`, manifestSha256: sha256(manifestBytes) },
  maps: [{ mapId: 31, plane: 0, name: 'Fixture cellar', bounds: { minX: 3200, minY: 3200, maxX: 3264, maxY: 3264 },
    tiles: [{ x: 50, y: 50, plane: 0, path: relative, status: 'rendered', bytes: tileBytes.length, sha256: sha256(tileBytes) }] }],
  areas: [{ areaId: 'Fixture cellar', name: 'Fixture cellar', status: 'mapped', layers: [{ mapId: 31, plane: 0 }], entrances: [] },
    { areaId: 'Unresolved cave', name: 'Unresolved cave', status: 'unknown', layers: [], entrances: [] }],
};

async function fixture(t, { installed = true, mismatched = false } = {}) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'server-'));
  const mapAssetsDir = path.join(directory, 'assets');
  if (installed) {
    await mkdir(path.join(mapAssetsDir, directoryName, '31', '2'), { recursive: true });
    await writeFile(path.join(mapAssetsDir, directoryName, 'manifest.json'), mismatched ? '{}' : manifestBytes);
    await writeFile(path.join(mapAssetsDir, relative), tileBytes);
    await writeFile(path.join(mapAssetsDir, directoryName, 'private.json'), '{"private":true}');
  }
  const app = await createServer({ dataDir: path.join(directory, 'state'), mapAssetsDir, interiorCatalogue: catalogue,
    port: 0, taskMap: {}, definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] },
    initialState: createGroupState([{ id: 'a', name: 'Fixture A' }, { id: 'b', name: 'Fixture B' }]) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const headers = { authorization: `Bearer ${app.store.getAccessToken()}` };
  const get = (url, options = {}) => fetch(`${origin}${url}`, { ...options, headers: { ...headers, ...options.headers } });
  const raw = url => new Promise((resolve, reject) => {
    const request = http.get(`${origin}/`, { path: url, headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
  });
  return { app, origin, get, raw, mapAssetsDir, directory };
}

test('Archaeology and interior references are authenticated and leave synthetic saved gameplay unchanged', async t => {
  const { origin, get, directory } = await fixture(t);
  const stateFile = path.join(directory, 'state', 'state.json'), before = await readFile(stateFile);
  for (const url of ['/api/archaeology-catalogue', '/api/interior-maps', '/core/interior-maps.mjs', '/core/archaeology.mjs',
    '/data/cache-interiors.mjs', '/data/cache-interiors.2026-10-08.v2.json', '/data/cache-archaeology.mjs', route]) {
    assert.equal((await fetch(`${origin}${url}`)).status, 401, url);
    assert.equal((await get(url)).status, 200, url);
  }
  assert.equal((await get('/data/cache-interiors.2026-10-08.v1.json')).status, 404);
  assert.equal((await (await get('/api/rules')).json()).cacheArchaeology, false);
  assert.equal((await (await get('/api/archaeology-catalogue')).json()).contentsEnabled, false);
  const response = await get('/api/interior-maps'), full = await response.json();
  assert.equal(full.accessEffect, 'none'); assert.equal(full.assets.available, true);
  assert.equal(full.maps[0].tiles[0].url, route);
  assert.equal((await get('/api/interior-maps', { headers: { 'if-none-match': response.headers.get('etag') } })).status, 304);
  const area = await (await get('/api/interior-maps?area=Fixture%20cellar')).json();
  assert.equal(area.area.status, 'mapped'); assert.equal(area.area.maps[0].mapId, 31);
  const unknown = await (await get('/api/interior-maps?area=Unresolved%20cave')).json();
  assert.equal(unknown.area.status, 'unknown'); assert.deepEqual(unknown.area.maps, []);
  assert.equal((await get('/api/interior-maps?area=')).status, 400);
  assert.equal((await get('/api/interior-maps?area=Nonexistent')).status, 404);
  assert.deepEqual(await readFile(stateFile), before);
});

test('absent and mismatched interior assets expose mapping evidence with no image URLs', async t => {
  for (const options of [{ installed: false }, { mismatched: true }]) {
    const { get } = await fixture(t, options);
    const full = await (await get('/api/interior-maps')).json();
    assert.equal(full.assets.available, false); assert.equal(full.maps[0].tiles[0].url, null);
    assert.equal(full.areas[0].status, 'mapped'); assert.equal((await get(route)).status, 404);
  }
});

test('interior tile serving checks pinned bytes and paths, supports HEAD and private conditional requests', async t => {
  const { get, raw, mapAssetsDir, directory } = await fixture(t);
  const response = await get(route);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), tileBytes);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  assert.equal((await get(route, { headers: { 'if-none-match': response.headers.get('etag') } })).status, 304);
  const head = await get(route, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const manifest = await get(`/assets/map/${directoryName}/manifest.json`);
  assert.deepEqual(Buffer.from(await manifest.arrayBuffer()), manifestBytes);
  for (const url of [`/assets/map/${directoryName}/private.json`, `/assets/map/${directoryName}/31/3/0_50_50.png`,
    `/assets/map/${directoryName}/31/2/1_50_50.png`, `/assets/map/${directoryName}/31/2/0_51_50.png`,
    `/assets/map/${directoryName}/../private.json`, `/assets/map/${directoryName}%5cprivate.json`]) assert.equal(await raw(url), 404, url);
  assert.equal((await get(route, { method: 'POST' })).status, 405);
  const file = path.join(mapAssetsDir, relative);
  await writeFile(file, 'altered'); assert.equal((await get(route)).status, 404);
  await rm(file);
  const outside = path.join(directory, 'unlisted.png'); await writeFile(outside, tileBytes);
  await symlink(outside, file, 'file'); assert.equal((await get(route)).status, 404);
});

test('interior asset allowlist rejects unsafe or inconsistent catalogue addresses', () => {
  const changed = change => { const data = structuredClone(catalogue); change(data); return data; };
  assert.throws(() => createInteriorAssetCatalogue(changed(data => { data.assets.manifestPath = '../manifest.json'; })), /catalogue/);
  assert.throws(() => createInteriorAssetCatalogue(changed(data => { data.maps[0].tiles[0].path = `${directoryName}/31/2/../private.json`; })), /tile/);
  assert.throws(() => createInteriorAssetCatalogue(changed(data => { data.maps[0].tiles[0].plane = 1; })), /tile/);
  assert.throws(() => createInteriorAssetCatalogue(changed(data => { data.maps[0].tiles[0].sha256 = 'invalid'; })), /tile/);
});
