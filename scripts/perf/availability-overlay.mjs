#!/usr/bin/env node
// Synthetic HTTP + wired-map probe. No private inputs. Requires an externally
// installed Playwright module and Chromium; neither is a production dependency.
// RS3_DATASET=open-f2p RS3_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
// CHROME_PATH=/path/to/chromium node scripts/perf/availability-overlay.mjs [checkout]
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] ?? '.');
const load = file => import(pathToFileURL(path.join(root, file)));
const [{ createServer }, { createGroupState }, { SURFACE_GRID }] = await Promise.all([
  load('app/server.mjs'), load('app/core/state.mjs'), load('app/data/surface-grid.mjs'),
]);
const { chromium } = await import(process.env.RS3_PLAYWRIGHT_MODULE ?? 'playwright');
const describe = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
};
const ids = [];
for (let x = 1; x < 7; x++) for (let y = 0; y < 6; y++) ids.push(String(SURFACE_GRID.startId + x * SURFACE_GRID.stride - y));
const definitions = { chunks: Object.fromEntries(ids.map((id, index) => [id, { Nickname: `Synthetic place ${index}` }])),
  walkableChunks: ids, walkableChunksF2P: ids, challenges: { Mining: Object.fromEntries(ids.flatMap((id, index) =>
    Array.from({ length: index % 4 }, (_, option) => [`Synthetic option ${index}-${option}`, { Chunks: [id] }]))), Quest: {} } };
const initialState = createGroupState([{ id: 'one', name: 'Player One', unlocked: [ids[0]], selected: ids.slice(1, 31) },
  { id: 'two', name: 'Player Two', unlocked: [ids.at(-1)], selected: ids.slice(1, 31) }]);
const dataDir = await mkdtemp(path.join(tmpdir(), 'availability-perf-'));
let app, browser;
try {
  app = await createServer({ dataDir, port: 0, definitions, taskMap: {}, initialState, predictionPrewarm: false });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const get = async route => { const response = await fetch(origin + route, { headers }); assert.equal(response.status, 200); return response.json(); };
  const timedRead = async () => { const start = performance.now(); const data = await get('/api/pool-ranking?memberId=one'); return { ms: performance.now() - start, data }; };
  const cold = [];
  for (let i = 0; i < 5; i++) {
    await app.store.command({ type: 'set-chunk', memberId: 'one', chunkId: ids[30 - i], status: 'locked' }, app.store.getInfo().revision);
    cold.push((await timedRead()).ms);
  }
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push((await timedRead()).ms);
  const rssBeforeBrowserMiB = process.resourceUsage().maxRSS / 1024;
  // Only explicit previews produce these counts; the map itself must remain passive.
  const pool = (await timedRead()).data;
  for (const id of pool.rows.slice(0, 3).map(row => row.id)) await get(`/api/predict?memberId=one&chunkId=${id}`);
  const checked = (await timedRead()).data;
  const before = await get('/api/diagnostics');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
  const pages = [];
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const requests = [];
    page.on('request', request => { if (/pool-ranking|\/api\/predict/.test(request.url())) requests.push({ url: new URL(request.url()).pathname, method: request.method() }); });
    // Expose only this synthetic page's existing screen for canvas timings.
    await page.route('**/main.mjs', async route => {
      const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nglobalThis.__availabilityPerfScreen = screen;\n' });
    });
    await page.goto(app.inviteUrl);
    await page.waitForFunction(() => globalThis.__availabilityPerfScreen?.state && globalThis.__availabilityPerfScreen.map?.model);
    await page.evaluate(() => {
      const c = globalThis.__availabilityPerfScreen;
      c.map.centerOnChunk(c.pool.eligible[0].id); c.map.zoom = .7; c.map.invalidate(true, true, true);
      c.mapDisplay.open();
    });
    const hasOverlay = await page.locator('#map-availability-toggle').count() > 0;
    const modes = [];
    await page.evaluate(() => {
      const map = globalThis.__availabilityPerfScreen.map, draw = map.drawState;
      document.querySelector('#map-availability-toggle')?.addEventListener('change', () => { globalThis.__availabilityToggleStart = performance.now(); });
      map.drawState = function (...args) {
        const value = draw.apply(this, args);
        if (this.availability?.checked && globalThis.__availabilityToggleStart !== undefined && globalThis.__availabilityTogglePaintMs === undefined) {
          globalThis.__availabilityTogglePaintMs = performance.now() - globalThis.__availabilityToggleStart;
        }
        return value;
      };
    });
    for (const on of hasOverlay ? [false, true] : [false]) {
      if (on) {
        const toggle = page.locator('#map-availability-toggle');
        await toggle.focus(); await page.keyboard.press('Space');
        await page.waitForFunction(() => globalThis.__availabilityPerfScreen.map.availability?.checked > 0);
        await page.waitForFunction(() => globalThis.__availabilityTogglePaintMs !== undefined);
        const summary = page.locator('.map-availability-controls summary');
        await summary.focus(); await page.keyboard.press('Enter');
        const first = page.locator('.map-availability-controls li button').first();
        await first.focus(); await page.keyboard.press('Space');
        assert.equal(await first.evaluate(node => document.activeElement === node), true);
        const shot = process.env.RS3_AVAILABILITY_SCREENSHOTS;
        if (shot) await page.screenshot({ path: path.join(shot, `availability-${width}.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      const timings = await page.evaluate(() => {
        const map = globalThis.__availabilityPerfScreen.map;
        const values = [];
        for (let i = 0; i < 140; i++) {
          map.offset.x += i % 2 ? .5 : -.5;
          const start = performance.now(); map.drawState();
          if (i >= 20) values.push(performance.now() - start);
        }
        return values;
      });
      modes.push({ on, drawStateMs: describe(timings) });
    }
    // A member switch must synchronously remove the previous member's projection.
    if (hasOverlay) {
      await page.evaluate(() => { const c = globalThis.__availabilityPerfScreen; c.memberId = 'two'; c.renderState(); });
      assert.equal(await page.evaluate(() => globalThis.__availabilityPerfScreen.map.availability?.checked), 0);
    }
    pages.push({ width, height, modes, passiveRequests: requests.filter(row => row.url === '/api/pool-ranking').length,
      toggleToStatePaintMs: await page.evaluate(() => globalThis.__availabilityTogglePaintMs ?? null),
      leaseWrites: requests.filter(row => row.url === '/api/pool-ranking-intent').length,
      predictionRequests: requests.filter(row => row.url === '/api/predict').length });
    await page.close();
  }
  const after = await get('/api/diagnostics');
  assert.equal(after.poolRanking.watchers, 0);
  assert.equal(after.predictionLane.ranking.pending, before.predictionLane.ranking.pending);
  assert.equal(after.predictionLane.ranking.active, before.predictionLane.ranking.active);
  assert.ok(pages.every(page => page.leaseWrites === 0 && page.predictionRequests === 0));
  console.log(JSON.stringify({ endpointMs: { coldPool: describe(cold), warm: describe(warm) },
    candidates: pool.total, checked: checked.checked, rssBeforeBrowserMiB, pages }, null, 2));
} finally { await browser?.close(); await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
