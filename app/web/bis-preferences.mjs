const storageKey = 'rs3:bis-preferences:v1';

// Like Activity Info filters, this is a viewer's browser preference, not a save.
export function readBiSPreferences(storage) {
  try { return { hideObtained: JSON.parse((storage ?? globalThis.localStorage)?.getItem(storageKey) ?? 'null')?.hideObtained === true }; }
  catch { return { hideObtained: false }; }
}

export function writeBiSPreferences(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(storageKey, JSON.stringify({ hideObtained: value.hideObtained === true })); }
  catch { /* The control remains usable when browser storage is unavailable. */ }
}
