import path from 'node:path';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomic, directory, encode, exclusive, exists, json, outside, sha } from './files.mjs';
import { operatorSettings, readRelease } from './runtime.mjs';
import { verifyBackup } from './recovery.mjs';
import { recoveryBundle } from './recovery-bundle.mjs';
import { deadman, recordStatus, withStatus } from './ops-status.mjs';
import { resticRunner } from './restic.mjs';

export async function pauseOffhost(settings, paused) {
  return exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
    const file = path.join(settings.controlDir, 'offhost-paused.json');
    if (paused) await atomic(file, encode({ format: 'picker-offhost-pause-v1', startedAt: new Date().toISOString() }));
    else await rm(file, { force: true }); // Explicit resume removes only this declaration.
  });
}

export async function selectSnapshot(backupDir, now = Date.now()) {
  const candidates = [];
  for (const name of await readdir(backupDir)) {
    if (!/^recovery-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(name)) continue;
    const backup = path.join(backupDir, name);
    try {
      const manifest = await verifyBackup(backup), time = Date.parse(manifest.snapshotAt);
      // Old completion timestamps cannot prove when a snapshot was captured.
      if (Number.isFinite(time) && time <= now + 60000) candidates.push({ backup, manifest, time });
    } catch {} // An incomplete or corrupt directory is never uploaded.
  }
  candidates.sort((a, b) => b.time - a.time);
  if (!candidates.length) throw Error('No complete timestamped snapshot.');
  return candidates[0];
}
export async function offhostBackup({ settings, config, run, bundle = recoveryBundle, releaseReader = readRelease,
  ping = deadman, now = () => Date.now() }) {
  await directory(settings.controlDir);
  // The same exclusion covers selection, verification, bundle and all restic
  // reads. Local snapshot pruning and release switching cannot race this job.
  return exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
    if (await exists(path.join(settings.controlDir, 'offhost-paused.json'))) return { skipped: true };
    return withStatus(settings.controlDir, 'offhost', async () => {
    if (settings.multiPicker) throw Error('Service snapshot format needs a separate off-site adapter.');
    for (const name of ['maintenance.json', 'activation.json', 'tools-transaction.json'])
      if (await exists(path.join(settings.controlDir, name))) throw Error('Operation evidence requires reconciliation.');
    const selected = await selectSnapshot(settings.backupDir, now());
    const release = await releaseReader(settings.current, settings.dataDir);
    if (selected.manifest.releasePointerSha256 !== sha(release.pointerBytes)) throw Error('Snapshot needs the selected release; take a fresh backup.');
    outside(settings.backupDir, settings.scratchRoot); outside(settings.dataDir, settings.scratchRoot);
    await directory(settings.scratchRoot);
    const scratch = await mkdtemp(path.join(settings.scratchRoot, 'offhost-'));
    try {
      const recovery = path.join(scratch, 'rebuild');
      await bundle({ settings, release, output: recovery });
      run ??= await resticRunner(config);
      const stdout = await run(['backup', '--json', '--host', 'picker-vps', '--tag', 'chunk-picker',
        '--time', new Date(selected.time).toISOString().slice(0, 19).replace('T', ' '), selected.backup, recovery]);
      const summary = stdout.trim().split('\n').map(row => JSON.parse(row)).find(row => row.message_type === 'summary');
      if (!/^[a-f0-9]{8,64}$/.test(summary?.snapshot_id ?? '')) throw Error('Missing upload receipt.');
      // Scheduled runs only upload/read/check; initialization is explicit.
      await run(['check']);
      const snapshots = JSON.parse(await run(['snapshots', '--json', summary.snapshot_id]));
      if (snapshots.length !== 1 || !snapshots[0].id?.startsWith(summary.snapshot_id)
        || !Number.isFinite(Date.parse(snapshots[0].time))
        || Math.abs(Date.parse(snapshots[0].time) - selected.time) >= 1000) throw Error('Upload snapshot time differs.');
      await verifyBackup(selected.backup);
      await recordStatus(settings.controlDir, 'offhost', { result: 'success', snapshotAt: new Date(selected.time).toISOString() }, now());
      try { await ping('offhost'); } catch {} // Test adapters obey the same non-fatal boundary.
      return { uploaded: true };
    } finally {
      // Only our newly created scratch, never a source snapshot or remote copy.
      await rm(scratch, { recursive: true, force: true });
    }
    });
  }, { skipBusy: true, maxBusyMs: 1800000 });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const settings = await operatorSettings(), config = await json('/etc/chunk-picker/offhost.json');
    if (config.controlDir !== settings.controlDir) throw Error();
    if (['pause', 'resume'].includes(process.argv[2])) await pauseOffhost(settings, process.argv[2] === 'pause');
    else if (process.argv[2] === 'paused') process.stdout.write(encode({ paused: await exists(path.join(settings.controlDir, 'offhost-paused.json')) }));
    else if (process.argv[2] === 'init') {
      await exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
        const run = await resticRunner(config); await run(['init', '--repository-version', '2']);
      });
    } else {
      if (process.argv[2]) throw Error();
      await offhostBackup({ settings, config });
    }
  } catch { process.stderr.write('Off-site backup failed; existing restore points retained.\n'); process.exitCode = 1; }
}
