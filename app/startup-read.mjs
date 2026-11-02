// This module must not depend on the dataset: it also runs before main's imports
// finish. Only idempotent bootstrap reads belong here, never commands or setup.
const abandoned = () => Object.assign(new Error('Startup abandoned.'), { name: 'AbortError' });
export async function withStartupTimeout(request, { signal, timeoutMs = 35000,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  if (signal?.aborted) throw abandoned();
  const controller = new AbortController();
  let timer, abort;
  const deadline = new Promise((_, reject) => {
    abort = () => { reject(abandoned()); controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimer(() => {
      reject(new Error('The picker took too long to respond.'));
      controller.abort();
    }, timeoutMs);
  });
  try { return await Promise.race([deadline, Promise.resolve().then(() => request(controller.signal))]); }
  finally { clearTimer(timer); signal?.removeEventListener('abort', abort); }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(abandoned()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
});
export async function retryStartupRead(request, { onRetry = error => showStartupRetry(error), sleep: wait = sleep, ...options } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await withStartupTimeout(request, options); }
    catch (error) {
      if (options.signal?.aborted || error.name === 'AbortError' || error.status && error.status !== 429 && error.status < 500) throw error;
      // Keep retrying while the page is open, with at most one attempt per
      // second and a 30-second backoff ceiling. A longer server delay wins.
      const delay = Math.min(2147483647, Math.max(error.retryAfterMs || 0, Math.min(30000, 1000 * 2 ** Math.min(5, attempt))));
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
export function showStartupError(error, document = globalThis.document) {
  const panel = document?.getElementById('startup-error');
  if (!panel) return;
  const auth = [401, 403].includes(error.status), badge = document.getElementById('save-status');
  if (badge) { badge.textContent = auth ? 'Sign-in required' : 'Load failed'; badge.dataset.status = 'failed'; }
  const heading = document.createElement('h2'), detail = document.createElement('p');
  heading.textContent = auth ? 'Open the picker again' : 'Could not open the picker';
  detail.textContent = auth ? 'Your access has ended. Sign in again or reopen your invitation link.' : error.message;
  const retry = document.createElement('button'); retry.textContent = 'Retry';
  retry.addEventListener('click', () => globalThis.location.reload());
  panel.replaceChildren(heading, detail);
  if (auth) { const link = document.createElement('a'); link.href = '/auth/signin'; link.textContent = 'Sign in'; panel.append(link); }
  panel.append(retry); panel.hidden = false;
}

// Dataset bootstrap happens before c.api exists. Keep its transport independent
// of screen factories and bound the complete fetch AND response body read.
export function startupRetryAfter(response, now = Date.now()) {
  const raw = response.headers?.get?.('Retry-After')?.trim();
  if (!raw) return 0;
  const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - now) || 0;
  return Number.isSafeInteger(delay) ? delay : 0;
}
export function readStartupJSON(path, { fetch: fetcher = globalThis.fetch, cache = 'no-cache', ...options } = {}) {
  return retryStartupRead(async signal => {
    const response = await fetcher(path, { credentials: 'same-origin', cache, signal });
    if ([401, 403].includes(response.status)) throw Object.assign(new Error('Access required.'), { status: response.status });
    let value;
    try { value = await response.json(); }
    catch { if (response.ok) throw new Error('Game data was interrupted or unreadable.'); }
    if (!response.ok) throw Object.assign(new Error('Game data could not be loaded.'), {
      status: response.status, code: value?.code, retryAfterMs: startupRetryAfter(response),
    });
    if (!value || typeof value !== 'object') throw new Error('Game data was unreadable.');
    return value;
  }, options);
}
