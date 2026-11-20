import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluate, monitor, lockOwnerAlive, collectStorage, monitorSettings } from '../scripts/linux/monitor.mjs';
import { pluginKeyCount } from '../scripts/linux/plugin-key-count.mjs';
import { notify, notifyFailure, releaseWindow, failureUnits } from '../scripts/linux/notify.mjs';
import { deadman } from '../scripts/linux/ops-status.mjs';
import { exclusive } from '../scripts/linux/files.mjs';
import { compact, outboxLimits } from '../scripts/linux/notify-queue.mjs';
const base = fileURLToPath(new URL('../.local/monitor-tests/', import.meta.url));
const now = Date.parse('2026-11-05T12:00:00Z'), GiB = 1024 ** 3;
const sample = () => ({ writerActive: true, backup: { snapshotAt: new Date(now).toISOString() },
  offhost: { snapshotAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString() }, diskBytes: 20 * GiB, ramBytes: 3 * GiB, failed: [] });
async function fixture(t) { await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('monitor settings reject invalid counts, ages and reversed escalation', () => {
  assert.deepEqual(monitorSettings(), { backupWarningAgeMs: 129600000, backupCriticalAgeMs: 172800000, pluginKeyWarningRecords: 800 });
  for (const key of ['backupWarningAgeMs', 'backupCriticalAgeMs', 'pluginKeyWarningRecords'])
    for (const value of [null, 0, -1, 1.5, '800', Infinity, Number.MAX_SAFE_INTEGER])
      assert.throws(() => monitorSettings({ [key]: value }), /Invalid monitor/);
  assert.throws(() => monitorSettings({ pluginKeyWarningRecords: 1000 }), /Invalid monitor/);
  for (const value of [129600000, 129599999]) assert.throws(() => monitorSettings({ backupCriticalAgeMs: value }), /precede/);
});

test('backup thresholds apply at exact boundaries to all three age observations and monitor configuration', async t => {
  for (const config of [{}, { backupWarningAgeMs: 1000, backupCriticalAgeMs: 2000 }]) {
    const settings = monitorSettings(config);
    for (const [elapsed, expected] of [[settings.backupWarningAgeMs - 1, undefined], [settings.backupWarningAgeMs, 'warning'],
      [settings.backupCriticalAgeMs - 1, 'warning'], [settings.backupCriticalAgeMs, 'critical']]) {
      const at = new Date(now - elapsed).toISOString(), value = { ...sample(), backup: { snapshotAt: at }, offhost: { snapshotAt: at, lastSuccessAt: at } };
      const controlDir = await fixture(t);
      const result = await monitor({ controlDir, ...config }, { sample: value, now, send: async () => {} });
      for (const code of ['backup-source', 'offhost-source', 'offhost-delivery']) assert.equal(result.faults[code], expected);
    }
  }
});

test('plugin record counts include revoked keys across legacy and dormant roots; alerts expose no key material', async t => {
  const controlDir = await fixture(t), dataDir = path.join(controlDir, 'legacy'), pickerRoot = path.join(controlDir, 'pickers');
  const id = 'p_' + 'a'.repeat(32), owned = path.join(pickerRoot, id);
  await mkdir(dataDir); await mkdir(owned, { recursive: true });
  const secret = 'synthetic-key-material', record = { tokenHash: secret, player: 'synthetic-player', label: 'escaped " \\ { } [ ] keys', revoked: true };
  const file = path.join(owned, 'plugin-keys.json');
  assert.equal(await pluginKeyCount(file), 0);
  for (const count of [799, 800, 999, 1000]) {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, keys: Array.from({ length: count }, () => record) }, null, 2));
    const storage = await collectStorage({ dataDir, multiPicker: { pickerRoot } });
    assert.deepEqual(storage.map(row => row.pluginKeyRecords), [0, count]);
    const result = evaluate({ ...sample(), storage }, {}, now);
    assert.equal(result.faults['plugin-key-records'], count < 800 ? undefined : count < 1000 ? 'warning' : 'critical');
    assert.equal(evaluate({ ...sample(), storage }, {}, now, { pluginKeyWarningRecords: 799 }).faults['plugin-key-records'], count < 1000 ? 'warning' : 'critical');
    assert(!JSON.stringify(storage).includes(secret));
  }
  // Exercise legacy collection too, with the key string crossing stream chunks.
  await writeFile(path.join(dataDir, 'plugin-keys.json'), JSON.stringify({ keys: [{ ...record, label: 'x'.repeat(70000) }], schemaVersion: 1 }));
  const storage = await collectStorage({ dataDir, multiPicker: { pickerRoot } }), sent = [];
  assert.equal(storage[0].pluginKeyRecords, 1);
  await monitor({ controlDir }, { sample: { ...sample(), storage }, now, send: async text => sent.push(text) });
  assert.match(sent[0], /review key retention/); assert.match(sent[0], /Revoking keys does not free records/);
  for (const privateValue of [secret, record.player, record.label, id, owned]) {
    assert(!sent.join('\n').includes(privateValue));
    assert(!(await readFile(path.join(controlDir, 'monitor-state.json'), 'utf8')).includes(privateValue));
  }
  for (const invalid of ['{', '{"schemaVersion":1,"keys":null}', '{"schemaVersion":1,"keys":[null]}', '{"schemaVersion":1,"keys":[{"label":"\\q"}]}']) {
    await writeFile(file, invalid); await assert.rejects(pluginKeyCount(file), /Invalid plugin key count input/);
  }
  await writeFile(file, 'x'.repeat(1024 * 1024 + 1)); await assert.rejects(pluginKeyCount(file), /Invalid plugin key count input/);
});

test('storage collection resolves operator configuration without RS3_OPERATOR_CONFIG', async t => {
  const root = await fixture(t), dataDir = path.join(root, 'legacy'), pickerRoot = path.join(root, 'pickers');
  const id = 'p_' + 'b'.repeat(32), owned = path.join(pickerRoot, id);
  await mkdir(dataDir); await mkdir(owned, { recursive: true });
  await writeFile(path.join(dataDir, 'state.json'), '{}');
  await writeFile(path.join(owned, 'state.json'), '{"a":1}');
  const operatorFile = path.join(root, 'operator.json');
  await writeFile(operatorFile, JSON.stringify({
    service: 'chunk-picker.service',
    current: path.join(root, 'current.json'),
    dataDir,
    controlDir: path.join(root, 'control'),
    scratchRoot: path.join(root, 'scratch'),
    backupDir: path.join(root, 'backups'),
    multiPicker: {
      registryDir: path.join(root, 'registry'),
      pickerRoot,
      tombstoneDir: path.join(root, 'tombstones'),
    },
  }));
  const previousEnv = process.env.RS3_OPERATOR_CONFIG;
  delete process.env.RS3_OPERATOR_CONFIG;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.RS3_OPERATOR_CONFIG;
    else process.env.RS3_OPERATOR_CONFIG = previousEnv;
  });
  const fromDefault = await collectStorage({}, { operatorConfig: operatorFile });
  assert.deepEqual(fromDefault.map(row => row.group), ['legacy', id]);
  const fromConfig = await collectStorage({ operatorConfig: operatorFile });
  assert.deepEqual(fromConfig.map(row => row.group), ['legacy', id]);
  await assert.rejects(collectStorage({ operatorConfig: 'relative/operator.json' }), /absolute operator configuration path/);
});

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

test('routine maintenance needs no action and sends nothing until it is abandoned or too long', async () => {
  const at = ms => new Date(now - ms).toISOString();
  const faults = (marker, ownerAlive, lock) => evaluate({ ...sample(), marker, ownerAlive, lock }, {}, now).faults;
  assert.deepEqual(faults({ startedAt: at(29 * 60000) }, true), {});
  // Multi-picker markers carry no time; the lock supplies the operation start.
  assert.deepEqual(faults({ command: 'backup' }, true, { startedAt: at(60000) }), {});
  assert.equal(faults({ command: 'backup' }, true, { startedAt: at(30 * 60000) })['operation-long'], 'critical');
  assert.equal(faults({ startedAt: at(30 * 60000) }, true)['operation-long'], 'critical');
  assert.deepEqual(faults({ startedAt: at(60000) }, false), { 'maintenance-abandoned': 'critical' });
  assert.equal(faults({}, true)['operation-long'], 'critical');
  const identity = async pid => { if (pid !== 7) throw Error('gone'); return 'boot:1'; };
  assert(await lockOwnerAlive({ pid: 7, processIdentity: 'boot:1' }, { identity }));
  assert(!await lockOwnerAlive({ pid: 7, processIdentity: 'boot:2' }, { identity }));
  assert(await lockOwnerAlive({ pid: 7, host: 'vps' }, { identity, host: 'vps' }));
  assert(!await lockOwnerAlive({ pid: 8, host: 'vps' }, { identity, host: 'vps' }));
  assert(!await lockOwnerAlive({ pid: 7, host: 'other' }, { identity, host: 'vps' }));
  assert(!await lockOwnerAlive(null, { identity }));
});

test('release windows exclude only the writer from the monitor failed-unit aggregate', async t => {
  const valid = { startedAt: new Date(now - 60000).toISOString(), endsAt: new Date(now + 60000).toISOString() };
  for (const [failed, window, aggregate] of [
    [['chunk-picker.service'], valid, false],
    [['chunk-picker.service', 'chunk-picker-backup.service'], valid, true],
    [['chunk-picker.service', 'unrelated.service'], valid, true],
    [['unrelated.service'], valid, true],
    [['chunk-picker.service'], { ...valid, endsAt: new Date(now).toISOString() }, true],
    [['chunk-picker.service'], {}, true],
    [['chunk-picker.service'], undefined, true],
  ]) {
    const controlDir = await fixture(t), sent = [];
    const result = await monitor({ controlDir }, { sample: { ...sample(), writerActive: false, failed, window,
      health: { result: 'skipped', faults: ['health-skipped'] } }, now, send: async text => sent.push(text) });
    assert.equal(!!result.faults['failed-units'], aggregate);
    assert.equal(sent.join('\n').includes('CRITICAL: System services have failed'), aggregate);
    assert.equal(sent.join('\n').includes('Writer'), !releaseWindow(window, now));
    if (!aggregate) assert.equal(sent.length, 0);
  }
});

test('release-window alert audit preserves resource/job faults and every non-writer failure hook', async t => {
  const window = { startedAt: new Date(now - 60000).toISOString(), endsAt: new Date(now + 60000).toISOString() };
  const controlDir = await fixture(t), sent = [];
  const value = { ...sample(), writerActive: false, failed: ['chunk-picker.service'], window,
    diskBytes: GiB, ramBytes: GiB / 2,
    ...Object.fromEntries(['health', 'backup', 'offhost', 'operator'].map(kind => [kind, { ...sample()[kind], result: 'failed' }])) };
  const result = await monitor({ controlDir }, { sample: value, now, send: async text => sent.push(text) });
  for (const code of ['disk-low', 'ram-low', 'health-fault', 'backup-fault', 'offhost-fault', 'operator-fault']) assert(result.faults[code]);
  for (const text of ['Disk reserve', 'Available memory', 'Health recovery', 'Recovery backup', 'Off-site backup', 'operator operation'])
    assert(sent.join('\n').includes(text));
  assert(!sent.join('\n').includes('Writer')); assert(!result.faults['failed-units']);
  for (const unit of Object.keys(failureUnits).filter(unit => unit !== 'chunk-picker.service')) {
    const controlDir = await fixture(t), sent = [];
    await writeFile(path.join(controlDir, 'release-window.json'), JSON.stringify(window));
    await notifyFailure({ controlDir }, unit, { now, send: async text => sent.push(text) });
    assert.equal(sent.length, 1); assert.match(sent[0], /CRITICAL: .* service failed/);
  }
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

test('OnFailure reads the declaration and suppresses only the writer during a valid window', async t => {
  const controlDir = await fixture(t), sent = [], send = async text => sent.push(text);
  await writeFile(path.join(controlDir, 'release-window.json'), JSON.stringify({
    startedAt: new Date(now - 60000).toISOString(), endsAt: new Date(now + 60000).toISOString() }));
  await notifyFailure({ controlDir }, 'chunk-picker.service', { now, send });
  assert.equal(sent.length, 0);
  await notifyFailure({ controlDir }, 'chunk-picker-backup.service', { now, send });
  assert.match(sent.join('\n'), /CRITICAL: Backup service failed/);
  await notify({ controlDir, faults: { 'disk-low': 'urgent', 'ram-low': 'urgent' }, merge: true, now: now + 31000, send });
  assert.match(sent.at(-1), /URGENT: Disk reserve is low/);
  assert.match(sent.at(-1), /URGENT: Available memory is low/);
  assert(!sent.join('\n').includes('Writer'));
  // A suppressed failure is asserted again once the window expires.
  await notifyFailure({ controlDir }, 'chunk-picker.service', { now: now + 62000, send });
  assert.match(sent.at(-1), /CRITICAL: Writer service failed/);
});

test('OnFailure alerts for missing, expired, invalid, future, overlong and unreadable declarations', async t => {
  for (const value of [undefined, '{', 'null', '{}',
    JSON.stringify({ startedAt: new Date(now - 60000), endsAt: new Date(now) }),
    JSON.stringify({ startedAt: new Date(now + 1), endsAt: new Date(now + 60000) }),
    JSON.stringify({ startedAt: new Date(now), endsAt: new Date(now + 31 * 60000) }), 'directory']) {
    const controlDir = await fixture(t), file = path.join(controlDir, 'release-window.json'), sent = [];
    if (value === 'directory') await mkdir(file);
    else if (value !== undefined) await writeFile(file, value);
    await notifyFailure({ controlDir }, 'chunk-picker.service', { now, send: async text => sent.push(text) });
    assert.match(sent.join('\n'), /CRITICAL: Writer service failed/);
  }
});
test('dead-man errors never escape the completed job and redirects are disabled', async () => {
  assert.equal(await deadman('health', { read: async () => { throw Error(); } }), false);
  const read = async () => 'https://' + 'hc-ping.com/' + '00000000-0000-4000-8000-000000000000';
  assert.equal(await deadman('backup', { read, fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'error'); throw Error(); } }), false);
  assert.equal(await deadman('offhost', { read, fetchImpl: async () => ({ ok: true }) }), true);
});
test('whole short outage survives failed Discord and a healthy sample for every notifier category', async t => {
  const { messages } = await import('../scripts/linux/notify.mjs');
  for (const code of Object.keys(messages)) {
    const controlDir = await fixture(t), sent = [];
    await notify({ controlDir, faults: { [code]: 'critical' }, merge: true, now, send: async () => { throw Error(); } });
    await notify({ controlDir, faults: {}, now: now + 1000, send: async () => { throw Error('must rate limit'); } });
    const durable = JSON.parse(await readFile(path.join(controlDir, 'notify-state.json')));
    assert.deepEqual(durable.pending.map(row => !!row.level), [true, false]);
    await notify({ controlDir, faults: {}, now: now + 31000, send: async text => sent.push(text) });
    assert.equal(sent.length, 1); assert.match(sent[0], /CRITICAL:.*\nRECOVERED:/);
    await notify({ controlDir, faults: {}, now: now + 62000, send: async text => sent.push(text) });
    assert.equal(sent.length, 1);
  }
});
test('unavailable or partial observations preserve unresolved faults and RAM history without false recovery', async t => {
  const controlDir = await fixture(t), sent = [], send = async text => sent.push(text), value = sample();
  value.diskBytes = GiB; value.ramBytes = GiB / 2; value.offhost.result = 'failed';
  const previous = await monitor({ controlDir }, { sample: value, now, send });
  const failed = await monitor({ controlDir }, { collectSample: async () => { throw Error(); }, now: now + 31000, send });
  for (const [code, level] of Object.entries(previous.faults)) assert.equal(failed.faults[code], level);
  assert.equal(failed.lowRamSince, previous.lowRamSince); assert.equal(failed.faults['monitor-data'], 'critical');
  assert(!failed.faults['writer-inactive']); assert(!failed.faults['backup-source']); assert(!sent.join('\n').includes('RECOVERED'));
  const partial = await monitor({ controlDir }, { sample: { ...sample(), unreadable: true }, now: now + 62000, send });
  assert.equal(partial.faults['disk-low'], 'urgent'); assert(!sent.join('\n').includes('RECOVERED'));
  await monitor({ controlDir }, { sample: sample(), now: now + 93000, send });
  assert.match(sent.at(-1), /RECOVERED: Disk/); assert.match(sent.at(-1), /RECOVERED: Available memory/);
});
test('a large incident outbox drains in Discord-sized batches without dropping resolutions', async t => {
  const { messages } = await import('../scripts/linux/notify.mjs'), controlDir = await fixture(t), sent = [];
  const faults = Object.fromEntries(Object.keys(messages).map(code => [code, 'critical']));
  await notify({ controlDir, faults, now, send: async () => { throw Error(); } });
  await notify({ controlDir, faults: {}, now: now + 1000, send: async () => { throw Error(); } });
  for (let index = 1; index <= 4; index++) await notify({ controlDir, faults: {}, now: now + index * 31000,
    send: async content => { assert(content.length < 2000); sent.push(content); } });
  assert.deepEqual(JSON.parse(await readFile(path.join(controlDir, 'notify-state.json'))).pending, []);
  for (const message of Object.values(messages)) {
    assert(sent.join('\n').includes('CRITICAL: ' + message)); assert(sent.join('\n').includes('RECOVERED: ' + message));
  }
});

test('corrupt and invalid outboxes reset and deliver through both monitor and OnFailure callers', async t => {
  for (const broken of ['{', 'null', '{}', '{"active":{},"announced":{},"sent":[],"pending":[{"code":"untrusted"}]}']) {
    for (const caller of ['monitor', 'failure']) {
      const controlDir = await fixture(t), sent = [], send = async text => sent.push(text);
      await writeFile(path.join(controlDir, 'notify-state.json'), broken);
      if (caller === 'monitor') await monitor({ controlDir }, { sample: { ...sample(), writerActive: false }, now, send });
      else await notify({ controlDir, faults: { 'unit-writer': 'critical' }, merge: true, now, send });
      assert.match(sent.join('\n'), /notifier state was reset/); assert.match(sent.join('\n'), /Writer/);
      assert.equal((await readdir(controlDir)).filter(name => name.includes('.reset-')).length, 1);
      assert(!sent.join('\n').includes('untrusted'));
    }
  }
});

test('concurrent producers persist behind a busy lock, including an incident that resolves before draining', async t => {
  const controlDir = await fixture(t), sent = [], send = async text => sent.push(text);
  await exclusive(path.join(controlDir, 'notify.lock'), async () => {
    const results = await Promise.all(['unit-writer', 'unit-backup', 'unit-health', 'unit-offhost'].map(code =>
      notify({ controlDir, faults: { [code]: 'critical' }, merge: true, now, send })));
    assert(results.every(result => result.pending && !result.delivered));
    await notify({ controlDir, faults: {}, now: now + 1, send });
    assert.equal(sent.length, 0);
    assert((await readdir(path.join(controlDir, 'notify-spool'))).length > 4);
  });
  await notify({ controlDir, faults: {}, now: now + 31000, send });
  for (const message of ['Writer service', 'Backup service', 'Health service', 'Off-site service']) {
    assert(sent.join('\n').includes('CRITICAL: ' + message)); assert(sent.join('\n').includes('RECOVERED: ' + message));
  }
});

test('corrupt claimed mailboxes reset without silencing delivery and new events survive an in-flight send', async t => {
  const controlDir = await fixture(t), spool = path.join(controlDir, 'notify-spool'), sent = [];
  await mkdir(spool);
  await writeFile(path.join(spool, 'unit-backup.critical.json.claimed'), '{');
  await notify({ controlDir, faults: { 'unit-writer': 'critical' }, merge: true, now, send: async text => {
    sent.push(text);
    const result = await notify({ controlDir, faults: { 'unit-offhost': 'critical' }, merge: true, now: now + 1, send: async () => assert.fail('busy sender') });
    assert(result.pending);
  } });
  assert.match(sent[0], /notifier state was reset/);
  await notify({ controlDir, faults: {}, now: now + 31000, send: async text => sent.push(text) });
  assert(sent.join('\n').includes('CRITICAL: Off-site service failed'));
});

test('compaction retains incident evidence and newest state, caps events and bytes and reports drops', async t => {
  const events = Array.from({ length: 1000 }, (_, at) => ({ code: 'disk-low', ...(at % 2 ? {} : { level: 'urgent' }), at }));
  const result = compact(events);
  assert.equal(result.pending.length, 2); assert.equal(result.dropped, 998);
  assert(result.pending[0].level); assert(!result.pending.at(-1).level);
  const constrained = compact([...events, { code: 'unit-writer', level: 'critical', at: 1001 },
    { code: 'ram-low', level: 'warning', at: 1002 }], 0, { events: 2, bytes: 256 });
  assert.deepEqual(constrained.pending.map(row => row.code), ['unit-writer', 'ram-low']);
  assert(Buffer.byteLength(JSON.stringify(constrained)) <= 256);
  const controlDir = await fixture(t), sent = [];
  await writeFile(path.join(controlDir, 'notify-state.json'), JSON.stringify({ active: {}, announced: {}, sent: [], pending: events }));
  await notify({ controlDir, faults: {}, now, send: async text => sent.push(text) });
  assert.match(sent[0], /998 alerts were dropped/);
  const state = JSON.parse(await readFile(path.join(controlDir, 'notify-state.json')));
  assert(state.pending.length <= outboxLimits.events); assert(Buffer.byteLength(JSON.stringify(state.pending)) < outboxLimits.bytes);
  assert(Buffer.byteLength(JSON.stringify(state)) < outboxLimits.stateBytes);
});
