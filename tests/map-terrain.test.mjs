import test from 'node:test';
import assert from 'node:assert/strict';
import { MapTerrain, TERRAIN_LEVELS, TERRAIN_OVERVIEW_MAX_ZOOM, terrainLevelForZoom, isBlankTerrainPixels } from '../app/web/map-terrain.mjs';
import { MapPinRenderer, PIN_MIN_ZOOM } from '../app/web/map-pin-renderer.mjs';

const manifest = tiles => ({ terrain: { mapId: 28, plane: 0, zoom: 2,
  tiles: tiles.map(([x, y]) => ({ x, y, path: `terrain/28/2/0_${x}_${y}.png`, status: 'downloaded' })) } });
const bounds = { left: 0, top: 0, right: 256, bottom: 128 };

const cacheTerrain = tiles => ({ mapId: 28, plane: 0, zoom: 2, iconFree: true,
  directory: 'terrain.cache-test-v1/28/2',
  tiles: tiles.map(([x, y]) => ({ x, y, path: `terrain.cache-test-v1/28/2/0_${x}_${y}.png`, status: 'rendered' })) });

const oceanFallback = regions => ({ version: 1, mapId: 28, plane: 0,
  method: 'uniform-legacy-water-without-cache-surface', colour: [96, 118, 154],
  regions: regions.map(([x, y]) => ({ x, y })), legacyLandRegions: [] });
const recordedCanvas = (width, height) => {
  const calls = [], fills = [], ctx = { drawImage: (...args) => calls.push(args), clearRect() {},
    fillRect(...args) { fills.push({ colour: this.fillStyle, args }); } };
  return { width, height, calls, fills, getContext: () => ctx };
};

test('verified uncovered ocean replaces legacy water in overview and clipped native underlays', t => {
  const terrain = new MapTerrain({ cacheTerrain: cacheTerrain([]), oceanFallback: oceanFallback([[29, 71]]) }, {
    canvasFactory: recordedCanvas, fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 } });
  t.after(() => terrain.dispose());
  assert.equal(terrain.levels.size, 4, 'An ocean-only manifest can compose its base');
  const largest = terrain.levels.get(0.5);
  assert.deepEqual(largest.colour.fills, [{ colour: 'rgb(96,118,154)', args: [0, 0, 64, 64] }]);
  assert.equal(largest.gray.calls[0][0], largest.colour, 'Grayscale derives from the water-filled colour base');
  const clip = recordedCanvas(256, 256);
  terrain.paintLegacyRegion(clip.getContext('2d'), 64, 32, 128, 64, 10, 20, 256, 128);
  assert.deepEqual(clip.fills, [{ colour: 'rgb(96,118,154)', args: [10, 20, 128, 128] }]);
  terrain.nativePages.add('0,0');
  const page = terrain.nativePage('0,0');
  assert.deepEqual(page.colour.fills, [{ colour: 'rgb(96,118,154)', args: [0, 0, 256, 256] }]);
});

test('cache surface presence including empty floors and any legacy land classification veto ocean fill', t => {
  const data = { cacheTerrain: cacheTerrain([[29, 71]]), oceanFallback: oceanFallback([[29, 71], [30, 71], [31, 71]]) };
  data.cacheTerrain.tiles[0].status = 'empty';
  data.oceanFallback.legacyLandRegions = [{ x: 30, y: 71 }];
  const terrain = new MapTerrain(data, { canvasFactory: recordedCanvas,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 } });
  t.after(() => terrain.dispose());
  assert.deepEqual([...terrain.oceanKeys], ['31,71']);
  assert.deepEqual(terrain.levels.get(0.5).colour.fills[0].args, [128, 0, 64, 64]);
});

test('ocean classification never replaces a pending or successful community PNG', t => {
  const images = [], terrain = new MapTerrain({ ...manifest([[29, 71]]), cacheTerrain: cacheTerrain([]),
    oceanFallback: oceanFallback([[29, 71]]) }, { canvasFactory: recordedCanvas,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 },
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; } });
  t.after(() => terrain.dispose());
  assert.equal(terrain.levels.get(0.5).colour.fills.length, 0);
  terrain.setView(bounds, 1); images[0].onload();
  assert.equal(terrain.failed.size, 0);
  assert.equal(terrain.pages.get('0,0').colour.fills.length, 0);
});

test('exhausted community failure in proven ocean publishes flat water while protected failures retain the image', t => {
  const images = [], terrain = new MapTerrain({ ...manifest([[29, 71], [30, 71]]), cacheTerrain: cacheTerrain([]),
    oceanFallback: oceanFallback([[29, 71]]) }, { canvasFactory: recordedCanvas,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 },
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; } });
  t.after(() => terrain.dispose());
  terrain.setView(bounds, 1); for (const image of images) image.onerror();
  assert.ok(terrain.failed.has('29,71') && terrain.failed.has('30,71'));
  assert.deepEqual(terrain.previews.get('29,71').fills[0], { colour: 'rgb(96,118,154)', args: [0, 0, 64, 64] });
  assert.equal(terrain.previews.has('30,71'), false);
  assert.ok(terrain.committedKeys.has('29,71'));
  assert.deepEqual(terrain.pages.get('0,0').colour.fills[0].args, [0, 0, 256, 256]);
});

test('community terrain wins, cache terrain fills missing slots, then the old image covers failures', () => {
  const images = [];
  const data = { ...manifest([[29, 71]]), cacheTerrain: cacheTerrain([[29, 71], [30, 71]]) };
  const terrain = new MapTerrain(data, { concurrency: 1,
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; } });
  terrain.setView({ ...bounds, right: 128 }, 1);
  assert.equal(images[0].src, '/assets/map/terrain/28/2/0_29_71.png');
  images[0].onerror();
  assert.equal(images[1].src, '/assets/map/terrain.cache-test-v1/28/2/0_29_71.png');
  assert.equal(terrain.failed.has('29,71'), false, 'a slot stays pending while its cache source loads');
  images[1].onload();
  terrain.setView({ left: 128, top: 0, right: 256, bottom: 128 }, 1);
  assert.equal(images[2].src, '/assets/map/terrain.cache-test-v1/28/2/0_30_71.png');
  images[2].onerror();
  assert.equal(terrain.failed.has('30,71'), true);
  const fallback = [];
  terrain.draw({ drawImage() {} }, bounds, { zoom: 1, offset: { x: 0, y: 0 }, fallback: (...args) => fallback.push(args) });
  assert.equal(fallback.length, 1);
  terrain.dispose();
});

test('valid community artwork never loads its lower priority cache source', () => {
  const images = [];
  const terrain = new MapTerrain({ ...manifest([[29, 71]]), cacheTerrain: cacheTerrain([[29, 71]]) }, {
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; } });
  terrain.setView(bounds, 1); images[0].onload(); terrain.setView(bounds, 1);
  assert.equal(images.length, 1);
  assert.equal(terrain.tiles.get('29,71').path, 'terrain/28/2/0_29_71.png');
  terrain.dispose();
});

test('black community placeholders advance to cache without publishing a failed slot', () => {
  const images = [], changes = [];
  const black = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  const valid = black.slice(); valid.fill(80);
  const terrain = new MapTerrain({ ...manifest([[29, 71]]), cacheTerrain: cacheTerrain([[29, 71]]) }, {
    changed: () => changes.push(true),
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    canvasFactory(width, height) {
      let painted;
      const ctx = { clearRect() {}, drawImage: image => { painted = image; },
        getImageData: () => ({ data: painted.src?.includes('/terrain/28/') ? black : valid }) };
      return { width, height, getContext: () => ctx };
    },
  });
  terrain.setView({ ...bounds, right: 128 }, 1);
  images[0].onload();
  assert.equal(images.length, 2);
  assert.equal(terrain.previews.size, 0);
  assert.equal(terrain.failed.size, 0);
  assert.ok(terrain.unreadyVisible.has('29,71'));
  assert.ok(images[1].src.includes('/terrain.cache-test-v1/'));
  images[1].onload();
  assert.equal(terrain.previews.size, 1);
  assert.equal(terrain.failed.size, 0);
  terrain.dispose();
});

test('cache-only manifests work and unsafe or icon-bearing cache sources are ignored', () => {
  const valid = { cacheTerrain: cacheTerrain([[29, 71]]) };
  const terrain = new MapTerrain(valid);
  assert.equal(terrain.tiles.size, 1); terrain.dispose();
  for (const patch of [{ iconFree: false }, { directory: '../terrain.cache-test-v1/28/2' },
    { plane: 1 }, { zoom: 3 }, { mapId: 29 }]) {
    const rejected = new MapTerrain({ cacheTerrain: { ...valid.cacheTerrain, ...patch } });
    assert.equal(rejected.tiles.size, 0); rejected.dispose();
  }
});

test('terrain uses north-positive filenames and clips partial chunk rectangles exactly', () => {
  const images = [], changed = [];
  const terrain = new MapTerrain(manifest([[29, 71]]), { changed: () => changed.push(true),
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; } });
  terrain.setView(bounds, 1);
  assert.equal(images[0].src, '/assets/map/terrain/28/2/0_29_71.png');
  images[0].onload();
  assert.equal(changed.length, 1);
  const drawn = [], fallback = [];
  terrain.draw({ drawImage: (...args) => drawn.push(args) }, { left: 64, top: 32, right: 192, bottom: 96 },
    { offset: { x: 10, y: 20 }, zoom: 2, fallback: (...args) => fallback.push(args.slice(1)) });
  assert.deepEqual(drawn[0].slice(1), [128, 64, 128, 128, 138, 84, 128, 128]);
  assert.deepEqual(fallback, [[64, 32, 192, 96]], 'one underlay covers gaps AND transparent areas of loaded tiles');
  terrain.dispose();
});

test('failed tiles settle on legacy fallback; concurrent requests and native memory are bounded', () => {
  const images = [];
  const terrain = new MapTerrain(manifest([[29, 71], [30, 71], [31, 71], [32, 71]]), {
    cacheLimit: 2, concurrency: 1, imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; } });
  const view = { ...bounds, right: 512 };
  terrain.setView(view, 1);
  assert.equal(images.length, 1);
  images[0].onerror();
  assert.equal(images.length, 2);
  for (let i = 1; i < images.length; i++) images[i].onload();
  assert.equal(images.length, 4);
  assert.ok(terrain.images.size <= 2);
  const before = images.length;
  terrain.setView(view, 1);
  assert.equal(images.length, before, 'Known failed and preview tiles are not downloaded again');
  terrain.dispose();
});

test('terrain rejects other map versions and paths outside the local crop', () => {
  const data = manifest([[29, 71], [28, 71], [29, 72]]);
  data.terrain.tiles.push({ x: 30, y: 71, path: 'https://example.com/terrain.png' });
  const terrain = new MapTerrain(data);
  assert.equal(terrain.tiles.size, 1);
  assert.equal(new MapTerrain({ terrain: { ...data.terrain, zoom: 3 } }).tiles.size, 0);
  terrain.dispose();
});

test('overview levels track density and keep high-DPI overviews bounded', () => {
  assert.deepEqual(TERRAIN_LEVELS, [0.0625, 0.125, 0.25, 0.5]);
  assert.equal(terrainLevelForZoom(0.055), 0.0625);
  assert.equal(terrainLevelForZoom(0.1), 0.125);
  assert.equal(terrainLevelForZoom(0.13), 0.25);
  assert.equal(terrainLevelForZoom(0.35), 0.5);
  assert.equal(terrainLevelForZoom(0.35, 2), 0.5);
  assert.equal(terrainLevelForZoom(0.5, 3), 0.5);
  assert.equal(TERRAIN_OVERVIEW_MAX_ZOOM, 0.75);
  assert.equal(terrainLevelForZoom(0.55), 0.5);
  assert.equal(terrainLevelForZoom(0.75), 0.5);
  assert.equal(terrainLevelForZoom(0.75, 3), 0.5);
  assert.equal(terrainLevelForZoom(0.751), null);
  assert.equal(terrainLevelForZoom(4), null);
});

test('near-empty opaque black placeholders fall back while transparency and normal black artwork survive', () => {
  const placeholder = new Uint8ClampedArray(400);
  for (let i = 0; i < 100; i++) placeholder[i * 4 + 3] = i < 68 ? 255 : 0;
  placeholder.set([0, 30, 60, 255], 396);
  assert.equal(isBlankTerrainPixels(placeholder), true, 'conservative analogue of real tile 63,56');
  assert.equal(isBlankTerrainPixels(new Uint8ClampedArray(400)), false, 'alpha holes use the original-image underlay');
  const roof = placeholder.slice();
  for (let i = 0; i < 10; i++) roof.set([40, 60, 80, 255], i * 4);
  assert.equal(isBlankTerrainPixels(roof), false, 'ordinary dark roofs are retained');
});

test('loaded tiles paint on the legacy underlay; mips preserve that order and late fallback initialization', () => {
  const canvases = [];
  const canvasFactory = (width, height) => {
    const calls = [], ctx = { drawImage: (...args) => calls.push(args), clearRect() {},
      getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) };
    const canvas = { width, height, calls, getContext: () => ctx }; canvases.push(canvas); return canvas;
  };
  const image = { naturalWidth: 256, naturalHeight: 256 };
  const terrain = new MapTerrain(manifest([[29, 71]]), { canvasFactory, imageFactory: () => image });
  terrain.setView(bounds, 0.1); image.onload();
  const legacy = { naturalWidth: 6016, naturalHeight: 6400 };
  terrain.setFallback(legacy);
  const largest = terrain.levels.get(0.5);
  for (const [scale, level] of terrain.levels) for (const mode of ['colour', 'gray']) {
    const canvas = level[mode], underlay = scale === 0.5 ? mode === 'colour' ? legacy : largest.colour : largest[mode];
    const legacyIndex = canvas.calls.findIndex(args => args[0] === underlay);
    assert.ok(legacyIndex >= 0, 'each level copies the original underlay before alpha tiles');
    assert.equal(canvas.calls[legacyIndex + 1][0], terrain.previews.get('29,71'), 'alpha preview overlays late original fallback');
  }
  const calls = [];
  terrain.draw({ drawImage: (...args) => calls.push(args) }, bounds, {
    offset: { x: 0, y: 0 }, zoom: 0.1, fallback: () => assert.fail('composed overview has its own underlay'),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], terrain.levels.get(0.125).colour);
  terrain.dispose();
});

test('panning protects visible native images before offscreen FIFO entries are evicted', () => {
  const images = [];
  const terrain = new MapTerrain(manifest([[29, 71], [30, 71], [31, 71]]), {
    cacheLimit: 2, concurrency: 1, imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
  });
  terrain.setView(bounds, 1); images[0].onload(); images[1].onload();
  terrain.setView({ left: 0, top: 0, right: 128, bottom: 128 }, 1);
  terrain.setView({ left: 0, top: 0, right: 384, bottom: 128 }, 1);
  // Directly load the new viewport edge; the recently-visible tile must survive.
  terrain.nativeKeys = new Set(['29,71', '31,71']); terrain.request('31,71'); images.at(-1).onload();
  assert.ok(terrain.images.has('29,71'));
  assert.ok(terrain.images.has('31,71'));
  assert.equal(terrain.images.has('30,71'), false);
  terrain.dispose();
});

test('native terrain pages bound draws and memory and dispose their backing stores', () => {
  const calls = [], images = [];
  const canvasFactory = (width, height) => {
    const canvasCalls = [];
    return { width, height, calls: canvasCalls, getContext: () => ({
      drawImage(...args) { calls.push(args); canvasCalls.push(args); }, clearRect() {},
    }) };
  };
  const tiles = [];
  for (let x = 29; x < 41; x++) for (let y = 68; y <= 71; y++) tiles.push([x, y]);
  const terrain = new MapTerrain(manifest(tiles), { canvasFactory, cacheLimit: 32,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 },
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
  });
  const view = { left: 0, top: 0, right: 1536, bottom: 512 };
  terrain.setView(view, 1);
  for (let i = 0; i < images.length; i++) images[i].onload();
  const pages = [...terrain.pages.values()];
  assert.equal(pages.length, 2); assert.ok(terrain.images.size <= 32);
  assert.ok(pages.every(page => page.colour.calls.some(args => images.includes(args[0])
    && args.length === 5 && args[3] === 256 && args[4] === 256)), 'Both native pages receive full-resolution tile paint');
  const drawn = [];
  terrain.draw({ drawImage: (...args) => drawn.push(args) }, view, {
    offset: { x: 0, y: 0 }, zoom: 1, desaturated: true, fallback: () => assert.fail('native pages have a composed underlay'),
  });
  assert.equal(drawn.length, 3, 'one overview plus both native pages');
  assert.equal(drawn[0][0], terrain.levels.get(0.5).gray);
  assert.ok(drawn.slice(1).every(args => pages.some(page => page.gray === args[0])));
  terrain.dispose(); assert.equal(terrain.pages.size, 0);
  assert.ok(pages.every(page => page.colour.width === 0 && page.gray.width === 0));
});

function queuedTerrain(t, options = {}) {
  const frames = new Map(), cancelled = [], canvases = [], images = [], changes = [];
  let nextFrame = 0;
  const tiles = [];
  for (let x = 29; x < 45; x++) for (let y = 68; y <= 71; y++) tiles.push([x, y]);
  const terrain = new MapTerrain(manifest(options.tiles ?? tiles), { cacheLimit: 48,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 },
    canvasFactory(width, height) {
      const calls = [], ctx = { drawImage: (...args) => calls.push(args), clearRect() {} };
      const canvas = { width, height, calls, getContext: () => ctx }; canvases.push(canvas); return canvas;
    },
    imageFactory() { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    changed: () => changes.push(true),
    requestFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelFrame(frame) { cancelled.push(frame); frames.delete(frame); },
    ...options,
  });
  t.after(() => terrain.dispose());
  const step = () => {
    assert.equal(frames.size, 1, 'Page composition has only one outstanding callback');
    const [id, callback] = frames.entries().next().value; frames.delete(id); callback();
  };
  const loadAll = () => {
    for (let i = 0; i < images.length; i++) images[i].onload?.();
  };
  const flush = () => {
    for (let i = 0; frames.size; i++) {
      assert.ok(i < 100, 'Composition must settle'); step();
    }
  };
  return { terrain, frames, cancelled, canvases, images, changes, step, loadAll, flush };
}

test('native pages compose one per queued frame while drawing uses the composed overview', t => {
  const { terrain, frames, canvases, images, changes, step } = queuedTerrain(t);
  const view = { left: 0, top: 0, right: 1536, bottom: 512 };
  terrain.setView(view, 1);
  assert.equal(frames.size, 0, 'Loading cannot start composing pages');
  changes.length = 0;
  const originalMips = [...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]);
  for (let i = 0; i < images.length; i++) {
    images[i].onload();
    assert.equal(changes.length, 0, 'No partial native viewport publishes');
    assert.deepEqual([...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]), originalMips);
  }
  assert.equal(terrain.nativePages.size, 3);
  assert.equal(terrain.pageQueue.size, 3);
  assert.equal(terrain.pages.size, 0, 'Decoded tiles queue a missing page without constructing it');
  assert.equal(terrain.pageWorkScheduled, true);
  assert.ok(frames.has(terrain.updateFrame));
  changes.length = 0;
  const draw = desaturated => {
    const before = canvases.length, calls = [];
    terrain.draw({ drawImage: (...args) => calls.push(args) }, view, { zoom: 1, offset: { x: 0, y: 0 }, desaturated,
      fallback: () => assert.fail('The composed overview fills missing native pages') });
    assert.equal(canvases.length, before, 'Drawing never allocates or composes missing pages');
    assert.equal(calls[0][0], terrain.levels.get(0.5)[desaturated ? 'gray' : 'colour']);
    return calls;
  };
  assert.equal(draw(false).length, 1, 'Full-colour reveal remains available before native composition');
  assert.equal(draw(true).length, 1, 'Locked terrain has the same immediate overview fallback');
  assert.equal(terrain.pageQueue.size, 3, 'Repeated draws do not duplicate queued page work');

  for (let composed = 1; composed <= 6; composed++) {
    const before = canvases.length;
    step();
    assert.equal(canvases.length, before + 2, 'One callback allocates exactly one colour/gray page pair');
    assert.equal(terrain.pages.size, composed === 6 ? 3 : 0, 'Front pages publish with the complete mip patch batch');
    assert.equal(terrain.stagedPages.size, composed === 6 ? 0 : Math.min(3, composed));
    assert.equal(terrain.stagedPreviews.size, composed === 6 ? 0 : Math.max(0, composed - 3));
    assert.equal(terrain.pageQueue.size, Math.max(0, 3 - composed));
    assert.equal(changes.length, composed === 6 ? 1 : 0, 'Only the complete terrain batch notifies terrain/reveal layers');
    if (composed < 6) assert.deepEqual([...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]), originalMips, 'Staging never changes front mip bitmaps');
    for (const desaturated of [false, true]) {
      const calls = draw(desaturated);
      assert.equal(calls.length, composed === 6 ? 4 : 1);
      assert.ok(calls.slice(1).every(args => [...terrain.pages.values()].some(page => page[desaturated ? 'gray' : 'colour'] === args[0])));
    }
  }
  assert.equal(frames.size, 0);
  assert.equal(terrain.updateFrame, null);
  assert.equal(terrain.pageWorkScheduled, false);
});

test('pans discard obsolete page work, overview cancels staged content, and disposal cancels the frame', t => {
  const { terrain, frames, cancelled, canvases, changes, step, loadAll, flush } = queuedTerrain(t);
  const first = { left: 0, top: 0, right: 1536, bottom: 512 };
  const moved = { left: 1536, top: 0, right: 2048, bottom: 512 };
  terrain.setView(first, 1);
  assert.equal(terrain.pageQueue.size, 3);
  loadAll(); step();
  const abandoned = [...terrain.stagedPages.values()];
  terrain.setView(moved, 1);
  assert.ok(abandoned.every(page => page.colour.width === 0 && page.gray.width === 0));
  assert.deepEqual([...terrain.pageQueue], ['3,0'], 'Pending work follows the new viewport before its callback runs');
  loadAll();
  changes.length = 0;
  flush();
  assert.deepEqual([...terrain.pages.keys()], ['3,0'], 'No obsolete viewport page was composed');
  assert.equal(changes.length, 1);

  terrain.setView(first, 1);
  assert.equal(terrain.pageQueue.size, 3);
  loadAll(); step();
  const overviewAbandoned = [...terrain.stagedPages.values()];
  terrain.setView(first, 0.5);
  assert.ok(overviewAbandoned.every(page => page.colour.width === 0 && page.gray.width === 0));
  assert.equal(terrain.pageQueue.size, 0);
  flush();
  assert.deepEqual([...terrain.pages.keys()], ['3,0'], 'Overview completes mip patches without composing obsolete native pages');
  assert.ok(changes.length >= 1);
  assert.equal(terrain.pageWorkScheduled, false);
  assert.equal(terrain.updateFrame, null);

  terrain.setView(first, 1); step();
  const frame = terrain.updateFrame, callback = frames.get(frame), pages = [...terrain.pages.values(), ...terrain.stagedPages.values()];
  assert.ok(callback);
  assert.equal(terrain.pageQueue.size, 2);
  const changesBeforeDispose = changes.length, allocationsBeforeDispose = canvases.length;
  terrain.dispose();
  assert.ok(cancelled.includes(frame));
  assert.equal(frames.size, 0);
  assert.equal(terrain.updateFrame, null);
  assert.equal(terrain.pageWorkScheduled, false);
  assert.equal(terrain.pageQueue.size, 0);
  assert.ok(pages.every(page => page.colour.width === 0 && page.gray.width === 0));
  callback();
  assert.equal(changes.length, changesBeforeDispose, 'Even an already-delivered callback cannot notify after disposal');
  assert.equal(canvases.length, allocationsBeforeDispose);
});

test('high-density views select eight central native pages while preserving the full overview and storage bound', t => {
  const frames = new Map(), tiles = [], loads = [];
  let nextFrame = 0;
  for (let column = 0; column < 24; column++) for (let row = 0; row < 24; row++) tiles.push([29 + column, 71 - row]);
  const terrain = new MapTerrain(manifest(tiles), { cacheLimit: 256,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 },
    canvasFactory(width, height) { return { width, height, getContext: () => ({ drawImage() {}, clearRect() {} }) }; },
    imageFactory() { const image = { naturalWidth: 256, naturalHeight: 256 }; loads.push(image); return image; },
    requestFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelFrame(frame) { frames.delete(frame); },
  });
  t.after(() => terrain.dispose());
  const view = { left: 0, top: 0, right: 3072, bottom: 3072 }, zoom = 0.751;
  const centre = 1536;
  // Compare each page's closest tile centre with the viewport centre. Ties may
  // select either neighbour; a farther page must never displace a nearer one.
  const distance = key => {
    const [column, row] = key.split(',').map(Number);
    const nearestX = Math.max(column * 512 + 64, Math.min(column * 512 + 448, centre));
    const nearestY = Math.max(row * 512 + 64, Math.min(row * 512 + 448, centre));
    return Math.hypot(nearestX - centre, nearestY - centre);
  };
  terrain.setView(view, zoom, 1);
  const normalPages = [...terrain.nativePages];
  assert.equal(normalPages.length, 16);
  assert.equal(terrain.pageLimit, 16);
  assert.equal(terrain.cacheLimit, 256);
  assert.equal(frames.size, 0, 'No page composition before visible terrain settles');
  assert.equal(loads.length, 6, 'Initial image loading is bounded');
  for (let i = 0; i < loads.length; i++) loads[i].onload();
  while (frames.size) {
    const [id, callback] = frames.entries().next().value; frames.delete(id); callback();
  }
  assert.equal(terrain.pages.size, 16, 'Normal-density composition fills the original storage budget');
  assert.equal(loads.length, tiles.length, 'All visible images settle before the native page batch');

  for (const dpr of [1.5, 2]) {
    terrain.setView(view, zoom, dpr);
    const active = [...terrain.nativePages];
    assert.equal(active.length, 8);
    assert.deepEqual(active, normalPages.slice(0, 8), 'Density budget keeps the nearest selected pages');
    const outside = [];
    for (let column = 0; column < 6; column++) for (let row = 0; row < 6; row++) {
      const key = `${column},${row}`; if (!terrain.nativePages.has(key)) outside.push(key);
    }
    assert.ok(Math.max(...active.map(distance)) <= Math.min(...outside.map(distance)), 'Native detail is concentrated nearest the viewport centre');
    assert.equal(terrain.pageLimit, 16);
    assert.equal(terrain.cacheLimit, 256);
    assert.equal(terrain.pages.size, 16, 'Limiting active draws does not lower the retained page cache bound');
    assert.equal(frames.size, 0, 'Already-composed central pages need no new work');
    for (const desaturated of [false, true]) {
      const calls = [], offset = { x: 10, y: 20 };
      terrain.draw({ drawImage: (...args) => calls.push(args) }, view, { offset, zoom, dpr, desaturated,
        fallback: () => assert.fail('The composed overview must cover outer regions') });
      assert.equal(calls.length, 9, 'One full overview and at most eight native page draws per layer');
      assert.equal(calls[0][0], terrain.levels.get(0.5)[desaturated ? 'gray' : 'colour']);
      assert.deepEqual(calls[0].slice(1), [0, 0, 1536, 1536, 10, 20, 3072 * zoom, 3072 * zoom], 'Overview covers the entire viewport bounds before native detail');
      assert.ok(calls.slice(1).every(args => active.some(key => terrain.pages.get(key)[desaturated ? 'gray' : 'colour'] === args[0])));
    }
  }
});

test('nearly uniform opaque water is retained and drawn as terrain', t => {
  const water = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < water.length; i += 4) water.set([96, 118, 154, 255], i);
  water.set([115, 92, 49, 255], water.length - 4);
  assert.equal(isBlankTerrainPixels(water), false, 'Ocean colour from tile 49,48 is valid artwork');
  const { terrain, images, loadAll, flush } = queuedTerrain(t, {
    tiles: [[49, 48]],
    canvasFactory(width, height) {
      const calls = [], ctx = { drawImage: (...args) => calls.push(args), clearRect() {}, getImageData: () => ({ data: water }) };
      return { width, height, calls, getContext: () => ctx };
    },
  });
  terrain.setView({ left: 2560, top: 2944, right: 2688, bottom: 3072 }, 1);
  loadAll(); flush();
  assert.equal(terrain.failed.has('49,48'), false);
  assert.ok(terrain.pages.get('5,5').colour.calls.some(args => args[0] === images[0]));
});

test('cold overview requests begin centrally and publish all previews once', t => {
  const { terrain, images, changes, frames, canvases, step } = queuedTerrain(t, { tiles: [[29, 71], [30, 71], [31, 71], [32, 71], [33, 71]], concurrency: 1 });
  const view = { left: 0, top: 0, right: 640, bottom: 128 };
  changes.length = 0;
  const mipCounts = [...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]);
  terrain.setView(view, 0.5);
  assert.ok(images[0].src.endsWith('0_31_71.png'), 'The first overview request is at the viewport centre');
  assert.equal(terrain.queue.size, 4, 'Remaining desired loads are already enqueued');
  for (let i = 0; i < 4; i++) {
    images[i].onload();
    assert.equal(changes.length, 0, 'Individual decoded tiles never notify');
    assert.deepEqual([...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]), mipCounts, 'Front mip bitmaps remain unchanged');
    assert.equal(terrain.committedKeys.size, 0);
  }
  images[4].onload();
  assert.equal(changes.length, 0);
  assert.equal(frames.size, 1, 'Decoded overview queues composition outside viewport drawing');
  const allocations = canvases.length, draws = [];
  terrain.draw({ drawImage: (...args) => draws.push(args) }, view, { zoom: 0.5, offset: { x: 0, y: 0 }, fallback() { assert.fail(); } });
  assert.equal(canvases.length, allocations, 'Drawing does not allocate patches');
  assert.equal(draws.length, 1);
  step();
  assert.equal(terrain.stagedPreviews.size, 1);
  assert.equal(changes.length, 0);
  assert.deepEqual([...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]), mipCounts);
  step();
  assert.equal(changes.length, 1);
  assert.equal(terrain.committedKeys.size, 5);
  assert.equal(terrain.unpublishedKeys.size, 0);
});

test('colour and gray underlays remain available before any native terrain loads', t => {
  const { terrain, frames } = queuedTerrain(t, { tiles: [[29, 71], [30, 71]] });
  terrain.setView(bounds, 1);
  assert.equal(frames.size, 0);
  for (const desaturated of [false, true]) {
    const calls = [];
    terrain.draw({ drawImage: (...args) => calls.push(args) }, bounds, {
      zoom: 1, offset: { x: 0, y: 0 }, desaturated, fallback: () => assert.fail('Base mip already contains the original'),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], terrain.levels.get(0.5)[desaturated ? 'gray' : 'colour']);
  }
});

test('overview arrivals and new native keys refresh a previously cached page atomically', t => {
  const { terrain, images, changes, loadAll, flush } = queuedTerrain(t, { tiles: [[29, 71], [30, 71]] });
  const left = { left: 0, top: 0, right: 128, bottom: 128 }, right = { left: 128, top: 0, right: 256, bottom: 128 };
  terrain.setView(left, 1); loadAll(); flush();
  const original = terrain.pages.get('0,0');
  terrain.setView(right, 0.5); loadAll(); flush();
  assert.ok(terrain.committedKeys.has('30,71'));
  assert.equal(terrain.pages.get('0,0'), original, 'Cached detail remains stable while outside the native view');
  changes.length = 0;
  terrain.setView(right, 1);
  assert.equal(terrain.pages.get('0,0'), original, 'Old front page stays visible while a native image is pending');
  assert.equal(changes.length, 0);
  loadAll();
  assert.equal(terrain.pages.get('0,0'), original, 'Decoded detail waits for page composition');
  flush();
  const refreshed = terrain.pages.get('0,0');
  assert.notEqual(refreshed, original);
  assert.equal(original.colour.width, 0);
  assert.ok(refreshed.nativeKeys.has('30,71'));
  assert.ok(refreshed.colour.calls.some(args => args[0] === terrain.previews.get('30,71')));
  assert.ok(refreshed.colour.calls.some(args => args[0] === images.at(-1)));
  assert.equal(changes.length, 1);
});

test('fallback changes release staged pages and preserve unpublished previews until replacement completes', t => {
  const { terrain, changes, loadAll, step, flush } = queuedTerrain(t);
  terrain.setView({ left: 0, top: 0, right: 1536, bottom: 512 }, 1);
  loadAll(); for (let i = 0; i < 4; i++) step();
  const abandoned = [...terrain.stagedPages.values(), ...terrain.stagedPreviews.values()];
  assert.equal(abandoned.length, 4);
  assert.equal(terrain.committedKeys.size, 0);
  const replacement = { naturalWidth: 6016, naturalHeight: 6400 };
  terrain.setFallback(replacement);
  assert.ok(abandoned.every(page => page.colour.width === 0 && page.gray.width === 0));
  assert.equal(terrain.stagedPages.size, 0);
  assert.equal(terrain.stagedPreviews.size, 0);
  assert.equal(terrain.pages.size, 0);
  const largest = terrain.levels.get(0.5).colour;
  assert.equal(largest.calls.at(-1)[0], replacement, 'Decoded but unpublished previews do not leak into the new base');
  changes.length = 0; flush();
  assert.equal(terrain.pages.size, 3);
  assert.equal(changes.length, 1);
  assert.ok([...terrain.pages.values()].every(page => page.colour.calls[0][0] === replacement));
});

test('native detail arriving during staged composition cannot publish an obsolete page', t => {
  const { terrain, images, changes, loadAll, step, flush } = queuedTerrain(t, { tiles: [[29, 71], [30, 71], [31, 71], [33, 71]] });
  // Two pages let a late decode arrive while the first replacement is staged.
  terrain.setView({ left: 0, top: 0, right: 640, bottom: 128 }, 1);
  loadAll(); step();
  const staged = [...terrain.stagedPages.values()][0];
  assert.ok(staged);
  const key = staged.left === 0 ? '31,71' : '33,71';
  // Drop only the retained native image so the same decoded preview can acquire
  // sharper detail while another page is still being composed.
  terrain.images.delete(key);
  terrain.request(key);
  changes.length = 0;
  images.at(-1).onload();
  assert.equal(changes.length, 0);
  flush();
  assert.equal(changes.length, 1);
  for (const [pageKey, page] of terrain.pages) assert.equal(page.version, terrain.pageVersions.get(pageKey));
  assert.equal(staged.colour.width, 0, 'The obsolete staged bitmap is released');
});

test('an offscreen completion invalidates a staged mip patch before the final publication', t => {
  const { terrain, images, changes, loadAll, step, flush } = queuedTerrain(t, { tiles: [[29, 71], [33, 71], [29, 70]] });
  const view = { left: 0, top: 0, right: 640, bottom: 128 };
  terrain.setView(view, 0.5); loadAll(); step();
  const [pageKey, abandoned] = [...terrain.stagedPreviews][0];
  assert.equal(pageKey, '0,0');
  const mipCounts = [...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]);
  changes.length = 0;
  terrain.request('29,70'); images.at(-1).onload();
  assert.equal(abandoned.colour.width, 0, 'The old patch is released when its page changes');
  assert.equal(changes.length, 0);
  assert.deepEqual([...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]), mipCounts);
  const replacementPatches = [];
  while (terrain.previewQueue.size) {
    step(); replacementPatches.push(...terrain.stagedPreviews.values());
  }
  assert.equal(changes.length, 1);
  assert.ok(terrain.committedKeys.has('29,70'), 'The final batch includes the late offscreen tile');
  assert.ok(replacementPatches.every(page => page.colour.width === 0 && page.gray.width === 0), 'Published patch backing stores are released');
  assert.equal(terrain.stagedPreviews.size, 0);
  const after = [...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]);
  terrain.setView(view, 0.5); flush();
  assert.equal(changes.length, 1, 'Warm redraws do not republish an old patch');
  assert.deepEqual([...terrain.levels.values()].flatMap(level => [level.colour.calls.length, level.gray.calls.length]), after);
});

test('disposing a queued overview patch releases staging and prevents future mip paint', t => {
  const { terrain, frames, canvases, changes, loadAll, step } = queuedTerrain(t, { tiles: [[29, 71], [33, 71]] });
  terrain.setView({ left: 0, top: 0, right: 640, bottom: 128 }, 0.5);
  loadAll(); step();
  const staged = [...terrain.stagedPreviews.values()];
  assert.equal(staged.length, 1);
  const callback = frames.get(terrain.updateFrame);
  assert.ok(callback);
  const mips = [...terrain.levels.values()].flatMap(level => [level.colour, level.gray]);
  const counts = mips.map(canvas => canvas.calls.length), allocations = canvases.length, notifications = changes.length;
  terrain.dispose(); callback();
  assert.ok(staged.every(page => page.colour.width === 0 && page.gray.width === 0));
  assert.equal(terrain.stagedPreviews.size, 0);
  assert.equal(terrain.previewQueue.size, 0);
  assert.equal(terrain.unreadyVisible.size, 0);
  assert.equal(terrain.unreadyNative.size, 0);
  assert.equal(frames.size, 0);
  assert.equal(changes.length, notifications);
  assert.equal(canvases.length, allocations);
  assert.deepEqual(mips.map(canvas => canvas.calls.length), counts);
});

test('failed terrain slots settle a batch and retain the original underlay', t => {
  const { terrain, images, changes, flush } = queuedTerrain(t, { tiles: [[29, 71], [30, 71]], concurrency: 1 });
  changes.length = 0;
  terrain.setView(bounds, 1);
  images[0].onload();
  assert.equal(changes.length, 0);
  const failedKey = images[1].src.match(/0_(\d+)_(\d+)\.png$/).slice(1).join(',');
  images[1].onerror(); flush();
  assert.ok(terrain.failed.has(failedKey));
  assert.equal(changes.length, 1);
  assert.equal(terrain.pages.size, 1);
  const page = terrain.pages.get('0,0');
  assert.equal(page.colour.calls[0][0], terrain.fallbackImage);
  assert.ok(!page.nativeKeys.has(failedKey));
});

test('original-image readiness gates requests and an original-image error releases them', t => {
  const ready = queuedTerrain(t, { tiles: [[29, 71]], fallbackImage: null, waitForFallback: true });
  ready.terrain.setView(bounds, 0.5);
  assert.equal(ready.images.length, 0);
  ready.terrain.setFallback({ naturalWidth: 6016, naturalHeight: 6400 });
  ready.terrain.setView(bounds, 0.5); ready.loadAll(); ready.flush();
  assert.ok(ready.terrain.committedKeys.has('29,71'));
  const failed = queuedTerrain(t, { tiles: [[29, 71]], fallbackImage: null, waitForFallback: true });
  failed.terrain.setView(bounds, 0.5);
  assert.equal(failed.images.length, 0);
  failed.terrain.setFallbackUnavailable(); failed.loadAll();
  assert.equal(failed.images.length, 1);
  assert.ok(failed.terrain.committedKeys.has('29,71'));
  const draws = [];
  failed.terrain.draw({ drawImage: (...args) => draws.push(args) }, bounds, { zoom: 0.5, offset: { x: 0, y: 0 }, fallback() {} });
  assert.equal(draws.length, 1, 'Valid terrain remains drawable after the original fails');
});

test('a deferred decode cannot publish or allocate after disposal', async t => {
  let resolveDecode;
  const decode = new Promise(resolve => { resolveDecode = resolve; });
  const image = { naturalWidth: 256, naturalHeight: 256, decode: () => decode };
  const { terrain, changes, canvases, frames } = queuedTerrain(t, { tiles: [[29, 71]], imageFactory: () => image });
  terrain.setView(bounds, 1); image.onload();
  const before = canvases.length, beforeChanges = changes.length;
  terrain.dispose(); resolveDecode(); await decode; await Promise.resolve();
  assert.equal(changes.length, beforeChanges);
  assert.equal(canvases.length, before);
  assert.equal(frames.size, 0);
  assert.equal(terrain.previews.size, 0);
  assert.equal(terrain.stagedPages.size, 0);
});

test('pins are tile-centred, filtered and hidden below the zoom threshold', () => {
  const renderer = new MapPinRenderer({ categories: [{ id: 'bank', label: 'Bank' }] }, { pins: [
    { id: 'one', worldX: 1, worldY: 127, chunkId: '7495', categoryId: 'bank', label: 'Lumbridge bank' },
    { id: 'two', worldX: 30, worldY: 30, categoryId: 'other' },
  ] });
  const circles = [], ctx = { beginPath() {}, arc: (...args) => circles.push(args), stroke() {}, fill() {} };
  const view = { bounds, offset: { x: 10, y: 20 }, zoom: 1, width: 800, height: 600 };
  renderer.draw(ctx, { ...view, zoom: PIN_MIN_ZOOM - 0.01 });
  assert.equal(circles.length, 0);
  renderer.setFilters({ categoryIds: ['bank'], hiddenPinIds: [], search: 'Lumbridge' });
  renderer.draw(ctx, view);
  assert.deepEqual(circles[0].slice(0, 2), [11, 147]);
  assert.equal(renderer.at({ x: 11, y: 147 }).id, 'one');
  renderer.setFilters({ hiddenPinIds: ['one'] });
  circles.length = 0;
  renderer.draw(ctx, view);
  assert.equal(circles.length, 0);
  assert.equal(renderer.at({ x: 11, y: 147 }), null);
  renderer.dispose();
});
