import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUsageCounter, USAGE_STORAGE_KEY, usageDevice, dialogUsageId, handleUsageControl, controlUsageId } from '../app/web/usage-client.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';
import { usageSummary } from '../app/web/usage-model.mjs';
import { createScreenUsage } from '../app/web/screen-usage.mjs';

function fixture({ off = false, send } = {}) {
  let at = new Date('2026-10-13T23:59:59Z'), person = 'reed', width = 767;
  const memory = new Map(off ? [[USAGE_STORAGE_KEY, 'false']] : []), requests = [], beacons = [];
  let tick, interval;
  const counter = createUsageCounter({ storage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) },
    actor: () => person, width: () => width, now: () => at,
    fetch: async (url, options) => { requests.push({ url, ...options }); return send ? send() : { ok: true }; },
    beacon: (url, body) => { beacons.push({ url, body }); return true; },
    schedule: (callback, ms) => { tick = callback; interval = ms; return 1; }, cancel: () => { tick = undefined; } });
  return { counter, memory, requests, beacons, tick: () => tick?.(), interval: () => interval,
    set: (date, actor, deviceWidth) => { at = new Date(date); person = actor; width = deviceWidth; } };
}

test('usage batches daily counts at 60 seconds with actor/device at the time of use and no personal fields', async () => {
  const f = fixture(); f.counter.start(); assert.equal(f.interval(), 60000);
  f.counter.count('dom:more-tools'); f.counter.count('dom:more-tools');
  f.counter.count('some typed task'); f.counter.count('dom:12345');
  f.set('2026-10-14T00:00:01Z', 'viewer', 768); f.counter.count('search');
  await f.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/usage'); assert.equal(f.requests[0].credentials, 'same-origin');
  assert.equal(f.requests[0].keepalive, true);
  assert.deepEqual(JSON.parse(f.requests[0].body), { counts: [
    { id: 'dom:more-tools', actor: 'reed', device: 'phone', day: '2026-10-13', count: 2 },
    { id: 'search', actor: 'viewer', device: 'desktop', day: '2026-10-14', count: 1 },
  ] });
  await f.counter.flush(); assert.equal(f.requests.length, 1);
  f.counter.stop(); assert.equal(f.tick(), undefined);
});

test('switch off drops unsent counts, suppresses fetch/beacon, persists per device and stays off after reload', async () => {
  const f = fixture(); f.counter.count('settings'); f.counter.setEnabled(false);
  f.counter.count('dom:more-tools'); await f.counter.flush(); await f.counter.flush(true);
  assert.equal(f.memory.get(USAGE_STORAGE_KEY), 'false'); assert.equal(f.requests.length + f.beacons.length, 0);
  const off = fixture({ off: true }); off.counter.count('settings'); await off.counter.flush(); assert.equal(off.requests.length, 0);
  f.counter.setEnabled(true); f.counter.count('settings'); await f.counter.flush();
  assert.equal(JSON.parse(f.requests[0].body).counts[0].count, 1);
});

test('failed delivery cannot restore a buffer after switching off, including off then on', async () => {
  let reject;
  const f = fixture({ send: () => new Promise((resolve, rejectSend) => { reject = rejectSend; }) });
  f.counter.count('settings'); const sending = f.counter.flush();
  f.counter.setEnabled(false); f.counter.setEnabled(true); reject(new Error('offline')); await sending;
  await f.counter.flush(); assert.equal(f.requests.length, 1);
});

test('a failed flush retries totals and pagehide uses a JSON same-origin beacon', async () => {
  let failed = true;
  const f = fixture({ send: async () => { if (failed) throw new Error('offline'); return { ok: true }; } });
  f.counter.count('history'); await f.counter.flush(); failed = false;
  f.counter.count('history'); await f.counter.flush(true);
  assert.equal(f.beacons.length, 1); assert.equal(f.beacons[0].url, '/api/usage');
  assert.equal(f.beacons[0].body.type, 'application/json');
  assert.equal(JSON.parse(await f.beacons[0].body.text()).counts[0].count, 2);
  await f.counter.flush(); assert.equal(f.requests.length, 1);
});

test('preference changes from another tab discard its unsent counts', async () => {
  const f = fixture(); f.counter.count('settings'); f.memory.set(USAGE_STORAGE_KEY, 'false');
  f.counter.refreshPreference(); await f.counter.flush(); assert.equal(f.counter.enabled, false); assert.equal(f.requests.length, 0);
});

test('device threshold and schema stay bounded during offline use', async () => {
  assert.equal(usageDevice(767), 'phone'); assert.equal(usageDevice(768), 'desktop');
  const f = fixture(); for (let i = 0; i < 1100; i++) f.counter.count('search');
  await f.counter.flush(); assert.equal(JSON.parse(f.requests[0].body).counts[0].count, 1000);
});

test('delegated controls count activations once and ignore all values, URLs and arbitrary ids', () => {
  const calls = [];
  const control = { tagName: 'INPUT', id: 'hide-completed', type: 'checkbox', value: 'private task', dataset: {},
    closest: selector => selector === 'button, summary, input, select, textarea, a' ? control : undefined };
  handleUsageControl({ type: 'click', target: control }, id => calls.push(id));
  handleUsageControl({ type: 'change', target: control }, id => calls.push(id));
  assert.deepEqual(calls, ['dom:hide-completed']);
  control.id = 'private chunk id'; control.dataset.usage = 'https://secret.test/token';
  handleUsageControl({ type: 'change', target: control }, id => calls.push(id)); assert.equal(calls.length, 1);
  control.id = 'task-filter'; control.type = 'search';
  handleUsageControl({ type: 'input', target: control }, id => calls.push(id));
  assert.equal(calls.length, 1);
  handleUsageControl({ type: 'click', target: control }, id => calls.push(id));
  assert.equal(calls.length, 1);
  handleUsageControl({ type: 'change', target: control }, id => calls.push(id));
  assert.equal(calls.at(-1), 'dom:task-filter');
  assert.equal(controlUsageId({ id: 'usage-open', dataset: {} }), 'dom:usage-open');
});

test('the bulk task fold button records one registered usage activation', async () => {
  const control = { tagName: 'BUTTON', id: 'task-category-fold-all', dataset: {},
    matches: selector => selector === '.task-category-fold-all',
    closest: selector => selector === 'button, summary, input, select, textarea, a' || selector === '.task-sidebar' ? control : undefined };
  const f = fixture();
  handleUsageControl({ type: 'click', target: control }, id => f.counter.count(id));
  await f.counter.flush();
  assert.equal(JSON.parse(f.requests[0].body).counts[0].id, 'tasks:category-fold-all');
  assert.equal(JSON.parse(f.requests[0].body).counts[0].count, 1);
});

test('pagehide attempts keepalive fetch when a beacon cannot be queued', async () => {
  for (const beacon of [undefined, () => false, () => { throw new Error('blocked'); }]) {
    const requests = [], counter = createUsageCounter({ actor: () => 'viewer', width: () => 390,
      fetch: async (url, options) => { requests.push({ url, ...options }); return { ok: true }; }, beacon });
    counter.count('search'); await counter.flush(true);
    assert.equal(requests.length, 1); assert.equal(requests[0].keepalive, true);
    assert.equal(requests[0].url, '/api/usage');
  }
});

test('dialog hooks resolve named and dynamic titles to fixed ids without recording their text', () => {
  assert.equal(dialogUsageId('Settings'), 'settings');
  assert.equal(dialogUsageId('Player’s Teleports'), 'teleports');
  assert.equal(dialogUsageId('Sync Reed from RuneMetrics'), 'runemetrics:standalone');
  assert.equal(dialogUsageId('Personal task text', [{ dataset: { usage: 'tasks:detail' } }]), 'tasks:detail');
  assert.equal(dialogUsageId('A private item', [{ dataset: { usage: 'tasks:item-detail' } }]), 'tasks:item-detail');
  assert.equal(dialogUsageId('Any other private text'), 'dom:tool-dialog');
});

test('usage ranking uses inclusive UTC 7/30 days, actor and device, with 30 rows and explicit zero counts', () => {
  const counts = usageEvents.slice(0, 36).map((event, index) => ({ id: event.id, actor: 'reed', device: 'phone', day: '2026-10-13', count: index + 1 }));
  counts.push({ id: 'settings', actor: 'reed', device: 'desktop', day: '2026-10-07', count: 100 },
    { id: 'settings', actor: 'reed', device: 'phone', day: '2026-10-06', count: 200 },
    { id: 'settings', actor: 'actor1', device: 'phone', day: '2026-10-13', count: 900 });
  const now = new Date('2026-10-13T23:00:00Z');
  const week = usageSummary(counts, { actor: 'reed', now });
  assert.equal(week.top.length, 30); assert.equal(week.start, '2026-10-07');
  assert.equal(week.top[0].id, 'settings'); assert.equal(week.top[0].total, 100);
  const phone = usageSummary(counts, { actor: 'reed', device: 'phone', now });
  assert.equal(phone.unused.find(event => event.id === 'settings').desktop, 100);
  const month = usageSummary(counts, { actor: 'reed', days: 30, now });
  assert.equal(month.top[0].total, 300);
  const viewer = usageSummary(counts, { actor: 'viewer', now }); assert.equal(viewer.total, 0); assert.equal(viewer.unused.length, usageEvents.length);
});

test('Settings switch uses local device storage without commands or revisions', () => {
  const old = globalThis.localStorage, storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  try {
    const el = (tag, text) => ({ tag, text, children: [], attributes: {}, events: {}, append(...nodes) { this.children.push(...nodes); },
      setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, callback) { this.events[type] = callback; } });
    const c = { state: { revision: 12, members: [{ id: 'actor1' }] }, el, input: type => ({ ...el('input'), type }), command: () => assert.fail('usage must not issue a gameplay command') };
    createScreenUsage(c); const row = c.usage.settingsRow(), control = row.children[1];
    assert.equal(control.checked, true); assert.equal(control.attributes.role, 'switch');
    control.checked = false; control.events.change();
    assert.equal(storage.get(USAGE_STORAGE_KEY), 'false'); assert.equal(c.state.revision, 12);
  } finally { globalThis.localStorage = old; }
});

