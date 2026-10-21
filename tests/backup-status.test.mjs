import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readBackupStatus } from '../app/storage/backup-status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const now = Date.parse('2026-10-11T12:00:00Z');
const success = { lastRunAt: '2026-10-11T10:00:00.000Z', result: 'success', byteSize: 125,
  lastSuccessAt: '2026-10-11T10:00:00.000Z' };

async function fixture(t) {
  await mkdir(local, { recursive: true });
  const dir = await mkdtemp(path.join(local, 'backup-test-'));
  const dataDir = path.join(dir, '.local', 'duo');
  await mkdir(dataDir, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(dir), local);
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, dataDir, metadata: path.dirname(dataDir),
    async write(name, value) { await writeFile(path.join(path.dirname(dataDir), name), typeof value === 'string' ? value : JSON.stringify(value)); } };
}

test('status exposes a strict allowlist and treats exactly two days as fresh', async t => {
  const f = await fixture(t);
  await f.write('backup-destination', 'C:\\private\\destination\n');
  await f.write('backup-status.json', { ...success, fileName: 'private.zip', revision: 800,
    token: 'private-token', contents: { private: true }, destination: 'private-path' });
  assert.deepEqual(await readBackupStatus(f.dataDir, { now }), { ...success, warning: null });
  const output = JSON.stringify(await readBackupStatus(f.dataDir, { now }));
  assert.ok(!/private|revision|fileName|contents|destination|token/.test(output));
  assert.equal((await readBackupStatus(f.dataDir, { now: Date.parse(success.lastSuccessAt) + 172800000 })).warning, null);
  assert.equal((await readBackupStatus(f.dataDir, { now: Date.parse(success.lastSuccessAt) + 172800001 })).warning, 'stale');
});

test('failure retains last success and takes warning precedence over absent destination', async t => {
  const f = await fixture(t);
  await f.write('backup-status.json', { ...success, result: 'failed', lastRunAt: '2026-10-11T11:00:00Z', byteSize: null });
  const status = await readBackupStatus(f.dataDir, { now });
  assert.equal(status.warning, 'failed');
  assert.equal(status.lastSuccessAt, success.lastSuccessAt);
  assert.equal(status.byteSize, null);
});

test('missing, blank, oversized configuration and absent runs produce sensible notices', async t => {
  const f = await fixture(t);
  assert.equal((await readBackupStatus(f.dataDir, { now })).warning, 'not-configured');
  await f.write('backup-destination', ' \n');
  assert.equal((await readBackupStatus(f.dataDir, { now })).warning, 'not-configured');
  await f.write('backup-destination', 'x'.repeat(4097));
  assert.equal((await readBackupStatus(f.dataDir, { now })).warning, 'not-configured');
  await f.write('backup-destination', 'configured');
  assert.deepEqual(await readBackupStatus(f.dataDir, { now }), {
    lastRunAt: null, result: 'never', byteSize: null, lastSuccessAt: null, warning: 'not-run' });
});

test('malformed or oversized status fails safely without leaking metadata or hiding behind legacy log', async t => {
  const f = await fixture(t);
  await f.write('backup-destination', 'configured');
  await f.write('backup.log', '2026-10-11T10:00:00 Saved rs3-chunk-picker-2026-10-11.zip (12 KB, revision 9).');
  for (const value of ['broken private token', 'x'.repeat(16385), {},
    { ...success, result: 'private' }, { ...success, lastRunAt: 'invalid' },
    { ...success, lastSuccessAt: '2026-10-12T10:00:00Z' }]) {
    await f.write('backup-status.json', value);
    assert.deepEqual(await readBackupStatus(f.dataDir, { now }), {
      lastRunAt: null, result: 'unknown', byteSize: null, lastSuccessAt: null, warning: 'unavailable' });
  }
  await f.write('backup-status.json', { ...success, byteSize: 'secret' });
  assert.equal((await readBackupStatus(f.dataDir, { now })).byteSize, null);
});

test('bounded legacy fallback extracts only dated outcome, time and approximate size', async t => {
  const f = await fixture(t);
  await f.write('backup-destination', 'configured');
  await f.write('backup.log', 'private '.repeat(10000) + '\n2026-10-11T10:00:00 Saved rs3-chunk-picker-2026-10-11.zip (12 KB, revision 9).\n2026-10-11T11:00:00 Backup failed: Bearer private-token C:\\private\\path');
  const status = await readBackupStatus(f.dataDir, { now });
  assert.equal(status.result, 'failed');
  assert.equal(status.warning, 'failed');
  assert.ok(status.lastSuccessAt);
  assert.equal(status.byteSize, null);
  assert.ok(!JSON.stringify(status).includes('private'));
  assert.equal((await readBackupStatus(f.dataDir, { now, legacyLog: false })).result, 'never');
});

test('first recorded failure recovers only an earlier legacy success without replacing its outcome', async t => {
  const f = await fixture(t);
  await f.write('backup-destination', 'configured');
  await f.write('backup-status.json', { lastRunAt: '2026-10-11T11:00:00.000Z', result: 'failed', byteSize: null, lastSuccessAt: null });
  await f.write('backup.log', [
    '2026-10-09T10:00:00 Saved rs3-chunk-picker-2026-10-09.zip (12 KB, revision 9).',
    '2026-10-10T10:00:00 Saved rs3-chunk-picker-2026-10-10.zip (13 KB, revision 10).',
    '2026-10-11T11:00:00 Saved rs3-chunk-picker-2026-10-11.zip (14 KB, revision 11).',
    '2026-10-11T12:00:00 Saved rs3-chunk-picker-2026-10-11.zip (15 KB, revision 12).',
    '2026-10-11T12:00:01 Backup failed: private-token private-path',
  ].join('\n'));
  const status = await readBackupStatus(f.dataDir, { now });
  assert.equal(status.result, 'failed');
  assert.equal(status.lastRunAt, '2026-10-11T11:00:00.000Z');
  assert.equal(status.byteSize, null);
  assert.equal(status.warning, 'failed');
  assert.equal(Date.parse(status.lastSuccessAt), Date.parse('2026-10-10T10:00:00'));
  assert.equal((await readBackupStatus(f.dataDir, { now, legacyLog: false })).lastSuccessAt, null);
  await f.write('backup.log', '2026-10-11T12:00:00 Saved rs3-chunk-picker-2026-10-11.zip (15 KB, revision 12).');
  assert.equal((await readBackupStatus(f.dataDir, { now })).lastSuccessAt, null);
});

