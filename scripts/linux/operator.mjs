import { configDescriptor, bindingBytes } from '../private-companion/release-pack-check.mjs';
import { captureOnline } from './online.mjs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uptime } from 'node:os';
import { chown, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertReleased, atomic, directory, encode, exclusive, exists, headroom, inventory, json, noLinks, sha } from './files.mjs';
import { assertSameRelease, operatorSettings, readRelease } from './runtime.mjs';
import { backupStopped, checkStoppedCompatibility, restoreStopped, writeBackupStatus, storeIdentity } from './recovery.mjs';
import { processIdentity } from './start-check.mjs';

const execute = promisify(execFile);
export function systemd(settings) {
  const service = settings.service;
  const command = async args => {
    try { return (await execute('systemctl', [...args, service], { timeout: 150000, maxBuffer: 16384, windowsHide: true })).stdout; }
    catch { throw new Error('Service control refused; inspect the private system journal.'); }
  };
  return {
    async state() {
      const fields = Object.fromEntries((await command(['show', '--property=ActiveState,SubState,MainPID,ActiveEnterTimestampMonotonic,ControlGroup,TasksCurrent'])).trim().split('\n').map(row => row.split('=')));
      return { active: fields.ActiveState === 'active' && fields.SubState === 'running' && Number(fields.MainPID) > 0,
        stopped: ['inactive', 'failed'].includes(fields.ActiveState) && ['dead', 'failed'].includes(fields.SubState) && fields.MainPID === '0'
          && (fields.ControlGroup === '' || fields.TasksCurrent === '0'),
        activeForMs: uptime() * 1000 - Number(fields.ActiveEnterTimestampMonotonic) / 1000 };
    },
    stop: () => command(['stop']),
    async start() {
      const lock = await readFile(path.join(settings.controlDir, 'operation.lock'));
      if (JSON.parse(lock).pid !== process.pid) throw new Error('Service start requires the current operator lock.');
      const permit = path.join(settings.controlDir, 'start-permit.json');
      await atomic(permit, encode({ lockSha256: sha(lock), pointerSha256: sha(await readFile(settings.current)),
        processIdentity: await processIdentity(process.pid), expiresAt: Date.now() + 30000 }));
      try { return await command(['start']); } finally { await rm(permit, { force: true }); }
    },
  };
}
export async function assertStopped(controller, dataDir) {
  if (!(await controller.state()).stopped) throw new Error('The writer is still active or its ownership is uncertain.');
  await assertReleased(dataDir);
}
export async function privateRequest(release, route, method = 'GET', body = {}) {
  const tokenFile = path.join(release.config.dataDir, 'access-token');
  await noLinks(tokenFile);
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!token) throw new Error('Missing private operator credential.');
  const { isPrivateClient } = await import('../../app/security/request.mjs');
  if (!isPrivateClient(release.config.host)) throw new Error('Health must use a private listener.');
  try {
    const response = await fetch(new URL(route, `http://${release.config.host.includes(':') ? '[' + release.config.host + ']' : release.config.host}:${release.config.port}`), {
      method, redirect: 'error', headers: { Authorization: 'Bearer ' + token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(route === '/api/operator/snapshot' ? 120000 : 10000),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new Error('Private operator request failed.'); }
}
async function waitReady(release, request = privateRequest, wait = delay, controller) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try { const health = await request(release, '/api/health'); if (health.ready && health.savesReady) return; } catch {}
    // Stop a failed candidate before RestartSec=15 can consume the remaining
    // three-start budget. Rollback needs its own guarded start.
    if (controller && !(await controller.state()).active) throw new Error('Writer exited before private readiness.');
    if (attempt < 11) await wait(5000);
  }
  throw new Error('Private readiness did not recover.');
}
// The task worker sleeps after RS3_WORKER_IDLE_MS without requests and wakes
// on the next one, so a sleeping worker is healthy, not a reason to restart.
const ready = async (release, request) => {
  try {
    const health = await request(release, '/api/health'), worker = health.worker ?? {};
    const asleep = worker.status === 'sleeping' && worker.stuck !== true && worker.restartRequired !== true;
    return (health.ready === true || asleep) && health.savesReady === true;
  } catch { return false; }
};
export async function healthRecovery({ settings, release, controller, request = privateRequest, wait = delay }) {
  const state = await controller.state();
  if (!state.active || state.activeForMs < 300000) return { skipped: true };
  if (await ready(release, request)) return { healthy: true };
  for (let attempt = 0; attempt < 2; attempt++) { await wait(15000); if (await ready(release, request)) return { healthy: true }; }
  try { await request(release, '/api/worker-restart', 'POST'); } catch {}
  for (let attempt = 0; attempt < 6; attempt++) { await wait(5000); if (await ready(release, request)) return { recovered: 'workers' }; }
  // Never systemctl restart: stop must succeed and release ownership first.
  await controller.stop(); await assertStopped(controller, settings.dataDir);
  await assertSameRelease(release);
  await controller.start(); await waitReady(release, request, wait, controller);
  return { recovered: 'writer' };
}
export async function deployStopped({ settings, current, candidate, controller, candidateBinding, checkedIdentity, check = checkStoppedCompatibility, request = privateRequest, wait = delay }) {
  const stopped = () => assertStopped(controller, settings.dataDir);
  await controller.stop(); await stopped();
  const originalBinding = await readFile(settings.dataDir + '.dataset.json');
  let swapped = false, rebound = false;
  try {
    if (!checkedIdentity || encode(checkedIdentity) !== encode(await storeIdentity(settings.dataDir))) {
      await check({ dataDir: settings.dataDir, scratchRoot: settings.scratchRoot, minFreeBytes: settings.minFreeBytes,
        current, candidate, candidateBinding, assertStopped: stopped });
    }
    await stopped(); await assertSameRelease(current); await assertSameRelease(candidate);
    if (sha(await readFile(settings.dataDir + '.dataset.json')) !== sha(originalBinding)) throw new Error('Binding changed before activation.');
    // Write a durable recovery breadcrumb before either selection changes.
    await atomic(path.join(settings.controlDir, 'activation.json'), encode({ phase: 'prepared', previousPointerBase64: current.pointerBytes.toString('base64'),
      previousBindingBase64: originalBinding.toString('base64'), candidatePointerSha256: sha(candidate.pointerBytes) }));
    if (candidateBinding) { await atomic(settings.dataDir + '.dataset.json', candidateBinding, 0o644); rebound = true; }
    if (sha(await readFile(settings.current)) !== sha(current.pointerBytes)) throw new Error('Current pointer changed before activation.');
    await atomic(settings.current, candidate.pointerBytes, 0o644); swapped = true;
    await controller.start(); await waitReady(candidate, request, wait, controller);
    await rm(path.join(settings.controlDir, 'activation.json'));
    return { activated: true };
  } catch (error) {
    // A failed final probe takes this path without writing the store or pointer.
    // After candidate startup, use its LATEST save: never restore an old backup.
    await controller.stop(); await stopped();
    if (swapped || rebound) {
      // Re-prove reverse compatibility against any candidate-startup writes.
      const selected = await readRelease(settings.current, settings.dataDir);
      await check({ dataDir: settings.dataDir, scratchRoot: settings.scratchRoot, minFreeBytes: settings.minFreeBytes,
        current: swapped ? selected : candidate, candidate: current, candidateBinding: originalBinding, assertStopped: stopped });
      const expected = swapped ? candidate.pointerBytes : current.pointerBytes;
      if (sha(await readFile(settings.current)) !== sha(expected)) throw new Error('Rollback pointer ownership changed.');
      if (rebound) await atomic(settings.dataDir + '.dataset.json', originalBinding, 0o644);
      if (swapped) await atomic(settings.current, current.pointerBytes, 0o644);
    } else {
      await assertSameRelease(current);
      if (sha(await readFile(settings.current)) !== sha(current.pointerBytes)) throw new Error('Old pointer changed; automatic restart refused.');
    }
    await controller.start(); await waitReady(current, request, wait, controller);
    await rm(path.join(settings.controlDir, 'activation.json'), { force: true });
    throw error;
  }
}
export async function deployPrechecked({ settings, current, candidate, controller, candidateBinding,
  capture = captureOnline, check = checkStoppedCompatibility, request = privateRequest, wait = delay }) {
  const snapshot = await capture({ settings, release: current, request });
  let checkedIdentity;
  try {
    const before = await storeIdentity(snapshot.dataDir);
    await check({ ...settings, dataDir: snapshot.dataDir, current, candidate, candidateBinding,
      assertStopped: () => assertReleased(snapshot.dataDir) });
    if (encode(before) !== encode(await storeIdentity(snapshot.dataDir))) throw new Error('Checked snapshot changed.');
    checkedIdentity = before;
  } finally { await snapshot.cleanup(); }
  // No start/stop has happened if any of the online preparation failed.
  return deployStopped({ settings, current, candidate, controller, candidateBinding, checkedIdentity, check, request, wait });
}
export async function backupOnline({ settings, release, request = privateRequest, capture = captureOnline, probe }) {
  const snapshot = await capture({ settings, release, request });
  try { return await backupStopped({ ...settings, dataDir: snapshot.dataDir, release, ...(probe ? { probe } : {}) }); }
  finally { await snapshot.cleanup(); }
}
export async function runOperator(command, argument, evidence, mode) {
  const settings = await operatorSettings();
  await directory(settings.controlDir);
  const pause = path.join(settings.controlDir, 'maintenance.json');
  return exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
    if (await exists(pause)) throw new Error('Maintenance evidence remains; reconcile it before continuing.');
    const release = await readRelease(settings.current, settings.dataDir), controller = systemd(settings);
    if (command === 'health') {
      try { await headroom(settings.backupDir, 0, settings.minFreeBytes); } catch { process.stderr.write('Recovery disk free-space reserve is unavailable.\n'); }
      let status;
      try { status = await json(path.join(path.dirname(settings.dataDir), 'backup-status.json')); } catch {}
      if (!status?.lastSuccessAt || !Number.isFinite(Date.parse(status.lastSuccessAt)) || Date.now() - Date.parse(status.lastSuccessAt) > 172800000) process.stderr.write('Recovery backup is missing or older than two days.\n');
      return healthRecovery({ settings, release, controller });
    }
    if (!['backup', 'restore', 'deploy'].includes(command)) throw new Error('Use health, backup, restore or deploy.');
    const candidate = command === 'deploy' ? await readRelease(argument, settings.dataDir) : null;
    if (command === 'deploy' && evidence && evidence !== '--stopped') {
      const receipt = await json(evidence);
      if (receipt.previousPointerSha256 !== sha(release.pointerBytes) || receipt.candidateIdentity !== candidate.identity
        || path.resolve(receipt.pointer) !== path.resolve(argument)) throw new Error('Staged deployment receipt changed.');
    }
    let candidateBinding;
    if (candidate?.config.packs?.data) {
      const old = await configDescriptor(release.pointer.config.path), next = await configDescriptor(candidate.pointer.config.path);
      const binding = JSON.parse(await readFile(settings.dataDir + '.dataset.json'));
      if (['datasetId', 'datasetContractVersion', 'digest'].some(key => binding[key] !== old.descriptor[key])) throw new Error('Current binding differs from selected release.');
      if (encode(old.descriptor) !== encode(next.descriptor)) candidateBinding = bindingBytes(next.descriptor);
    }
    const wasActive = (await controller.state()).active;
    if (command === 'deploy' && !wasActive) throw new Error('Deploy requires an active, owned current service.');
    if (command === 'restore' && wasActive) throw new Error('Restore requires a deliberately stopped service.');
    if (command === 'backup' && argument !== '--stopped' && !wasActive) throw new Error('Online backup requires an active writer; use backup --stopped explicitly.');
    if (command === 'backup' && argument && argument !== '--stopped') throw new Error('Use backup or backup --stopped.');
    await atomic(pause, encode({ command, startedAt: new Date().toISOString() }));
    try {
      if (command === 'deploy') {
        const deploy = evidence === '--stopped' || mode === '--stopped' ? deployStopped : deployPrechecked;
        await deploy({ settings, current: release, candidate, candidateBinding, controller });
      } else if (command === 'backup' && argument !== '--stopped') {
        await atomic(path.join(path.dirname(settings.dataDir), 'backup-destination'), 'managed\n', 0o644);
        const result = await backupOnline({ settings, release });
        await writeBackupStatus(settings.dataDir, { result: 'success', byteSize: result.byteSize });
      } else {
        await controller.stop(); await assertStopped(controller, settings.dataDir);
        try {
          if (command === 'backup') {
            const at = new Date().toISOString();
            await atomic(path.join(path.dirname(settings.dataDir), 'backup-destination'), 'managed\n', 0o644);
            try {
              const result = await backupStopped({ ...settings, release });
              await writeBackupStatus(settings.dataDir, { result: 'success', byteSize: result.byteSize, at });
            } catch (error) { await writeBackupStatus(settings.dataDir, { result: 'failed', at }); throw error; }
          } else {
            // Restore runs as root; hand the verified private store back to the
            // fixed service identity before allowing a later service start.
            const uid = Number((await execute('id', ['-u', 'chunk-picker'])).stdout.trim());
            const gid = Number((await execute('id', ['-g', 'chunk-picker'])).stdout.trim());
            if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1) throw new Error('Dedicated service identity is required.');
            await restoreStopped({ ...settings, backup: argument, release });
            const files = await inventory(settings.dataDir);
            for (const row of files) await chown(path.join(settings.dataDir, row.path), uid, gid);
            await chown(settings.dataDir, uid, gid); await chown(settings.dataDir + '.dataset.json', uid, gid);
          }
        } finally {
          // Backup failure must still resume the unchanged old service, but a
          // partial restore must stay stopped for inspection.
          if (command === 'backup' && wasActive) { await assertStopped(controller, settings.dataDir); await controller.start(); await waitReady(release, privateRequest, delay, controller); }
        }
      }
      await rm(pause);
    } catch (error) {
      // Safe rollback may have restarted the old writer. Reconcile evidence
      // explicitly; a failed rollback retains pause and prevents health actions.
      if (command === 'backup') {
        try { await writeBackupStatus(settings.dataDir, { result: 'failed' }); } catch {}
      }
      throw error;
    }
    return { completed: command };
  }, { skipBusy: command === 'health' });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runOperator(...process.argv.slice(2)); process.stdout.write('Operator command completed.\n'); }
  catch { process.stderr.write('Operator command refused; keep maintenance evidence and inspect privately.\n'); process.exitCode = 1; }
}
