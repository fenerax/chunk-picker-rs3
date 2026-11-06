import { isMain } from '../release/vps/entrypoint.mjs';
import { configDescriptor, bindingBytes } from '../private-companion/release-pack-check.mjs';
import { prewarmCandidate } from './prewarm.mjs';
import { captureOnline } from './online.mjs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uptime } from 'node:os';
import { chown, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertReleased, atomic, directory, encode, exclusive, exists, headroom, inventory, json, noLinks, sha } from './files.mjs';
import { assertSameRelease, operatorSettings, readRelease, assertOperatorService, serviceIdentity } from './runtime.mjs';
import { backupStopped, checkStoppedCompatibility, restoreStopped, writeBackupStatus, storeIdentity } from './recovery.mjs';
import { processIdentity } from './start-check.mjs';
import { assertStartOwnershipReleased } from './plugin-suppression-gate.mjs';
import { reviewedDeploymentAdditions } from './deployment-receipt.mjs';
import { deadman, recordStatus, withStatus } from './ops-status.mjs';
import { phaseReceipt, inPhase } from './phases.mjs';

const execute = promisify(execFile);
export function systemd(settings, { executeCommand = execute } = {}) {
  const service = settings.service;
  const command = async args => {
    try { return (await executeCommand('systemctl', [...args, service], { timeout: 150000, maxBuffer: 16384, windowsHide: true })).stdout; }
    catch { throw new Error('Service control refused; inspect the private system journal.'); }
  };
  return {
    async state() {
      const fields = Object.fromEntries((await command(['show', '--property=ActiveState,SubState,MainPID,ActiveEnterTimestampMonotonic,ControlGroup,TasksCurrent,Result,InvocationID,NRestarts,ExecMainStartTimestampMonotonic,ExecMainCode,ExecMainStatus'])).trim().split('\n').map(row => row.split('=')));
      return { active: fields.ActiveState === 'active' && fields.SubState === 'running' && Number(fields.MainPID) > 0,
        stopped: ['inactive', 'failed'].includes(fields.ActiveState) && ['dead', 'failed'].includes(fields.SubState) && fields.MainPID === '0'
          && (fields.ControlGroup === '' || fields.TasksCurrent === '0'),
        activeForMs: uptime() * 1000 - Number(fields.ActiveEnterTimestampMonotonic) / 1000,
        invocationId: fields.InvocationID, result: fields.Result, restarts: fields.NRestarts,
        mainStartedAt: fields.ExecMainStartTimestampMonotonic,
        mainExitSucceeded: fields.ExecMainCode === '1' && fields.ExecMainStatus === '0',
        healthIdentityKnown: Boolean(fields.InvocationID && /^\d+$/.test(fields.NRestarts ?? '') && /^[1-9]\d*$/.test(fields.ExecMainStartTimestampMonotonic ?? '')) };
    },
    stop: () => command(['stop']),
    async start(timings, { health = false, restarts, mainStartedAt } = {}) {
      return inPhase(timings, 'start-permit', async () => {
        const lock = await readFile(path.join(settings.controlDir, 'operation.lock'));
        if (JSON.parse(lock).pid !== process.pid) throw new Error('Service start requires the current operator lock.');
        if (health) {
          await assertHealthEvidence(settings);
          const state = await this.state();
          if (!state.stopped || !/^\d+$/.test(state.restarts ?? '') || state.result !== 'success' || state.restarts !== restarts
            || !state.mainExitSucceeded || state.mainStartedAt !== mainStartedAt) throw new Error('Health start requires its successfully drained writer.');
        }
        const permit = path.join(settings.controlDir, 'start-permit.json');
        await atomic(permit, encode({ lockSha256: sha(lock), pointerSha256: sha(await readFile(settings.current)),
          processIdentity: await processIdentity(process.pid), expiresAt: Date.now() + 30000 }));
        try { return await command(['start']); } finally { await rm(permit, { force: true }); }
      });
    },
  };
}
export async function assertStopped(controller, dataDir) {
  if (!(await controller.state()).stopped) throw new Error('The writer is still active or its ownership is uncertain.');
  await assertStartOwnershipReleased(dataDir);
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
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(['/api/operator/snapshot', '/api/operator/service-snapshot'].includes(route) ? 120000 : 10000),
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
async function assertHealthEvidence(settings) {
  // The operation lock serializes cooperating tools. Retained evidence also
  // fences direct callers and interrupted operations; health never clears it.
  for (const name of ['maintenance.json', 'tools-transaction.json', 'activation.json']) {
    if (await exists(path.join(settings.controlDir, name))) throw new Error('Health recovery blocked by transaction evidence.');
  }
  const progress = path.join(settings.controlDir, 'service-restore', 'progress.json');
  if (settings.multiPicker && await exists(progress) && (await json(progress)).phase !== 'complete') throw new Error('Service recovery is incomplete.');
}
export async function healthRecovery({ settings, release, controller, request = privateRequest, wait = delay, assertStopped: stopped = () => assertStopped(controller, settings.dataDir) }) {
  await assertHealthEvidence(settings);
  const state = await controller.state();
  if (!state.active || state.healthIdentityKnown === false || !Number.isFinite(state.activeForMs) || state.activeForMs < 300000) return { skipped: true };
  const sameWriter = async () => {
    await assertHealthEvidence(settings);
    const current = await controller.state();
    return current.active && current.healthIdentityKnown !== false && current.result !== 'start-limit-hit'
      && current.invocationId === state.invocationId && current.restarts === state.restarts && current.mainStartedAt === state.mainStartedAt;
  };
  if (await ready(release, request)) return { healthy: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    await wait(15000); if (!await sameWriter()) return { skipped: true };
    if (await ready(release, request)) return { healthy: true };
  }
  if (!await sameWriter()) return { skipped: true };
  try { await request(release, '/api/worker-restart', 'POST'); } catch {}
  for (let attempt = 0; attempt < 6; attempt++) {
    await wait(5000); if (!await sameWriter()) return { skipped: true };
    if (await ready(release, request)) return { recovered: 'workers' };
  }
  // Never systemctl restart: stop must succeed and release ownership first.
  // In particular, never stop a failed unit: doing so can clear failed state
  // and erase systemd's deliberate crash-loop stop and OnFailure evidence.
  if (!await sameWriter()) return { skipped: true };
  await controller.stop(); await stopped();
  await assertHealthEvidence(settings);
  const afterStop = await controller.state();
  // A deliberate stop may clear restart accounting/InvocationID. Allow that
  // reset to zero, but never a newly increased or otherwise changed count.
  if ((afterStop.result && afterStop.result !== 'success')
    || afterStop.mainExitSucceeded === false || afterStop.mainStartedAt !== state.mainStartedAt
    || (afterStop.restarts !== state.restarts && afterStop.restarts !== '0')) throw new Error('Writer failed during health recovery; operator reconciliation required.');
  await assertSameRelease(release);
  await assertHealthEvidence(settings);
  await controller.start(undefined, { health: true, restarts: afterStop.restarts, mainStartedAt: state.mainStartedAt }); await waitReady(release, request, wait, controller);
  return { recovered: 'writer' };
}
async function activationReceipt(settings, timings, work) {
  const owned = !timings;
  try {
    timings ??= await phaseReceipt(settings.controlDir, 'activate');
    const result = await work(timings);
    if (owned) await timings.finish('success');
    return { ...result, phaseReceipt: timings.file };
  } catch (error) { if (owned && timings) await timings.finish('failed'); throw error; }
}
export async function deployStopped(options) {
  return activationReceipt(options.settings, options.timings, timings => deployStoppedImpl({ ...options, timings }));
}
async function deployStoppedImpl({ settings, current, candidate, controller, candidateBinding, checkedIdentity, savedIdentityAdditions, check = checkStoppedCompatibility, request = privateRequest, wait = delay, timings }) {
  const stopped = () => assertStopped(controller, settings.dataDir);
  await timings.preflight();
  let originalBinding;
  let swapped = false, rebound = false, drained = false;
  try {
    await inPhase(timings, 'drain', async () => { await controller.stop(); await stopped(); drained = true; });
    await timings.mark('stopped');
    originalBinding = await readFile(settings.dataDir + '.dataset.json');
    if (!checkedIdentity || encode(checkedIdentity) !== encode(await inPhase(timings, 'stopped:identity-hash', () => storeIdentity(settings.dataDir)))) {
      await check({ dataDir: settings.dataDir, scratchRoot: settings.scratchRoot, minFreeBytes: settings.minFreeBytes,
        current, candidate, candidateBinding, savedIdentityAdditions, assertStopped: stopped, timings });
    }
    await inPhase(timings, 'release-hash', async () => { await stopped(); await assertSameRelease(current); await assertSameRelease(candidate); });
    if (sha(await readFile(settings.dataDir + '.dataset.json')) !== sha(originalBinding)) throw new Error('Binding changed before activation.');
    // Write a durable recovery breadcrumb before either selection changes.
    await inPhase(timings, 'pointer', async () => {
      await atomic(path.join(settings.controlDir, 'activation.json'), encode({ phase: 'prepared', previousPointerBase64: current.pointerBytes.toString('base64'),
        previousBindingBase64: originalBinding.toString('base64'), candidatePointerSha256: sha(candidate.pointerBytes) }));
      if (candidateBinding) { await atomic(settings.dataDir + '.dataset.json', candidateBinding, 0o644); rebound = true; }
      if (sha(await readFile(settings.current)) !== sha(current.pointerBytes)) throw new Error('Current pointer changed before activation.');
      await atomic(settings.current, candidate.pointerBytes, 0o644); swapped = true;
    });
    await inPhase(timings, 'start-gate', () => controller.start(timings));
    await timings.mark('started');
    await inPhase(timings, 'started-to-ready', () => waitReady(candidate, request, wait, controller));
    await timings.mark('ready');
    await rm(path.join(settings.controlDir, 'activation.json'));
    return { activated: true };
  } catch (error) {
    if (!drained) throw error; // Uncertain stop/ownership must stay fenced.
    // A failed final probe takes this path without writing the store or pointer.
    // After candidate startup, use its LATEST save: never restore an old backup.
    await controller.stop(); await stopped();
    if (swapped || rebound) {
      // Re-prove reverse compatibility against any candidate-startup writes.
      const selected = await readRelease(settings.current, settings.dataDir);
      await check({ dataDir: settings.dataDir, scratchRoot: settings.scratchRoot, minFreeBytes: settings.minFreeBytes,
        current: swapped ? selected : candidate, candidate: current, candidateBinding: originalBinding, assertStopped: stopped, timings, phase: 'rollback' });
      const expected = swapped ? candidate.pointerBytes : current.pointerBytes;
      if (sha(await readFile(settings.current)) !== sha(expected)) throw new Error('Rollback pointer ownership changed.');
      if (rebound) await atomic(settings.dataDir + '.dataset.json', originalBinding, 0o644);
      if (swapped) await atomic(settings.current, current.pointerBytes, 0o644);
    } else {
      await assertSameRelease(current);
      if (sha(await readFile(settings.current)) !== sha(current.pointerBytes)) throw new Error('Old pointer changed; automatic restart refused.');
    }
    await inPhase(timings, 'rollback:start-gate', () => controller.start(timings));
    await inPhase(timings, 'rollback:started-to-ready', () => waitReady(current, request, wait, controller));
    await rm(path.join(settings.controlDir, 'activation.json'), { force: true });
    throw error;
  }
}
export async function deployPrechecked(options) {
  return activationReceipt(options.settings, options.timings, timings => deployPrecheckedImpl({ ...options, timings }));
}
async function deployPrecheckedImpl({ settings, current, candidate, controller, candidateBinding, savedIdentityAdditions,
  capture = captureOnline, check = checkStoppedCompatibility, request = privateRequest, wait = delay, prewarm = prewarmCandidate, timings }) {
  const snapshot = await inPhase(timings, 'online:copy', () => capture({ settings, release: current, request }));
  let checkedIdentity;
  try {
    const before = await inPhase(timings, 'online:identity-hash', () => storeIdentity(snapshot.dataDir));
    await check({ ...settings, dataDir: snapshot.dataDir, current, candidate, candidateBinding, savedIdentityAdditions,
      assertStopped: () => assertReleased(snapshot.dataDir), timings, phase: 'online' });
    if (encode(before) !== encode(await storeIdentity(snapshot.dataDir))) throw new Error('Checked snapshot changed.');
    checkedIdentity = before;
    // The captured snapshot is read-only calculator input; publication targets
    // the persistent data directory while the old writer remains online. The
    // launcher drops root privileges before running any candidate code.
    try { await inPhase(timings, 'online:prewarm', () => prewarm({ settings, candidate, dataDir: snapshot.dataDir })); } catch { /* Optional cache miss. */ }
  } finally { await snapshot.cleanup(); }
  // No start/stop has happened if any of the online preparation failed.
  return deployStopped({ settings, current, candidate, controller, candidateBinding, savedIdentityAdditions, checkedIdentity, check, request, wait, timings });
}
export async function backupOnline({ settings, release, request = privateRequest, capture = captureOnline, probe }) {
  if (settings.multiPicker) {
    const { serviceBackup } = await import('./service-operator.mjs');
    return serviceBackup({ settings, release, request });
  }
  const snapshotAt = new Date().toISOString();
  const snapshot = await capture({ settings, release, request });
  try { return await backupStopped({ ...settings, dataDir: snapshot.dataDir, release, snapshotAt, ...(probe ? { probe } : {}) }); }
  finally { await snapshot.cleanup(); }
}
export async function runOperator(command, argument, evidence, mode) {
  const settings = await operatorSettings();
  await directory(settings.controlDir);
  const kind = ['health', 'backup'].includes(command) ? command : 'operator';
  return withStatus(settings.controlDir, kind, async () => {
    const result = await runOperatorImpl(settings, command, argument, evidence, mode);
    if (['health', 'backup'].includes(command) && !result?.skipped) await deadman(command);
    if (command === 'backup' && !result?.skipped) {
      try { await execute('systemctl', ['--no-block', 'start', 'chunk-picker-offhost.service'], { timeout: 10000, windowsHide: true }); }
      catch { await recordStatus(settings.controlDir, 'offhost', { result: 'failed', faults: ['operation-failed'] }); }
    }
    return result;
  });
}
async function runOperatorImpl(settings, command, argument, evidence, mode) {
  if (settings.multiPicker) {
    const { runServiceOperator } = await import('./service-operator.mjs');
    return runServiceOperator({ settings, command, argument, evidence,
      release: await readRelease(settings.current, settings.dataDir), controller: systemd(settings),
      request: privateRequest, healthRecovery, deployStopped,
      serviceIdentity: () => serviceIdentity(settings) });
  }
  await directory(settings.controlDir);
  const pause = path.join(settings.controlDir, 'maintenance.json');
  return exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {
    if (await exists(path.join(settings.controlDir, 'tools-transaction.json'))) throw new Error('Tools transaction requires reconciliation.');
    if (await exists(pause)) throw Object.assign(new Error('Maintenance evidence remains; reconcile it before continuing.'), { code: 'OPERATOR_MAINTENANCE' });
    const release = await readRelease(settings.current, settings.dataDir), controller = systemd(settings);
    assertOperatorService(settings, release);
    if (command === 'health') {
      const faults = [];
      try { await headroom(settings.backupDir, 0, settings.minFreeBytes); } catch { faults.push('disk-reserve'); }
      let status;
      try { status = await json(path.join(path.dirname(settings.dataDir), 'backup-status.json')); } catch {}
      if (!status?.lastSuccessAt || !Number.isFinite(Date.parse(status.lastSuccessAt)) || Date.now() - Date.parse(status.lastSuccessAt) > 172800000) faults.push('backup-stale');
      const result = await healthRecovery({ settings, release, controller });
      await recordStatus(settings.controlDir, 'health', { result: result.skipped ? 'skipped' : 'success', faults });
      return result;
    }
    if (!['backup', 'restore', 'deploy'].includes(command)) throw new Error('Use health, backup, restore or deploy.');
    const candidate = command === 'deploy' ? await readRelease(argument, settings.dataDir) : null;
    const savedIdentityAdditions = command === 'deploy' ? await reviewedDeploymentAdditions(evidence, argument, release, candidate) : undefined;
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
        await deploy({ settings, current: release, candidate, candidateBinding, savedIdentityAdditions, controller });
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
      // This code is issued only by the receipt preflight, before drain. There
      // has been no writer/pointer change and this invocation owns the pause.
      if (command === 'deploy' && error.code === 'PHASE_RECEIPT_UNWRITABLE') await rm(pause);
      if (command === 'backup') {
        try { await writeBackupStatus(settings.dataDir, { result: 'failed' }); } catch {}
        // Online backup never stops or replaces the writer; a failed capture
        // must not leave it fenced off from later operator runs or starts.
        if (argument !== '--stopped') await rm(pause, { force: true });
      }
      throw error;
    }
    return { completed: command };
  }, { skipBusy: command === 'health', maxBusyMs: command === 'health' ? 1800000 : Infinity });
}
if (isMain(import.meta.url)) {
  try { const result = await runOperator(...process.argv.slice(2)); if (!result?.skipped) process.stdout.write(['list', 'inspect', 'quarantine-release', 'relink-code'].includes(process.argv[2]) ? encode(result) : 'Operator command completed.\n'); }
  catch (error) {
    if (error.code === 'LEGACY_RESTORE_INCOMPATIBLE') process.stderr.write(error.message + '\n');
    else if (error.code === 'OPERATOR_LOCK_LONG_HELD') process.stderr.write('Operator lock held for over 30 minutes; inspect privately.\n');
    else {
      const reason = error.code === 'EEXIST' ? ' Lock busy.'
        : error.code === 'OPERATOR_MAINTENANCE' ? ' Maintenance evidence remains.'
        : error.code === 'OPERATOR_ADDITIONS_REVIEW' ? ' VPS additions require explicit review.'
        : error.message === 'Derived saved identity additions differ from the reviewed list.' ? ' Additions differ.' : '';
      process.stderr.write('Operator command refused; keep maintenance evidence and inspect privately.' + reason + '\n');
    }
    process.exitCode = 1;
  }
}
