import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createServer } from '../app/server.mjs';
import { ICON_BUNDLES, ICON_VERSION as CATALOGUE_VERSION, ICON_MANIFEST_PATH, ICON_CACHE_CONTROL } from '../app/data/icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = Buffer.from([1, 2, 3]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const ICON_VERSION = ICON_BUNDLES.find(bundle => bundle.kind === 'skills').version;
const assetDirectory = `icons-skills.${ICON_VERSION}`;
const imagePath = `/assets/map/${assetDirectory}/attack.png`;
const manifest = { schemaVersion: 1, kind: 'skills', version: ICON_VERSION, assetDirectory,
  icons: { Attack: { file: 'attack.png', aliases: ['Melee attack'], width: 24, height: 24, bytes: bytes.length, sha256 } } };

async function fixture(t, { installed = true, mismatched = false } = {}) {
  const local = path.join(root, '.local');
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(path.join(local, 'test-icons-'));
  const mapAssetsDir = path.join(directory, 'assets');
  if (installed) {
    await mkdir(path.join(mapAssetsDir, assetDirectory), { recursive: true });
    await writeFile(path.join(mapAssetsDir, assetDirectory, 'manifest.json'), JSON.stringify(mismatched ? { ...manifest, generatedAt: 'unexpected' } : manifest));
    await writeFile(path.join(mapAssetsDir, assetDirectory, 'attack.png'), bytes);
    await writeFile(path.join(mapAssetsDir, assetDirectory, 'unlisted.png'), 'private');
  }
  const application = await createServer({ dataDir: path.join(directory, 'state'), mapAssetsDir, iconManifests: [manifest],
    definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] }, taskMap: {}, port: 0 });
  t.after(async () => {
    await application.close();
    assert.ok(directory.startsWith(`${local}${path.sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const headers = { Authorization: `Bearer ${application.store.getAccessToken()}` };
  const get = (route, options = {}) => fetch(`${origin}${route}`, { ...options, headers: { ...headers, ...options.headers } });
  const raw = route => new Promise((resolve, reject) => {
    const request = http.get(`${origin}/`, { path: route, headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
  });
  return { directory, mapAssetsDir, origin, get, raw };
}

test('icon manifests, images, helpers and lookup API require existing invitation authentication', async t => {
  const { origin, get } = await fixture(t);
  for (const route of [ICON_MANIFEST_PATH, imagePath, '/icons.mjs', '/task-icons.mjs', '/api/icons?kind=skill&name=Attack']) {
    assert.equal((await fetch(`${origin}${route}`)).status, 401, route);
    assert.equal((await get(route)).status, 200, route);
  }
  assert.deepEqual(await (await get('/api/icons?kind=skill&name=melee%20attack')).json(), {
    kind: 'skill', name: 'melee attack', canonicalName: 'Attack', url: imagePath,
  });
  assert.deepEqual(await (await get('/api/icons?kind=item&name=Unknown')).json(), {
    kind: 'item', name: 'Unknown', canonicalName: null, url: null,
  });
  for (const route of ['/api/icons', '/api/icons?kind=other&name=Attack', '/api/icons?kind=skill&name=%20']) assert.equal((await get(route)).status, 400);
});

test('date-versioned icon responses use private revalidation, ETags and HEAD support', async t => {
  const { get } = await fixture(t);
  for (const route of [ICON_MANIFEST_PATH, imagePath, `/assets/map/${assetDirectory}/manifest.json`]) {
    const response = await get(route);
    assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
    const head = await get(route, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.ok(Number(head.headers.get('content-length')) > 0);
  }
  const png = await get(imagePath);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), bytes);
  const conditional = await get(imagePath, { headers: { 'If-None-Match': `"${sha256}"` } });
  assert.equal(conditional.status, 304);
  const response = await get(ICON_MANIFEST_PATH);
  const projected = await response.json();
  assert.equal(projected.skills.Attack.url, imagePath);
  assert.equal(projected.available, true);
  assert.equal((await get(ICON_MANIFEST_PATH, { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
});

test('missing or mismatched bundles expose a quiet empty lookup without caching absence', async t => {
  for (const options of [{ installed: false }, { mismatched: true }]) {
    const { get } = await fixture(t, options);
    const response = await get(ICON_MANIFEST_PATH);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { schemaVersion: 1, version: CATALOGUE_VERSION, skills: {}, items: {}, available: false });
    assert.equal((await get(imagePath)).status, 404);
    assert.equal((await (await get('/api/icons?kind=skill&name=Attack')).json()).url, null);
  }
});

test('icon route rejects unlisted files, other versions, traversal, symlinks and altered bytes', async t => {
  const { directory, mapAssetsDir, get, raw } = await fixture(t);
  for (const route of [`/assets/map/${assetDirectory}/unlisted.png`, '/assets/map/icons-skills.other/attack.png',
    `/assets/map/${assetDirectory}/../manifest.json`, `/assets/map/${assetDirectory}/%2e%2e/manifest.json`,
    `/assets/map/${assetDirectory}%5cattack.png`]) assert.equal(await raw(route), 404, route);
  assert.equal((await get(imagePath, { method: 'POST' })).status, 405);
  const pngFile = path.join(mapAssetsDir, assetDirectory, 'attack.png');
  await writeFile(pngFile, 'tampered');
  assert.equal((await get(imagePath)).status, 404);
  await rm(pngFile);
  const outside = path.join(directory, 'outside.png');
  await writeFile(outside, bytes);
  await symlink(outside, pngFile, 'file');
  assert.equal((await get(imagePath)).status, 404);
});
