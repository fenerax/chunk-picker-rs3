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

test('default category selection includes unknown types and preserves intentional Hide all', () => {
  assert.deepEqual(normalizePinPreferences(null, categories, pins).categoryIds, ['bank', 'furnace', 'other']);
  assert.deepEqual(prefs({ categoryIds: [] }).categoryIds, []);
  assert.deepEqual(filterPins(pins, prefs({ categoryIds: [] }), categories), []);
  assert.deepEqual(prefs({ categoryIds: ['bank', 'obsolete', 'bank'], hiddenPinIds: ['bank-a', 'removed', 'bank-a'] }),
    { version: 1, categoryIds: ['bank'], hiddenPinIds: ['bank-a'], search: '', expandedGroupIds: ['general'] });
});

test('search matches unlabeled category, accent-free labels, chunk IDs and coordinates', () => {
  assert.equal(pinMatchesSearch(pins[0], 'cafe BANK 12340', categories), true);
  assert.equal(pinMatchesSearch(pins[1], 'bank 3250', categories), true);
  assert.equal(pinMatchesSearch(pins[0], 'bank furnace', categories), false);
  assert.equal(pinMatchesSearch(pins[0], '3190', categories), true);
  assert.equal(pinMatchesSearch(pins[0], '2700', categories), false);
  assert.equal(pinMatchesSearch(pins[3], 'unmapped', categories), true);
  assert.equal(pinMatchesSearch(pins[3], '100', categories), true);
  assert.equal(pinMatchesSearch(pins[2], 'skilling furnace', categories), true);
  assert.equal(pinMatchesSearch(pins[0], 'general bank', categories), true);
  assert.equal(pinMatchesSearch(pins[0], '   ', categories), true);
});

test('asset loading stays local and degrades to fallback for missing or invalid snapshots', async () => {
  const manifest = { schemaVersion: 1, terrain: { mapId: 28 }, pins: { path: 'pins.normalized.json' }, categories };
  const dataset = { schemaVersion: 1, pins };
  const requested = [];
  const loaded = await loadMapAssets(async path => { requested.push(path);
    return path === `/assets/map/${CACHE_PIN_PATH}` ? { ok: false, status: 404 }
      : { ok: true, json: async () => path.endsWith('/manifest.json') ? manifest : dataset }; });
  assert.deepEqual(loaded, { manifest, dataset });
  assert.deepEqual(requested, ['/assets/map/manifest.json', '/assets/map/terrain.optimized-manifest.json', `/assets/map/${CACHE_PIN_PATH}`, `/assets/map/${CACHE_PIN_MANIFEST_PATH}`, '/assets/map/pins.normalized.json']);
  assert.equal(await loadMapAssets(async () => ({ ok: true, json: async () => ({ available: false }) })), null);
  assert.equal(await loadMapAssets(async () => ({ ok: false })), null);
  assert.equal(await loadMapAssets(async () => { throw new Error('offline'); }), null);
  let calls = 0;
  assert.equal(await loadMapAssets(async path => { calls++; return path.endsWith(CACHE_PIN_PATH) ? { ok: false, status: 404 }
    : { ok: true, json: async () => ({ ...manifest, pins: { path: 'https://host/pins.json' } }) }; }), null);
  assert.equal(calls, 4);
});

test('reviewed legend grouping covers every category exactly once and quarantines new IDs', () => {
  const reviewedIds = MAP_PIN_CATEGORIES.map(category => category.id).sort();
  const authoredIds = MAP_PIN_LEGEND_GROUPS.flatMap(group => group.categoryIds).sort();
  assert.equal(new Set(authoredIds).size, authoredIds.length);
  assert.deepEqual(authoredIds, reviewedIds);
  assert.deepEqual(groupPinCategories(MAP_PIN_CATEGORIES).flatMap(group => group.categories.map(category => category.id)).sort(), reviewedIds);
  const unexpected = { id: '12345', label: 'Untranslated source type', group: 'Navigation', legendGroupId: 'transport' };
  const groups = groupPinCategories([...MAP_PIN_CATEGORIES, unexpected]);
  assert.ok(groups.find(group => group.id === 'other').categories.includes(unexpected));
  assert.equal(groups.find(group => group.id === 'transport').categories.includes(unexpected), false);
  for (const category of MAP_PIN_CATEGORIES) assert.ok(MAP_PIN_LEGEND_GROUPS.find(group => group.id === category.legendGroupId).categoryIds.includes(category.id));
});

test('group tri-state toggles affect the entire group and preserve other categories', () => {
  const group = groupPinCategories(MAP_PIN_CATEGORIES).find(group => group.id === 'transport');
  assert.deepEqual(categorySelection(['bank'], group.categories), { checked: false, indeterminate: false });
  assert.deepEqual(categorySelection(['bank', 'lodestone'], group.categories), { checked: false, indeterminate: true });
  const enabled = togglePinGroup(['bank', 'lodestone'], group, true);
  assert.deepEqual(categorySelection(enabled, group.categories), { checked: true, indeterminate: false });
  assert.equal(enabled.filter(id => id === 'lodestone').length, 1);
  assert.deepEqual(togglePinGroup(enabled, group, false), ['bank']);
});

test('expansion defaults migrate old preferences and retain intentionally collapsed groups', () => {
  assert.deepEqual(normalizePinPreferences(null, MAP_PIN_CATEGORIES).expandedGroupIds, ['general', 'transport']);
  assert.deepEqual(normalizePinPreferences({ version: 1, categoryIds: [] }, MAP_PIN_CATEGORIES).expandedGroupIds, ['general', 'transport']);
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const value = normalizePinPreferences({ version: 1, categoryIds: ['bank'], hiddenPinIds: ['bank-a'], search: 'cafe', expandedGroupIds: ['skilling', 'obsolete', 'skilling'] }, MAP_PIN_CATEGORIES, pins);
  assert.deepEqual(value.expandedGroupIds, ['skilling']);
  writePinPreferences(storage, value);
  assert.deepEqual(readPinPreferences(storage, MAP_PIN_CATEGORIES, pins), value);
  assert.deepEqual(normalizePinPreferences({ version: 1, expandedGroupIds: [] }, MAP_PIN_CATEGORIES).expandedGroupIds, []);
  assert.deepEqual(normalizePinPreferences({ version: 1, expandedGroupIds: ['transport'] }, categories).expandedGroupIds, []);
});

test('search and group toggles retain hidden-pin and expansion preferences independently', () => {
  const group = groupPinCategories(categories).find(group => group.id === 'general');
  const initial = prefs({ categoryIds: [], search: 'cafe', hiddenPinIds: ['bank-a'], expandedGroupIds: ['skilling'] });
  const enabled = prefs({ ...initial, categoryIds: togglePinGroup(initial.categoryIds, group, true) });
  assert.deepEqual(enabled.expandedGroupIds, ['skilling']);
  assert.equal(enabled.search, 'cafe');
  assert.deepEqual(enabled.hiddenPinIds, ['bank-a']);
  assert.deepEqual(filterPins(pins, enabled, categories), []);
  assert.deepEqual(filterPins(pins, enabled, categories, { hidden: true }).map(pin => pin.id), ['bank-a']);
  assert.deepEqual(filterPins(pins, { ...enabled, hiddenPinIds: [] }, categories).map(pin => pin.id), ['bank-a']);
});

test('panel group controls, native disclosure persistence, search and pin actions work together', () => {
  class Node {
    constructor(tag, value = '') { this.tag = tag; this.textContent = value; this.children = []; this.events = {}; this.attributes = {}; this.open = false; this.style = { setProperty() {} }; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    addEventListener(name, callback) { this.events[name] = callback; }
    setAttribute(name, value) { this.attributes[name] = value; }
    emit(name) { this.events[name]?.({}); }
    focus() {}
    getBoundingClientRect() { return { width: 340 }; }
  }
  const previousDocument = globalThis.document, head = new Node('head');
  const descendants = root => [root, ...root.children.flatMap(descendants)];
  const document = { head, createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), createTextNode: text => new Node('text', text),
    getElementById: id => descendants(head).find(node => node.id === id) };
  globalThis.document = document;
  try {
    const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
    let redraws = 0, focused, advanced = false, canWrite = true;
    const map = { model: { world: { chunks: new Map([['123', { name: 'Lumbridge' }]]) } }, width: 1200, setPinFilters() { redraws++; }, focusPin(id) { focused = id; } };
    const panel = new Node('section'), toggle = new Node('button');
    const options = { preferences: () => ({ advanced }), canWrite: () => canWrite, panel, toggle, map, manifest: { categories, pins: {} }, dataset: { pins }, storage, onSources() {} };
    const controller = createMapPinsPanel(options);
    const find = predicate => descendants(panel).find(predicate);
    const groups = descendants(panel).filter(node => node.className === 'pin-group');
    assert.equal(groups.length, 3);
    const otherCategory = descendants(panel).find(node => node.className === 'pin-category' && node.children.some(child => child.textContent === 'Other / unmapped'));
    assert.ok(otherCategory?.children.some(child => child.tag === 'i' && child.className === 'pin-unmapped-icon'), 'A category without supplied artwork retains the authored marker');
    assert.equal(otherCategory?.children.some(child => child.tag === 'img'), false);
    const general = groups[0], skilling = groups[1], groupCheckbox = general.children[0].children[0];
    const generalDetails = general.children[1], skillingDetails = skilling.children[1];
    assert.equal(generalDetails.tag, 'details');
    assert.equal(generalDetails.children[0].tag, 'summary');
    assert.equal(generalDetails.open, true);
    assert.equal(skillingDetails.open, false);
    assert.equal(generalDetails.children[0].children[1].textContent, '2 pins · 1/1 types shown');
    groupCheckbox.checked = false; groupCheckbox.emit('change');
    assert.deepEqual(controller.filters().categoryIds, ['furnace', 'other']);
    assert.equal(groupCheckbox.indeterminate, false);
    groupCheckbox.checked = true; groupCheckbox.emit('change');
    assert.equal(groupCheckbox.checked, true);
    const beforeToggle = redraws;
    generalDetails.open = false; generalDetails.emit('toggle');
    skillingDetails.open = true; skillingDetails.emit('toggle');
    assert.equal(redraws, beforeToggle, 'Expansion does not redraw the map');
    assert.deepEqual(readPinPreferences(storage, categories, pins).expandedGroupIds, ['skilling']);
    const search = find(node => node.id === 'map-pins-search'); search.value = 'cafe'; search.emit('input');
    assert.deepEqual(controller.filters().expandedGroupIds, ['skilling']);
    assert.equal(generalDetails.open, false);
    const visibleText = () => descendants(panel).map(node => node.textContent).join('\n');
    assert.doesNotMatch(visibleText(), /Sprite /);
    advanced = true; controller.close(); toggle.emit('click');
    assert.match(visibleText(), /Sprite /);
    canWrite = false; controller.close(); toggle.emit('click');
    assert.doesNotMatch(visibleText(), /Sprite /);
    canWrite = true; advanced = false; controller.close(); toggle.emit('click');
    find(node => node.className === 'pin-result-focus').emit('click');
    assert.equal(focused, 'bank-a');
    find(node => node.textContent === 'Hide this pin').emit('click');
    assert.deepEqual(controller.filters().hiddenPinIds, ['bank-a']);
    find(node => node.textContent === 'Show only this type').emit('click');
    assert.deepEqual(controller.filters().categoryIds, ['bank']);
    find(node => node.textContent === 'Show').emit('click');
    assert.deepEqual(controller.filters().hiddenPinIds, []);
    find(node => node.textContent === 'Hide all').emit('click');
    assert.deepEqual(controller.filters().categoryIds, []);
    find(node => node.textContent === 'Show all').emit('click');
    assert.deepEqual(controller.filters().categoryIds, ['bank', 'furnace', 'other']);
    const reloadPanel = new Node('section');
    createMapPinsPanel({ ...options, panel: reloadPanel, toggle: new Node('button') });
    assert.deepEqual(descendants(reloadPanel).filter(node => node.className === 'pin-group-details').map(node => node.open), [false, true, false]);
    find(node => node.textContent === 'Reset').emit('click');
    assert.deepEqual(controller.filters().expandedGroupIds, ['general']);
    assert.equal(controller.filters().search, '');
    createMapPinsPanel({ ...options, panel: new Node('section'), toggle: new Node('button') });
    assert.equal(head.children.length, 1, 'Group stylesheet is loaded once');
    delete document.head;
    assert.doesNotThrow(() => createMapPinsPanel({ ...options, panel: new Node('section'), toggle: new Node('button') }));
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
