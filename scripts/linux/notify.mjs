import path from 'node:path';
import { isMain } from '../release/vps/entrypoint.mjs';
import { atomic, directory, encode, exclusive, json } from './files.mjs';
import { credential, privateEndpoint } from './ops-status.mjs';

export const messages = Object.freeze({
  'writer-inactive': 'Writer is inactive', 'backup-source': 'Source snapshot is stale or missing',
  'offhost-source': 'Delivered snapshot is stale or missing', 'offhost-delivery': 'Off-site delivery is stale or missing',
  maintenance: 'Maintenance evidence is present', 'maintenance-abandoned': 'Maintenance needs operator reconciliation',
  'operation-long': 'An operation exceeded its time budget', 'disk-low': 'Disk reserve is low',
  'ram-low': 'Available memory is low', 'failed-units': 'System services have failed',
  'operator-fault': 'An operator operation failed', 'health-fault': 'Health recovery failed',
  'backup-fault': 'Recovery backup failed', 'offhost-fault': 'Off-site backup failed',
  'offhost-paused': 'Off-site delivery is deliberately paused',
  'monitor-data': 'Monitoring evidence is unreadable', 'release-window': 'Release window is invalid or expired',
  'unit-writer': 'Writer service failed', 'unit-backup': 'Backup service failed', 'unit-health': 'Health service failed',
  'unit-offhost': 'Off-site service failed', 'unit-monitor': 'Monitor service failed', test: 'Notification delivery test',
});
export const severity = value => ['warning', 'critical', 'urgent'].includes(value);
export function releaseWindow(window, now) {
  const start = Date.parse(window?.startedAt), end = Date.parse(window?.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now && end > start && end - start <= 30 * 60000;
}
export async function notify({ controlDir, faults, window, now = Date.now(), repeatMs = 6 * 3600000,
  send = async content => {
    const response = await fetch(privateEndpoint(await credential('discord-webhook'), 'discord'), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
    if (!response.ok) throw Error('Notification delivery failed.');
  }, merge = false }) {
  await directory(controlDir);
  return exclusive(path.join(controlDir, 'notify.lock'), async () => {
    const file = path.join(controlDir, 'notify-state.json');
    let state = { active: {}, announced: {}, sent: [] }; try { state = await json(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const active = merge ? { ...state.active } : {};
    for (const [code, level] of Object.entries(faults)) {
      if (!Object.hasOwn(messages, code) || !severity(level)) throw Error('Unknown notification category.');
      active[code] = level;
    }
    const suppressed = new Set(releaseWindow(window, now) ? ['writer-inactive', 'maintenance', 'maintenance-abandoned', 'unit-writer'] : []);
    repeatMs = Math.max(3600000, Math.min(24 * 3600000, Number(repeatMs) || 6 * 3600000));
    // Events outlive active conditions. Persist the outbox and attempt BEFORE
    // sending; a crash can duplicate delivery but cannot acknowledge a loss.
    const events = state.pending ?? [];
    if (!state.pending) for (const [code, level] of Object.entries(state.active)) {
      if (!state.announced[code]) events.push({ code, level });
    }
    for (const [code, level] of Object.entries(active)) {
      const previous = state.announced[code];
      const latest = events.findLast(row => row.code === code);
      if (!suppressed.has(code) && (latest ? latest.level !== level : !previous || previous.level !== level || level !== 'warning' && now - previous.at >= repeatMs))
        events.push({ code, level });
    }
    for (const code of new Set([...Object.keys(state.announced), ...events.map(row => row.code)])) {
      if (!active[code] && (events.findLast(row => row.code === code)?.level ?? (!events.some(row => row.code === code) && state.announced[code]?.level))) events.push({ code });
    }
    const sent = state.sent.filter(at => at > now - 10 * 60000);
    const attempts = (state.attempts ?? state.sent).filter(at => at > now - 10 * 60000);
    const permitted = attempts.length < 4 && (!attempts.length || now - attempts.at(-1) >= 30000);
    let delivered = false;
    const text = row => (row.level ? row.level.toUpperCase() + ': ' : 'RECOVERED: ') + messages[row.code];
    const batch = []; let length = 13;
    for (const row of events) { if (length + text(row).length + 1 > 1900) break; batch.push(row); length += text(row).length + 1; }
    if (events.length && permitted) {
      // Codes and fixed phrases only. Never interpolate journal/error/config input.
      attempts.push(now);
      await atomic(file, encode({ active, announced: state.announced, sent, attempts, pending: events }));
      try {
        await send('Chunk picker\n' + batch.map(text).join('\n'));
        for (const row of batch) {
          if (row.level) state.announced[row.code] = { level: row.level, at: now };
          else delete state.announced[row.code];
        }
        sent.push(now); delivered = true;
      } catch {} // Keep pending events durable for the next monitor attempt.
    }
    const pending = delivered ? events.slice(batch.length) : events;
    await atomic(file, encode({ active, announced: state.announced, sent, attempts, pending }));
    return { delivered, pending: pending.length > 0 };
  });
}
export const failureUnits = Object.freeze({ 'chunk-picker.service': 'unit-writer', 'chunk-picker-backup.service': 'unit-backup',
  'chunk-picker-health.service': 'unit-health', 'chunk-picker-offhost.service': 'unit-offhost', 'chunk-picker-monitor.service': 'unit-monitor' });
if (isMain(import.meta.url)) {
  try {
    const config = await json('/etc/chunk-picker/monitor.json'), command = process.argv[2];
    const code = command === 'test' ? 'test' : failureUnits[command];
    if (!code) throw Error();
    const result = await notify({ ...config, faults: { [code]: 'critical' }, merge: true });
    if (!result.delivered && command === 'test') throw Error();
  } catch { process.stderr.write('Notification pending; inspect private configuration.\n'); process.exitCode = 1; }
}
