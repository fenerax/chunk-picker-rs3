import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openUsageStore, validateUsagePayload } from '../app/storage/usage.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';
import { createUsageRateLimit } from '../app/usage-route.mjs';

const at = Date.parse('2026-10-13T12:00:00Z'), now = () => at;
const actors = ['actor1', 'reed'];
const row = (extra = {}) => ({ id: usageEvents[0].id, actor: 'actor1', device: 'desktop', day: '2026-10-13', count: 1, ...extra });
const valid = (input, actor = 'actor1') => validateUsagePayload(input, { actors, actor, now });

test('usage schema accepts aggregates only and binds every row to the authenticated actor', () => {
  assert.deepEqual(valid({ counts: [row({ actor: 'reed' })] }), [row()]);
  assert.deepEqual(valid({ counts: [row()] }, 'viewer'), [row({ actor: 'viewer' })]);
  for (const body of [null, [], {}, { counts: [] }, { counts: [row()], events: [] }, { counts: Array(201).fill(row()) },
    { counts: [row({ note: 'private' })] }, { counts: [row({ actor: 'unknown' })] }, { counts: [row({ id: 'unregistered' })] },
    { counts: [row({ id: 'https://example.test' })] }, { counts: [row({ device: 'tablet' })] }, { counts: [row({ day: '2026-02-30' })] },
    { counts: [row({ day: '2026-10-14' })] }, { counts: [row({ day: '2026-04-16' })] },
    ...[0, -1, 1.5, 1001, '1', NaN, Infinity].map(count => ({ counts: [row({ count })] }))]) {
    assert.throws(() => valid(body), { status: 400 });
  }
  assert.equal(valid({ counts: [row({ day: '2026-04-17', device: 'phone', count: 1000 })] })[0].count, 1000);
});

test('usage sidecar merges queued increments atomically and survives reopening', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-usage-storage-'));
  let storage = await openUsageStore({ dataDir, actors, now });
  t.after(async () => { await storage.close(); await rm(dataDir, { recursive: true, force: true }); });
  await Promise.all(Array.from({ length: 20 }, () => storage.add({ counts: [row(), row()] }, 'reed')));
  await storage.add({ counts: [row({ device: 'phone' })] }, 'viewer');
  const before = await storage.read();
  assert.deepEqual(before.counts.find(item => item.actor === 'reed'), row({ actor: 'reed', count: 40 }));
  assert.deepEqual(before.counts.find(item => item.actor === 'viewer'), row({ actor: 'viewer', device: 'phone' }));
  before.counts[0].count = 999;
  assert.notEqual((await storage.read()).counts[0].count, 999, 'reads cannot mutate the committed sidecar');
  await storage.close(); storage = await openUsageStore({ dataDir, actors, now });
  assert.equal((await storage.read()).counts.find(item => item.actor === 'reed').count, 40);
  assert.deepEqual(await readdir(dataDir), ['usage.json']);
});

test('usage prunes 180 UTC days on load, write and read without retaining event records', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-usage-retention-'));
  let current = at;
  await writeFile(path.join(dataDir, 'usage.json'), JSON.stringify({ schemaVersion: 1, counts: [row({ day: '2026-04-16' }), row({ day: '2026-04-17' }), row()] }));
  const storage = await openUsageStore({ dataDir, actors, now: () => current });
  t.after(async () => { await storage.close(); await rm(dataDir, { recursive: true, force: true }); });
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'usage.json'), 'utf8')).counts.length, 2);
  current += 86400000;
  await storage.add({ counts: [row({ day: '2026-10-14' })] }, 'actor1');
  assert.deepEqual((await storage.read()).counts.map(item => item.day).sort(), ['2026-10-13', '2026-10-14']);
  current += 180 * 86400000;
  assert.deepEqual(await storage.read(), { schemaVersion: 1, counts: [] });
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'usage.json'), 'utf8')), { schemaVersion: 1, counts: [] });
});

test('invalid stored usage is rejected rather than overwritten', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-usage-corrupt-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const bytes = JSON.stringify({ schemaVersion: 1, counts: [row()], secret: 'freeform' });
  await writeFile(path.join(dataDir, 'usage.json'), bytes);
  await assert.rejects(openUsageStore({ dataDir, actors, now }), /Invalid usage store/);
  assert.equal(await readFile(path.join(dataDir, 'usage.json'), 'utf8'), bytes);
});

test('usage admission limits identities, global volume and memory without evicting active buckets', () => {
  let clock = at;
  const limit = createUsageRateLimit({ now: () => clock, perIdentity: 2, global: 3, maxIdentities: 2 });
  limit('a'); limit('a');
  assert.throws(() => limit('a'), { status: 429, retryAfter: 60 });
  limit('b'); assert.throws(() => limit('c'), { status: 429 });
  clock += 60000; limit('c'); limit('d');
  assert.throws(() => limit('e'), { status: 429 });
  const global = createUsageRateLimit({ now, perIdentity: 9, global: 1 });
  global('a'); assert.throws(() => global('b'), { status: 429 });
});
