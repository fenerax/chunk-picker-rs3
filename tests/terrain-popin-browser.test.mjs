// @test full solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { datasetBrowserPayload } from '../app/dataset-catalogues.mjs';
import { openTerrainDelivery, terrainFixture, waitForTerrainPageLoad } from './helpers/terrain-delivery.mjs';
import { TERRAIN_PREFETCH_BYTES, TERRAIN_OVERVIEW_BYTES } from '../app/web/map-terrain.mjs';

test('page-load acknowledgement removes listeners on load, abort, prior abort and browser closure', async () => {
  const page = { listeners: new Set() }, pendingClose = new Promise(() => {});
  const loaded = waitForTerrainPageLoad(page, { signal: new AbortController().signal, closed: pendingClose });
  for (const listener of page.listeners) listener({ method: 'Page.loadEventFired' });
  await loaded; assert.equal(page.listeners.size, 0);
  const controller = new AbortController(), reason = Error('Synthetic outer guard');
  const aborted = waitForTerrainPageLoad(page, { signal: controller.signal, closed: pendingClose });
  controller.abort(reason); await assert.rejects(aborted, error => error === reason);
  assert.equal(page.listeners.size, 0);
  await assert.rejects(waitForTerrainPageLoad(page, { signal: controller.signal, closed: pendingClose }), error => error === reason);
  assert.equal(page.listeners.size, 0);
  let close;
  const closed = waitForTerrainPageLoad(page, { signal: new AbortController().signal, closed: new Promise(resolve => { close=resolve; }) });
  close(); await assert.rejects(closed, /browser closed/); assert.equal(page.listeners.size, 0);
});

test('cold first paint covers immediate pans and cached-page returns while destination delivery is held', async () => {
  const controller = new AbortController(), guard = setTimeout(() => controller.abort(), 300000);
  let browser;
  try {
    const payload = await datasetBrowserPayload(selectedDataset), grid = payload.values['app/data/surface-grid.mjs#SURFACE_GRID'];
    const manifest = terrainFixture(grid);
    browser = await openTerrainDelivery({ signal: controller.signal, payload, grid, manifest, holdManifest: true });
    // State/display already exist; the real manifest fetch is still held while
    // construction, model and viewport frames run. None may publish readiness.
    for (const view of ['terrainControl.drain()', 'terrainControl.view(0,0,4)', 'terrainControl.view(1,0,2)']) {
      const waiting=await browser.evaluate(view);
      assert.equal(waiting.painted,'loading');assert.equal(waiting.ready,false);
      assert.equal(waiting.pending.length,0);
    }
    await browser.releaseManifest();
    const initial = await browser.evaluate('terrainControl.view(0,0,4)');
    assert.equal(initial.coarseReady, false); assert.equal(initial.painted, 'loading');
    assert.equal(initial.pending.length, 1); assert.equal(initial.idle, 0);
    const firstPaint = await browser.deliver(initial.pending[0]);
    assert.equal(firstPaint.painted, 'ready'); assert.equal(firstPaint.committed.length, 0);
    assert.deepEqual(await browser.evaluate('terrainControl.pixel(0,0)'), [40,90,160,255]);
    const column=Math.min(12,grid.columns)-4,row=Math.min(8,grid.rows)-2;
    // Never run idle callbacks or deliver destination images before these frames.
    await browser.evaluate(`terrainControl.view(${column},${row},1)`);
    assert.deepEqual(await browser.evaluate(`terrainControl.pixel(${column+2},${row})`), [40,90,160,255], 'Immediate cold pan has the readiness underlay');
    await browser.evaluate(`terrainControl.view(${column},${row},2)`);
    assert.deepEqual(await browser.evaluate(`terrainControl.pixel(${column+1},${row})`), [40,90,160,255], 'Immediate zoom keeps terrain with all destination responses held');

    const cancelled=(await browser.evaluate('terrainControl.view(8,0,4)')).pending[0];
    await browser.acknowledge(cancelled);
    await browser.evaluate('terrainControl.view(4,0,4)');
    await browser.cancelled(cancelled);
    const returned=(await browser.evaluate('terrainControl.view(8,0,4)')).pending[0];
    assert.equal(new URL(returned.url).pathname,new URL(cancelled.url).pathname);
    assert.notEqual(returned.url,cancelled.url,'Returning demand has its own image identity');
    await browser.deliver(returned);
    assert.ok(browser.requests.some(request=>request.url===cancelled.url&&request.cancelled));
    assert.deepEqual(await browser.evaluate('terrainControl.pixel(8,0)'),[221,51,34,255]);

    // Cache just one native tile in A, leave before any overview warming, then
    // let A's overview arrive while B is visible. Return with new native held.
    await browser.evaluate('terrainControl.view(1,0,4)'); await browser.finishVisible();
    const cached = (await browser.snapshot()).pages.find(p=>p.key==='0,0');
    assert.equal(cached.nativeKeys.length, 1);
    await browser.evaluate('terrainControl.view(4,0,4)'); await browser.finishVisible();
    // Release only overview background work. Native prefetch remains held.
    for (let count=0;count<100;count++) {
      const s = await browser.idleStep(), pending = s.pending.find(p=>p.background);
      if (!pending || pending.url.includes('/native/')) break;
      await browser.deliver(pending);
    }
    const warm = await browser.snapshot();
    const warmedPage = warm.pages.find(p=>p.key==='0,0');
    assert.equal(warmedPage.version, cached.version); assert.ok(warmedPage.currentVersion > cached.version);
    assert.equal(warm.background, 1); assert.equal(warm.pending.length, 1);
    assert.ok(warm.bytes.overview <= TERRAIN_OVERVIEW_BYTES);
    assert.ok(warm.bytes.native <= TERRAIN_PREFETCH_BYTES);
    const pan = await browser.evaluate('terrainControl.view(1,0,2)');
    assert.equal(pan.background, 0, 'Visible demand cancels offscreen speculation');
    assert.ok(pan.pending.length > 0 && pan.pending.length <= 6);
    assert.deepEqual(await browser.evaluate('terrainControl.pixel(1,0)'), [221,51,34,255], 'Cached native pixels stay sharp');
    assert.deepEqual(await browser.evaluate('terrainControl.pixel(2,0)'), [17,187,85,255], 'Cached page cannot cover the newer overview in an unloaded region');
    await browser.finishVisible();
    assert.deepEqual(await browser.evaluate('terrainControl.pixel(2,0)'), [221,51,34,255], 'Native detail replaces the placeholder');
    const final = await browser.snapshot();
    assert.ok(final.nativeImages <= final.cacheLimit); assert.ok(final.nativePages <= final.pageLimit);
    assert.deepEqual(browser.errors, []);
  } finally { try { await browser?.close(); } finally { clearTimeout(guard); } }
});
