import test from 'node:test';
import assert from 'node:assert/strict';
import { MapTerrain } from '../app/web/map-terrain.mjs';
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
function fixture(t, { columns = defaultColumns, concurrency = 1, optimized = true, cacheLimit = 256 } = {}) {
  const regions = Array.from({ length: columns }, (_, index) => ({ x: regionX + index, y: regionY }));
  const manifest = { schemaVersion: 1, terrain: { mapId: 28, zoom: 2, plane: 0, tiles: [] },
    cacheTerrain: { mapId: 28, zoom: 2, plane: 0, directory: 'terrain.cache-test/28/2',
      iconFree: true, layoutComplete: true, transparentWater: true, oceanColour: [96, 118, 154],
      tiles: regions.map(region => ({ ...region, status: 'rendered', path: `terrain.cache-test/28/2/0_${region.x}_${region.y}.png` })) } };
  if (optimized) manifest.optimizedTerrain = { schemaVersion: 1, mapId: 28, plane: 0, tileSize: 256, directory,
    tiles: regions.map(region => ({ ...region, width: 256, height: 256, path: `${directory}/native/0_${region.x}_${region.y}.webp` })),
    pages: Array.from({ length: Math.ceil(columns / 4) }, (_, x) => ({ x, y: 0,
      left: x * 512, top: 0, width: 512, height: 512, pixelWidth: 256, pixelHeight: 256,
      path: `${directory}/overview/${x}_0.webp`, regions: regions.slice(x * 4, x * 4 + 4) })) };
  const images = [], terrain = new MapTerrain(manifest, { concurrency, cacheLimit, canvasFactory,
    imageFactory() { const image = { naturalWidth: 256, naturalHeight: 256,
      removeAttribute(name) { assert.equal(name, 'src'); this.cancelled = true; this.src = ''; } };
    images.push(image); return image; } });
  t.after(() => terrain.dispose());
  return { terrain, images, manifest };
}
const view = (left, right) => ({ left, right, top: 0, bottom: 128 });

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

test('stalled optional optimized manifest aborts and releases the existing PNG fallback', async () => {
  let signal;
  const original = { schemaVersion: 1, terrain: {} };
  const result = await loadTerrainManifest(async (route, options) => {
    if (route.endsWith('terrain.optimized-manifest.json')) {
      signal = options.signal; return new Promise(() => {});
    }
    return { ok: true, json: async () => original };
  }, { optimizedTimeoutMs: 5 });
  assert.equal(result, original);
  assert.equal(signal.aborted, true);
});
