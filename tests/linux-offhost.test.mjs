import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { encode, exclusive, inventory, json, sha } from '../scripts/linux/files.mjs';
import { offhostBackup, pauseOffhost, selectSnapshot } from '../scripts/linux/offhost-backup.mjs';
import { recoveryBundle, recoveryUnits } from '../scripts/linux/recovery-bundle.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { retentionArgs } from '../scripts/linux/restic.mjs';
import { lifecycle, uploadCapabilities, cleanupCapabilities, protectedBucket } from '../scripts/ops/setup-b2.mjs';
import { offhostFixture as fixture } from './helpers/offhost.mjs';
test('uploads verified snapshot and full allowlisted rebuild under operator lock; freshness remains capture time', async t => {
  const f = await fixture(t); let pinged = false;
  await offhostBackup({ ...f, config: {}, ping: async () => { pinged = true; throw Error(); } });
  const status = await json(path.join(f.settings.controlDir, 'offhost-status.json'));
  assert.equal(status.result, 'success'); assert.equal(status.snapshotAt, f.snapshotAt); assert(pinged);
  assert(Date.parse(status.lastSuccessAt) - Date.parse(status.snapshotAt) >= 48 * 3600000);
  assert.deepEqual(f.calls.map(args => args[0]), ['backup', 'check', 'snapshots']);
  assert.equal(f.calls[0][f.calls[0].indexOf('--time') + 1], f.snapshotAt.slice(0, 19).replace('T', ' '));
  assert.equal((await readdir(f.settings.scratchRoot)).length, 0);
});
test('failed upload or check preserves source and all existing remote restore points and reports failure', async t => {
  const f = await fixture(t), remote = ['existing-restore-point'];
  await offhostBackup({ ...f, config: {}, ping: async () => false });
  const success = await json(path.join(f.settings.controlDir, 'offhost-status.json'));
  for (const fail of ['backup', 'check']) {
    await assert.rejects(offhostBackup({ ...f, config: {}, run: async args => {
      assert(!['forget', 'prune', 'delete', 'unlock'].includes(args[0])); if (args[0] === fail) throw Error('synthetic'); return f.run(args);
    } }));
    assert.deepEqual(remote, ['existing-restore-point']); assert((await selectSnapshot(f.settings.backupDir)).backup === f.backup);
    assert.equal((await json(path.join(f.settings.controlDir, 'offhost-status.json'))).result, 'failed');
    assert.equal((await json(path.join(f.settings.controlDir, 'offhost-status.json'))).lastSuccessAt, success.lastSuccessAt);
  }
});
test('trusted cleanup pause is serialized with uploads, fences retries and direct calls, and resumes explicitly', async t => {
  const f = await fixture(t), marker = path.join(f.settings.controlDir, 'maintenance.json');
  await exclusive(path.join(f.settings.controlDir, 'operation.lock'), async () => {
    await assert.rejects(pauseOffhost(f.settings, true), /busy/);
    assert.deepEqual(await offhostBackup({ ...f, config: {} }), { skipped: true });
  });
  await pauseOffhost(f.settings, true); await writeFile(marker, '{}');
  assert.deepEqual(await offhostBackup({ ...f, config: {} }), { skipped: true }); assert.equal(f.calls.length, 0);
  await pauseOffhost(f.settings, false); assert.deepEqual(await json(marker), {});
  await assert.rejects(offhostBackup({ ...f, config: {} }), /evidence/);
});
test('incomplete, corrupted, future, legacy and release-mismatched snapshots cannot be delivered', async t => {
  const f = await fixture(t), file = path.join(f.backup, 'manifest.json');
  for (const snapshotAt of [undefined, 'invalid', new Date(Date.now() + 86400000).toISOString()]) {
    await writeFile(file, encode({ ...f.manifest, snapshotAt })); await assert.rejects(selectSnapshot(f.settings.backupDir));
  }
  await writeFile(file, encode({ ...f.manifest, releasePointerSha256: 'b'.repeat(64) }));
  await assert.rejects(offhostBackup({ ...f, config: {} }), /selected release/); assert.equal(f.calls.length, 0);
  await writeFile(file, encode(f.manifest)); await writeFile(path.join(f.backup, 'store/state.json'), 'corrupt');
  await assert.rejects(selectSnapshot(f.settings.backupDir));
});
test('newest source is chosen by snapshot time, independent of directory or delivery order', async t => {
  const f = await fixture(t), other = path.join(f.settings.backupDir, 'recovery-20261106T120000000Z-00000000-0000-4000-8000-000000000000');
  const { cp } = await import('node:fs/promises'); await cp(f.backup, other, { recursive: true });
  await writeFile(path.join(other, 'manifest.json'), encode({ ...f.manifest, snapshotAt: new Date(Date.parse(f.snapshotAt) - 86400000).toISOString() }));
  assert.equal((await selectSnapshot(f.settings.backupDir)).backup, f.backup);
});
test('rebuild inventory contains encrypted-repository secrets, units, tools, release and pins; escapes refuse', async t => {
  const f = await fixture(t), output = path.join(f.dir, 'rebuild'), release = await readRelease(f.settings.current, f.settings.dataDir);
  const bundle = await recoveryBundle({ ...f, release, output });
  assert(bundle.files.some(row => row.path === 'etc/synthetic-secret')); assert(bundle.files.some(row => row.path === 'release/core/app.mjs'));
  assert(bundle.files.some(row => row.path === 'tools/tool.mjs')); assert.equal(bundle.files.filter(row => row.path.startsWith('units/')).length, recoveryUnits.length);
  await assert.rejects(recoveryBundle({ ...f, release: { ...release, pointer: { config: { path: path.join(f.dir, 'outside/config.json') } } }, output: path.join(f.dir, 'bad') }), /allowlist/);
});
test('retention is 30 daily, 8 weekly, 12 monthly; no-delete client cannot destroy young B2 versions (simulation)', () => {
  assert.deepEqual(retentionArgs.slice(-7), ['--keep-daily', '30', '--keep-weekly', '8', '--keep-monthly', '12', '--prune']);
  assert(!uploadCapabilities.includes('deleteFiles')); assert(cleanupCapabilities.includes('deleteFiles'));
  protectedBucket({ bucketType: 'allPrivate', lifecycleRules: lifecycle });
  assert.throws(() => protectedBucket({ bucketType: 'allPrivate', lifecycleRules: [{ ...lifecycle[0], daysFromHidingToDeleting: 1 }] }));
  // Native B2 Remove: Delete returns 401 without deleteFiles; restic falls
  // back to Hide. Overwrites/hides preserve previous versions for 31 days.
  const versions = [{ value: 'original-pack', uploaded: -200, hiddenAt: null }];
  const remove = (capabilities, day) => {
    if (capabilities.includes('deleteFiles')) versions.pop(); else versions.at(-1).hiddenAt = day;
  };
  remove(uploadCapabilities, 0); versions.push({ value: 'malicious-overwrite', uploaded: 1, hiddenAt: null }); remove(uploadCapabilities, 1);
  const lifecycleAt = day => versions.filter(row => row.hiddenAt === null || day - row.hiddenAt < 31);
  assert(lifecycleAt(30).some(row => row.value === 'original-pack')); assert(!lifecycleAt(31).some(row => row.value === 'original-pack'));
  assert.throws(() => { if (!uploadCapabilities.includes('writeBuckets')) throw Error('Denied'); });
});
