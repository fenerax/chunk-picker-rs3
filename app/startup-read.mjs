// This module must not depend on the dataset: it also runs before main's imports
// finish. Only idempotent bootstrap reads belong here, never commands or setup.
const abandoned = () => Object.assign(new Error('Startup abandoned.'), { name: 'AbortError' });
export async function withStartupTimeout(request, { signal, timeoutMs = 150000, bodyTimeoutMs = 35000,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  if (signal?.aborted) throw abandoned();
  const controller = new AbortController();
  // A failed response's status and Retry-After must survive a body stall.
  let timer, abort, arm, responseMeta = {};
  const deadline = new Promise((_, reject) => {
    abort = () => { reject(abandoned()); controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    arm = ms => {
      if (controller.signal.aborted) return;
      clearTimer(timer);
      timer = setTimer(() => {
        reject(Object.assign(new Error('The picker took too long to respond.'), responseMeta));
        controller.abort();
      }, ms);
    };
    arm(timeoutMs); // Cold calculations allow 120 seconds; leave 30 seconds for delivery.
  });
  const readJSON = async response => {
    if (controller.signal.aborted) throw abandoned();
    if (!response.ok) responseMeta = { status: response.status, retryAfterMs: startupRetryAfter(response) };
    // Without a body stream there is no progress to watch, so allow the whole
    // header window for the transfer instead of the inactivity window.
    if (!response.body?.getReader) { arm(Math.max(bodyTimeoutMs, timeoutMs)); return response.json(); }
    arm(bodyTimeoutMs);
    // Native fetch exposes decoded chunks, so progress extends the inactivity
    // window regardless of the body's total size or download time.
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw abandoned();
        if (done) break;
        if (value.byteLength) arm(bodyTimeoutMs);
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally { controller.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  };
  try { return await Promise.race([deadline, Promise.resolve().then(() => request(controller.signal, readJSON))]); }
  finally {
    clearTimer(timer); signal?.removeEventListener('abort', abort);
    // Also releases scoped-fetch cancellation after successful streamed reads.
    controller.abort();
  }
}

const sleep = async (ms, signal) => {
  // Long Retry-After values must not overflow the browser's signed 32-bit timer.
  while (ms > 0) {
    const part = Math.min(ms, 2147483647);
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(abandoned()); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, part);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    ms -= part;
  }
};
export async function retryStartupRead(request, { onRetry = error => showStartupRetry(error), sleep: wait = sleep, random = Math.random, ...options } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await withStartupTimeout(request, options); }
    catch (error) {
      if (options.signal?.aborted || error.name === 'AbortError' || error.status && error.status !== 429 && error.status < 500) throw error;
      // Keep retrying while the page is open, with at most one attempt per
      // second and a 30-second backoff ceiling. A longer server delay wins.
      const backoff = Math.min(30000, 1000 * 2 ** Math.min(5, attempt));
      const delay = Math.max(1000, error.retryAfterMs || 0,
        Math.min(30000, Math.round(backoff * (0.8 + 0.4 * random()))));
      onRetry(error, delay);
      await wait(delay, options.signal);
    }
  }
}

export function showStartupRetry(error, document = globalThis.document) {
  const badge = document?.getElementById('save-status');
  if (!badge) return;
  badge.textContent = ['PICKER_UPDATING', 'PICKER_WARMING'].includes(error.code) ? 'Updating, retrying…' : 'Connecting, retrying…';
  badge.dataset.status = 'failed';
}
let startupSession;
export function setStartupSession(session) { startupSession = session; }
export function showStartupError(error, document = globalThis.document) {
  const panel = document?.getElementById('startup-error');
  if (!panel) return;
  const auth = [401, 403].includes(error.status), badge = document.getElementById('save-status');
  const signIn = ['optional', 'required'].includes(startupSession?.signIn?.mode)
    && startupSession.kind === 'account' && !startupSession.readOnly;
  if (badge) { badge.textContent = auth ? (signIn ? 'Sign-in required' : 'Access required') : 'Load failed'; badge.dataset.status = 'failed'; }
  const heading = document.createElement('h2'), detail = document.createElement('p');
  heading.textContent = auth ? 'Open the picker again' : 'Could not open the picker';
  detail.textContent = auth ? (signIn ? 'Your access has ended. Sign in again or reopen your invitation link.'
    : 'Your access has ended. Reopen your invitation link or ask the picker administrator for a new one.') : error.message;
  const retry = document.createElement('button'); retry.textContent = 'Retry';
  retry.addEventListener('click', () => globalThis.location.reload());
  panel.replaceChildren(heading, detail);
  if (auth && signIn) { const link = document.createElement('a'); link.href = '/auth/signin'; link.textContent = 'Sign in'; panel.append(link); }
  panel.append(retry); panel.hidden = false;
}

// Dataset bootstrap happens before c.api exists. Keep its transport independent
// of screen factories, with separate header and body-inactivity deadlines.
export function startupRetryAfter(response, now = Date.now()) {
  const raw = response.headers?.get?.('Retry-After')?.trim();
  if (!raw) return 0;
  const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - now) || 0;
  return Number.isSafeInteger(delay) ? delay : 0;
}
export function readStartupJSON(path, { fetch: fetcher = globalThis.fetch, cache = 'no-cache', ...options } = {}) {
  return retryStartupRead(async (signal, readJSON) => {
    const response = await fetcher(path, { credentials: 'same-origin', cache, signal });
    if ([401, 403].includes(response.status)) throw Object.assign(new Error('Access required.'), { status: response.status });
    let value;
    try { value = await readJSON(response); }
    catch { if (response.ok) throw new Error('Game data was interrupted or unreadable.'); }
    if (!response.ok) throw Object.assign(new Error('Game data could not be loaded.'), {
      status: response.status, code: value?.code, retryAfterMs: startupRetryAfter(response),
    });
    if (!value || typeof value !== 'object') throw new Error('Game data was unreadable.');
    return value;
  }, options);
}
