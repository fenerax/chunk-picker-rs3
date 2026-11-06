const projections = new WeakMap();

// Cached explanations are provisional until the live read validates them.
// Paint the visible Updating label and cached content together, including when
// the cache belongs to an older revision of this same authenticated scope.
export function paintExplanationPreview(panel, { cache, view, key, revision, status, checking, lastKnown, render }) {
  const entry = cache?.peek(view, key, revision), cached = entry?.revision <= revision ? entry : undefined;
  status.textContent = cached ? `Updating… · Last known ${lastKnown}` : checking;
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  panel.replaceChildren(status);
  if (cached) panel.append(render(cached.value));
}

/** Migration evidence belongs to durable saves and import details, not display state. */
function browserProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') return provenance;
  if (projections.has(provenance)) return projections.get(provenance);
  const incoming = provenance.restore?.incomingProvenance;
  const projectedIncoming = browserProvenance(incoming);
  const changed = Object.hasOwn(provenance, 'originalPasteImports') || Object.hasOwn(provenance, 'taskIdentityMigration') || incoming !== projectedIncoming;
  let display = provenance;
  if (changed) {
    const { taskIdentityMigration, originalPasteImports, ...retained } = provenance;
    display = retained;
    if (incoming !== projectedIncoming) display.restore = { ...provenance.restore, incomingProvenance: projectedIncoming };
  }
  projections.set(provenance, display);
  return display;
}

export function projectBrowserState(state) {
  const provenance = browserProvenance(state?.provenance);
  return provenance === state?.provenance ? state : { ...state, provenance };
}

// Display-only JSON. Nothing read here can acknowledge a save or satisfy a
// calculator/command guard. One authenticated member scope, bounded in both tiers.
export function createViewCache({ storage = indexedViewStorage(), maxBytes = 8 * 1024 * 1024, maxEntries = 64,
  entryBytes = 2 * 1024 * 1024, persistentBytes = 512 * 1024, persistentEntryBytes = 96 * 1024 } = {}) {
  let scope, epoch = 0, bytes = 0, loaded, writing = Promise.resolve();
  const entries = new Map();
  const id = (view, key, revision) => JSON.stringify([view, key, revision]);
  const persist = () => {
    const captured = scope, generation = epoch;
    if (!captured) return;
    // Serialize writes, including clearing a
    // retired scope, so a late IDB operation cannot resurrect another actor's data.
    writing = writing.catch(() => {}).then(() => {
      if (generation !== epoch) return;
      let size = 0;
      const small = [...entries.values()].reverse().filter(row => row.bytes <= persistentEntryBytes && (size += row.bytes) <= persistentBytes);
      return storage?.write({ scope: captured, entries: small });
    }).catch(() => {});
  };
  function configure(value) {
    const next = JSON.stringify(value);
    if (next === scope) return;
    const hadScope = scope !== undefined;
    scope = next; epoch++; bytes = 0; entries.clear(); loaded = undefined;
    if (hadScope) persist();
  }
  function remember(view, key, revision, value, { persist: durable = true } = {}) {
    if (!scope || !Number.isSafeInteger(revision)) return;
    let json; try { json = JSON.stringify(value); } catch { return; }
    if (typeof json !== 'string' || json.length * 2 > entryBytes) return;
    const identifier = id(view, key, revision), previous = entries.get(identifier);
    if (previous) { bytes -= previous.bytes; entries.delete(identifier); }
    const row = { view, key, revision, value: JSON.parse(json), bytes: json.length * 2 };
    entries.set(identifier, row); bytes += row.bytes;
    while (bytes > maxBytes || entries.size > maxEntries) {
      const first = entries.keys().next().value; bytes -= entries.get(first).bytes; entries.delete(first);
    }
    if (durable) persist();
  }
  function peek(view, key, revision) {
    if (!scope) return;
    const exact = entries.get(id(view, key, revision));
    const row = exact ?? [...entries.values()].reverse().find(row => row.view === view && row.key === key && row.revision <= revision);
    // Always provisional, even on the exact revision, until a live read validates it.
    return row ? { value: row.value, revision: row.revision, updating: true } : undefined;
  }
  function hydrate() {
    if (!scope) return Promise.resolve();
    if (!loaded) {
      const captured = scope, generation = epoch;
      loaded = writing.catch(() => {}).then(() => storage?.read()).then(record => {
        if (generation !== epoch) return;
        if (record?.scope !== captured) { persist(); return; }
        for (const row of (Array.isArray(record.entries) ? record.entries : []).slice(0, maxEntries).reverse()) {
          if (!entries.has(id(row.view, row.key, row.revision))) remember(row.view, row.key, row.revision, row.value, { persist: false });
        }
      }).catch(() => {});
    }
    return loaded;
  }
  // Resolves once the stored snapshot is gone (or the store refused), so
  // sign-out can wait for it before leaving the page.
  function clear() { scope = undefined; epoch++; bytes = 0; entries.clear(); loaded = undefined; writing = writing.catch(() => {}).then(() => storage?.write(null)).catch(() => {}); return writing; }
  return { configure, remember, peek, hydrate, clear, token: () => epoch, current: token => token === epoch,
    stats: () => ({ entries: entries.size, bytes }), flushed: () => writing };
}

// One small snapshot, no credentials or auth tokens. Blocked/disabled/quota-full
// IDB is optional and never delays a live request or initial shell paint.
export function indexedViewStorage(indexedDB = globalThis.indexedDB) {
  let opening;
  function open() {
    if (!indexedDB) return Promise.resolve();
    return opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('picker-display-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('display');
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }
  async function transaction(mode, value) {
    const db = await open(); if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('display', mode), store = tx.objectStore('display');
      const request = mode === 'readonly' ? store.get('current') : value ? store.put(value, 'current') : store.delete('current');
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  return { read: () => transaction('readonly'), write: value => transaction('readwrite', value) };
}

// Preserve the focused control, disclosure folds and scroll while replacing a
// result. Equal responses keep the original DOM and event handlers altogether.
export function replaceView(host, render, document = globalThis.document) {
  const active = document?.activeElement, inside = active && host.contains?.(active);
  const controls = () => [...(host.querySelectorAll?.('input,select,textarea,button,a,summary') ?? [])];
  // Stable keys first (data-view-key, id); visible text alone can match a
  // different action, so text is only a fallback for unkeyed controls.
  const identity = node => [node.tagName, node.dataset?.viewKey ? `key:${node.dataset.viewKey}` : node.id ? `id:${node.id}` : `text:${node.getAttribute?.('aria-label') || node.textContent}`].join('|');
  const filterValue = inside && active.type === 'search' ? active.value : undefined;
  const key = inside ? identity(active) : undefined, selection = inside ? [active.selectionStart, active.selectionEnd] : [];
  const folds = [...(host.querySelectorAll?.('details') ?? [])].map(node => node.open);
  const scroll = host.scrollTop;
  render();
  [...(host.querySelectorAll?.('details') ?? [])].forEach((node, index) => { if (folds[index] !== undefined) node.open = folds[index]; });
  if (inside) {
    const next = controls().find(node => identity(node) === key);
    if (next) {
      if (filterValue !== undefined) { next.value = filterValue; next.dispatchEvent?.(new Event('input')); }
      next.focus?.({ preventScroll: true });
    } else { host.tabIndex = -1; host.focus?.({ preventScroll: true }); }
    if (Number.isInteger(selection[0])) try { next?.setSelectionRange?.(...selection); } catch { /* Non-text controls. */ }
  }
  host.scrollTop = scroll;
}
