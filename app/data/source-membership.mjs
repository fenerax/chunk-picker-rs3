import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/source-membership.2026-10-08.v1.json");
const rowCatalogue = await datasetJSON("app/data/source-row-membership.2026-10-08.v1.json");
const methodRequirements = await datasetJSON("app/data/source-method-requirements.2026-10-08.v1.json");
const incidentalOutputs = await datasetJSON("app/data/source-incidental-outputs.2026-10-08.v1.json");
const monsterReview = await datasetJSON("app/data/monster-membership-review.2026-10-12.v1.json");
const itemReview = await datasetJSON("app/data/item-membership-review.2026-10-12.v1.json");

export const sourceMembershipCatalogue = catalogue;
export const monsterMembershipReviewCatalogue = monsterReview;
const key = (kind, source, category = '') => `${kind}\u0000${category}\u0000${source}`;
const records = new Map(catalogue.records.map(row => [key(row.kind, row.source, row.category), row]));
for (const row of rowCatalogue.records) records.set(key(row.kind, row.source, row.category), row);
for (const row of monsterReview.records) records.set(key(row.kind, row.source, row.category), { ...row, verifiedOn: monsterReview.verifiedOn });
for (const row of itemReview.sourceRows) records.set(key(row.kind, row.source, row.category), { ...row, verifiedOn: itemReview.verifiedOn ?? itemReview.reviewedOn });

/** Explicitly verified global membership only. Existing location-specific
 * restrictions must still run separately; an F2P page cannot waive them.
 * Unknown/mixed pages provide review evidence, never an inferred restriction.
 */
export function sourceMembershipBlocker(kind, source, f2p, category = '') {
  if (!f2p) return null;
  const record = records.get(key(kind, source, category));
  if (record?.members !== true || !['verified-infobox', 'verified-row'].includes(record.status)) return null;
  const detail = kind === 'DropItem' ? `Members-only drop source for ${source}: ${category}.`
    : kind === 'ShopItem' ? `Members-only shop stock: ${source} at ${category}.`
      : kind === 'Task' ? `Members-only method: ${source}.`
        : kind === 'Area' ? `Members-only area: ${source}.`
          : `Members-only ${kind.toLowerCase()}: ${source}.`;
  return { kind, source, locations: null, verifiedOn: record.verifiedOn ?? catalogue.verifiedOn,
    evidence: record.wiki.url, detail, wiki: record.wiki };
}

export function sourceMembershipRecord(kind, source, category = '') {
  return records.get(key(kind, source, category)) ?? null;
}

/** Fill only the reviewed missing supply field during F2P evaluation. This
 * method is explicitly free; the engine must check its supply through the item
 * membership policy rather than marking the engraving action members-only.
 */
export function sourceMembershipRequiredItems(category, label, record, f2p) {
  if (!f2p) return [];
  const policy = methodRequirements.records.find(row => row.category === category && row.source === label);
  if (!policy || Object.hasOwn(record, 'Items') !== policy.before.ItemsPresent || record.Level !== policy.before.Level) return [];
  return policy.requiredItems;
}

/** True only for a reviewed underlying method whose item output is incidental
 * loot. This never waives input, source, level or intrinsic method restrictions.
 * Member loot still must be removed by ordinary product/source admission.
 */
export function sourceMembershipIncidentalOutput(category, label, record, f2p) {
  if (!f2p) return false;
  const policy = incidentalOutputs.records.find(row => row.category === category && row.source === label);
  return Boolean(policy && Object.entries(policy.before).every(([field, before]) => Object.hasOwn(record, field) === before.present
    && (!before.present || JSON.stringify(record[field]) === JSON.stringify(before.value))));
}
