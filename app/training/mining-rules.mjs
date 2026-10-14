import { datasetValue } from "../dataset-runtime.mjs";
// Canonical sourced rules: RuneScape Wiki numerical facts, CC BY-NC-SA 3.0.
// Pinned source revisions below were checked on 2026-10-12.
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));
export const MINING_PICKAXES = datasetValue("app/training/mining-rules.mjs#MINING_PICKAXES");
export const MINING_ROCKS = datasetValue("app/training/mining-rules.mjs#MINING_ROCKS");
export const MINING_PROFILES = datasetValue("app/training/mining-rules.mjs#MINING_PROFILES");
export const MINING_STAMINA_MILESTONES = datasetValue("app/training/mining-rules.mjs#MINING_STAMINA_MILESTONES");

export const MINING_BOUNDS = datasetValue("app/training/mining-rules.mjs#MINING_BOUNDS");
export const MINING_CRITICAL_LEVELS = datasetValue("app/training/mining-rules.mjs#MINING_CRITICAL_LEVELS");
export const MINING_SOURCES = datasetValue("app/training/mining-rules.mjs#MINING_SOURCES");
