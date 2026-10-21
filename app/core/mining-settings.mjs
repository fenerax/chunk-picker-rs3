import { datasetValue, datasetRuleDefinitions } from "../dataset-runtime.mjs";
import { MINING_PICKAXES, MINING_PROFILES } from '../training/mining-rates.mjs';

// These are personal estimate choices, not an inventory or equipment record.
// Defaults remain fallbacks so an assumed pickaxe can improve as levels rise.
export const miningSettingDefinitions = datasetRuleDefinitions("app/core/mining-settings.mjs#miningSettingDefinitions");
