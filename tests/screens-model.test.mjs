import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodePng, mainSurfaceReady, NOISE, pairScreens, pixelDifference, prepareMainSurface, prepareScreenshotScroll, screenshotName, screenThemeSnapshot, mainPageState, visibleImagesReady } from '../scripts/screens-model.mjs';
import { comparison, htmlShell } from '../scripts/screens-report.mjs';

test('stable screenshots encode source, entry, appearance, width and optional page', () => {
  const capture = { source: 'gallery', id: 'helper-progress', theme: 'light', viewport: 'phone-390' };
  assert.equal(screenshotName(capture), 'gallery--helper-progress--light--phone-390.png');
  assert.equal(screenshotName({ ...capture, page: 3 }), 'gallery--helper-progress--light--phone-390--page-3.png');
  for (const id of ['../escape', 'entry.png', 'Entry', 'foo/bar', '']) assert.throws(() => screenshotName({ ...capture, id }));
  for (const page of [0, -1, 1.5]) assert.throws(() => screenshotName({ ...capture, page }));
});

test('pairing uses filename identity, with deterministic new and missing rows', () => {
  assert.deepEqual(pairScreens(['b.png', 'a.png', 'gone.png', 'a.png'], ['c.png', 'b.png', 'a.png']), [
    { name: 'a.png', status: 'paired' }, { name: 'b.png', status: 'paired' }, { name: 'c.png', status: 'new' }, { name: 'gone.png', status: 'missing' },
  ]);
});
test('dialog paging skips hidden floating pickers and resets the visible modal scroller', () => {
  const scroller = { clientHeight: 600, scrollHeight: 1600, scrollTop: 320, overflow: 'auto' };
  const hidden = { hidden: true, getClientRects: () => [{}] };
  const modal = { hidden: false, getClientRects: () => [{}], querySelectorAll: () => [scroller], clientHeight: 700, scrollHeight: 700, overflow: 'hidden' };
  const document = { querySelectorAll: () => [hidden, modal] }, viewport = { getComputedStyle: node => ({ overflowY: node.overflow }) };
  assert.deepEqual(prepareScreenshotScroll(document, viewport), { max: 1000, step: 560 });
  assert.equal(viewport.__screensOverflow, scroller); assert.equal(scroller.scrollTop, 0);
  modal.hidden = true; assert.equal(prepareScreenshotScroll(document, viewport), null); assert.equal(viewport.__screensOverflow, undefined);
});
test('isolated gallery regions page the document without paging the normal picker', () => {
  const element = { clientHeight: 844, scrollHeight: 1800, scrollTop: 500 };
  const document = { querySelectorAll: () => [], documentElement: { dataset: { galleryCapture: 'true' } }, scrollingElement: element };
  const viewport = {};
  assert.deepEqual(prepareScreenshotScroll(document, viewport), { max: 956, step: 804 });
  assert.equal(viewport.__screensOverflow, element); assert.equal(element.scrollTop, 0);
  document.documentElement.dataset.galleryCapture = 'false'; assert.equal(prepareScreenshotScroll(document, viewport), null);
});
test('capture appearance overrides only copied response preferences without mutating saved data', () => {
  const value = { state: { revision: 7, members: [{ id: 'one', unlocked: ['100'], preferences: { theme: 'dark', advanced: true } }] }, pools: { one: { eligible: [] } } };
  const before = structuredClone(value), themed = screenThemeSnapshot(value, 'light');
  assert.equal(themed.state.members[0].preferences.theme, 'light');
  assert.equal(themed.state.members[0].preferences.advanced, true);
  assert.deepEqual(value, before); assert.equal(themed.state.revision, value.state.revision);
  assert.equal(themed.pools, value.pools); assert.equal(themed.state.members[0].unlocked, value.state.members[0].unlocked);
  assert.equal(screenThemeSnapshot(value, 'invalid'), value);
  const unrelated = { rows: [] }; assert.equal(screenThemeSnapshot(unrelated, 'dark'), unrelated);
});
test('main readiness accepts a drawn cached map and keeps errors separate from task loading', () => {
  const nodes = { 'startup-error': { hidden: true }, 'task-engine-status': { textContent: '1,650 possible tasks' }, 'map-stage': { dataset: { mapImage: 'unused' } } };
  const document = { getElementById: id => nodes[id] };
  assert.deepEqual(mainPageState(document, { events: [{ name: 'terrain-drawn' }] }), { error: false, tasks: true, art: true });
  nodes['map-stage'].dataset.mapImage = 'ready'; assert.equal(mainPageState(document, {}).art, true);
  nodes['startup-error'].hidden = false; assert.equal(mainPageState(document, {}).error, true);
  nodes['task-engine-status'].textContent = 'Loading tasks…'; assert.equal(mainPageState(document, {}).tasks, false);
});
test('image readiness ignores off-screen lazy images and respects modal scroll clipping', () => {
  const box = (top, bottom) => ({ left: 0, right: 100, top, bottom, width: 100, height: bottom - top });
  const image = { complete: false, getBoundingClientRect: () => box(900, 920) };
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [image] };
  const viewport = { innerWidth: 390, innerHeight: 844, getComputedStyle: node => node.style };
  assert.equal(visibleImagesReady(document, viewport), true);
  image.getBoundingClientRect = () => box(300, 320); assert.equal(visibleImagesReady(document, viewport), false);
  image.parentElement = { style: { overflowY: 'auto', overflowX: 'visible' }, getBoundingClientRect: () => box(0, 200) };
  assert.equal(visibleImagesReady(document, viewport), true);
  image.parentElement.getBoundingClientRect = () => box(0, 400); assert.equal(visibleImagesReady(document, viewport), false);
  document.querySelector = () => ({ querySelectorAll: () => [] }); assert.equal(visibleImagesReady(document, viewport), true);
});

test('Helper readiness uses its full page and tools wait for busy/loading content', () => {
  const host = { hidden: false, busy: false, descendantBusy: false, statuses: [], getAttribute() { return this.busy ? 'true' : null; },
    querySelector() { return this.descendantBusy ? {} : null; }, querySelectorAll() { return this.statuses; } };
  const document = { getElementById: id => id === 'helper-page' ? host : null, querySelector: () => null };
  assert.equal(mainSurfaceReady(document, 'helper'), true);
  assert.equal(mainSurfaceReady(document, 'history'), false);
  host.busy = true; assert.equal(mainSurfaceReady(document, 'helper'), false);
  host.busy = false; host.descendantBusy = true; assert.equal(mainSurfaceReady(document, 'helper'), false);
  host.descendantBusy = false;
  for (const textContent of ['Opening tool…', 'Loading completed tasks…', 'Searching saved history…', 'Loading F2P training methods…']) {
    host.statuses = [{ textContent }]; assert.equal(mainSurfaceReady(document, 'helper'), false);
  }
  host.statuses = [{ textContent: '12 changes shown' }]; assert.equal(mainSurfaceReady(document, 'helper'), true);
  host.hidden = true; assert.equal(mainSurfaceReady(document, 'helper'), false);
});

test('switching from Helper returns to the picker before opening another surface', () => {
  const clicks = [];
  const button = id => ({ click: () => clicks.push(id) });
  const helper = { hidden: false, querySelector: () => button('helper-back') };
  const document = { getElementById: id => id === 'helper-page' ? helper : button(id), querySelectorAll: () => [] };
  prepareMainSurface(document, 'search-open');
  assert.deepEqual(clicks, ['helper-back', 'phone-tab-map', 'search-open']);
  clicks.length = 0; helper.hidden = true;
  prepareMainSurface(document, 'phone-tab-tasks');
  assert.deepEqual(clicks, ['phone-tab-map', 'phone-tab-tasks']);
});

test('pixel noise model ignores tiny channel changes and a small affected area', () => {
  const original = { width: 100, height: 10, pixels: new Uint8ClampedArray(4000).fill(100) };
  const modified = { ...original, pixels: original.pixels.slice() };
  modified.pixels[0] += NOISE.channelDelta;
  assert.equal(pixelDifference(original, modified).changedPixels, 0);
  modified.pixels[0]++;
  assert.deepEqual(pixelDifference(original, modified), { changed: false, dimensionsChanged: false, changedPixels: 1, fraction: 0.001 });
  modified.pixels[4] += NOISE.channelDelta + 1;
  assert.equal(pixelDifference(original, modified).changed, true);
  assert.equal(pixelDifference(original, modified).changedPixels, 2);
  assert.equal(pixelDifference(original, { ...modified, width: 101 }).dimensionsChanged, true);
});

// Construct two-row RGB and RGBA fixtures using each PNG filter. The decoder
// sees raster streams from Chrome, whose chunk checksums aren't used here.
function pngFixture(channels, filter, width = 3, height = 2) {
  const stride = width * channels;
  const raster = Buffer.from(Array.from({ length: stride * height }, (_, index) => (index * 31 + 17) % 256));
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? raster[y * stride + x - channels] : 0;
      const above = y ? raster[(y - 1) * stride + x] : 0;
      const diagonal = y && x >= channels ? raster[(y - 1) * stride + x - channels] : 0;
      const p = left + above - diagonal, distances = [Math.abs(p - left), Math.abs(p - above), Math.abs(p - diagonal)];
      const predictor = [0, left, above, Math.floor((left + above) / 2), [left, above, diagonal][distances.indexOf(Math.min(...distances))]][filter];
      raw[y * (stride + 1) + 1 + x] = raster[y * stride + x] - predictor;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = channels === 4 ? 6 : 2;
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]); };
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) pixels.set([...raster.subarray(pixel * channels, pixel * channels + 3), channels === 4 ? raster[pixel * channels + 3] : 255], pixel * 4);
  return { bytes, expected: { width, height, pixels } };
}
test('PNG decoder handles RGB/RGBA and all five screenshot row filters', () => {
  for (const channels of [3, 4]) for (let filter = 0; filter <= 4; filter++) {
    const fixture = pngFixture(channels, filter); assert.deepEqual(decodePng(fixture.bytes), fixture.expected);
  }
  assert.throws(() => decodePng(Buffer.from('not a png')));
  const fixture = pngFixture(4, 0); assert.throws(() => decodePng(fixture.bytes.subarray(0, 30)));
  assert.equal(pixelDifference(decodePng(fixture.bytes), decodePng(pngFixture(4, 0, 4).bytes)).dimensionsChanged, true);
});

test('offline comparison renders changed/new/missing pairs and an executable canvas diff', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-screens-model-'));
  const older = path.join(directory, 'older'), current = path.join(directory, 'current');
  try {
    await mkdir(older); await mkdir(current);
    const small = pngFixture(3, 0).bytes, wide = pngFixture(4, 4, 4).bytes;
    for (const name of ['changed.png', 'gone.png', 'same.png']) await writeFile(path.join(older, name), small);
    for (const name of ['changed.png', 'new.png']) await writeFile(path.join(current, name), wide);
    await writeFile(path.join(current, 'same.png'), small);
    await writeFile(path.join(older, 'encoding.png'), small);
    await writeFile(path.join(current, 'encoding.png'), pngFixture(3, 4).bytes);
    const result = await comparison(older, current, ['changed.png', 'new.png', 'same.png', 'encoding.png']);
    assert.deepEqual(result.counts, { changed: 1, new: 1, missing: 1, unchanged: 2 });
    assert.equal(result.rows.find(row => row.name === 'encoding.png').changedPixels, 0);
    assert.equal(result.rows.find(row => row.name === 'changed.png').dimensionsChanged, true);
    const html = await readFile(path.join(current, 'compare.html'), 'utf8');
    assert.match(html, /data-status="changed"/); assert.match(html, /data-status="new"/); assert.match(html, /data-status="missing"/);
    assert.doesNotMatch(html, /<h2>same\.png/);
    assert.match(html, /data:image\/png;base64,/); assert.match(html, /<canvas>/);
    assert.match(html, /loading="lazy"/); assert.match(html, /IntersectionObserver/);
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(script));
    assert.match(htmlShell('<unsafe>', '<p>content</p>'), /<title>&lt;unsafe&gt;<\/title>/);
  } finally {
    // Temp root is fixed by mkdtemp under the OS temp directory, never a save.
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    await rm(directory, { recursive: true, force: true });
  }
});
