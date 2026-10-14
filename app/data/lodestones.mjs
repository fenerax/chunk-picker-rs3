import { datasetValue } from "../dataset-runtime.mjs";
// Retained Diary achievements supply authored selectors, not audited geometry.
// Current Wiki scenery coordinates corroborate all surface base regions except
// retained Anachronia, corrected below. See cache-lodestone-corrections review.
// City of Um is underground and deliberately outside this surface travel table.
export const surfaceLodestones = datasetValue("app/data/lodestones.mjs#surfaceLodestones");

// Explicit before-state for correction previews; never selected by saved state.
export const preCorrectionSurfaceLodestones = datasetValue("app/data/lodestones.mjs#preCorrectionSurfaceLodestones");
