import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { batches, createWikiClient, isWikiUrl, MAX_TITLES_PER_QUERY, PROJECT_URL, retryAfterMs, routeGlobalWikiFetch, WikiRequestError,
  wikiUserAgent } from '../scripts/lib/rs-wiki-client.mjs';

// A fake clock that only moves when the client sleeps, plus a stub fetch that
// records when each request starts and checks requests never overlap.
function harness(replies, { delayMs = 0 } = {}) {
  let clock = 0, active = 0, peak = 0;
  const calls = [], sleeps = [];
  const fetchImpl = async (url, init) => {
    active++; peak = Math.max(peak, active);
    calls.push({ url: new URL(url), init, at: clock });
    try {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const reply = typeof replies === 'function' ? replies(calls.length - 1, new URL(url)) : replies[calls.length - 1];
      if (reply instanceof Error) throw reply;
      return reply ?? Response.json({ query: {} });
    } finally { active--; }
  };
  const options = { fetchImpl, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; }, cacheDir: null, log: () => {} };
  return { options, calls, sleeps, peak: () => peak };
}

async function scratch(t) {
  const base = path.resolve('.local/rs-wiki-client-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('every request names the project and a contact URL, never an email', async () => {
  const { options, calls } = harness([]);
  const wiki = createWikiClient({ ...options, tool: 'unit test' });
  await wiki.api({ action: 'query', titles: 'Lumbridge' });
  await wiki.fetch('https://runescape.wiki/images/Coins_10000.png', { headers: { 'user-agent': 'spoofed' } });
  for (const call of calls) {
    const agent = call.init.headers['User-Agent'];
    assert.equal(agent, wiki.userAgent);
    assert.match(agent, /^RS3ChunkPicker\/1\.0 \(/);
    assert.ok(agent.includes(PROJECT_URL));
    assert.ok(agent.includes('unit test'));
    assert.doesNotMatch(agent, /@/);
    assert.equal(Object.keys(call.init.headers).filter(key => key.toLowerCase() === 'user-agent').length, 1);
  }
  assert.ok(wikiUserAgent().includes(PROJECT_URL));
  assert.throws(() => wikiUserAgent('me@example.com'), /plain words/);
});

test('API requests run one at a time, at least a second apart, with maxlag=5', async () => {
  const { options, calls, peak } = harness([], { delayMs: 5 });
  const wiki = createWikiClient(options);
  await Promise.all(['A', 'B', 'C', 'D'].map(title => wiki.api({ action: 'query', titles: title, maxlag: 99 })));
  assert.equal(peak(), 1);
  assert.deepEqual(calls.map(call => call.at), [0, 1000, 2000, 3000]);
  for (const call of calls) assert.equal(call.url.searchParams.get('maxlag'), '5');
  assert.deepEqual(calls.map(call => call.url.searchParams.get('titles')).sort(), ['A', 'B', 'C', 'D']);
  assert.throws(() => createWikiClient({ ...options, apiGapMs: 500 }), /1 s apart/);
});

test('clients sharing a fetch share the serial lane', async () => {
  const { options, calls, peak } = harness([], { delayMs: 5 });
  const first = createWikiClient({ ...options, tool: 'one' }), second = createWikiClient({ ...options, tool: 'two' });
  await Promise.all([first.api({ titles: 'A' }), second.api({ titles: 'B' })]);
  assert.equal(peak(), 1);
  assert.deepEqual(calls.map(call => call.at), [0, 1000]);
});

test('429 waits for Retry-After before retrying', async () => {
  const { options, calls, sleeps } = harness([
    new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }),
    Response.json({ query: { pages: [] } })]);
  const data = await createWikiClient(options).api({ action: 'query', titles: 'Varrock' });
  assert.deepEqual(data, { query: { pages: [] } });
  assert.deepEqual(sleeps, [30_000]);
  assert.deepEqual(calls.map(call => call.at), [0, 30_000]);
});

test('maxlag errors back off, honour Retry-After, and the body is kept for the caller', async () => {
  const lagged = () => Response.json({ error: { code: 'maxlag', info: 'Waiting for a database server: 7 seconds lagged.' } },
    { headers: { 'Retry-After': '5' } });
  const { options, sleeps } = harness([lagged(), lagged(), Response.json({ query: { normalized: [] } })]);
  const response = await createWikiClient(options).fetch('https://runescape.wiki/api.php?action=query&titles=Falador&format=json');
  assert.deepEqual(await response.json(), { query: { normalized: [] } });
  // Each wait is the larger of the hint and the 2 s, 4 s backoff.
  assert.deepEqual(sleeps, [5000, 5000]);
});

test('5xx and network failures back off exponentially, then give up', async () => {
  const { options, calls, sleeps } = harness(() => new Response('down', { status: 503 }));
  const wiki = createWikiClient({ ...options, maxRetries: 3 });
  await assert.rejects(wiki.api({ titles: 'Edgeville' }),
    error => error instanceof WikiRequestError && error.status === 503 && /after 4 tries/.test(error.message));
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [2000, 4000, 8000]);
  // A caller retrying after the give-up gets the same error with no new request.
  await assert.rejects(wiki.api({ titles: 'Edgeville' }), /after 4 tries/);
  assert.equal(calls.length, 4);
  const offline = harness(index => index < 2 ? new TypeError('fetch failed') : Response.json({ query: {} }));
  await createWikiClient(offline.options).api({ titles: 'Draynor' });
  assert.deepEqual(offline.sleeps, [2000, 4000]);
});

test('a Retry-After beyond the cap stops instead of hanging', async () => {
  const { options, calls } = harness([new Response('', { status: 429, headers: { 'Retry-After': '3600' } })]);
  await assert.rejects(createWikiClient(options).api({ titles: 'Karamja' }), /HTTP 429/);
  assert.equal(calls.length, 1);
});

test('API errors other than lag are not retried', async () => {
  const { options, calls } = harness([Response.json({ error: { code: 'badvalue', info: 'Unrecognized value.' } })]);
  await assert.rejects(createWikiClient(options).api({ titles: 'Al Kharid' }), /badvalue/);
  assert.equal(calls.length, 1);
});

test('titles are batched up to the API limit', async () => {
  const { options, calls } = harness([]);
  const titles = Array.from({ length: 120 }, (_, index) => `Page ${index}`);
  const results = await createWikiClient(options).batchedApi('titles', titles, { action: 'query', prop: 'info' });
  assert.deepEqual(results.map(result => result.batch.length), [50, 50, 20]);
  assert.deepEqual(calls.map(call => call.url.searchParams.get('titles').split('|').length), [50, 50, 20]);
  assert.deepEqual(batches([1, 2, 3], 2), [[1, 2], [3]]);
  assert.throws(() => batches(titles, MAX_TITLES_PER_QUERY + 1), /1 to 50/);
});

test('revision-pinned reads are cached on disk and reused; current reads are not', async t => {
  const cacheDir = await scratch(t);
  const { options, calls } = harness(index => Response.json({ query: { pages: [{ revid: 37000000 + index }] } }));
  const wiki = createWikiClient({ ...options, cacheDir });
  const pinned = { action: 'query', prop: 'revisions', rvprop: 'ids|content', revids: '37000000' };
  const first = await wiki.api(pinned);
  const again = await createWikiClient({ ...options, cacheDir }).api({ revids: '37000000', rvprop: 'ids|content', prop: 'revisions', action: 'query' });
  assert.deepEqual(again, first);
  assert.equal(calls.length, 1);
  await wiki.api({ action: 'query', titles: 'Lumbridge' });
  await wiki.api({ action: 'query', titles: 'Lumbridge' });
  assert.equal(calls.length, 3);
  assert.equal((await readdir(cacheDir)).filter(name => name.endsWith('.json')).length, 1);
  const failed = harness([Response.json({ error: { code: 'nosuchrevid' } })]);
  await assert.rejects(createWikiClient({ ...failed.options, cacheDir }).api({ action: 'parse', oldid: '1' }), /nosuchrevid/);
  assert.equal((await readdir(cacheDir)).filter(name => name.endsWith('.json')).length, 1);
});

test('image fetches share the agent and keep at most 2 in flight', async () => {
  const { options, calls, peak } = harness(() => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }), { delayMs: 10 });
  const wiki = createWikiClient(options);
  const files = Array.from({ length: 6 }, (_, index) => `https://runescape.wiki/images/Icon_${index}.png`);
  const bodies = await Promise.all(files.map(async url => new Uint8Array(await (await wiki.fetch(url)).arrayBuffer())));
  assert.equal(peak(), 2);
  assert.equal(calls.length, 6);
  for (const body of bodies) assert.deepEqual([...body], [137, 80, 78, 71]);
  for (const call of calls) {
    assert.equal(call.init.headers['User-Agent'], wiki.userAgent);
    assert.equal(call.url.searchParams.has('maxlag'), false);
  }
  assert.throws(() => createWikiClient({ ...options, fileConcurrency: 3 }), /at most 2/);
});

test('a routed global fetch sends Wiki URLs through the client and leaves other hosts alone', async t => {
  const { options, calls } = harness([]);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = options.fetchImpl;
  const routed = routeGlobalWikiFetch({ ...options, tool: 'routed' });
  assert.equal(routeGlobalWikiFetch(options), routed);
  await fetch('https://runescape.wiki/api.php?action=query&titles=Lumbridge&format=json', { headers: { 'User-Agent': 'old agent' } });
  await fetch('https://raw.githubusercontent.com/example/file.json', { headers: { 'User-Agent': 'own agent' } });
  assert.equal(calls[0].init.headers['User-Agent'], routed.userAgent);
  assert.equal(calls[0].url.searchParams.get('maxlag'), '5');
  assert.deepEqual(calls[1].init, { headers: { 'User-Agent': 'own agent' } });
  routed.restore();
  assert.equal(globalThis.fetch, options.fetchImpl);
});

test('the preload routes a script that calls fetch directly', async t => {
  const directory = await scratch(t);
  const stub = path.join(directory, 'stub.mjs'), script = path.join(directory, 'direct-caller.mjs');
  await writeFile(stub, `globalThis.fetch = async (url, init) => Response.json({ url: String(url), agent: init?.headers?.['User-Agent'] ?? null });\n`);
  await writeFile(script, `const reply = await (await fetch('https://runescape.wiki/api.php?action=query&titles=Varrock&format=json')).json();\n`
    + `const other = await (await fetch('https://example.com/data.json')).json();\nconsole.log(JSON.stringify({ reply, other }));\n`);
  const preload = fileURLToPath(new URL('../scripts/lib/rs-wiki-preload.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--import', pathToFileURL(stub).href, '--import', pathToFileURL(preload).href, script],
    { encoding: 'utf8', env: { ...process.env, RS3_WIKI_TOOL: '' } });
  const { reply, other } = JSON.parse(output);
  assert.equal(reply.agent, wikiUserAgent('direct-caller'));
  assert.equal(new URL(reply.url).searchParams.get('maxlag'), '5');
  assert.equal(other.agent, null);
});

test('only Wiki hosts go through the client', async () => {
  const { options } = harness([]);
  await assert.rejects(createWikiClient(options).fetch('https://raw.githubusercontent.com/example/file.json'), /Not a Wiki URL/);
  assert.equal(isWikiUrl('https://maps.runescape.wiki/osrs/tiles/x.png'), true);
  assert.equal(isWikiUrl('https://runescape.wiki.example.com/api.php'), false);
  assert.equal(retryAfterMs('7'), 7000);
  assert.equal(retryAfterMs(new Date(61_000).toUTCString(), 1000), 60_000);
});
