import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The original world image comes with the art pack; without it the route is absent.
const worldImage = existsSync(path.join(ROOT, 'reference/original-picker/runescape_world_map.png'));
const definitions = { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] };

async function fixture(t, { assets = true, environment = false } = {}) {
  const local = path.join(ROOT, '.local');
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(path.join(local, 'test-map-assets-'));
  const mapAssetsDir = path.join(directory, 'assets');
  if (assets) await mkdir(mapAssetsDir);
  const options = { dataDir: path.join(directory, 'state'), definitions, taskMap: {}, port: 0 };
  let application;
  if (environment) {
    const previous = process.env.RS3_MAP_ASSETS_DIR;
    process.env.RS3_MAP_ASSETS_DIR = mapAssetsDir;
    try { application = await createServer(options); }
    finally {
      if (previous === undefined) delete process.env.RS3_MAP_ASSETS_DIR;
      else process.env.RS3_MAP_ASSETS_DIR = previous;
    }
  } else application = await createServer({ ...options, mapAssetsDir });
  t.after(async () => {
    await application.close();
    assert.ok(directory.startsWith(`${local}${path.sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const headers = { Authorization: `Bearer ${application.store.getAccessToken()}` };
  const get = (route, options = {}) => fetch(`${origin}${route}`, { headers, ...options });
  // Raw HTTP preserves dot segments, unlike URL-normalizing fetch.
  const raw = route => new Promise((resolve, reject) => {
    const request = http.get(`${origin}/`, { path: route, headers }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  return { directory, mapAssetsDir, origin, get, raw };
}

test('missing local map assets expose a quiet manifest fallback and retain the original world image', async t => {
  const { get, origin } = await fixture(t, { assets: false });
  const manifest = await get('/assets/map/manifest.json');
  assert.equal(manifest.status, 200);
  assert.deepEqual(await manifest.json(), { available: false });
  assert.match(manifest.headers.get('cache-control'), /no-store/);
  assert.equal((await get('/assets/map/pins.normalized.json')).status, 404);
  assert.equal((await get('/assets/world.png', { method: 'HEAD' })).status, worldImage ? 200 : 404);
  assert.equal((await fetch(`${origin}/assets/map/manifest.json`)).status, 401);
});

test('browser world imports can fetch the typed entry policy and versioned surface corrections', async t => {
  const { get } = await fixture(t, { assets: false });
  const policy = await get('/data/cache-entry-policy.mjs');
  assert.equal(policy.status, 200);
  assert.match(await policy.text(), /cacheEntryPolicies/);
  const corrections = await get('/data/cache-surface-corrections.2026-10-08.v1.json');
  assert.equal(corrections.status, 200);
  const evidence = await corrections.json();
  assert.deepEqual(evidence.invalidRegionIds, ['16184', '19248', '19249', '19250']);
  assert.deepEqual(evidence.nonWalkingComponentIds, ['16433:1', '16689:1']);
});

test('the explicit asset directory serves only the local manifest, normalized pins, surface zoom-2 terrain and icons', async t => {
  const { mapAssetsDir, get, raw } = await fixture(t);
  const manifest = { schemaVersion: 1, terrain: { mapId: 28, zoom: 2, plane: 0,
    tiles: [{ x: 50, y: 51, path: 'terrain/28/2/0_50_51.png', status: 'downloaded', bytes: 3, sha256: 'fixture' }] },
  pins: { path: 'pins.normalized.json', snapshotDate: '2021-12-18' },
  categories: [{ id: 'bank', label: 'Bank', icon: '/assets/map/icons/bank.png', spriteIds: [18952] }] };
  await mkdir(path.join(mapAssetsDir, 'terrain', '28', '2'), { recursive: true });
  await mkdir(path.join(mapAssetsDir, 'icons'));
  await mkdir(path.join(mapAssetsDir, 'raw'));
  await writeFile(path.join(mapAssetsDir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(mapAssetsDir, 'pins.normalized.json'), '[{"id":"example"}]');
  await writeFile(path.join(mapAssetsDir, 'terrain', '28', '2', '0_50_51.png'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(mapAssetsDir, 'icons', 'bank.png'), Buffer.from([4, 5]));
  await writeFile(path.join(mapAssetsDir, 'raw', 'secret.json'), '{"secret":true}');
  assert.deepEqual(await (await get('/assets/map/manifest.json')).json(), manifest);
  const pins = await get('/assets/map/pins.normalized.json');
  assert.match(pins.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await pins.json(), [{ id: 'example' }]);
  const tile = await get('/assets/map/terrain/28/2/0_50_51.png');
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await tile.arrayBuffer()), Buffer.from([1, 2, 3]));
  const icon = await get('/assets/map/icons/bank.png', { method: 'HEAD' });
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-length'), '2');
  assert.equal(await icon.text(), '');
  for (const route of ['/assets/map/raw/secret.json', '/assets/map/terrain/28/3/0_50_51.png',
    '/assets/map/terrain/28/2/1_50_51.png', '/assets/map/icons/bank.svg',
    '/assets/map/../world.png', '/assets/map/%2e%2e/world.png', '/assets/map/icons%5cbank.png', '/assets/map/%00']) {
    assert.equal(await raw(route), 404, route);
  }
  assert.equal((await get('/assets/map/manifest.json', { method: 'POST' })).status, 405);
});

test('map asset directory honours the environment override', async t => {
  const { mapAssetsDir, get } = await fixture(t, { environment: true });
  await writeFile(path.join(mapAssetsDir, 'manifest.json'), '{"schemaVersion":1,"available":true}');
  assert.deepEqual(await (await get('/assets/map/manifest.json')).json(), { schemaVersion: 1, available: true });
});

test('current pin bundle, sprite frames, cache terrain and topology modules are narrowly served', async t => {
  const { mapAssetsDir, get, raw } = await fixture(t);
  const version = 'cache-2026-10-08-05932552f7af-v1';
  await writeFile(path.join(mapAssetsDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, terrain: {}, pins: { path: 'pins.normalized.json' } }));
  await writeFile(path.join(mapAssetsDir, `pins.${version}.json`), '{}');
  await writeFile(path.join(mapAssetsDir, `manifest.${version}.json`), '{}');
  await mkdir(path.join(mapAssetsDir, `sprites.${version}`));
  await writeFile(path.join(mapAssetsDir, `sprites.${version}`, '18952-0.png'), 'png');
  await mkdir(path.join(mapAssetsDir, 'terrain.cache-test-v1', '28', '2'), { recursive: true });
  await writeFile(path.join(mapAssetsDir, 'terrain.cache-test-v1', '28', '2', '0_71_52.png'), 'png');
  assert.equal((await (await get('/assets/map/manifest.json')).json()).schemaVersion, 1, 'current pins do not depend on legacy file presence');
  for (const route of [`/assets/map/pins.${version}.json`, `/assets/map/manifest.${version}.json`,
    `/assets/map/sprites.${version}/18952-0.png`, '/assets/map/terrain.cache-test-v1/28/2/0_71_52.png',
    '/core/cache-surface.mjs', '/data/cache-topology.mjs', '/data/cache-walkability.2026-10-07.v1.json', '/data/cache-component-policy.2026-10-07.v1.json']) {
    assert.equal((await get(route)).status, 200, route);
  }
  assert.match((await get('/data/cache-walkability.2026-10-07.v1.json')).headers.get('content-type'), /^application\/json/);
  for (const route of ['/assets/map/pins.cache-unknown-v1.json', '/assets/map/sprites.cache-unknown-v1/18952-0.png',
    '/assets/map/terrain.cache-test-v1/28/3/0_71_52.png', '/assets/map/terrain.cache-test-v1/28/2/1_71_52.png',
    '/data/cache-component-policy.private.json', `/assets/map/sprites.${version}/../manifest.json`]) assert.equal(await raw(route), 404, route);
});

test('a partial import quietly falls back until the declared normalized pins exist', async t => {
  const { mapAssetsDir, get } = await fixture(t);
  const manifest = { schemaVersion: 1, terrain: { mapId: 28, zoom: 2, plane: 0, tiles: [] },
    pins: { path: 'pins.normalized.json', snapshotDate: '2021-12-18' }, categories: [] };
  await writeFile(path.join(mapAssetsDir, 'manifest.json'), JSON.stringify(manifest));
  const incomplete = await get('/assets/map/manifest.json');
  assert.equal(incomplete.status, 200);
  assert.deepEqual(await incomplete.json(), { available: false });
  await writeFile(path.join(mapAssetsDir, 'pins.normalized.json'), '{"schemaVersion":1,"pins":[]}');
  assert.deepEqual(await (await get('/assets/map/manifest.json')).json(), manifest);
});

test('realpath containment rejects an asset directory junction escaping the configured root', async t => {
  const { directory, mapAssetsDir, get } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'bank.png'), 'private fixture');
  await symlink(outside, path.join(mapAssetsDir, 'icons'), process.platform === 'win32' ? 'junction' : 'dir');
  const response = await get('/assets/map/icons/bank.png');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: 'Not found.' });
});
