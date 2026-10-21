// One RuneScape Wiki client for the offline data scripts. It follows the Wiki's
// API etiquette (https://runescape.wiki/w/Help:APIs): an identifiable agent,
// one API request at a time at least a second apart, maxlag=5, Retry-After,
// bounded backoff, batched titles, and an on-disk cache for revision-pinned
// reads. Image and map-tile fetches share the agent with at most 2 in flight.
// Nothing in the picker runtime calls the Wiki; only hand-run scripts use this.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WIKI_API = 'https://runescape.wiki/api.php';
export const PROJECT_URL = 'https://github.com/fenerax/chunk-picker-rs3';
// The API's per-request limit for titles, pageids and revids without apihighlimits.
export const MAX_TITLES_PER_QUERY = 50;
export const defaultWikiCacheDir = () => process.env.RS3_WIKI_CACHE_DIR
  || fileURLToPath(new URL('../../.local/wiki-api-cache/', import.meta.url));

const wikiHost = host => host === 'runescape.wiki' || host.endsWith('.runescape.wiki') || host.endsWith('.weirdgloop.org');
const retryableApiErrors = new Set(['maxlag', 'ratelimited', 'readonly']);
const pinnedParams = ['revids', 'oldid'];

export function isWikiUrl(url) {
  try { return wikiHost(new URL(url).hostname); } catch { return false; }
}

export function wikiUserAgent(tool) {
  if (tool != null && !/^[\w.() -]{1,80}$/.test(tool)) throw new Error('Wiki client tool names are short plain words.');
  return `RS3ChunkPicker/1.0 (${PROJECT_URL}; offline data script${tool ? `: ${tool}` : ''}) Node.js/${process.versions.node}`;
}

export function batches(values, size = MAX_TITLES_PER_QUERY) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_TITLES_PER_QUERY) throw new Error(`Wiki batches hold 1 to ${MAX_TITLES_PER_QUERY} values.`);
  const rows = [];
  for (let offset = 0; offset < values.length; offset += size) rows.push(values.slice(offset, offset + size));
  return rows;
}

/** Retry-After is either delay seconds or an HTTP date. */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export class WikiRequestError extends Error {
  constructor(message, { url, status, code } = {}) { super(message); this.name = 'WikiRequestError'; Object.assign(this, { url, status, code }); }
}

// A lane admits `limit` requests at once and spaces each start `gap` ms after
// the previous request finished (limit 1) or started (limit > 1).
function createLane(limit, gap) {
  let active = 0, last = -Infinity;
  const waiting = [];
  let spacing = Promise.resolve();
  return async function run(task, { now, sleep }) {
    // A finishing request hands its slot straight to the next waiter.
    if (active >= limit) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try {
      const turn = spacing.then(async () => {
        const delay = last + gap - now();
        if (delay > 0) await sleep(delay);
        if (limit > 1) last = now();
      });
      spacing = turn.catch(() => {});
      await turn;
      return await task();
    } finally {
      if (limit === 1) last = now();
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  };
}

// Clients that share a fetch implementation share its lanes, so two scripts'
// clients in one process still make one API request at a time.
const sharedLanes = new WeakMap();

function plainHeaders(headers) {
  const result = {};
  for (const [key, value] of headers instanceof Headers ? headers.entries() : Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== 'user-agent') result[key] = value;
  }
  return result;
}

function rebuild(response, bytes) {
  const body = [101, 204, 205, 304].includes(response.status) ? null : bytes;
  const copy = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  Object.defineProperty(copy, 'url', { value: response.url ?? '' });
  return copy;
}

export function createWikiClient({ tool, fetchImpl = globalThis.fetch, now = Date.now,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  cacheDir = defaultWikiCacheDir(), apiGapMs = 1000, fileGapMs = 100, fileConcurrency = 2,
  maxRetries = 5, backoffMs = 2000, maxBackoffMs = 120_000, maxRetryAfterMs = 600_000, timeoutMs = 60_000,
  log = message => process.stderr.write(message) } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Wiki client needs fetch.');
  if (apiGapMs < 1000) throw new Error('Wiki API requests stay at least 1 s apart.');
  if (!Number.isInteger(fileConcurrency) || fileConcurrency < 1 || fileConcurrency > 2) throw new Error('Wiki file fetches use at most 2 connections.');
  const userAgent = wikiUserAgent(tool);
  if (!sharedLanes.has(fetchImpl)) sharedLanes.set(fetchImpl, { api: createLane(1, apiGapMs), files: createLane(fileConcurrency, fileGapMs) });
  const lanes = sharedLanes.get(fetchImpl), clock = { now, sleep };
  const stats = { requests: 0, retries: 0, cacheHits: 0 };
  // Once the client gives up it stays stopped, so a caller's own retry loop
  // cannot multiply the requests.
  let stopped = null;

  function cacheFile(url) {
    if (!cacheDir || url.searchParams.has('action') && !['query', 'parse'].includes(url.searchParams.get('action'))) return null;
    if (!pinnedParams.some(name => url.searchParams.has(name))) return null;
    const key = new URL(url);
    key.searchParams.delete('maxlag');
    key.searchParams.sort();
    return path.join(cacheDir, `${createHash('sha256').update(key.href).digest('hex')}.json`);
  }

  async function attempt(url, init, api) {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    stats.requests++;
    const response = await fetchImpl(url, { ...init, headers: { ...plainHeaders(init.headers), 'User-Agent': userAgent }, signal });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let code = null;
    if (api && response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
      try { code = JSON.parse(new TextDecoder().decode(bytes)).error?.code ?? null; } catch {}
    }
    const retry = response.status === 429 || response.status >= 500 || retryableApiErrors.has(code);
    return { response, bytes, code, retry };
  }

  async function send(url, init, api) {
    if (stopped) throw stopped;
    for (let tries = 0; ; tries++) {
      let result, failure;
      try { result = await attempt(url, init, api); }
      catch (error) { if (init.signal?.aborted) throw error; failure = error; }
      if (result && !result.retry) return rebuild(result.response, result.bytes);
      const label = result ? (result.code ?? `HTTP ${result.response.status}`) : failure.name;
      const hinted = result ? retryAfterMs(result.response.headers.get('retry-after'), now()) : 0;
      if (tries >= maxRetries || hinted > maxRetryAfterMs) {
        throw stopped = new WikiRequestError(`Wiki gave ${label} for ${url.href} after ${tries + 1} tries; stopping. Retry later.`,
          { url: url.href, status: result?.response.status, code: result?.code ?? failure?.code });
      }
      const delay = Math.max(hinted, Math.min(maxBackoffMs, backoffMs * 2 ** tries));
      stats.retries++;
      log(`Wiki ${label}; waiting ${Math.ceil(delay / 1000)} s before retry ${tries + 1} of ${maxRetries}.\n`);
      await sleep(delay);
    }
  }

  /** Drop-in fetch for runescape.wiki URLs. Bodies are read inside the lane. */
  async function wikiFetch(input, init = {}) {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!wikiHost(url.hostname)) throw new Error(`Not a Wiki URL: ${url.href}. Fetch other sources directly.`);
    const api = url.pathname.endsWith('/api.php');
    if (!api) return lanes.files(() => send(url, init, false), clock);
    url.searchParams.set('maxlag', '5');
    const method = (init.method ?? 'GET').toUpperCase();
    const file = method === 'GET' ? cacheFile(url) : null;
    if (file) {
      try {
        const cached = JSON.parse(await readFile(file, 'utf8'));
        stats.cacheHits++;
        return rebuild({ status: 200, statusText: 'OK', headers: new Headers({ 'content-type': cached.contentType, 'x-wiki-client-cache': 'hit' }), url: url.href },
          new TextEncoder().encode(cached.body));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const response = await lanes.api(() => send(url, init, true), clock);
    if (file && response.ok) {
      const body = await response.clone().text();
      let data = null;
      try { data = JSON.parse(body); } catch {}
      if (data && !data.error) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify({ schemaVersion: 1, url: url.href, userAgent,
          contentType: response.headers.get('content-type') ?? 'application/json',
          sha256: createHash('sha256').update(body).digest('hex'), body }) + '\n');
        await rename(`${file}.tmp`, file);
      }
    }
    return response;
  }

  /** API call returning parsed JSON; API errors other than lag throw. */
  async function api(params, init = {}) {
    const url = new URL(WIKI_API);
    for (const [key, value] of Object.entries({ format: 'json', ...params })) if (value != null) url.searchParams.set(key, String(value));
    const response = await wikiFetch(url, init);
    if (!response.ok) throw new WikiRequestError(`Wiki API returned ${response.status}.`, { url: url.href, status: response.status });
    const data = await response.json();
    if (data.error) throw new WikiRequestError(`Wiki API: ${data.error.code}: ${data.error.info ?? ''}`.trim(), { url: url.href, code: data.error.code });
    return data;
  }

  /** One API call per batch of `values` under `listParam` (titles, revids, pageids). */
  async function batchedApi(listParam, values, params, { batchSize = MAX_TITLES_PER_QUERY, ...init } = {}) {
    const results = [];
    for (const batch of batches([...values], batchSize)) results.push({ batch, data: await api({ ...params, [listParam]: batch.join('|') }, init) });
    return results;
  }

  return { fetch: wikiFetch, api, batchedApi, userAgent, stats };
}

const routedClient = Symbol('rs-wiki-client');

/**
 * Sends the process's global fetch calls for Wiki URLs through one client;
 * other hosts pass through untouched. For scripts that call fetch directly
 * and cannot import the client, e.g. because committed data records their
 * bytes. `restore()` puts the previous fetch back.
 */
export function routeGlobalWikiFetch(options = {}) {
  const previous = globalThis.fetch;
  if (previous[routedClient]) return previous[routedClient];
  const client = createWikiClient({ ...options, fetchImpl: previous });
  const routed = (input, init) => isWikiUrl(input instanceof Request ? input.url : input) ? client.fetch(input, init) : previous(input, init);
  const handle = { ...client, restore() { if (globalThis.fetch === routed) globalThis.fetch = previous; } };
  routed[routedClient] = handle;
  globalThis.fetch = routed;
  return handle;
}
