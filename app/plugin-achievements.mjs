import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const LIMIT = 20000;
const validId = id => Number.isSafeInteger(id) && id >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function validate(value) {
  if (!exactKeys(value, ['v', 'players']) || value.v !== 1 || !object(value.players)) {
    throw new TypeError('Invalid plugin achievement store.');
  }
  for (const [player, record] of Object.entries(value.players)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(player) || !exactKeys(record, ['handled'])
      || !Array.isArray(record.handled) || record.handled.length > LIMIT
      || record.handled.some((id, index, ids) => !validId(id) || index > 0 && ids[index - 1] >= id)) {
      throw new TypeError('Invalid plugin achievement record.');
    }
  }
  return value;
}

async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}

async function archivePath(file, timestamp) {
  const base = `${file}.corrupt-${timestamp}`;
  for (let suffix = 0; ; suffix++) {
    const candidate = suffix ? `${base}-${suffix}` : base;
    try { await lstat(candidate); }
    catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
  }
}

async function write(file, value, corrupt, clock) {
  const contents = `${JSON.stringify(validate(value))}\n`;
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle, archived;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents); await handle.sync(); await handle.close(); handle = null;
    if (corrupt) {
      const destination = await archivePath(file, clock());
      await renameWithRetry(file, destination); archived = destination;
    }
    try { await renameWithRetry(temporary, file); }
    catch (error) {
      if (archived) {
        try { await renameWithRetry(archived, file); }
        catch (restoreError) {
          throw new AggregateError([error, restoreError], 'Could not replace the plugin achievement store; its original remains in the corrupt archive.');
        }
      }
      throw error;
    }
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
}

/** Sidecar only: the caller owns the save directory's existing lock. */
export async function openPluginAchievements({ dataDir, members, clock = Date.now, log = console.warn }) {
  const file = path.join(dataDir, 'plugin-achievements.json');
  let current = { v: 1, players: {} }, corrupt = false, queue = Promise.resolve(), closed = false;
  let contents;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (contents !== undefined) {
    try { current = validate(JSON.parse(contents)); }
    catch {
      corrupt = true;
      log('Invalid plugin achievement store; using an empty handled set until the next handled write.');
    }
  }
  return {
    has(player, id) {
      if (!validId(id) || !Object.hasOwn(current.players, player)) return false;
      const ids = current.players[player].handled;
      let low = 0, high = ids.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (ids[middle] < id) low = middle + 1; else high = middle;
      }
      return ids[low] === id;
    },
    add(player, ids) {
      if (closed) return Promise.reject(Object.assign(new Error('The picker is stopping.'), { status: 503 }));
      if (!Array.isArray(ids)) return Promise.reject(new TypeError('Invalid handled achievement IDs.'));
      const incoming = [...new Set(ids)];
      if (incoming.some(id => !validId(id))) return Promise.reject(new TypeError('Invalid handled achievement IDs.'));
      incoming.sort((a, b) => a - b);
      const pending = queue.then(async () => {
        const live = new Set(members().map(member => member.id));
        const next = { v: 1, players: Object.fromEntries(Object.entries(current.players).filter(([id]) => live.has(id))) };
        let changed = Object.keys(next.players).length !== Object.keys(current.players).length;
        if (live.has(player)) {
          const previous = Object.hasOwn(next.players, player) ? next.players[player].handled : [];
          const handled = new Set(previous);
          for (const id of incoming) {
            if (handled.size >= LIMIT) break;
            handled.add(id);
          }
          if (handled.size !== previous.length) {
            Object.defineProperty(next.players, player, { value: { handled: [...handled].sort((a, b) => a - b) }, enumerable: true, configurable: true, writable: true });
            changed = true;
          }
        }
        if (changed) {
          await write(file, next, corrupt, clock);
          current = next; corrupt = false;
        }
      });
      queue = pending.catch(() => {}); return pending;
    },
    async close() { closed = true; await queue; },
  };
}
