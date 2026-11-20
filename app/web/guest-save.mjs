const MAX_BYTES = 2 * 1024 ** 2;

export function downloadRawText(text, filename, { document = globalThis.document, URL: urlApi = globalThis.URL, Blob: BlobCtor = globalThis.Blob } = {}) {
  const href = urlApi.createObjectURL(new BlobCtor([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href, download: filename });
  link.click();
  setTimeout(() => urlApi.revokeObjectURL(href), 1000).unref?.();
}

export function showGuestStartupRecovery({ error, document = globalThis.document, download = downloadRawText,
  confirm: ask = message => globalThis.confirm?.(message) ?? false, reload = () => globalThis.location.reload() } = {}) {
  const recovery = error?.guestRecovery;
  const panel = document?.getElementById?.('startup-error');
  if (!recovery || recovery.raw == null || !panel) return false;
  const actions = document.createElement('div');
  actions.className = 'guest-recovery-actions';
  const rawButton = document.createElement('button');
  rawButton.textContent = 'Download raw browser save';
  rawButton.addEventListener('click', () => download(recovery.raw, 'chunk-picker-guest-recovery.json'));
  const resetButton = document.createElement('button');
  resetButton.textContent = 'Start a fresh map';
  resetButton.addEventListener('click', () => {
    if (!ask('Remove the unreadable browser save and start a fresh map? Download the raw copy first if you want to keep it.')) return;
    recovery.save.clearKey(recovery.key);
    reload();
  });
  actions.append(rawButton, resetButton);
  panel.append(actions);
  return true;
}

export function chooseOlderGuestSave({ olderSaves, document = globalThis.document, download = downloadRawText } = {}) {
  const panel = document?.getElementById?.('startup-error');
  if (!panel || !olderSaves?.length) return Promise.resolve({ action: 'fresh' });
  const latest = olderSaves[0];
  return new Promise(resolve => {
    const heading = document.createElement('h2');
    heading.textContent = 'Older browser save found';
    const detail = document.createElement('p');
    detail.textContent = latest.readable
      ? `The game data updated since your last visit. Your previous browser save (${latest.unlockedCount} unlocked ${latest.unlockedCount === 1 ? 'chunk' : 'chunks'}, revision ${latest.revision}) can be downloaded or upgraded to the current dataset.`
      : 'The game data updated since your last visit, and your previous browser save could not be read automatically. Download its raw bytes before starting a fresh map.';
    const actions = document.createElement('div');
    actions.className = 'guest-recovery-actions';
    const finish = choice => { panel.hidden = true; panel.replaceChildren(); resolve(choice); };
    const saveCopy = document.createElement('button');
    saveCopy.textContent = 'Download older save';
    saveCopy.addEventListener('click', () => download(latest.raw, 'chunk-picker-guest-recovery.json'));
    actions.append(saveCopy);
    if (latest.readable) {
      const upgrade = document.createElement('button');
      upgrade.textContent = 'Upgrade and continue';
      upgrade.addEventListener('click', () => finish({ action: 'upgrade', save: latest }));
      actions.append(upgrade);
    }
    const fresh = document.createElement('button');
    fresh.textContent = 'Start a fresh map';
    fresh.addEventListener('click', () => finish({ action: 'fresh' }));
    actions.append(fresh);
    panel.replaceChildren(heading, detail, actions);
    panel.hidden = false;
  });
}

export function createGuestSave(storage, dataset) {
  const prefix = `rs3:guest:${dataset.id}:`;
  const key = `${prefix}${dataset.digest}`;
  let base;
  function parseEnvelope(text, { allowOlderDigest = false } = {}) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES - 4096) throw new Error('This guest save is too large. Keep your exported copy; sign in to import it.');
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('This browser save cannot be read. Keep an exported copy before changing site data.'); }
    const identity = value?.state?.provenance?.dataset;
    if (value?.format !== 'rs3-chunk-picker' || value.schemaVersion !== 1 || value.state?.schemaVersion !== 1 ||
      value.state?.members?.length !== 1 || identity?.id !== dataset.id || (!allowOlderDigest && identity.digest !== dataset.digest)) throw new Error('Choose a portable solo save from this dataset. Your current save has not changed.');
    return value;
  }
  const validate = text => parseEnvelope(text, { allowOlderDigest: false });
  function read(targetKey = key) {
    let raw;
    try { raw = storage.getItem(targetKey); } catch { throw new Error('Browser storage is unavailable. Allow site storage, then reload.'); }
    return raw;
  }
  function findOlderSaves() {
    const found = [];
    if (typeof storage?.length !== 'number' || typeof storage?.key !== 'function') return found;
    try {
      for (let index = 0; index < storage.length; index++) {
        const entryKey = storage.key(index);
        if (typeof entryKey !== 'string' || !entryKey.startsWith(prefix) || entryKey === key) continue;
        const raw = storage.getItem(entryKey);
        if (typeof raw !== 'string') continue;
        const digest = entryKey.slice(prefix.length);
        try {
          const backup = parseEnvelope(raw, { allowOlderDigest: true });
          const member = backup.state.members[0];
          found.push({ key: entryKey, digest, raw, backup, readable: true,
            revision: Number(backup.state.revision) || 0,
            unlockedCount: Array.isArray(member?.unlocked) ? member.unlocked.length : 0 });
        } catch {
          found.push({ key: entryKey, digest, raw, backup: null, readable: false, revision: -1, unlockedCount: 0 });
        }
      }
    } catch { return []; }
    return found.sort((a, b) => Number(b.readable) - Number(a.readable) || b.revision - a.revision || b.unlockedCount - a.unlockedCount || a.key.localeCompare(b.key));
  }
  return {
    key,
    load() { base = read(); return base === null ? null : validate(base); },
    raw(targetKey = key) { try { return storage.getItem(targetKey); } catch { return null; } },
    commit(backup) {
      const raw = JSON.stringify(backup); validate(raw);
      if (read() !== base) throw new Error('This save changed in another tab. Reload before making another change.');
      try { storage.setItem(key, raw); } catch { throw new Error('This change was not saved. Browser storage is full or blocked. Export your last saved copy, free space and reload.'); }
      base = raw; return backup;
    },
    parseImport: validate,
    parseForUpgrade: text => parseEnvelope(text, { allowOlderDigest: true }),
    findOlderSaves,
    clearKey(targetKey = key) { try { storage.removeItem?.(targetKey); } catch {} },
    exportText(targetKey = key) {
      const raw = read(targetKey);
      if (raw === null) throw new Error('No browser save is available to export yet.');
      // Even a corrupt save can be downloaded for recovery without overwriting it.
      return raw;
    },
    changed() { return read() !== base; },
  };
}
