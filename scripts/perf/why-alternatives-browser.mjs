// Public synthetic full-application smoke: saved Why, compact hydration, full
// dialogs and native disclosure clicks at desktop and touch-phone widths.
// Uses preinstalled Playwright; adds no dependencies. Set PLAYWRIGHT_MODULE to
// its installed path and run with RS3_DATASET=open-f2p.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { createServer } = await import('../../app/server.mjs');
const { createGroupState } = await import('../../app/core/state.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
const definitions = { walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'], chunks: { '12850': { Nickname: 'Synthetic home' }, '12851': { Nickname: 'Synthetic locked place' } },
  challenges: { Extra: {
    A: { Chunks: ['12850'] }, B: { Chunks: ['12850'], Items: ['Synthetic supply B'] }, C: { Chunks: ['12850'], Items: ['Synthetic supply C'] },
    'Synthetic choice goal': { Tasks: { 'Choices[+]x2': 'Extra' } },
    'Synthetic impossible goal': { Tasks: { 'Repeated[+]x2': 'Extra' } },
    'Synthetic distinct goal': { Tasks: { 'Distinct[+]x2': 'Extra' } },
    'Synthetic nested goal': { Tasks: { 'Left[+]': 'Extra', 'Right[+]': 'Extra' } },
    'Synthetic skill goal': { RequirementAlternatives: [{ Skills: { Mining: 2, Fishing: 2 } }, { Skills: { Cooking: 2 } }] },
  } }, codeItems: { tasksPlus: { 'Choices[+]': ['A', 'A--variant', 'B'], 'Repeated[+]': ['A', 'A--variant'],
    'Distinct[+]': ['A', 'B', 'C'], 'Left[+]': ['B', 'C'], 'Right[+]': ['B', 'C'] } } };
const directory = await mkdtemp(path.join(tmpdir(), 'why-alternatives-browser-'));
let app, browser;
const observations = [];
try {
  const initialState = createGroupState([{ id: 'synthetic', name: 'Synthetic', unlocked: ['12850'] }]);
  app = await createServer({ dataDir: directory, port: 0, dataset: selectedDataset, definitions, taskMap: {}, initialState,
    predictionPrewarm: false, gameDataDir: path.join(directory, 'absent'), mapAssetsDir: path.join(directory, 'absent') });
  await app.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
  for (const phone of [false, true]) {
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const click = locator => phone ? locator.tap() : locator.click();
    const requests = { why: 0, full: 0, compact: 0 };
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/task-why') requests.why++;
      if (url.pathname === '/api/tasks') requests[url.searchParams.has('view') ? 'compact' : 'full']++;
    });
    let release, fullReady, delay = true;
    const fullSaved = new Promise(resolve => { fullReady = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/tasks?**', async route => {
      if (delay && !new URL(route.request().url()).searchParams.has('view')) {
        // Let the backend retain its full saved evidence, then hold only the
        // browser hydration response so the compact dialog stays observable.
        const response = await route.fetch(); fullReady(); await gate;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.goto(app.inviteUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
    await page.locator('#task-engine-status').filter({ hasText: /possible tasks/ }).waitFor({ state: 'attached' });
    if (phone) await click(page.locator('#phone-tab-tasks'));
    await page.locator('#group-view').uncheck();
    await click(page.locator('#task-filters-toggle'));
    await page.locator('#show-blocked').check();
    await page.locator('#task-filter').fill('Synthetic');
    const open = async label => {
      await page.locator('#task-filter').fill(label);
      await click(page.locator('#active-tasks .task-label-button').filter({ hasText: new RegExp(`^${label}$`) }));
      await page.locator('#dialog-content').waitFor();
    };
    const inspect = async (label, expectedA, threshold = true) => {
      const disclosure = page.locator('#dialog-content details').filter({ has: page.locator(':scope > summary', { hasText: /^Why not\?$/ }) });
      assert.equal(await disclosure.evaluate(node => node.open), false);
      const before = requests.why;
      await click(disclosure.locator(':scope > summary'));
      await disclosure.locator('.why-chain').waitFor();
      assert.equal(requests.why, before + 1);
      // Click each real summary as it becomes visible, rather than forcing open.
      for (let i = 0; i < 40; i++) {
        const closed = disclosure.locator('details:not([open]) > summary').first();
        if (!await closed.count()) break;
        await click(closed);
      }
      const tree = disclosure.locator('.why-chain');
      if (threshold) assert.match(await tree.innerText(), /Need 2 of these alternatives:/);
      assert.equal(await tree.locator('p').filter({ hasText: /^A$/ }).count(), expectedA);
      assert.equal(await tree.evaluate(node => node.scrollWidth > node.clientWidth), false);
      await click(disclosure.locator(':scope > summary')); await click(disclosure.locator(':scope > summary'));
      assert.equal(requests.why, before + 1, 'Reopening reuses the saved explanation');
      observations.push({ width: phone ? 390 : 1440, path: label, threshold, canonicalACount: expectedA });
    };
    await open('Synthetic choice goal');
    await page.locator('.task-detail-loading').waitFor();
    await fullSaved;
    await inspect('compact dialog, saved Why', 1);
    delay = false; release();
    await page.locator('.task-detail-loading').waitFor({ state: 'detached' });
    assert.ok(requests.compact > 0); assert.equal(requests.full, 1);
    await page.keyboard.press('Escape');
    await open('Synthetic choice goal');
    await inspect('cached full dialog, saved Why', 1);
    assert.equal(requests.full, 1);
    for (const [label, count, threshold] of [['Synthetic impossible goal', 1, true], ['Synthetic distinct goal', 1, true], ['Synthetic nested goal', 0, false], ['Synthetic skill goal', 0, false]]) {
      await page.keyboard.press('Escape'); await open(label); await inspect(label, count, threshold);
      const text = await page.locator('#dialog-content .why-chain').innerText();
      if (label.includes('skill')) assert.match(text, /\(Mining 2 and Fishing 2\) or Cooking 2/);
      if (label.includes('nested')) { assert.match(text, /All needed:/); assert.match(text, /Either route \/ source:/); }
    }
    observations.push({ width: phone ? 390 : 1440, requests });
    await context.close();
  }
  console.log(JSON.stringify({ browser: browser.version(), boundary: 'Real app navigation and HTTP saved explanations; synthetic definitions; desktop clicks and phone taps; no private packs or human accessibility study', observations }, null, 2));
} finally {
  await browser?.close(); await app?.close();
  await rm(directory, { recursive: true, force: true }); await rm(directory + '.dataset.json', { force: true });
}
