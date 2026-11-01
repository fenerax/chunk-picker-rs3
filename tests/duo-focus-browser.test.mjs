// Opt-in Chromium regression against the production server and synthetic saves.
// RS3_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs RS3_DATASET=open-f2p \
//   node --test tests/duo-focus-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { emptyMetadataDataset } from './helpers/server-dataset.mjs';

const playwright = process.env.RS3_PLAYWRIGHT_MODULE;
const active = (page, selector) => page.locator(selector).evaluate(node => node === document.activeElement && !node.disabled && node.checkVisibility());
async function tabTo(page, selector) {
  for (let i = 0; i < 250; i++) {
    if (await active(page, selector)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail(`Unreachable keyboard target: ${selector}`);
}

test('owner filters and consecutive Undo retain browser focus', { skip: !playwright }, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(playwright)));
  const browser = await chromium.launch({ executablePath: process.env.RS3_CHROMIUM ?? await findChrome(), headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  async function fixture(t, { phone = false, group = true, hide = false } = {}) {
    const directory = await mkdtemp(path.join(tmpdir(), 'duo-focus-'));
    const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['12341'] }, { id: 'two', name: 'Two', unlocked: ['12341'] }]);
    state.tasks = ['a', 'b'].map(id => ({ id: `custom:${id}`, label: `Focus task ${id}`, category: 'Custom', memberIds: ['one'] }));
    for (const member of state.members) member.preferences = { ...member.preferences, hideChecked: hide };
    const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} };
    const app = await createServer({ dataset: await emptyMetadataDataset(), dataDir: directory, initialState: state, definitions, taskMap: {}, port: 0, predictionPrewarm: false });
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    t.after(async () => { await context.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
    const baseline = process.env.RS3_FOCUS_BASELINE_WEB;
    if (baseline) await context.route(/\/(duo-task-view|duo-coordination|screen-startup|screen-map)\.mjs(?:\?|$)/, async route => {
      await route.fulfill({ body: await readFile(path.join(baseline, new URL(route.request().url()).pathname.slice(1))), contentType: 'text/javascript' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const commands = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/command') commands.push(request.postDataJSON()); });
    // Observe the shipped paint boundary so a late task redraw cannot race the
    // next setup keystroke. This does not alter focus or suppress any redraw.
    await page.addInitScript(({ group }) => {
      window.__rs3Perf = { enabled: true, events: [] };
      localStorage.setItem('rs3:task-view', JSON.stringify({ groupView: group }));
    }, { group });
    const tasksReady = expected => page.waitForFunction(({ revision, group }) => window.__rs3Perf.events.some(event =>
      event.name === (group ? 'duo-tasks-shown' : 'tasks-shown') && event.revision === revision), { revision: expected, group });
    await app.listen();
    await page.goto(app.inviteUrl);
    if (phone) await page.locator('#phone-tab-tasks').click();
    await tasksReady(0);
    assert.equal(await page.locator('#group-view').isChecked(), group);
    await page.locator('#active-tasks [data-task-id="custom:a"]').waitFor();
    const revision = () => app.store.getState().revision;
    const completions = () => Object.values(app.store.getState().members[0].taskStatus ?? {}).filter(value => value.challengeCompleted).length;
    const settle = async expected => {
      await page.waitForFunction(() => document.getElementById('save-status').dataset.status === 'saved' && !document.getElementById('undo').disabled);
      if (group) await tasksReady(expected);
      assert.equal(revision(), expected); assert.deepEqual(errors, []);
    };
    return { app, page, commands, revision, completions, settle };
  }
  async function completeTwo(h, pointer = false) {
    for (const [index, id] of ['a', 'b'].entries()) {
      const selector = `#active-tasks [data-task-id="custom:${id}"] input[type=checkbox]`;
      if (pointer) await h.page.locator(selector).click();
      else { await tabTo(h.page, selector); await h.page.keyboard.press('Space'); }
      await h.settle(index + 1);
    }
  }
  for (const phone of [false, true]) for (const hide of [false, true]) {
    const label = `${phone ? 'phone' : 'desktop'}, hide ${hide}`;
    await t.test(`owner activation: ${label}`, async t => {
      const h = await fixture(t, { phone, hide });
      for (const index of [2, 3, 4, 1]) {
        const chip = `.duo-task-chip:nth-child(${index})`;
        await tabTo(h.page, chip); await h.page.keyboard.press('Enter');
        await h.page.waitForFunction(selector => document.querySelector(selector).getAttribute('aria-pressed') === 'true', chip);
        assert.equal(await active(h.page, chip), true);
      }
      await h.page.locator('.duo-task-chip:nth-child(2)').click();
      assert.equal(await active(h.page, '.duo-task-chip:nth-child(2)'), true);
      assert.equal(h.commands.length, 0); assert.equal(h.revision(), 0); assert.equal(h.completions(), 0);
    });
    for (const group of [false, true]) for (const pointer of [false, true]) {
      await t.test(`two Undos: ${label}, group ${group}, pointer ${pointer}`, async t => {
        const h = await fixture(t, { phone, hide, group });
        await completeTwo(h, pointer);
        assert.equal(h.completions(), 2);
        assert.equal(await h.page.locator('#active-tasks [data-task-id^="custom:"] input:checked').count(), hide ? 0 : 2);
        if (phone) await h.page.locator('#phone-tab-map').click();
        if (!pointer) await tabTo(h.page, '#undo');
        for (let index = 0; index < 2; index++) {
          if (pointer) await h.page.locator('#undo').click(); else await h.page.keyboard.press('Enter');
          if (index === 0) {
            await h.settle(3);
            assert.equal(await active(h.page, '#undo'), true);
          } else {
            await h.page.waitForFunction(() => document.getElementById('undo').disabled && document.getElementById('save-status').dataset.status === 'saved');
            // Wait for current metadata, rather than the earlier stale-revision disable.
            const fallback = phone ? '#phone-tab-map' : '#info-tools > summary';
            await h.page.waitForFunction(selector => document.querySelector(selector) === document.activeElement, fallback);
            assert.equal(await active(h.page, fallback), true);
            assert.equal(h.revision(), 4); assert.equal(h.completions(), 0);
          }
        }
        assert.deepEqual(h.commands.map(row => row.command.type), ['set-task-status', 'set-task-status', 'undo', 'undo']);
        assert.deepEqual(h.commands.slice(2).map(row => row.command.undoRevision), [2, 1]);
      });
    }
  }
  for (const action of ['none', 'Tab', 'pointer', 'focus', 'blur', 'early Enter']) await t.test(`delayed coordination: ${action}`, { timeout: 15000 }, async t => {
    const h = await fixture(t); await completeTwo(h);
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const held = new Promise(resolve => { arrived = resolve; });
    await h.page.route('**/api/coordination', async route => {
      const response = await route.fetch(); arrived(); await gate;
      await route.fulfill({ response });
    });
    t.after(() => release());
    await tabTo(h.page, '#undo'); await h.page.keyboard.press('Enter'); await held;
    assert.equal(await h.page.locator('#undo').isDisabled(), true);
    assert.equal(h.revision(), 3); assert.equal(h.completions(), 1); assert.equal(h.commands.length, 3);
    if (action === 'Tab') await h.page.keyboard.press('Tab');
    else if (action === 'pointer') await h.page.locator('#task-filter').click();
    else if (action === 'focus') await h.page.locator('#task-filter').focus();
    else if (action === 'blur') await h.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else if (action === 'early Enter') await h.page.keyboard.press('Enter');
    // Record the user's destination, including BODY after an early key or blur.
    const destination = await h.page.evaluateHandle(() => document.activeElement);
    release(); await h.settle(3);
    if (action === 'none') assert.equal(await active(h.page, '#undo'), true);
    else assert.equal(await h.page.evaluate(node => document.activeElement === node, destination), true);
    assert.equal(h.commands.length, 3); assert.equal(h.completions(), 1);
    // Explicit recovery still executes exactly one command using fresh metadata.
    await h.page.unroute('**/api/coordination');
    await tabTo(h.page, '#undo'); await h.page.keyboard.press('Enter');
    await h.page.waitForFunction(() => document.querySelector('#info-tools > summary') === document.activeElement);
    assert.equal(h.revision(), 4); assert.equal(h.completions(), 0); assert.equal(h.commands.length, 4);
  });
});
