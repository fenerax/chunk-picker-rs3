import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/item-membership-review.2026-10-12.v1.json");
import { normalizeItemMembershipName } from './item-membership-index.mjs';

export const itemMembershipReviewCatalogue = catalogue;
const physicalKinds = new Set(['item', 'item-family', 'progress-item']);
const indexes = new WeakMap();
export function itemMembershipReview(name, { catalogue = itemMembershipReviewCatalogue, physical = false } = {}) {
  if (!catalogue) return null;
  let index = indexes.get(catalogue);
  if (!index) {
    const exact = new Map(catalogue.entries.map(row => [row.name, row])), folded = new Map();
    for (const row of exact.values()) if (physicalKinds.has(row.kind)) {
      const key = row.name.toLocaleLowerCase('en'), rows = folded.get(key) ?? [];
      rows.push(row); folded.set(key, rows);
    }
    index = { exact, folded }; indexes.set(catalogue, index);
  }
  const normalized = normalizeItemMembershipName(name), candidates = physical ? index.folded.get(normalized.toLocaleLowerCase('en')) ?? [] : [];
  const row = index.exact.get(normalized) ?? (candidates.length === 1 ? candidates[0] : null);
  return row && (!physical || physicalKinds.has(row.kind)) ? row : null;
}
