import { datasetValue } from "../dataset-runtime.mjs";
// RuneScape Wiki numerical facts, CC BY-NC-SA 3.0. Checked 2026-10-12.
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));
export const FISHING_SPECIES = datasetValue("app/training/fishing-rules.mjs#FISHING_SPECIES");
const species = new Map(FISHING_SPECIES.map(row => [row.id, row]));
export const FISHING_METHODS = datasetValue("app/training/fishing-rules.mjs#FISHING_METHODS");
export const FISHING_BOUNDS = datasetValue("app/training/fishing-rules.mjs#FISHING_BOUNDS");
export const FISHING_FORMULA = datasetValue("app/training/fishing-rules.mjs#FISHING_FORMULA");
export const FISHING_UNMODELLED_METHODS = datasetValue("app/training/fishing-rules.mjs#FISHING_UNMODELLED_METHODS");
export const FISHING_SOURCES = datasetValue("app/training/fishing-rules.mjs#FISHING_SOURCES");
