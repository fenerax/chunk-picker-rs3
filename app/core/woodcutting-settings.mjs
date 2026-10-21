import { datasetValue, datasetRuleDefinitions } from "../dataset-runtime.mjs";
import { WOODCUTTING_HATCHETS } from '../training/woodcutting-rates.mjs';

// Personal estimate choices do not record tool ownership.
export const woodcuttingSettingDefinitions = datasetRuleDefinitions("app/core/woodcutting-settings.mjs#woodcuttingSettingDefinitions");
