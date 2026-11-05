import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluate, monitor } from '../scripts/linux/monitor.mjs';
import { notify, releaseWindow } from '../scripts/linux/notify.mjs';
import { deadman } from '../scripts/linux/ops-status.mjs';
const base = fileURLToPath(new URL('../.local/monitor-tests/', import.meta.url));
const now = Date.parse('2026-11-05T12:00:00Z'), GiB = 1024 ** 3;
const sample = () => ({ writerActive: true, backup: { snapshotAt: new Date(now).toISOString() },
  offhost: { snapshotAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString() }, diskBytes: 20 * GiB, ramBytes: 3 * GiB, failed: [] });
async function fixture(t) { await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('observer catches inactive writer independently of skipped health, both snapshot ages and delivery age', () => {
  const value = sample(); assert.deepEqual(evaluate(value, {}, now).faults, {});
  value.writerActive = false; value.health = { result: 'skipped' };
  value.backup.snapshotAt = new Date(now - 36 * 3600000).toISOString();
  value.offhost.snapshotAt = new Date(now - 48 * 3600000).toISOString();
  const faults = evaluate(value, {}, now).faults;
  assert.equal(faults['writer-inactive'], 'critical'); assert.equal(faults['backup-source'], 'warning');
  assert.equal(faults['offhost-source'], 'critical'); assert(!faults['offhost-delivery']);
  value.offhost.lastSuccessAt = new Date(now - 48 * 3600000).toISOString();
  assert.equal(evaluate(value, {}, now).faults['offhost-delivery'], 'critical');
  value.backup.snapshotAt = 'invalid'; assert.equal(evaluate(value, {}, now).faults['backup-source'], 'critical');
});
test('disk and RAM thresholds, sustained memory delay, reset, urgent escalation and status faults', () => {
  const value = sample(); value.diskBytes = 15 * GiB - 1; value.ramBytes = 2 * GiB - 1;
  let result = evaluate(value, {}, now); assert.equal(result.faults['disk-low'], 'warning'); assert(!result.faults['ram-low']);
  result = evaluate(value, result, now + 10 * 60000); assert.equal(result.faults['ram-low'], 'warning');
  value.ramBytes = 2 * GiB; assert.equal(evaluate(value, result, now).lowRamSince, null);
  value.ramBytes = GiB - 1; value.diskBytes = 5 * GiB - 1; value.health = { faults: ['disk-reserve'] };
  result = evaluate(value, {}, now); assert.equal(result.faults['ram-low'], 'urgent'); assert.equal(result.faults['disk-low'], 'urgent');
  value.operator = { result: 'failed' }; value.failed = ['chunk-picker.service', 'picker-footprint.service'];
  result = evaluate(value, {}, now); assert.equal(result.faults['operator-fault'], 'critical'); assert.equal(result.faults['unit-writer'], 'critical');
});
test('maintenance remains evidence, dead ownership and long operations alert; release windows are bounded', async t => {
  const controlDir = await fixture(t), marker = { startedAt: new Date(now - 31 * 60000).toISOString() };
  const file = path.join(controlDir, 'maintenance.json'); await writeFile(file, JSON.stringify(marker));
  const value = { ...sample(), marker, ownerAlive: false };
  const result = await monitor({ controlDir }, { sample: value, now, send: async () => {} });
  assert.equal(result.faults['maintenance-abandoned'], 'critical'); assert.equal(result.faults['operation-long'], 'critical');
  assert.deepEqual(JSON.parse(await readFile(file)), marker);
  assert(releaseWindow({ startedAt: new Date(now - 60000), endsAt: new Date(now + 60000) }, now));
  assert(!releaseWindow({ startedAt: new Date(now), endsAt: new Date(now + 31 * 60000) }, now));
  assert(!releaseWindow({ startedAt: new Date(now - 60000), endsAt: new Date(now) }, now));
});
test('notifier deduplicates, escalates, repeats bounded critical incidents, recovers and retries delivery', async t => {
  const controlDir = await fixture(t), sent = [], send = async text => sent.push(text);
  const run = (faults, offset, options = {}) => notify({ controlDir, faults, now: now + offset, send, ...options });
  await run({ 'disk-low': 'warning' }, 0); await run({ 'disk-low': 'warning' }, 60000); assert.equal(sent.length, 1);
  await run({ 'disk-low': 'urgent' }, 120000); assert.equal(sent.length, 2);
  await run({ 'disk-low': 'urgent' }, 3600000); assert.equal(sent.length, 2);
  await run({ 'disk-low': 'urgent' }, 6 * 3600000 + 120000); assert.equal(sent.length, 3);
  await run({}, 6 * 3600000 + 180000); assert.match(sent.at(-1), /RECOVERED/);
  await run({ 'ram-low': 'urgent' }, 7 * 3600000, { send: async () => { throw Error('synthetic failure'); } });
  await run({ 'ram-low': 'urgent' }, 7 * 3600000 + 60000); assert.match(sent.at(-1), /memory/);
  await assert.rejects(run({ 'private-input': 'critical' }, 8 * 3600000), /Unknown/);
});
test('rate limiting leaves recoveries pending and release windows do not hide resource incidents', async t => {
  const controlDir = await fixture(t), sent = [], send = async text => sent.push(text);
  const window = { startedAt: new Date(now).toISOString(), endsAt: new Date(now + 10 * 60000).toISOString() };
  await notify({ controlDir, now, window, faults: { 'writer-inactive': 'critical', 'disk-low': 'urgent' }, send });
  assert(!sent[0].includes('Writer')); assert(sent[0].includes('Disk'));
  await notify({ controlDir, now: now + 1000, faults: {}, send }); assert.equal(sent.length, 1);
  await notify({ controlDir, now: now + 31000, faults: {}, send }); assert.match(sent[1], /RECOVERED/);
  for (let i = 2; i < 6; i++) await notify({ controlDir, now: now + i * 31000, faults: i % 2 ? {} : { 'disk-low': 'urgent' }, send });
  assert.equal(sent.length, 4);
});
test('dead-man errors never escape the completed job and redirects are disabled', async () => {
  assert.equal(await deadman('health', { read: async () => { throw Error(); } }), false);
  const read = async () => 'https://' + 'hc-ping.com/' + '00000000-0000-4000-8000-000000000000';
  assert.equal(await deadman('backup', { read, fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'error'); throw Error(); } }), false);
  assert.equal(await deadman('offhost', { read, fetchImpl: async () => ({ ok: true }) }), true);
});
