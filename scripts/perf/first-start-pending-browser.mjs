// Disposable open-f2p browser replay; no private packs, saves or project deps.
// RS3_DATASET=open-f2p node scripts/perf/first-start-pending-browser.mjs \
//   --playwright /path/to/playwright/index.mjs [--baseline]
// --baseline characterizes START's contradiction; default asserts the fix.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.RS3_DATASET, 'open-f2p', 'Select the public synthetic dataset before imports.');
assert.ok(Number(process.versions.node.split('.')[0]) > 24 || (Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 20));
const baseline = process.argv.includes('--baseline');
const modulePath = process.argv[process.argv.indexOf('--playwright') + 1];
assert.ok(process.argv.includes('--playwright') && modulePath, 'Supply --playwright.');
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)));
const { createServer } = await import('../../app/server.mjs');
const { createGroupState } = await import('../../app/core/state.mjs');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const results = [];
let checks = 0;
const check = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
try {
  for (const input of ['pointer', 'keyboard']) for (const action of ['first', 'second', 'pick', 'both', 'cancel']) {
    const directory = await mkdtemp(path.join(tmpdir(), 'first-start-browser-'));
    let application, context;
    const started = performance.now();
    try {
      const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
      for (const member of initialState.members) member.preferences = { setupGuide: 'skipped' };
      application = await createServer({ dataDir: path.join(directory, 'game'), port: 0, initialState });
      await application.listen();
      const origin = `http://127.0.0.1:${application.address().port}`;
      context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(application.inviteUrl);
      await page.locator('#empty-map:not([hidden])').waitFor();
      const state = async () => (await (await context.request.get(`${origin}/api/state`)).json()).state;
      const command = async value => {
        const current = await state();
        const response = await context.request.post(`${origin}/api/command`, { headers: { Origin: origin }, data: { expectedRevision: current.revision, command: value } });
        check(response.status(), 200, 'Synthetic setup command succeeds');
        return (await response.json()).state;
      };
      const activate = async locator => {
        if (input === 'pointer') return locator.click();
        for (let i = 0; i < 200; i++) {
          if (await locator.evaluate(node => node === document.activeElement)) return page.keyboard.press('Enter');
          await page.keyboard.press('Tab');
        }
        throw Error('Keyboard could not reach the action.');
      };
      const clickCommand = async (locator, type, status = 200) => {
        const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/command' && response.request().postDataJSON()?.command?.type === type);
        await activate(locator);
        check((await response).status(), status, `${input} ${type} status`);
      };
      // Offer two first-start choices through the real command path, then load
      // them through ordinary startup, including after a reload.
      const pending = await command({ type: 'random-start', memberId: 'player1', count: 2 });
      const ids = pending.members[0].pendingRoll;
      check(ids.length, 2, 'Two first-start choices');
      await page.reload();
      await page.locator('#pending-panel:not([hidden])').waitFor();
      check(await page.locator('#empty-map').isVisible(), baseline, 'Only pending guidance is visible');
      check(await page.locator('#random-start').isVisible(), baseline, 'Random start guidance is unavailable while pending');
      if (baseline) {
        await clickCommand(page.locator('#random-start'), 'random-start', 400);
        check((await state()).revision, pending.revision, 'Refusal preserves revision');
        const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
        if (await dismiss.isVisible()) await activate(dismiss);
      } else {
        // Hidden first-start buttons must also leave the keyboard tab order.
        await page.locator('#roll-two').evaluate(node => node.focus());
        for (let i = 0; i < 35; i++) {
          await page.keyboard.press('Tab');
          check(await page.locator('#empty-map').evaluate(node => node.contains(document.activeElement)), false, 'Tab skips first-start card');
        }
      }
      const choiceButtons = page.locator('#pending-panel .primary-action');
      const target = action === 'first' ? choiceButtons.nth(0) : action === 'second' ? choiceButtons.nth(1)
        : page.getByRole('button', { name: action === 'pick' ? 'Pick for me' : action === 'both' ? 'Unlock both' : 'Cancel roll', exact: true });
      const type = action === 'first' || action === 'second' ? 'unlock-selection' : action === 'pick' ? 'pick-for-me' : action === 'both' ? 'unlock-both' : 'cancel-roll';
      await clickCommand(target, type);
      await page.locator('#pending-panel').waitFor({ state: 'hidden' });
      const resolved = await state(), owner = resolved.members[0];
      check(owner.pendingRoll.length, 0, 'Pending choices resolve');
      check(owner.unlocked.length, action === 'cancel' ? 0 : action === 'both' ? 2 : 1, 'Expected unlock count');
      if (action === 'first' || action === 'second') check(owner.unlocked[0], ids[action === 'first' ? 0 : 1], 'Chosen destination');
      check(await page.locator('#empty-map').isVisible(), action === 'cancel', 'Ordinary guidance only for unstarted maps');
      if (action !== 'cancel') {
        await clickCommand(page.locator('#undo'), 'undo');
        await page.locator('#pending-panel:not([hidden])').waitFor();
        check(await page.locator('#empty-map').isVisible(), baseline, 'Undo restores pending guidance');
        await clickCommand(page.getByRole('button', { name: 'Cancel roll', exact: true }), 'cancel-roll');
      }
      await page.locator('#empty-map:not([hidden])').waitFor();
      await clickCommand(page.locator('#random-start'), 'random-start');
      await page.locator('#empty-map').waitFor({ state: 'hidden' });
      check((await state()).members[0].unlocked.length, 1, 'Ordinary random start works after cancellation');
      check(errors.length, 0, 'No browser runtime errors');
      results.push({ input, action, elapsedMs: Math.round(performance.now() - started) });
      console.log(`${input} ${action}: passed`);
    } finally {
      await context?.close();
      await application?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
} finally { await browser.close(); }
const durations = results.map(row => row.elapsedMs).sort((a, b) => a - b);
console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'fixed', journeys: results.length, checks, failures: 0,
  durationMs: { median: (durations[4] + durations[5]) / 2, min: durations[0], max: durations.at(-1) }, results }, null, 2));
