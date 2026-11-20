import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, readdir, statfs } from 'node:fs/promises';
import { storageBudget, storageUsage, storagePressure } from '../../app/storage/storage-budget.mjs';
import { operatorSettings } from './runtime.mjs';
import { hostname } from 'node:os';
import { isMain } from '../release/vps/entrypoint.mjs';
import { atomic, directory, encode, exclusive, json } from './files.mjs';
import { notify, releaseWindow, failureUnits } from './notify.mjs';
import { processIdentity } from './start-check.mjs';
import { pluginKeyCount } from './plugin-key-count.mjs';
import { PLUGIN_KEY_RECORD_LIMIT } from '../../app/plugin-keys.mjs';
const execute = promisify(execFile), GiB = 1024 ** 3;
export function monitorSettings(config = {}) {
  const result = { backupWarningAgeMs: 36 * 3600000, backupCriticalAgeMs: 48 * 3600000,
    pluginKeyWarningRecords: Math.ceil(PLUGIN_KEY_RECORD_LIMIT * 0.8) };
  for (const key of Object.keys(result)) if (config[key] !== undefined) result[key] = config[key];
  for (const [key, value] of Object.entries(result)) {
    const max = key === 'pluginKeyWarningRecords' ? PLUGIN_KEY_RECORD_LIMIT - 1 : 366 * 86400000;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError('Invalid monitor setting: ' + key);
  }
  if (result.backupWarningAgeMs >= result.backupCriticalAgeMs) throw new TypeError('Backup warning age must precede critical age.');
  return result;
}
export function evaluate(sample, previous = {}, now = Date.now(), config = {}) {
  const settings = monitorSettings(config);
  // An unavailable observation proves neither a fault nor a recovery. Partial
  // collection failures conservatively retain all unresolved observations.
  if (sample.unreadable) return { faults: { ...previous.faults, 'monitor-data': 'critical' }, lowRamSince: previous.lowRamSince ?? null };
  const faults = {}, put = (code, level = 'warning') => { const rank = { warning: 1, critical: 2, urgent: 3 }; if (!faults[code] || rank[level] > rank[faults[code]]) faults[code] = level; };
  if (!sample.writerActive) put('writer-inactive', 'critical');
  const age = at => { const time = Date.parse(at); return !Number.isFinite(time) || time > now + 60000 ? Infinity : now - time; };
  for (const [code, at] of [['backup-source', sample.backup?.snapshotAt], ['offhost-source', sample.offhost?.snapshotAt], ['offhost-delivery', sample.offhost?.lastSuccessAt]]) {
    const elapsed = age(at); if (elapsed >= settings.backupWarningAgeMs) put(code, elapsed >= settings.backupCriticalAgeMs ? 'critical' : 'warning');
  }
  // Every alert must need operator action. Routine backups and deploys hold
  // the marker for minutes, so a live owner alerts only once its operation
  // exceeds the time budget below; a dead owner alerts at once.
  if (sample.marker && !sample.ownerAlive) put('maintenance-abandoned', 'critical');
  if (sample.offhostPause) put('offhost-paused');
  if (sample.lock && age(sample.lock.startedAt) >= 30 * 60000 || sample.marker && age(sample.marker.startedAt ?? sample.lock?.startedAt) >= 30 * 60000) put('operation-long', 'critical');
  if (sample.diskBytes < 15 * GiB) put('disk-low', sample.diskBytes < 5 * GiB ? 'urgent' : 'warning');
  for (const group of sample.storage ?? []) {
    const level = storagePressure(group, group.limits);
    if (level) put('group-storage', level);
    if (group.pluginKeyRecords >= settings.pluginKeyWarningRecords)
      put('plugin-key-records', group.pluginKeyRecords >= PLUGIN_KEY_RECORD_LIMIT ? 'critical' : 'warning');
  }
  const lowRamSince = sample.ramBytes < 2 * GiB ? previous.lowRamSince ?? now : null;
  if (sample.ramBytes < GiB) put('ram-low', 'urgent');
  else if (lowRamSince !== null && now - lowRamSince >= 10 * 60000) put('ram-low');
  // A planned writer outage must not reappear under the aggregate category.
  // Unknown units and every other job remain faults, even during a release.
  const failed = (sample.failed ?? []).filter(unit => unit !== 'chunk-picker.service' || !releaseWindow(sample.window, now));
  if (failed.length) put('failed-units', 'critical');
  for (const unit of sample.failed ?? []) if (failureUnits[unit]) put(failureUnits[unit], 'critical');
  for (const kind of ['operator', 'health', 'backup', 'offhost']) {
    const status = sample[kind];
    if (status?.result === 'failed') put(kind + '-fault', 'critical');
    if (status?.result === 'running' && age(status.startedAt) >= 30 * 60000) put('operation-long', 'critical');
    if (status?.faults?.includes('disk-reserve')) put('disk-low');
  }
  if (sample.unreadable) put('monitor-data', 'critical');
  if (sample.window && !releaseWindow(sample.window, now)) put('release-window');
  return { faults, lowRamSince };
}
// Single-picker locks record a boot-scoped process identity. Multi-picker
// service locks record only pid and host; the process must still exist there.
export async function lockOwnerAlive(lock, { identity = processIdentity, host = hostname() } = {}) {
  try {
    if (lock?.processIdentity) return await identity(lock.pid) === lock.processIdentity;
    if (lock?.host !== host) return false;
    await identity(lock.pid); return true;
  } catch { return false; }
}
async function optional(file) { try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
export async function collectStorage(config) {
  const settings = config.dataDir ? config : await operatorSettings();
  const limits = storageBudget();
  const roots = [{ group: 'legacy', directory: settings.dataDir }];
  const pickerRoot = settings.multiPicker?.pickerRoot;
  if (pickerRoot) for (const entry of await readdir(pickerRoot, { withFileTypes: true })) {
    if (/^p_[a-f0-9]{32}$/.test(entry.name)) {
      if (!entry.isDirectory()) throw new Error('Invalid group storage directory.');
      roots.push({ group: entry.name, directory: path.join(pickerRoot, entry.name) });
    }
  }
  const result = [];
  for (const { group, directory } of roots) {
    if (!(await lstat(directory)).isDirectory()) throw new Error('Missing group storage directory.');
    result.push({ group, ...await storageUsage(directory), limits,
      pluginKeyRecords: await pluginKeyCount(path.join(directory, 'plugin-keys.json')) });
  }
  return result;
}
export async function collect(config) {
  const sample = {}, read = async (key, file) => {
    try { sample[key] = await optional(file); } catch { sample.unreadable = true; }
  };
  await read('marker', path.join(config.controlDir, 'maintenance.json'));
  await read('lock', path.join(config.controlDir, 'operation.lock'));
  await read('window', path.join(config.controlDir, 'release-window.json'));
  await read('offhostPause', path.join(config.controlDir, 'offhost-paused.json'));
  for (const kind of ['operator', 'health', 'backup', 'offhost']) await read(kind, path.join(config.controlDir, kind + '-status.json'));
  sample.ownerAlive = await lockOwnerAlive(sample.lock);
  const output = await execute('systemctl', ['show', 'chunk-picker.service', '--property=ActiveState,SubState,MainPID'], { timeout: 10000, windowsHide: true });
  const fields = Object.fromEntries(output.stdout.trim().split('\n').map(row => row.split('=')));
  sample.writerActive = fields.ActiveState === 'active' && fields.SubState === 'running' && Number(fields.MainPID) > 0;
  const failed = await execute('systemctl', ['--failed', '--no-legend', '--plain', '--no-pager'], { timeout: 10000, windowsHide: true });
  sample.failed = failed.stdout.trim().split('\n').filter(Boolean).map(row => row.trim().split(/\s+/)[0]);
  const disk = await statfs(config.diskPath); sample.diskBytes = Number(disk.bavail) * Number(disk.bsize);
  const available = /^MemAvailable:\s+(\d+) kB$/m.exec(await readFile('/proc/meminfo', 'utf8'));
  if (!available) throw Error('Memory evidence unavailable.'); sample.ramBytes = Number(available[1]) * 1024;
  sample.storage = await collectStorage(config);
  return sample;
}
export async function monitor(config, { sample, now = Date.now(), send, collectSample = collect } = {}) {
  const settings = monitorSettings(config);
  await directory(config.controlDir);
  return exclusive(path.join(config.controlDir, 'monitor.lock'), async () => {
    const file = path.join(config.controlDir, 'monitor-state.json');
    const previous = await optional(file) ?? {};
    try { sample ??= await collectSample(config); } catch { sample = { unreadable: true }; }
    const result = evaluate(sample, previous, now, settings);
    await atomic(file, encode({ ...result, at: new Date(now).toISOString() }));
    await notify({ ...config, faults: result.faults, merge: !!sample.unreadable, window: sample.window, now, ...(send ? { send } : {}) });
    return result;
  });
}
if (isMain(import.meta.url)) {
  try {
    const config = await json('/etc/chunk-picker/monitor.json');
    if (process.argv[2] === '--storage') process.stdout.write(JSON.stringify(await collectStorage(config), null, 2) + '\n');
    else await monitor(config);
  }
  catch { process.stderr.write('Monitor failed; inspect privately.\n'); process.exitCode = 1; }
}
