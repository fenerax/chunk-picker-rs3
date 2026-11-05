import { isMain } from '../release/vps/entrypoint.mjs';
import path from 'node:path';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { atomic, copyTree, directory, encode, exclusive, exists, json, outside, sha } from './files.mjs';
import { operatorSettings, readRelease } from './runtime.mjs';
import { verifyBackup } from './recovery.mjs';
import { recoveryBundle } from './recovery-bundle.mjs';
import { stagingBudget } from './staging.mjs';
import { deadman, recordStatus, withStatus } from './ops-status.mjs';
import { resticRunner } from './restic.mjs';

export async function pauseOffhost(settings, paused, repository) {
  return exclusive(path.join(settings.controlDir, 'offhost.lock'), async () => {
    const file = path.join(settings.controlDir, 'offhost-paused.json');
    if (paused) {
      if (!/^b2:[a-z0-9][a-z0-9-]{5,49}:chunk-picker$/.test(repository ?? '')) throw Error('Repository identity required.');
      await atomic(file, encode({ format: 'picker-offhost-pause-v1', repository, startedAt: new Date().toISOString() }));
    } else await rm(file, { force: true });
  });
}
export async function pausedOffhost(settings, repository) {
  return exclusive(path.join(settings.controlDir, 'offhost.lock'), async () => {
    const file = path.join(settings.controlDir, 'offhost-paused.json');
    const marker = await exists(file) ? await json(file) : null;
    return { paused: marker?.format === 'picker-offhost-pause-v1' && marker.repository === repository, repository };
  });
}
export async function selectSnapshot(backupDir, now = Date.now()) {
  const candidates = [];
  for (const name of await readdir(backupDir)) {
    if (!/^recovery-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(name)) continue;
    const backup = path.join(backupDir, name);
    try {
      const manifest = await verifyBackup(backup), time = Date.parse(manifest.snapshotAt);
      if (Number.isFinite(time) && time <= now + 60000) candidates.push({ backup, manifest, time });
    } catch {} // Incomplete, corrupt and legacy snapshots are never delivered.
  }
  candidates.sort((a, b) => b.time - a.time);
  if (!candidates.length) throw Error('No complete timestamped snapshot.');
  return candidates[0];
}
export async function offhostBackup({ settings, config, run, bundle = recoveryBundle, releaseReader = readRelease,
  ping = deadman, now = () => Date.now(), deadlineMs = 30 * 60000, budgetOptions }) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30 * 60000) throw Error('Invalid off-site deadline.');
  const signal = AbortSignal.timeout(deadlineMs);
  await directory(settings.controlDir);
  return exclusive(path.join(settings.controlDir, 'offhost.lock'), async () => {
    if (await exists(path.join(settings.controlDir, 'offhost-paused.json'))) return { skipped: true };
    return withStatus(settings.controlDir, 'offhost', async () => {
      let scratch;
      try {
        const staged = await exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
          if (settings.multiPicker) throw Error('Service snapshot format needs a separate off-site adapter.');
          for (const name of ['maintenance.json', 'activation.json', 'tools-transaction.json'])
            if (await exists(path.join(settings.controlDir, name))) throw Error('Operation evidence requires reconciliation.');
          const selected = await selectSnapshot(settings.backupDir, now());
          const release = await releaseReader(settings.current, settings.dataDir);
          if (selected.manifest.releasePointerSha256 !== sha(release.pointerBytes)) throw Error('Snapshot needs the selected release; take a fresh backup.');
          outside(settings.backupDir, settings.scratchRoot); outside(settings.dataDir, settings.scratchRoot);
          await directory(settings.scratchRoot);
          const options = { ...budgetOptions, signal }, { budget, copy } = stagingBudget(settings.scratchRoot, settings.minFreeBytes, options);
          await budget(selected.manifest.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0));
          scratch = await mkdtemp(path.join(settings.scratchRoot, 'offhost-'));
          const backup = path.join(scratch, 'snapshot'), recovery = path.join(scratch, 'rebuild');
          await copyTree(selected.backup, backup, { copy });
          await verifyBackup(backup);
          await bundle({ settings, release, output: recovery, budgetOptions: options });
          signal.throwIfAborted();
          return { backup, recovery, time: selected.time };
        }, { skipBusy: true, maxBusyMs: 1800000 });
        if (staged.skipped) return staged;
        // No live paths or operator lock survive into the network phase.
        run ??= await resticRunner(config, { signal, settings });
        const repository = async args => { signal.throwIfAborted(); const result = await run(args, { signal }); signal.throwIfAborted(); return result; };
        const stdout = await repository(['backup', '--json', '--host', 'picker-vps', '--tag', 'chunk-picker',
          '--time', new Date(staged.time).toISOString().slice(0, 19).replace('T', ' '), staged.backup, staged.recovery]);
        const summary = stdout.trim().split('\n').map(row => JSON.parse(row)).find(row => row.message_type === 'summary');
        if (!/^[a-f0-9]{8,64}$/.test(summary?.snapshot_id ?? '')) throw Error('Missing upload receipt.');
        await repository(['check']);
        const snapshots = JSON.parse(await repository(['snapshots', '--json', summary.snapshot_id]));
        if (snapshots.length !== 1 || !snapshots[0].id?.startsWith(summary.snapshot_id)
          || !Number.isFinite(Date.parse(snapshots[0].time))
          || Math.abs(Date.parse(snapshots[0].time) - staged.time) >= 1000) throw Error('Upload snapshot time differs.');
        await verifyBackup(staged.backup);
        await recordStatus(settings.controlDir, 'offhost', { result: 'success', snapshotAt: new Date(staged.time).toISOString() }, now());
        try { await ping('offhost'); } catch {}
        return { uploaded: true };
      } finally {
        // Only this job's private immutable copy, never a source or remote point.
        if (scratch) await rm(scratch, { recursive: true, force: true });
      }
    });
  }, { skipBusy: true, maxBusyMs: 1800000 });
}
if (isMain(import.meta.url)) {
  try {
    const settings = await operatorSettings(), config = await json('/etc/chunk-picker/offhost.json');
    if (config.controlDir !== settings.controlDir) throw Error();
    if (['pause', 'resume'].includes(process.argv[2])) await pauseOffhost(settings, process.argv[2] === 'pause', config.repository);
    else if (process.argv[2] === 'paused') process.stdout.write(encode(await pausedOffhost(settings, config.repository)));
    else if (process.argv[2] === 'init') {
      await exclusive(path.join(settings.controlDir, 'offhost.lock'), async () => {
        const run = await resticRunner(config, { settings, signal: AbortSignal.timeout(30 * 60000) }); await run(['init', '--repository-version', '2']);
      });
    } else {
      if (process.argv[2]) throw Error();
      await offhostBackup({ settings, config });
    }
  } catch { process.stderr.write('Off-site backup failed; existing restore points retained.\n'); process.exitCode = 1; }
}
