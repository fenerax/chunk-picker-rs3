import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { offhostFixture } from './helpers/offhost.mjs';
import { offhostBackup } from '../scripts/linux/offhost-backup.mjs';
import { verifyBackup } from '../scripts/linux/recovery.mjs';
import { retentionArgs, verifyRestic } from '../scripts/linux/restic.mjs';
const execute = promisify(execFile);
test('real pinned restic encrypts, checks, restores the full snapshot and rebuild bundle, then prunes locally', { skip: process.platform !== 'linux' }, async t => {
  await verifyRestic(); // CI installs the reviewed binary; absence is a failure.
  const f = await offhostFixture(t), local = path.join(f.dir, 'local'); await mkdir(local);
  const password = path.join(local, 'password'); await writeFile(password, 'synthetic-local-repository-only', { mode: 0o600 });
  const env = { PATH: '/usr/bin:/bin', HOME: local, TZ: 'UTC', RESTIC_REPOSITORY: path.join(local, 'repository'),
    RESTIC_PASSWORD_FILE: password, RESTIC_CACHE_DIR: path.join(local, 'cache') };
  const run = async args => (await execute('/usr/local/bin/restic', ['--no-lock', ...args], { env, maxBuffer: 4 * 1024 ** 2, timeout: 120000 })).stdout;
  await run(['init']); await offhostBackup({ ...f, config: {}, run, ping: async () => false });
  await run(['check', '--read-data']);
  const snapshots = JSON.parse(await run(['snapshots', '--json'])); assert.equal(snapshots.length, 1);
  assert(Math.abs(Date.parse(snapshots[0].time) - Date.parse(f.snapshotAt)) < 1000);
  const restored = path.join(local, 'restored'); await run(['restore', 'latest', '--target', restored]);
  await verifyBackup(path.join(restored, f.backup.slice(1)));
  const { inventory, json, encode } = await import('../scripts/linux/files.mjs');
  const rebuild = path.join(restored, snapshots[0].paths.find(file => path.basename(file) === 'rebuild').slice(1));
  const manifest = await json(path.join(rebuild, 'rebuild-manifest.json'));
  assert.equal(encode((await inventory(rebuild)).filter(row => row.path !== 'rebuild-manifest.json')), encode(manifest.files));
  await run([...retentionArgs]); await run(['check', '--read-data']);
  assert.equal(JSON.parse(await run(['snapshots', '--json'])).length, 1);
});
