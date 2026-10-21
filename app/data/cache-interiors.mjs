import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/cache-interiors.2026-10-08.v2.json");
/** Advisory display metadata; this module never participates in access rules. */
export const CACHE_INTERIORS = catalogue;
export default catalogue;
