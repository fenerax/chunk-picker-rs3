import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createGallerySafety } from '../app/web/gallery-safety.mjs';
import { createGalleryCapture } from '../app/web/gallery-capture.mjs';
import { galleryEntries, galleryExclusions } from '../app/web/gallery-catalogue.mjs';
import { createGalleryFixtures } from '../app/web/gallery-fixtures.mjs';
import { renderGalleryUsage } from '../app/web/gallery-usage.mjs';
import { galleryUsageTime } from '../app/web/gallery-usage-fixture.mjs';
import { usageById } from '../app/web/usage-catalogue.mjs';
import { usageSummary } from '../app/web/usage-model.mjs';
import { galleryPreviewHTML } from '../app/gallery-route.mjs';
import { coverageProblems, dialogRegistrations, readGallerySources, shellSurfaceNodes } from '../scripts/gallery-coverage.mjs';

const inventory = JSON.parse(await readFile(new URL('../docs/research/ui-map-2026-10-13.json', import.meta.url)));
const shell = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
inventory.nodes.push(...shellSurfaceNodes(shell));
const registrationCoverage = JSON.parse(await readFile(new URL('../app/web/gallery-dialog-coverage.json', import.meta.url)));
const sources = await readGallerySources();
const coverage = { inventory, registrations: dialogRegistrations(sources), entries: galleryEntries, exclusions: galleryExclusions, registrationCoverage };

test('every dialog registration and inventoried main region has a gallery sample or reason', () => {
  assert.deepEqual(coverageProblems(coverage), []);
  for (const entry of galleryEntries) assert.match(entry.id, /^[a-z0-9-]+$/);
});
test('staleness detects new dialogs in an already-covered source module', () => {
  const changed = new Map(sources); changed.set('app/web/settings-panel.mjs', `${changed.get('app/web/settings-panel.mjs')}\nctx.openDialog('Brand new dialog', content);`);
  assert(coverageProblems({ ...coverage, registrations: dialogRegistrations(changed) }).some(problem => problem.includes('Brand new dialog')));
});
test('staleness detects newly authored shell regions without refreshing the dated UI map', () => {
  const changed = { nodes: [...inventory.nodes, ...shellSurfaceNodes('<section id="new-panel">Example</section>')] };
  assert(coverageProblems({ ...coverage, inventory: changed }).some(problem => problem.includes('new-panel')));
});
test('staleness rejects removed entries, new regions, blank reasons and retired registrations', () => {
  assert(coverageProblems({ ...coverage, entries: galleryEntries.filter(entry => entry.id !== 'area') }).some(problem => problem.includes('area')));
  const changed = structuredClone(inventory); changed.nodes.push({ id: 'region:new', kind: 'region', label: 'New region' });
  assert(coverageProblems({ ...coverage, inventory: changed }).some(problem => problem.includes('region:new')));
  assert(coverageProblems({ ...coverage, exclusions: { ...galleryExclusions, 'dialog:native-lock': '' } }).some(problem => problem.includes('Exclusion needs a reason')));
  assert(coverageProblems({ ...coverage, registrationCoverage: { ...registrationCoverage, 'retired': { entries: ['main'] } } }).some(problem => problem.includes('Retired registration')));
});

test('both Usage dialog registrations require every real state sample', () => {
  for (const title of ['Settings', 'Usage']) {
    const key = `app/web/screen-usage.mjs :: '${title}'`, registration = registrationCoverage[key];
    assert.equal(registration.reason, undefined);
    assert.equal(registration.entries.length, 3);
    for (const id of registration.entries) {
      assert(coverageProblems({ ...coverage, entries: galleryEntries.filter(entry => entry.id !== id) }).some(problem => problem.includes(key)));
    }
  }
});

test('Usage fixtures provide isolated invented window totals, actor/device/period filters and empty counts', async () => {
  const safety = createGallerySafety(), fixtures = createGalleryFixtures(safety.save);
  const payload = await fixtures.api('/api/usage');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(new Set(payload.counts.map(row => row.id)).size, 36);
  assert.deepEqual(new Set(payload.counts.map(row => row.actor)), new Set(['player1', 'player2', 'unlinked', 'viewer']));
  for (const row of payload.counts) {
    assert.equal(usageById.get(row.id)?.kind, 'open', row.id);
    assert(Number.isInteger(row.count) && row.count > 0 && row.count <= 1000);
  }
  const summary = options => usageSummary(payload.counts, { now: new Date(galleryUsageTime), actor: 'player1', ...options });
  assert.equal(summary().top.length, 30);
  assert(summary({ actor: 'player2' }).total > summary().total);
  for (const actor of ['viewer', 'unlinked']) assert(summary({ actor }).total > 0);
  assert.equal(summary().total, summary({ device: 'phone' }).total + summary({ device: 'desktop' }).total);
  assert(summary({ days: 30 }).total > summary().total);
  payload.counts[0].count = 999;
  assert.notEqual((await fixtures.api('/api/usage')).counts[0].count, 999);
  const empty = createGalleryFixtures(safety.save, { usageEmpty: true });
  assert.deepEqual(await empty.api('/api/usage'), { schemaVersion: 1, counts: [] });
  assert((await createGalleryFixtures(safety.save).api('/api/usage')).counts.length > 0);
  await assert.rejects(fixtures.api('/api/usage', { counts: [] }), /Not saved: gallery/);
});

test('gallery browser safety continues to block real Usage GET, POST and beacons', async () => {
  const source = await readFile(new URL('../app/web/gallery-safety.mjs', import.meta.url), 'utf8');
  const requests = [], notes = [], context = { URL, location: { href: 'http://gallery.invalid/gallery/preview', origin: 'http://gallery.invalid' },
    Storage: class {}, navigator: {}, document: { addEventListener() {} }, fetch: (...args) => { requests.push(args); } };
  runInNewContext(source.replace(/^export /gm, ''), context);
  context.installGallerySafety(note => notes.push(note));
  for (const method of ['GET', 'POST']) assert.throws(() => context.fetch('/api/usage', { method }), /Not saved: gallery/);
  assert.throws(() => context.navigator.sendBeacon('/api/usage', '{}'), /Not saved: gallery/);
  assert.equal(requests.length, 0);
  assert.equal(notes.length, 3);
  context.fetch('/assets/example.png'); assert.equal(requests.length, 1);
  // Game data loads before any sample renders; it is read-only, so the preview may fetch it.
  context.fetch('/data/dataset-runtime.json'); context.fetch('/gallery-fixture-data.json?digest=x'); assert.equal(requests.length, 3);
  assert.throws(() => context.fetch('/data/dataset-runtime.json', { method: 'POST' }), /Not saved: gallery/);
  assert.throws(() => context.fetch('/api/dataset-input?key=x'), /Not saved: gallery/);
  assert.throws(() => context.fetch('/data/../api/state'), /Not saved: gallery/);
});

test('Usage samples run the shipped renderer with isolated counting preferences and viewer permissions', async () => {
  const node = (tag, text, className) => ({ tag, text, className, children: [], events: {}, attributes: {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, callback) { this.events[type] = callback; },
    dispatchEvent(event) { this.events[event.type]?.(event); },
    querySelector() { return find(this, child => child.className === 'usage-controls')?.children[0].children[1]; } });
  const find = (root, predicate) => predicate(root) ? root : root.children?.map(child => find(child, predicate)).find(Boolean);
  for (const entry of galleryEntries.filter(entry => entry.source === 'app/web/screen-usage.mjs')) {
    const safety = createGallerySafety(), fixtures = createGalleryFixtures(safety.save, entry), dialogs = [], content = node('div');
    const c = { state: fixtures.state, sessionAdmin: true, api: fixtures.api, download: safety.download, el: node,
      input: type => Object.assign(node('input'), { type }), details: title => node('details', title), field: (label, control) => { const field = node('label', label); field.append(node('span', label), control); return field; },
      button: (label, action) => Object.assign(node('button', label), { action }),
      select: (options, value) => Object.assign(node('select'), { options, value }),
      $: () => content, dialogCurrent: () => true,
      openDialog: (title, root) => { dialogs.push(title); content.replaceChildren(root); return 1; },
      applySession: session => { c.sessionReadOnly = session.readOnly; c.sessionAdmin = !session.readOnly && session.admin; }, applyPreferences() {} };
    await renderGalleryUsage(c, entry);
    assert.deepEqual(dialogs, [entry.render === 'usage-settings' ? 'Settings' : 'Usage']);
    if (entry.render === 'usage-settings') {
      const control = find(content, child => child.id === 'usage-enabled');
      assert.equal(control.checked, entry.counting !== false);
      control.checked = !control.checked; control.dispatchEvent(new Event('change'));
      assert.equal(c.usage.enabled, control.checked);
      assert.equal(c.sessionReadOnly, entry.viewer === true);
      if (entry.viewer) { await c.usage.openView(); assert.equal(dialogs.length, 1); }
      assert.equal(find(content, child => child.tag === 'button'), undefined);
    } else {
      const person = content.querySelector('.usage-controls select');
      assert.equal(person.value, entry.person ?? 'player1');
      assert.equal(!!find(content, child => child.text === 'No counts yet.'), entry.usageEmpty === true);
      const rows = find(content, child => child.tag === 'tbody');
      if (!entry.usageEmpty) {
        const expected = usageSummary((await fixtures.api('/api/usage')).counts, { actor: person.value, now: new Date(galleryUsageTime) });
        assert.equal(rows.children.length, 30);
        assert.equal(rows.children[0].children[1].text, expected.top[0].total.toLocaleString());
        assert(person.options.some(option => option.value === 'unlinked'));
      }
      assert.throws(() => find(content, child => child.text === 'Export JSON').action(), /Not saved: gallery/);
    }
  }
});
test('command, save and downloads throw and report gallery status without changing fixtures', async () => {
  const notes = [], safety = createGallerySafety(note => notes.push(note)), fixtures = createGalleryFixtures(safety.save);
  const before = JSON.stringify(fixtures.state);
  for (const action of Object.values(safety)) assert.throws(() => action({ type: 'roll' }), /Not saved: gallery/);
  await assert.rejects(fixtures.api('/api/commands', { type: 'roll' }), /Not saved: gallery/);
  await assert.rejects(fixtures.api('/api/state', {}), /Not saved: gallery/);
  assert.equal(JSON.stringify(fixtures.state), before);
  assert(notes.every(note => note === 'Not saved: gallery'));
  const second = createGalleryFixtures(safety.save); fixtures.state.members[0].notes['12341'] = 'fixture draft';
  assert.notEqual(second.state.members[0].notes['12341'], 'fixture draft');
});
test('preview reuses shipped markup and replaces the live entrypoint once', async () => {
  const shell = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8'), preview = galleryPreviewHTML(shell);
  assert(!preview.includes('src="/main.mjs"')); assert(preview.includes('src="/gallery-preview.mjs"'));
  assert(preview.includes('id="tool-dialog"')); assert(preview.includes('id="map-display-content"'));
  assert.equal((preview.match(/gallery-preview\.mjs/g) ?? []).length, 1);
});

test('capture appearance updates fixture and read-only map preferences and resets each variant', async () => {
  const member = { preferences: { theme: 'dark' } }, calls = [], scroll = { scrollTop: 90, scrollLeft: 20 };
  const c = { member: () => member, canWrite: () => false, viewerPreferences: {}, preferenceSignature: 'old',
    applyPreferences: () => calls.push('preferences'), map: { resize: () => calls.push('resize') }, renderMapState: () => calls.push('map'),
    phoneLayout: { tab: 'map', select: (tab, options) => calls.push([tab, options.persist]) } };
  const document = { querySelectorAll: () => [scroll], defaultView: { scrollTo: (x, y) => calls.push([x, y]) }, documentElement: { dataset: {} } };
  const capture = createGalleryCapture(c, document, { dark: {}, light: {} }, async () => calls.push('frame'));
  assert.equal(await capture('light'), true);
  assert.equal(member.preferences.theme, 'light'); assert.equal(c.viewerPreferences.theme, 'light');
  assert.equal(c.preferenceSignature, undefined); assert.equal(document.documentElement.dataset.galleryTheme, 'light');
  assert.deepEqual(scroll, { scrollTop: 0, scrollLeft: 0 });
  assert.deepEqual(calls, ['preferences', ['map', false], 'frame', 'resize', 'map', [0, 0], 'frame']);
  await assert.rejects(capture('unknown'), /Unknown gallery theme/);
});
