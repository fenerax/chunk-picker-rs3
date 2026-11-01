import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { openChrome, until } from '../scripts/perf/cdp.mjs';

// A real public server and Chromium: no API stubs, locator clicks or scrollIntoView.
process.env.RS3_DATASET = 'open-f2p';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');

// Intersect with the viewport AND clipping ancestors. Document overflow alone
// misses buttons hidden inside the map panel's overflow:hidden boundary.
function bounds(selector) {
  const node = document.querySelector(selector);
  if (!node || !node.checkVisibility()) return null;
  const r = node.getBoundingClientRect();
  let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
  let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
  let ancestorScroll = 0;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
    if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
      left = Math.max(left, box.left + parent.clientLeft);
      right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
    }
    if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
      top = Math.max(top, box.top + parent.clientTop);
      bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
    }
    ancestorScroll += Math.abs(parent.scrollLeft);
  }
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const owns = (x, y) => { const hit = document.elementFromPoint(x, y); return hit === node || node.contains(hit); };
  return { x, y, width: r.width, height: r.height, left: r.left, top: r.top,
    visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top), ancestorScroll,
    ownsCenter: owns(x, y), ownsEdges: [left + 3, right - 3].every(x => owns(x, y)),
    textFits: node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight };
}

for (const [label, name] of [
  ['short', 'Explorer'],
  ['long', 'Synthetic display name '.repeat(3).slice(0, 58)],
]) for (const [width, height, phone] of [[320, 568, true], [390, 844, true], [1280, 900, false]]) {
  test(`${label} display name at ${width}x${height}: native map controls and navigation`, { timeout: 90000 }, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'phone-controls-browser-'));
    let app, browser;
    try {
      const initialState = createGroupState([
        { id: 'qa-one', name, unlocked: ['12850'], selected: ['12849', '12594', '13106'] },
        { id: 'qa-two', name: 'Partner', unlocked: ['12850', '12594'] },
      ]);
      app = await createServer({ dataDir: path.join(directory, 'save'), initialState,
        host: '127.0.0.1', port: 0, predictionPrewarm: false, random: () => 0.25 });
      await app.listen();
      browser = await openChrome(await findChrome(), path.join(directory, 'chrome'), {
        extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
      });
      const probe = selector => browser.evaluate(`(${bounds})(${JSON.stringify(selector)})`);
      const ready = expression => until(() => browser.evaluate(`Boolean(${expression})`));
      const settle = () => browser.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 1 });
      // Every case has a fresh browser profile: folded and unscrolled.
      await browser.send('Page.navigate', { url: app.inviteUrl });
      await ready(`document.querySelector('#save-status')?.textContent === 'Saved' && document.querySelector('#pick')?.textContent.includes(${JSON.stringify(name)})`);
      await settle();
      assert.equal(await browser.evaluate('innerWidth'), width);
      assert.equal(await browser.evaluate("matchMedia('(pointer:coarse)').matches"), phone);
      const tap = async selector => {
        const b = await probe(selector);
        assert.ok(b && b.visibleWidth >= 1 && b.visibleHeight >= 1 && b.ownsCenter, `${selector} must own a visible native tap point: ${JSON.stringify(b)}`);
        if (phone) {
          await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
          await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
        }
        await settle();
      };
      const reveal = async (selector, container) => {
        for (let i = 0; i < 16; i++) {
          const b = await probe(selector);
          if (b?.ownsCenter && b.visibleHeight >= Math.min(44, b.height)) return;
          const panel = await probe(container);
          assert.ok(panel?.visibleHeight > 20, `${container} must expose a scrolling surface`);
          const distance = Math.min(160, panel.visibleHeight * 0.6);
          const direction = b.top < panel.top ? 1 : -1;
          if (phone) {
            const start = panel.y - direction * distance / 2;
            await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: panel.x, y: start }] });
            for (let step = 1; step <= 8; step++) {
              await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: panel.x, y: start + direction * distance * step / 8 }] });
              await settle();
            }
            await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            // Let any fling finish: a tap during a fling only stops the scroll.
            const offset = () => browser.evaluate(`document.querySelector(${JSON.stringify(container)}).scrollTop`);
            await until(async () => { const a = await offset(); await new Promise(r => setTimeout(r, 120)); return a === await offset(); });
          } else {
            await browser.send('Input.synthesizeScrollGesture', { x: panel.x, y: panel.y,
              yDistance: direction * distance, speed: 900, gestureSourceType: 'mouse' });
          }
          await settle();
        }
        assert.fail(`${selector} must be reachable through native scrolling: ${JSON.stringify(await probe(selector))}`);
      };
      const roll = await probe('#pick'), controls = phone ? await probe('#phone-controls-toggle') : null;
      const samples = [];
      for (let sample = 0; sample < 5; sample++) {
        const pick = await probe('#pick'), toggle = phone ? await probe('#phone-controls-toggle') : null;
        samples.push({ rollWidth: pick.width, controlsVisibleWidth: toggle?.visibleWidth ?? null });
        await settle();
      }
      t.diagnostic(JSON.stringify({ label, width, roll, controls, samples }));
      for (const b of [roll, ...(phone ? [controls] : [])]) {
        assert.ok(b && b.visibleWidth >= b.width - 1 && b.visibleHeight >= b.height - 1, 'entire primary button must be unclipped');
        assert.ok(b.ownsCenter && b.ownsEdges, 'primary button must own center and edge hit tests');
        assert.equal(b.ancestorScroll, 0, 'entry checks must precede any scrolling');
        assert.ok(b.textFits, 'the full label must fit inside its button');
        if (phone) assert.ok(b.width >= 44 && b.height >= 44, 'preserve phone touch targets');
      }
      if (phone) {
        assert.equal(await browser.evaluate("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded')"), 'false');
        for (let trial = 0; trial < 5; trial++) {
          await tap('#phone-controls-toggle');
          await ready("document.querySelector('#phone-controls-toggle').getAttribute('aria-expanded') === 'true' && !document.querySelector('#map-toolbar').hidden");
          assert.ok((await probe('#roll-two')).ownsCenter, 'Roll 2 is exposed after a native Controls tap');
          await tap('#phone-controls-toggle');
          await ready("document.querySelector('#map-toolbar').hidden");
        }
        await tap('#phone-controls-toggle');
      } else {
        assert.equal(await probe('#phone-controls-toggle'), null);
      }
      // Exercise both roll entries and review a result through the normal UI.
      await tap('#roll-two');
      await ready("document.querySelectorAll('#pending-panel .pending-choice').length === 2");
      // Fold the toolbar to give result review the full map height on phones.
      if (phone) await tap('#phone-controls-toggle');
      await reveal('#pending-panel .choice-view', '.map-dock-panels');
      await tap('#pending-panel .choice-view');
      await ready("!document.querySelector('#chunk-info').hidden");
      await reveal('#chunk-close', '.map-dock-panels');
      await tap('#chunk-close');
      await reveal('#pending-panel .cancel-roll', '.map-dock-panels');
      await tap('#pending-panel .cancel-roll');
      await ready("document.querySelector('#pending-panel').hidden");
      await tap('#pick');
      await until(() => app.store.getState().members[0].unlocked.length === 2);
      await ready("!document.querySelector('#pick').disabled && !document.querySelector('.roll-presentation')");
      if (await browser.evaluate("document.querySelector('#tool-dialog').open")) await tap('#tool-dialog .close-button');
      if (phone) {
        await tap('#phone-tab-tasks');
        await ready("!document.querySelector('.task-sidebar').hidden && document.querySelector('#active-tasks .task-row')");
        await tap('#phone-tab-more');
      }
      await tap('#more-tools > summary');
      await reveal('#backup-open', phone ? '#phone-more' : '#more-tools > .more-tools-menu');
      await tap('#backup-open');
      await ready("document.querySelector('#tool-dialog').open && /Backup/i.test(document.querySelector('#dialog-title').textContent)");
      await tap('#tool-dialog .close-button');
      if (phone) await tap('#phone-tab-map');
    } finally {
      await browser?.close();
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
