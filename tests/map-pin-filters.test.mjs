import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePinPreferences, readPinPreferences, writePinPreferences, PIN_PREFERENCES_KEY, pinMatchesSearch, filterPins, categorySelection, loadMapAssets, localMapAssetPath, groupPinCategories, togglePinGroup, createMapPinsPanel } from '../app/web/map-pins.mjs';
import { MAP_PIN_CATEGORIES, MAP_PIN_LEGEND_GROUPS } from '../app/data/map-pin-categories.mjs';
import { CACHE_PIN_PATH, CACHE_PIN_MANIFEST_PATH } from '../app/data/map-pins.mjs';

const categories = [{ id: 'bank', label: 'Bank' }, { id: 'furnace', label: 'Furnace' }, { id: 'other', label: 'Other / unmapped' }];
const pins = [
  { id: 'bank-a', categoryId: 'bank', label: 'Prifddinas café', chunkId: '12340', x: 3190, y: 3225, worldX: 2700, worldY: 1800 },
  { id: 'bank-b', categoryId: 'bank', label: '', chunkId: '12341', worldX: 3250, worldY: 3200 },
  { id: 'furnace-a', categoryId: 'furnace', label: 'Lumbridge', chunkId: '12340' },
  { id: 'unknown-a', categoryId: 'other', label: 'Unmapped', spriteId: 100 },
];
const prefs = extra => normalizePinPreferences({ version: 1, categoryIds: ['bank'], hiddenPinIds: [], search: '', ...extra }, categories, pins);



test('search does not switch categories or return hidden pins, while hidden restore ignores category selection', () => {
  const filters = prefs({ search: '12340', hiddenPinIds: ['bank-a', 'furnace-a'] });
  assert.deepEqual(filterPins(pins, filters, categories), []);
  assert.deepEqual(filterPins(pins, filters, categories, { hidden: true }).map(pin => pin.id), ['bank-a', 'furnace-a']);
  assert.deepEqual(filterPins(pins, prefs({ search: 'bank' }), categories).map(pin => pin.id), ['bank-a', 'bank-b']);
});

test('all category control distinguishes none, some and all despite stale IDs', () => {
  assert.deepEqual(categorySelection([], categories), { checked: false, indeterminate: false });
  assert.deepEqual(categorySelection(['bank', 'removed'], categories), { checked: false, indeterminate: true });
  assert.deepEqual(categorySelection(new Set(['bank', 'furnace', 'other']), categories), { checked: true, indeterminate: false });
});

test('preferences round trip locally and tolerate corrupt JSON, obsolete schema and blocked storage', () => {
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const chosen = prefs({ categoryIds: [], hiddenPinIds: ['bank-a'], search: 'bank' });
  assert.equal(writePinPreferences(storage, chosen), true);
  assert.deepEqual(readPinPreferences(storage, categories, pins), chosen);
  memory.set(PIN_PREFERENCES_KEY, '{broken');
  assert.deepEqual(readPinPreferences(storage, categories, pins), normalizePinPreferences(null, categories, pins));
  memory.set(PIN_PREFERENCES_KEY, JSON.stringify({ version: 99, categoryIds: [] }));
  assert.deepEqual(readPinPreferences(storage, categories, pins).categoryIds, ['bank', 'furnace', 'other']);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => readPinPreferences(blocked, categories, pins));
  assert.equal(writePinPreferences(blocked, chosen), false);
});

test('local asset resolution rejects third-party URLs, traversal and query strings', () => {
  assert.equal(localMapAssetPath('pins.normalized.json'), '/assets/map/pins.normalized.json');
  assert.equal(localMapAssetPath('/assets/map/icons/bank.png'), '/assets/map/icons/bank.png');
  for (const path of ['https://host/pins.json', '//host/pins.json', '../pins.json', 'terrain/../../secret', '/api/state', 'file?source=x', 'terrain\\tile.png']) assert.equal(localMapAssetPath(path), null);
});

test('legacy fallback loader filters minimap-only pins flagged with unk_8 === 0', async () => {
  const manifest = { schemaVersion: 1, terrain: { mapId: 28 }, pins: { path: 'pins.normalized.json' }, categories };
  const dataset = {
    schemaVersion: 1,
    pins: [
      ...pins,
      { id: 'legacy-minimap-dot', categoryId: 'other', label: 'Other / unmapped', spriteId: 511,
        conditions: { properties: { iconSprite: 511, unk_8: 0, unk_7: 2 }, icon: { iconSprite: 511, unk_8: 0, unk_7: 2 } } },
    ],
  };
  const loaded = await loadMapAssets(async path => path === `/assets/map/${CACHE_PIN_PATH}`
    ? { ok: false, status: 404 }
    : { ok: true, json: async () => path.endsWith('/manifest.json') ? manifest : dataset });
  assert.deepEqual(loaded.dataset.pins.map(pin => pin.id), pins.map(pin => pin.id));
});






