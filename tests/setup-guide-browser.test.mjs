import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openChrome, sleep, until } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

// An actual application, native dialog and browser input on a fresh public save.
// No packs, existing saves or external services are needed.
process.env.RS3_DATASET = 'open-starter';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');

for (const count of [1, 2]) for (const mode of ['keyboard', 'pointer']) {
  test(`setup step focus and close lifecycle: ${count} member(s), ${mode}`, { timeout: 60000 }, async t => {
    // The adaptive runner transports errors over IPC, which can lose an
    // AssertionError's non-enumerable message. Diagnostics survive that hop.
    const equal = (actual, expected, message) => {
      if (actual !== expected) t.diagnostic(`Assertion failed: ${message}`);
      assert.equal(actual, expected, message);
    };
    const scratch = await mkdtemp(path.join(tmpdir(), 'picker-setup-focus-'));
    let server, browser;
    t.after(async () => { await browser?.close(); await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
    const initialState = createGroupState(Array.from({ length: count }, (_, i) => ({ id: `actor${i + 1}`, name: `Player ${i + 1}` })));
    server = await createServer({ dataDir: path.join(scratch, 'save'), host: '127.0.0.1', port: 0,
      initialState, predictionPrewarm: false, loopbackPort: undefined, publicOrigin: undefined });
    await server.listen();
    browser = await openChrome(await findChrome(), path.join(scratch, 'chrome'), {
      extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    const evaluate = browser.evaluate;
    const afterCloseEvent = async action => {
      // close() clears `open` synchronously, but the native close event (and
      // the application's opener restoration) can arrive after another frame.
      // Observe the event before input, including Settings -> Setup reopening.
      await evaluate(`void (window.setupCloseEvent = new Promise(resolve => document.getElementById('tool-dialog').addEventListener('close', () => resolve(true), { once: true })))`);
      await action();
      await evaluate(`window.setupCloseEvent`);
    };
    const button = label => `Array.from(document.querySelectorAll('#tool-dialog button')).find(node => node.textContent === ${JSON.stringify(label)})`;
    const key = async (key, code, windowsVirtualKeyCode) => {
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const activate = async expression => {
      equal(await evaluate(`!!(${expression})`), true, `activation target exists: ${expression}`);
      if (mode === 'keyboard') {
        for (let i = 0; i < 100 && !await evaluate(`document.activeElement === (${expression})`); i++) await key('Tab', 'Tab', 9);
        equal(await evaluate(`document.activeElement === (${expression})`), true, `target reachable by Tab: ${expression}`);
        await key('Enter', 'Enter', 13);
      } else {
        const point = await evaluate(`(() => { const node = ${expression}; node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      }
    };
    const inside = () => evaluate(`(() => { const dialog = document.getElementById('tool-dialog'), active = document.activeElement, r = active.getBoundingClientRect(); return dialog.open && dialog.matches(':modal') && dialog.contains(active) && active.checkVisibility() && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && document.hasFocus(); })()`);
    const step = expected => until(() => evaluate(`document.querySelector('.setup-guide')?.dataset.step === ${JSON.stringify(expected)}`), 10000);
    await browser.send('Page.navigate', { url: server.inviteUrl });
    await step('roll');
    await browser.send('Page.bringToFront');
    equal(await inside(), true, 'initial native open focuses inside');
    await afterCloseEvent(() => activate(button('Skip setup')));
    await until(() => evaluate(`!document.getElementById('tool-dialog').open`));
    equal(await evaluate(`document.activeElement.id`), 'map-hover', 'automatic open returns to a meaningful map target');

    const reopen = async () => {
      await activate(`document.querySelector('#more-tools > summary')`);
      await activate(`document.getElementById('settings-open')`);
      await until(() => evaluate(`!!(${button('Setup guide…')})`));
      await afterCloseEvent(() => activate(button('Setup guide…')));
      await step('roll');
      equal(await inside(), true, 'reopening focuses inside');
    };
    await reopen();
    await evaluate(`window.originalSetupDialog = document.getElementById('tool-dialog')`);
    const observations = [], delays = [];
    for (const [label, expected] of [['Next', 'theme'], ['Back', 'roll'], ['Next', 'theme'], ['Next', 'start'], ['Next', 'tour'], ['Back', 'start'], ['Next', 'tour']]) {
      // Keep the removed focused control to verify the replacement, then make no
      // more input for 300 ms: a follow-up Tab must not mask lost focus.
      await evaluate(`window.oldSetupRoot = document.querySelector('.setup-guide')`);
      await activate(button(label));
      await step(expected);
      const started = performance.now();
      await sleep(300);
      delays.push(performance.now() - started);
      observations.push(await inside() && await evaluate(`document.activeElement === document.querySelector('.setup-guide-body > h3')`));
      equal(await evaluate(`window.originalSetupDialog === document.getElementById('tool-dialog') && !window.oldSetupRoot.isConnected`), true, `same modal, old step removed: ${label} -> ${expected}`);
    }
    await afterCloseEvent(() => activate(button('Finish')));
    await until(() => evaluate(`!document.getElementById('tool-dialog').open`));
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Finish preserves the external opener');
    await reopen();
    await activate(button('Next')); await step('theme');
    await afterCloseEvent(() => key('Escape', 'Escape', 27));
    await until(() => evaluate(`!document.getElementById('tool-dialog').open`));
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Escape preserves the external opener');
    await reopen();
    await afterCloseEvent(() => activate(button('Skip setup')));
    await until(() => evaluate(`!document.getElementById('tool-dialog').open`));
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Skip preserves the external opener');
    await reopen();
    await afterCloseEvent(() => activate(`document.querySelector('#tool-dialog .close-button')`));
    await until(() => evaluate(`!document.getElementById('tool-dialog').open`));
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Close preserves the external opener');
    const state = await evaluate(`fetch('/api/state').then(r => r.json()).then(value => value.state)`);
    equal(state.members.length, count, 'setup preserves the member count');
    equal(state.members[0].preferences.setupGuide, 'finished', 'reopened skip and Escape preserve the earlier finish');
    equal(state.history.filter(row => row.type === 'set-preference').length, 2, 'navigation sends no gameplay commands');
    const sorted = delays.toSorted((a, b) => a - b);
    t.diagnostic(`Delayed focus: ${observations.filter(Boolean).length}/${observations.length}; observation ms median=${sorted[3].toFixed(1)}, range=${sorted[0].toFixed(1)}–${sorted.at(-1).toFixed(1)}`);
    equal(observations.every(Boolean), true, 'Next and Back keep visible focus inside the current native modal without further input');
  });
}
