import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUsageCounter, USAGE_STORAGE_KEY, usageDevice, dialogUsageId, handleUsageControl, controlUsageId } from '../app/web/usage-client.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';
import { usageSummary } from '../app/web/usage-model.mjs';
import { createScreenUsage } from '../app/web/screen-usage.mjs';

function fixture({ off = false, send } = {}) {
  let at = new Date('2026-10-13T23:59:59Z'), person = 'player2', width = 767;
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

test('catalogue ids match the UI map or explicit new families and do not include overlay/gallery pages', async () => {
  const inventory = JSON.parse(await readFile(new URL('../docs/research/ui-map-2026-10-13.json', import.meta.url)));
  const known = new Set(inventory.nodes.map(node => node.id));
  const added = /^(?:usage|dom:usage-|tasks:other-control|tasks:category-fold-all$|helper:back|dom:helper-player|dom:boss-gates-open$)/;
  assert.equal(new Set(usageEvents.map(event => event.id)).size, usageEvents.length);
  for (const event of usageEvents) {
    assert.match(event.id, /^[a-z][a-z0-9]*(?:[-:][a-z0-9]+)*$/);
    assert.ok(known.has(event.id) || added.test(event.id), event.id);
    assert.ok(event.id === 'dom:gallery-open' || !/overlay:page|gallery/.test(event.id));
  }
});
