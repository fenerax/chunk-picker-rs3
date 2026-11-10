import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openChrome } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

// An actual application, native dialog and browser input on a fresh public save.
// No packs, existing saves or external services are needed.
process.env.RS3_DATASET = 'open-starter';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');

// One file-level deadlock guard, rather than a deadline for each UI transition.
test('setup guide native lifecycle', { timeout: 300000 }, async file => {
  for (const count of [1, 2]) for (const mode of ['keyboard', 'pointer']) await file.test(`setup step focus and close lifecycle: ${count} member(s), ${mode}`, async t => {
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
    let phase = 'initial setup guide';
    t.after(() => t.diagnostic(`Last lifecycle operation: ${phase}`));
    const evaluate = async expression => {
      try { return await browser.evaluate(expression); }
      catch (cause) { throw new Error(`${phase}: browser observation failed (${cause.message})`, { cause }); }
    };
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
    // Join rendering (including ResizeObserver/focus reveal) and real animation
    // completion before measuring input coordinates. A CDP response is not a paint.
    const painted = () => evaluate(`(async () => {
      await document.fonts.ready;
      const channel = new MessageChannel();
      const frame = () => new Promise(resolve => requestAnimationFrame(() => {
        channel.port1.onmessage = resolve; channel.port2.postMessage(null);
      }));
      await frame();
      // Only the dialog's entrance transform can move its input targets.
      // Menu/control colour transitions do not move these input targets and
      // must not become readiness prerequisites for this dialog.
      await Promise.all(document.getElementById('tool-dialog').getAnimations()
        .map(animation => animation.finished.catch(() => {})));
      await frame(); channel.port1.close(); channel.port2.close(); return true;
    })()`);
    const activate = async expression => {
      equal(await evaluate(`!!(${expression})`), true, `activation target exists: ${expression}`);
      if (mode === 'keyboard') {
        for (let i = 0; i < 100 && !await evaluate(`document.activeElement === (${expression})`); i++) await key('Tab', 'Tab', 9);
        equal(await evaluate(`document.activeElement === (${expression})`), true, `target reachable by Tab: ${expression}`);
      } else {
        await evaluate(`(${expression}).scrollIntoView({block:'center', behavior:'instant'})`);
      }
      await painted();
      const probe = await evaluate(`(() => {
        const node = ${expression}, r = node.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
        const hit = document.elementFromPoint(x, y);
        const activation = window.setupActivation = { clicked: false, actual: null };
        const snapshot = event => {
          const rect = node.getBoundingClientRect(), feedback = document.getElementById('calculation-status');
          return { actual: event.target.id || event.target.tagName, moreOpen: document.getElementById('more-tools').open,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            point: [event.clientX, event.clientY], scroll: [scrollX, scrollY], feedback: feedback?.textContent, feedbackHidden: feedback?.hidden };
        };
        if (${mode === 'pointer'}) document.addEventListener('pointerdown', event => {
          activation.press = snapshot(event);
        }, { once: true, capture: true });
        document.addEventListener('click', event => {
          Object.assign(activation, { clicked: node.contains(event.target), actual: event.target.id || event.target.tagName,
            click: snapshot(event) });
        }, { once: true, capture: true });
        return { visible: node.checkVisibility() && r.width > 0 && r.height > 0,
          enabled: !node.disabled, hit: node.contains(hit), actual: hit?.id || hit?.tagName, x, y,
          moreOpen: document.getElementById('more-tools').open, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
      })()`);
      equal(probe.visible && probe.enabled, true, `activation target visible and enabled: ${expression}`);
      if (mode === 'keyboard') await key('Enter', 'Enter', 13);
      else {
        equal(probe.hit, true, `activation target owns pointer hit (${probe.actual}): ${expression}`);
        const point = { x: probe.x, y: probe.y };
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      }
      const activation = await evaluate('window.setupActivation');
      if (!activation.clicked) t.diagnostic(`Native input race: ${JSON.stringify({ probe, press: activation.press, click: activation.click })}`);
      equal(activation.clicked, true, `${phase}: native click delivered to ${expression}; actual=${activation.actual}`);
    };
    const inside = async () => {
      const probe = await evaluate(`(() => {
        const dialog = document.getElementById('tool-dialog'), active = document.activeElement, r = active.getBoundingClientRect();
        return { checks: { open: dialog.open, modal: dialog.matches(':modal'), inside: dialog.contains(active),
          visible: active.checkVisibility(), sized: r.width > 0 && r.height > 0, inViewport: r.top >= 0 && r.bottom <= innerHeight,
          foreground: document.hasFocus() }, active: { tag: active.tagName, id: active.id } };
      })()`);
      const focused = Object.values(probe.checks).every(Boolean);
      if (!focused) t.diagnostic(`Focus observation: ${JSON.stringify(probe)}`);
      return focused;
    };
    // Navigation replaces the step synchronously in its click handler.
    const step = async expected => equal(await evaluate(`document.querySelector('.setup-guide')?.dataset.step`), expected, `${phase}: setup step`);
    // Module loading is navigation work; startup can continue after this event.
    const loaded = Promise.withResolvers();
    const onLoad = event => { if (event.method === 'Page.loadEventFired') loaded.resolve(); };
    browser.listeners.add(onLoad);
    try {
      await browser.send('Page.navigate', { url: server.inviteUrl });
      await loaded.promise;
    } finally { browser.listeners.delete(onLoad); }
    phase = 'startup offers setup guide';
    await evaluate(`new Promise(resolve => {
      const observer = new MutationObserver(check);
      function check() {
        if (document.getElementById('tool-dialog')?.open && document.querySelector('.setup-guide')?.dataset.step === 'roll') {
          observer.disconnect(); resolve(true);
        }
      }
      observer.observe(document, { childList: true, subtree: true, attributes: true }); check();
    })`);
    await browser.send('Page.bringToFront');
    await evaluate(`new Promise(resolve => {
      const focused = () => { if (document.hasFocus()) { window.removeEventListener('focus', focused); resolve(true); } };
      window.addEventListener('focus', focused); focused();
    })`);
    await painted();
    equal(await inside(), true, 'initial native open focuses inside');
    phase = 'initial Skip setup closes the guide';
    await afterCloseEvent(() => activate(button('Skip setup')));
    equal(await evaluate(`document.getElementById('tool-dialog').open`), false, 'initial Skip setup closes the modal');
    equal(await evaluate(`document.activeElement.id`), 'map-hover', 'automatic open returns to a meaningful map target');

    const reopen = async () => {
      phase = 'More menu opens';
      equal(await evaluate(`document.getElementById('more-tools').open`), false, 'More starts closed');
      await evaluate(`void (window.setupMenuToggle = new Promise(resolve => document.getElementById('more-tools').addEventListener('toggle', () => resolve(true), { once: true })))`);
      await activate(`document.querySelector('#more-tools > summary')`);
      equal(await evaluate(`document.getElementById('more-tools').open`), true, 'More activation opened the menu');
      await evaluate('window.setupMenuToggle');
      phase = 'Settings opens from More';
      await activate(`document.getElementById('settings-open')`);
      equal(await evaluate(`document.getElementById('tool-dialog').open && !!document.querySelector('.settings-panel')`), true, 'Settings activation opened Settings');
      // Settings builds this button synchronously, before openDialog. If it is
      // absent now, another poll cannot repair the missed/wrong activation.
      equal(await evaluate(`!!(${button('Setup guide…')})`), true, 'open Settings contains Setup guide…');
      phase = 'Settings hands the modal to Setup guide';
      await afterCloseEvent(() => activate(button('Setup guide…')));
      await step('roll'); await painted();
      equal(await inside(), true, 'reopening focuses inside');
    };
    await reopen();
    await evaluate(`window.originalSetupDialog = document.getElementById('tool-dialog')`);
    const observations = [];
    for (const [label, expected] of [['Next', 'theme'], ['Back', 'roll'], ['Next', 'theme'], ['Next', 'start'], ['Next', 'tour'], ['Back', 'start'], ['Next', 'tour']]) {
      // Keep the removed focused control to verify the replacement, then make no
      // more input before the rendering frames: a follow-up Tab must not mask lost focus.
      await evaluate(`window.oldSetupRoot = document.querySelector('.setup-guide')`);
      phase = `${label} navigates to ${expected}`;
      await activate(button(label));
      await step(expected);
      await painted();
      observations.push(await inside() && await evaluate(`document.activeElement === document.querySelector('.setup-guide-body > h3')`));
      equal(await evaluate(`window.originalSetupDialog === document.getElementById('tool-dialog') && !window.oldSetupRoot.isConnected`), true, `same modal, old step removed: ${label} -> ${expected}`);
    }
    phase = 'Finish closes the guide';
    await afterCloseEvent(() => activate(button('Finish')));
    equal(await evaluate(`document.getElementById('tool-dialog').open`), false, 'Finish closes the modal');
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Finish preserves the external opener');
    await reopen();
    await activate(button('Next')); await step('theme');
    phase = 'Escape closes the guide';
    await afterCloseEvent(() => key('Escape', 'Escape', 27));
    equal(await evaluate(`document.getElementById('tool-dialog').open`), false, 'Escape closes the modal');
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Escape preserves the external opener');
    await reopen();
    phase = 'reopened Skip setup closes the guide';
    await afterCloseEvent(() => activate(button('Skip setup')));
    equal(await evaluate(`document.getElementById('tool-dialog').open`), false, 'reopened Skip setup closes the modal');
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Skip preserves the external opener');
    await reopen();
    phase = 'Close button closes the guide';
    await afterCloseEvent(() => activate(`document.querySelector('#tool-dialog .close-button')`));
    equal(await evaluate(`document.getElementById('tool-dialog').open`), false, 'Close button closes the modal');
    equal(await evaluate(`document.activeElement === document.querySelector('#more-tools > summary')`), true, 'Close preserves the external opener');
    const state = await evaluate(`fetch('/api/state').then(r => r.json()).then(value => value.state)`);
    equal(state.members.length, count, 'setup preserves the member count');
    equal(state.members[0].preferences.setupGuide, 'finished', 'reopened skip and Escape preserve the earlier finish');
    equal(state.history.filter(row => row.type === 'set-preference').length, 2, 'navigation sends no gameplay commands');
    t.diagnostic(`Painted focus: ${observations.filter(Boolean).length}/${observations.length}`);
    equal(observations.every(Boolean), true, 'Next and Back keep visible focus inside the current native modal without further input');
  });
});
