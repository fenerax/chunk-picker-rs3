import { canSaveAddress } from './save-address.mjs';
import { withStartupTimeout, startupRetryAfter } from '../startup-read.mjs';

// Live synchronization reports shared revisions; only the local attempt can
// clear a refused change or finish an in-flight save.
export function createSaveStatus(c) {
  let refused = false, saving = false;
  function saved(text, failed = false, revision, outcome = {}) {
    if (outcome.confirmed || outcome.resolved) { refused = false; saving = false; }
    if (text === 'Saving…') { refused = false; saving = true; }
    if (outcome.refused) { refused = true; saving = false; }
    const writable = c.canWrite(), pending = writable && c.hasPendingCommand?.();
    if (failed && !pending) saving = false;
    let status = failed ? 'failed' : 'saved';
    if (writable && !canSaveAddress()) {
      text = 'This address cannot save'; status = 'failed';
    } else if (pending && (c.pendingCommandPaused?.() || failed)) {
      text = c.pendingCommandPaused?.() ? 'Save not confirmed' : 'Save confirmation needed'; status = 'failed';
    } else if (refused) {
      text = 'Change refused · review'; status = 'failed';
    } else if (saving || pending) {
      text = 'Saving…'; status = 'saving';
    } else if (!writable && text === 'Saved') text = 'Live';
    const badge = c.$('save-status');
    badge.textContent = text; badge.dataset.status = status;
    badge.title = revision ? `Last confirmed revision ${revision}` : '';
  }
  c.reviewSaveRefusal = () => {
    if (!refused) return;
    refused = false; saved('Saved', false, c.state?.revision);
  };
  return saved;
}

// Only game preferences use this adapter. A page keeps one immutable picker scope.
let pickerId, stopped = false;
const listeners = new Set();
export function stopPickerStorage() { stopped = true; }
export function pickerStoragePrefix(id) { return `picker.scope.${encodeURIComponent(id)}.`; }
export function configurePickerStorage(id) {
  if (pickerId && pickerId !== id) throw new Error('Reload before changing picker.');
  pickerId = id;
  for (const listener of listeners) listener();
}
export function observePickerStorage(listener) { listeners.add(listener); }
export function gameStorage(storage = globalThis.localStorage) {
  if (!storage) return storage;
  return {
    getItem: key => stopped ? null : storage?.getItem(pickerId ? pickerStoragePrefix(pickerId) + key : key) ?? null,
    setItem: (key, value) => !stopped && storage?.setItem(pickerId ? pickerStoragePrefix(pickerId) + key : key, value),
    removeItem: key => !stopped && storage?.removeItem(pickerId ? pickerStoragePrefix(pickerId) + key : key),
  };
}
export function clearPickerStorage(storage, id) {
  const prefix = pickerStoragePrefix(id), keys = [];
  for (let i = 0; i < (storage?.length ?? 0); i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}


const sessionKey = 'picker.active-session.v1';
const changeKey = 'picker.session-change.v1';
const unsentMessage = 'Queued changes were not sent because the account or picker changed. A save already in flight may have arrived; check History before repeating it.';
const abandoned = () => Object.assign(new Error('The account or picker changed. Reload the picker.'), { name: 'AbortError' });
const identity = session => JSON.stringify([session.pickerId, session.accountId ?? session.account?.id, session.kind, session.memberId, session.readOnly, session.capabilities, session.actor?.kind ?? null, session.actor?.inviteId ?? null]);

// One document, one picker: no cache, controller or queued closure is transferred.
export function createScreenPickerSession(c, { fetch = (...args) => globalThis.fetch(...args),
  location = globalThis.location, notify = message => globalThis.alert?.(message),
  storage = () => globalThis.localStorage, tabStorage = () => globalThis.sessionStorage,
  schedule = globalThis.setInterval, cancel = globalThis.clearInterval } = {}) {
  let session, signature, stopped = false, checking, timer, queued = 0, commands, accountAction = false;
  const disposers = new Set(), requests = new Set();
  const safe = work => { try { return work(); } catch {} };
  const active = () => { if (stopped) throw abandoned(); };
  function clear(id) {
    clearPickerStorage(storage(), id); clearPickerStorage(tabStorage(), id);
  }
  function storedPending(id) {
    return safe(() => {
      const record = JSON.parse(tabStorage().getItem(pickerStoragePrefix(id) + 'picker.commandOutbox.v2') ?? 'null');
      return Boolean(record?.body || record?.unsent);
    });
  }
  function stop({ announce = true } = {}) {
    if (!session?.multiPicker || stopped) return;
    stopped = true; // Stop admission before aborts, storage cleanup or UI callbacks.
    const pending = queued > 0 || safe(() => commands?.pending()) || storedPending(session.pickerId);
    cancel?.(timer);
    safe(() => commands?.stop());
    for (const controller of requests) controller.abort();
    for (const dispose of disposers) safe(dispose);
    disposers.clear();
    c.viewCache?.clear();
    c.sessionReadOnly = true;
    c.taskRequest++; c.taskRenderGeneration++; c.dialogGeneration++;
    c.taskController?.abort(); clearTimeout(c.syncTimer);
    c.usage?.stop(); c.backupStatus?.dispose(); c.gamePlugin?.dispose?.();
    c.closeDialog?.(); c.disposeAccessSections?.();
    for (const value of Object.values(c)) if (value instanceof Map || value instanceof Set) value.clear();
    for (const name of ['startupSnapshot', 'state', 'result', 'fullResult', 'shownResult', 'world', 'definitions', 'registry', 'memberId', 'pool', 'taskFactsCache', 'duoResultCache', 'duoInspectionCache', 'earlyTaskLoad', 'foregroundTaskLoad', 'pendingGameplayAttempt', 'chunkSearch', 'shownChunkSignature']) c[name] = undefined;
    c.viewerPreferences = {}; c.statePools = {}; c.pendingChunkChanges = []; c.lastDuoResults = [];
    c.refreshSaveRecovery?.();
    for (const node of globalThis.document?.querySelectorAll?.('.workspace, #chunk-info, #dialog-content, #pending-panel, #recent-content, #group-goals') ?? []) node.replaceChildren();
    safe(() => tabStorage().setItem(sessionKey, JSON.stringify({ signature, pickerId: session.pickerId, retired: true })));
    safe(() => clear(session.pickerId));
    stopPickerStorage(); // Late preference callbacks cannot recreate cleared records.
    if (pending && announce) notify(unsentMessage);
  }
  function reload() { stop(); clear(session.pickerId); location.reload(); }
  async function check() {
    if (!session?.multiPicker) return;
    active();
    if (accountAction) throw new Error('An account change is in progress. Try again after it finishes.');
    if (!checking) checking = withStartupTimeout(async (signal, readJSON) => {
      const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal });
      active();
      if ([401, 403].includes(response.status)) { reload(); throw abandoned(); }
      if (!response.ok) {
        let value; try { value = await readJSON(response); } catch {}
        throw Object.assign(new Error('Could not check the active account. Try again.'), {
          status: response.status, code: value?.code, retryAfterMs: startupRetryAfter(response),
        });
      }
      const next = await readJSON(response); active();
      if (!next.multiPicker || identity(next) !== signature) { reload(); throw abandoned(); }
    }).finally(() => { checking = undefined; });
    return checking;
  }
  async function scopedFetch(path, options, transport = fetch) {
    if (!session?.multiPicker) return transport(path, options);
    // Unload flushes must dispatch before teardown: skip the preflight. The
    // picker header still binds them, and the server refuses a changed session.
    if (options?.keepalive) active(); else { await check(); active(); }
    const controller = new AbortController();
    const detach = () => { requests.delete(controller); options?.signal?.removeEventListener('abort', abort); };
    const abort = () => { controller.abort(); detach(); };
    options?.signal?.addEventListener('abort', abort, { once: true });
    if (options?.signal?.aborted) abort();
    requests.add(controller);
    let retain = false;
    try {
      const headers = new Headers(options?.headers); headers.set('X-Picker-Id', session.pickerRoute ?? session.pickerId);
      const response = await transport(path, { ...options, headers, signal: controller.signal });
      active();
      if ([401, 403].includes(response.status)) await check();
      // Readers may finish after the account changed, even if transport ignores abort.
      for (const method of ['json', 'blob', 'arrayBuffer', 'text']) {
        if (typeof response[method] !== 'function') continue;
        const read = response[method].bind(response);
        response[method] = async () => { const value = await read(); active(); return value; };
      }
      // Ordinary callers may ignore the body (including unload keepalives).
      // Startup owns its signal until the complete body read settles, and aborts
      // it in finally, so retaining this listener cannot outlive the attempt.
      retain = options?.keepBodySignal === true && Boolean(options.signal) && !options.signal.aborted;
      return response;
    } finally { if (!retain) detach(); }
  }
  function initialize(value) {
    if (!value.multiPicker) return;
    if (session) { if (identity(value) !== signature) reload(); return; }
    session = value; signature = identity(value);
    const previous = safe(() => JSON.parse(tabStorage().getItem(sessionKey) ?? 'null'));
    if (previous && (previous.retired || previous.signature !== signature)) {
      const pending = storedPending(previous.pickerId);
      clear(previous.pickerId);
      if (pending) notify(unsentMessage);
    }
    // Old site-wide intentions have no trusted picker provenance. Never import them.
    for (const key of ['picker.commandOutbox.v1', 'picker.commandOutbox.v2']) {
      const raw = safe(() => tabStorage().getItem(key));
      if (raw == null) continue;
      const record = safe(() => JSON.parse(raw));
      if (key.endsWith('.v1') || !record || record.body || record.unsent) notify('An older pending save has no picker identity and was not sent. Check History in the original picker before repeating it.');
      tabStorage().removeItem(key);
    }
    configurePickerStorage(session.pickerId);
    safe(() => tabStorage().setItem(sessionKey, JSON.stringify({ signature, pickerId: session.pickerId })));
    c.usage?.refreshPreference();
    timer = schedule?.(() => { void check().catch(() => {}); }, 5000); timer?.unref?.();
    globalThis.addEventListener?.('focus', () => { void check().catch(() => {}); });
    // A retired document restored from the back-forward cache cannot recover in place.
    globalThis.addEventListener?.('pageshow', () => { if (stopped) location.reload(); else void check().catch(() => {}); });
    globalThis.addEventListener?.('storage', event => { if (event.key === changeKey) void check().catch(() => {}); });
    globalThis.document?.addEventListener?.('click', event => {
      const link = event.target?.closest?.('a[href]');
      if (link && /^\/auth\//.test(link.getAttribute('href') ?? '') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
        && (event.button ?? 0) === 0 && !['_blank', '_new'].includes((link.getAttribute('target') ?? '').toLowerCase())) {
        stop();
        try { clear(session.pickerId); } catch { event.preventDefault(); c.notice?.('Browser storage could not be cleared. Restore browser storage before switching accounts.', true); }
      }
    }, true);
  }
  // Teardown stays synchronous (callers rely on it, and refusals throw). The
  // returned promise settles when the display snapshot is gone, capped so a
  // stuck IndexedDB cannot hold sign-out.
  const beforeSignOut = () => {
    if (session?.multiPicker) {
      stop();
      if (session?.multiPicker) clear(session.pickerId);
      safe(() => storage().setItem(changeKey, String(Date.now())));
    }
    // Every deployment, not only multi-picker ones: the display snapshot holds
    // private task rows and must not outlive the sign-in on a shared browser.
    const cleared = c.viewCache?.clear();
    if (!cleared || typeof globalThis.setTimeout !== 'function') return cleared;
    let timer;
    return Promise.race([cleared, new Promise(resolve => { timer = globalThis.setTimeout(resolve, 1500); })]).finally(() => globalThis.clearTimeout?.(timer));
  };
  c.panelContext ??= {};
  c.panelContext.pickerSession = { initialize, check, fetch: scopedFetch, stop, beforeSignOut,
    async beginAccountAction() {
      if (checking) await checking;
      active();
      if (accountAction) throw new Error('An account change is already in progress.');
      accountAction = true;
      return () => { accountAction = false; };
    },
    get pickerId() { return session?.pickerId; }, get stopped() { return stopped; },
    get enabled() { return session?.multiPicker === true; },
    streamPath: () => session?.multiPicker ? `/api/events?picker=${encodeURIComponent(session.pickerRoute ?? session.pickerId)}` : '/api/events',
    registerStop: dispose => disposers.add(dispose),
    registerCommands: value => { commands = value; },
    queueCommand() { active(); queued++; let done = false; return () => { if (!done) { done = true; queued--; } }; },
  };
}
