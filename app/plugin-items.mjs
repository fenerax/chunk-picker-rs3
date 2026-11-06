import { withStoreWrite } from './storage/snapshot.mjs';
import { readFile, realpath, open, unlink } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { replaceSidecar } from './plugin-achievements.mjs';
import { publishFile } from './storage/publication.mjs';
import { GAME_ITEMS, GAME_WORN_TASKS } from './integrations/game-items.mjs';
import { capturePluginItemFiles, pluginItemFiles, withPluginItemEvidenceWrite } from './storage/plugin-item-snapshot.mjs';
export { capturePluginItemFiles, pluginItemFiles } from './storage/plugin-item-snapshot.mjs';

// Live-world item evidence per player: item IDs seen owned or worn,
// the first snapshot's time, item tasks the player already handled, and the
// newest processed plugin journal event, and when the bank was last seen with its
// coins. Non-live journals use separate files with the same bounded record shape.
import { validateItemRecord, validateJournalCommits, mergeItemRecords, mergeJournalCommits, mergePluginItemEvidence, portablePluginItemEvidence } from './core/plugin-item-evidence.mjs';
export { validateItemRecord } from './core/plugin-item-evidence.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const gunzipAsync = promisify(gunzip);

async function capturedInheritedEvidence(dataDir, files) {
  if (!files['state.json']) return;
  const document = JSON.parse(files['state.json']);
  const reference = document.storage?.fields?.provenance;
  if (!reference) return portablePluginItemEvidence(document.state);
  // Static fields are immutable and content addressed. Resolve the exact field
  // pinned by the captured state, never a later worker or in-memory state.
  if (!exactKeys(reference, ['id', 'sha256']) || !/^[a-f0-9]{64}$/.test(reference.sha256)
    || reference.id !== `static-${reference.sha256}.json.gz`) throw new TypeError('Invalid static provenance reference.');
  const base = await realpath(path.join(dataDir, 'static'));
  const file = await realpath(path.join(base, reference.id));
  if (path.dirname(file) !== base) throw new TypeError('Invalid static provenance location.');
  const bytes = await gunzipAsync(await readFile(file));
  if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new TypeError('Static provenance checksum mismatch.');
  return portablePluginItemEvidence({ ...document.state, provenance: JSON.parse(bytes) });
}

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
const commitFile = 'plugin-item-journal-commits.json';
const REVIEW = '~plugin-review:';
const ITEM_TASKS = new Set([...GAME_ITEMS.values()].map(item => item.goalId).concat([...GAME_WORN_TASKS.keys()]));
const AUTO_TASKS = new Set([...GAME_ITEMS.values()].map(item => item.goalId));
const reviewError = message => Object.assign(new Error(`${message} Nothing was applied or dismissed.`), { status: 422, code: 'PLUGIN_ITEM_REVIEW_CAPACITY' });
export const hasPluginItemDecisions = evidence => Object.values(evidence?.players ?? {}).some(player => player.records.live?.handled.some(id => id.startsWith(REVIEW)));
export async function hasLegacyPluginItemDecisions(dataDir) {
  let document;
  try { document = JSON.parse(await readFile(path.join(dataDir, 'plugin-items.json'))); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  return Object.values(document?.players ?? {}).some(record => Array.isArray(record?.handled)
    && record.handled.some(id => typeof id === 'string' && id.startsWith(REVIEW)));
}
function decisionIds(record) {
  return (record?.handled ?? []).filter(id => id.startsWith(REVIEW)).map(id => {
    const task = id.slice(REVIEW.length);
    if (!ITEM_TASKS.has(task)) throw new TypeError('Invalid plugin item review marker.');
    return task;
  });
}
export function recoverPluginItemDecisions(evidence) {
  const next = mergePluginItemEvidence(evidence);
  for (const player of Object.values(next.players)) {
    const tasks = decisionIds(player.records.live);
    if (tasks.length) lowerDecisions(player.records.live, tasks);
  }
  return mergePluginItemEvidence(next);
}

function lowerDecisions(live, taskIds) {
  const handled = new Set([...live.handled, ...taskIds, ...taskIds.map(id => REVIEW + id)]);
  // Frozen automatic ticks slice to 2,000. Reserve every remaining possible
  // automatic task so rollback can never evict an accepted explicit decision.
  const reserved = [...AUTO_TASKS].filter(id => !handled.has(id)).length;
  if (handled.size + reserved > 2000) throw reviewError('This review exceeds the rollback sidecar capacity (2,000 handled IDs, including review markers and automatic-task reserve). Free reviewed obsolete entries, then retry.');
  live.handled = [...handled].sort();
}

// The adapter returns plain, validated data. Import never writes paths supplied by a backup.
export async function exportPluginItemEvidence(dataDir, mapPlayerId = id => id, inherited, captureOptions) {
  const files = await capturePluginItemFiles(dataDir, captureOptions);
  // A worker's supplied state may predate a concurrent import. Include the
  // inherited evidence published alongside the captured sidecar generations.
  const persisted = await capturedInheritedEvidence(dataDir, files);
  // A state-first publication is not exportable until its legacy projection is
  // verified. Writable startup alone may repair this interrupted publication.
  if (!captureOptions?.recoverReview && hasPluginItemDecisions(persisted)) {
    const live = files['plugin-items.json'] && validate(JSON.parse(files['plugin-items.json']));
    for (const [id, player] of Object.entries(persisted.players)) {
      if (decisionIds(player.records.live).some(task => !live?.players[id]?.handled.includes(task)
        || !live.players[id].handled.includes(REVIEW + task))) throw Object.assign(new Error('Plugin review publication needs recovery; retry after the receiver reopens.'), { status: 503 });
    }
  }
  const players = new Map();
  for (const file of pluginItemFiles) {
    const contents = files[file];
    if (contents === undefined) continue;
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
  return importPluginItemEvidence(dataDir, mergePluginItemEvidence(inherited, persisted, { v: 1, players: Object.fromEntries(players) }), mapPlayerId);
}

export function importPluginItemEvidence(_dataDir, evidence, mapPlayerId = id => id) {
  const checked = recoverPluginItemDecisions(evidence);
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

// Explicit review decisions apply to tasks, independently of the world chosen
// for the displayed row. Work on a validated copy; no scope may change until
// every supporting scope has room for the complete decision.
export function dismissPluginItemEvidence(evidence, memberId, taskIds, unmappedIds, at = new Date().toISOString()) {
  const next = mergePluginItemEvidence(evidence);
  const player = next.players[memberId], tasks = new Set(taskIds), unmapped = new Set(unmappedIds), decisions = new Map();
  const support = (world, itemId, worn) => {
    const ids = decisions.get(world) ?? new Set(), item = GAME_ITEMS.get(itemId);
    if (item && tasks.has(item.goalId)) ids.add(item.goalId);
    if (worn) for (const [taskId, items] of GAME_WORN_TASKS) if (tasks.has(taskId) && items.has(itemId)) ids.add(taskId);
    if (unmapped.has(itemId)) ids.add(`unmapped:${itemId}`);
    if (ids.size) decisions.set(world, ids);
  };
  for (const [world, record] of Object.entries(player?.records ?? {})) {
    for (const [id, fact] of Object.entries(record.items)) support(world, Number(id), !!fact.wornAt);
  }
  // Durable pending intents also support tasks, even when their scope write
  // failed. Retain the decision now, without manufacturing or acknowledging facts.
  for (const journal of player?.commits.journals ?? []) {
    for (const [, id, , world] of journal.pending) support(world, id, !GAME_ITEMS.get(id)?.noted);
  }
  for (const [world, ids] of decisions) {
    const record = player.records[world] ??= { baselineAt: at, items: {}, handled: [], journal: null };
    const handled = new Set([...record.handled, ...ids]);
    if (handled.size > 2000) throw Object.assign(new Error(`This review cannot be saved: the ${world === 'unknown' ? 'unknown-world' : world} item evidence would exceed 2,000 handled IDs. Nothing was applied or dismissed. Ask the operator to review the retained evidence and free space, then retry.`),
      { status: 422, code: 'PLUGIN_ITEM_REVIEW_CAPACITY' });
    record.handled = [...handled].sort();
  }
  if (unmappedIds.length) throw reviewError('This review contains unmapped items. The rollback release cannot retain dismissals for those identities. Keep this review until the items are mapped.');
  if (taskIds.some(id => !ITEM_TASKS.has(id))) throw reviewError('The rollback release cannot represent one of these item tasks.');
  if (taskIds.some(id => !decisions.get('live')?.has(id))) throw reviewError('This review contains tasks supported only by beta or unknown-world evidence. The rollback release cannot retain those decisions. Keep the review until live evidence supports every task.');
  if (taskIds.length) {
    const owner = next.players[memberId] ??= { records: {}, commits: { journals: [] } };
    const live = owner.records.live ??= { baselineAt: at, items: {}, handled: [], journal: null };
    lowerDecisions(live, taskIds);
  }
  return mergePluginItemEvidence(next);
}

// Prepare and sync without changing either authoritative file. The store uses
// state.json as its recovery record, verifies this projection before adoption,
// and restores both previous byte streams if publication is refused.
export async function stagePluginItemDecisions(dataDir, evidence, { checkOnly = false } = {}) {
  if (!hasPluginItemDecisions(evidence)) return;
  const file = path.join(dataDir, 'plugin-items.json');
  const before = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const previous = before === undefined ? { v: 1, players: {} } : validate(JSON.parse(before));
  const players = {};
  for (const [id, player] of Object.entries(evidence.players)) {
    const record = mergeItemRecords(previous.players[id], player.records.live);
    if (record) {
      const tasks = decisionIds(record);
      if (tasks.length) lowerDecisions(record, tasks);
      players[id] = record;
    }
  }
  const after = Buffer.from(`${JSON.stringify(validate({ v: 1, players }))}\n`);
  if (before?.equals(after)) return;
  if (checkOnly) return true;
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(after); await handle.sync(); await handle.close(); handle = undefined;
    if (!(await readFile(temporary)).equals(after)) throw new Error('Plugin item lowering preparation verification failed.');
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  const same = async bytes => (await readFile(file)).equals(bytes);
  return { before, file,
    async publish() { await publishFile(temporary, file); if (!await same(after)) throw new Error('Plugin item lowering verification failed.'); },
    async verifyRollback() { if (before === undefined) { try { await readFile(file); throw new Error('Plugin item rollback verification failed.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } } else if (!await same(before)) throw new Error('Plugin item rollback verification failed.'); },
    async cancel() { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); } };
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
      const pending = queue.then(() => withStoreWrite(dataDir, () => withPluginItemEvidenceWrite(dataDir, async () => {
        // A review publication may have lowered newer decisions since this
        // reader opened. Another player's write must retain those exact bytes.
        try { current = validate(JSON.parse(await readFile(file)), validateRecord); corrupt = false; }
        catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
          if (error.code !== 'ENOENT') corrupt = true;
        }
        const live = new Set(members().map(member => member.id));
        const players = Object.fromEntries(Object.entries(current.players).filter(([id]) => live.has(id)));
        // A report may have read its record before an import published. Validate
        // against the now-current inherited evidence before changing the sidecar.
        const combined = merge(inherited(player), Object.hasOwn(players, player) ? players[player] : null, value);
        if (live.has(player)) Object.defineProperty(players, player, { value: combined, enumerable: true, configurable: true, writable: true });
        const next = { v: 1, players };
        await replaceSidecar(file, `${JSON.stringify(validate(next, validateRecord))}\n`, corrupt, clock);
        current = next; corrupt = false;
      })));
      queue = pending.catch(() => {}); return pending;
    },
    async close() { closed = true; await queue; },
  };
}
