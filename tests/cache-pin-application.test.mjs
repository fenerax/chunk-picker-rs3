import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_PIN_PATH, CACHE_PIN_MANIFEST_PATH, CACHE_PIN_SPRITE_DIRECTORY, normalizeCachePins } from '../app/data/map-pins.mjs';
import { categoryForCachePin, categoryForSprite } from '../app/data/map-pin-categories.mjs';
import { loadMapAssets, groupPinCategories } from '../app/web/map-pins.mjs';
import { MapPinRenderer } from '../app/web/map-pin-renderer.mjs';

const frame = spriteId => ({ spriteId, frames: [{ index: 0, x: 2, y: 3, width: 12, height: 10,
  fullwidth: 16, fullheight: 16, asset: { path: `${CACHE_PIN_SPRITE_DIRECTORY}/${spriteId}-0.png` } }] });
function fixture() {
  const source = { kind: 'object', objectId: 42, plane: 1, renderPlane: 0 };
  const pin = { id: 'cache-bank', x: 3215, y: 3257, mapId: 28, plane: 0, spriteId: 22458,
    category: 1156, label: '', source, conditions: [{ kind: 'varbit', value: 1 }], surfaceTransform: { translation: { x: 0, y: 0 } } };
  return {
    dataset: { schemaVersion: 1, exportType: 'cache-diagnostic', mapId: 28, plane: 0,
      pins: [pin, { ...pin, id: 'cache-fishing', x: 3244, y: 3223, spriteId: 22564, category: 1176 },
        { ...pin, id: 'cache-new', x: 3245, spriteId: 99999, category: 9999 },
        { ...pin, id: 'cache-label', x: 3246, spriteId: null, category: 950, label: 'River Lum' }], exclusions: [{ reason: 'no-surface-paste' }] },
    provenance: { schemaVersion: 1, generatedAt: '2026-10-08T00:12:25.604Z', published: { pins: { path: CACHE_PIN_PATH },
      sprites: { sprites: [frame(22458), frame(22564), frame(99999)] } } },
    manifest: { schemaVersion: 1, terrain: { mapId: 28, tiles: [] }, categories: [], pins: { path: 'pins.normalized.json' } },
  };
}

test('current pins retain exact surface identity, conditions, artwork and water locations', () => {
  const input = fixture(), untouched = structuredClone(input);
  const result = normalizeCachePins(input.dataset, input.provenance, input.manifest);
  assert.deepEqual(input, untouched, 'The published research bundle remains immutable');
  const [bank, fishing, unknown, label] = result.dataset.pins;
  assert.deepEqual([bank.chunkId, bank.worldX, bank.worldY, bank.categoryId], ['12850', 2719, 2701, 'bank']);
  assert.deepEqual(bank.source, input.dataset.pins[0].source);
  assert.deepEqual(bank.conditions, input.dataset.pins[0].conditions);
  assert.deepEqual(result.dataset.exclusions, input.dataset.exclusions);
  assert.equal(bank.icon, `/assets/map/${CACHE_PIN_SPRITE_DIRECTORY}/22458-0.png`);
  assert.equal(fishing.categoryId, 'fishing-spot');
  assert.equal(unknown.categoryId, 'other');
  assert.equal(label.textOnly, true); assert.equal(label.label, 'River Lum');
  assert.equal(result.dataset.normalization.waterExclusions, 0);
  assert.equal(result.manifest.terrain, input.manifest.terrain);
  assert.ok(groupPinCategories(result.manifest.categories).find(group => group.id === 'other').categories.some(category => category.id === 'other'));
});

test('state-specific and modern sprite aliases use reviewed legend categories', () => {
  assert.equal(categoryForSprite(22458).id, 'bank');
  assert.equal(categoryForCachePin({ spriteId: 22471, category: 1157 }).id, 'quest');
  assert.equal(categoryForCachePin({ spriteId: 22472, category: 1157 }).id, 'quest-in-progress');
  assert.equal(categoryForCachePin({ spriteId: 25254, category: 2613 }).id, 'lodestone-activated');
  assert.equal(categoryForCachePin({ spriteId: 10832, category: 4626 }).id, 'archaeologists-workbench');
  assert.equal(categoryForCachePin({ spriteId: 99999, category: 9999 }).id, 'other');
});

test('current cache file wins over legacy pins and requires its matching local manifest', async () => {
  const { dataset, provenance, manifest } = fixture(), paths = [];
  const values = new Map([['/assets/map/manifest.json', manifest], [`/assets/map/${CACHE_PIN_PATH}`, dataset],
    [`/assets/map/${CACHE_PIN_MANIFEST_PATH}`, provenance]]);
  const result = await loadMapAssets(async path => { paths.push(path); return { ok: true, json: async () => values.get(path) }; });
  assert.equal(result.dataset.sourceKind, 'copied-cache');
  assert.deepEqual(paths, ['/assets/map/manifest.json', '/assets/map/terrain.optimized-manifest.json', ...[...values.keys()].slice(1)]);
  assert.equal(paths.some(path => path.includes('pins.normalized')), false);
});

test('only an absent cache pin file permits the 2021 fallback', async () => {
  for (const status of [401, 403, 500]) {
    const { manifest } = fixture(), paths = [];
    assert.equal(await loadMapAssets(async path => { paths.push(path); return path.endsWith('/manifest.json')
      ? { ok: true, json: async () => manifest } : { ok: false, status }; }), null);
    assert.equal(paths.length, 4);
  }
  for (const broken of ['invalid-json', 'bad-dataset', 'missing-manifest', 'bad-frame']) {
    const { manifest, dataset, provenance } = fixture(), paths = [];
    if (broken === 'bad-dataset') dataset.pins[0].mapId = 99;
    if (broken === 'bad-frame') provenance.published.sprites.sprites = [];
    const result = await loadMapAssets(async path => {
      paths.push(path);
      if (path.endsWith('/manifest.json')) return { ok: true, json: async () => manifest };
      if (path.endsWith(CACHE_PIN_PATH)) return { ok: true, json: async () => {
        if (broken === 'invalid-json') throw new SyntaxError('bad JSON'); return dataset;
      } };
      return broken === 'missing-manifest' ? { ok: false, status: 404 } : { ok: true, json: async () => provenance };
    });
    assert.equal(result, null, broken);
    assert.equal(paths.some(path => path.includes('pins.normalized')), false);
  }
});

test('renderer loads exact per-pin cache artwork, keeps trim anchors and draws text labels', async () => {
  const { dataset, provenance, manifest } = fixture(), bundle = normalizeCachePins(dataset, provenance, manifest);
  const images = [], draws = [], labels = [];
  const renderer = new MapPinRenderer(bundle.manifest, bundle.dataset, { canvasFactory: () => null,
    imageFactory: () => { const image = { naturalWidth: 12, naturalHeight: 10 }; images.push(image); return image; } });
  const bank = bundle.dataset.pins[0];
  assert.equal(renderer.icon('bank', bank), null);
  assert.equal(images[0].src, bank.icon); images[0].onload();
  const context = { globalAlpha: 1, drawImage: (...args) => draws.push(args), fillText: (...args) => labels.push(args),
    beginPath() {}, arc() {}, fill() {}, stroke() {} };
  renderer.paint(context, { offset: { x: -bank.worldX + 100, y: -bank.worldY + 100 }, zoom: 1,
    width: 800, height: 600, unlocked: new Set() });
  assert.equal(draws[0][0], images[0]);
  assert.deepEqual(draws[0].slice(1), [92.875, 94.0625, 14.25, 11.875]);
  assert.equal(labels[0][0], 'River Lum');
  const unknown = bundle.dataset.pins[2]; renderer.icon('other', unknown);
  assert.equal(images.at(-1).src, unknown.icon, 'Unmapped categories retain their exact cache artwork');
  assert.equal(renderer.icon('other', { icon: '/assets/map/../private.png' }), null);
  renderer.dispose();
});
