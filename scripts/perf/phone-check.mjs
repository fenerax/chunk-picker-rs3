// Local UI audit: public open-f2p plus tests/fixtures/partner.mjs only.
// No npm dependencies are added. Point these variables at preinstalled modules:
// PLAYWRIGHT_MODULE=/path/to/playwright-core SHARP_MODULE=/path/to/sharp
// node scripts/perf/phone-check.mjs --out docs/qa/phone-check-2026-10-25 --baseline SHA
// Run --surface synthetic separately to isolate the process-wide dataset provider.
// With --baseline, alternate baseline/candidate CSS in three paired trials.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const out = path.resolve(option('out') || '.local/phone-check');
const baseline = option('baseline');
const captureOnly = option('capture') || 'candidate';
const surface = option('surface') || 'public';
if(!['public','synthetic'].includes(surface)) throw new Error('Choose --surface public or synthetic.');
if(captureOnly==='baseline'&&!baseline) throw new Error('--capture baseline requires --baseline SHA.');
if (!['baseline', 'candidate'].includes(captureOnly)) throw new Error('Choose --capture baseline or candidate.');
const cssFiles = ['app/web/style.css', 'app/web/phone-layout.css', 'app/web/tick-active-tasks.css'];
const baselineCSS = baseline ? new Map(cssFiles.map(file => ['/' + path.basename(file), execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' })])) : null;
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
process.env.RS3_DATASET = 'open-f2p';
const { createGroupState } = await import('../../app/core/state.mjs');
const { createServer } = await import('../../app/server.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
const { duoFixture } = await import('../../tests/fixtures/partner.mjs');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const rows = [], checks = [];
const settle = async p => { await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
async function shot(p, name) {
  await settle(p);
  const png = await sharp(await p.screenshot({ animations: 'disabled' })).png({ palette: true, colours: 128, compressionLevel: 9 }).toBuffer();
  if (png.length >= 300000) throw new Error(`Screenshot too large: ${name}`);
  await writeFile(path.join(out, name + '.png'), png);
  checks.push({ screenshot: name + '.png', bytes: png.length, ...await p.evaluate(() => ({ width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints, coarse: matchMedia('(pointer:coarse)').matches, documentOverflow: document.documentElement.scrollWidth - innerWidth })) });
}
async function makePage(app, phone, variant, loadingName) {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  if (variant === 'baseline' && baselineCSS) await context.route('**/*.css', async route => {
    const css = baselineCSS.get(new URL(route.request().url()).pathname);
    if (css !== undefined) await route.fulfill({ contentType: 'text/css', body: css }); else await route.continue();
  });
  const p = await context.newPage(); p.setDefaultTimeout(10000);
  await p.addInitScript(() => { window.__qaShifts = []; new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__qaShifts.push({ value: e.value, at: e.startTime }); }).observe({ type: 'layout-shift', buffered: true }); });
  await p.goto(app.inviteUrl, {waitUntil:'domcontentloaded'}); if(loadingName) await shot(p,loadingName); await p.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
  // Native touch input (not mouse clicks) throughout the phone flow.
  const click = async selector => { const l = typeof selector === 'string' ? p.locator(selector) : selector; if (phone) await l.tap(); else await l.click(); await settle(p); };
  const tools = async id => {
    if (phone) await click('#phone-tab-more');
    const button = p.locator('#' + id), detail = button.locator('xpath=ancestor::details[1]');
    if (await detail.count() && !await detail.evaluate(e => e.open)) await click(detail.locator(':scope > summary'));
    await click(button);
  };
  return { p, context, click, tools };
}
async function fixture(synthetic, operation) {
  const directory = await mkdtemp(path.join(tmpdir(), 'phone-check-'));
  let app;
  try {
    const initialState = createGroupState([{ id: 'qa-one', name: 'Explorer One', unlocked: ['12850'], selected: ['12849', '12594', '13106'] }, { id: 'qa-two', name: 'Explorer Two', unlocked: ['12850', '12594'] }]);
    let extra = {};
    if (synthetic) {
      const { data: definitions, state } = duoFixture();
      state.members[0].name = 'Explorer One'; state.members[1].name = 'Explorer Two';
      state.members[0].selected = ['12851', '12852'];
      definitions.chunks['12850'].Nickname = 'Synthetic home'; definitions.chunks['12850'].Connect = { 'qa-cellar': true };
      definitions.chunks['12851'].Nickname = 'Synthetic workshop'; definitions.chunks['qa-cellar'] = { Name: 'Synthetic cellar', Object: { Bench: true } };
      extra = { initialState: state, definitions, taskMap: {}, dataset: { ...selectedDataset, capabilities: { ...selectedDataset.capabilities, features: { ...selectedDataset.capabilities.features, training: true, rsCatalogues: true } } } };
    }
    app = await createServer({ dataset:selectedDataset, dataDir: directory, initialState, gameDataDir:path.join(directory,'absent-game'), mapAssetsDir:path.join(directory,'absent-art'), terrainAssetsDir:path.join(directory,'absent-art'), iconAssetsDir:path.join(directory,'absent-art'), host: '127.0.0.1', port: 8975, predictionPrewarm: false, random: () => 0.25, ...extra });
    await app.listen(); await operation(app);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); await rm(directory + '.dataset.json', { force: true }); }
}
try {
  for (const phone of surface === 'public' ? [true, false] : []) {
    const prefix = phone ? 'phone' : 'laptop';
    await fixture(false, async app => {
      const { p, context, click, tools } = await makePage(app, phone, captureOnly, `${prefix}-00-loading`);
      const s = name => shot(p, `${prefix}-${name}`);
      if (phone) {
        await p.locator('#phone-tab-map').focus(); await p.keyboard.press('ArrowRight');
        const tasksSelected=await p.locator('#phone-tab-tasks').getAttribute('aria-selected');
        await p.keyboard.press('End'); const moreSelected=await p.locator('#phone-tab-more').getAttribute('aria-selected');
        await p.keyboard.press('Home'); checks.push({viewport:prefix,phoneTabKeyboard:tasksSelected==='true'&&moreSelected==='true'&&await p.locator('#phone-tab-map').getAttribute('aria-selected')==='true'});
      }
      await s('01-map'); checks.push({viewport:prefix, initialLayoutShifts:await p.evaluate(()=>window.__qaShifts)});
      if (phone) await click('#phone-controls-toggle');
      await s('02-controls');
      await click('#roll-two'); await p.locator('#pending-panel .primary-action').first().waitFor(); await s('03-roll');
      await click(p.locator('#pending-panel .primary-action').first()); await p.locator('#pending-panel').waitFor({ state: 'hidden' }); await s('04-unlocked');
      if (phone) await click('#phone-controls-toggle');
      // Search supplies a stable, accessible way to select a named chunk.
      await tools('search-open');
      const search = p.locator('#dialog-content input[type=search]').first(); await search.fill('Lumbridge'); await p.locator('.search-results:not([aria-busy])').waitFor();
      const home = p.locator('.search-result').filter({ has: p.locator('.search-result-title', { hasText: /^Lumbridge$/ }) }).getByRole('button', { name: 'View', exact: true }).first();
      await home.waitFor(); await click(home); await p.locator('#chunk-info').waitFor();
      for (const tab of ['contents', 'note', 'access']) { await click(`[data-tab=${tab}]`); await s('05-chunk-' + tab); }
      await p.locator('.chunk-section-select').scrollIntoViewIfNeeded(); await s('06-access-scrolled');
      await click('#chunk-close');
      if (phone) await click('#phone-tab-tasks');
      await p.locator('#active-tasks .task-row').first().waitFor(); await s('07-group-tasks');
      await click('#task-filters-toggle'); await p.locator('#task-filters-toggle').scrollIntoViewIfNeeded(); await s('08-filters');
      await p.locator('#task-filter').fill('Bronze'); await p.locator('#active-tasks .task-label-button').first().scrollIntoViewIfNeeded(); await s('09-filtered-rows');
      await click(p.locator('#active-tasks .task-label-button').first()); await s('10-task-dialog');
      let escapedFocus = false;
      for (let i = 0; i < 18; i++) { await p.keyboard.press('Tab'); if (!await p.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('dialog'))) escapedFocus = true; }
      await p.keyboard.press('Escape'); await settle(p);
      checks.push({ viewport: prefix, dialogTabEscaped: escapedFocus, escapeClosedDialog: !await p.locator('#tool-dialog').evaluate(e => e.open), returnFocusVisible: await p.evaluate(() => document.activeElement.checkVisibility()) });
      await click('#group-view'); await p.locator('#task-filter').fill(''); await p.locator('#phone-task-panel').evaluate(e => e.scrollTop = 0); await s('11-personal-tasks');
      if (phone) await click('#phone-tab-more');
      await click('#more-tools > summary'); await s('12-more');
      await p.locator('#theme-light').focus(); await s('13-more-end');
      await tools('settings-open'); await s('14-settings');
      await click(p.locator('.settings-section-link').filter({ hasText: /^Map$/ })); await s('15-settings-map');
      await p.keyboard.press('Escape'); await tools('history-open'); await s('16-history');
      await p.keyboard.press('Escape');
      if (phone) await click('#phone-tab-more');
      await click('#recent-panel > summary'); await s('17-recent');
      await tools('settings-open'); await click(p.locator('.settings-section-link').filter({ hasText: /^Top bar$/ }));
      await click('#setting-qa-one-top-bar-info'); await p.locator('#info-tools').waitFor({state:'hidden'});
      await p.keyboard.press('Escape'); if(phone) await click('#phone-tab-more');
      await click('#more-tools > summary'); await s('21-more-customized');
      await p.locator('#theme-light').focus(); await s('22-more-customized-end');
      await context.close();
    });
    if (baselineCSS) await fixture(false, async app => {
      for (const [pair, variants] of [['1', ['baseline','candidate']], ['2', ['candidate','baseline']], ['3', ['baseline','candidate']]]) for (const variant of variants) {
        const { p, context, click, tools } = await makePage(app, phone, variant);
        if (phone) await click('#phone-tab-tasks');
        await p.locator('#active-tasks .task-row').first().waitFor();
        const target = await p.locator('.task-list-menu-toggle').evaluate(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
        await tools('settings-open'); await click(p.locator('.settings-section-link').filter({ hasText: /^Top bar$/ }));
        // Every trial starts with the same default preference, then makes the same menu customization.
        const infoSwitch=p.locator('#setting-qa-one-top-bar-info');
        if(await infoSwitch.isChecked()) await click(infoSwitch);
        await p.locator('#info-tools').waitFor({state:'hidden'}); await p.keyboard.press('Escape');
        if (phone) await click('#phone-tab-more');
        await click('#more-tools > summary');
        const menu = await p.locator('#more-tools > .more-tools-menu').evaluate(e => ({ top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight, overflowY: getComputedStyle(e).overflowY, viewportHeight: innerHeight }));
        await p.locator('#theme-light').focus();
        const pageScrollY = await p.evaluate(() => scrollY);
        const end = await p.locator('#theme-light').evaluate(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { bottom: r.bottom, reachable: e === hit || e.contains(hit) }; });
        const timing = await p.evaluate(() => ({ interactionLayoutShiftSum: window.__qaShifts.reduce((sum, e) => sum + e.value, 0) }));
        if(variant==='candidate' && (phone ? target.width < 44 || target.height < 44 : menu.bottom > 720 || pageScrollY !== 0 || !end.reachable)) throw new Error(`Candidate layout check failed for ${prefix}`);
        rows.push({ viewport: prefix, pair, variant, target, menu, end, pageScrollY, ...timing });
        await tools('settings-open'); await click(p.locator('.settings-section-link').filter({ hasText: /^Top bar$/ }));
        await click('#setting-qa-one-top-bar-info'); await p.locator('#info-tools').waitFor({state:'attached'});
        await p.keyboard.press('Escape'); await context.close();
      }
    });
  }
  // Run supplementary capability fixtures after all ordinary public captures.
  for (const phone of surface === 'synthetic' ? [true, false] : []) {
    const prefix = phone ? 'phone' : 'laptop';
    await fixture(true, async app => {
      const { p, context, click, tools } = await makePage(app, phone, captureOnly);
      await tools('search-open'); await p.locator('#dialog-content input[type=search]').first().fill('Synthetic home'); await p.locator('.search-results:not([aria-busy])').waitFor();
      await click(p.locator('.search-result').filter({ hasText: 'Synthetic home' }).getByRole('button', { name: 'View', exact: true }).first());
      await p.locator('[data-tab=contents]').focus(); await p.keyboard.press('End');
      const last=await p.locator('[data-tab=access]').getAttribute('aria-selected');
      await p.keyboard.press('Home'); checks.push({viewport:prefix,chunkTabKeyboard:last==='true'&&await p.locator('[data-tab=contents]').getAttribute('aria-selected')==='true'});
      for (const tab of ['contents', 'tasks', 'clues', 'note', 'interior', 'access']) {
        await click(`[data-tab=${tab}]`);
        if(tab==='tasks' && await p.getByText('Loading tasks for this chunk…',{exact:true}).isVisible()) await shot(p,`${prefix}-18-synthetic-tasks-loading`);
        await p.waitForFunction(()=>! /Loading tasks for this chunk|Loading section outlines|Checking your routes/.test(document.querySelector('#chunk-content')?.textContent||''));
        await shot(p, `${prefix}-18-synthetic-${tab}`);
      }
      await click('#chunk-close'); await tools('search-open'); await p.locator('#dialog-content input[type=search]').first().fill('Synthetic workshop'); await p.locator('.search-results:not([aria-busy])').waitFor();
      await click(p.locator('.search-result').filter({ hasText: 'Synthetic workshop' }).getByRole('button', { name: 'View', exact: true }).first());
      await click('[data-tab=unlock]'); await p.waitForFunction(()=>! /Checking your routes|Working out what this chunk|Estimating new obligations/.test(document.querySelector('#chunk-content')?.textContent||'')); await shot(p, `${prefix}-19-synthetic-preview`); await p.locator('.death-estimate').scrollIntoViewIfNeeded(); await shot(p,`${prefix}-19-synthetic-estimate`);
      await click('#chunk-close'); await tools('activity-open');
      for (const tab of ['Skills', 'Quests', 'Achievements', 'Activities', 'Slayer', 'Clues']) {
        const control = p.locator('#dialog-content [role=tab]').filter({ hasText: new RegExp(`^${tab}$`) });
        await click(control); await shot(p, `${prefix}-20-activity-${tab.toLowerCase()}`);
      }
      await context.close();
    });
  }
} finally { await browser.close(); await writeFile(path.join(out, `checks-${captureOnly}-${surface}.json`), JSON.stringify({ browser: 'headless Chromium', node: process.version, baseline, rows, checks }, null, 2) + '\n'); }
console.log(`Captured ${checks.filter(c => c.screenshot).length} states; wrote checks-${captureOnly}-${surface}.json.`);
