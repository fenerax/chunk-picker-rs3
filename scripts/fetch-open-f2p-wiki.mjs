import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const wikiCacheRoot = fileURLToPath(new URL('../.local/wiki-open-f2p/', import.meta.url));
export const wikiUserAgent = 'RS3ChunkPickerIndependentF2P/0.1 (non-commercial local research; API-only; cached page revisions)';
export const pageFilename = title => `${title.replaceAll(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${createHash('sha256').update(title).digest('hex').slice(0, 10)}.json`;

// A cache hit, including a missing page, makes no network request. Requests are
// serial, at most 20 titles each, with maxlag and a one-second gap. No images.
export async function cacheWikiPages(requests, { cacheDir = wikiCacheRoot, fetchImpl = fetch,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  log = message => process.stdout.write(message) } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const missing = [];
  const pins = [...new Map(requests.map(row => [typeof row === 'string' ? row : row.requestedTitle,
    typeof row === 'string' ? { requestedTitle: row } : row])).values()];
  for (const pin of pins) {
    if (pin.revision != null && (!Number.isSafeInteger(pin.revision) || pin.revision < 1)) throw new Error(`Invalid pinned revision: ${pin.requestedTitle}.`);
    try {
      const cached = JSON.parse(await readFile(path.join(cacheDir, pageFilename(pin.requestedTitle)), 'utf8'));
      if (cached.requestedTitle !== pin.requestedTitle) throw new Error(`Cached title differs: ${pin.requestedTitle}.`);
      if (pin.revision && ((pin.title && cached.page.title !== pin.title) || cached.page.revisions?.[0]?.revid !== pin.revision)) throw new Error(`Cached revision differs: ${pin.requestedTitle}.`);
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(pin); }
  }
  // Never downgrade a pinned revision to a current-title query when a caller
  // also asks for unpinned pages. Both lanes share the serial request budget.
  const batches = [];
  for (const rows of [missing.filter(pin => pin.revision != null), missing.filter(pin => pin.revision == null)]) {
    for (let offset = 0; offset < rows.length; offset += 20) batches.push(rows.slice(offset, offset + 20));
  }
  for (const [index, batch] of batches.entries()) {
    if (index) await wait(1000);
    const url = new URL('https://runescape.wiki/api.php');
    const pinned = batch.every(pin => Number.isSafeInteger(pin.revision));
    for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2',
      prop: 'revisions', rvprop: 'ids|content', rvslots: 'main', redirects: '1', maxlag: '5',
      ...(pinned ? { revids: batch.map(pin => pin.revision).join('|') } : { titles: batch.map(pin => pin.requestedTitle).join('|') }) })) url.searchParams.set(key, value);
    const response = await fetchImpl(url, { headers: { 'User-Agent': wikiUserAgent }, redirect: 'error', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Wiki API returned ${response.status}.`);
    const result = await response.json();
    if (result.error) throw new Error(`Wiki API: ${result.error.code}. Stop and retry later.`);
    for (const pin of batch) {
      const title = pin.requestedTitle;
      const normalized = result.query.normalized?.find(row => row.from === title)?.to ?? title;
      const resolved = result.query.redirects?.find(row => row.from === normalized)?.to ?? normalized;
      const page = result.query.pages.find(row => pinned ? row.revisions?.[0]?.revid === pin.revision : row.title === resolved);
      if (!page) throw new Error(`No API result for ${title}.`);
      if (pinned && pin.title && page.title !== pin.title) throw new Error(`Pinned title differs: ${title}.`);
      await writeFile(path.join(cacheDir, pageFilename(title)), JSON.stringify({ requestedTitle: title, api: url.href,
        userAgent: wikiUserAgent, page }, null, 2) + '\n');
    }
    log(`Cached ${batch.length} Wiki pages.\n`);
  }
  return { requested: pins.length, fetched: missing.length, cache: cacheDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) throw new Error('Supply Wiki page titles.');
  const requests = process.argv[2] === '--batch'
    ? JSON.parse(await readFile(new URL('../app/datasets/open-f2p/authored/batch.json', import.meta.url), 'utf8')).pages
    : process.argv.slice(2);
  process.stdout.write(JSON.stringify(await cacheWikiPages(requests)) + '\n');
}
