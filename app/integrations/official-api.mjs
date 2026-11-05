import { createPlatformApiClient } from './platform-api.mjs';

// Compatibility factory for callers using the former replacement-API slot.
export function createOfficialApiSource(options) {
  return createPlatformApiClient(options);
}
