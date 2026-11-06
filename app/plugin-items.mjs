import { withStoreWrite } from './storage/snapshot.mjs';
import { readFile, realpath, open, unlink } from 'node:fs/promises';
import { optionalPluginData } from './core/optional-plugin-data.mjs';
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
import { validateItemRecord, validateJournalCommits, mergeItemHandled, mergeItemRecords, mergeJournalCommits, mergePluginItemEvidence, portablePluginItemEvidence } from './core/plugin-item-evidence.mjs';
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

export function validatePluginItemStore(value, validateRecord = validateReviewRecord) {
  if (!exactKeys(value, ['v', 'players']) || value.v !== 1 || !object(value.players)
    || Object.keys(value.players).length > 256) throw new TypeError('Invalid plugin item store.');
  for (const [player, record] of Object.entries(value.players)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(player) || ['__proto__', 'constructor', 'prototype'].includes(player)) throw new TypeError('Invalid plugin item store.');
    validateRecord(record);
  }
  return value;
}
const validate = validatePluginItemStore;

function validateReviewRecord(record) {
  validateItemRecord(record);
  decisionIds(record);
  return record;
}

// Validate each optional source completely before it enters any merge. Keep
// authoritative provenance and cross-source union validation outside this catch.
// Readers never overwrite corrupt bytes; the existing writer archives them.
function optionalDocument(contents, validateRecord = validateReviewRecord, log = console.warn) {
  try { return validate(JSON.parse(contents), validateRecord); }
  catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
    log('Invalid plugin item store; ignoring corrupt optional evidence until the next write.');
    return null;
  }
}

const journalWorlds = ['beta', 'unknown'];
const pluginItemFile = journalWorld => journalWorld ? `plugin-item-journal-${journalWorld}.json` : 'plugin-items.json';
const commitFile = 'plugin-item-journal-commits.json';
const REVIEW = '~plugin-review:';
const MARKER_TASK = /^rs3:(?:task|goal):[A-Za-z0-9%._~-]+(?::[A-Za-z0-9%._~-]+)*$/;
const ITEM_TASKS = new Set([...GAME_ITEMS.values()].map(item => item.goalId).concat([...GAME_WORN_TASKS.keys()]));
const AUTO_TASKS = new Set([...GAME_ITEMS.values()].map(item => item.goalId));
export const hasPluginItemDecisions = evidence => Object.values(evidence?.players ?? {}).some(player =>
  Object.values(player.records).some(record => record.handled.some(id => id.startsWith(REVIEW))));
export async function hasLegacyPluginItemDecisions(dataDir) {
  let document;
  try { document = optionalDocument(await readFile(path.join(dataDir, 'plugin-items.json'))); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  return Object.values(document?.players ?? {}).some(record => Array.isArray(record?.handled)
    && record.handled.some(id => typeof id === 'string' && id.startsWith(REVIEW)));
}
function decisionIds(record) {
  return (record?.handled ?? []).filter(id => id.startsWith(REVIEW)).map(id => {
    const task = id.slice(REVIEW.length);
    // Check stable ID syntax, not today's catalogue: a marker for a task that
    // was later retired is still a healthy historical decision.
    if (!MARKER_TASK.test(task)) throw new TypeError('Invalid plugin item review marker.');
    return task;
  });
}
export function samePluginItemDecisions(left, right) {
  const projection = evidence => Object.keys(evidence?.players ?? {}).sort().flatMap(id => {
    return Object.keys(evidence.players[id].records).sort().flatMap(world => {
      const tasks = decisionIds(evidence.players[id].records[world]).sort();
      return tasks.length ? [[id, world, tasks]] : [];
    });
  });
  return JSON.stringify(projection(left)) === JSON.stringify(projection(right));
}
export function recoverPluginItemDecisions(evidence) {
  const next = mergePluginItemEvidence(evidence);
  for (const player of Object.values(next.players)) {
    for (const record of Object.values(player.records)) {
      const tasks = decisionIds(record);
      if (tasks.length) lowerDecisions(record, tasks);
    }
  }
  return mergePluginItemEvidence(next);
}

function lowerDecisions(live, taskIds) {
  const handled = new Set(live.handled);
  // Frozen automatic ticks slice to 2,000. Reserve every remaining possible
  // automatic task when possible, without making it a current-save constraint.
  for (const task of taskIds) {
    const candidate = new Set([...handled, task, REVIEW + task]);
    const reserved = [...AUTO_TASKS].filter(id => !candidate.has(id)).length;
    // Compatibility metadata is optional. Never make a valid current decision
    // depend on space for the frozen renderer's task/marker pair.
    if (candidate.size + reserved <= 2000) for (const id of candidate) handled.add(id);
  }
  live.handled = [...handled].sort();
}

// The adapter returns plain, validated data. Import never writes paths supplied by a backup.
export async function exportPluginItemEvidence(dataDir, mapPlayerId = id => id, inherited, captureOptions) {
  const files = await capturePluginItemFiles(dataDir, captureOptions);
  return exportCapturedPluginItemEvidence(dataDir, files, mapPlayerId, inherited, captureOptions);
}

export async function exportCapturedPluginItemEvidence(dataDir, files, mapPlayerId = id => id, inherited, captureOptions) {
  // A worker's supplied state may predate a concurrent import. Include the
  // inherited evidence published alongside the captured sidecar generations.
  const persisted = await capturedInheritedEvidence(dataDir, files);
  const players = new Map();
  for (const file of pluginItemFiles) {
    const contents = files[file];
    if (contents === undefined) continue;
    const commits = file === commitFile;
    const document = optionalDocument(contents, commits ? validateJournalCommits : validateReviewRecord, captureOptions?.log);
    if (!document) continue;
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
export function dismissPluginItemEvidence(evidence, memberId, taskIds, unmappedIds, at = new Date().toISOString(), taskWorlds = []) {
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
  // Container-only reviews can have no retained fact. Retain their decision in
  // the displayed scope without manufacturing an owned/worn observation.
  const remember = (world, id) => decisions.set(world, new Set([...(decisions.get(world) ?? []), id]));
  const supported = id => [...decisions.values()].some(ids => ids.has(id));
  taskIds.forEach((id, index) => {
    if (taskWorlds[index] || !supported(id)) remember(taskWorlds[index] ?? 'unknown', id);
  });
  for (const id of unmappedIds) if (!supported(`unmapped:${id}`)) remember('unknown', `unmapped:${id}`);
  const owner = next.players[memberId] ??= { records: {}, commits: { journals: [] } };
  for (const [world, ids] of decisions) {
    const record = owner.records[world] ??= { baselineAt: at, items: {}, handled: [], journal: null };
    const handled = mergeItemHandled(record.handled, [...ids]);
    if (handled.length > 2000) throw Object.assign(new Error(`This review cannot be saved: the ${world === 'unknown' ? 'unknown-world' : world} item evidence would exceed 2,000 handled IDs. Nothing was applied or dismissed. Ask the operator to review the retained evidence and free space, then retry.`),
      { status: 422, code: 'PLUGIN_ITEM_REVIEW_CAPACITY' });
    record.handled = handled;
    lowerDecisions(record, [...ids].filter(id => ITEM_TASKS.has(id)));
  }
  return mergePluginItemEvidence(next);
}

// Prepare an optional frozen-release projection without changing either file.
// The store publishes authoritative state first; a lowering failure cannot undo it.
export async function stagePluginItemDecisions(dataDir, evidence, { checkOnly = false, memberIds } = {}) {
  if (!hasPluginItemDecisions(evidence)) return;
  const file = path.join(dataDir, 'plugin-items.json');
  const before = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const previous = before === undefined ? { v: 1, players: {} } : optionalDocument(before);
  if (!previous) return; // Leave the original for the sidecar writer's archival repair.
  // Provenance may predate a sibling's first report. Only an explicit roster
  // boundary may prune a previous owner; lowering owns decisions, not that
  // sibling's independently retained facts or acknowledgement watermarks.
  const owners = memberIds === undefined ? null : new Set(memberIds);
  const players = Object.fromEntries(Object.entries(previous.players).filter(([id]) => !owners || owners.has(id)));
  for (const [id, player] of Object.entries(evidence.players)) {
    if (owners && !owners.has(id)) continue;
    const tasks = [...new Set(Object.values(player.records).flatMap(decisionIds))].sort();
    let record;
    try { record = mergeItemRecords(previous.players[id], player.records.live); }
    catch { continue; } // Optional lowering cannot reject a valid state publication.
    if (!record && tasks.length) record = { baselineAt: Object.values(player.records)[0].baselineAt, items: {}, handled: [], journal: null };
    if (record) {
      lowerDecisions(record, [...new Set([...tasks, ...decisionIds(record)])].sort());
      players[id] = record;
    }
  }
  if (checkOnly) return Object.entries(evidence.players).some(([id, player]) => (!owners || owners.has(id))
    && Object.values(player.records).flatMap(decisionIds).some(task => !previous.players[id]?.handled.includes(task)
      || !previous.players[id].handled.includes(REVIEW + task))) || undefined;
  const after = Buffer.from(`${JSON.stringify(validate({ v: 1, players }))}\n`);
  if (before?.equals(after)) return;
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
  return {
    async publish() { await publishFile(temporary, file); if (!await same(after)) throw new Error('Plugin item lowering verification failed.'); },
    async cancel() { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); } };
}

export function openPluginJournalCommits(options) {
  return openPluginRecords({ ...options, filename: commitFile, validateRecord: validateJournalCommits, merge: mergeJournalCommits });
}

/** Sidecar only: the caller owns the save directory's existing lock. */
export async function openPluginItems({ journalWorld, ...options }) {
  if (journalWorld !== undefined && !journalWorlds.includes(journalWorld)) throw new TypeError('Invalid journal world.');
  return openPluginRecords({ ...options, filename: pluginItemFile(journalWorld), validateRecord: validateReviewRecord, merge: mergeItemRecords });
}

async function openPluginRecords({ dataDir, members, clock = Date.now, log = console.warn, filename, validateRecord, merge, inherited = () => null }) {
  const file = path.join(dataDir, filename);
  let current = { v: 1, players: {} }, corrupt = false, queue = Promise.resolve(), closed = false, contents;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') log('Optional plugin item evidence unavailable; observations may be offered again.'); }
  if (contents !== undefined) {
    const document = optionalDocument(contents, validateRecord, log);
    if (document) current = document;
    else corrupt = true;
  }
  return {
    get(player) {
      const retained = optionalPluginData('inherited item record', () => inherited(player), null);
      const observed = Object.hasOwn(current.players, player) ? current.players[player] : null;
      return optionalPluginData('item record union', () => merge(retained, observed), retained ?? observed);
    },
    /** Writes one player's record; members removed from the save are dropped. */
    put(player, record) {
      if (closed) return Promise.reject(Object.assign(new Error('The picker is stopping.'), { status: 503 }));
      try { validateRecord(record); } catch (error) { return Promise.reject(error); }
      const value = structuredClone(record);
      const pending = queue.then(() => withStoreWrite(dataDir, () => withPluginItemEvidenceWrite(dataDir, async () => {
        // A review publication may have lowered newer decisions since this
        // reader opened. Another player's write must retain those exact bytes.
        try {
          const document = optionalDocument(await readFile(file), validateRecord, log);
          if (document) { current = document; corrupt = false; }
          else corrupt = true;
        }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
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
