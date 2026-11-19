// @test full dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openChrome, until } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { viewerFixture } from './helpers/picker-routing-fixture.mjs';

test('viewer group navigation opens a read-only map and switches back to the owned character', { timeout: 120000 }, async t => {
  const f = await viewerFixture(t), { viewerCookie, groupId } = f;
  const own = (await f.send('/api/characters', viewerCookie)).json().characters[0];

  // Exercise the real menu and full-document switch with an isolated browser.
  const browser = await openChrome(await findChrome(), path.join(f.root, 'chrome'), {
    signal: t.signal,
    extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  try {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    const base = `http://127.0.0.1:${f.app().address().port}`;
    const [name, value] = viewerCookie.split('=');
    await browser.send('Network.setCookie', { name, value, url: base });
    await browser.send('Page.setLifecycleEventsEnabled', { enabled: true });
    const navigate = async (route, activate = () => browser.send('Page.navigate', { url: base + route })) => {
      t.signal.throwIfAborted();
      const loaded = Promise.withResolvers();
      let loader;
      const observe = ({ method, params }) => {
        if (method === 'Page.frameNavigated' && !params.frame.parentId && params.frame.url === base + route) loader = params.frame.loaderId;
        if (method === 'Page.lifecycleEvent' && loader && params.loaderId === loader && params.name === 'load') loaded.resolve();
      };
      const abort = () => loaded.reject(t.signal.reason);
      browser.listeners.add(observe); t.signal.addEventListener('abort', abort, { once: true });
      try { await Promise.all([loaded.promise, activate()]); }
      finally { browser.listeners.delete(observe); t.signal.removeEventListener('abort', abort); }
    };
    await navigate('/characters');
    await until(() => browser.evaluate(`!!document.querySelector('#characters a[href="/pickers/${groupId}/"]')`));
    const link = `document.querySelector('#characters a[href="/pickers/${groupId}/"]')`;
    assert.match(await browser.evaluate(`${link}?.textContent`), /View only/);
    assert.equal(await browser.evaluate(`${link}?.checkVisibility() ?? false`), true);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await browser.evaluate(`${link}?.checkVisibility() ?? false`), true);
    // A committed URL can precede documentElement. Observe this exact loader's
    // load event before inspecting the page or fetching its session.
    await navigate(`/pickers/${groupId}/`, () => browser.evaluate(`${link}.click()`));
    await until(() => browser.evaluate(`location.pathname === '/pickers/${groupId}/' && document.readyState === 'complete' && document.documentElement?.dataset?.readOnly === 'true'`));
    assert.equal(await browser.evaluate(`fetch('/api/session', { headers: { 'X-Picker-Id': '${groupId}' } }).then(r => r.json()).then(s => s.readOnly)`), true);
    await navigate('/characters');
    await until(() => browser.evaluate(`!!document.querySelector('#characters a[href="${own.href}"]')`));
    await navigate(`/pickers/${own.placement.pickerId}/?character=${own.id}`, () => browser.evaluate(`document.querySelector('#characters a[href="${own.href}"]').click()`));
    await until(() => browser.evaluate(`location.search.includes('${own.id}') && document.readyState === 'complete' && document.documentElement?.dataset?.readOnly === 'false'`));
    assert.equal(await browser.evaluate(`fetch('/api/session', { headers: { 'X-Character-Id': '${own.id}' } }).then(r => r.json()).then(s => s.readOnly)`), false);
  } finally { await browser.close(); }
});
