import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectedDataset } from './dataset-runtime.mjs';

export const PUBLIC_FIREBASE_URL = 'https://chunkpickerrs3.firebaseio.com';
export const PUBLIC_GAMEPLAY_FIELDS = Object.freeze([
  'rules', 'chunkOrder', 'settings', 'chunkinfo', 'chunks', 'activeSubTabs',
  'topbarSelection', 'manualPrimary', 'recentFancyRollTime', 'recent', 'recentTime',
  'randomLoot', 'chunkNotes', 'userTasks', 'friends', 'friendsAlt',
]);
export const DEFAULT_MAP_IDS = Object.freeze((selectedDataset.gameDefaults?.members ?? []).flatMap(({ mapId }) => mapId ? [mapId] : []));

const MAP_ID = /^[A-Za-z0-9_-]+$/;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function timestampName(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
}

export function defaultCapturePath(date = new Date()) {
  return path.resolve('.local', 'imports', `maps-${timestampName(date)}.json`);
}

function assertOptions({ mapIds, concurrency, retries, timeoutMs }) {
  if (!Array.isArray(mapIds) || !mapIds.length || mapIds.some(id => typeof id !== 'string' || !MAP_ID.test(id))) {
    throw new TypeError('mapIds must contain safe, nonempty public map IDs');
  }
  if (new Set(mapIds).size !== mapIds.length) throw new TypeError('mapIds must be unique');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new TypeError('concurrency must be an integer from 1 to 16');
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5) throw new TypeError('retries must be an integer from 0 to 5');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TypeError('timeoutMs must be from 1 to 120000');
}

async function fetchJson(url, { fetchImpl, retries, timeoutMs, retryDelayMs, sleep }) {
  let lastError;
  let attempts = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetchImpl(url, { method: 'GET', signal: controller.signal,
        headers: { accept: 'application/json' } });
      if (!response || typeof response.status !== 'number') throw new TypeError('HTTP client returned an invalid response');
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || error?.status === undefined || TRANSIENT_STATUS.has(error.status);
      if (attempt === retries || !retryable) break;
      await sleep(retryDelayMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`GET ${url} failed after ${attempts} attempt(s): ${lastError?.message ?? String(lastError)}`, { cause: lastError });
}

async function boundedMap(items, concurrency, action) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await action(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function mapHash(maps) {
  return `sha256:${createHash('sha256').update(JSON.stringify(maps)).digest('hex')}`;
}

/**
 * Fetch only the public gameplay branches accepted by importLegacyMaps.
 * Inject fetchImpl in tests; no Firebase SDK, authentication, or write endpoint is used.
 */
export async function capturePublicMaps({
  mapIds = DEFAULT_MAP_IDS,
  baseUrl = PUBLIC_FIREBASE_URL,
  fetchImpl = globalThis.fetch,
  concurrency = 4,
  retries = 2,
  timeoutMs = 15000,
  retryDelayMs = 100,
  sleep = wait,
  now = () => new Date(),
  includeVersion = true,
} = {}) {
  assertOptions({ mapIds, concurrency, retries, timeoutMs });
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof sleep !== 'function' || typeof now !== 'function') throw new TypeError('sleep and now must be functions');
  const root = String(baseUrl).replace(/\/+$/, '');
  const jobs = mapIds.flatMap(mapId => PUBLIC_GAMEPLAY_FIELDS.map(field => ({ mapId, field })));
  const fetched = await boundedMap(jobs, concurrency, async ({ mapId, field }) => ({ mapId, field,
    value: await fetchJson(`${root}/maps/${encodeURIComponent(mapId)}/${field}.json`,
      { fetchImpl, retries, timeoutMs, retryDelayMs, sleep }) }));

  const maps = Object.fromEntries(mapIds.map(id => [id, {}]));
  for (const { mapId, field, value } of fetched) if (value !== null) maps[mapId][field] = value;
  const warnings = [];
  let sourceVersion;
  if (includeVersion) {
    try {
      const value = await fetchJson(`${root}/version.json`, { fetchImpl, retries, timeoutMs, retryDelayMs, sleep });
      if (typeof value === 'string' || typeof value === 'number') sourceVersion = String(value);
      else if (value !== null) warnings.push('Public source version had an unexpected shape and was omitted.');
    } catch (error) {
      warnings.push(`Public source version was unavailable: ${error.message}`);
    }
  }

  const capturedAt = now().toISOString();
  const metadata = {
    capturedAt,
    hash: mapHash(maps),
    hashScope: 'maps',
    source: 'firebase-public-rest',
    sourceOrigin: root,
    sourceFields: [...PUBLIC_GAMEPLAY_FIELDS],
    mapIds: [...mapIds],
    ...(sourceVersion === undefined ? {} : { sourceVersion }),
  };
  const document = { maps, metadata };
  const summary = {
    capturedAt, hash: metadata.hash, sourceVersion: sourceVersion ?? null,
    maps: Object.fromEntries(mapIds.map(id => [id, {
      fields: Object.keys(maps[id]),
      unlocked: Object.keys(maps[id].chunks?.unlocked ?? {}).length,
      selected: Object.keys(maps[id].chunks?.selected ?? {}).length,
    }])),
  };
  return { document, summary, warnings };
}

export async function writeCaptureDocument(document, destination) {
  const target = path.resolve(destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return target;
}

function parseCli(argv) {
  const options = {};
  const seen = new Set();
  const valueOptions = new Map([
    ['--output', 'output'],
    ['--timeout-ms', 'timeoutMs'],
    ['--concurrency', 'concurrency'],
    ['--retries', 'retries'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!valueOptions.has(argument) && argument !== '--no-version') throw new TypeError(`Unknown argument: ${argument}`);
    if (seen.has(argument)) throw new TypeError(`Duplicate argument: ${argument}`);
    seen.add(argument);
    if (argument === '--no-version') {
      options.includeVersion = false;
      continue;
    }
    const value = argv[++index];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) {
      throw new TypeError(`${argument} needs ${argument === '--output' ? 'a path' : 'a numeric value'}`);
    }
    options[valueOptions.get(argument)] = argument === '--output' ? value : Number(value);
  }
  if (options.output === undefined) options.output = defaultCapturePath();
  if (options.output.includes('\0')) throw new TypeError('--output needs a path without null characters');
  // Finish validation before capturePublicMaps can issue any network reads.
  assertOptions({ mapIds: DEFAULT_MAP_IDS, concurrency: options.concurrency ?? 4,
    retries: options.retries ?? 2, timeoutMs: options.timeoutMs ?? 15000 });
  return options;
}

export async function runCaptureCli(argv = process.argv.slice(2)) {
  const { output, ...captureOptions } = parseCli(argv);
  const result = await capturePublicMaps(captureOptions);
  const destination = await writeCaptureDocument(result.document, output);
  const printable = { destination, ...result.summary, warnings: result.warnings };
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
  return { ...result, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCaptureCli().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
