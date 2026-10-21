// Captured source bytes remain the authority for historical immutable receipts.
const snapshots = new Set(["app/data/equipment-permanence.mjs", "scripts/update-identities.mjs", "scripts/compare-original-data.mjs"]);
export const datasetSourceEvidence = source => snapshots.has(source) ? `docs/research/dataset-seam-source-2026-10-13/${source}` : source;
