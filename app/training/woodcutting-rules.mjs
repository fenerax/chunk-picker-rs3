import { datasetValue } from "../dataset-runtime.mjs";
// RuneScape Wiki numerical facts, CC BY-NC-SA 3.0. Checked 2026-10-12.
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));
export const WOODCUTTING_HATCHETS = datasetValue("app/training/woodcutting-rules.mjs#WOODCUTTING_HATCHETS");
export const WOODCUTTING_TREES = datasetValue("app/training/woodcutting-rules.mjs#WOODCUTTING_TREES");
export const WOODCUTTING_BOUNDS = datasetValue("app/training/woodcutting-rules.mjs#WOODCUTTING_BOUNDS");
// The separate Dungeoneering system has finite, non-respawning nodes and lacks
// sourced success endpoints here. Coverage is explicit without fabricating rates.
export const WOODCUTTING_UNMODELLED_TREES = datasetValue("app/training/woodcutting-rules.mjs#WOODCUTTING_UNMODELLED_TREES");
export const WOODCUTTING_FORMULA = datasetValue("app/training/woodcutting-rules.mjs#WOODCUTTING_FORMULA");
export const WOODCUTTING_SOURCES = datasetValue("app/training/woodcutting-rules.mjs#WOODCUTTING_SOURCES");
