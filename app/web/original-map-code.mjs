import { PUBLIC_FIREBASE_URL, PUBLIC_GAMEPLAY_FIELDS } from './original-public.mjs';
import { createOriginalPasteUpload } from './backup-transfer.mjs';

export const ORIGINAL_MAP_CODE_FORMAT = 'rs3-original-map-code';
const cap = 8 * 1024 * 1024;
export function originalMapCode(value) {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{1,64}$/.test(code)) throw new Error('Enter an original map code, using letters, numbers, - or _.');
  return code;
}

// Runs in the player's browser. Fixed origin, explicit gameplay branches, GET
// only, no cookies, redirects, authentication, SDK or original-map writes.
export async function readOriginalMapCode(value, { fetchImpl = globalThis.fetch, signal } = {}) {
  const code = originalMapCode(value), map = {};
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('The original picker took too long. Try again.')), 30000);
  let bytes = 0;
  try {
    // One request at a time also bounds memory and load on the original service.
    for (const field of PUBLIC_GAMEPLAY_FIELDS) {
      const response = await fetchImpl(`${PUBLIC_FIREBASE_URL}/maps/${encodeURIComponent(code)}/${field}.json`,
        { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Could not read this original map. Check the code and try again, or use the pasted exports.');
      const reader = response.body.getReader(), parts = [];
      try {
        while (true) {
          const { done, value: part } = await reader.read();
          if (done) break;
          bytes += part.byteLength;
          if (bytes > cap) throw new Error('This original map exceeds the 8 MiB gameplay limit. Use pasted exports instead.');
          parts.push(part);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      let data;
      try { data = JSON.parse(await new Blob(parts).text()); }
      catch { throw new Error('The original picker returned unreadable gameplay. Try again or use pasted exports.'); }
      if (data !== null) map[field] = data;
    }
    if (!map.chunks || typeof map.chunks !== 'object' || Array.isArray(map.chunks)) throw new Error('No original map was found for this code. Check it and try again.');
    return map;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function originalMapCodeTexts(code, options = {}) {
  const map = await readOriginalMapCode(code, options);
  const unlocked = map.chunks.unlocked ?? {};
  if (!unlocked || typeof unlocked !== 'object' || Array.isArray(unlocked)) throw new Error('The original map has invalid unlocked chunks.');
  // Reuse the paste adapter's Firebase decoding, trusted task mapping, rule
  // decisions, provenance and upload/review flow. Captured chunks are authoritative.
  // Subsections stay exact in gameplayText and never become whole cells.
  const chunksText = Object.keys(unlocked).map(key => key.replace(/^\*fb\*_/, ''))
    .filter(key => !/^\d+-\d+$/.test(key)).join(',');
  return { chunksText, rulesText: JSON.stringify(map.rules ?? {}), gameplayText: JSON.stringify(map) };
}

function readInWorker(code, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./original-map-code-worker.mjs', import.meta.url), { type: 'module' });
    const finish = (action, value) => { worker.terminate(); signal?.removeEventListener('abort', abort); action(value); };
    const abort = () => finish(reject, signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => data.error ? finish(reject, new Error(data.error)) : finish(resolve, data.texts);
    worker.onerror = () => finish(reject, new Error('Could not read original gameplay. Retry or use pasted exports.'));
    worker.postMessage({ code });
  });
}

export async function createOriginalMapCodeUpload(code, choices, metadata, options = {}) {
  code = originalMapCode(code);
  options.onStage?.('Reading public original-picker gameplay…');
  // Fetch, parse and serialize off the UI thread; the normal uploader yields
  // while encoding. Tests can inject a synthetic GET transport without workers.
  const texts = typeof Worker === 'function' && !options.fetchImpl ? await readInWorker(code, options.signal) : await originalMapCodeTexts(code, options);
  return createOriginalPasteUpload({ ...texts, ...choices }, metadata,
    { ...options, format: ORIGINAL_MAP_CODE_FORMAT });
}
