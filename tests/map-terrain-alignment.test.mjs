import test from 'node:test';
import assert from 'node:assert/strict';
import { MapTerrain, TERRAIN_LEVELS } from '../app/web/map-terrain.mjs';

const source = () => ({ mapId: 28, plane: 0, zoom: 2, iconFree: true,
  directory: 'terrain.cache-alignment-v1/28/2', layoutComplete: true,
  transparentWater: true, oceanColour: [96, 118, 154], tiles: [
    { x: 64, y: 68, status: 'rendered', path: 'terrain.cache-alignment-v1/28/2/0_64_68.png' },
  ] });
const canvas = (width, height) => {
  const calls = [], fills = [], ctx = { clearRect() {}, drawImage: (...args) => calls.push(args),
    fillRect(...args) { fills.push({ colour: this.fillStyle, args }); } };
  return { width, height, calls, fills, getContext: () => ctx };
};

test('complete paste layout replaces shifted baked artwork with shared ocean at every overview tier', t => {
  const legacy = { naturalWidth: 6016, naturalHeight: 6400 };
  const terrain = new MapTerrain({ cacheTerrain: source() }, { canvasFactory: canvas, fallbackImage: legacy });
  t.after(() => terrain.dispose());
  assert.equal(terrain.modernBase, true);
  const largest = terrain.levels.get(0.5).colour;
  assert.deepEqual(largest.fills, [{ colour: 'rgb(96,118,154)', args: [0, 0, 3008, 3200] }]);
  for (const scale of TERRAIN_LEVELS) for (const mode of ['colour', 'gray']) {
    assert.ok(terrain.levels.get(scale)[mode].calls.every(call => call[0] !== legacy));
  }
  // Anachronia paste source (88,38) is already exported at display (64,68).
  // It must be drawn once at that display coordinate, with no old eastern copy.
  const image = canvas(64, 64);
  terrain.updateLevels('64,68', image);
  assert.deepEqual(largest.calls.at(-1), [image, 2240, 192, 64, 64]);
  const easternGap = canvas(256, 256);
  terrain.paintLegacyRegion(easternGap.getContext('2d'), 4736, 512, 128, 128, 0, 0, 256, 256);
  assert.equal(easternGap.calls.length, 0);
  assert.deepEqual(easternGap.fills[0], { colour: 'rgb(96,118,154)', args: [0, 0, 256, 256] });
});

test('transparent cache terrain reveals identical water in native pages and native tile resets', t => {
  const terrain = new MapTerrain({ cacheTerrain: source() }, { canvasFactory: canvas,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 } });
  t.after(() => terrain.dispose());
  const key = terrain.pageKey('64,68'); terrain.nativePages.add(key);
  const page = terrain.nativePage(key);
  assert.deepEqual(page.colour.fills[0], { colour: 'rgb(96,118,154)', args: [0, 0, 1024, 1024] });
  const transparent = { naturalWidth: 256, naturalHeight: 256 };
  terrain.paintNativeTile('64,68', transparent, page);
  assert.deepEqual(page.colour.fills.at(-1), { colour: 'rgb(96,118,154)', args: [768, 768, 256, 256] });
  assert.equal(page.colour.calls.at(-1)[0], transparent);
});

test('partial or unsafe cache manifests retain the original image fallback', t => {
  for (const changes of [{ layoutComplete: false }, { transparentWater: false }, { directory: '../terrain' }, { oceanColour: [NaN, 0, 0] }]) {
    const legacy = { naturalWidth: 6016, naturalHeight: 6400 };
    const terrain = new MapTerrain({ cacheTerrain: { ...source(), ...changes } }, { canvasFactory: canvas, fallbackImage: legacy });
    t.after(() => terrain.dispose());
    assert.equal(terrain.modernBase, false);
    terrain.setFallback(legacy);
    const target = canvas(256, 256);
    terrain.paintLegacyRegion(target.getContext('2d'), 0, 0, 128, 128, 0, 0, 256, 256);
    assert.equal(target.calls[0][0], legacy);
  }
});

test('complete modern terrain composes ocean and native pages when the obsolete image fails', t => {
  const terrain = new MapTerrain({ cacheTerrain: source() }, { canvasFactory: canvas, waitForFallback: true });
  t.after(() => terrain.dispose());
  terrain.setFallbackUnavailable();
  assert.equal(terrain.waitForFallback, false);
  assert.equal(terrain.baseReady, true);
  assert.deepEqual(terrain.levels.get(0.5).colour.fills[0], { colour: 'rgb(96,118,154)', args: [0, 0, 3008, 3200] });
  let legacyCalls = 0;
  const target = canvas(128, 128);
  terrain.draw(target.getContext('2d'), { left: 0, top: 0, right: 128, bottom: 128 },
    { offset: { x: 0, y: 0 }, zoom: 0.5, fallback: () => legacyCalls++ });
  assert.equal(legacyCalls, 0);
  assert.equal(target.calls.length, 1);
  terrain.nativePages.add('0,0');
  assert.deepEqual(terrain.nativePage('0,0').colour.fills[0], { colour: 'rgb(96,118,154)', args: [0, 0, 1024, 1024] });
});

test('black community placeholders advance to certified cache floors even when those floors are black', t => {
  const pixels = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const cache = source(); cache.tiles = [{ x: 29, y: 71, status: 'rendered', path: `${cache.directory}/0_29_71.png` }];
  const images = [], terrain = new MapTerrain({ cacheTerrain: cache, terrain: { mapId: 28, plane: 0, zoom: 2,
    tiles: [{ x: 29, y: 71, status: 'downloaded', path: 'terrain/28/2/0_29_71.png' }] } }, {
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    canvasFactory: (w, h) => { const c = canvas(w, h); c.getContext().getImageData = () => ({ data: pixels }); return c; },
  });
  t.after(() => terrain.dispose());
  terrain.setView({ left: 0, top: 0, right: 128, bottom: 128 }, 1);
  images[0].onload();
  assert.equal(images.length, 2);
  assert.ok(images[1].src.includes('/terrain.cache-'));
  images[1].onload();
  assert.equal(terrain.failed.has('29,71'), false);
  assert.ok(terrain.committedKeys.has('29,71'));
});
