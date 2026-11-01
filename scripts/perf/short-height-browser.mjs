// Actual Chromium + production server, disposable synthetic stores only.
// node scripts/perf/short-height-browser.mjs (Chrome auto-detected; no npm deps)
// Add --baseline SHA for three alternating UI pairs; --measure-only records defects.
// Browser font preferences are tested; genuine browser zoom is not simulated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../ci/gallery-support.mjs';
import { openChrome, until, sleep } from './cdp.mjs';
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const baseline = option('baseline'), measureOnly = process.argv.includes('--measure-only');
const baselineFiles = baseline && new Map(['style.css', 'phone-layout.css', 'screen-dialogs.mjs'].map(file => ['/' + file, execFileSync('git', ['show', `${baseline}:app/web/${file}`], { encoding: 'utf8' })]));
process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_GAME_DATA_DIR', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN']) delete process.env[key];
const executable = await findChrome();
const { createServer } = await import('../../app/server.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
const { duoFixture } = await import('../../tests/fixtures/partner.mjs');
const directory = await mkdtemp(path.join(tmpdir(), 'short-height-'));
const rows = [], failures = [];
let app;
const evaluate = (page, fn, ...args) => page.evaluate(`(${fn})(${args.map(value => JSON.stringify(value)).join(',')})`);
const ready = (page, expression) => until(() => page.evaluate(`Boolean(${expression})`), 10000);
const settle = async page => { await sleep(180); await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); };
async function press(page, key, modifiers = 0) {
  const keys = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27], ArrowRight: ['ArrowRight', 39], Home: ['Home', 36], a: ['KeyA', 65] };
  const [code, windowsVirtualKeyCode] = keys[key];
  const event = { key, code, windowsVirtualKeyCode, modifiers };
  // Tab and Shift+Tab must run Chromium's real focus traversal and scrolling.
  await page.send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', ...event,
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}
function check(row, name, pass, detail) {
  row.checks++; if (!pass) { row.failures++; failures.push({ font: row.font, height: row.height, notice: row.notice, variant: row.variant, name, detail }); }
}
async function focused(page) {
  return evaluate(page, () => {
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
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom, dialogScroll: dialog?.scrollTop, contentScroll: content?.scrollTop, contentTop: cr?.top, contentBottom: cr?.bottom, headerBottom: header?.bottom, control: e !== document.body, id: e.id, text: e === document.body ? '' : e.textContent?.slice(0, 100), height: r.height, visible: Math.max(0, Math.min(bottom, r.bottom) - Math.max(top, r.top)), hit: e === hit || e.contains(hit), owner: hit?.tagName };
  });
}
async function tabTo(page, selector, row, name, backwards = false) {
  for (let i = 0; i < 100; i++) {
    await press(page, 'Tab', backwards ? 8 : 0);
    if (await evaluate(page, s => document.activeElement.matches(s), selector)) {
      await settle(page); const geometry = await focused(page);
      check(row, name, geometry.height >= 44 && geometry.visible >= geometry.height - 1 && geometry.hit, geometry);
      return geometry;
    }
  }
  console.error('unreachable', name, await focused(page), await evaluate(page, s => document.querySelectorAll(s).length, selector)); check(row, name, false, 'Unreachable by Tab');
}
async function dialogWalk(page, row, name) {
  // Inspect every settled native Tab stop, including reverse traversal. No script scroll.
  for (const backwards of [false, true]) for (let i = 0; i < 7; i++) {
    await press(page, 'Tab', backwards ? 8 : 0); await settle(page);
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
    const page = await openChrome(executable, profile, {
      extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    try {
      for (let pair = 0; pair < Number(option('pairs') || (baseline ? 3 : 1)); pair++) for (const variant of baseline ? pair % 2 ? ['after', 'before'] : ['before', 'after'] : ['after']) {
        for (const height of option('height') ? [Number(option('height'))] : [240, 256, 844]) for (const notice of [true, false]) {
          const { data: definitions, state } = duoFixture();
          state.members.forEach((member, i) => { member.name = `P${i + 1}`; member.preferences = { roll2: true, unpick: true }; });
          state.members[0].selected = ['12851', '12852'];
          app = await createServer({ dataset: selectedDataset, dataDir: path.join(directory, `game-${rows.length}`), initialState: state, definitions, taskMap: {}, host: '127.0.0.1', port: 0, predictionPrewarm: false, random: () => .25 });
          await app.listen();
          console.error('flow', font, height, notice, variant);
          await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height, deviceScaleFactor: 1, mobile: false });
          const row = { font, height, notice, pair: pair + 1, variant, checks: 0, failures: 0, errors: [] }; rows.push(row);
          const onEvent = ({ method, params }) => {
            if (method === 'Runtime.exceptionThrown') row.errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
            if (method !== 'Fetch.requestPaused') return;
            const file = new URL(params.request.url).pathname;
            const response = variant === 'before' && baselineFiles.has(file)
              ? page.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: file.endsWith('.css') ? 'text/css' : 'text/javascript' }],
                body: Buffer.from(baselineFiles.get(file)).toString('base64') })
              : page.send('Fetch.continueRequest', { requestId: params.requestId });
            response.catch(error => row.errors.push(error.message));
          };
          page.listeners.add(onEvent);
          if (variant === 'before') await page.send('Fetch.enable', { patterns: [...baselineFiles.keys()].map(file => ({ urlPattern: `*${file}` })) });
          await page.send('Page.navigate', { url: app.inviteUrl });
          await ready(page, "document.querySelector('#save-status')?.textContent === 'Saved'");
          check(row, 'fresh backup warning present', await page.evaluate("document.querySelector('#backup-status-notice').checkVisibility()"));
          if (!notice) await page.evaluate("document.querySelector('#backup-status-notice').hidden = true");
          await settle(page);
          row.rootFont = await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize)');
          row.browserFont = await evaluate(page, () => { const probe = document.createElement('span'); probe.style.fontSize = 'medium'; document.body.append(probe); const size = parseFloat(getComputedStyle(probe).fontSize); probe.remove(); return size; });
          check(row, 'browser font preference applied', row.browserFont === font, row.browserFont);
          row.workspace = await page.evaluate("document.querySelector('.workspace').getBoundingClientRect().height");
          check(row, 'workspace has usable height', row.workspace >= 120, row.workspace);
          row.roll = await tabTo(page, '#pick', row, 'Roll visible');
          await tabTo(page, '#phone-controls-toggle', row, 'Controls visible');
          if (await page.evaluate("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded')") === 'false') await press(page, 'Enter'); await settle(page);
          await tabTo(page, '#unpick', row, 'Forfeit visible');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#tool-dialog').open");
          await dialogWalk(page, row, 'confirmation');
          await tabTo(page, '#dialog-content > button:last-child', row, 'Cancel visible');
          await press(page, 'Enter'); await settle(page);
          check(row, 'Cancel closes dialog', await page.evaluate("!document.querySelector('#tool-dialog').open"));
          // Preserve the original navigation anchors. Every measured control is
          // still reached by native Tab, never by focus() or scripted scrolling.
          await page.evaluate("document.querySelector('#phone-tab-map').focus()"); await press(page, 'ArrowRight');
          await tabTo(page, '#task-filter', row, 'task search visible');
          await page.send('Input.insertText', { text: 'OwnItem' }); await settle(page);
          await ready(page, "document.querySelector('#active-tasks .task-label-button')");
          await tabTo(page, '#active-tasks .task-label-button', row, 'task visible');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#tool-dialog').open");
          await dialogWalk(page, row, 'task detail');
          row.taskBody = await evaluate(page, () => { const e = document.querySelector('#dialog-content'); return { height: e.clientHeight, scrollHeight: e.scrollHeight }; });
          await press(page, 'Escape'); await settle(page);
          // A separate longer synthetic task stresses a wrapping title, without
          // conflating its narrow row with the short-name shell checks above.
          await page.evaluate("document.querySelector('#task-filter').focus()");
          await press(page, 'a', 2); await page.send('Input.insertText', { text: 'Partner sword' }); await settle(page);
          await ready(page, "document.querySelector('#active-tasks .task-label-button')");
          let reached = false;
          for (let i = 0; i < 100; i++) {
            await press(page, 'Tab');
            if (await page.evaluate("document.activeElement.matches('#active-tasks .task-label-button')")) { reached = true; break; }
          }
          assert.ok(reached, JSON.stringify({ message: 'Long-title task is keyboard reachable', focus: await focused(page), search: await page.evaluate("document.querySelector('#task-filter').value"), tasks: await page.evaluate("[...document.querySelectorAll('#active-tasks .task-label-button')].map(e => e.textContent)") }));
          await settle(page); await press(page, 'Enter'); await ready(page, "document.querySelector('#tool-dialog').open");
          row.title = await evaluate(page, () => {
            const e = document.querySelector('#dialog-title');
            const r = e.getBoundingClientRect(), header = e.parentElement.getBoundingClientRect();
            return { height: r.height, lineHeight: parseFloat(getComputedStyle(e).lineHeight), visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= header.left && r.right <= header.right };
          });
          check(row, 'title remains readable', row.title.visible, row.title);
          if (font === 24) check(row, 'enlarged title wraps', row.title.height > row.title.lineHeight * 1.5, row.title);
          await dialogWalk(page, row, 'wrapping task title');
          await press(page, 'Escape'); await settle(page);
          check(row, 'Escape closes dialog', await page.evaluate("!document.querySelector('#tool-dialog').open"));
          // Roll and inspect its result without committing a choice.
          await page.evaluate("document.querySelector('#phone-tab-tasks').focus()"); await press(page, 'Home');
          await tabTo(page, '#phone-controls-toggle', row, 'result Controls visible');
          if (await page.evaluate("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded')") === 'false') await press(page, 'Enter'); await tabTo(page, '#roll-two', row, 'result Roll two visible');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#pending-panel .primary-action')");
          await tabTo(page, '#pending-panel .primary-action', row, 'result visible');
          check(row, 'no page errors', row.errors.length === 0, row.errors);
          console.log(JSON.stringify(row)); if (option('output')) await writeFile(option('output'), JSON.stringify({rows, failures}, null, 2));
          if (variant === 'before') await page.send('Fetch.disable');
          await page.send('Page.navigate', { url: 'about:blank' });
          page.listeners.delete(onEvent);
          await app.close(); app = undefined; await page.send('Network.clearBrowserCookies');
        }
      }
    } finally { await page.close(); }
  }
} finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
const result = { node: process.version, baseline, rows, failures };
if (option('output')) await writeFile(option('output'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ cases: rows.length, checks: rows.reduce((n, r) => n + r.checks, 0), failures: failures.length, candidateFailures: failures.filter(f => f.variant === 'after').length }));
if (!measureOnly) assert.equal(failures.filter(f => f.variant === 'after').length, 0, JSON.stringify(failures.filter(f => f.variant === 'after').slice(0, 5)));
