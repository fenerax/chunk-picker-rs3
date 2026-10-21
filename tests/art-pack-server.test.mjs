import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createArtProvider } from '../app/art-provider.mjs';
import { ART_BINDINGS, TASK_ARTWORK_DIRECTORY } from '../app/art-bindings.mjs';
import { buildArtPack } from '../scripts/build-art-pack.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
const samples = [...ART_BINDINGS.keys()].filter(route => route.startsWith(`/${TASK_ARTWORK_DIRECTORY}/`)
  || ['/assets/SVG/rs3/attack-rs3.svg', '/assets/world.png', '/assets/background.png', '/assets/Head_slot.png'].includes(route));
// The samples are the repository's own art. The images stay out of Git and come with
// the art pack, so without it the tests built from them skip.
const artRoots = { legacyResources: 'resources', taskArtwork: `app/web/${TASK_ARTWORK_DIRECTORY}`, worldImages: 'reference/original-picker' };
const artMissing = (samples.some(route => { const { component, relative } = ART_BINDINGS.get(route); return !existsSync(path.join(root, artRoots[component], relative)); })
  || !existsSync(path.join(root, 'resources/Attack_skill.png'))) && 'needs the art pack images';

async function fixture(t) {
  const local = path.join(root, '.local'); await mkdir(local, { recursive: true });
  const directory = await mkdtemp(path.join(local, 'test-art-server-'));
  const empty = path.join(directory, 'empty'); await mkdir(empty);
  const packsDir = path.join(directory, 'packs'), itemRoot = path.join(directory, 'icons');
  const assetDirectory = 'icons-items.2026-10-08.v1';
  await mkdir(path.join(itemRoot, assetDirectory), { recursive: true });
  const itemBytes = await readFile(path.join(root, 'app/web', TASK_ARTWORK_DIRECTORY, path.basename(samples.find(route => route.startsWith(`/${TASK_ARTWORK_DIRECTORY}/`)))));
  const iconManifest = { schemaVersion: 1, kind: 'items', version: '2026-10-08.v1', assetDirectory,
    icons: { 'Team-1 cape': { file: 'cape.png', aliases: [], width: 32, height: 32, bytes: itemBytes.length, sha256: digest(itemBytes) } } };
  await writeFile(path.join(itemRoot, assetDirectory, 'manifest.json'), JSON.stringify(iconManifest));
  await writeFile(path.join(itemRoot, assetDirectory, 'cape.png'), itemBytes);
  const built = await buildArtPack({ sourceRoot: root, packsDir, version: '1.0.0',
    iconAssetsDir: itemRoot, mapAssetsDir: empty, terrainAssetsDir: empty,
    bindings: new Map(samples.map(route => [route, ART_BINDINGS.get(route)])) });
  let app;
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  async function start({ installed = true, tracked = false } = {}) {
    await app?.close();
    app = await createServer({ dataDir: path.join(directory, 'state'), definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12342'] }]),
      resourcesRoot: tracked ? path.join(root, 'resources') : empty,
      taskArtworkRoot: tracked ? path.join(root, 'app/web', TASK_ARTWORK_DIRECTORY) : empty,
      worldImagesRoot: tracked ? path.join(root, 'reference/original-picker') : empty,
      mapAssetsDir: empty, terrainAssetsDir: empty, iconAssetsDir: tracked ? itemRoot : empty,
      packsDir: installed ? packsDir : empty, iconManifests: [iconManifest], port: 0, predictionPrewarm: false });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`;
    const headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
    return { app, origin, get: (route, options = {}) => fetch(origin + route, { ...options, headers: { ...headers, ...options.headers } }) };
  }
  return { directory, empty, packsDir, built, start, itemRoute: `/assets/map/${assetDirectory}/cape.png` };
}

test('pack routes preserve tracked bytes, MIME, authenticated HEAD and conditional reads across every artwork family', { skip: artMissing }, async t => {
  const f = await fixture(t), tracked = await f.start({ installed: false, tracked: true });
  const originals = new Map();
  for (const route of [...samples, f.itemRoute]) {
    const response = await tracked.get(route); assert.equal(response.status, 200, route);
    originals.set(route, { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') });
  }
  const installed = await f.start();
  for (const [route, original] of originals) {
    const response = await installed.get(route); assert.equal(response.status, 200, route);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.bytes, route);
    assert.equal(response.headers.get('content-type'), original.type, route);
    const etag = response.headers.get('etag');
    assert.equal((await installed.get(route, { method: 'HEAD' })).status, 200, route);
    assert.equal((await installed.get(route, { headers: { 'If-None-Match': etag } })).status, 304, route);
    assert.equal((await fetch(installed.origin + route)).status, 401, route);
  }
  const status = await (await installed.get('/api/art-status')).json();
  assert.equal(status.pack.kind, 'art'); assert.equal(status.pack.version, '1.0.0');
  assert.deepEqual(status.components.worldImages, ['pack']);
  assert.ok(status.availableRoutes.includes('/assets/world.png'));
  assert.equal(JSON.stringify(status).includes(f.directory), false);
  assert.equal((await installed.get('/assets/not-in-bindings.png')).status, 404);
  if (process.platform === 'win32') assert.equal((await installed.get('/assets/head_slot.PNG')).status, 200);
});

test('art selection changes neither calculated access nor save bytes or revision', { skip: artMissing }, async t => {
  const f = await fixture(t), installed = await f.start();
  const before = await (await installed.get('/api/state')).json();
  await installed.get('/api/art-status'); await installed.get(samples[0]);
  const bytes = await readFile(path.join(f.directory, 'state/state.json'));
  const absent = await f.start({ installed: false });
  const after = await (await absent.get('/api/state')).json();
  assert.deepEqual(after.pools, before.pools);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.state.revision, before.state.revision);
  assert.deepEqual(await readFile(path.join(f.directory, 'state/state.json')), bytes);
  const status = await (await absent.get('/api/art-status')).json();
  assert.equal(status.placeholderPictures, true); assert.deepEqual(status.availableRoutes, []);
  assert.equal(status.pack.health, 'absent');
  assert.equal((await absent.get('/placeholder-art/item.svg')).status, 200);
  assert.equal((await absent.get('/assets/fontawesome/fa-solid-900.woff2')).status, 200, 'licensed UI font is independent of artwork absence');
  assert.equal((await absent.get('/assets/world.png')).status, 404);
});

test('missing or corrupt individual pack files fall back per file with repo art explicitly absent', { skip: artMissing }, async t => {
  const f = await fixture(t);
  const slot = path.join(f.built.directory, 'resources/Head_slot.png');
  await writeFile(slot, Buffer.alloc((await readFile(slot)).length));
  await rm(path.join(f.built.directory, 'world-images/Background-chunk.PNG'));
  const { get } = await f.start();
  assert.equal((await get('/assets/Head_slot.png')).status, 404);
  assert.equal((await get('/assets/background.png')).status, 404);
  assert.equal((await get('/assets/SVG/rs3/attack-rs3.svg')).status, 200);
  const status = await (await get('/api/art-status')).json();
  assert.equal(status.placeholderPictures, true); assert.equal(status.pack.health, 'partial');
  assert.ok(!status.availableRoutes.includes('/assets/Head_slot.png'));
});

test('component overrides precede the selected pack, followed by injected tracked defaults and absence', { skip: artMissing }, async t => {
  const f = await fixture(t), relative = 'Head_slot.png';
  const override = path.join(f.directory, 'override'); await mkdir(override);
  await writeFile(path.join(override, relative), await readFile(path.join(root, 'resources/Attack_skill.png')));
  const options = { packsDir: f.packsDir, defaults: { legacyResources: path.join(root, 'resources') } };
  const overridden = await createArtProvider({ ...options, overrides: { legacyResources: override } });
  assert.equal(await overridden.file('legacyResources', relative), path.join(override, relative));
  const packed = await createArtProvider(options);
  assert.equal(await packed.file('legacyResources', relative), path.join(f.built.directory, 'resources', relative));
  await writeFile(path.join(f.built.directory, 'resources', relative), 'damaged');
  assert.equal(await packed.file('legacyResources', relative), path.join(root, 'resources', relative));
  const absent = await createArtProvider({ ...options, defaults: { legacyResources: f.empty } });
  assert.equal(await absent.file('legacyResources', relative), null);
});

test('a mismatched selection pin cannot advertise artwork when tracked defaults are empty', { skip: artMissing }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.packsDir, 'selection.json'), JSON.stringify({ ...f.built.selection,
    art: { ...f.built.selection.art, sha256: '0'.repeat(64) } }));
  const { get } = await f.start();
  const status = await (await get('/api/art-status')).json();
  assert.equal(status.pack.health, 'invalid'); assert.equal(status.placeholderPictures, true);
  assert.equal(status.pack.version, '1.0.0');
  assert.deepEqual(status.availableRoutes, []);
  assert.equal((await get('/assets/SVG/rs3/attack-rs3.svg')).status, 404);
  assert.deepEqual(await (await get('/assets/map/manifest.json')).json(), { available: false });
});

test('viewer sessions can read pack pictures and status while overlay tokens retain their existing scope', { skip: artMissing }, async t => {
  const f = await fixture(t), { origin, get, app } = await f.start();
  async function create(route, body) { return (await get(route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
  const viewer = await create('/api/invites', { label: 'Art viewer', viewer: true });
  const joined = await fetch(origin + new URL(viewer.link).pathname, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  for (const route of [samples[0], '/api/art-status', '/placeholder-art/item.svg']) assert.equal((await fetch(origin + route, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(origin + '/api/command', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: app.store.getInfo().revision, command: { type: 'set-rule', ruleId: 'content.f2p', value: false } }) })).status, 403);
  const overlay = await create('/api/overlays', { label: 'Art scope', widget: 'count', player: 'duo' });
  const key = new URLSearchParams(new URL(overlay.link).hash.slice(1)).get('key');
  for (const route of [samples[0], '/api/art-status', '/placeholder-art/item.svg']) assert.equal((await fetch(origin + route, { headers: { Authorization: `Bearer ${key}` } })).status, 401);
});

test('surface, cache, category, sprite, optimized and interior route families preserve pack bytes', async t => {
  const local = path.join(root, '.local'); await mkdir(local, { recursive: true });
  const directory = await mkdtemp(path.join(local, 'test-art-families-'));
  let app;
  t.after(async () => { await app?.close(); assert.ok(directory.startsWith(local + path.sep)); await rm(directory, { recursive: true, force: true }); });
  const assets = path.join(directory, 'assets'), empty = path.join(directory, 'empty'), packsDir = path.join(directory, 'packs');
  await mkdir(assets); await mkdir(empty);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');
  webp.writeUInt32LE(webp.length - 8, 4);
  const record = (relative, bytes = png) => ({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
  const pinVersion = 'cache-2026-10-08-05932552f7af-v1';
  const pngPaths = ['terrain/28/2/0_50_51.png', 'terrain.cache-fixture/28/2/0_50_51.png',
    'icons/bank.png', `sprites.${pinVersion}/18952-0.png`, 'interiors.cache-fixture/1/2/0_0_0.png'];
  const sourceBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, terrain: { tiles: pngPaths.slice(0, 4).map(relative => record(relative)) }, pins: { path: 'pins.normalized.json' } }));
  const optimizedDirectory = 'terrain.optimized-2026-10-08-0123456789abcdef';
  const minX = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride), maxY = SURFACE_GRID.startId % SURFACE_GRID.stride;
  const tiles = [], pages = [];
  for (let row = 0; row < SURFACE_GRID.rows; row++) for (let column = 0; column < SURFACE_GRID.columns; column++) {
    const x = minX + column, y = maxY - row;
    tiles.push({ x, y, width: 256, height: 256, status: 'rendered', ...record(`${optimizedDirectory}/native/0_${x}_${y}.webp`, webp) });
  }
  for (let y = 0; y < Math.ceil(SURFACE_GRID.rows / 4); y++) for (let x = 0; x < Math.ceil(SURFACE_GRID.columns / 4); x++) {
    const regions = tiles.filter(tile => Math.floor((tile.x - minX) / 4) === x && Math.floor((maxY - tile.y) / 4) === y).map(({ x, y }) => ({ x, y }));
    pages.push({ x, y, left: x * 512, top: y * 512, width: 512, height: 512, pixelWidth: 256, pixelHeight: 256,
      regions, ...record(`${optimizedDirectory}/overview/${x}_${y}.webp`, webp) });
  }
  const optimized = { schemaVersion: 1, directory: optimizedDirectory, mapId: 28, plane: 0, zoom: 2, tileSize: 256,
    iconFree: true, layoutComplete: true, transparentWater: true, oceanColour: [96, 118, 154], tiles, pages,
    provenance: { sourceManifestSha256: digest(sourceBytes) } };
  const optimizedBytes = Buffer.from(JSON.stringify(optimized));
  const terrainBundle = { directory: optimizedDirectory, manifestPath: `${optimizedDirectory}/manifest.json`, manifestSha256: digest(optimizedBytes) };
  const interiorPath = 'interiors.cache-fixture/manifest.json';
  const interiorBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, tiles: [record(pngPaths[4])] }));
  const interiorCatalogue = { schemaVersion: 1, displayOnly: true, accessEffect: 'none', version: 'fixture',
    assets: { directory: 'interiors.cache-fixture', manifestPath: interiorPath, manifestSha256: digest(interiorBytes) },
    maps: [{ mapId: 1, plane: 0, bounds: { minX: 0, maxX: 64, minY: 0, maxY: 64 },
      tiles: [{ x: 0, y: 0, plane: 0, status: 'rendered', ...record(pngPaths[4]) }] }], areas: [] };
  const routes = new Map([...pngPaths.map(relative => [`/assets/map/${relative}`, png]),
    [`/assets/map/${tiles[0].path}`, webp], [`/assets/map/${pages[0].path}`, webp],
    ['/assets/map/manifest.json', sourceBytes], ['/assets/map/pins.normalized.json', Buffer.from('{"schemaVersion":1,"pins":[]}')],
    [`/assets/map/${interiorPath}`, interiorBytes], [`/assets/map/${terrainBundle.manifestPath}`, optimizedBytes]]);
  for (const [route, bytes] of routes) {
    const filename = path.join(assets, route.slice('/assets/map/'.length));
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
  }
  await buildArtPack({ sourceRoot: directory, packsDir, mapAssetsDir: assets, terrainAssetsDir: assets, iconAssetsDir: assets,
    bindings: new Map(), nestedManifestPaths: [interiorPath, terrainBundle.manifestPath] });
  let originals;
  for (const installed of [false, true]) {
    await app?.close();
    app = await createServer({ dataDir: path.join(directory, 'state'), definitions, taskMap: {}, port: 0, predictionPrewarm: false,
      packsDir: installed ? packsDir : empty, packSelection: path.join(installed ? packsDir : empty, 'selection.json'),
      resourcesRoot: empty, worldImagesRoot: empty, taskArtworkRoot: empty,
      mapAssetsDir: installed ? empty : assets, terrainAssetsDir: installed ? empty : assets, iconAssetsDir: empty,
      iconManifests: [], terrainBundle, interiorCatalogue });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
    const results = new Map();
    for (const [route, expected] of routes) {
      const response = await fetch(origin + route, { headers }); assert.equal(response.status, 200, route);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual(bytes, expected, route);
      const etag = response.headers.get('etag');
      assert.equal((await fetch(origin + route, { headers: { ...headers, 'If-None-Match': etag } })).status, 304, route);
      results.set(route, { sha256: digest(bytes), type: response.headers.get('content-type') });
    }
    if (originals) assert.deepEqual(results, originals); else originals = results;
  }
});
