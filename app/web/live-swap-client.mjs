// The session watermark and its one pending command are replaced together. Never
// acknowledge a server receipt until the browser has durably recorded its answer.
export const commandOutboxKey = 'picker.commandOutbox.v2';
const legacyOutboxKey = 'picker.commandOutbox.v1';
const pendingError = message => Object.assign(new Error(message), { pendingCommand: true });
const secureConnectionMessage = 'Saving needs a secure connection and a supported browser. Open the picker over HTTPS or a trusted localhost address with a current browser, then check History before trying again.';
const insecureAddressMessage = 'This address cannot save safely. Open the HTTPS link or localhost.';
function requireSecureConnection() {
  if (globalThis.isSecureContext === false) throw Object.assign(pendingError(insecureAddressMessage), { insecureConnection: true });
}
function sessionStorage() { try { return globalThis.sessionStorage; } catch { return null; } }
function sessionUUID() {
  requireSecureConnection();
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw pendingError(secureConnectionMessage);
  return globalThis.crypto.randomUUID();
}
async function acquireBrowserSession(clientId) {
  requireSecureConnection();
  if (!globalThis.navigator?.locks?.request) throw pendingError(secureConnectionMessage);
  return new Promise((resolve, reject) => {
    globalThis.navigator.locks.request(`picker.command-session.v2.${clientId}`, { ifAvailable: true }, lock => {
      if (!lock) { resolve(null); return; }
      let release;
      const held = new Promise(done => { release = done; });
      resolve(release);
      return held;
    }).catch(reject);
  });
}
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validSession = value => value && integer(value.slot) && value.slot < 32 && integer(value.generation) && value.generation > 0 && integer(value.sequence)
  && (value.scope === undefined || uuidPattern.test(value.scope));
const idFor = (session, sequence) => session.scope ? `v3.${session.scope}.${session.slot}.${session.generation}.${sequence}` : `v2.${session.slot}.${session.generation}.${sequence}`;
function validReceipt(receipt, requestId) {
  return receipt && receipt.requestId === requestId && integer(receipt.revision) && receipt.revision > 0
    && receipt.outcome && typeof receipt.outcome.type === 'string' && receipt.outcome.type.length <= 80
    && receipt.outcome.revision === receipt.revision
    && (receipt.outcome.rolled === undefined || (Array.isArray(receipt.outcome.rolled) && receipt.outcome.rolled.every(id => typeof id === 'string')))
    && new TextEncoder().encode(JSON.stringify(receipt)).byteLength <= 2048;
}

export function createLiveSwapCommandClient({ storage = sessionStorage(), fetch = (...args) => globalThis.fetch(...args),
  uuid = sessionUUID, sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  timeoutMs = 15000, onRetry = () => {}, acquireSession = acquireBrowserSession, ackDelayMs = 5000,
  maxAttempts = 12, maxRetryMs = 120000, now = () => Date.now() } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(maxRetryMs) || maxRetryMs <= 0
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Positive save retry limits are required.');
  let queue = Promise.resolve(), acknowledged = 0;
  let releaseSession, ownedClientId, ownershipPending, pendingOwnerId, documentActive = true, ackTimer;
  function releaseOwnership() {
    clearTimeout(ackTimer); ackTimer = undefined;
    documentActive = false;
    releaseSession?.(); releaseSession = undefined; ownedClientId = undefined;
  }
  globalThis.addEventListener?.('pagehide', () => {
    // Best effort only: ownership is still held and the answer was persisted.
    // A killed tab may send nothing, so server retirement must remain safe.
    try {
      requireSecureConnection();
      const record = read();
      if (releaseSession && ownedClientId === record?.clientId && record.session && record.confirmed > acknowledged) {
        Promise.resolve(fetch('/api/action-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: acknowledgementBytes(record), keepalive: true, cache: 'no-store' })).catch(() => {});
      }
    } catch {}
    releaseOwnership();
  });
  globalThis.addEventListener?.('pageshow', () => { documentActive = true; });
  function ensureOwnership(record) {
    requireSecureConnection();
    if (!documentActive) throw pendingError('Save confirmation paused because this page was closed or suspended. Reopen it to recover the pending save.');
    if (releaseSession && ownedClientId === record.clientId) return;
    if (ownershipPending) return pendingOwnerId === record.clientId ? ownershipPending : ownershipPending.then(() => ensureOwnership(record));
    if (releaseSession) { releaseSession(); releaseSession = undefined; ownedClientId = undefined; acknowledged = 0; }
    const acquired = acquireSession(record.clientId);
    const hold = release => {
      if (typeof release !== 'function') throw pendingError('Another tab owns this copied saving session. Return to the original tab, or close it before recovering this tab. No change was sent.');
      if (!documentActive) { release(); throw pendingError('Save confirmation paused because this page was closed or suspended.'); }
      releaseSession = release; ownedClientId = record.clientId;
    };
    if (!acquired || typeof acquired.then !== 'function') return hold(acquired);
    pendingOwnerId = record.clientId;
    ownershipPending = acquired.then(hold).finally(() => { ownershipPending = undefined; pendingOwnerId = undefined; });
    return ownershipPending;
  }
  const serialize = work => { const task = queue.then(work); queue = task.catch(() => {}); return task; };
  function read() {
    if (!storage) throw pendingError('Browser session storage is unavailable. Enable it before saving.');
    let raw;
    try {
      if (storage.getItem(legacyOutboxKey) !== null) throw pendingError('An older pending save needs recovery. Keep this tab open and check History before saving again.');
      raw = storage.getItem(commandOutboxKey);
    } catch (error) { if (error.pendingCommand) throw error; throw pendingError('The pending save could not be read. Restore browser session storage before saving.'); }
    if (raw === null) return null;
    try {
      const record = JSON.parse(raw);
      if (record.version !== 2 || !uuidPattern.test(record.clientId) || !integer(record.confirmed)
        || (record.session !== null && !validSession(record.session)) || (record.session === null && (record.confirmed !== 0 || record.body !== null))
        || (record.session && record.confirmed !== record.session.sequence)
        || (record.confirmed === 0 ? record.lastReceipt !== null : !validReceipt(record.lastReceipt, idFor(record.session, record.confirmed)))) throw new Error();
      if (record.body !== null) {
        const body = JSON.parse(record.body);
        if (!validCommand(body) || body.requestId !== idFor(record.session, record.confirmed + 1) || body.requestAck !== record.confirmed) throw new Error();
      }
      if (record.paused !== undefined && typeof record.paused !== 'boolean') throw new Error();
      if (record.unsent != null && (record.body !== null || typeof record.unsent !== 'string' || !validCommand(JSON.parse(record.unsent)))) throw new Error();
      return record;
    } catch { throw pendingError('The pending save is unreadable. Keep this tab open and recover its session storage before saving.'); }
  }
  function validCommand(body) {
    return body && integer(body.expectedRevision) && body.command && typeof body.command.type === 'string' && body.command.type !== 'sync-original';
  }
  function persist(record) {
    const value = JSON.stringify(record);
    try { storage.setItem(commandOutboxKey, value); if (storage.getItem(commandOutboxKey) !== value) throw new Error(); }
    catch { throw pendingError('The save confirmation could not be stored. Restore browser session storage before saving again.'); }
  }
  async function request(path, bytes, signal, limit = timeoutMs) {
    const controller = new AbortController();
    let rejectTimeout;
    const timedOut = new Promise((_, reject) => { rejectTimeout = reject; });
    const stop = () => { controller.abort(); rejectTimeout(new Error('Save request timed out or was paused.')); };
    signal?.addEventListener('abort', stop, { once: true });
    const deadline = setTimeout(stop, limit);
    try {
      if (signal?.aborted) stop();
      // Bound even a transport or response reader that ignores AbortSignal.
      return await Promise.race([timedOut, (async () => {
        const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bytes, signal: controller.signal, cache: 'no-store' });
        return { response, value: await response.json() };
      })()]);
    } finally { clearTimeout(deadline); signal?.removeEventListener('abort', stop); }
  }
  // Ordinary 403s are definitive command refusals (e.g. another player's Undo).
  // Protocol refusals cannot establish the outcome of an earlier dispatch.
  const recoveryCodes = new Set(['ACTION_SESSION_MISMATCH', 'ACTION_SESSION_RETIRED', 'ACTION_SESSION_REQUIRED',
    'ACTION_SESSION_FULL', 'REQUEST_ACKNOWLEDGED', 'REQUEST_ID_MISMATCH', 'REQUEST_SEQUENCE',
    'RECEIPT_CAPACITY', 'ACTION_SESSION_CAPACITY']);
  const fatal = (status, code) => status === 401 || recoveryCodes.has(code);
  function pausedError() { return Object.assign(pendingError('Save could not be confirmed. Your pending save is kept. Use Retry save to try again.'), { retryPaused: true }); }
  function pause(record, budget) {
    persist({ ...record, paused: true });
    onRetry({ status: 'paused', attempt: budget.attempts, maxAttempts });
    throw pausedError();
  }
  async function retryRequest(path, bytes, signal, record, budget, registration = false) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw pendingError('Save confirmation was paused. Its pending request is retained.');
      if (budget.attempts >= maxAttempts || now() >= budget.deadline) pause(record, budget);
      const ownership = ensureOwnership(record); if (ownership) await ownership;
      let result;
      const remaining = budget.deadline - now();
      if (remaining <= 0) pause(record, budget);
      budget.attempts++;
      try { result = await request(path, bytes, signal, Math.min(timeoutMs, remaining)); } catch {}
      if (signal?.aborted) throw pendingError('Save confirmation was paused. Its pending request is retained.');
      if (result) {
        const { response, value } = result;
        if (fatal(response.status, value?.code)) throw Object.assign(pendingError(value?.message || 'Save confirmation needs recovery. Keep this tab open, restore access and check History before saving again.'), {
          status: response.status, code: value?.code, safeToRetry: value?.safeToRetry === true, firstAttempt: attempt === 0 });
        const validAnswer = registration ? validSession(value)
          : integer(value?.state?.revision) && validReceipt(value?.receipt, JSON.parse(bytes).requestId)
            && value.receipt.revision <= value.state.revision;
        if (response.status < 500 && (!response.ok || validAnswer)) return result;
      }
      if (budget.attempts >= maxAttempts || now() >= budget.deadline) pause(record, budget);
      onRetry({ status: 'retrying', attempt: budget.attempts, maxAttempts });
      await sleep(Math.min(3000, 250 * 2 ** Math.min(attempt, 4), budget.deadline - now()));
    }
  }
  async function ensureSession(record, signal, budget) {
    const ownership = ensureOwnership(record); if (ownership) await ownership;
    if (!record.session) {
      const { response, value } = await retryRequest('/api/action-session', JSON.stringify({ clientId: record.clientId }), signal, record, budget, true);
      if (!response.ok) throw Object.assign(pendingError(value?.message || 'A save session could not be registered.'), { status: response.status, code: value?.code });
      if (value.sequence !== 0 || value.acknowledged !== 0) throw pendingError('This save session has unexpected history. Check History before saving again.');
      record = { ...record, session: { slot: value.slot, generation: value.generation, sequence: 0, ...(value.scope ? { scope: value.scope } : {}) } };
      persist(record);
    }
    return record;
  }
  function acknowledgementBytes(record) {
    return JSON.stringify({ clientId: record.clientId,
      acknowledge: { slot: record.session.slot, generation: record.session.generation, sequence: record.confirmed,
        ...(record.session.scope ? { scope: record.session.scope } : {}) } });
  }
  async function acknowledge(record, signal) {
    // Failure is harmless: the next command carries the same confirmed watermark.
    if (!record.session || record.confirmed <= acknowledged || signal?.aborted) return;
    const ownership = ensureOwnership(record); if (ownership) await ownership;
    const owner = releaseSession;
    try {
      const { response, value } = await request('/api/action-session', acknowledgementBytes(record), signal);
      if (owner && releaseSession === owner && ownedClientId === record.clientId && response.ok && value?.slot === record.session.slot && value?.generation === record.session.generation
        && value.scope === record.session.scope
        && integer(value.acknowledged) && value.acknowledged >= record.confirmed) acknowledged = Math.max(acknowledged, record.confirmed);
    } catch {}
  }
  function scheduleAcknowledgement() {
    if (!documentActive) return;
    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => {
      ackTimer = undefined;
      // ACKs only prune retained receipts; their network response must never hold
      // the command queue. A following save carries the same watermark itself.
      Promise.resolve().then(async () => { const record = read(); if (record && !record.body && !record.unsent) await acknowledge(record); }).catch(() => {});
    }, ackDelayMs);
    ackTimer.unref?.();
  }
  return {
    connectionMessage: () => globalThis.isSecureContext === false ? insecureAddressMessage : null,
    pending: () => { const record = read(); return record?.body || record?.unsent ? JSON.parse(record.body ?? record.unsent) : null; },
    paused: () => read()?.paused === true,
    lastReceipt: () => read()?.lastReceipt ?? null,
    discard: () => serialize(() => {
      try {
        storage.removeItem(commandOutboxKey); storage.removeItem(legacyOutboxKey);
        if (storage.getItem(commandOutboxKey) !== null || storage.getItem(legacyOutboxKey) !== null) throw new Error();
      } catch { throw pendingError('The pending save could not be discarded. Restore browser session storage and try again.'); }
      releaseOwnership(); acknowledged = 0; documentActive = true;
    }),
    close: releaseOwnership,
    confirm: ({ signal, lazy = false } = {}) => lazy ? (scheduleAcknowledgement(), Promise.resolve())
      : Promise.resolve().then(async () => { clearTimeout(ackTimer); const record = read(); if (record && !record.body && !record.unsent) await acknowledge(record, signal); }),
    send: (body, { signal, retry = false } = {}) => serialize(async () => {
      let record = read();
      const fresh = !record?.body;
      if (record?.paused && !retry) { onRetry({ status: 'paused' }); throw pausedError(); }
      const pending = record?.body ?? record?.unsent;
      if (pending && JSON.stringify(body) !== pending) throw pendingError('Confirm the pending save before sending another change.');
      const budget = { attempts: 0, deadline: now() + maxRetryMs };
      if (record?.paused) {
        const ownership = ensureOwnership(record); if (ownership) await ownership;
        record = { ...record, paused: false }; persist(record);
      }
      if (!record?.body) {
        if (!validCommand(body)) throw new TypeError('A valid command and revision are required.');
        record ??= { version: 2, clientId: uuid(), session: null, confirmed: 0, lastReceipt: null, body: null };
        if (!uuidPattern.test(record.clientId)) throw new TypeError('A valid client UUID is required.');
        const unsent = record.unsent ?? JSON.stringify({ expectedRevision: body.expectedRevision, command: body.command });
        const ownership = ensureOwnership(record); if (ownership) await ownership;
        // Keep the reviewed intention even if registration never answers.
        record = { ...record, unsent };
        persist(record);
        record = await ensureSession(record, signal, budget);
        body = JSON.parse(record.unsent);
        if (!Number.isSafeInteger(record.confirmed + 1)) throw pendingError('This save session has reached its sequence limit. Check History before starting another session.');
        const frozen = { requestId: idFor(record.session, record.confirmed + 1), requestAck: record.confirmed, expectedRevision: body.expectedRevision, command: body.command };
        record = { ...record, body: JSON.stringify(frozen), unsent: null };
        persist(record);
      }
      let result;
      try { result = await retryRequest('/api/command?view=play-v1', record.body, signal, record, budget); }
      catch (error) {
        // A new, never-ambiguous dispatch, or the server's retained retirement
        // certificate, proves these bytes never committed. Keep the reviewed
        // revision; renewal must not silently rebase the user's action.
        if (error.code !== 'ACTION_SESSION_RETIRED' || !(error.safeToRetry || (fresh && error.firstAttempt))) throw error;
        const pending = JSON.parse(record.body);
        // Persist the new registration identity and original intention together.
        record = { version: 2, clientId: uuid(), session: null, confirmed: 0, lastReceipt: null, body: null,
          unsent: JSON.stringify({ expectedRevision: pending.expectedRevision, command: pending.command }) };
        persist(record);
        record = await ensureSession(record, signal, budget);
        record = { ...record, body: JSON.stringify({ requestId: idFor(record.session, 1), requestAck: 0,
          expectedRevision: pending.expectedRevision, command: pending.command }), unsent: null };
        persist(record);
        result = await retryRequest('/api/command?view=play-v1', record.body, signal, record, budget);
      }
      // An ordinary terminal rejection has no committed receipt. The caller may
      // explicitly review new bytes at this same unused sequence.
      record = result.response.ok
        ? { ...record, session: { ...record.session, sequence: record.confirmed + 1 }, confirmed: record.confirmed + 1, lastReceipt: result.value.receipt, body: null }
        : { ...record, body: null };
      persist(record);
      onRetry({ status: 'confirmed' });
      if (!documentActive) throw pendingError('Save confirmation paused because this page was closed or suspended. Reopen it to recover the saved outcome.');
      scheduleAcknowledgement();
      return result;
    }),
  };
}
