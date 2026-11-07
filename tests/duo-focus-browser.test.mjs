// Native browser input against the production server and synthetic public saves.
// node --test tests/duo-focus-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openChrome } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

process.env.RS3_DATASET = 'open-f2p';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { emptyMetadataDataset } = await import('./helpers/server-dataset.mjs');

const evaluate = async (page, fn, ...args) => {
  const response = await page.send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};

// Installed before the application: observe its existing paint acknowledgements
// and hold real coordination JSON at the API boundary. No clock, polling, focus
// repair, or fabricated metadata. Each revision is delivered only on release().
function installSteps({ group }) {
  const events = [], subscribers = new Set(), gates = new Map();
  const emit = event => { events.push(event); for (const listener of [...subscribers]) listener(event); };
  const event = (name, revision, after = 0) => {
    const matches = row => row.name === name && row.revision === revision;
    const prior = events.slice(after).find(matches);
    return prior ? Promise.resolve(prior) : new Promise(resolve => {
      const listener = row => { if (matches(row)) { subscribers.delete(listener); resolve(row); } };
      subscribers.add(listener);
    });
  };
  const describe = node => node ? { tag: node.tagName, id: node.id, task: node.closest('[data-task-id]')?.dataset.taskId,
    control: node.dataset.taskControl, connected: node.isConnected } : null;
  const snapshot = () => ({ revision: events.findLast(row => row.name === 'state-adopted')?.revision, active: describe(document.activeElement),
    undo: { disabled: document.getElementById('undo')?.disabled, title: document.getElementById('undo')?.title },
    saved: document.getElementById('save-status')?.dataset.status,
    notice: document.getElementById('notice')?.textContent,
    gates: [...gates].map(([revision, gate]) => ({ revision, released: !!gate.rendered })), events: events.slice(-12) });
  const fetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await fetch(...args);
    if (new URL(args[0] instanceof Request ? args[0].url : args[0], location.href).pathname !== '/api/coordination') return response;
    const json = response.json.bind(response);
    response.json = async () => {
      const value = await json(), revision = value.stateRevision;
      // Redundant reads share the same delivery step; none can bypass a hold.
      if (gates.has(revision)) { await gates.get(revision).held; return value; }
      let deliver;
      const held = new Promise(resolve => { deliver = resolve; });
      gates.set(revision, { deliver, held });
      emit({ name: 'coordination-arrived', revision });
      await held;
      return value;
    };
    return response;
  };
  window.__rs3Perf = { enabled: true, events: [] };
  window.__rs3Perf.events.push = (...rows) => {
    const length = Array.prototype.push.apply(window.__rs3Perf.events, rows);
    rows.forEach(emit); return length;
  };
  window.__focusSteps = { event, snapshot, bookmark: () => events.length, async release(revision) {
    const gate = gates.get(revision);
    if (!gate) throw new Error(`No coordination response for revision ${revision}: ${JSON.stringify(snapshot())}`);
    if (!gate.rendered) {
      // accept() renders Undo synchronously after consuming this JSON. Observe
      // that render, then assert its outcome; never wait for the desired focus.
      gate.rendered = new Promise(resolve => {
        const observer = new MutationObserver(() => { observer.disconnect(); resolve(snapshot()); });
        observer.observe(document.getElementById('undo'), { attributes: true, childList: true });
        gate.deliver();
      });
    }
    return gate.rendered;
  } };
  localStorage.setItem('rs3:task-view', JSON.stringify({ groupView: group }));
}

const snapshot = page => evaluate(page, () => window.__focusSteps.snapshot());
async function acknowledged(page, name, revision, after = 0) {
  try { return await evaluate(page, (name, revision, after) => window.__focusSteps.event(name, revision, after), name, revision, after); }
  catch (error) { throw new Error(`Missing ${name} acknowledgement at revision ${revision}: ${JSON.stringify(await snapshot(page))}`, { cause: error }); }
}
async function assertFocus(page, selector) {
  assert.equal(await active(page, selector), true, JSON.stringify(await snapshot(page)));
}
const active = (page, selector) => evaluate(page, selector => {
  const node = document.querySelector(selector);
  return !!node && node === document.activeElement && !node.disabled && node.checkVisibility();
}, selector);
async function key(page, key) {
  const [code, windowsVirtualKeyCode] = { Tab: ['Tab', 9], Enter: ['Enter', 13], Space: ['Space', 32] }[key];
  const value = key === 'Space' ? ' ' : key;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode,
    ...(key === 'Enter' ? { text: '\r' } : key === 'Space' ? { text: ' ' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode });
}
async function click(page, selector) {
  assert.equal(await evaluate(page, selector => {
    const node = document.querySelector(selector);
    return node && !node.disabled && node.checkVisibility();
  }, selector), true, `Pointer target ${selector}: ${JSON.stringify(await snapshot(page))}`);
  await evaluate(page, selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await evaluate(page, () => new Promise(resolve => requestAnimationFrame(resolve)));
  const point = await evaluate(page, selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function tabTo(page, selector) {
  for (let i = 0; i < 250; i++) {
    if (await active(page, selector)) return;
    await key(page, 'Tab');
  }
  assert.fail(`Unreachable keyboard target: ${selector}: ${JSON.stringify(await snapshot(page))}`);
}

test('owner filters and consecutive Undo retain browser focus', { timeout: 300000 }, async t => {
  let executable;
  try { executable = await findChrome({ executable: process.env.RS3_CHROMIUM }); }
  catch (error) {
    if (error.message !== 'CHROME_UNAVAILABLE' || process.env.RS3_CHROMIUM) throw error;
    t.skip('Chrome is unavailable; install Chrome/Chromium or set CHROME_PATH.');
    return;
  }
  async function fixture(t, { phone = false, group = true, hide = false } = {}) {
    const directory = await mkdtemp(path.join(tmpdir(), 'duo-focus-'));
    let app, page;
    const commands = [], errors = [];
    t.after(async () => {
      // Close the browser before its synthetic server, including on a failed
      // step with metadata deliberately held in the renderer.
      try { await page?.close(); }
      finally {
        try { await app?.close(); }
        finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
      }
      assert.deepEqual(errors, []);
    });
    const state = createGroupState([{ id: 'one', name: 'Player 1', unlocked: ['12341'] }, { id: 'two', name: 'Player 2', unlocked: ['12341'] }]);
    state.tasks = ['a', 'b'].map(id => ({ id: `custom:${id}`, label: `Focus task ${id}`, category: 'Custom', memberIds: ['one'] }));
    for (const member of state.members) member.preferences = { ...member.preferences, hideChecked: hide };
    const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} };
    app = await createServer({ dataset: await emptyMetadataDataset(), dataDir: path.join(directory, 'save'), initialState: state,
      definitions, taskMap: {}, host: '127.0.0.1', port: 0, predictionPrewarm: false, loopbackPort: undefined, publicOrigin: undefined });
    await app.listen();
    page = await openChrome(executable, path.join(directory, 'chrome'), {
      extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    await page.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1440, height: phone ? 844 : 900,
      deviceScaleFactor: 1, mobile: phone });
    const baseline = process.env.RS3_FOCUS_BASELINE_WEB;
    const origin = new URL(app.inviteUrl).origin;
    const baselinePatterns = baseline ? ['duo-task-view', 'duo-coordination', 'screen-startup', 'screen-map']
      .map(name => ({ urlPattern: `${origin}/${name}.mjs*`, requestStage: 'Request' })) : [];
    const handlePaused = async ({ requestId, request }) => {
      const pathname = new URL(request.url).pathname;
      // Load pre-fix modules from a scratch directory without changing this
      // checkout. RS3_FOCUS_BASELINE_WEB must still make this regression fail.
      const body = await readFile(path.join(baseline, pathname.slice(1)));
      await page.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: body.toString('base64') });
    };
    page.listeners.add(({ method, params }) => {
      if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.text);
      if (method === 'Network.requestWillBeSent' && new URL(params.request.url).pathname === '/api/command') {
        commands.push(JSON.parse(params.request.postData));
      }
      if (method === 'Fetch.requestPaused') {
        void handlePaused(params).catch(error => errors.push(error.message));
      }
    });
    if (baselinePatterns.length) await page.send('Fetch.enable', { patterns: baselinePatterns });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installSteps})(${JSON.stringify({ group })})` });
    const tasksReady = async expected => {
      // tasks-shown acknowledges completion of the foreground load and its
      // current paint, beyond the first provisional duo-tasks-shown event.
      await acknowledged(page, 'tasks-shown', expected);
      if (group) await acknowledged(page, 'duo-tasks-shown', expected);
    };
    const loaded = new Promise(resolve => {
      const listener = ({ method }) => { if (method === 'Page.loadEventFired') { page.listeners.delete(listener); resolve(); } };
      page.listeners.add(listener);
    });
    await page.send('Page.navigate', { url: app.inviteUrl });
    await loaded;
    await tasksReady(0);
    await acknowledged(page, 'coordination-arrived', 0);
    await evaluate(page, () => window.__focusSteps.release(0));
    if (phone) await click(page, '#phone-tab-tasks');
    assert.equal(await evaluate(page, () => document.getElementById('group-view').checked), group);
    assert.equal(await evaluate(page, () => document.querySelector('#active-tasks [data-task-id="custom:a"]')?.checkVisibility()), true);
    const revision = () => app.store.getState().revision;
    const completions = () => Object.values(app.store.getState().members[0].taskStatus ?? {}).filter(value => value.challengeCompleted).length;
    const settle = async (expected, canUndo = true) => {
      await acknowledged(page, 'coordination-arrived', expected);
      let rendered;
      try { rendered = await evaluate(page, revision => window.__focusSteps.release(revision), expected); }
      catch (error) { throw new Error(`No coordination render at revision ${expected}: ${JSON.stringify(await snapshot(page))}`, { cause: error }); }
      assert.equal(rendered.saved, 'saved', JSON.stringify(rendered));
      assert.equal(rendered.undo.disabled, !canUndo, JSON.stringify(rendered));
      await tasksReady(expected);
      assert.equal(revision(), expected); assert.deepEqual(errors, []);
      return rendered;
    };
    return { app, page, commands, revision, completions, settle, tasksReady };
  }
  async function completeTwo(h, pointer = false) {
    for (const [index, id] of ['a', 'b'].entries()) {
      const selector = `#active-tasks [data-task-id="custom:${id}"] input[type=checkbox]`;
      if (pointer) await click(h.page, selector);
      else { await tabTo(h.page, selector); await key(h.page, 'Space'); }
      await h.settle(index + 1);
    }
  }
  for (const phone of [false, true]) for (const hide of [false, true]) {
    const label = `${phone ? 'phone' : 'desktop'}, hide ${hide}`;
    await t.test(`owner activation: ${label}`, async t => {
      const h = await fixture(t, { phone, hide });
      for (const index of [2, 3, 4, 1]) {
        const chip = `.duo-task-chip:nth-child(${index})`;
        await tabTo(h.page, chip);
        const after = await evaluate(h.page, () => window.__focusSteps.bookmark());
        await key(h.page, 'Enter');
        await acknowledged(h.page, 'duo-tasks-shown', 0, after);
        assert.equal(await evaluate(h.page, selector => document.querySelector(selector).getAttribute('aria-pressed'), chip), 'true');
        await assertFocus(h.page, chip);
      }
      const after = await evaluate(h.page, () => window.__focusSteps.bookmark());
      await click(h.page, '.duo-task-chip:nth-child(2)');
      await acknowledged(h.page, 'duo-tasks-shown', 0, after);
      await assertFocus(h.page, '.duo-task-chip:nth-child(2)');
      assert.equal(h.commands.length, 0); assert.equal(h.revision(), 0); assert.equal(h.completions(), 0);
    });
    for (const group of [false, true]) for (const pointer of [false, true]) {
      await t.test(`two Undos: ${label}, group ${group}, pointer ${pointer}`, async t => {
        const h = await fixture(t, { phone, hide, group });
        await completeTwo(h, pointer);
        assert.equal(h.completions(), 2);
        assert.equal(await evaluate(h.page, () => document.querySelectorAll('#active-tasks [data-task-id^="custom:"] input:checked').length), hide ? 0 : 2);
        if (phone) await click(h.page, '#phone-tab-map');
        if (!pointer) await tabTo(h.page, '#undo');
        for (let index = 0; index < 2; index++) {
          if (pointer) await click(h.page, '#undo'); else await key(h.page, 'Enter');
          if (index === 0) {
            await h.settle(3);
            await assertFocus(h.page, '#undo');
          } else {
            await h.settle(4, false);
            const fallback = phone ? '#phone-tab-map' : '#info-tools > summary';
            await assertFocus(h.page, fallback);
            assert.equal(h.revision(), 4); assert.equal(h.completions(), 0);
          }
        }
        assert.deepEqual(h.commands.map(row => row.command.type), ['set-task-status', 'set-task-status', 'undo', 'undo']);
        assert.deepEqual(h.commands.slice(2).map(row => row.command.undoRevision), [2, 1]);
      });
    }
  }
  for (const action of ['none', 'Tab', 'pointer', 'focus', 'blur', 'early Enter']) await t.test(`delayed coordination: ${action}`, { timeout: 60000 }, async t => {
    const h = await fixture(t); await completeTwo(h);
    await tabTo(h.page, '#undo'); await key(h.page, 'Enter');
    await acknowledged(h.page, 'coordination-arrived', 3);
    await h.tasksReady(3);
    assert.equal(await evaluate(h.page, () => document.getElementById('undo').disabled), true);
    assert.equal(h.revision(), 3); assert.equal(h.completions(), 1); assert.equal(h.commands.length, 3);
    if (action === 'Tab') await key(h.page, 'Tab');
    else if (action === 'pointer') await click(h.page, '#task-filter');
    else if (action === 'focus') await evaluate(h.page, () => document.querySelector('#task-filter').focus());
    else if (action === 'blur') await evaluate(h.page, () => window.dispatchEvent(new Event('blur')));
    else if (action === 'early Enter') await key(h.page, 'Enter');
    // Record the user's destination, including BODY after an early key or blur.
    await evaluate(h.page, () => { window.__focusDestination = document.activeElement; });
    await h.settle(3);
    if (action === 'none') await assertFocus(h.page, '#undo');
    else assert.equal(await evaluate(h.page, () => document.activeElement === window.__focusDestination), true, JSON.stringify(await snapshot(h.page)));
    assert.equal(h.commands.length, 3); assert.equal(h.completions(), 1);
    // Explicit recovery still executes exactly one command using fresh metadata.
    await tabTo(h.page, '#undo'); await key(h.page, 'Enter');
    await h.settle(4, false);
    await assertFocus(h.page, '#info-tools > summary');
    assert.equal(h.revision(), 4); assert.equal(h.completions(), 0); assert.equal(h.commands.length, 4);
  });
});
