import { MAP_PIN_LEGEND_GROUPS } from '../data/map-pin-categories.mjs';
import { CACHE_PIN_PATH, CACHE_PIN_MANIFEST_PATH, normalizeCachePins } from '../data/map-pins.mjs';
import { createTravelLinesControl } from './map-info.mjs';
import { placeholderPicture, resolvePicture } from './art-status.mjs';

export const PIN_PREFERENCES_KEY = 'duo-map-pins-v1';
const text = value => String(value ?? '');
export const normalizePinSearch = value => text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
const ids = values => Array.isArray(values) || values instanceof Set ? [...values].filter(value => typeof value === 'string') : [];
const legendGroupByCategory = new Map(MAP_PIN_LEGEND_GROUPS.flatMap(group => group.categoryIds.map(id => [id, group])));

/** Explicit named taxonomy also works with older locally imported manifests. */
export function groupPinCategories(categories) {
  return MAP_PIN_LEGEND_GROUPS.map(group => ({ ...group,
    categories: categories.filter(category => (legendGroupByCategory.get(category.id)?.id ?? 'other') === group.id),
  })).filter(group => group.categories.length);
}
export function togglePinGroup(categoryIds, group, checked) {
  const selected = new Set(ids(categoryIds));
  for (const category of group.categories) {
    if (checked) selected.add(category.id); else selected.delete(category.id);
  }
  return [...selected];
}

/** Browser-only view preferences never change chunk access or shared game state. */
export function normalizePinPreferences(value, categories, pins = []) {
  const knownCategories = new Set(categories.map(category => category.id));
  const knownPins = new Set(pins.map(pin => pin.id));
  const groups = groupPinCategories(categories), knownGroups = new Set(groups.map(group => group.id));
  const valid = value && typeof value === 'object' && value.version === 1;
  return { version: 1,
    categoryIds: valid && (Array.isArray(value.categoryIds) || value.categoryIds instanceof Set)
      ? [...new Set(ids(value.categoryIds))].filter(id => knownCategories.has(id)) : [...knownCategories],
    hiddenPinIds: valid ? [...new Set(ids(value.hiddenPinIds))].filter(id => knownPins.has(id)) : [],
    search: valid && typeof value.search === 'string' ? value.search.slice(0, 200) : '',
    expandedGroupIds: valid && (Array.isArray(value.expandedGroupIds) || value.expandedGroupIds instanceof Set)
      ? [...new Set(ids(value.expandedGroupIds))].filter(id => knownGroups.has(id))
      : groups.filter(group => group.openByDefault).map(group => group.id) };
}
export function readPinPreferences(storage, categories, pins) {
  try { return normalizePinPreferences(JSON.parse(storage?.getItem(PIN_PREFERENCES_KEY) ?? 'null'), categories, pins); }
  catch { return normalizePinPreferences(null, categories, pins); }
}
export function writePinPreferences(storage, value) {
  try { storage?.setItem(PIN_PREFERENCES_KEY, JSON.stringify(value)); return !!storage; }
  catch { return false; }
}
export function pinMatchesSearch(pin, search, categories = []) {
  const query = normalizePinSearch(search);
  if (!query) return true;
  const category = categories instanceof Map ? categories.get(pin.categoryId) : categories.find(row => row.id === pin.categoryId);
  const groupLabel = (legendGroupByCategory.get(pin.categoryId) ?? MAP_PIN_LEGEND_GROUPS.at(-1))?.label ?? '';
  const haystack = normalizePinSearch(`${pin.label ?? ''} ${category?.label ?? ''} ${groupLabel} ${pin.categoryId} ${pin.spriteId ?? ''} ${pin.chunkId ?? ''} ${pin.x ?? pin.worldX ?? ''} ${pin.y ?? pin.worldY ?? ''}`);
  return query.split(/\s+/).every(term => haystack.includes(term));
}
export function filterPins(pins, filters, categories = [], { hidden = false } = {}) {
  const selected = new Set(ids(filters.categoryIds)), hiddenIds = new Set(ids(filters.hiddenPinIds));
  const byId = new Map(categories.map(category => [category.id, category]));
  return pins.filter(pin => hidden ? hiddenIds.has(pin.id) && pinMatchesSearch(pin, filters.search, byId)
    : selected.has(pin.categoryId) && !hiddenIds.has(pin.id) && pinMatchesSearch(pin, filters.search, byId));
}
export function categorySelection(categoryIds, categories) {
  const selected = new Set(ids(categoryIds));
  const count = categories.filter(category => selected.has(category.id)).length;
  return { checked: categories.length > 0 && count === categories.length, indeterminate: count > 0 && count < categories.length };
}
export function localMapAssetPath(path) {
  if (typeof path !== 'string' || path.includes('\\') || path.includes('?') || path.includes('#')) return null;
  const local = path.startsWith('/assets/map/') ? path : `/assets/map/${path}`;
  if (!/^\/assets\/map\/(?:[\w.-]+\/)*[\w.-]+$/.test(local) || local.split('/').some(part => part === '.' || part === '..')) return null;
  return local;
}
/** Optional local assets must never cause startup to contact an external host. */
export async function loadTerrainManifest(fetcher = globalThis.fetch, { optimizedTimeoutMs = 3000 } = {}) {
  try {
    const controller = new AbortController();
    let timeout;
    const optimized = Promise.race([
      Promise.resolve().then(() => fetcher('/assets/map/terrain.optimized-manifest.json', { signal: controller.signal }))
        .then(response => response.ok ? response.json() : null).catch(() => null),
      new Promise(resolve => { timeout = setTimeout(() => { controller.abort(); resolve(null); }, optimizedTimeoutMs); }),
    ]).finally(() => clearTimeout(timeout));
    const response = await fetcher('/assets/map/manifest.json');
    if (!response.ok) return null;
    const manifest = await response.json();
    if (manifest.available === false || manifest.schemaVersion !== 1 || !manifest.terrain) return null;
    const bundle = await optimized;
    if (bundle?.available !== false && bundle?.schemaVersion === 1 && bundle?.mapId === 28 && bundle?.plane === 0) {
      manifest.optimizedTerrain = bundle;
    }
    return manifest;
  } catch { return null; }
}
export async function loadMapPins(manifest, fetcher = globalThis.fetch) {
  try {
    const [cacheResponse, provenanceResponse] = await Promise.all([
      fetcher(localMapAssetPath(CACHE_PIN_PATH)), Promise.resolve().then(() => fetcher(localMapAssetPath(CACHE_PIN_MANIFEST_PATH))).catch(() => null),
    ]);
    if (cacheResponse.ok) {
      const dataset = await cacheResponse.json();
      if (!provenanceResponse?.ok) return null;
      return normalizeCachePins(dataset, await provenanceResponse.json(), manifest);
    }
    // A broken, denied or incomplete current bundle must not masquerade as 2021.
    if (cacheResponse.status !== 404) return null;
    const path = localMapAssetPath(manifest.pins?.path);
    if (!path) return null;
    const pinResponse = await fetcher(path);
    if (!pinResponse.ok) return null;
    const dataset = await pinResponse.json();
    if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.pins) || !Array.isArray(manifest.categories)) return null;
    return { manifest, dataset };
  } catch { return null; }
}
/** Compatibility loader for callers that need both optional layers together. */
export async function loadMapAssets(fetcher = globalThis.fetch) {
  const manifest = await loadTerrainManifest(fetcher);
  return manifest ? loadMapPins(manifest, fetcher) : null;
}

export function createMapPinsPanel({ panel, toggle, map, manifest, dataset, onSources, storage, preferences = () => ({}), canWrite = () => true }) {
  const advanced = () => canWrite() !== false && preferences()?.advanced === true;
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  // Group styling is optional in non-browser fixtures and loaded only once.
  if (document.head && !document.getElementById('map-pin-groups-style')) {
    const stylesheet = document.createElement('link'); stylesheet.id = 'map-pin-groups-style';
    stylesheet.rel = 'stylesheet'; stylesheet.href = '/map-pin-groups.css'; document.head.append(stylesheet);
  }
  const categories = manifest.categories, pins = dataset.pins, groups = groupPinCategories(categories);
  const byCategory = new Map(categories.map(category => [category.id, category]));
  const counts = new Map();
  for (const pin of pins) counts.set(pin.categoryId, (counts.get(pin.categoryId) ?? 0) + 1);
  let filters = readPinPreferences(storage, categories, pins), selectedPin, resultLimit = 30;
  const node = (tag, label, cls) => { const value = document.createElement(tag); if (label !== undefined) value.textContent = label; if (cls) value.className = cls; return value; };
  const action = (label, callback, cls) => { const value = node('button', label, cls); value.type = 'button'; value.addEventListener('click', callback); return value; };
  const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); };
  const header = node('div', undefined, 'pin-panel-header');
  const title = node('h2', 'Map icons'); title.id = 'map-pins-title';
  const closeButton = action('×', close, 'close-button'); closeButton.setAttribute('aria-label', 'Close map icons');
  header.append(title, closeButton);
  const description = node('p', `Map icons · ${dataset.snapshotDate ?? manifest.pins.snapshotDate ?? '2021-12-18'}`, 'status-detail');
  const note = node('p', 'Icons mark locations, not access or usable teleports. Search highlights matches in selected categories.', 'status-detail');
  const coverage = node('p', 'Zoom in to see all icons. When many icons overlap, the map shows a selection. While map tiles are loading, icons drawn into the fallback map image cannot be filtered. Some locations and access requirements still need checking.', 'status-detail');
  const searchLabel = node('label', 'Search icons'); searchLabel.htmlFor = 'map-pins-search';
  const search = node('input'); search.type = 'search'; search.id = 'map-pins-search'; search.placeholder = 'Bank, furnace, chunk…'; search.maxLength = 200; search.value = filters.search;
  const controls = node('div', undefined, 'pin-controls');
  controls.append(action('Show all', () => update({ categoryIds: categories.map(category => category.id) })),
    action('Hide all', () => update({ categoryIds: [] })),
    action('Reset', () => { selectedPin = undefined; search.value = ''; filters = normalizePinPreferences(null, categories, pins); update({}); }));
  const allLabel = node('label', undefined, 'pin-all-categories'), all = node('input'); all.type = 'checkbox';
  allLabel.append(all, document.createTextNode('All categories'));
  all.addEventListener('change', () => update({ categoryIds: all.checked ? categories.map(category => category.id) : [] }));
  const legend = node('fieldset', undefined, 'pin-categories pin-grouped-legend'), categoryTitle = node('legend');
  legend.append(categoryTitle, allLabel);
  const categoryControls = new Map(), groupControls = new Map();
  for (const group of groups) {
    const row = node('div', undefined, 'pin-group'), groupToggle = node('label', undefined, 'pin-group-toggle'), checkbox = node('input'); checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', `Show all ${group.label} categories`);
    checkbox.addEventListener('change', () => update({ categoryIds: togglePinGroup(filters.categoryIds, group, checkbox.checked) }));
    const details = node('details', undefined, 'pin-group-details'), summary = node('summary');
    details.open = filters.expandedGroupIds.includes(group.id);
    const count = node('span', undefined, 'pin-group-count');
    summary.append(node('span', group.label, 'pin-group-name'), count);
    const contents = node('div', undefined, 'pin-group-categories');
    groupToggle.append(checkbox);
    details.append(summary, contents); row.append(groupToggle, details); legend.append(row);
    details.addEventListener('toggle', () => {
      const expanded = new Set(filters.expandedGroupIds);
      if (details.open) expanded.add(group.id); else expanded.delete(group.id);
      // Native toggle events are asynchronous; unchanged programmatic states
      // must not create another map render or write on panel initialization.
      if (details.open === filters.expandedGroupIds.includes(group.id)) return;
      filters = normalizePinPreferences({ ...filters, expandedGroupIds: [...expanded] }, categories, pins);
      writePinPreferences(storage, filters);
    });
    groupControls.set(group.id, { checkbox, details, count });
    for (const category of group.categories) {
      const label = node('label', undefined, 'pin-category'), checkbox = node('input'); checkbox.type = 'checkbox';
      label.append(checkbox);
      const fallback = placeholderPicture(`pin-${legendGroupByCategory.get(category.id)?.id ?? 'other'}`);
      const suppliedIcon = localMapAssetPath(category.icon);
      const iconPath = suppliedIcon ? resolvePicture(suppliedIcon, fallback) : null;
      if (iconPath) { const image = node('img'); image.loading = 'lazy'; image.src = iconPath; if (image.dataset) image.dataset.artFallback = fallback; image.alt = ''; image.width = 24; image.height = 24; label.append(image); }
      else { const marker = node('i', undefined, 'pin-unmapped-icon'); marker.setAttribute('aria-hidden', 'true'); label.append(marker); }
      label.append(node('span', category.label), node('span', counts.get(category.id) ?? 0, 'pin-count'));
      // Types with no surface pins in this snapshot only add noise to the list.
      if (!counts.get(category.id)) label.hidden = true;
      checkbox.addEventListener('change', () => { const selected = new Set(filters.categoryIds); if (checkbox.checked) selected.add(category.id); else selected.delete(category.id); update({ categoryIds: [...selected] }); });
      categoryControls.set(category.id, checkbox); contents.append(label);
    }
  }
  const status = node('p', undefined, 'status-detail'); status.setAttribute('role', 'status');
  const results = node('div', undefined, 'pin-results'); results.setAttribute('aria-label', 'Matching map icons');
  const selection = node('div', undefined, 'pin-selection');
  const hidden = node('details', undefined, 'pin-hidden'), hiddenTitle = node('summary'), hiddenResults = node('div', undefined, 'pin-results');
  hidden.append(hiddenTitle, hiddenResults);
  const sourceButton = action('About / Map sources', onSources, 'pin-source-button');
  const travel = createTravelLinesControl(map);
  const about = node('details', undefined, 'pin-about'); about.append(node('summary', 'About map icons'), note, coverage, sourceButton);
  panel.replaceChildren(header, travel, description, searchLabel, search, controls, status, results, selection, legend, hidden, about);
  panel.setAttribute('aria-labelledby', title.id);
  function pinName(pin) { return pin.label || byCategory.get(pin.categoryId)?.label || pin.categoryId; }
  function subtitle(pin) {
    const category = byCategory.get(pin.categoryId)?.label ?? 'Other icon';
    const place = map.model?.world?.chunks?.get(pin.chunkId)?.name;
    return `${category} · ${place ?? `Chunk ${pin.chunkId ?? 'unknown'}`}${advanced() ? ` · Sprite ${pin.spriteId ?? 'unknown'} · ${pin.x ?? pin.worldX}, ${pin.y ?? pin.worldY}` : ''}`;
  }
  function renderRows(target, rows, restoring = false) {
    target.replaceChildren();
    for (const pin of rows.slice(0, resultLimit)) {
      const row = node('div', undefined, 'pin-result');
      const focus = action(pinName(pin), () => {
        selectedPin = pin; map.focusPin(pin.id); renderSelection();
        if (!restoring && map.width < panel.getBoundingClientRect().width * 2 + 24) { close(); map.hoverCanvas?.focus({ preventScroll: true }); }
      }, 'pin-result-focus');
      focus.append(node('small', subtitle(pin))); row.append(focus);
      if (restoring) row.append(action('Show', () => update({ hiddenPinIds: filters.hiddenPinIds.filter(id => id !== pin.id) })));
      target.append(row);
    }
    if (rows.length > resultLimit) target.append(action(`Show more (${rows.length - resultLimit} remaining)`, () => { resultLimit += 30; render(); }));
  }
  function renderSelection() {
    selection.replaceChildren(); if (!selectedPin) return;
    selection.append(node('strong', pinName(selectedPin)), node('p', subtitle(selectedPin), 'status-detail'));
    const hiddenPin = filters.hiddenPinIds.includes(selectedPin.id);
    selection.append(action(hiddenPin ? 'Show this pin' : 'Hide this pin', () => update({ hiddenPinIds: hiddenPin ? filters.hiddenPinIds.filter(id => id !== selectedPin.id) : [...filters.hiddenPinIds, selectedPin.id] })),
      action('Show only this type', () => update({ categoryIds: [selectedPin.categoryId] })));
  }
  function render() {
    description.title = advanced() ? (dataset.sourceKind === 'copied-cache' ? 'Source: cache export' : 'Source: snapshot') : '';
    const selectionState = categorySelection(filters.categoryIds, categories);
    all.checked = selectionState.checked; all.indeterminate = selectionState.indeterminate;
    categoryTitle.textContent = `Categories (${filters.categoryIds.length} of ${categories.length} shown)`;
    for (const [id, checkbox] of categoryControls) checkbox.checked = filters.categoryIds.includes(id);
    for (const group of groups) {
      const controls = groupControls.get(group.id), state = categorySelection(filters.categoryIds, group.categories);
      controls.checkbox.checked = state.checked; controls.checkbox.indeterminate = state.indeterminate;
      controls.details.open = filters.expandedGroupIds.includes(group.id);
      const shown = group.categories.filter(category => filters.categoryIds.includes(category.id)).length;
      const pinCount = group.categories.reduce((total, category) => total + (counts.get(category.id) ?? 0), 0);
      const withPins = group.categories.filter(category => counts.get(category.id)), shownWithPins = withPins.filter(category => filters.categoryIds.includes(category.id)).length;
      controls.count.textContent = `${pinCount} pins · ${shownWithPins}/${withPins.length} types shown`;
    }
    const matches = filterPins(pins, filters, categories), hasSearch = !!normalizePinSearch(filters.search);
    status.textContent = hasSearch ? `${matches.length} matching icons. Select a result to center and highlight it.` : `${matches.length} enabled icons. Search to find a location; zoom in to see icons.`;
    if (hasSearch) { renderRows(results, matches); if (!matches.length) results.append(node('p', 'No matches. Try another term or show more categories.', 'status-detail')); }
    else results.replaceChildren();
    const hiddenMatches = filterPins(pins, filters, categories, { hidden: true });
    hiddenTitle.textContent = `Hidden pins (${filters.hiddenPinIds.length})`;
    renderRows(hiddenResults, hiddenMatches, true);
    if (!hiddenMatches.length) hiddenResults.append(node('p', filters.search ? 'No hidden pins match this search.' : 'No individually hidden pins.', 'status-detail'));
    renderSelection();
  }
  function update(next) { filters = normalizePinPreferences({ ...filters, ...next }, categories, pins); writePinPreferences(storage, filters); map.setPinFilters(filters); render(); }
  search.addEventListener('input', () => { resultLimit = 30; update({ search: search.value }); });
  toggle.hidden = false;
  toggle.addEventListener('click', () => { if (!panel.hidden) close(); else { render(); panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); search.focus(); } });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  map.setPinFilters(filters); render();
  return { close, filters: () => filters };
}
