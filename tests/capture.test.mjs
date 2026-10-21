import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePublicMaps, defaultCapturePath, PUBLIC_GAMEPLAY_FIELDS, runCaptureCli } from '../app/capture-maps.mjs';

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) };
}

test('capture requests only importer-whitelisted public fields with bounded concurrency', async () => {
  const calls = [];
  let active = 0;
  let peak = 0;
  const fetchImpl = async url => {
    calls.push(url); active += 1; peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    if (url.endsWith('/version.json')) return response('6.9.68');
    if (url.endsWith('/chunks.json')) return response({ unlocked: { 12342: '12342' }, selected: { 12343: 1 } });
    if (url.endsWith('/recent.json')) return response(null);
    return response({ retained: true });
  };
  const first = await capturePublicMaps({ mapIds: ['qxa', 'qxb'], baseUrl: 'https://public.example',
    fetchImpl, concurrency: 2, retries: 0, now: () => new Date('2026-10-07T12:34:56.000Z') });
  const second = await capturePublicMaps({ mapIds: ['qxa', 'qxb'], baseUrl: 'https://public.example',
    fetchImpl, concurrency: 2, retries: 0, now: () => new Date('2026-10-07T12:34:56.000Z') });

  assert.ok(peak <= 2);
  assert.equal(calls.length, (PUBLIC_GAMEPLAY_FIELDS.length * 2 + 1) * 2);
  for (const url of calls) assert.match(url,
    /^https:\/\/public\.example\/(?:maps\/(?:qxa|qxb)\/(?:rules|chunkOrder|settings|chunkinfo|chunks|activeSubTabs|topbarSelection|manualPrimary|recentFancyRollTime|recent|recentTime|randomLoot|chunkNotes|userTasks|friends|friendsAlt)|version)\.json$/);
  assert.equal(Object.hasOwn(first.document.maps.qxa, 'recent'), false);
  assert.deepEqual(first.document.metadata.sourceFields, PUBLIC_GAMEPLAY_FIELDS);
  assert.equal(first.document.metadata.sourceVersion, '6.9.68');
  assert.match(first.document.metadata.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.document.metadata.hash, second.document.metadata.hash);
  assert.deepEqual(first.summary.maps.qxa, {
    fields: PUBLIC_GAMEPLAY_FIELDS.filter(field => field !== 'recent'), unlocked: 1, selected: 1,
  });
});

test('transient gameplay reads retry, permanent failures stop, and optional version failure warns', async () => {
  const attempts = new Map();
  const sleeps = [];
  const fetchImpl = async url => {
    attempts.set(url, (attempts.get(url) ?? 0) + 1);
    if (url.endsWith('/version.json')) throw new Error('offline');
    if (url.endsWith('/qxa/rules.json') && attempts.get(url) === 1) return response(null, 503);
    return response(null);
  };
  const result = await capturePublicMaps({ mapIds: ['qxa'], fetchImpl, concurrency: 3, retries: 1,
    retryDelayMs: 7, sleep: async milliseconds => sleeps.push(milliseconds),
    now: () => new Date('2026-10-07T00:00:00.000Z') });
  assert.equal(attempts.get('https://chunkpickerrs3.firebaseio.com/maps/qxa/rules.json'), 2);
  assert.ok(sleeps.includes(7));
  assert.ok(result.warnings[0].includes('source version was unavailable'));
  assert.equal(result.document.metadata.sourceVersion, undefined);

  await assert.rejects(capturePublicMaps({ mapIds: ['qxa'], retries: 2, sleep: async () => {},
    fetchImpl: async url => url.endsWith('/chunks.json') ? response(null, 403) : response(null), includeVersion: false }),
  /chunks\.json failed after 1 attempt\(s\): HTTP 403/);
});

test('timeouts are aborted and exhausted without falling back to unscoped reads', async () => {
  const calls = [];
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    calls.push(url);
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(capturePublicMaps({ mapIds: ['qxa'], fetchImpl, concurrency: 1, retries: 0,
    timeoutMs: 5, includeVersion: false }), /Timed out|aborted/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/maps\/qxa\/rules\.json$/);
});

test('default paths are explicit, UTC-safe and local-import scoped', () => {
  const result = defaultCapturePath(new Date('2026-10-07T12:34:56.789Z')).replaceAll('\\', '/');
  assert.match(result, /\/\.local\/imports\/maps-2026-10-07T12-34-56Z\.json$/);
});

test('capture CLI validates every argument before network reads or output writes', async t => {
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads += 1;
    throw new Error('Invalid arguments must not reach the network');
  });
  const cases = [
    { argv: ['--output'], error: /--output needs a path/ },
    { argv: ['--output', '--no-version'], error: /--output needs a path/ },
    { argv: ['--output', '--concurrency', '2'], error: /--output needs a path/ },
    { argv: ['--output', ''], error: /--output needs a path/ },
    { argv: ['--output', '   '], error: /--output needs a path/ },
    { argv: ['--output', 'invalid\0path'], error: /--output needs a path/ },
    { argv: ['--output', 'first.json', '--output', 'second.json'], error: /Duplicate argument/ },
    { argv: ['--no-version', '--no-version'], error: /Duplicate argument/ },
    { argv: ['--unknown'], error: /Unknown argument/ },
    { argv: ['--no-version', 'unexpected'], error: /Unknown argument/ },
    ...['--timeout-ms', '--concurrency', '--retries'].flatMap(option => [
      { argv: [option], error: /needs a numeric value/ },
      { argv: [option, '--no-version'], error: /needs a numeric value/ },
      { argv: [option, ''], error: /needs a numeric value/ },
      { argv: [option, 'NaN'], error: /must be/ },
      { argv: [option, 'Infinity'], error: /must be/ },
      { argv: [option, '1', option, '2'], error: /Duplicate argument/ },
    ]),
    { argv: ['--timeout-ms', '0'], error: /timeoutMs must be/ },
    { argv: ['--timeout-ms', '120001'], error: /timeoutMs must be/ },
    { argv: ['--concurrency', '0'], error: /concurrency must be/ },
    { argv: ['--concurrency', '17'], error: /concurrency must be/ },
    { argv: ['--concurrency', '1.5'], error: /concurrency must be/ },
    { argv: ['--retries', '6'], error: /retries must be/ },
    { argv: ['--retries', '1.5'], error: /retries must be/ },
  ];
  for (const { argv, error } of cases) {
    await assert.rejects(runCaptureCli(argv), error, JSON.stringify(argv));
  }
  // A malformed option after valid ones must also prevent the whole capture.
  await assert.rejects(runCaptureCli(['--output', 'valid.json', '--no-version', '--concurrency', '2', '--retries']), /needs a numeric value/);
  assert.equal(reads, 0);
});
