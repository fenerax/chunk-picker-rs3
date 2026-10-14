import { datasetValue } from "../dataset-runtime.mjs";
// Positive entry evidence for retained surface destinations with no witnessed
// plane-0 boundary. This certifies a destination, not personal route availability
// or a cache-label/legacy-section correspondence. It adds no walking edges.
// Wiki revisions were retrieved through the public API on 2026-10-08 UTC.
const entry = (location, kind, page, revision, detail, conditions = '') => Object.freeze({
  location, kind, evidence: `https://runescape.wiki/w/${encodeURIComponent(page.replaceAll(' ', '_'))}?oldid=${revision}`,
  detail, conditions, verifiedOn: '2026-10-08',
});

export const cacheEntryPolicies = datasetValue("app/data/cache-entry-policy.mjs#cacheEntryPolicies");

export const cacheEntryKinds = datasetValue("app/data/cache-entry-policy.mjs#cacheEntryKinds");

// The only transport admission switch. Classification/entry evidence above is
// always descriptive; routes affect rolls, access and tasks only when this
// boolean rule is explicitly true. Walking topology never includes these edges.
export const TRANSPORT_ACCESS_RULE = datasetValue("app/data/cache-entry-policy.mjs#TRANSPORT_ACCESS_RULE");
export const TRANSPORT_MASK_SHA256 = datasetValue("app/data/cache-entry-policy.mjs#TRANSPORT_MASK_SHA256");
export const TRANSPORT_RUNTIME_SHA256 = datasetValue("app/data/cache-entry-policy.mjs#TRANSPORT_RUNTIME_SHA256");

export const cacheNonEntryPolicies = datasetValue("app/data/cache-entry-policy.mjs#cacheNonEntryPolicies");
