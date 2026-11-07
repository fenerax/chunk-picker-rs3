import { isMain } from '../release/vps/entrypoint.mjs';
import path from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { atomic, copyTree, directory, encode, exclusive, exists, json, noLinks, outside, sha } from './files.mjs';
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
  // The PC prune handshake must also prove the independent reader has drained.
  return exclusive(path.join(settings.controlDir, 'offhost.lock'), () =>
    exclusive(path.join(settings.controlDir, 'offhost-check.lock'), async () => {
      const file = path.join(settings.controlDir, 'offhost-paused.json');
      const marker = await exists(file) ? await json(file) : null;
      return { paused: marker?.format === 'picker-offhost-pause-v1' && marker.repository === repository, repository };
    }));
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
async function reclaimScratch(settings, name) {
  for (const source of [settings.backupDir, settings.dataDir, settings.controlDir]) outside(source, settings.scratchRoot);
  await directory(settings.scratchRoot);
  const target = path.join(settings.scratchRoot, name);
  for (const source of [settings.backupDir, settings.dataDir, settings.controlDir]) outside(target, source);
  if (await exists(target)) { await noLinks(target); await rm(target, { recursive: true, force: true }); }
  return target;
}
export async function offhostBackup({ settings, config, run, bundle = recoveryBundle, releaseReader = readRelease,
  ping = deadman, now = () => Date.now(), deadlineMs = 30 * 60000, deadlineSignal = AbortSignal.timeout, budgetOptions,
  log = message => process.stderr.write(message + '\n') }) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30 * 60000) throw Error('Invalid off-site deadline.');
  const signal = deadlineSignal(deadlineMs);
  await directory(settings.controlDir);
  const skipped = async reason => {
    // Do not overwrite the status of another upload that owns offhost.lock.
    await atomic(path.join(settings.controlDir, 'offhost-last-skip.json'), encode({ result: 'skipped', reason, at: new Date(now()).toISOString() }));
    log(`Off-site backup skipped: ${reason}.`);
    return { skipped: true, reason };
  };
  const result = await exclusive(path.join(settings.controlDir, 'offhost.lock'), async () => {
    if (await exists(path.join(settings.controlDir, 'offhost-paused.json'))) return skipped('paused');
    return withStatus(settings.controlDir, 'offhost', async () => {
      let scratch, verification;
      try {
        const selected = await exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
          if (settings.multiPicker) throw Error('Service snapshot format needs a separate off-site adapter.');
          for (const name of ['maintenance.json', 'activation.json', 'tools-transaction.json'])
            if (await exists(path.join(settings.controlDir, name))) throw Error('Operation evidence requires reconciliation.');
          const selected = await selectSnapshot(settings.backupDir, now());
          const release = await releaseReader(settings.current, settings.dataDir);
          if (selected.manifest.releasePointerSha256 !== sha(release.pointerBytes)) throw Error('Snapshot needs the selected release; take a fresh backup.');
          // Both namespaces belong to offhost.lock. Reclaim crash remnants
          // before any allocation admission, including a previous restore.
          const stage = await reclaimScratch(settings, 'offhost-stage');
          const verify = await reclaimScratch(settings, 'offhost-verify');
          return { ...selected, stage, verify, tag: 'restore-point-' + sha(encode(selected.manifest)) };
        }, { skipBusy: true, maxBusyMs: 1800000 });
        if (selected.skipped) return skipped('operation-lock-busy');
        run ??= await resticRunner(config, { signal, settings });
        const repository = async (args, options = {}) => { signal.throwIfAborted(); const result = await run(args, { ...options, signal }); signal.throwIfAborted(); return result; };
        const matching = JSON.parse(await repository(['snapshots', '--json', '--tag', `chunk-picker,${selected.tag}`]));
        if (!Array.isArray(matching)) throw Error('Invalid repository inventory.');
        const delivered = matching.find(row => /^[a-f0-9]{64}$/.test(row.id ?? '') && row.tags?.includes(selected.tag)
          && row.tags.includes('chunk-picker') && Math.abs(Date.parse(row.time) - selected.time) < 1000);
        let id = delivered?.id, staged;
        if (!id) {
          staged = await exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
            for (const name of ['maintenance.json', 'activation.json', 'tools-transaction.json'])
              if (await exists(path.join(settings.controlDir, name))) throw Error('Operation evidence requires reconciliation.');
            // Recheck after the network query; a release or local prune may have run.
            if (sha(encode(await verifyBackup(selected.backup))) !== sha(encode(selected.manifest))) throw Error('Snapshot changed before staging.');
            const release = await releaseReader(settings.current, settings.dataDir);
            if (sha(release.pointerBytes) !== selected.manifest.releasePointerSha256) throw Error('Snapshot needs the selected release; take a fresh backup.');
            // Fixed source paths let restic reuse parent trees. The offhost lock
            // owns this namespace, including remnants of an interrupted upload.
            // Reclaim crash remnants before admission, and own cleanup before
            // attempting any allocation for this run.
            scratch = selected.stage;
            const options = { ...budgetOptions, signal }, { budget, copy } = stagingBudget(settings.scratchRoot, settings.minFreeBytes, options);
            await budget(selected.manifest.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0));
            await directory(scratch);
            const backup = path.join(scratch, 'snapshot'), recovery = path.join(scratch, 'rebuild');
            await copyTree(selected.backup, backup, { copy });
            await verifyBackup(backup);
            await bundle({ settings, release, output: recovery, budgetOptions: options });
            signal.throwIfAborted();
            return { backup, recovery, time: selected.time };
          }, { skipBusy: true, maxBusyMs: 1800000 });
          if (staged.skipped) return skipped('operation-lock-busy');
          // No live paths or operator lock survive into the network phase.
          const stdout = await repository(['backup', '--json', '--host', 'picker-vps', '--tag', 'chunk-picker',
            '--tag', selected.tag,
            '--time', new Date(staged.time).toISOString().slice(0, 19).replace('T', ' '), staged.backup, staged.recovery]);
          const summary = stdout.trim().split('\n').map(row => JSON.parse(row)).find(row => row.message_type === 'summary');
          if (!/^[a-f0-9]{8,64}$/.test(summary?.snapshot_id ?? '')) throw Error('Missing upload receipt.');
          id = summary.snapshot_id;
        }
        const snapshots = JSON.parse(await repository(['snapshots', '--json', id]));
        if (snapshots.length !== 1 || !snapshots[0].id?.startsWith(id)
          || !Number.isFinite(Date.parse(snapshots[0].time))
          || !snapshots[0].tags?.includes(selected.tag)
          || Math.abs(Date.parse(snapshots[0].time) - selected.time) >= 1000) throw Error('Upload snapshot time differs.');
        // A tree listing cannot detect absent data packs behind a stale index.
        // Restore this exact snapshot into an empty private tree, then verify
        // every restored file. Restic batches data reads by pack. The guard
        // admits the full restore size against reserve before writing data.
        // No shared cache may substitute for remote tree or data pack reads.
        verification = selected.verify;
        await directory(verification);
        await repository(['restore', snapshots[0].id, '--target', verification, '--verify'], { useCache: false });
        if (staged) await verifyBackup(staged.backup);
        await recordStatus(settings.controlDir, 'offhost', { result: 'success', snapshotAt: new Date(selected.time).toISOString() }, now());
        try { await ping('offhost'); } catch {}
        return delivered ? { uploaded: false, alreadyOffsite: true } : { uploaded: true };
      } finally {
        // Only this job's private immutable copy, never a source or remote point.
        if (scratch) await rm(scratch, { recursive: true, force: true });
        if (verification) await rm(verification, { recursive: true, force: true });
      }
    });
  }, { skipBusy: true, maxBusyMs: 1800000 });
  return result.skipped && !result.reason ? skipped('offhost-lock-busy') : result;
}

// Independent of upload/release locks and status. Record the attempt before
// launch so failures and restarts cannot cause repeated full checks in a day.
export async function offhostCheck({ settings, config, run, now = () => Date.now(), deadlineMs = 120 * 60000 }) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120 * 60000) throw Error('Invalid check deadline.');
  await directory(settings.controlDir);
  return exclusive(path.join(settings.controlDir, 'offhost-check.lock'), async () => {
    const file = path.join(settings.controlDir, 'offhost-check-status.json');
    let previous; if (await exists(file)) previous = await json(file);
    const attemptedAt = new Date(now()).toISOString();
    if (previous?.attemptedAt?.slice(0, 10) >= attemptedAt.slice(0, 10)) return { skipped: true, reason: 'already-checked-today' };
    if (await exists(path.join(settings.controlDir, 'offhost-paused.json'))) return { skipped: true, reason: 'paused' };
    const status = result => atomic(file, encode({ format: 'picker-offhost-check-v1', attemptedAt, result }));
    await status('running');
    try {
      const signal = AbortSignal.timeout(deadlineMs);
      run ??= await resticRunner(config, { signal, settings });
      await run(['check'], { signal, timeoutMs: deadlineMs, useCache: false });
      signal.throwIfAborted(); await status('success'); return { checked: true };
    } catch (error) { await status('failed'); throw error; }
  }, { skipBusy: true });
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
    } else if (process.argv[2] === 'check') {
      const result = await offhostCheck({ settings, config });
      if (result.skipped) process.stderr.write('Off-site repository check skipped.\n');
    } else {
      if (process.argv[2]) throw Error();
      await offhostBackup({ settings, config });
    }
  } catch { process.stderr.write('Off-site backup failed; existing restore points retained.\n'); process.exitCode = 1; }
}
