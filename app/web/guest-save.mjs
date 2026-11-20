const MAX_BYTES = 2 * 1024 ** 2;

export function downloadRawText(text, filename, { document = globalThis.document, URL: urlApi = globalThis.URL, Blob: BlobCtor = globalThis.Blob } = {}) {
  const href = urlApi.createObjectURL(new BlobCtor([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href, download: filename });
  link.click();
  setTimeout(() => urlApi.revokeObjectURL(href), 1000).unref?.();
}

export function showGuestStartupRecovery({ error, document = globalThis.document, download = downloadRawText,
  confirm: ask = message => globalThis.confirm?.(message) ?? false, reload = () => globalThis.location.reload(),
  locks } = {}) {
  const recovery = error?.guestRecovery;
  const panel = document?.getElementById?.('startup-error');
  if (!recovery || recovery.raw == null || !panel) return false;
  const lockApi = locks ?? recovery.locks ?? globalThis.navigator?.locks;
  const actions = document.createElement('div');
  actions.className = 'guest-recovery-actions';
  const status = document.createElement('p');
  status.className = 'guest-recovery-status';
  status.setAttribute?.('role', 'status');
  status.hidden = true;
  const rawButton = document.createElement('button');
  rawButton.textContent = 'Download raw browser save';
  rawButton.addEventListener('click', () => download(recovery.raw, 'chunk-picker-guest-recovery.json'));
  const resetButton = document.createElement('button');
  resetButton.textContent = 'Start a fresh map';
  resetButton.addEventListener('click', async () => {
    if (!ask('Remove the unreadable browser save and start a fresh map? Download the raw copy first if you want to keep it.')) return;
    resetButton.disabled = true;
    try {
      if (!lockApi) throw new Error('This browser cannot safely reset guest progress across tabs. Use a current browser with Web Locks support.');
      await lockApi.request(recovery.key, () => recovery.save.clearIfUnchanged(recovery.raw, recovery.key));
      reload();
    } catch (resetError) {
      status.textContent = resetError?.message ?? 'This save changed in another tab. Reload before replacing it.';
      status.hidden = false;
    } finally {
      resetButton.disabled = false;
    }
  });
  actions.append(rawButton, resetButton);
  panel.append(actions, status);
  return true;
}

function olderSaveLabel(entry) {
  const shortDigest = entry.digest ? entry.digest.slice(0, 8) : 'previous';
  if (!entry.readable) return `Unreadable save (${shortDigest})`;
  return `${entry.unlockedCount} unlocked ${entry.unlockedCount === 1 ? 'chunk' : 'chunks'}, revision ${entry.revision} (${shortDigest})`;
}

export function chooseOlderGuestSave({ olderSaves, document = globalThis.document, download = downloadRawText } = {}) {
  const panel = document?.getElementById?.('startup-error');
  if (!panel || !olderSaves?.length) return Promise.resolve({ action: 'fresh' });
  return new Promise(resolve => {
    let selected = olderSaves[0];
    const heading = document.createElement('h2');
    heading.textContent = olderSaves.length > 1 ? 'Older browser saves found' : 'Older browser save found';
    const detail = document.createElement('p');
    const actions = document.createElement('div');
    actions.className = 'guest-recovery-actions';
    const finish = choice => { panel.hidden = true; panel.replaceChildren(); resolve(choice); };
    const saveCopy = document.createElement('button');
    saveCopy.textContent = 'Download older save';
    saveCopy.addEventListener('click', () => download(selected.raw, 'chunk-picker-guest-recovery.json'));
    const upgrade = document.createElement('button');
    upgrade.textContent = 'Upgrade and continue';
    upgrade.addEventListener('click', () => { if (selected.readable) finish({ action: 'upgrade', save: selected }); });
    const fresh = document.createElement('button');
    fresh.textContent = 'Start a fresh map';
    fresh.addEventListener('click', () => finish({ action: 'fresh' }));
    actions.append(saveCopy, upgrade, fresh);
    const syncSelection = () => {
      detail.textContent = selected.readable
        ? `The game data updated since your last visit. Your previous browser save (${selected.unlockedCount} unlocked ${selected.unlockedCount === 1 ? 'chunk' : 'chunks'}, revision ${selected.revision}) can be downloaded or upgraded to the current dataset.`
        : 'The game data updated since your last visit, and the selected browser save could not be read automatically. Download its raw bytes before starting a fresh map.';
      upgrade.hidden = !selected.readable;
      upgrade.disabled = !selected.readable;
    };
    const nodes = [heading, detail];
    if (olderSaves.length > 1) {
      const label = document.createElement('label');
      label.textContent = 'Saved map ';
      const picker = document.createElement('select');
      picker.setAttribute?.('aria-label', 'Older browser save');
      olderSaves.forEach((entry, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = olderSaveLabel(entry);
        picker.append(option);
      });
      picker.value = '0';
      picker.addEventListener('change', () => {
        selected = olderSaves[Number(picker.value)] ?? olderSaves[0];
        syncSelection();
      });
      label.append(picker);
      nodes.push(label);
    }
    syncSelection();
    nodes.push(actions);
    panel.replaceChildren(...nodes);
    panel.hidden = false;
  });
}

export function createGuestSave(storage, dataset, { now = Date.now } = {}) {
  const prefix = `rs3:guest:${dataset.id}:`;
  const key = `${prefix}${dataset.digest}`;
  const recencyKey = `rs3:guest-saved-at:${dataset.id}`;
  let base;
  function readRecency() {
    try {
      const parsed = JSON.parse(storage.getItem(recencyKey) ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  function recordRecency() {
    try {
      const map = readRecency();
      map[dataset.digest] = now();
      storage.setItem(recencyKey, JSON.stringify(map));
    } catch { /* Best-effort metadata must never fail a save commit. */ }
  }
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
    const recency = readRecency();
    try {
      for (let index = 0; index < storage.length; index++) {
        const entryKey = storage.key(index);
        if (typeof entryKey !== 'string' || !entryKey.startsWith(prefix) || entryKey === key) continue;
        const raw = storage.getItem(entryKey);
        if (typeof raw !== 'string') continue;
        const digest = entryKey.slice(prefix.length);
        const savedAt = Number(recency[digest]) || 0;
        try {
          const backup = parseEnvelope(raw, { allowOlderDigest: true });
          const member = backup.state.members[0];
          found.push({ key: entryKey, digest, raw, backup, readable: true, savedAt,
            revision: Number(backup.state.revision) || 0,
            unlockedCount: Array.isArray(member?.unlocked) ? member.unlocked.length : 0 });
        } catch {
          found.push({ key: entryKey, digest, raw, backup: null, readable: false, savedAt, revision: -1, unlockedCount: 0 });
        }
      }
    } catch { return []; }
    return found.sort((a, b) => b.savedAt - a.savedAt || Number(b.readable) - Number(a.readable) || b.revision - a.revision || b.unlockedCount - a.unlockedCount || a.key.localeCompare(b.key));
  }
  return {
    key,
    load() { base = read(); return base === null ? null : validate(base); },
    raw(targetKey = key) { try { return storage.getItem(targetKey); } catch { return null; } },
    commit(backup) {
      const raw = JSON.stringify(backup); validate(raw);
      if (read() !== base) throw new Error('This save changed in another tab. Reload before making another change.');
      try { storage.setItem(key, raw); } catch { throw new Error('This change was not saved. Browser storage is full or blocked. Export your last saved copy, free space and reload.'); }
      recordRecency();
      base = raw; return backup;
    },
    parseImport: validate,
    parseForUpgrade: text => parseEnvelope(text, { allowOlderDigest: true }),
    findOlderSaves,
    clearIfUnchanged(expectedRaw, targetKey = key) {
      if (read(targetKey) !== expectedRaw) throw new Error('This save changed in another tab. Reload before replacing it.');
      try { storage.removeItem?.(targetKey); } catch { throw new Error('Browser storage is unavailable. Allow site storage, then reload.'); }
    },
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
