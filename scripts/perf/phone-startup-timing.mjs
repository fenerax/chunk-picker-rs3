// Real synthetic server and native touches; hold genuine responses to reproduce
// startup layout races. Pass another public checkout to compare revisions.
// node scripts/perf/phone-startup-timing.mjs [checkout]
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url));
process.env.RS3_DATASET = 'open-f2p';
const load = file => import(pathToFileURL(path.join(root, file)));
const { createServer } = await load('app/server.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const { findChrome } = await load('scripts/ci/gallery-support.mjs');
const { openChrome, until } = await load('scripts/perf/cdp.mjs');
const directory = await mkdtemp(path.join(tmpdir(), 'phone-startup-timing-'));
let app, browser;
try {
  const initialState = createGroupState([
    { id: 'qa-one', name: 'Explorer', unlocked: ['12850'], selected: ['12849', '12594', '13106'] },
    { id: 'qa-two', name: 'Partner', unlocked: ['12850', '12594'] },
  ]);
  app = await createServer({ dataDir: path.join(directory, 'save'), initialState, port: 0, predictionPrewarm: false });
  await app.listen();
  browser = await openChrome(await findChrome(), path.join(directory, 'chrome'), {
    extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  const ready = expression => until(() => browser.evaluate(`Boolean(${expression})`));
  const settle = () => browser.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const pending = new Set(), errors = [];
  let stream, streamRevision = false, backupRequest, taskRequest;
  browser.listeners.add(({ method, params }) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.text);
    if (method === 'Network.requestWillBeSent') {
      const pathname = new URL(params.request.url).pathname;
      if (pathname === '/api/events') stream = params.requestId;
      else if (pathname.startsWith('/api/')) pending.add(params.requestId);
    }
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') pending.delete(params.requestId);
    if (method === 'Network.eventSourceMessageReceived' && params.requestId === stream && params.eventName === 'revision') streamRevision = true;
    if (method === 'Fetch.requestPaused') {
      if (new URL(params.request.url).pathname === '/api/backup-status') backupRequest = params.requestId;
      else taskRequest = params.requestId;
    }
  });
  const layoutReady = () => until(async () => {
    if (pending.size) return false;
    await settle();
    return !pending.size && await browser.evaluate("!document.querySelector('#calculation-status')?.checkVisibility()");
  });
  await browser.send('Fetch.enable', { patterns: [
    '/api/backup-status', `/api/tasks?memberId=${encodeURIComponent(initialState.members[0].id)}&*`,
  ].map(file => ({ urlPattern: `*${file}`, requestStage: 'Response' })) });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await browser.send('Page.navigate', { url: app.inviteUrl });
  await ready("document.querySelector('#save-status')?.textContent === 'Saved'");
  await until(() => backupRequest && taskRequest);
  const warningBefore = await browser.evaluate("document.querySelector('#backup-status-notice').checkVisibility()");
  await browser.send('Fetch.continueResponse', { requestId: backupRequest });
  await ready("document.querySelector('#backup-status-menu')?.textContent && document.querySelector('#backup-status-menu').textContent !== 'Last backup: checking…'");
  await ready("document.querySelector('#calculation-status')?.checkVisibility()");
  await settle();
  const position = () => browser.evaluate("(() => { const r = document.querySelector('#phone-controls-toggle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  const busyPosition = await position();
  await browser.send('Fetch.continueResponse', { requestId: taskRequest });
  await browser.send('Fetch.disable');
  await until(() => streamRevision);
  await layoutReady();
  await ready("document.querySelector('#save-status')?.textContent === 'Saved'");
  const settledPosition = await position();
  const warningAfter = await browser.evaluate("document.querySelector('#backup-status-notice').checkVisibility()");
  const tap = async ({ x, y }) => {
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle();
  };
  const expanded = () => browser.evaluate("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded') === 'true'");
  await tap(busyPosition);
  const staleTapExpanded = await expanded();
  const calculatorShift = busyPosition.y - settledPosition.y;
  assert.equal(warningBefore, false); assert.equal(warningAfter, true);
  assert.ok(calculatorShift > 0, 'the calculator caption changes native tap coordinates');
  assert.equal(staleTapExpanded, false);
  assert.equal(errors.length, 0, 'no browser exceptions in the startup flow');
  console.log(JSON.stringify({ warningBefore, warningAfter, calculatorShift, staleTapExpanded, browserErrors: errors.length }));
} finally {
  await browser?.close(); await app?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
