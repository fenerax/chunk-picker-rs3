const MAX_BYTES = 2 * 1024 ** 2;
export function createGuestSave(storage, dataset) {
  const key = `rs3:guest:${dataset.id}:${dataset.digest}`;
  let base;
  function validate(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES - 4096) throw new Error('This guest save is too large. Keep your exported copy; sign in to import it.');
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('This browser save cannot be read. Keep an exported copy before changing site data.'); }
    const identity = value?.state?.provenance?.dataset;
    if (value?.format !== 'rs3-chunk-picker' || value.schemaVersion !== 1 || value.state?.schemaVersion !== 1 ||
      value.state?.members?.length !== 1 || identity?.id !== dataset.id || identity.digest !== dataset.digest) throw new Error('Choose a portable solo save from this dataset. Your current save has not changed.');
    return value;
  }
  function read() {
    let raw;
    try { raw = storage.getItem(key); } catch { throw new Error('Browser storage is unavailable. Allow site storage, then reload.'); }
    return raw;
  }
  return {
    key,
    load() { base = read(); return base === null ? null : validate(base); },
    commit(backup) {
      const raw = JSON.stringify(backup); validate(raw);
      if (read() !== base) throw new Error('This save changed in another tab. Reload before making another change.');
      try { storage.setItem(key, raw); } catch { throw new Error('This change was not saved. Browser storage is full or blocked. Export your last saved copy, free space and reload.'); }
      base = raw; return backup;
    },
    parseImport: validate,
    exportText() {
      const raw = read();
      if (raw === null) throw new Error('No browser save is available to export yet.');
      // Even a corrupt save can be downloaded for recovery without overwriting it.
      return raw;
    },
    changed() { return read() !== base; },
  };
}
