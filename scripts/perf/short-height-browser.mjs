// Actual Chromium + production server, disposable synthetic stores only.
// node scripts/perf/short-height-browser.mjs (Chrome auto-detected; no npm deps)
// Add --baseline SHA for three alternating UI pairs; --measure-only records defects.
// Browser font preferences are tested; genuine browser zoom is not simulated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../ci/gallery-support.mjs';
import { openChrome, until } from './cdp.mjs';
import { freshPage, observationNames, focusedGeometry } from './short-height-readiness.mjs';
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const baseline = option('baseline'), measureOnly = process.argv.includes('--measure-only');
const baselineFiles = baseline && new Map(['style.css', 'phone-layout.css', 'screen-dialogs.mjs'].map(file => ['/' + file, execFileSync('git', ['show', `${baseline}:app/web/${file}`], { encoding: 'utf8' })]));
process.env.RS3_DATASET = 'open-f2p';
delete process.env.RS3_SCRATCH_CDP_PORT;
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_GAME_DATA_DIR', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN']) delete process.env[key];
const executable = await findChrome();
const { createServer } = await import('../../app/server.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
const { duoFixture } = await import('../../tests/fixtures/partner.mjs');
const directory = await mkdtemp(path.join(tmpdir(), 'short-height-'));
const rows = [], failures = [];
let app, page;
const evaluate = (page, fn, ...args) => page.evaluate(`(${fn})(${args.map(value => JSON.stringify(value)).join(',')})`);
async function ready(page, expression) {
  try { return await until(() => page.evaluate(`Boolean(${expression})`), 10000); }
  catch (error) {
    throw new Error(`Readiness failed: ${expression}; ${JSON.stringify(await page.evaluate("({ search: document.querySelector('#task-filter')?.value, tasks: document.querySelector('#active-tasks')?.textContent, status: document.querySelector('#task-engine-status')?.textContent })"))}`, { cause: error });
  }
}
const settle = (page, selector) => page.evaluate(`window.shortHeightReadiness.settled().then(readiness => ({ readiness, geometry: (${focusedGeometry})(), matches: ${selector ? `document.activeElement.matches(${JSON.stringify(selector)})` : 'true'} }))`);
async function observe(page, row, name, selector) {
  const { readiness, geometry, matches } = await settle(page, selector);
  assert.ok(matches, `${name}: native focus changed during geometry settlement`);
  assert.ok(!row.observations.some(o => o.name === name), `Duplicate observation: ${name}`);
  row.observations.push({ name, readiness, geometry });
  return geometry;
}
async function press(page, key, modifiers = 0, selector) {
  const keys = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27], ArrowRight: ['ArrowRight', 39], Home: ['Home', 36], a: ['KeyA', 65] };
  const [code, windowsVirtualKeyCode] = keys[key];
  const event = { key, code, windowsVirtualKeyCode, modifiers };
  if (key === 'Tab') await page.evaluate('window.shortHeightFocusBefore = window.shortHeightReadiness.armFocus()');
  // Tab and Shift+Tab must run Chromium's real focus traversal and scrolling.
  // CDP messages and the renderer's native keyboard queue preserve this order.
  // Queue both real events before waiting; acknowledge both before probing
  // focus. Waiting for each protocol roundtrip separately adds no input signal.
  await Promise.all([
    page.send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', ...event,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }),
    page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event }),
  ]);
  if (key === 'Tab') {
    page.nativeTabs = (page.nativeTabs ?? 0) + 1;
    const landed = await evaluate(page, selector => {
      const reached = selector ? document.activeElement.matches(selector) : false;
      return { ...window.shortHeightReadiness.focusLanded(window.shortHeightFocusBefore), reached,
        identity: selector && !reached ? window.shortHeightReadiness.traversalState() : null };
    }, selector);
    assert.ok(landed.events > 0,
      `Native Tab changed focus without a focus event: ${JSON.stringify(landed)}`);
    // The browser has acknowledged this native input and its focus event.
    // Geometry settlement belongs to the named observation, not every
    // unmeasured intermediate stop on the way to that control.
    return landed;
  }
}
function check(row, name, pass, detail) {
  row.checks++;
  if (!pass) {
    row.failures++;
    const failure = { font: row.font, height: row.height, notice: row.notice, variant: row.variant, name, detail };
    failures.push(failure);
    if (row.variant === 'after' && !measureOnly) assert.fail(JSON.stringify({ ...failure, readiness: row.observations.at(-1)?.readiness }));
  }
}
const focused = page => evaluate(page, focusedGeometry);
async function tabTo(page, selector, row, name, backwards = false) {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const { reached, identity } = await press(page, 'Tab', backwards ? 8 : 0, selector);
    if (reached) {
      const geometry = await observe(page, row, name, selector);
      check(row, name, geometry.height >= 44 && geometry.visible >= geometry.height - 1 && geometry.hit, geometry);
      return geometry;
    }
    // DOM positions are not identities, and a late-painted control can change
    // the native order. A cycle requires the same node AND same tabbable order.
    if (identity === null) continue;
    if (seen.has(identity)) break;
    seen.add(identity);
  }
  assert.fail(`${name}: ${selector} unreachable in one native Tab cycle; ${JSON.stringify({
    focus: await focused(page), target: await evaluate(page, s => ({
      count: document.querySelectorAll(s).length, hasFocus: document.hasFocus(),
      tab: document.documentElement.dataset.phoneTab, hidden: document.querySelector(s)?.hidden,
      focusHistory: window.shortHeightReadiness.focusHistory,
    }), selector),
  })}`);
}
async function dialogWalk(page, row, name) {
  // Inspect every settled native Tab stop, including reverse traversal. No script scroll.
  for (const backwards of [false, true]) for (let i = 0; i < 7; i++) {
    await press(page, 'Tab', backwards ? 8 : 0);
    const g = await observe(page, row, `${name}:${backwards ? 'reverse' : 'forward'}:${i}`);
    if (!g.control) continue; // Chromium has a body stop when the modal Tab cycle wraps.
    check(row, `${name}:${backwards ? 'reverse' : 'forward'}:${i}`, g.visible >= g.height - 1 && g.hit, g);
  }
}
try {
  for (const font of option('font') ? [Number(option('font'))] : [16, 24]) {
    const profile = path.join(directory, `browser-${font}`);
    await mkdir(path.join(profile, 'Default'), { recursive: true });
    await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: font, default_fixed_font_size: font, minimum_font_size: font === 24 ? 24 : 0 } } }));
    const browser = await openChrome(executable, profile, {
      browser: true,
      extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    try {
      for (let pair = 0; pair < Number(option('pairs') || (baseline ? 3 : 1)); pair++) for (const variant of baseline ? pair % 2 ? ['after', 'before'] : ['before', 'after'] : ['after']) {
        for (const height of option('height') ? [Number(option('height'))] : [240, 256, 844]) for (const notice of [true, false]) {
          const serverStarted = performance.now();
          const { data: definitions, state } = duoFixture();
          state.members.forEach((member, i) => { member.name = `P${i + 1}`; member.preferences = { roll2: true, unpick: true }; });
          state.members[0].selected = ['12851', '12852'];
          const fixtureDigest = createHash('sha256').update(JSON.stringify({ definitions, state, taskMap: {} })).digest('hex');
          app = await createServer({ dataset: selectedDataset, dataDir: path.join(directory, `game-${rows.length}`), initialState: state, definitions, taskMap: {}, host: '127.0.0.1', port: 0, predictionPrewarm: false, random: () => .25 });
          await app.listen();
          const serverMs = performance.now() - serverStarted, pageStarted = performance.now();
          console.error('flow', font, height, notice, variant);
          page = await freshPage(browser);
          await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height, deviceScaleFactor: 1, mobile: false });
          const pageMs = performance.now() - pageStarted, startupStarted = performance.now();
          const row = { font, height, notice, fixtureDigest, dataset: { id: selectedDataset.id, digest: selectedDataset.digest },
            pair: pair + 1, variant, phases: { serverMs, pageMs }, checks: 0, failures: 0, errors: [], observations: [] }; rows.push(row);
          let streamRevision = false;
          const onEvent = ({ method, params }) => {
            if (method === 'Network.eventSourceMessageReceived' && params.eventName === 'revision') streamRevision = true;
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
          row.savedAt = await page.evaluate('performance.now()');
          // Saved precedes opening the initial live stream. Join its revision
          // and subsequent UI turn before accepting startup task readiness.
          await until(() => streamRevision, 10000);
          await settle(page);
          await ready(page, "document.querySelector('#save-status')?.textContent === 'Saved'");
          await ready(page, "window.__rs3Perf.events.some(event => event.name === 'tasks-shown')");
          await ready(page, "[...document.querySelectorAll('link[rel=stylesheet]')].every(link => link.sheet)");
          row.startupEvents = await page.evaluate('window.__rs3Perf.events');
          // Backup polling is independent of state hydration. Wait for its
          // status to settle, then keep the visibility assertion below.
          await ready(page, "document.querySelector('#backup-status-menu')?.textContent && document.querySelector('#backup-status-menu').textContent !== 'Last backup: checking…'");
          await ready(page, `innerWidth === 320 && innerHeight === ${height} && matchMedia('(max-width:720px)').matches && document.documentElement.classList.contains('phone-layout')`);
          check(row, 'fresh backup warning present', await page.evaluate("document.querySelector('#backup-status-notice').checkVisibility()"));
          if (!notice) await page.evaluate("document.querySelector('#backup-status-notice').hidden = true");
          await observe(page, row, 'initial layout');
          row.phases.startupMs = performance.now() - startupStarted;
          const bodyStarted = performance.now();
          row.scrollport = await evaluate(page, () => ({
            height: document.body.clientHeight,
            bottom: document.body.getBoundingClientRect().bottom,
            tabsTop: document.querySelector('#phone-tabs').getBoundingClientRect().top,
          }));
          check(row, 'native scrollport excludes fixed tabs', row.scrollport.bottom <= row.scrollport.tabsTop + 1,
            row.scrollport);
          row.rootFont = await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize)');
          row.browserFont = await evaluate(page, () => { const probe = document.createElement('span'); probe.style.fontSize = 'medium'; document.body.append(probe); const size = parseFloat(getComputedStyle(probe).fontSize); probe.remove(); return size; });
          check(row, 'browser font preference applied', row.browserFont === font, row.browserFont);
          row.workspace = await page.evaluate("document.querySelector('.workspace').getBoundingClientRect().height");
          check(row, 'workspace has usable height', row.workspace >= 120, row.workspace);
          row.roll = await tabTo(page, '#pick', row, 'Roll visible');
          await tabTo(page, '#phone-controls-toggle', row, 'Controls visible');
          if (await page.evaluate("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded')") === 'false') await press(page, 'Enter');
          await observe(page, row, 'controls expanded');
          await tabTo(page, '#unpick', row, 'Forfeit visible');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#tool-dialog').open");
          await dialogWalk(page, row, 'confirmation');
          await tabTo(page, '#dialog-content > button:last-child', row, 'Cancel visible');
          await page.evaluate('window.shortHeightReadiness.armDialogClose()');
          await press(page, 'Enter');
          await page.evaluate('window.shortHeightDialogClosed.then(() => true)');
          await ready(page, "!document.querySelector('#tool-dialog').open");
          await observe(page, row, 'confirmation closed');
          check(row, 'Cancel closes dialog', await page.evaluate("!document.querySelector('#tool-dialog').open"));
          // Preserve the original navigation anchors. Every measured control is
          // still reached by native Tab, never by focus() or scripted scrolling.
          await page.evaluate("document.querySelector('#phone-tab-map').focus()"); await press(page, 'ArrowRight');
          await ready(page, "document.documentElement.dataset.phoneTab === 'tasks'");
          await tabTo(page, '#task-filter', row, 'task search visible');
          // OwnItem names an already-satisfied fixture challenge. Waiting for
          // any existing row can race the debounced search and inspect a stale
          // Partner sword row. Own sword is an actual task in this fixture.
          await page.evaluate('window.shortHeightReadiness.armTaskSearch()');
          await page.send('Input.insertText', { text: 'Own sword' });
          await ready(page, "window.shortHeightReadiness.taskSearchRendered('own sword')");
          await ready(page, "[...document.querySelectorAll('#active-tasks .task-label-button')].some(e => e.textContent.includes('Own sword'))");
          await observe(page, row, 'short task search');
          await tabTo(page, '#active-tasks .task-label-button', row, 'task visible');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#tool-dialog').open");
          await dialogWalk(page, row, 'task detail');
          row.taskBody = await evaluate(page, () => { const e = document.querySelector('#dialog-content'); return { height: e.clientHeight, scrollHeight: e.scrollHeight }; });
          await page.evaluate('window.shortHeightReadiness.armDialogClose()');
          await press(page, 'Escape');
          await page.evaluate('window.shortHeightDialogClosed.then(() => true)');
          await ready(page, "!document.querySelector('#tool-dialog').open");
          await observe(page, row, 'task detail closed');
          // A separate longer synthetic task stresses a wrapping title, without
          // conflating its narrow row with the short-name shell checks above.
          await page.evaluate("document.querySelector('#task-filter').focus()");
          await press(page, 'a', 2);
          await page.evaluate('window.shortHeightReadiness.armTaskSearch()');
          await page.send('Input.insertText', { text: 'Partner sword' });
          await ready(page, "window.shortHeightReadiness.taskSearchRendered('partner sword')");
          await ready(page, "[...document.querySelectorAll('#active-tasks .task-label-button')].some(e => e.textContent.includes('Partner sword'))");
          await observe(page, row, 'long task search');
          let reached = false;
          for (let i = 0; i < 100; i++) {
            await press(page, 'Tab');
            if (await page.evaluate("document.activeElement.matches('#active-tasks .task-label-button')")) { reached = true; break; }
          }
          assert.ok(reached, JSON.stringify({ message: 'Long-title task is keyboard reachable', focus: await focused(page), search: await page.evaluate("document.querySelector('#task-filter').value"), tasks: await page.evaluate("[...document.querySelectorAll('#active-tasks .task-label-button')].map(e => e.textContent)") }));
          await observe(page, row, 'long task reached');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#tool-dialog').open");
          await settle(page);
          row.title = await evaluate(page, () => {
            const e = document.querySelector('#dialog-title');
            const r = e.getBoundingClientRect(), header = e.parentElement.getBoundingClientRect();
            return { height: r.height, lineHeight: parseFloat(getComputedStyle(e).lineHeight), visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= header.left && r.right <= header.right };
          });
          check(row, 'title remains readable', row.title.visible, row.title);
          if (font === 24) check(row, 'enlarged title wraps', row.title.height > row.title.lineHeight * 1.5, row.title);
          await dialogWalk(page, row, 'wrapping task title');
          await page.evaluate('window.shortHeightReadiness.armDialogClose()');
          await press(page, 'Escape');
          await page.evaluate('window.shortHeightDialogClosed.then(() => true)');
          await ready(page, "!document.querySelector('#tool-dialog').open");
          await observe(page, row, 'wrapping task closed');
          check(row, 'Escape closes dialog', await page.evaluate("!document.querySelector('#tool-dialog').open"));
          // Roll and inspect its result without committing a choice.
          await page.evaluate("document.querySelector('#phone-tab-tasks').focus()"); await press(page, 'Home');
          await tabTo(page, '#phone-controls-toggle', row, 'result Controls visible');
          if (await page.evaluate("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded')") === 'false') await press(page, 'Enter'); await tabTo(page, '#roll-two', row, 'result Roll two visible');
          await press(page, 'Enter'); await ready(page, "document.querySelector('#pending-panel .primary-action')");
          await tabTo(page, '#pending-panel .primary-action', row, 'result visible');
          check(row, 'no page errors', row.errors.length === 0, row.errors);
          row.phases.bodyMs = performance.now() - bodyStarted;
          row.nativeTabs = page.nativeTabs;
          assert.deepEqual(row.observations.map(o => o.name), observationNames,
            'all original settlement observations retained in order');
          console.log(JSON.stringify(row)); if (option('output')) await writeFile(option('output'), JSON.stringify({rows, failures}, null, 2));
          if (variant === 'before') await page.send('Fetch.disable');
          page.listeners.delete(onEvent);
          await page.close(); page = undefined;
          await app.close(); app = undefined;
        }
      }
    } finally {
      try { await page?.close(); }
      finally { page = undefined; await browser.close(); }
    }
  }
} finally { await app?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
const result = { node: process.version, baseline, rows, failures };
if (option('output')) await writeFile(option('output'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ cases: rows.length, observations: rows.reduce((n, r) => n + r.observations.length, 0), checks: rows.reduce((n, r) => n + r.checks, 0), failures: failures.length, candidateFailures: failures.filter(f => f.variant === 'after').length,
  timing: rows.map(row => ({ font: row.font, height: row.height, notice: row.notice,
    ...row.phases, nativeTabs: row.nativeTabs,
    readinessMs: row.observations.reduce((sum, o) => sum + (o.readiness.elapsedMs ?? 0), 0),
    frames: row.observations.reduce((sum, o) => sum + o.readiness.frames, 0),
    visibility: [...new Set(row.observations.map(o => o.readiness.visibility))],
  })) }));
if (!measureOnly) assert.equal(failures.filter(f => f.variant === 'after').length, 0, JSON.stringify(failures.filter(f => f.variant === 'after').slice(0, 5)));
