import path from 'node:path';
import { readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomic, directory, encode, exists } from './files.mjs';

const resetRow = () => ({ code: 'notifier-reset', level: 'critical', at: 0 });
async function quarantine(file, target, controlDir) {
  // A fixed, coalescing intent is fsynced (including its directory) BEFORE
  // removing corrupt evidence from the normal retry path. Only the sender,
  // under notify.lock, publishes or acknowledges this marker.
  await atomic(path.join(controlDir, 'notify-reset.json'), encode(resetRow()));
  await rename(file, target);
}
export async function resetIntent(controlDir) {
  const file = path.join(controlDir, 'notify-reset.json');
  // Presence is the intent; never interpret possibly corrupt marker bytes.
  return await exists(file) ? [{ file, row: { ...resetRow(), reset: true } }] : [];
}

export const outboxLimits = Object.freeze({ events: 96, bytes: 16384, stateBytes: 32768 });
// Fixed mailboxes per category and transition. Repeated identical transitions
// coalesce at publication; assertion and recovery use DIFFERENT mailboxes so
// even a whole outage behind a busy sender survives. No producer takes a lock.
export async function enqueue(controlDir, faults, codes, { merge, now, suppressed }) {
  const spool = path.join(controlDir, 'notify-spool'); await directory(spool);
  for (const code of merge ? Object.keys(faults) : codes) {
    const level = faults[code];
    await atomic(path.join(spool, code + '.' + (level ?? 'recovered') + '.json'),
      encode({ code, ...(level ? { level } : {}), at: now, suppressed: suppressed.has(code) }));
  }
  return spool;
}
export async function drain(spool, codes) {
  const files = [];
  const read = async (file, code, level) => {
    try {
      const row = JSON.parse(await readFile(file, 'utf8'));
      if (!row || row.code !== code || row.level !== (level === 'recovered' ? undefined : level)
        || !Number.isFinite(row.at) || typeof row.suppressed !== 'boolean') throw Error('Invalid mailbox.');
      return row;
    } catch (error) {
      if (error.code === 'ENOENT') throw error;
      await quarantine(file, path.join(path.dirname(spool), 'notify-mailbox.reset-' + randomUUID()), path.dirname(spool));
      return resetRow();
    }
  };
  // Resume claimed mailboxes first after a crash. Claim by rename before read:
  // a producer publishing during delivery creates a new, independently durable
  // mailbox which acknowledgement can never unlink.
  for (const code of codes) for (const level of ['warning', 'critical', 'urgent', 'recovered']) {
    const file = path.join(spool, code + '.' + level + '.json'), claimed = file + '.claimed';
    try { files.push({ file: claimed, row: await read(claimed, code, level) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Do not replace a crash survivor until its contents are in the outbox.
    if (files.some(entry => entry.file === claimed)) continue;
    try { await rename(file, claimed); files.push({ file: claimed, row: await read(claimed, code, level) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files.sort((a, b) => a.row.at - b.row.at || Number(!a.row.level) - Number(!b.row.level));
}
// Call only after atomic() has fsynced the replacement outbox. An unlink lost
// on reboot can replay evidence, but cannot erase the pending delivery.
export async function acknowledge(entries) { for (const { file } of entries) await rm(file, { force: true }); }
export function compact(events, dropped = 0, limits = outboxLimits) {
  const rows = [];
  for (const code of new Set(events.map(row => row.code))) {
    const same = events.filter(row => row.code === code), incident = same.find(row => row.level), latest = same.at(-1);
    // Keep the first incident and the newest state, including recovery. This
    // retains the fact of a short outage while collapsing repeated flapping.
    if (incident) rows.push(incident);
    if (latest !== incident) rows.push(latest);
    dropped += same.length - (incident ? 1 : 0) - (latest !== incident ? 1 : 0);
  }
  const size = () => Buffer.byteLength(encode({ pending: rows, dropped }));
  while (rows.length > limits.events || size() > limits.bytes) {
    // Protect the oldest unresolved incident and the globally newest state.
    const newest = rows.reduce((a, b) => (b.at ?? 0) >= (a?.at ?? 0) ? b : a, null);
    const oldest = rows.find(row => row.level && !rows.some(other => other.code === row.code && !other.level));
    let index = rows.findIndex(row => row !== newest && row !== oldest);
    if (index < 0) throw Error('Outbox limits cannot retain required evidence.');
    rows.splice(index, 1); dropped++;
  }
  return { pending: rows, dropped: Math.min(Number.MAX_SAFE_INTEGER, dropped) };
}
export async function loadState(file, codes, severity, now) {
  const fresh = () => ({ active: {}, announced: {}, sent: [], attempts: [], pending: [], dropped: 0 });
  try {
    const state = JSON.parse(await readFile(file, 'utf8'));
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const levels = value => object(value) && Object.entries(value).every(([code, level]) => codes.includes(code) && severity(level));
    const timestamp = value => Number.isFinite(value) && value >= 0 && value <= now;
    const times = value => Array.isArray(value) && value.length <= 4 && value.every(timestamp);
    if (!object(state) || !levels(state.active) || !object(state.announced)
      || !Object.entries(state.announced).every(([code, row]) => codes.includes(code) && object(row) && severity(row.level) && timestamp(row.at))
      || !times(state.sent) || state.attempts !== undefined && !times(state.attempts)
      || state.pending !== undefined && (!Array.isArray(state.pending) || !state.pending.every(row => object(row) && codes.includes(row.code)
        && (row.level === undefined || severity(row.level)) && (row.at === undefined || timestamp(row.at))))
      || state.dropped !== undefined && (!Number.isSafeInteger(state.dropped) || state.dropped < 0)) throw Error('Invalid state.');
    // Retain only the wire schema; ignored/legacy properties cannot inflate
    // the bounded state or become message content.
    return { active: state.active, announced: Object.fromEntries(Object.entries(state.announced).map(([code, row]) => [code, { level: row.level, at: row.at }])),
      sent: state.sent, attempts: state.attempts, dropped: state.dropped,
      ...(state.pending ? { pending: state.pending.map(row => ({ code: row.code, ...(row.level ? { level: row.level } : {}), at: row.at ?? 0 })) } : {}) };
  } catch (error) {
    if (error.code === 'ENOENT') return fresh();
    // Never include corrupt bytes in an alert. Rename preserves evidence and
    // atomically removes the bad state from the delivery path.
    await quarantine(file, file + '.reset-' + randomUUID(), path.dirname(file));
    return fresh();
  }
}
