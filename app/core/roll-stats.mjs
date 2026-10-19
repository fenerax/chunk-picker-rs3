const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UNLOCK_TYPES = new Set(['roll', 'random-start', 'unlock-selection', 'pick-for-me', 'unlock-both', 'set-chunk']);
const NON_MAP_TYPES = new Set(['set-rule-review', 'set-rule', 'set-profile', 'set-teleport', 'set-teleport-override', 'set-transport-facts',
  'claim-task', 'clear-task-claim', 'prune-task-claims', 'complete-task', 'set-note', 'set-journal', 'add-task', 'update-task', 'delete-task',
  'set-task-status', 'clear-backlog', 'clear-challenge-ticks', 'tick-active-tasks', 'set-task-rule', 'reset-task-rule', 'set-task-alternative',
  'set-preference', 'set-primary-override', 'set-skill-levels', 'set-runescape-name', 'apply-runemetrics', 'apply-game-progress', 'set-slayer-lock',
  'set-sticker', 'add-sticker', 'update-sticker', 'remove-sticker', 'clear-stickers', 'set-chunk-colour', 'rename-chunk-colour', 'set-starting-chunk', 'set-section',
  'set-source-backlog', 'set-area', 'delete-teleport']);

/** Keep only map evidence needed by computeRollStats. Full task snapshots,
 * imported map payloads, actor identities and credentials are never copied.
 * null means the event cannot affect chunk dates. Retain undo/restore markers
 * even when they have no map changes; archived targets may need those markers.
 */
export function selectRollStatsEvent(event) {
  if (!event || !Number.isSafeInteger(event.revision)) return null;
  const command = event.command ?? {}, mapChanges = [];
  for (const member of NON_MAP_TYPES.has(event.type) ? [] : event.undo?.members ?? []) {
    if (Array.isArray(member.unlocked)) mapChanges.push({ memberId: member.id, before: [...member.unlocked], after: null });
  }
  for (const member of event.undo?.memberChanges ?? []) {
    const change = member.changes.find(change => change.path?.length === 1 && change.path[0] === 'unlocked');
    if (change && Array.isArray(change.before?.value) && Array.isArray(change.after?.value)) {
      mapChanges.push({ memberId: member.id, before: [...change.before.value], after: [...change.after.value] });
    }
  }
  // A map replacement also invalidates old dates when its chunk set is equal.
  if (!mapChanges.length && !['undo', 'restore', 'replace-member'].includes(event.type)) return null;
  const smallCommand = {};
  for (const key of ['memberId', 'count', 'status', 'undoRevision']) if (command[key] !== undefined) smallCommand[key] = command[key];
  return { revision: event.revision, type: event.type, at: event.at,
    ...(event.undoneRevision !== undefined ? { undoneRevision: event.undoneRevision } : {}), command: smallCommand, mapChanges };
}

function isUnlock(event) {
  if (!UNLOCK_TYPES.has(event.type)) return false;
  if (event.type === 'set-chunk') return event.command.status === 'unlocked';
  if (event.type === 'roll' || event.type === 'random-start') return (event.command.count ?? 1) === 1;
  return true;
}

function knownDate(event) {
  // History accepts nonempty legacy strings. Date.parse alone turns values
  // such as "123" into dates and normalizes February 30, inventing evidence.
  const parts = typeof event.at === 'string' && event.at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.parse(event.at);
  return Number.isFinite(ms) ? { at: new Date(ms).toISOString(), revision: event.revision, type: event.type } : null;
}

function importedDates(state, member, baseline) {
  const map = state.legacy?.maps?.[member.sourceMapId], order = map?.chunkOrder, dates = new Map();
  // The retained picker records confirmed rolls as millisecond timestamp keys
  // whose values are chunk IDs. Arrays are old order lists, not dated records.
  if (!order || typeof order !== 'object' || Array.isArray(order)) return dates;
  const saved = map.chunks?.unlocked;
  const importedUnlocked = new Set((Array.isArray(saved) ? saved : Object.keys(saved ?? {}))
    .map(id => String(id).replace(/^\*fb\*_/, '')));
  for (const [key, chunk] of Object.entries(order)) {
    const timestamp = key.match(/^(?:\*fb\*_)?([1-9]\d*)$/), chunkId = String(chunk);
    if (!timestamp || !/^[1-9]\d*$/.test(chunkId) || !Number.isSafeInteger(Number(chunkId))
      || !baseline.has(chunkId) || !importedUnlocked.has(chunkId)) continue;
    const time = Number(timestamp[1]);
    if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime())) continue;
    const previous = dates.get(chunkId);
    // A forfeit/manual lock does not delete the original record. Restriction
    // to surviving baseline chunks excludes locked records; a later recorded
    // roll supersedes older copies of that chunk without counting it twice.
    if (!previous || time > Date.parse(previous.at)) {
      dates.set(chunkId, { chunkId, at: new Date(time).toISOString(), revision: null, type: 'imported-roll' });
    }
  }
  return dates;
}

function chunkDates(state, history) {
  // Durable segments can repeat revisions. A later live copy carries the final
  // undone marker, so deduplicate before deciding which commands still apply.
  const byRevision = new Map();
  for (const original of history) {
    const event = original?.mapChanges ? original : selectRollStatsEvent(original);
    if (event && event.revision <= state.revision) byRevision.set(event.revision, event);
    else if (original && Number.isSafeInteger(original.revision)) byRevision.delete(original.revision);
  }
  const events = [...byRevision.values()].sort((a, b) => a.revision - b.revision);
  const boundary = events.findLast(event => event.type === 'restore')?.revision ?? -1;
  const undone = new Set(events.filter(event => event.type === 'undo').map(event => event.command.undoRevision));
  const active = events.filter(event => event.revision > boundary && event.type !== 'undo'
    && event.undoneRevision === undefined && !undone.has(event.revision));
  const current = new Map(state.members.map(member => [member.id, new Set(member.unlocked)]));
  const baseline = new Map([...current].map(([id, chunks]) => [id, new Set(chunks)]));
  const resolved = new Map();
  // Old History used complete BEFORE snapshots. Reconstruct their AFTER sets
  // from the saved map and later effective inverses, without replaying rolls.
  for (const event of active.toReversed()) {
    const changes = event.mapChanges.filter(change => baseline.has(change.memberId)).map(change => {
      const after = change.after === null ? [...baseline.get(change.memberId)] : change.after;
      baseline.set(change.memberId, new Set(change.before));
      return { ...change, after };
    });
    resolved.set(event.revision, changes);
  }
  let dates = new Map(state.members.map(member => [member.id, importedDates(state, member, baseline.get(member.id))]));
  // Whole-save restores establish a separate revision chain. Its retained
  // incoming History can date the restored baseline; previous live History
  // must never supply dates for an unrelated restored map.
  const incoming = state.provenance?.restore;
  if (boundary >= 0 && Array.isArray(incoming?.incomingHistory)) {
    const restored = { revision: incoming.incomingRevision,
      members: state.members.map(member => ({ id: member.id, sourceMapId: member.sourceMapId, unlocked: [...baseline.get(member.id)] })),
      legacy: state.legacy, provenance: incoming.incomingProvenance };
    dates = chunkDates(restored, incoming.incomingHistory);
  }
  for (const event of active) {
    if (event.type === 'replace-member' && dates.has(event.command.memberId)) dates.get(event.command.memberId).clear();
    for (const change of resolved.get(event.revision)) {
      const memberDates = dates.get(change.memberId), before = new Set(change.before), after = new Set(change.after);
      for (const id of memberDates.keys()) if (!after.has(id)) memberDates.delete(id);
      const date = isUnlock(event) && event.command.memberId === change.memberId ? knownDate(event) : null;
      for (const id of after) if (!before.has(id)) {
        if (date) memberDates.set(id, { chunkId: id, ...date });
        else memberDates.delete(id);
      }
    }
  }
  for (const [memberId, memberDates] of dates) {
    for (const id of memberDates.keys()) if (!current.get(memberId).has(id)) memberDates.delete(id);
  }
  return dates;
}

function summarize(id, name, chunks, dates, now) {
  const unlocks = [...dates.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)
    || (a.revision ?? 0) - (b.revision ?? 0) || a.chunkId.localeCompare(b.chunkId));
  const intervals = unlocks.slice(1).map((unlock, index) => Date.parse(unlock.at) - Date.parse(unlocks[index].at));
  const orderedIntervals = [...intervals].sort((a, b) => a - b), middle = Math.floor(intervals.length / 2);
  const timeline = [];
  for (const [index, unlock] of unlocks.entries()) {
    if (timeline.at(-1)?.at === unlock.at) timeline.at(-1).unlocked = index + 1;
    else timeline.push({ at: unlock.at, unlocked: index + 1 });
  }
  return { id, name, totalUnlocked: chunks.size, datedUnlocked: unlocks.length, unknownDateCount: chunks.size - unlocks.length,
    unlocksLast7Days: unlocks.filter(unlock => { const time = Date.parse(unlock.at); return time >= now - WEEK_MS && time <= now; }).length,
    intervalCount: intervals.length,
    averageIntervalMs: intervals.length ? intervals.reduce((sum, gap) => sum + gap, 0) / intervals.length : null,
    medianIntervalMs: intervals.length ? intervals.length % 2 ? orderedIntervals[middle] : (orderedIntervals[middle - 1] + orderedIntervals[middle]) / 2 : null,
    longestGapMs: intervals.length ? orderedIntervals.at(-1) : null, unlocks, timeline };
}

/** Read-only statistics for currently unlocked chunks, with serializable data.
 * history may contain full History events or selectRollStatsEvent projections.
 * Intervals use successive dated CHUNKS (simultaneous unlocks have a zero gap);
 * the longest gap excludes the unfinished gap between the last unlock and now.
 * Unknown dates contribute only to totalUnlocked, never chart points/intervals.
 * Retained original-picker chunkOrder timestamp records date imported baseline
 * chunks; their unlock rows use revision:null and type:'imported-roll'. Native
 * map History overrides these dates when a chunk is locked and unlocked again.
 * Duo counts unique chunk IDs. An unknown date for any current owner keeps
 * that union chunk undated; otherwise its earliest surviving owner date wins.
 */
export function computeRollStats(state, { history = state.history, now = Date.now() } = {}) {
  const time = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(time)) throw new TypeError('Roll statistics now must be a valid timestamp.');
  const dates = chunkDates(state, history ?? []), union = new Set(), owners = new Map();
  const members = state.members.map(member => {
    const chunks = new Set(member.unlocked);
    for (const id of chunks) { union.add(id); const entries = owners.get(id) ?? []; entries.push(dates.get(member.id).get(id) ?? null); owners.set(id, entries); }
    return summarize(member.id, member.name, chunks, dates.get(member.id), time);
  });
  const duoDates = new Map();
  for (const [id, entries] of owners) if (entries.every(Boolean)) {
    duoDates.set(id, entries.reduce((first, entry) => Date.parse(entry.at) < Date.parse(first.at) ? entry : first));
  }
  return { revision: state.revision, asOf: new Date(time).toISOString(), members, duo: summarize('duo', 'Duo', union, duoDates, time) };
}
