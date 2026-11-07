// @test full solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { datasetBrowserPayload } from '../app/dataset-catalogues.mjs';
import { openTerrainDelivery, terrainFixture } from './helpers/terrain-delivery.mjs';
import { TERRAIN_PREFETCH_BYTES, TERRAIN_OVERVIEW_BYTES } from '../app/web/map-terrain.mjs';

test('cold overview paints an unvisited pan and zoom while fine responses are held; prefetch yields', async () => {
  const controller = new AbortController(), guard = setTimeout(() => controller.abort(), 300000);
  let browser;
  try {
    const payload = await datasetBrowserPayload(selectedDataset), grid = payload.values['app/data/surface-grid.mjs#SURFACE_GRID'];
    const manifest = terrainFixture(grid);
    browser = await openTerrainDelivery({ signal: controller.signal, payload, grid, manifest });
    await browser.evaluate('terrainControl.view(0,0,.5)'); await browser.finishVisible();
    // Release only overview background work. Native prefetch remains held.
    for (let count=0;count<100;count++) {
      const s = await browser.idleStep(), pending = s.pending.find(p=>p.background);
      if (!pending || pending.url.includes('/native/')) break;
      await browser.deliver(pending);
    }
    const warm = await browser.snapshot();
    assert.equal(warm.committed.length, manifest.cacheTerrain.tiles.length);
    assert.equal(warm.background, 1); assert.equal(warm.pending.length, 1);
    assert.ok(warm.bytes.overview <= TERRAIN_OVERVIEW_BYTES);
    assert.ok(warm.bytes.native <= TERRAIN_PREFETCH_BYTES);
    const column=Math.min(12,grid.columns)-4,row=Math.min(8,grid.rows)-2;
    const pan = await browser.evaluate(`terrainControl.view(${column},${row},1)`);
    assert.equal(pan.background, 0, 'Visible demand cancels offscreen speculation');
    assert.ok(pan.pending.length > 0 && pan.pending.length <= 6);
    assert.deepEqual(await browser.evaluate(`terrainControl.pixel(${column+2},${row})`), [17,187,85,255], 'First pan frame already has overview terrain');
    await browser.evaluate(`terrainControl.view(${column},${row},2)`);
    assert.deepEqual(await browser.evaluate(`terrainControl.pixel(${column+1},${row})`), [17,187,85,255], 'Zoom frame keeps the overview while native data is held');
    await browser.finishVisible();
    assert.deepEqual(await browser.evaluate(`terrainControl.pixel(${column+1},${row})`), [221,51,34,255], 'Native detail replaces the placeholder');
    const final = await browser.snapshot();
    assert.ok(final.nativeImages <= final.cacheLimit); assert.ok(final.nativePages <= final.pageLimit);
    assert.deepEqual(browser.errors, []);
  } finally { try { await browser?.close(); } finally { clearTimeout(guard); } }
});
