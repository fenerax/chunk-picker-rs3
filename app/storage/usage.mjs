import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { usageEvents } from '../web/usage-catalogue.mjs';

export const USAGE_MAX_BYTES = 32 * 1024;
export const USAGE_MAX_ROWS = 200;
export const USAGE_RETENTION_DAYS = 180;
const DAY_MS = 86400000;
const DEVICES = new Set(['desktop', 'phone']);
const EVENT_PATTERN = /^[a-z][a-z0-9]*(?:[-:][a-z0-9]+)*$/;
const eventIds = new Set(usageEvents.map(event => event.id));
const failure = (status, message) => Object.assign(new Error(message), { status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function dayNumber(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time / DAY_MS : NaN;
}
const today = now => Math.floor(new Date(now()).getTime() / DAY_MS);
const rowKey = row => JSON.stringify([row.id, row.actor, row.device, row.day]);
function validRow(row, actors, maximum) {
  return exactKeys(row, ['id', 'actor', 'device', 'day', 'count'])
    && typeof row.id === 'string' && EVENT_PATTERN.test(row.id) && eventIds.has(row.id)
    && actors.has(row.actor) && DEVICES.has(row.device) && Number.isFinite(dayNumber(row.day))
    && Number.isSafeInteger(row.count) && row.count >= 1 && row.count <= maximum;
}

/** Only aggregate counts cross this boundary; identity comes from the session. */
export function validateUsagePayload(input, { actors, actor, now = Date.now } = {}) {
  const known = new Set([...actors, 'viewer', 'unlinked']);
  if (!known.has(actor) || !exactKeys(input, ['counts']) || !Array.isArray(input.counts)
    || input.counts.length < 1 || input.counts.length > USAGE_MAX_ROWS) throw failure(400, 'Send between 1 and 200 usage count rows.');
  const currentDay = today(now);
  return input.counts.map(row => {
    if (!validRow(row, known, 1000) || dayNumber(row.day) > currentDay
      || dayNumber(row.day) <= currentDay - USAGE_RETENTION_DAYS) throw failure(400, 'Invalid usage count row.');
    return { ...row, actor };
  });
}

async function atomicWrite(file, document) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(document)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await delay(20 * 2 ** attempt);
      }
    }
  } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); }
}

/** Shares the gameplay directory lock, but never writes gameplay or its backups. */
export async function openUsageStore({ dataDir, actors, now = Date.now, readOnly = false } = {}) {
  const file = path.join(dataDir, 'usage.json'), known = new Set([...actors, 'viewer', 'unlinked']);
  let current = { schemaVersion: 1, counts: [] }, queue = Promise.resolve(), closed = false;
  const retained = rows => {
    const day = today(now);
    return rows.filter(row => dayNumber(row.day) > day - USAGE_RETENTION_DAYS && dayNumber(row.day) <= day);
  };
  try {
    current = JSON.parse(await readFile(file, 'utf8'));
    if (!exactKeys(current, ['schemaVersion', 'counts']) || current.schemaVersion !== 1 || !Array.isArray(current.counts)
      || current.counts.some(row => !validRow(row, known, Number.MAX_SAFE_INTEGER))
      || new Set(current.counts.map(rowKey)).size !== current.counts.length) throw new TypeError('Invalid usage store.');
    const counts = retained(current.counts);
    if (counts.length !== current.counts.length) { current = { schemaVersion: 1, counts }; if (!readOnly) await atomicWrite(file, current); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  function enqueue(operation) {
    if (closed) return Promise.reject(failure(503, 'Usage storage is closed.'));
    const pending = queue.then(operation);
    queue = pending.catch(() => {}); return pending;
  }
  return {
    add(input, actor) {
      if (readOnly) return Promise.reject(failure(503, 'Usage storage is read only.'));
      const rows = validateUsagePayload(input, { actors, actor, now });
      return enqueue(async () => {
        const merged = new Map(retained(current.counts).map(row => [rowKey(row), { ...row }]));
        // Recheck retention inside the queue in case a request straddles midnight.
        for (const row of retained(rows)) {
          const key = rowKey(row), previous = merged.get(key);
          if (previous) {
            if (!Number.isSafeInteger(previous.count + row.count)) throw failure(400, 'Usage count is too large.');
            previous.count += row.count;
          } else merged.set(key, { ...row });
        }
        const next = { schemaVersion: 1, counts: [...merged.values()].sort((a, b) => rowKey(a).localeCompare(rowKey(b))) };
        await atomicWrite(file, next); current = next;
      });
    },
    read() {
      return enqueue(async () => {
        const counts = retained(current.counts);
        if (counts.length !== current.counts.length) {
          const next = { schemaVersion: 1, counts }; if (!readOnly) await atomicWrite(file, next); current = next;
        }
        return structuredClone(current);
      });
    },
    async close() { closed = true; await queue; },
  };
}
