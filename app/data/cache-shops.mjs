import { datasetJSON, selectedDataset } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/cache-shops.2026-10-08.v1.json");

/** Stock replacement affects sources and tasks; operator opt-in is required. */
export function cacheShopContentsEnabled() {
  return selectedDataset.capabilities.cacheShops;
}

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const entries = value => Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
const equal = (a, b) => JSON.stringify(entries(a)) === JSON.stringify(entries(b));

/** Exact reviewed inventories only. Unmapped inventories never invent a shop.
 * Old-value guards preserve custom data, labels, chunk declarations and IDs.
 */
export function applyCacheShops(definitions, { enabled = cacheShopContentsEnabled(), shops = catalogue.shops, strict = false } = {}) {
  if (!enabled) return definitions;
  let result = definitions;
  for (const shop of shops ?? []) {
    if (shop.confidence !== 'reviewed-complete-stock') continue;
    if (typeof shop.name !== 'string' || !Array.isArray(shop.stock) || !plain(shop.reference?.beforeShopItems)) {
      throw new TypeError('Reviewed shop needs its exact retained stock precondition.');
    }
    const stock = {};
    for (const row of shop.stock) {
      if (typeof row.name !== 'string' || !row.name || !Number.isSafeInteger(row.baseStock) || row.baseStock < 0) {
        throw new TypeError(`Invalid reviewed stock: ${shop.name}`);
      }
      // A sold-out/default-zero slot does not establish an obtainable source.
      if (row.baseStock > 0) Object.defineProperty(stock, row.name, { value: true, enumerable: true, configurable: true, writable: true });
    }
    const original = result?.shopItems?.[shop.name];
    if (plain(original) && equal(original, stock)) continue;
    if (!plain(original) || !equal(original, shop.reference.beforeShopItems)) {
      if (strict) throw new TypeError(`Shop stock precondition drift: ${shop.name}`);
      continue;
    }
    if (result === definitions) result = { ...definitions, shopItems: { ...definitions.shopItems } };
    Object.defineProperty(result.shopItems, shop.name, { value: stock, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

export function shopMetadataPayload() {
  return { ...catalogue, contentsEnabled: cacheShopContentsEnabled(), switch: 'RS3_CACHE_SHOP_CONTENTS=1' };
}
