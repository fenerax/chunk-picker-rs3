import { combatLevelFromSkills } from './combat-level.mjs';
import { playerControlSkills } from './player-controls.mjs';
import { questPointProgress, restoreQuestPointChange, progressBelongsToMember, sameRuneScapeName, validateQuestPointProgress, validateRuneMetricsTimestamp } from './game-progress.mjs';
import { resolveSavedTaskId } from '../tasks/migration.mjs';
import { finishLineCommandTypes } from './finish-line.mjs';
import { PROGRESS_METRICS, MAX_PROGRESS_DAYS, validateProgressSnapshots, validateProgressQuestPoints } from './progress-snapshots.mjs';
export { PROGRESS_METRICS, MAX_PROGRESS_DAYS, validateProgressSnapshots } from './progress-snapshots.mjs';
const DAY = 86_400_000;
const metricFields = new Set(['unlocked', 'completedTasks', 'taskStatus', 'skillProgress', 'questProgress', 'runeMetricsSync', 'runescapeName']);
const validAt = value => { try { return validateRuneMetricsTimestamp(value); } catch { return null; } };
const tuple = metrics => PROGRESS_METRICS.map(key => metrics[key]);
const metrics = values => Object.fromEntries(PROGRESS_METRICS.map((key, index) => [key, values[index]]));
const sum = values => {
  if (values.some(value => value === null)) return null;
  const total = values.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(total) ? total : null;
};

/** Exactly the Every Drop item family used by collection.mjs; other collection
 * kinds retain their source-specific obligations. Unknown aliases stay distinct. */
function completionKey(state, id) {
  id = resolveSavedTaskId(state.identityRegistry, id);
  return id.startsWith('rs3:goal:every-drop:') ? `every-drop:${id.split(':').at(-1)}` : id;
}
function observedSkills(member) {
  return Object.fromEntries(Object.entries(member.skillProgress ?? {}).filter(([skill, value]) => playerControlSkills.includes(skill)
    && progressBelongsToMember(value, member)
    && Number.isSafeInteger(value.level) && value.level >= 1 && value.level <= 120 && validAt(value.fetchedAt)));
}

function observedQuestPoints(state, member) {
  const value = questPointProgress(state, member);
  if (!value || !sameRuneScapeName(value.runescapeName, member.runescapeName)) return null;
  try { validateQuestPointProgress(value); return value; } catch { return null; }
}
function skillCounts(member, f2p) {
  const observed = observedSkills(member), levels = Object.fromEntries(Object.entries(observed).map(([skill, value]) => [skill, value.level]));
  const combatSkills = ['Attack', 'Strength', 'Ranged', 'Magic', 'Necromancy', 'Defence', 'Constitution', 'Prayer', ...(f2p ? [] : ['Summoning'])];
  return { totalLevel: playerControlSkills.length > 0 && playerControlSkills.every(skill => observed[skill]) ? sum(playerControlSkills.map(skill => levels[skill])) : null,
    combatLevel: combatSkills.every(skill => observed[skill]) ? combatLevelFromSkills(levels, { f2p }) : null };
}

/** Counts explicit personal completions/checks. Challenge checks never award
 * quest points or account levels, regardless of the shared satisfaction rule. */
export function progressCounts(state, { questPoints } = {}) {
  const f2p = state.rules?.['content.f2p'] !== false;
  const completionSets = state.members.map(member => new Set([...member.completedTasks,
    ...Object.entries(member.taskStatus ?? {}).filter(([, value]) => value.challengeCompleted === true).map(([id]) => id)].map(id => completionKey(state, id))));
  const members = state.members.map((member, index) => {
    const actual = new Set(member.completedTasks.map(id => resolveSavedTaskId(state.identityRegistry, id)));
    return { memberId: member.id, name: member.name, metrics: { unlockedChunks: new Set(member.unlocked).size,
      completedTasks: completionSets[index].size,
      questPoints: observedQuestPoints(state, member)?.current ?? null,
      questPointEstimate: questPoints ? sum([...actual].map(id => questPoints.get(id) ?? 0)) : null,
      ...skillCounts(member, f2p) } };
  });
  return { members, duo: { metrics: { unlockedChunks: new Set(state.members.flatMap(member => member.unlocked)).size,
    completedTasks: new Set(completionSets.flatMap(ids => [...ids])).size,
    ...Object.fromEntries(['questPoints', 'questPointEstimate', 'totalLevel', 'combatLevel'].map(key => [key, sum(members.map(member => member.metrics[key]))])) } } };
}

/** Called by normal durable writes/startup, never a game command. Replaces
 * today's latest counts without touching authoritative revision or History. */
export function captureProgressSnapshot(state, { questPoints, at = new Date().toISOString(), startup = false } = {}) {
  if (!validAt(at)) throw new TypeError('Progress snapshot timestamp must be a valid ISO UTC timestamp');
  const memberIds = state.members.map(member => member.id);
  if (!memberIds.length || memberIds.length > 16) return state;
  // A changed roster cannot reuse old per-player rows, so it starts a new
  // series (marked truncated) instead of blocking the save.
  const sameRoster = !state.progressSnapshots || JSON.stringify(state.progressSnapshots.memberIds) === JSON.stringify(memberIds);
  const previous = sameRoster ? state.progressSnapshots : { days: [], truncated: true };
  const counts = progressCounts(state, { questPoints }), time = Date.parse(at), day = Math.floor(time / DAY);
  const days = [...(previous?.days ?? [])];
  const index = days.findIndex(row => row[0] === day);
  if (index >= 0 && days[index][1] > time) return state;
  const old = days[index];
  const saved = state.provenance?.progressQuestPoints;
  const sameAccounts = saved && JSON.stringify(saved.memberIds) === JSON.stringify(memberIds);
  const observations = [...(sameAccounts ? saved.days : [])];
  // Accept the short-lived PR format too; its fifth slot marked account QP.
  for (const row of previous?.days ?? []) if (row[4] === 1 && !observations.some(value => value[0] === row[0])) {
    observations.push([row[0], row[1], row[2].map(member => member[2]), row[3][2]]);
  }
  const prior = old ?? days.findLast(row => row[0] < day);
  const completionBaseline = state.provenance?.progressCompletionBaseline;
  const completedTasks = state.members.map(member => [...new Set(member.completedTasks.map(id => resolveSavedTaskId(state.identityRegistry, id)))].sort());
  // Catalogue availability is not evidence of lost progress. Only an exact
  // change in personal completions can authorize a decrease, even across days.
  const completionsChanged = memberIds.map((id, index) => completionBaseline?.memberIds?.[index] === id
    && JSON.stringify(completionBaseline.completedTasks[index]) !== JSON.stringify(completedTasks[index]));
  const preservePoints = (value, before, changed) => before != null && (value == null || value < before && !changed) ? before : value;
  const observedIndex = observations.findIndex(row => row[0] === day), observedBefore = observations[observedIndex];
  const priorObservation = observedBefore ?? observations.findLast(row => row[0] < day);
  let accountPoints = counts.members.map((member, index) => preservePoints(member.metrics.questPoints,
    priorObservation?.[2][index], completionsChanged[index]) ?? null);
  if (sum(accountPoints) === null && observedBefore?.[3] != null) accountPoints = [...observedBefore[2]];
  const accountChanged = accountPoints.some((value, index) => value !== (observedBefore?.[2][index] ?? null));
  // Startup has no command evidence for changing existing daily counts. Only a
  // newly available account observation may add data on a same-day restart.
  if (startup && old && !accountChanged) return state;
  if (accountChanged) {
    const row = [day, time, accountPoints, sum(accountPoints)];
    if (observedIndex >= 0) observations[observedIndex] = row; else observations.push(row);
  }
  const estimateTuple = (row, before, changed) => tuple(row.metrics).map((value, index) =>
    (index === 2 ? accountChanged && before?.[index] != null ? before[index] : preservePoints(row.metrics.questPointEstimate, before?.[index], changed) : value) ?? before?.[index] ?? null);
  // The four-slot legacy tuple remains completion-derived, readable on rollback.
  // Unknown observations must never replace any known stored metric.
  const entry = startup && old ? old : [day, time,
    counts.members.map((member, index) => estimateTuple(member, prior?.[2][index], completionsChanged[index])), estimateTuple(counts.duo, prior?.[3], completionsChanged.some(Boolean))];
  if (entry !== old) {
    // Existing PR-format rows retain their source semantics; new rows use the
    // rollback-compatible estimate format and the separate observation record.
    if (old?.[4] === 1) {
      entry.push(1);
      entry[2].forEach((row, index) => { row[2] = accountPoints[index]; });
    }
    for (const metric of [2, 3, 4]) {
      entry[3][metric] = sum(entry[2].map(member => member[metric]));
      if (entry[3][metric] === null && old?.[3][metric] != null) {
        entry[2].forEach((row, index) => { row[metric] = old[2][index][metric]; });
        entry[3][metric] = old[3][metric];
      }
    }
  }
  const tupleChanged = !old || JSON.stringify(old.slice(2)) !== JSON.stringify(entry.slice(2));
  const provenance = { ...state.provenance, progressCompletionBaseline: { memberIds, completedTasks } };
  if (!tupleChanged && !accountChanged) {
    // Equal totals can hide a completion replacement. Consume that evidence
    // now so a later capture cannot use it to justify a spurious decrease.
    return completionsChanged.some(Boolean) ? { ...state, provenance } : state;
  }
  if (index >= 0) {
    if (tupleChanged) days[index] = entry;
  } else days.push(entry);
  days.sort((a, b) => a[0] - b[0]);
  const progressSnapshots = { schemaVersion: 1, memberIds, days: days.slice(-MAX_PROGRESS_DAYS), truncated: (previous?.truncated ?? false) || days.length > MAX_PROGRESS_DAYS };
  validateProgressSnapshots(progressSnapshots);
  if (!observations.length) return { ...state, progressSnapshots, provenance };
  observations.sort((a, b) => a[0] - b[0]);
  const progressQuestPoints = { schemaVersion: 1, memberIds, days: observations.slice(-MAX_PROGRESS_DAYS) };
  validateProgressQuestPoints(progressQuestPoints);
  return { ...state, progressSnapshots, provenance: { ...provenance, progressQuestPoints } };
}

function writeSide(member, changes, side) {
  // Container existence and literal paths come from validated undo metadata.
  const relevant = changes.filter(change => metricFields.has(change.path[0]));
  for (const change of relevant.filter(change => change.kind === 'object').sort((a, b) => a.path.length - b.path.length)) {
    if (!change[side].exists) continue;
    let parent = member;
    for (const key of change.path.slice(0, -1)) parent = parent[key] ??= {};
    parent[change.path.at(-1)] ??= {};
  }
  for (const change of relevant.filter(change => change.kind === 'value')) {
    let parent = member;
    for (const key of change.path.slice(0, -1)) parent = parent[key] ??= {};
    if (change[side].exists) parent[change.path.at(-1)] = structuredClone(change[side].value);
    else delete parent[change.path.at(-1)];
  }
  for (const change of relevant.filter(change => change.kind === 'object').sort((a, b) => b.path.length - a.path.length)) {
    if (change[side].exists) continue;
    let parent = member;
    for (const key of change.path.slice(0, -1)) parent = parent?.[key];
    if (parent) delete parent[change.path.at(-1)];
  }
}
function rewind(state, event, events) {
  if (event.type === 'set-rule-review') return null;
  if (finishLineCommandTypes.includes(event.type)) return null;
  if (['restore', 'catalogue-refresh'].includes(event.type)) return 'Restore or catalogue refresh boundary';
  if (event.type === 'undo') {
    const target = events.get(event.command?.undoRevision);
    if (!target?.undo || target.undo.members) return 'Undo lacks reversible after-values';
    if (target.undo.rules) {
      if (target.command?.type === 'set-rule') state.rules = { ...target.undo.rules, [target.command.ruleId]: target.command.value };
      else if (target.command?.type === 'set-profile') state.rules = { ...target.command.rules };
      else return 'Undo lacks reversible rule after-values';
    }
    restoreQuestPointChange(state, target, 'after');
    for (const change of target.undo.memberChanges ?? []) {
      const member = state.members.find(member => member.id === change.id);
      if (!member) return 'History has a different player roster';
      writeSide(member, change.changes, 'after');
    }
    return null;
  }
  const undo = event.undo;
  if (!undo) {
    const unrelated = ['set-note', 'set-journal', 'set-preference', 'set-teleport', 'set-teleport-override', 'set-transport-facts', 'set-skill-levels', 'set-primary-override', 'set-task-rule', 'reset-task-rule', 'set-slayer-lock', 'set-section', 'set-source-backlog', 'set-boss-unlock', 'set-area', 'add-sticker', 'update-sticker', 'remove-sticker', 'clear-stickers', 'set-sticker', 'set-chunk-colour', 'rename-chunk-colour', 'cancel-roll'];
    return unrelated.includes(event.type) ? null : 'History lacks reversible state evidence';
  }
  restoreQuestPointChange(state, event);
  if (undo.rules) state.rules = { ...undo.rules };
  for (const snapshot of undo.members ?? []) {
    const index = state.members.findIndex(member => member.id === snapshot.id);
    if (index < 0) return 'History has a different player roster';
    state.members[index] = structuredClone(snapshot);
  }
  for (const change of undo.memberChanges ?? []) {
    const member = state.members.find(member => member.id === change.id);
    if (!member) return 'History has a different player roster';
    writeSide(member, change.changes, 'before');
  }
  return null;
}

/** Bounded reverse projection of retained History. Undo is replayed using its
 * target's after-values, including selective undo. Stops at unverifiable gaps. */
export function buildProgressModel(state, { questPoints, now = new Date().toISOString(), historyLimit = 150 } = {}) {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 150) throw new RangeError('Progress history limit must be 1 through 150');
  const current = progressCounts(state, { questPoints });
  const replay = { ...state, members: structuredClone(state.members), rules: { ...state.rules } };
  const events = new Map(state.history.map(event => [event.revision, event]));
  const points = []; let undatedEntries = 0, boundary = null;
  const recent = state.history.slice(-historyLimit);
  for (const event of recent.toReversed()) {
    if (validAt(event.at)) points.push({ at: event.at, revision: event.revision, type: event.type, ...progressCounts(replay, { questPoints }) });
    else {
      undatedEntries++;
      boundary = { revision: event.revision, reason: 'History has no trustworthy date' };
      break;
    }
    const reason = rewind(replay, event, events);
    if (reason) { boundary = { revision: event.revision, reason }; break; }
  }
  points.reverse();
  if (!boundary && recent.length && validAt(recent[0].at)) points.unshift({ at: recent[0].at, revision: recent[0].revision - 1, type: 'baseline', position: 'before', ...progressCounts(replay, { questPoints }) });
  const snapshots = state.progressSnapshots;
  const accountSnapshots = state.provenance?.progressQuestPoints;
  const accountDays = new Map((accountSnapshots?.days ?? []).map(row => [row[0], row]));
  // Keep estimates and account observations distinct, including when graphing
  // them. A change of source is a new baseline, never a gameplay gain.
  const dailyPoints = (snapshots?.days ?? []).map(([day, at, members, duo, sourceVersion]) => {
    const rows = snapshots.memberIds.map((memberId, index) => {
      const row = metrics(members[index]);
      const accountIndex = accountSnapshots?.memberIds.indexOf(memberId) ?? -1;
      row.questPointEstimate = sourceVersion === 1 ? null : row.questPoints;
      row.questPoints = accountDays.get(day)?.[2][accountIndex] ?? (sourceVersion === 1 ? row.questPoints : null);
      return { memberId, metrics: row };
    });
    return { at: new Date(Math.max(at, accountDays.get(day)?.[1] ?? at)).toISOString(), date: new Date(day * DAY).toISOString().slice(0, 10),
      members: rows, duo: { metrics: { ...metrics(duo), questPointEstimate: sourceVersion === 1 ? null : duo[2],
        questPoints: sum(rows.map(row => row.metrics.questPoints)) } } };
  });
  for (const row of current.members) {
    const savedEstimate = dailyPoints.findLast(point => Number.isFinite(point.members.find(member => member.memberId === row.memberId)?.metrics.questPointEstimate));
    row.metrics.questPointEstimate = savedEstimate?.members.find(member => member.memberId === row.memberId).metrics.questPointEstimate ?? row.metrics.questPointEstimate;
  }
  current.duo.metrics.questPointEstimate = sum(current.members.map(row => row.metrics.questPointEstimate));
  const datedRecords = [];
  for (const member of state.members) {
    const observed = observedSkills(member), times = new Set(Object.values(observed).map(value => value.fetchedAt));
    const counts = skillCounts(member, state.rules?.['content.f2p'] !== false);
    if (times.size === 1 && (counts.totalLevel !== null || counts.combatLevel !== null)) datedRecords.push({ at: [...times][0], memberId: member.id, kind: 'skills', label: 'Saved skill observation', metrics: counts });
    const questObservation = observedQuestPoints(state, member);
    if (questObservation) datedRecords.push({ at: questObservation.fetchedAt, memberId: member.id, kind: 'quest',
      label: 'Saved account quest-point observation', metrics: { questPoints: questObservation.current } });
  }
  datedRecords.sort((a, b) => a.at.localeCompare(b.at) || a.memberId.localeCompare(b.memberId));
  return { schemaVersion: 1, stateRevision: state.revision, generatedAt: now, current,
    history: { points, undatedEntries, limited: state.history.length > historyLimit || Boolean(state.provenance?.historyArchive?.length), boundary },
    daily: { points: dailyPoints, limitDays: MAX_PROGRESS_DAYS, truncated: snapshots?.truncated ?? false }, datedRecords };
}
