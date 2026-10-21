import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/cache-npcs.2026-10-08.v1.json");
const review = await datasetJSON("app/data/npc-metadata-corrections.2026-10-08.v1.json");

/** Metadata only: no placement, access, drop or task rules are changed. */
export function npcMetadataPayload({ data = catalogue, corrections = review.corrections } = {}) {
  const records = { ...data.records };
  for (const correction of corrections ?? []) {
    const record = records[correction.label];
    if (!record || record.consensusCombatLevel !== correction.combatLevel
      || !Number.isSafeInteger(correction.combatLevel) || correction.combatLevel <= 0) continue;
    const actual = record.candidates.map(row => row.id).sort((a, b) => a - b);
    const expected = [...correction.cacheIds].sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) continue;
    records[correction.label] = { ...record, reviewedMetadata: { combatLevel: correction.combatLevel,
      members: null, cache: correction.cache, wiki: correction.wiki } };
  }
  return { ...data, records, metadataOnly: true, spawnPositions: null };
}

const payload = npcMetadataPayload();
/** Exact authored label lookup keeps every variant available to the chunk panel.
 * Member-only actions are separate; overall membership remains unknown.
 */
export function lookupNpcMetadata(label) {
  return Object.hasOwn(payload.records, label) ? payload.records[label] : null;
}
