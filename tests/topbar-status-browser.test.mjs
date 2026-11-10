import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openChrome } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';

process.env.RS3_DATASET = 'open-starter';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');

// One outer deadlock guard. The response gate makes the race deterministic;
// no repeated attempts, elapsed-time readiness checks or timing assertions.
test('task feedback cannot move an open More menu', { timeout: 300000 }, async file => {
  for (const count of [1, 2]) for (const [width, wrapped] of [[1440, false], [1440, true], [800, true]]) {
    await file.test(`${count} player(s), ${width}px, ${wrapped ? 'wrapped' : 'ordinary'} feedback`, async t => {
      const scratch = await mkdtemp(path.join(tmpdir(), 'picker-topbar-status-'));
      let server, browser;
      t.after(async () => {
        await browser?.close(); await server?.close();
        await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      });
      const initialState = createGroupState(Array.from({ length: count }, (_, index) => ({
        id: `actor${index + 1}`, name: wrapped ? `Synthetic explorer with a long display name ${index + 1}` : `Player ${index + 1}`,
      })));
      for (const owner of initialState.members) owner.preferences = { ...owner.preferences, setupGuide: 'skipped' };
      server = await createServer({ dataDir: path.join(scratch, 'save'), initialState,
        host: '127.0.0.1', port: 0, predictionPrewarm: false, loopbackPort: undefined, publicOrigin: undefined });
      await server.listen();
      browser = await openChrome(await findChrome(), path.join(scratch, 'chrome'), {
        extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
      });
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      if (wrapped) await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        localStorage.setItem('rs3:task-view', JSON.stringify({groupView:false}));
      ` });
      const held = Promise.withResolvers(), stream = Promise.withResolvers(), loaded = Promise.withResolvers();
      let heldCount = 0;
      browser.listeners.add(({ method, params }) => {
        if (method === 'Fetch.requestPaused') { heldCount++; held.resolve(); }
        if (method === 'Network.eventSourceMessageReceived' && params.eventName === 'revision') stream.resolve();
        if (method === 'Page.loadEventFired') loaded.resolve();
      });
      // Hold actual successful responses, not request or response substitutes.
      await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/tasks*', requestStage: 'Response' }] });
      let phase = 'startup';
      t.after(() => t.diagnostic(`Last topbar operation: ${phase}`));
      const evaluate = async expression => {
        try { return await browser.evaluate(expression); }
        catch (cause) { throw new Error(`${phase}: ${cause.message}`, { cause }); }
      };
      const state = async (condition, label) => {
        phase = label;
        await evaluate(`new Promise(resolve => {
          const observer = new MutationObserver(check);
          function check() { if (${condition}) { observer.disconnect(); resolve(true); } }
          observer.observe(document, { childList:true, subtree:true, attributes:true, characterData:true }); check();
        })`);
      };
      const rendered = () => evaluate(`(async () => {
        await document.fonts.ready;
        const channel = new MessageChannel();
        const frame = () => new Promise(resolve => requestAnimationFrame(() => {
          channel.port1.onmessage = resolve; channel.port2.postMessage(null);
        }));
        await frame(); await frame(); channel.port1.close(); channel.port2.close(); return true;
      })()`);
      const click = async point => {
        await browser.send('Input.dispatchMouseEvent', { type:'mousePressed', ...point, button:'left', clickCount:1 });
        await browser.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...point, button:'left', clickCount:1 });
      };
      await browser.send('Page.navigate', { url: server.inviteUrl });
      await loaded.promise; await held.promise; await stream.promise;
      await browser.send('Page.bringToFront');
      await state(`document.getElementById('calculation-status')?.checkVisibility() && document.getElementById('save-status').textContent === 'Saved'`, 'pending feedback visible');
      await rendered();
      await evaluate(`void (window.moreToggled = new Promise(resolve => document.getElementById('more-tools')
        .addEventListener('toggle', () => resolve(true), {once:true})))`);
      const summary = await evaluate(`(() => {
        const r = document.querySelector('#more-tools > summary').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2};
      })()`);
      await click(summary); await evaluate('window.moreToggled'); await rendered();
      const geometry = `(() => {
        const button = document.getElementById('settings-open'), r = button.getBoundingClientRect();
        const feedback = document.getElementById('calculation-status'), range = document.createRange(); range.selectNodeContents(feedback);
        return { open:document.getElementById('more-tools').open, rect:{x:r.x,y:r.y,width:r.width,height:r.height},
          anchor:document.querySelector('#more-tools > summary').getBoundingClientRect().y,
          feedbackLines:range.getClientRects().length, feedbackWidth:feedback.getBoundingClientRect().width,
          feedbackText:feedback.textContent, scroll:[scrollX,scrollY] };
      })()`;
      const before = await evaluate(geometry);
      assert.equal(before.open, true, 'native summary click opened More with work pending');
      assert.ok(heldCount > 0, 'a real task response is held');
      if (wrapped) assert.ok(before.feedbackLines > 1, `feedback really wraps: ${JSON.stringify(before)}`);
      const point = { x:before.rect.x+before.rect.width/2, y:before.rect.y+before.rect.height/2 };
      const ownsPoint = () => evaluate(`document.getElementById('settings-open').contains(document.elementFromPoint(${point.x},${point.y}))`);
      assert.equal(await ownsPoint(), true, 'Settings owns its original point while feedback is visible');
      phase = 'release task responses with More open';
      await browser.send('Fetch.disable');
      await state(`document.getElementById('calculation-status').hidden`, 'task feedback cleared');
      await rendered();
      const after = await evaluate(geometry), stillOwns = await ownsPoint();
      await evaluate(`void document.addEventListener('click', event => {
        window.topbarClick = event.target.id || event.target.tagName;
      }, {once:true,capture:true})`);
      // Use the original point even if the product moved the target. Re-measuring
      // it here would conceal the bug this test exists to expose.
      await click(point);
      const clicked = await evaluate(`({ target:window.topbarClick, settings:document.getElementById('tool-dialog').open && !!document.querySelector('.settings-panel') })`);
      t.diagnostic(JSON.stringify({ before, after, point, stillOwns, clicked }));
      assert.deepEqual({ open:after.open, ownsOriginalPoint:stillOwns, verticalAnchor:after.anchor === before.anchor,
        nativeClick:clicked.target, settingsOpened:clicked.settings },
      { open:true, ownsOriginalPoint:true, verticalAnchor:true, nativeClick:'settings-open', settingsOpened:true },
      'finishing background work preserves the open menu, its vertical anchor, and native Settings activation');
    });
  }
});
