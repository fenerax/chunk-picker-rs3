// Native browser input against the production server and synthetic public saves.
// node --test tests/duo-focus-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openChrome, sleep, until } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

process.env.RS3_DATASET = 'open-f2p';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { emptyMetadataDataset } = await import('./helpers/server-dataset.mjs');

const evaluate = (page, fn, ...args) => page.evaluate(`(${fn})(...${JSON.stringify(args)})`);
const wait = (page, fn, ...args) => until(() => evaluate(page, fn, ...args), 5000);
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
  await wait(page, selector => {
    const node = document.querySelector(selector);
    return node && !node.disabled && node.checkVisibility();
  }, selector);
  await evaluate(page, selector => document.querySelector(selector).scrollIntoView({ block: 'center' }), selector);
  await sleep(50);
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
  assert.fail(`Unreachable keyboard target: ${selector}`);
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
    let app, page, releaseCoordination = () => {};
    const commands = [], errors = [], interceptions = new Set();
    t.after(async () => {
      releaseCoordination();
      await Promise.all([...interceptions]);
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
    let coordinationGate;
    const handlePaused = async ({ requestId, request, responseStatusCode, responseHeaders }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/coordination') {
        // Pause the real response, like route.fetch()/fulfill(), so stale Undo
        // metadata remains in flight while the user chooses a focus destination.
        const response = await page.send('Fetch.getResponseBody', { requestId });
        coordinationGate.arrived = true;
        await coordinationGate.promise;
        await page.send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders,
          body: response.base64Encoded ? response.body : Buffer.from(response.body).toString('base64') });
      } else {
        // Load pre-fix modules from a scratch directory without changing this
        // checkout. RS3_FOCUS_BASELINE_WEB must still make this regression fail.
        const body = await readFile(path.join(baseline, pathname.slice(1)));
        await page.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: body.toString('base64') });
      }
    };
    page.listeners.add(({ method, params }) => {
      if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.text);
      if (method === 'Network.requestWillBeSent' && new URL(params.request.url).pathname === '/api/command') {
        commands.push(JSON.parse(params.request.postData));
      }
      if (method === 'Fetch.requestPaused') {
        const pending = handlePaused(params).catch(error => errors.push(error.message));
        interceptions.add(pending);
        pending.finally(() => interceptions.delete(pending));
      }
    });
    if (baselinePatterns.length) await page.send('Fetch.enable', { patterns: baselinePatterns });
    const holdCoordination = async () => {
      coordinationGate = { arrived: false };
      coordinationGate.promise = new Promise(resolve => { releaseCoordination = resolve; });
      await page.send('Fetch.enable', { patterns: [...baselinePatterns, { urlPattern: `${origin}/api/coordination`, requestStage: 'Response' }] });
      return {
        arrived: () => until(() => coordinationGate.arrived, 5000),
        release: () => releaseCoordination(),
        stop: async () => {
          releaseCoordination();
          await Promise.all([...interceptions]);
          if (baselinePatterns.length) await page.send('Fetch.enable', { patterns: baselinePatterns });
          else await page.send('Fetch.disable');
        },
      };
    };
    // Observe the shipped paint boundary so a late task redraw cannot race the
    // next setup keystroke. This does not alter focus or suppress any redraw.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${({ group }) => {
      window.__rs3Perf = { enabled: true, events: [] };
      localStorage.setItem('rs3:task-view', JSON.stringify({ groupView: group }));
    }})(${JSON.stringify({ group })})` });
    const tasksReady = expected => wait(page, ({ revision, group }) => window.__rs3Perf?.events.some(event =>
      event.name === (group ? 'duo-tasks-shown' : 'tasks-shown') && event.revision === revision), { revision: expected, group });
    await page.send('Page.navigate', { url: app.inviteUrl });
    // Page.navigate returns before loading finishes, unlike Playwright goto.
    // Give a cold Chrome process its own startup budget before probing focus.
    await until(() => evaluate(page, () => document.readyState === 'complete' && !!document.getElementById('group-view')), 30000);
    if (phone) await click(page, '#phone-tab-tasks');
    await tasksReady(0);
    assert.equal(await evaluate(page, () => document.getElementById('group-view').checked), group);
    await wait(page, () => document.querySelector('#active-tasks [data-task-id="custom:a"]')?.checkVisibility());
    const revision = () => app.store.getState().revision;
    const completions = () => Object.values(app.store.getState().members[0].taskStatus ?? {}).filter(value => value.challengeCompleted).length;
    const settle = async expected => {
      await wait(page, () => document.getElementById('save-status').dataset.status === 'saved' && !document.getElementById('undo').disabled);
      if (group) await tasksReady(expected);
      assert.equal(revision(), expected); assert.deepEqual(errors, []);
    };
    return { app, page, commands, revision, completions, settle, holdCoordination };
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
        await tabTo(h.page, chip); await key(h.page, 'Enter');
        await wait(h.page, selector => document.querySelector(selector).getAttribute('aria-pressed') === 'true', chip);
        assert.equal(await active(h.page, chip), true);
      }
      await click(h.page, '.duo-task-chip:nth-child(2)');
      assert.equal(await active(h.page, '.duo-task-chip:nth-child(2)'), true);
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
            assert.equal(await active(h.page, '#undo'), true);
          } else {
            await wait(h.page, () => document.getElementById('undo').disabled && document.getElementById('save-status').dataset.status === 'saved');
            // Wait for current metadata, rather than the earlier stale-revision disable.
            const fallback = phone ? '#phone-tab-map' : '#info-tools > summary';
            await wait(h.page, selector => document.querySelector(selector) === document.activeElement, fallback);
            assert.equal(await active(h.page, fallback), true);
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
    const held = await h.holdCoordination();
    await tabTo(h.page, '#undo'); await key(h.page, 'Enter'); await held.arrived();
    assert.equal(await evaluate(h.page, () => document.getElementById('undo').disabled), true);
    assert.equal(h.revision(), 3); assert.equal(h.completions(), 1); assert.equal(h.commands.length, 3);
    if (action === 'Tab') await key(h.page, 'Tab');
    else if (action === 'pointer') await click(h.page, '#task-filter');
    else if (action === 'focus') await evaluate(h.page, () => document.querySelector('#task-filter').focus());
    else if (action === 'blur') await evaluate(h.page, () => window.dispatchEvent(new Event('blur')));
    else if (action === 'early Enter') await key(h.page, 'Enter');
    // Record the user's destination, including BODY after an early key or blur.
    await evaluate(h.page, () => { window.__focusDestination = document.activeElement; });
    held.release(); await h.settle(3);
    if (action === 'none') assert.equal(await active(h.page, '#undo'), true);
    else assert.equal(await evaluate(h.page, () => document.activeElement === window.__focusDestination), true);
    assert.equal(h.commands.length, 3); assert.equal(h.completions(), 1);
    // Explicit recovery still executes exactly one command using fresh metadata.
    await held.stop();
    await tabTo(h.page, '#undo'); await key(h.page, 'Enter');
    await wait(h.page, () => document.querySelector('#info-tools > summary') === document.activeElement);
    assert.equal(h.revision(), 4); assert.equal(h.completions(), 0); assert.equal(h.commands.length, 4);
  });
});
