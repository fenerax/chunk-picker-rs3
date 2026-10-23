import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { replaceSidecar } from './plugin-achievements.mjs';

// Live-world item evidence per player: reviewed item IDs seen owned or worn,
// the first snapshot's time, item tasks the player already handled, and the
// newest acknowledged plugin journal event. Beta evidence is never stored.
const ITEM_LIMIT = 500, HANDLED_LIMIT = 2000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(value);

export function validateItemRecord(record) {
  if (!exactKeys(record, ['baselineAt', 'items', 'handled', 'journal']) || !time(record.baselineAt) || !object(record.items)
    || Object.keys(record.items).length > ITEM_LIMIT || !Array.isArray(record.handled) || record.handled.length > HANDLED_LIMIT
    || record.handled.some((id, index, ids) => !text(id, 200) || index > 0 && ids[index - 1] >= id)) throw new TypeError('Invalid plugin item record.');
  for (const [id, fact] of Object.entries(record.items)) {
    if (!/^(0|[1-9]\d{0,6})$/.test(id) || !exactKeys(fact, ['name', 'ownedAt', 'wornAt', 'first']) || !text(fact.name, 80) || !time(fact.ownedAt)
      || fact.wornAt !== null && !time(fact.wornAt) || typeof fact.first !== 'boolean') throw new TypeError('Invalid plugin item fact.');
  }
  if (record.journal !== null && (!exactKeys(record.journal, ['id', 'event']) || !/^[a-f0-9]{16}$/.test(record.journal.id)
    || !Number.isSafeInteger(record.journal.event) || record.journal.event < 0)) throw new TypeError('Invalid plugin item journal.');
  return record;
}

function validate(value) {
  if (!exactKeys(value, ['v', 'players']) || value.v !== 1 || !object(value.players)) throw new TypeError('Invalid plugin item store.');
  for (const [player, record] of Object.entries(value.players)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(player)) throw new TypeError('Invalid plugin item store.');
    validateItemRecord(record);
  }
  return value;
}

/** Sidecar only: the caller owns the save directory's existing lock. */
export async function openPluginItems({ dataDir, members, clock = Date.now, log = console.warn }) {
  const file = path.join(dataDir, 'plugin-items.json');
  let current = { v: 1, players: {} }, corrupt = false, queue = Promise.resolve(), closed = false, contents;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (contents !== undefined) {
    try { current = validate(JSON.parse(contents)); }
    catch {
      corrupt = true;
      log('Invalid plugin item store; starting with no item evidence until the next write.');
    }
  }
  return {
    get(player) { return Object.hasOwn(current.players, player) ? structuredClone(current.players[player]) : null; },
    /** Writes one player's record; members removed from the save are dropped. */
    put(player, record) {
      if (closed) return Promise.reject(Object.assign(new Error('The picker is stopping.'), { status: 503 }));
      try { validateItemRecord(record); } catch (error) { return Promise.reject(error); }
      const value = structuredClone(record);
      const pending = queue.then(async () => {
        const live = new Set(members().map(member => member.id));
        const players = Object.fromEntries(Object.entries(current.players).filter(([id]) => live.has(id)));
        if (live.has(player)) Object.defineProperty(players, player, { value, enumerable: true, configurable: true, writable: true });
        const next = { v: 1, players };
        await replaceSidecar(file, `${JSON.stringify(validate(next))}\n`, corrupt, clock);
        current = next; corrupt = false;
      });
      queue = pending.catch(() => {}); return pending;
    },
    async close() { closed = true; await queue; },
  };
}
