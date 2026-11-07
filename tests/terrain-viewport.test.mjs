import test from 'node:test';
import assert from 'node:assert/strict';
import { MapTerrain, TERRAIN_PREFETCH_BYTES, TERRAIN_OVERVIEW_BYTES } from '../app/web/map-terrain.mjs';
import { loadTerrainManifest } from '../app/web/map-pins.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const regionX = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride);
const regionY = SURFACE_GRID.startId % SURFACE_GRID.stride;
const tileKey = x => `${regionX + x},${regionY}`;
const defaultColumns = Math.min(12, SURFACE_GRID.columns);

const directory = 'terrain.optimized-test-0123456789abcdef';
const canvasFactory = (width, height) => {
  const calls = [], ctx = { drawImage: (...args) => calls.push(args), clearRect() {}, fillRect() {} };
  return { width, height, calls, getContext: () => ctx };
};
function fixture(t, { columns = defaultColumns, concurrency = 1, optimized = true, cacheLimit = 256,
  background = false, tileBytes = 1000, pageBytes = 100, primeCoarse = true, compact = true } = {}) {
  const regions = Array.from({ length: columns }, (_, index) => ({ x: regionX + index, y: regionY }));
  const manifest = { schemaVersion: 1, terrain: { mapId: 28, zoom: 2, plane: 0, tiles: [] },
    cacheTerrain: { mapId: 28, zoom: 2, plane: 0, directory: 'terrain.cache-test/28/2',
      iconFree: true, layoutComplete: true, transparentWater: true, oceanColour: [96, 118, 154],
      tiles: regions.map(region => ({ ...region, status: 'rendered', path: `terrain.cache-test/28/2/0_${region.x}_${region.y}.png` })) } };
  if (optimized) manifest.optimizedTerrain = { schemaVersion: 1, mapId: 28, plane: 0, tileSize: 256, directory,
    tiles: regions.map(region => ({ ...region, width: 256, height: 256, ...(background ? { bytes: tileBytes } : {}), path: `${directory}/native/0_${region.x}_${region.y}.webp` })),
    pages: Array.from({ length: Math.ceil(columns / 4) }, (_, x) => ({ x, y: 0,
      left: x * 512, top: 0, width: 512, height: 512, pixelWidth: 256, pixelHeight: 256,
      ...(background ? { bytes: pageBytes } : {}), path: `${directory}/overview/${x}_0.webp`, regions: regions.slice(x * 4, x * 4 + 4) })) };
  if (background && optimized && compact) manifest.optimizedTerrain.coarseOverview = {
    path: `${directory}/coarse-0123456789abcdef.webp`, bytes: 100,
    width: SURFACE_GRID.columns * 8, height: SURFACE_GRID.rows * 8, scale: 0.0625,
  };
  const idle = new Map(); let idleId = 0;
  const images = [], terrain = new MapTerrain(manifest, { concurrency, cacheLimit, canvasFactory,
    requestIdle: callback => { idle.set(++idleId, callback); return idleId; }, cancelIdle: id => idle.delete(id),
    imageFactory() { const image = { naturalWidth: 256, naturalHeight: 256,
      removeAttribute(name) { assert.equal(name, 'src'); this.cancelled = true; this.src = ''; } };
    images.push(image); return image; } });
  t.after(() => terrain.dispose());
  // Existing viewport cases begin at startup readiness. Separate cases below
  // hold this foreground dependency and verify missing/failed companions too.
  if (primeCoarse && !terrain.coarseReady) {
    terrain.pumpCoarse();
    images[0].naturalWidth = SURFACE_GRID.columns * 8;
    images[0].naturalHeight = SURFACE_GRID.rows * 8;
    images[0].onload(); images.length = 0;
  }
  return { terrain, images, manifest, idle, stepIdle(timeRemaining = 10) {
    const [id, callback] = idle.entries().next().value ?? [];
    assert.ok(callback, 'An idle callback was requested'); idle.delete(id);
    callback({ timeRemaining: () => timeRemaining });
  } };
}
const view = (left, right) => ({ left, right, top: 0, bottom: 128 });

test('compact whole-map underlay is foreground readiness, including a zoom during decode', async t => {
  const { terrain, images, idle } = fixture(t, { background: true, primeCoarse: false });
  terrain.setView(view(0, 128), 0.5);
  assert.equal(terrain.baseReady, false); assert.equal(idle.size, 0);
  assert.equal(images.length, 1); assert.ok(images[0].src.includes('/coarse-'));
  let release;
  images[0].decode = () => new Promise(resolve => { release = resolve; });
  images[0].naturalWidth = SURFACE_GRID.columns * 8; images[0].naturalHeight = SURFACE_GRID.rows * 8;
  images[0].onload();
  terrain.setView(view(128, 256), 4);
  assert.equal(images.length, 1, 'No detail or idle work competes with the readiness image');
  release(); await Promise.resolve();
  assert.equal(terrain.baseReady, true); assert.equal(images.length, 2);
  assert.ok(images[1].src.includes(`/native/0_${regionX+1}_${regionY}.webp`));
  assert.ok(terrain.levels.get(0.5).colour.calls.some(args => args[0] === images[0]));
});

test('a pack without a compact companion immediately loads visible native terrain', t => {
  const { terrain, images } = fixture(t, { background: true, compact: false, primeCoarse: false });
  assert.equal(terrain.baseReady, true);assert.equal(terrain.coarseQueue.size, 0);
  terrain.setView(view(0, 128), 4);
  assert.equal(images.length, 1);assert.ok(images[0].src.includes('/native/'));
  images[0].onload();
  assert.equal(terrain.viewLoaded(), true);assert.equal(terrain.coarseImage, undefined);
  assert.equal(images.length, 1, 'No startup overview sweep or compact request');
});

test('a failed compact asset releases readiness to visible native terrain', t => {
  const { terrain, images } = fixture(t, { background: true, primeCoarse: false });
  terrain.setView(view(0, 128), 4); images[0].onerror();
  assert.equal(terrain.baseReady, true);
  assert.equal(images.length, 2);assert.ok(images[1].src.includes('/native/'));
  images[1].onload();assert.equal(terrain.viewLoaded(), true);
});

test('a failed compact decode releases readiness to visible native terrain', async t => {
  const { terrain, images } = fixture(t, { background: true, primeCoarse: false });
  terrain.setView(view(0, 128), 4);
  images[0].decode=()=>Promise.reject(Error('Synthetic decode failure'));
  await images[0].onload();
  assert.equal(terrain.baseReady, true);
  assert.equal(images.length, 2);assert.ok(images[1].src.includes('/native/'));
});

test('overview requests visible pages centre-first with one bounded shared load pool', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, defaultColumns * 128), 0.16);
  assert.equal(images.length, 1);
  const pages = Math.ceil(defaultColumns / 4), firstPage = pages === 3 ? 1 : 0;
  assert.equal(images[0].src, `/assets/map/${directory}/overview/${firstPage}_0.webp`);
  images[0].onload();
  assert.equal(images.length, 2);
  assert.equal(images[1].src, `/assets/map/${directory}/overview/${firstPage === 1 ? 0 : 1}_0.webp`);
  images[1].onload(); if (pages === 3) images[2].onload();
  assert.equal(images.length, pages, 'Four native tiles share each overview request');
  assert.equal(terrain.viewLoaded(), true);
  assert.equal(terrain.committedKeys.size, defaultColumns);
  assert.equal(terrain.images.size, 0, 'Overview never downloads native detail');
});

test('partial viewport fetches no nonintersecting overview pages and crops north-positive regions', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(128, 256), 0.2); images[0].onload();
  assert.equal(images.length, 1);
  assert.equal(terrain.visibleKeys.size, 1);
  assert.deepEqual(terrain.previews.get(tileKey(1)).calls[0].slice(1), [64, 0, 64, 64, 0, 0, 64, 64]);
});

test('zoom-in downloads crisp lossless native tiles only for the viewport', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, 512), 0.16); images[0].onload();
  terrain.setView(view(128, 256), 4);
  assert.equal(images[1].src, `/assets/map/${directory}/native/0_${regionX + 1}_${regionY}.webp`);
  images[1].onload();
  assert.equal(images.length, 2);
  assert.equal(terrain.images.size, 1);
  assert.ok(terrain.pages.get('0,0').nativeKeys.has(tileKey(1)));
});

test('stale pan requests cancel and release concurrency to the current centre', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, 512), 0.16);
  const oldLoad = images[0].onload;
  const lastPage = Math.ceil(defaultColumns / 4) - 1;
  terrain.setView(view(lastPage * 512, defaultColumns * 128), 0.16);
  assert.equal(images[0].cancelled, true);
  assert.equal(images[1].src, `/assets/map/${directory}/overview/${lastPage}_0.webp`);
  oldLoad();
  assert.equal(terrain.previews.has(tileKey(0)), false, 'Late stale callbacks cannot publish');
  assert.equal(terrain.overviewPending.size, 1);
  images[1].onload(); assert.equal(terrain.viewLoaded(), true);
});

test('zoom changes cancel overview loads before admitting native requests', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, 512), 0.16);
  terrain.setView(view(128, 256), 4);
  assert.equal(images[0].cancelled, true);
  assert.equal(images[1].src, `/assets/map/${directory}/native/0_${regionX + 1}_${regionY}.webp`);
  assert.equal(terrain.pending.size + terrain.overviewPending.size, 1);
});

test('zoom-out cancels pending detail even when its region and overview remain visible', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, 512), 0.16); images[0].onload();
  terrain.setView(view(128, 256), 4);
  terrain.setView(view(0, 512), 0.16);
  assert.equal(images[1].cancelled, true);
  assert.equal(terrain.pending.size, 0);
  assert.equal(images.length, 2, 'Loaded overview requires no replacement request');
});

test('bounded native page selection uses overview for other visible regions', t => {
  const columns = Math.min(47, SURFACE_GRID.columns), pages = Math.ceil(columns / 4);
  // The small independent grid uses the same bounded-page behavior with a
  // smaller cache; the reference grid retains its eight-page high-DPI cap.
  const pageBudget = Math.min(8, pages - 1);
  const { terrain, images } = fixture(t, { columns, cacheLimit: pages > 8 ? 256 : pageBudget * 16 });
  terrain.setView(view(0, columns * 128), 1, 2);
  assert.equal(terrain.nativePages.size, pageBudget);
  assert.equal(terrain.nativeKeys.size, pageBudget * 4);
  assert.equal(terrain.pending.size + terrain.queue.size, pageBudget * 4);
  assert.ok(images[0].src.includes('/native/'), 'Nearest native region precedes distant overview pages');
  assert.equal(terrain.overviewQueue.size, pages - pageBudget);
});

test('PNG viewport loads also cancel stale pans and start nearest to the centre', t => {
  const { terrain, images } = fixture(t, { optimized: false });
  terrain.setView(view(0, 640), 0.16);
  assert.equal(images[0].src, `/assets/map/terrain.cache-test/28/2/0_${regionX + 2}_${regionY}.png`);
  const lastColumn = Math.min(8, defaultColumns - 1);
  terrain.setView(view(lastColumn * 128, (lastColumn + 1) * 128), 0.16);
  assert.equal(images[0].cancelled, true);
  assert.equal(images[1].src, `/assets/map/terrain.cache-test/28/2/0_${regionX + lastColumn}_${regionY}.png`);
  assert.equal(terrain.queue.size, 0, 'No abandoned offscreen queue remains');
});

test('failed overview and unsupported WebP decode fall back to the original PNG source', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, 128), 0.16); images[0].onerror();
  assert.equal(images[1].src, `/assets/map/${directory}/native/0_${regionX + 0}_${regionY}.webp`);
  images[1].onerror();
  assert.equal(images[2].src, `/assets/map/terrain.cache-test/28/2/0_${regionX}_${regionY}.png`);
  images[2].onload();
  assert.equal(terrain.failed.size, 0);
  assert.equal(terrain.viewLoaded(), true);
});

test('overview fallback admits native regions nearest to the centre first', t => {
  const { terrain, images } = fixture(t);
  terrain.setView(view(0, 512), 0.16); images[0].onerror();
  assert.equal(images[1].src, `/assets/map/${directory}/native/0_${regionX + 1}_${regionY}.webp`);
});

test('manifest loader attaches optional optimized data and falls back when unavailable', async () => {
  const original = { schemaVersion: 1, terrain: {} }, bundle = { schemaVersion: 1, mapId: 28, plane: 0 };
  const fetcher = async route => ({ ok: true, json: async () => route.endsWith('terrain.optimized-manifest.json') ? bundle : { ...original } });
  assert.equal((await loadTerrainManifest(fetcher)).optimizedTerrain, bundle);
  assert.deepEqual(await loadTerrainManifest(async route => {
    if (route.endsWith('terrain.optimized-manifest.json')) throw new Error('Not installed');
    return { ok: true, json: async () => ({ ...original }) };
  }), original);
});

test('manifest loader never requests external hosts or accepts another map', async () => {
  const routes = [], result = await loadTerrainManifest(async route => {
    routes.push(route);
    return { ok: true, json: async () => route.endsWith('terrain.optimized-manifest.json')
      ? { schemaVersion: 1, mapId: 99, plane: 0 } : { schemaVersion: 1, terrain: {} } };
  });
  assert.deepEqual(routes.sort(), ['/assets/map/manifest.json', '/assets/map/terrain.optimized-manifest.json']);
  assert.equal(result.optimizedTerrain, undefined);
});

test('stalled optional optimized manifest aborts and releases the existing PNG fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const original = { schemaVersion: 1, terrain: {} };
  const result = loadTerrainManifest(async (route, options) => {
    if (route.endsWith('terrain.optimized-manifest.json')) {
      signal = options.signal; return new Promise(() => {});
    }
    return { ok: true, json: async () => original };
  });
  await Promise.resolve();
  assert.ok(signal, 'Optional request acknowledged before advancing its clock');
  t.mock.timers.tick(3000);
  assert.equal(await result, original);
  assert.equal(signal.aborted, true);
});

test('cold visible demand completes before whole-map overview idle work, which yields on a pan', t => {
  const { terrain, images, idle, stepIdle } = fixture(t, { background: true });
  terrain.setView(view(0, 128), 0.5);
  assert.equal(idle.size, 0);
  images[0].onload(); assert.equal(idle.size, 1);
  stepIdle(0); assert.equal(images.length, 1, 'An exhausted idle slice starts no network work');
  stepIdle(); assert.equal(images.length, 2); assert.equal(images[1].fetchPriority, 'low');
  assert.equal(terrain.backgroundImages.size, 1);
  terrain.setView(view((defaultColumns - 1) * 128, defaultColumns * 128), 4);
  assert.equal(images[1].cancelled, true);
  assert.equal(terrain.backgroundImages.size, 0);
  assert.ok(images[2].src.includes('/native/'), 'Visible native demand takes the freed slot immediately');
  assert.equal(idle.size, 0);
  images[2].onload(); assert.equal(terrain.viewLoaded(), true);
});

test('a pan promotes a matching speculative overview without duplicate downloads', t => {
  const { terrain, images, stepIdle } = fixture(t, { background: true });
  terrain.setView(view(0, 128), 0.5); images[0].onload(); stepIdle();
  const loading = images[1];
  terrain.setView(view(512, 640), 0.5);
  assert.equal(images.length, 2); assert.equal(loading.cancelled, undefined);
  assert.equal(loading.fetchPriority, 'high'); assert.equal(terrain.backgroundImages.size, 0);
  loading.onload(); assert.ok(terrain.committedKeys.has(tileKey(4)));
});

test('whole-map overview warming precedes adjacent native detail and obeys byte and cache budgets', t => {
  const { terrain, images, stepIdle } = fixture(t, { background: true, tileBytes: 600_000, cacheLimit: 2 });
  terrain.setView(view(128, 256), 0.5); images[0].onload();
  const pages = Math.ceil(defaultColumns / 4);
  for (let index = 1; index < pages; index++) {
    stepIdle(); assert.ok(images.at(-1).src.includes('/overview/'));
    assert.equal(terrain.backgroundImages.size, 1); images.at(-1).onload();
  }
  assert.equal(terrain.committedKeys.size, defaultColumns, 'Every region now has a coarse underlay');
  stepIdle(); assert.ok(images.at(-1).src.includes('/native/')); images.at(-1).onload();
  assert.equal(terrain.images.size, 1); assert.equal(terrain.backgroundBytes.native, 600_000);
  stepIdle(); assert.equal(images.length, pages + 1, 'The next tile would exceed the native byte budget');
  assert.ok(terrain.backgroundBytes.native <= TERRAIN_PREFETCH_BYTES);
  assert.ok(terrain.backgroundBytes.overview <= TERRAIN_OVERVIEW_BYTES);
});

test('native prefetch uses spare cache slots and does not poison later visible demand on failure', t => {
  const { terrain, images, stepIdle } = fixture(t, { background: true, cacheLimit: 2 });
  terrain.setView(view(128, 256), 0.5); images[0].onload();
  for (let index = 1; index < Math.ceil(defaultColumns / 4); index++) { stepIdle(); images.at(-1).onload(); }
  stepIdle(); const failed = images.at(-1); failed.onerror();
  assert.equal(terrain.failed.size, 0);
  stepIdle(); images.at(-1).onload(); stepIdle(); images.at(-1).onload();
  assert.equal(terrain.images.size, 2);
  const count = images.length; stepIdle(); assert.equal(images.length, count);
  terrain.setView(view(128, 256), 4);
  assert.equal(images.at(-1).src, failed.src, 'Foreground can retry a speculative failure');
  images.at(-1).onload(); assert.equal(terrain.images.size, 2);
  assert.ok(terrain.images.has(tileKey(1)), 'Cache eviction protects the current native view');
});

test('oversized or unpriced overview bundles never start unbounded background downloads', t => {
  for (const options of [{ background: false }, { background: true, pageBytes: TERRAIN_OVERVIEW_BYTES }]) {
    const { terrain, images, idle } = fixture(t, options);
    terrain.setView(view(0, 128), 0.5); images[0].onload();
    assert.equal(idle.size, 0); assert.equal(images.length, 1);
  }
});

test('disposal cancels speculative work and late completion cannot repopulate the terrain', t => {
  const { terrain, images, stepIdle, idle } = fixture(t, { background: true });
  terrain.setView(view(0, 128), 0.5); images[0].onload(); stepIdle();
  const late = images[1].onload;
  terrain.dispose(); late();
  assert.equal(images[1].cancelled, true); assert.equal(idle.size, 0);
  assert.equal(terrain.previews.size, 0); assert.equal(terrain.backgroundImages.size, 0);
});

test('an explicit chunk crop preempts speculation and promotes its own in-flight detail', t => {
  const { terrain, images, stepIdle } = fixture(t, { background: true });
  terrain.setView(view(128, 256), 0.5); images[0].onload();
  for (let index=1; index<Math.ceil(defaultColumns/4); index++) { stepIdle(); images.at(-1).onload(); }
  stepIdle(); const loading = images.at(-1), count = images.length;
  terrain.subscribeChunk(String((regionX+1)*SURFACE_GRID.stride+regionY), () => {});
  assert.equal(images.length, count); assert.equal(loading.fetchPriority, 'high');
  assert.equal(terrain.backgroundImages.size, 0);
  loading.onerror(); assert.ok(images.length > count, 'Foreground failure advances to the PNG source');
  images.at(-1).onload(); assert.ok(terrain.chunkImages.has(tileKey(1)));
});
