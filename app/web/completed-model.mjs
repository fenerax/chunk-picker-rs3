import { createTaskFactsIndex } from '../core/progress-index.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';

const compare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const latest = values => values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
const key = (owner, id) => `${owner}\u0000${id}`;
const checkSources = new Set(['checkedAllTasks', 'checkedChallenges', 'completedChallenges']);

/** A read-only completion ledger. Dates describe recorded confirmations, never
 * an import time or the time a sync observed a finished quest. */
export function createCompletedModel({ state, result, memberId, registry, now = new Date() }) {
  const selected = memberId === 'both' ? state.members : state.members.filter(owner => owner.id === memberId);
  if (!selected.length) throw new RangeError(`Unknown member: ${memberId}.`);
  const results = (Array.isArray(result) ? result : [result]).filter(Boolean);
  const generated = results.flatMap(value => value.tasks ?? []);
  const selectedIds = new Set(selected.map(owner => owner.id));
  const scopedGenerated = results.filter(value => !value.memberId || selectedIds.has(value.memberId)).flatMap(value => value.tasks ?? [])
    .filter(task => task.obligation !== false && !task.hidden);
  const catalogue = [...scopedGenerated, ...generated, ...(state.tasks ?? [])];
  const byId = new Map();
  for (const task of catalogue) {
    const id = resolveSavedTaskId(state.identityRegistry, task.id);
    if (!byId.has(id)) byId.set(id, id === task.id ? task : { ...task, id });
  }
  // Saved references can outlive a generated result. Only materialized identity
  // metadata with a real label can supply a missing row; ambiguous IDs stay out.
  for (const owner of state.members) for (const id of [...(owner.completedTasks ?? []), ...Object.keys(owner.taskStatus ?? {})]) {
    const resolved = resolveSavedTaskId(state.identityRegistry, id), entry = state.identityRegistry?.entries?.[resolved];
    if (!byId.has(resolved) && entry?.label && entry?.category) byId.set(resolved, { ...entry, id: resolved });
  }
  const tasks = [...byId.values()];
  const aliases = new Map();
  for (const task of tasks) for (const alias of task.aliases ?? []) {
    const ids = aliases.get(alias) ?? new Set(); ids.add(task.id); aliases.set(alias, ids);
  }
  const resolve = id => {
    const targets = aliases.get(id);
    if (!targets) return resolveSavedTaskId(state.identityRegistry, id);
    const candidates = new Set(targets), saved = (state.identityRegistry?.savedAliases ?? state.identityRegistry?.aliases)?.[id];
    for (const target of Array.isArray(saved) ? saved : typeof saved === 'string' ? [saved] : []) if (state.identityRegistry?.entries?.[target]) candidates.add(target);
    return candidates.size === 1 ? [...candidates][0] : id;
  };
  const projectedState = { ...state, tasks, members: state.members.map(owner => projectMemberTaskFacts(state, owner, tasks)) };
  const ownSaved = new Set();
  for (const owner of projectedState.members) if (selectedIds.has(owner.id)) {
    for (const id of owner.completedTasks ?? []) ownSaved.add(id);
    for (const [id, status] of Object.entries(owner.taskStatus ?? {})) if (status.challengeCompleted === true) ownSaved.add(id);
  }
  const candidates = [...scopedGenerated.map(task => byId.get(resolve(task.id))), ...tasks.filter(task => ownSaved.has(task.id) && task.obligation !== false && !task.hidden)].filter(Boolean);
  const completionGroups = {};
  for (const value of results) for (const [group, ids] of Object.entries(value.collectionPlanning?.completionGroups ?? {})) {
    completionGroups[group] = [...new Set([...(completionGroups[group] ?? []), ...ids].map(resolve))];
  }
  // Saved source/rate variants belong under the current family representative.
  // Merge overlapping explicit families once, rather than listing a saved check
  // again as an unrelated singleton row later in the catalogue.
  const parents = new Map();
  const root = id => {
    if (!parents.has(id)) parents.set(id, id);
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current);
    while (parents.get(id) !== id) { const next = parents.get(id); parents.set(id, current); id = next; }
    return current;
  };
  for (const task of tasks) {
    const ids = [...new Set([task.id, ...(task.completionIds ?? completionGroups[task.completionGroup] ?? [])].map(resolve))];
    for (const id of ids) parents.set(root(id), root(task.id));
  }
  const families = new Map();
  for (const id of parents.keys()) { const parent = root(id), ids = families.get(parent) ?? []; ids.push(id); families.set(parent, ids); }
  for (const ids of families.values()) ids.sort();
  const familyOf = task => families.get(root(resolve(task.id))) ?? [resolve(task.id)];
  const indices = selected.map(owner => createTaskFactsIndex(projectedState, owner.id, registry, { tasks, completionGroups }));

  const checks = new Map(), actual = new Map(), imported = new Set(), observations = new Map(), achievementObservations = new Map();
  for (const entry of state.legacy?.gameplayMigration?.taskStatusProvenance ?? []) {
    if (entry.sources?.some(source => checkSources.has(source))) imported.add(key(entry.memberId, resolve(entry.taskId)));
  }
  // History is append ordered. A false clears previous date evidence; an undo
  // marker suppresses its command entirely. Notes/favourites do not reset dates.
  for (const event of state.history ?? []) {
    if (event.undoneRevision !== undefined) continue;
    const command = event.command;
    if (!command) continue;
    if (event.type === 'set-task-status' && Object.hasOwn(command, 'challengeCompleted')) {
      checks.set(key(command.memberId, resolve(command.taskId)), { completed: command.challengeCompleted === true, at: timestamp(event.at), imported: false });
    } else if (event.type === 'tick-active-tasks') {
      for (const id of command.taskIds ?? []) checks.set(key(command.memberId, resolve(id)), { completed: true, at: timestamp(event.at), imported: false });
    } else if (event.type === 'complete-task') {
      actual.set(key(command.memberId, resolve(command.taskId)), { completed: command.completed === true, at: timestamp(event.at) });
    } else if (event.type === 'sync-original') {
      for (const owner of command.members ?? []) for (const id of owner.tasks?.complete ?? []) {
        checks.set(key(owner.memberId, resolve(id)), { completed: true, at: null, imported: true });
      }
    } else if (event.type === 'apply-runemetrics' || event.type === 'apply-game-progress') {
      for (const quest of command.quests ?? []) {
        const id = key(command.memberId, resolve(quest.taskId));
        // A refresh of an already completed quest is not a new completion.
        if (!actual.has(id) || !actual.get(id).completed) actual.set(id, { completed: true, at: null });
      }
    }
  }
  for (const owner of state.members) for (const [id, fact] of Object.entries(owner.achievementProgress ?? {})) {
    if (timestamp(fact.fetchedAt) && fact.source === 'game-plugin' && fact.memberId === owner.id) achievementObservations.set(key(owner.id, resolve(id)), fact);
  }
  for (const owner of state.members) for (const [id, fact] of Object.entries(owner.questProgress ?? {})) {
    if (timestamp(fact.fetchedAt) && (fact.source === 'game-plugin' && fact.memberId === owner.id
      || fact.source === 'runemetrics' && typeof fact.runescapeName === 'string' && fact.runescapeName.trim())) {
      observations.set(key(owner.id, resolve(id)), fact);
    }
  }
  const evidence = new Map();
  for (const owner of projectedState.members) {
    const add = (id, kind) => {
      const reference = key(owner.id, id), history = (kind === 'ticked' ? checks : actual).get(reference);
      const achievement = achievementObservations.get(reference);
      const observation = kind === 'game' ? achievement ?? observations.get(reference) : undefined;
      const completion = { memberId: owner.id, name: owner.name ?? owner.id, memberName: owner.name ?? owner.id, kind,
        taskId: id, at: history?.completed ? history.at : null,
        imported: kind === 'ticked' && (history ? history.completed && history.imported : imported.has(reference)),
        ...(observation ? { source: observation.source, observedAt: observation.fetchedAt,
          ...(achievement ? { achievementId: achievement.achievementId } : {}),
          ...(observation.source === 'runemetrics' ? { runescapeName: observation.runescapeName } : {}) } : {}) };
      const entries = evidence.get(id) ?? []; entries.push(completion); evidence.set(id, entries);
    };
    for (const [id, status] of Object.entries(owner.taskStatus ?? {})) if (status.challengeCompleted === true) add(id, 'ticked');
    for (const id of new Set(owner.completedTasks ?? [])) add(id, 'game');
  }
  const seen = new Set(), rows = [];
  for (const task of candidates) {
    const family = familyOf(task), familyKey = JSON.stringify(family);
    if (seen.has(familyKey)) continue;
    const factsByMember = indices.map(index => index.get(task.id, family));
    if (!factsByMember.some(facts => facts.group)) continue;
    seen.add(familyKey);
    const completions = family.flatMap(id => evidence.get(id) ?? []).sort((a, b) => compare(a.name, b.name) || compare(a.kind, b.kind) || compare(a.taskId, b.taskId));
    const facts = memberId === 'both' ? { ...factsByMember[0], group: true,
      personal: factsByMember.some(value => value.personal), actual: factsByMember.some(value => value.actual) } : factsByMember[0];
    rows.push({ task, facts, completions, latestAt: latest(completions.map(value => value.at)), category: task.category || 'Other' });
  }
  rows.sort((a, b) => compare(a.category, b.category) || compare(a.task.label, b.task.label) || compare(a.task.id, b.task.id));
  const totalTasks = Math.max(rows.length, new Set(candidates.map(task => JSON.stringify(familyOf(task)))).size);
  const clock = new Date(now), week = new Date(clock);
  week.setHours(0, 0, 0, 0); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  const datedSince = since => rows.filter(row => row.latestAt && Date.parse(row.latestAt) >= since && Date.parse(row.latestAt) <= clock.getTime()).length;
  const summary = { total: rows.length, totalTasks, denominator: totalTasks,
    knownDates: rows.filter(row => row.latestAt).length, unknownDates: rows.filter(row => !row.latestAt).length,
    imported: rows.filter(row => row.completions.some(value => value.imported)).length,
    game: rows.filter(row => row.completions.some(value => value.kind === 'game')).length,
    ticked: rows.filter(row => row.completions.some(value => value.kind === 'ticked')).length,
    recent: datedSince(clock.getTime() - 7 * 24 * 60 * 60 * 1000), thisWeek: datedSince(week.getTime()) };
  return { memberId, rows, categories: groupCompletedRows(rows), summary };
}

export function groupCompletedRows(rows) {
  const groups = new Map();
  for (const row of rows) { const entries = groups.get(row.category) ?? []; entries.push(row); groups.set(row.category, entries); }
  return [...groups].sort(([a], [b]) => compare(a, b)).map(([category, entries]) => ({ category, rows: entries, count: entries.length }));
}

export function filterCompletedRows(rows, { query = '', attribution = 'all', sort = 'recent' } = {}) {
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = completion => {
    if (!attribution || attribution === 'all') return true;
    if (attribution.startsWith('ticked:')) return completion.kind === 'ticked' && completion.memberId === attribution.slice(7);
    if (attribution.startsWith('done:')) return completion.memberId === attribution.slice(5);
    if (attribution === 'imported') return completion.imported;
    if (attribution === 'runemetrics') return completion.kind === 'game' && completion.source === 'runemetrics';
    if (attribution === 'game-plugin') return completion.source === 'game-plugin';
    if (attribution === 'ticked' || attribution === 'game') return completion.kind === attribution;
    return completion.memberId === attribution;
  };
  const filtered = rows.filter(row => row.completions.some(matches) && terms.every(term => `${row.task.label ?? ''} ${row.category} ${row.completions.map(value => value.name).join(' ')}`.toLocaleLowerCase().includes(term)));
  const byName = (a, b) => compare(a.task.label, b.task.label) || compare(a.task.id, b.task.id);
  return filtered.sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'category') return compare(a.category, b.category) || byName(a, b);
    if (!a.latestAt || !b.latestAt) return Number(!a.latestAt) - Number(!b.latestAt) || byName(a, b);
    return (sort === 'oldest' ? 1 : -1) * (Date.parse(a.latestAt) - Date.parse(b.latestAt)) || byName(a, b);
  });
}
