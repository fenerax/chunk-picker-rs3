// Actual Chromium + production server, disposable synthetic stores only.
// PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/perf/short-height-browser.mjs
// Add --baseline SHA for three alternating UI pairs; --measure-only records defects.
// Browser font preferences are tested; genuine browser zoom is not simulated.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../ci/gallery-support.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const baseline = option('baseline'), measureOnly = process.argv.includes('--measure-only');
const baselineFiles = baseline && new Map(['style.css', 'phone-layout.css', 'screen-dialogs.mjs'].map(file => ['/' + file, execFileSync('git', ['show', `${baseline}:app/web/${file}`], { encoding: 'utf8' })]));
process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_GAME_DATA_DIR', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
const { createServer } = await import('../../app/server.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
const { duoFixture } = await import('../../tests/fixtures/partner.mjs');
const directory = await mkdtemp(path.join(tmpdir(), 'short-height-'));
const rows = [], failures = [];
let app;
const settle = async page => { await page.waitForTimeout(180); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
function check(row, name, pass, detail) {
  row.checks++; if (!pass) { row.failures++; failures.push({ font: row.font, height: row.height, notice: row.notice, variant: row.variant, name, detail }); }
}
async function focused(page) {
  return page.evaluate(() => {
    const e = document.activeElement, r = e.getBoundingClientRect(), dialog = e.closest('dialog');
    const header = dialog?.querySelector('.dialog-header').getBoundingClientRect();
    const content = dialog?.querySelector('#dialog-content'), cr = content?.getBoundingClientRect();
    let top = content?.contains(e) ? Math.max(0, header.bottom, cr.top) : 0;
    let bottom = dialog ? Math.min(innerHeight, dialog.getBoundingClientRect().bottom, content?.contains(e) ? cr.bottom : Infinity) : document.querySelector('#phone-tabs').getBoundingClientRect().top;
    for (let parent = e.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'visible') continue;
      const clip = parent.getBoundingClientRect(), edge = clip.top + parent.clientTop;
      top = Math.max(top, edge); bottom = Math.min(bottom, edge + parent.clientHeight);
    }
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { top: r.top, bottom: r.bottom, dialogScroll: dialog?.scrollTop, contentScroll: content?.scrollTop, contentTop: cr?.top, contentBottom: cr?.bottom, headerBottom: header?.bottom, control: e !== document.body, id: e.id, text: e === document.body ? '' : e.textContent?.slice(0, 100), height: r.height, visible: Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top)), hit: e === hit || e.contains(hit), owner: hit?.tagName };
  });
}
async function tabTo(page, selector, row, name, backwards = false) {
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    if (await page.evaluate(s => document.activeElement.matches(s), selector)) {
      await settle(page); const geometry = await focused(page);
      check(row, name, geometry.height >= 44 && geometry.visible >= geometry.height - 1 && geometry.hit, geometry);
      return geometry;
    }
  }
  console.error('unreachable', name, await focused(page), await page.locator(selector).count()); check(row, name, false, 'Unreachable by Tab');
}
async function dialogWalk(page, row, name) {
  // Inspect every settled native Tab stop, including reverse traversal. No script scroll.
  for (const backwards of [false, true]) for (let i = 0; i < 7; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab'); await settle(page);
    const g = await focused(page);
    if (!g.control) continue; // Chromium has a body stop when the modal Tab cycle wraps.
    check(row, `${name}:${backwards ? 'reverse' : 'forward'}:${i}`, g.visible >= g.height - 1 && g.hit, g);
  }
}
try {
  for (const font of option('font') ? [Number(option('font'))] : [16, 24]) {
    const profile = path.join(directory, `browser-${font}`);
    await mkdir(path.join(profile, 'Default'), { recursive: true });
    await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: font, default_fixed_font_size: font, minimum_font_size: font === 24 ? 24 : 0 } } }));
    const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH || await findChrome(), headless: true, args: ['--no-sandbox'], viewport: { width: 320, height: 240 } });
    try {
      for (let pair = 0; pair < Number(option('pairs') || (baseline ? 3 : 1)); pair++) for (const variant of baseline ? pair % 2 ? ['after', 'before'] : ['before', 'after'] : ['after']) {
        for (const height of option('height') ? [Number(option('height'))] : [240, 256, 844]) for (const notice of [true, false]) {
          const { data: definitions, state } = duoFixture();
          state.members.forEach((member, i) => { member.name = `P${i + 1}`; member.preferences = { roll2: true, unpick: true }; });
          state.members[0].selected = ['12851', '12852'];
          app = await createServer({ dataset: selectedDataset, dataDir: path.join(directory, `game-${rows.length}`), initialState: state, definitions, taskMap: {}, host: '127.0.0.1', port: 0, predictionPrewarm: false, random: () => .25 });
          await app.listen();
          const page = await context.newPage(); page.setDefaultTimeout(10000); console.error('flow', font, height, notice, variant); await page.setViewportSize({ width: 320, height });
          const row = { font, height, notice, pair: pair + 1, variant, checks: 0, failures: 0, errors: [] }; rows.push(row);
          page.on('pageerror', error => row.errors.push(error.message));
          if (variant === 'before') await page.route('**/*', route => {
            const file = new URL(route.request().url()).pathname;
            return baselineFiles.has(file) ? route.fulfill({ body: baselineFiles.get(file), contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' }) : route.continue();
          });
          await page.goto(app.inviteUrl, {waitUntil: 'domcontentloaded'}); await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
          check(row, 'fresh backup warning present', await page.locator('#backup-status-notice').isVisible());
          if (!notice) await page.locator('#backup-status-notice').evaluate(e => e.hidden = true);
          await settle(page);
          row.rootFont = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
          row.browserFont = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.fontSize = 'medium'; document.body.append(probe); const size = parseFloat(getComputedStyle(probe).fontSize); probe.remove(); return size; });
          check(row, 'browser font preference applied', row.browserFont === font, row.browserFont);
          row.workspace = await page.locator('.workspace').evaluate(e => e.getBoundingClientRect().height);
          check(row, 'workspace has usable height', row.workspace >= 120, row.workspace);
          row.roll = await tabTo(page, '#pick', row, 'Roll visible');
          await tabTo(page, '#phone-controls-toggle', row, 'Controls visible');
          if (await page.locator('#phone-controls-toggle').getAttribute('aria-expanded') === 'false') await page.keyboard.press('Enter'); await settle(page);
          await tabTo(page, '#unpick', row, 'Forfeit visible');
          await page.keyboard.press('Enter'); await page.locator('#tool-dialog').waitFor();
          await dialogWalk(page, row, 'confirmation');
          await tabTo(page, '#dialog-content > button:last-child', row, 'Cancel visible');
          await page.keyboard.press('Enter'); await settle(page);
          check(row, 'Cancel closes dialog', await page.locator('#tool-dialog').evaluate(e => !e.open));
          await page.locator('#phone-tab-map').focus(); await page.keyboard.press('ArrowRight');
          await tabTo(page, '#task-filter', row, 'task search visible');
          await page.keyboard.type('OwnItem'); await settle(page);
          await page.locator('#active-tasks .task-label-button').first().waitFor({ state: 'attached' });
          await tabTo(page, '#active-tasks .task-label-button', row, 'task visible');
          await page.keyboard.press('Enter'); await page.locator('#tool-dialog').waitFor();
          await dialogWalk(page, row, 'task detail');
          row.taskBody = await page.locator('#dialog-content').evaluate(e => ({ height: e.clientHeight, scrollHeight: e.scrollHeight }));
          await page.keyboard.press('Escape'); await settle(page);
          // A separate longer synthetic task stresses a wrapping title, without
          // conflating its narrow row with the short-name shell checks above.
          await page.locator('#task-filter').focus();
          await page.keyboard.press('Control+A'); await page.keyboard.type('Partner sword'); await settle(page);
          await page.locator('#active-tasks .task-label-button').first().waitFor({ state: 'attached' });
          let reached = false;
          for (let i = 0; i < 100; i++) {
            await page.keyboard.press('Tab');
            if (await page.evaluate(() => document.activeElement.matches('#active-tasks .task-label-button'))) { reached = true; break; }
          }
          assert.ok(reached, JSON.stringify({ message: 'Long-title task is keyboard reachable', focus: await focused(page), search: await page.locator('#task-filter').inputValue(), tasks: await page.locator('#active-tasks .task-label-button').allTextContents() }));
          await settle(page); await page.keyboard.press('Enter'); await page.locator('#tool-dialog').waitFor();
          row.title = await page.locator('#dialog-title').evaluate(e => {
            const r = e.getBoundingClientRect(), header = e.parentElement.getBoundingClientRect();
            return { height: r.height, lineHeight: parseFloat(getComputedStyle(e).lineHeight), visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= header.left && r.right <= header.right };
          });
          check(row, 'title remains readable', row.title.visible, row.title);
          if (font === 24) check(row, 'enlarged title wraps', row.title.height > row.title.lineHeight * 1.5, row.title);
          await dialogWalk(page, row, 'wrapping task title');
          await page.keyboard.press('Escape'); await settle(page);
          check(row, 'Escape closes dialog', await page.locator('#tool-dialog').evaluate(e => !e.open));
          // Roll and inspect its result without committing a choice.
          await page.locator('#phone-tab-tasks').focus(); await page.keyboard.press('Home');
          await tabTo(page, '#phone-controls-toggle', row, 'result Controls visible');
          if (await page.locator('#phone-controls-toggle').getAttribute('aria-expanded') === 'false') await page.keyboard.press('Enter'); await tabTo(page, '#roll-two', row, 'result Roll two visible');
          await page.keyboard.press('Enter'); await page.locator('#pending-panel .primary-action').first().waitFor({ state: 'attached' });
          await tabTo(page, '#pending-panel .primary-action', row, 'result visible');
          check(row, 'no page errors', row.errors.length === 0, row.errors);
          console.log(JSON.stringify(row)); if (option('output')) await writeFile(option('output'), JSON.stringify({rows, failures}, null, 2)); await page.close(); await app.close(); app = undefined; await context.clearCookies();
        }
      }
    } finally { await context.close(); }
  }
} finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
const result = { node: process.version, baseline, rows, failures };
if (option('output')) await writeFile(option('output'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ checks: rows.reduce((n, r) => n + r.checks, 0), failures: failures.length, candidateFailures: failures.filter(f => f.variant === 'after').length }));
if (!measureOnly) assert.equal(failures.filter(f => f.variant === 'after').length, 0, JSON.stringify(failures.filter(f => f.variant === 'after').slice(0, 5)));
