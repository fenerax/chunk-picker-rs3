import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { encode, exclusive, inventory, json, sha } from '../scripts/linux/files.mjs';
import { offhostBackup, pauseOffhost, selectSnapshot } from '../scripts/linux/offhost-backup.mjs';
import { recoveryBundle, recoveryUnits } from '../scripts/linux/recovery-bundle.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { retentionArgs, resticArgs } from '../scripts/linux/restic.mjs';
import { lifecycle, uploadCapabilities, cleanupCapabilities, protectedBucket } from '../scripts/ops/setup-b2.mjs';
import { offhostFixture as fixture, assertPayloadClosure } from './helpers/offhost.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { backupStopped, verifyBackup } from '../scripts/linux/recovery.mjs';
import { stagingBudget } from '../scripts/linux/staging.mjs';
test('uploads immutable verified staging without operator lock; freshness remains capture time', async t => {
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
    assert.deepEqual(await offhostBackup({ ...f, config: {} }), { skipped: true });
  });
  await exclusive(path.join(f.settings.controlDir, 'offhost.lock'), async () => {
    await assert.rejects(pauseOffhost(f.settings, true, 'b2:synthetic-backups:chunk-picker'), /busy/);
  });
  await pauseOffhost(f.settings, true, 'b2:synthetic-backups:chunk-picker'); await writeFile(marker, '{}');
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
  const restored = path.join(f.dir, 'restored'); await cp(output, restored, { recursive: true }); await assertPayloadClosure(restored);
  assert(bundle.files.some(row => row.path === 'etc/synthetic-secret')); assert(bundle.files.some(row => row.path === 'release/core/app.mjs'));
  assert(bundle.files.some(row => row.path === 'tools/tool.mjs')); assert.equal(bundle.files.filter(row => row.path.startsWith('units/')).length, recoveryUnits.length);
  await assert.rejects(recoveryBundle({ ...f, release: { ...release, pointer: { config: { path: path.join(f.dir, 'outside/config.json') } } }, output: path.join(f.dir, 'bad') }), /allowlist/);
});

test('every pack and addon payload must exist and match its pin before upload', async t => {
  const f = await fixture(t);
  for (const name of ['data', 'art', 'rules', 'addons']) {
    const file = path.join(f.roots.packs, name, 'payload/second.json'), bytes = await readFile(file);
    await rm(file); await assert.rejects(offhostBackup({ ...f, config: {} })); assert.equal(f.calls.length, 0);
    await writeFile(file, 'corrupt'); await assert.rejects(offhostBackup({ ...f, config: {} }), /pin/);
    await writeFile(file, bytes);
  }
});
test('writer gate and real local backup succeed while upload is blocked; source pruning cannot affect upload', async t => {
  const f = await fixture(t), release = await readRelease(f.settings.current, f.settings.dataDir);
  await cp(path.join(f.backup, 'store'), f.settings.dataDir, { recursive: true });
  await cp(path.join(f.backup, 'store.dataset.json'), f.settings.dataDir + '.dataset.json');
  let unblock, began;
  const waiting = new Promise(resolve => { began = resolve; }), blocked = new Promise(resolve => { unblock = resolve; });
  const uploading = offhostBackup({ ...f, config: {}, run: async args => {
    if (args[0] === 'backup') {
      began(); await blocked;
      await verifyBackup(args.at(-2)); await assertPayloadClosure(args.at(-1));
    }
    return f.run(args);
  } });
  try {
    await waiting; await checkStart(f.settings);
    const backup = await exclusive(path.join(f.settings.controlDir, 'operation.lock'), () => backupStopped({ ...f.settings, release, keep: 30,
      probe: async (_release, _data, output) => writeFile(output, encode({ format: 'rs3-chunk-picker', state: { members: [{}] } })) }));
    await verifyBackup(backup.target);
    await rm(f.backup, { recursive: true, force: true });
    await assert.rejects(pauseOffhost(f.settings, true, 'b2:synthetic-backups:chunk-picker'), /busy/);
  } finally { unblock(); }
  assert.deepEqual(await uploading, { uploaded: true });
});
test('staging preflight and per-write budgets use the destination filesystem and preserve reserve', async t => {
  const f = await fixture(t);
  f.settings.minFreeBytes = Number.MAX_SAFE_INTEGER;
  await assert.rejects(offhostBackup({ ...f, config: {} }), /free space/); assert.equal(f.calls.length, 0);
  assert.equal((await readdir(f.settings.scratchRoot)).length, 0);
  const release = await readRelease(f.settings.current, f.settings.dataDir), output = path.join(f.dir, 'too-large');
  await assert.rejects(recoveryBundle({ ...f, release, output }), /free space/);
  let calls = 0;
  const source = path.join(f.dir, 'large'); await writeFile(source, Buffer.alloc(3 * 1024 ** 2));
  const { copy } = stagingBudget(f.dir, 1234, { check: async (root, _bytes, reserve) => {
    assert.equal(root, f.dir); assert.equal(reserve, 1234); if (++calls === 3) throw Error('reserve crossed');
  } });
  await assert.rejects(copy(source, path.join(f.dir, 'partial')), /reserve crossed/); assert.equal(calls, 3);
});
test('overall deadline aborts network work and releases both locks', async t => {
  const f = await fixture(t);
  await assert.rejects(offhostBackup({ ...f, config: {}, deadlineMs: 500, run: async (_args, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 10000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  } }));
  await checkStart(f.settings);
  await exclusive(path.join(f.settings.controlDir, 'offhost.lock'), async () => {});
  const unit = await readFile(new URL('../scripts/linux/systemd/chunk-picker-offhost.service', import.meta.url), 'utf8');
  assert.match(unit, /TimeoutStartSec=35min/); assert.match(unit, /TimeoutStopSec=30s/); assert(!unit.includes('infinity'));
});
test('retention is 30 daily, 8 weekly, 12 monthly; no-delete client cannot destroy young B2 versions (simulation)', () => {
  assert.deepEqual(retentionArgs.slice(-7), ['--keep-daily', '30', '--keep-weekly', '8', '--keep-monthly', '12', '--prune']);
  assert(!uploadCapabilities.includes('deleteFiles')); assert(cleanupCapabilities.includes('deleteFiles'));
  for (const command of ['backup', 'init', 'forget']) assert.deepEqual(resticArgs([command]), ['--no-cache', command]);
  for (const command of ['check', 'snapshots', 'restore']) assert.deepEqual(resticArgs([command]), ['--no-cache', '--no-lock', command]);
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
