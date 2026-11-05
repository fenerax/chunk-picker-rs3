import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomic, directory, encode, exclusive, json } from './files.mjs';
import { notify, releaseWindow, failureUnits } from './notify.mjs';
import { processIdentity } from './start-check.mjs';
const execute = promisify(execFile), GiB = 1024 ** 3;
export function evaluate(sample, previous = {}, now = Date.now()) {
  const faults = {}, put = (code, level = 'warning') => { const rank = { warning: 1, critical: 2, urgent: 3 }; if (!faults[code] || rank[level] > rank[faults[code]]) faults[code] = level; };
  if (!sample.writerActive) put('writer-inactive', 'critical');
  const age = at => { const time = Date.parse(at); return !Number.isFinite(time) || time > now + 60000 ? Infinity : now - time; };
  for (const [code, at] of [['backup-source', sample.backup?.snapshotAt], ['offhost-source', sample.offhost?.snapshotAt], ['offhost-delivery', sample.offhost?.lastSuccessAt]]) {
    const hours = age(at) / 3600000; if (hours >= 36) put(code, hours >= 48 ? 'critical' : 'warning');
  }
  if (sample.marker) { put('maintenance'); if (!sample.ownerAlive) put('maintenance-abandoned', 'critical'); }
  if (sample.offhostPause) put('offhost-paused');
  if (sample.lock && age(sample.lock.startedAt) >= 30 * 60000 || sample.marker && age(sample.marker.startedAt) >= 30 * 60000) put('operation-long', 'critical');
  if (sample.diskBytes < 15 * GiB) put('disk-low', sample.diskBytes < 5 * GiB ? 'urgent' : 'warning');
  const lowRamSince = sample.ramBytes < 2 * GiB ? previous.lowRamSince ?? now : null;
  if (sample.ramBytes < GiB) put('ram-low', 'urgent');
  else if (lowRamSince !== null && now - lowRamSince >= 10 * 60000) put('ram-low');
  if (sample.failed?.length) put('failed-units', 'critical');
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
async function optional(file) { try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
export async function collect(config) {
  const sample = {}, read = async (key, file) => {
    try { sample[key] = await optional(file); } catch { sample.unreadable = true; }
  };
  await read('marker', path.join(config.controlDir, 'maintenance.json'));
  await read('lock', path.join(config.controlDir, 'operation.lock'));
  await read('window', path.join(config.controlDir, 'release-window.json'));
  await read('offhostPause', path.join(config.controlDir, 'offhost-paused.json'));
  for (const kind of ['operator', 'health', 'backup', 'offhost']) await read(kind, path.join(config.controlDir, kind + '-status.json'));
  sample.ownerAlive = false;
  if (sample.lock) try { sample.ownerAlive = await processIdentity(sample.lock.pid) === sample.lock.processIdentity; } catch {}
  const output = await execute('systemctl', ['show', 'chunk-picker.service', '--property=ActiveState,SubState,MainPID'], { timeout: 10000, windowsHide: true });
  const fields = Object.fromEntries(output.stdout.trim().split('\n').map(row => row.split('=')));
  sample.writerActive = fields.ActiveState === 'active' && fields.SubState === 'running' && Number(fields.MainPID) > 0;
  const failed = await execute('systemctl', ['--failed', '--no-legend', '--plain', '--no-pager'], { timeout: 10000, windowsHide: true });
  sample.failed = failed.stdout.trim().split('\n').filter(Boolean).map(row => row.trim().split(/\s+/)[0]);
  const disk = await statfs(config.diskPath); sample.diskBytes = Number(disk.bavail) * Number(disk.bsize);
  const available = /^MemAvailable:\s+(\d+) kB$/m.exec(await readFile('/proc/meminfo', 'utf8'));
  if (!available) throw Error('Memory evidence unavailable.'); sample.ramBytes = Number(available[1]) * 1024;
  return sample;
}
export async function monitor(config, { sample, now = Date.now(), send } = {}) {
  await directory(config.controlDir);
  return exclusive(path.join(config.controlDir, 'monitor.lock'), async () => {
    const file = path.join(config.controlDir, 'monitor-state.json');
    const previous = await optional(file) ?? {};
    try { sample ??= await collect(config); } catch { sample = { unreadable: true }; }
    const result = evaluate(sample, previous, now);
    await atomic(file, encode({ ...result, at: new Date(now).toISOString() }));
    await notify({ ...config, faults: result.faults, window: sample.window, now, ...(send ? { send } : {}) });
    return result;
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await monitor(await json('/etc/chunk-picker/monitor.json')); }
  catch { process.stderr.write('Monitor failed; inspect privately.\n'); process.exitCode = 1; }
}
