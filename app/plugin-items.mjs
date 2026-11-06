import { withStoreWrite } from './storage/snapshot.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { replaceSidecar } from './plugin-achievements.mjs';

// Live-world item evidence per player: item IDs seen owned or worn,
// the first snapshot's time, item tasks the player already handled, and the
// newest processed plugin journal event, and when the bank was last seen with its
// coins. Non-live journals use separate files with the same bounded record shape.
import { validateItemRecord, validateJournalCommits, mergeItemRecords, mergeJournalCommits, mergePluginItemEvidence } from './core/plugin-item-evidence.mjs';
export { validateItemRecord } from './core/plugin-item-evidence.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validate(value, validateRecord = validateItemRecord) {
  if (!exactKeys(value, ['v', 'players']) || value.v !== 1 || !object(value.players)) throw new TypeError('Invalid plugin item store.');
  for (const [player, record] of Object.entries(value.players)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(player)) throw new TypeError('Invalid plugin item store.');
    validateRecord(record);
  }
  return value;
}

const journalWorlds = ['beta', 'unknown'];
const pluginItemFile = journalWorld => journalWorld ? `plugin-item-journal-${journalWorld}.json` : 'plugin-items.json';
/** Every durable item-evidence sidecar; service recovery copies exactly these names. */
const commitFile = 'plugin-item-journal-commits.json';
export const pluginItemFiles = Object.freeze([pluginItemFile(), ...journalWorlds.map(pluginItemFile), commitFile]);

// The adapter returns plain, validated data. Import never writes paths supplied by a backup.
export async function exportPluginItemEvidence(dataDir, mapPlayerId = id => id, inherited) {
  const players = new Map();
  for (const file of pluginItemFiles) {
    let contents;
    try { contents = await readFile(path.join(dataDir, file), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const commits = file === commitFile;
    const document = validate(JSON.parse(contents), commits ? validateJournalCommits : validateItemRecord);
    const world = file === pluginItemFile() ? 'live' : file === pluginItemFile('beta') ? 'beta' : 'unknown';
    for (const [id, value] of Object.entries(document.players)) {
      const record = players.get(id) ?? { records: {}, commits: { journals: [] } };
      if (commits) record.commits = mergeJournalCommits(record.commits, value);
      else record.records[world] = mergeItemRecords(record.records[world], value);
      players.set(id, record);
    }
  }
  return importPluginItemEvidence(dataDir, mergePluginItemEvidence(inherited, { v: 1, players: Object.fromEntries(players) }), mapPlayerId);
}

export function importPluginItemEvidence(_dataDir, evidence, mapPlayerId = id => id) {
  const checked = mergePluginItemEvidence(evidence);
  const players = new Map();
  for (const [id, record] of Object.entries(checked.players)) {
    const target = mapPlayerId(id);
    if (target === undefined || target === null) continue;
    if (typeof target !== 'string') throw new TypeError('Invalid destination player ID.');
    if (players.has(target)) throw new TypeError('Plugin item evidence needs distinct destination players.');
    players.set(target, record);
  }
  return mergePluginItemEvidence({ v: 1, players: Object.fromEntries(players) });
}

export function openPluginJournalCommits(options) {
  return openPluginRecords({ ...options, filename: commitFile, validateRecord: validateJournalCommits, merge: mergeJournalCommits });
}

/** Sidecar only: the caller owns the save directory's existing lock. */
export async function openPluginItems({ journalWorld, ...options }) {
  if (journalWorld !== undefined && !journalWorlds.includes(journalWorld)) throw new TypeError('Invalid journal world.');
  return openPluginRecords({ ...options, filename: pluginItemFile(journalWorld), validateRecord: validateItemRecord, merge: mergeItemRecords });
}

async function openPluginRecords({ dataDir, members, clock = Date.now, log = console.warn, filename, validateRecord, merge, inherited = () => null }) {
  const file = path.join(dataDir, filename);
  let current = { v: 1, players: {} }, corrupt = false, queue = Promise.resolve(), closed = false, contents;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (contents !== undefined) {
    try { current = validate(JSON.parse(contents), validateRecord); }
    catch {
      corrupt = true;
      log('Invalid plugin item store; starting with no item evidence until the next write.');
    }
  }
  return {
    get(player) { return merge(inherited(player), Object.hasOwn(current.players, player) ? current.players[player] : null); },
    /** Writes one player's record; members removed from the save are dropped. */
    put(player, record) {
      if (closed) return Promise.reject(Object.assign(new Error('The picker is stopping.'), { status: 503 }));
      try { validateRecord(record); } catch (error) { return Promise.reject(error); }
      const value = structuredClone(record);
      const pending = queue.then(() => withStoreWrite(dataDir, async () => {
        const live = new Set(members().map(member => member.id));
        const players = Object.fromEntries(Object.entries(current.players).filter(([id]) => live.has(id)));
        if (live.has(player)) Object.defineProperty(players, player, { value, enumerable: true, configurable: true, writable: true });
        const next = { v: 1, players };
        await replaceSidecar(file, `${JSON.stringify(validate(next, validateRecord))}\n`, corrupt, clock);
        current = next; corrupt = false;
      }));
      queue = pending.catch(() => {}); return pending;
    },
    async close() { closed = true; await queue; },
  };
}
