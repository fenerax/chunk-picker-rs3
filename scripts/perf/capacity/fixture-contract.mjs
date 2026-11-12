import { SCHEMA_VERSION } from '../../../app/core/state.mjs';
import { COMPLETION_BACKUP_VERSION } from '../../../app/storage/completion-codec.mjs';
import { OWNED_STORAGE_SCHEMA_VERSION, OWNED_BASE_FORMAT, OWNED_BASE_GENERATOR_VERSION } from '../../../app/storage/owned-base-schema.mjs';

// There is no application constant for synthetic builder semantics. The tiny
// generated-output goldens in capacity-fixture-reuse.test.mjs guard this number.
// Missing fields in seals from the original builder mean content version 1.
export const fixtureContentVersion = 1;
// store.mjs has no exported version for flat static-field metadata. The tiny
// format-1 golden deliberately exceeds its static threshold and pins this too.
const flatStatic = 1;
export const fixtureStorageSchema = format => ({ state: SCHEMA_VERSION, completion: COMPLETION_BACKUP_VERSION, flatStatic,
  ...(format === 'format2' ? { owned: OWNED_STORAGE_SCHEMA_VERSION, base: OWNED_BASE_FORMAT,
    baseGenerator: OWNED_BASE_GENERATOR_VERSION } : {}) });

// Historical writer versions, not defaults from today's implementation. This
// lets original seals refuse a future schema change without being resealed.
export const legacyFixtureStorageSchema = format => ({ state: 1, completion: 2, flatStatic: 1,
  ...(format === 'format2' ? { owned: 2, base: 1, baseGenerator: 1 } : {}) });
