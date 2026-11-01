// Full-app acceptance using public synthetic definitions and the shipped UI/CSS.
// PLAYWRIGHT_MODULE may point at a preinstalled playwright-core; no dependency is added.
// RS3_DATASET=duo-legacy node scripts/perf/task-rule-explanations-browser.mjs --out /tmp/rule-ui
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../../app/server.mjs';
import { createTaskEngine, taskId } from '../../app/tasks/engine.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { ruleExplanationFixture } from '../../tests/fixtures/rule-explanations.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const outputIndex = process.argv.indexOf('--out');
const output = path.resolve(outputIndex < 0 ? '/tmp/rule-ui' : process.argv[outputIndex + 1]);
const scratch = await mkdtemp(path.join(tmpdir(), 'task-rule-browser-'));
const { definitions, state: authored } = ruleExplanationFixture();
const initialState = Object.assign(createGroupState(authored.members.map(({taskAlternatives, ...member}) => member)), { rules: authored.rules });
initialState.tasks = [...createTaskEngine(definitions).catalogue.map(({id,label,category}) => ({id,label,category})),
  { id: taskId('Mining', 'Fixture missing choice'), category: 'Mining', label: 'Fixture missing choice' }];
initialState.members[0].taskRules = authored.taskRules;
initialState.members[0].taskAlternatives = { Mining: { '5': taskId('Mining', 'Fixture missing choice') } };
let app, browser;
const checks = [];
try {
  await mkdir(output, { recursive: true });
  app = await createServer({ dataset: selectedDataset, definitions, initialState, taskMap: {}, dataDir: path.join(scratch, 'game'),
    gameDataDir: path.join(scratch, 'absent'), mapAssetsDir: path.join(scratch, 'absent'), terrainAssetsDir: path.join(scratch, 'absent'),
    iconAssetsDir: path.join(scratch, 'absent'), host: '127.0.0.1', port: 8976, predictionPrewarm: false });
  await app.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (const phone of [false, true]) {
    const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    const click = async locator => { if (phone) await locator.tap(); else await locator.click(); };
    await page.goto(app.inviteUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
    if (phone) await click(page.locator('#phone-tab-tasks'));
    await page.locator('#active-tasks').getByRole('button', { name: 'Fixture ranked goal', exact: true }).waitFor();
    await click(page.locator('#group-view'));
    await page.waitForFunction(() => !document.querySelector('#task-count').textContent.startsWith('Duo'));
    await page.waitForFunction(() => document.querySelector('#task-engine-status').textContent.includes('possible tasks'));
    for (const [label, expected, absent] of [
      ['Fixture source consumer', /Fixture supply.*allowed sources.*Fixture other producer/, /outside.*map/i],
      ['Fixture duplicate recipe', /no-XP.*Fixture product.*independent.*all.*outputs/i, /lower-level|frontier/],
      ['Fixture ranked goal', /saved task choice.*Fixture missing choice.*unavailable.*Fixture ranked goal/i, /outside.*map/i],
    ]) {
      const absentFromActive = label !== 'Fixture ranked goal';
      if (absentFromActive) assert.equal(await page.locator('#active-tasks').getByRole('button', { name: label, exact: true }).count(), 0);
      if (phone) await click(page.locator('#phone-tab-more'));
      const searchButton = page.locator('#search-open'), parent = searchButton.locator('xpath=ancestor::details[1]');
      if (await parent.count() && !await parent.evaluate(element => element.open)) await click(parent.locator(':scope > summary'));
      await click(searchButton);
      await page.locator('#dialog-content select').first().selectOption({ label: 'Tasks' });
      await page.locator('#dialog-content input[type=search]').first().fill(label);
      const found = page.locator('.search-results').getByRole('button', { name: `View ${label}`, exact: true });
      await found.waitFor();
      await click(found);
      const dialog = page.locator('#dialog-content');
      await dialog.locator('.task-detail-why .task-why').waitFor();
      assert.match(await dialog.innerText(), expected); assert.doesNotMatch(await dialog.innerText(), absent);
      const toggle = dialog.locator('.task-detail-why .task-why');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await click(toggle);
      const panel = dialog.locator('.task-detail-why .task-why-panel');
      await panel.locator('.task-why-content').waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.match(await panel.innerText(), expected); assert.doesNotMatch(await panel.innerText(), absent);
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
        css: [...document.styleSheets].some(sheet => sheet.href?.endsWith('/style.css')), panelDisplay: getComputedStyle(document.querySelector('.task-detail-why .task-why-panel')).display }));
      assert.equal(layout.overflow, 0); assert.equal(layout.css, true); assert.notEqual(layout.panelDisplay, 'none');
      await panel.scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'expanded reason is reachable in the dialog viewport');
      const screenshot = `${phone ? 'phone' : 'desktop'}-${checks.length % 3}.png`;
      await page.screenshot({ path: path.join(output, screenshot) });
      checks.push({ viewport, absentFromActive, detail: true, why: true, expanded: true, layout, screenshot });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('#tool-dialog').waitFor({ state: 'hidden' });
    }
    assert(requests.some(url => /rules/.test(url)), 'real rule model was requested');
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, passed: checks.length, failed: 0 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, failed: 0 }));
} finally {
  await browser?.close(); await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
