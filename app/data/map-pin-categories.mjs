import { datasetValue } from "../dataset-runtime.mjs";
// Reviewed against each linked Wiki file's {{Minimap icon license|...|id=...}}.
// Numeric cache categories are translated only through the explicit reviewed join below.
const entries = datasetValue("app/data/map-pin-categories.mjs#entries");

// Picker legend groups use reviewed, named categories only. These are UI groups,
// not translations of the source snapshot's numeric category IDs. Keep the
// original Wiki section (`group`) as provenance for existing asset manifests.
export const MAP_PIN_LEGEND_GROUPS = datasetValue("app/data/map-pin-categories.mjs#MAP_PIN_LEGEND_GROUPS");

// Cache categories are joined to the reviewed 2021 sprite taxonomy, then
// confirmed against current map-element defaults. State-specific sprites win.
// See docs/research/cache-pins-application.md for the bounded evidence.
export const CACHE_PIN_CATEGORY_IDS = datasetValue("app/data/map-pin-categories.mjs#CACHE_PIN_CATEGORY_IDS");
const cacheSpriteCategories = datasetValue("app/data/map-pin-categories.mjs#cacheSpriteCategories");

const legendGroupByCategory = new Map(MAP_PIN_LEGEND_GROUPS.flatMap(group => group.categoryIds.map(id => [id, group.id])));

export const MAP_PIN_CATEGORIES = datasetValue("app/data/map-pin-categories.mjs#MAP_PIN_CATEGORIES");

export function categoryForSprite(spriteId) {
  return MAP_PIN_CATEGORIES.find(category => category.spriteIds.includes(spriteId)) ?? MAP_PIN_CATEGORIES.at(-1);
}

/** Exact artwork identity takes precedence over a reviewed numeric fallback. */
export function categoryForCachePin(pin) {
  const spriteCategory = categoryForSprite(pin.spriteId);
  if (spriteCategory.id !== 'other') return spriteCategory;
  const id = CACHE_PIN_CATEGORY_IDS[pin.category];
  return MAP_PIN_CATEGORIES.find(category => category.id === id) ?? MAP_PIN_CATEGORIES.at(-1);
}
