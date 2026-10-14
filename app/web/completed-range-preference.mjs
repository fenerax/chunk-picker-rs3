import { normalizeCompletedRange } from './completed-range.mjs';

export const completedRangePreferenceKey = 'picker.completed-range';

// This display choice belongs to the browser, including view-only sessions.
// It never enters shared state, History, backups or the gameplay fingerprint.
export function createCompletedRangePreference(storage) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let value = 'all';
  try { value = normalizeCompletedRange(storage?.getItem(completedRangePreferenceKey)); if (value === 'custom') value = 'all'; } catch { /* Use All time when storage is unavailable. */ }
  return {
    get: () => value,
    set(next) {
      value = normalizeCompletedRange(next);
      // Custom bounds stay in the open review; reload restores the last quick choice.
      try { if (value !== 'custom') storage?.setItem(completedRangePreferenceKey, value); } catch { /* Keep the current page usable. */ }
    },
  };
}
