import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { cacheWikiPages, pageFilename, wikiUserAgent } from '../scripts/fetch-open-f2p-wiki.mjs';
import { canonicalWikiReceipt, wikiReceiptSha256 } from '../scripts/lib/open-f2p-receipt.mjs';

async function scratch(t) {
  const base = path.resolve('.local/open-f2p-fetch-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(base + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

const pins = Array.from({ length: 23 }, (_, i) => ({ requestedTitle: `Alias ${i}`, title: `Page ${i}`, revision: 100 + i }));
const pageFor = pin => ({ pageid: pin.revision + 1000, title: pin.title,
  revisions: [{ revid: pin.revision, parentid: pin.revision - 1,
    slots: { main: { contentmodel: 'wikitext', content: `{{Example|name=${pin.title}}}\n` } } }] });
const receiptFor = pin => ({ requestedTitle: pin.requestedTitle, page: pageFor(pin) });
const readCached = async (directory, pin) => JSON.parse(await readFile(path.join(directory, pageFilename(pin.requestedTitle)), 'utf8'));

test('pinned Wiki Lua data receives content-model-specific reproducible receipts without evaluation', () => {
  const cached = receiptFor(pins[0]);
  cached.page.revisions[0].slots.main = { contentmodel: 'Scribunto', content: 'return { ["Example"] = {} }' };
  const receipt = wikiReceiptSha256(cached);
  assert.equal(canonicalWikiReceipt(cached).contentmodel, 'Scribunto');
  assert.equal(wikiReceiptSha256(JSON.parse(JSON.stringify(cached))), receipt);
  cached.page.revisions[0].slots.main.content += '\n';
  assert.notEqual(wikiReceiptSha256(cached), receipt);
});

function fakeApi(events) {
  let active = false;
  return async (url, options) => {
    assert.equal(active, false, 'requests must be serial');
    active = true;
    try {
      const query = url.searchParams;
      assert.equal(query.get('maxlag'), '5');
      assert.equal(query.get('rvslots'), 'main');
      assert.equal(query.get('rvprop'), 'ids|content');
      assert.equal(options.headers['User-Agent'], wikiUserAgent);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      const revisions = query.get('revids')?.split('|').map(Number);
      const titles = query.get('titles')?.split('|');
      assert.ok((revisions ?? titles).length <= 20);
      assert.equal(Boolean(revisions) && Boolean(titles), false);
      events.push({ revisions, titles });
      await Promise.resolve();
      const pages = revisions ? revisions.map(revision => pageFor(pins.find(pin => pin.revision === revision)))
        : titles.map(title => ({ title, missing: true }));
      return { ok: true, json: async () => ({ query: { pages } }) };
    } finally { active = false; }
  };
}

test('pinned refetch receipts reproduce across different revision request groupings', async t => {
  const directory = await scratch(t), first = path.join(directory, 'first'), second = path.join(directory, 'second');
  const events = [], options = cacheDir => ({ cacheDir, fetchImpl: fakeApi(events),
    wait: async milliseconds => { assert.equal(milliseconds, 1000); events.push('gap'); }, log: () => {} });
  await cacheWikiPages(pins, options(first));
  assert.deepEqual(events.map(event => typeof event === 'string' ? event : event.revisions.length), [20, 'gap', 3]);
  events.length = 0;
  await cacheWikiPages([...pins].reverse(), options(second));
  assert.deepEqual(events.map(event => typeof event === 'string' ? event : event.revisions.length), [20, 'gap', 3]);
  for (const pin of pins) {
    const a = await readCached(first, pin), b = await readCached(second, pin);
    assert.notEqual(a.api, b.api, 'fixture must use different request groups');
    assert.deepEqual(canonicalWikiReceipt(a), canonicalWikiReceipt(b));
    assert.equal(wikiReceiptSha256(a), wikiReceiptSha256(b));
  }
});

test('canonical receipts ignore envelope formatting and metadata, and detect source changes', () => {
  const cached = receiptFor(pins[0]), expected = wikiReceiptSha256(cached);
  const reordered = { api: 'https://runescape.wiki/api.php?revids=100|101', userAgent: 'another transport',
    page: { revisions: [{ slots: { main: { content: cached.page.revisions[0].slots.main.content, contentmodel: 'wikitext' } }, revid: 100 }], title: 'Page 0' },
    requestedTitle: 'Alias 0' };
  assert.equal(wikiReceiptSha256(JSON.parse(JSON.stringify(reordered, null, 4))), expected);
  for (const mutate of [row => { row.requestedTitle += '!'; }, row => { row.page.title += '!'; },
    row => { row.page.revisions[0].revid++; }, row => { row.page.revisions[0].slots.main.content += '\n'; }]) {
    const changed = structuredClone(cached); mutate(changed);
    assert.notEqual(wikiReceiptSha256(changed), expected);
  }
  assert.throws(() => wikiReceiptSha256({ requestedTitle: 'Missing', page: { title: 'Missing', missing: true } }), /pinned wikitext/);
  const invalid = structuredClone(cached); invalid.page.revisions[0].slots.main.contentmodel = 'json';
  assert.throws(() => wikiReceiptSha256(invalid), /pinned wikitext/);
});

test('mixed pinned and unpinned requests use separate revision and title queries with one serial gap', async t => {
  const cacheDir = await scratch(t), events = [];
  const result = await cacheWikiPages([pins[0], 'Missing', pins[1]], { cacheDir, fetchImpl: fakeApi(events),
    wait: async milliseconds => { events.push(milliseconds); }, log: () => {} });
  assert.equal(result.fetched, 3);
  assert.deepEqual(events, [{ revisions: [100, 101], titles: undefined }, 1000,
    { revisions: undefined, titles: ['Missing'] }]);
  assert.equal((await readCached(cacheDir, pins[0])).page.revisions[0].revid, 100);
  assert.equal((await readCached(cacheDir, { requestedTitle: 'Missing' })).page.missing, true);
  const hits = await cacheWikiPages([pins[0], 'Missing', pins[1]], { cacheDir,
    fetchImpl: () => { throw new Error('Cache hits must not fetch'); }, wait: () => { throw new Error('Cache hits must not wait'); } });
  assert.equal(hits.fetched, 0);
});

test('historical envelopes remain compatible and cache mismatch is refused without a request', async t => {
  const cacheDir = await scratch(t), pin = pins[0];
  await writeFile(path.join(cacheDir, pageFilename(pin.requestedTitle)), JSON.stringify({ ...receiptFor(pin),
    api: 'https://runescape.wiki/api.php?titles=Alias+0', userAgent: wikiUserAgent }, null, 2));
  const fetchImpl = () => { throw new Error('Must not fetch'); };
  assert.equal((await cacheWikiPages([pin], { cacheDir, fetchImpl })).fetched, 0);
  await assert.rejects(cacheWikiPages([{ ...pin, revision: 999 }], { cacheDir, fetchImpl }), /Cached revision differs/);
  await assert.rejects(cacheWikiPages([{ ...pin, revision: -1 }], { cacheDir, fetchImpl }), /Invalid pinned revision/);
});

test('wrong revision/title and Wiki API errors do not produce cache receipts', async t => {
  const cacheDir = await scratch(t), pin = pins[0];
  for (const [response, message] of [
    [{ ok: false, status: 429 }, /returned 429/],
    [{ ok: true, json: async () => ({ error: { code: 'maxlag' } }) }, /maxlag/],
    [{ ok: true, json: async () => ({ query: { pages: [pageFor(pins[1])] } }) }, /No API result/],
    [{ ok: true, json: async () => ({ query: { pages: [{ ...pageFor(pin), title: 'Wrong title' }] } }) }, /Pinned title differs/]
  ]) {
    await assert.rejects(cacheWikiPages([pin], { cacheDir, fetchImpl: async () => response }), message);
    await assert.rejects(readCached(cacheDir, pin), { code: 'ENOENT' });
  }
});
