import { buildChunkPlanningIndex, baseLocationId } from './tasks/chunk-planning-index.mjs';
import { resolveSavedTaskId } from './tasks/fact-projection.mjs';
import { createCompletedModel } from './web/completed-model.mjs';
import { selectDuoTasks } from './web/duo-tasks.mjs';

// The game panel is small. Long lists stay in the picker.
export const PLUGIN_TASK_LIMITS = Object.freeze({ all: 100, here: 50, label: 120, category: 40 });
const text = (value, limit) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Rows from one saved play result, in the picker's Active Tasks order.
 * `stale` results came from an older revision: current completions, backlog
 * and status still apply, but new unlocks are missing until the picker reloads. */
export function pluginTaskRows({ state, result, registry, memberId, stale = false }) {
  const results = new Map([[memberId, { ...result, memberId, stateRevision: stale ? null : state.revision }]]);
  const locations = result.taskLocations;
  return selectDuoTasks({ state, results, registry, selectedMemberId: memberId }).rows.map(row => {
    const task = row.tasksByMember[memberId] ?? row.task;
    return { id: row.id, label: text(task.label, PLUGIN_TASK_LIMITS.label), category: text(task.category, PLUGIN_TASK_LIMITS.category),
      ...(Number.isSafeInteger(task.level) && task.level > 0 ? { level: task.level } : {}),
      chunks: locations ? (locations[task.id] ?? []).map(id => String(id).split('-')[0]) : null };
  });
}

/** `?from=N` on GET /api/plugin/v1/tasks: the first `all` row to send. Absent means 0; anything else is refused. */
export function pluginTaskFrom(search) {
  const query = new URLSearchParams(search);
  if ([...query.keys()].some(key => key !== 'from') || query.getAll('from').length > 1) return null;
  if (!query.has('from')) return 0;
  return /^\d{1,6}$/.test(query.get('from')) ? Number(query.get('from')) : null;
}

/** Response body for GET /api/plugin/v1/tasks. `chunkId` and row `chunks` are
 * picker IDs here; the route converts the response chunkId to a game ID.
 * `chunks` stays on the server.
 * `all` is one page of up to 100 rows starting at `from`; `allFrom` tells the plugin it can ask for more. */
export function pluginTaskList({ rows, chunkId, stateRevision, stale, from = 0 }) {
  if (!rows) return { v: 1, ready: false, stale: false, stateRevision, chunkId, here: [], all: [], allFrom: 0, hereCount: 0, allCount: 0, hereKnown: false };
  const strip = ({ chunks, ...row }) => row;
  const hereKnown = chunkId !== null && rows.every(row => row.chunks !== null);
  const here = hereKnown ? rows.filter(row => row.chunks.includes(chunkId)) : [];
  return { v: 1, ready: true, stale, stateRevision, chunkId, hereKnown,
    here: here.slice(0, PLUGIN_TASK_LIMITS.here).map(strip), all: rows.slice(from, from + PLUGIN_TASK_LIMITS.all).map(strip),
    allFrom: from, hereCount: here.length, allCount: rows.length };
}

// Finished rows are cached with active rows; the rolling time window is applied
// on every read so an idle revision cannot keep expired completions visible.
export const PLUGIN_DONE_LIMIT = 20;
export const PLUGIN_DONE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PLUGIN_ROLL_LIMITS = Object.freeze({ highlights: 4, text: 60 });
const skills = new Set('Skills Attack Strength Defence Ranged Prayer Magic Runecrafting Construction Dungeoneering Constitution Agility Herblore Thieving Crafting Fletching Slayer Hunter Mining Smithing Fishing Cooking Firemaking Woodcutting Farming Summoning Divination Invention Archaeology Necromancy'.toLowerCase().split(' '));
const group = category => skills.has(String(category).toLowerCase()) ? 'skills'
  : /^quests?$/i.test(category) ? 'quests' : /^(diary|diaries|achievement diar(?:y|ies))$/i.test(category) ? 'diaries' : 'other';

export function pluginDoneRows({ state, result, registry, memberId }) {
  const owner = state.members.find(member => member.id === memberId);
  // Personal completion must not depend on the partner or the group completion rule.
  const model = createCompletedModel({ state: { ...state, members: [owner] }, result, memberId,
    registry: { resolve: rules => ({ ...registry.resolve(rules), 'tasks.completion': 'personal' }) } });
  const sourceIds = new Map((result.tasks ?? []).map(task => [resolveSavedTaskId(state.identityRegistry, task.id), task.id]));
  return model.rows.map(({ task, completions }) => {
    const times = completions.filter(row => row.memberId === memberId && row.at).map(row => Date.parse(row.at)).filter(Number.isFinite);
    return { id: task.id, label: text(task.label, PLUGIN_TASK_LIMITS.label), category: text(task.category, PLUGIN_TASK_LIMITS.category),
      ...(Number.isSafeInteger(task.level) && task.level > 0 ? { level: task.level } : {}),
      chunks: result.taskLocations ? result.taskLocations[sourceIds.get(task.id) ?? task.id]?.map(id => String(id).split('-')[0]) ?? null : null,
      done: true, doneAt: times.length ? new Date(Math.max(...times)).toISOString() : null };
  }).sort((a, b) => (Date.parse(b.doneAt) || 0) - (Date.parse(a.doneAt) || 0) || a.id.localeCompare(b.id));
}

const recentDoneRows = (rows, now) => (rows ?? []).filter(row => row.doneAt && Date.parse(row.doneAt) >= now - PLUGIN_DONE_AGE_MS && Date.parse(row.doneAt) <= now).slice(0, PLUGIN_DONE_LIMIT);
const planningDefinitions = new WeakMap();

/** Compact map projections omit completed tasks. Locate only the recent set,
 * recovering authored records stripped from play results, never evaluating tasks. */
export function pluginDoneLocations({ rows, state, result, world, now, cache = new Map() }) {
  const recent = recentDoneRows(rows, now), definitions = world.definitions;
  const sources = new Map([...(state.tasks ?? []), ...(result.tasks ?? [])].map(task => [resolveSavedTaskId(state.identityRegistry, task.id), task]));
  const missing = recent.filter(row => !cache.has(row.id));
  const candidates = missing.flatMap(row => {
    const task = sources.get(row.id);
    const record = task?.record ?? definitions?.challenges?.[task?.category]?.[task?.rawLabel ?? task?.label];
    return record || task?.sources?.length ? [{ ...task, id: row.id, record: record ?? {} }] : [];
  });
  if (definitions && candidates.length) {
    // Clue markers are unrelated to task locations. Keep the shared declaration
    // index, without traversing the full clue catalogue for these bounded rows.
    if (!planningDefinitions.has(definitions)) planningDefinitions.set(definitions, { ...definitions, clues: {} });
    const index = buildChunkPlanningIndex(planningDefinitions.get(definitions), { tasks: candidates }, world);
    const located = new Map();
    for (const [location, tasks] of index.byLocation) for (const id of tasks.keys()) {
      if (!located.has(id)) located.set(id, new Set());
      const base = baseLocationId(location);
      if (world.chunks.has(base)) located.get(id).add(base);
    }
    for (const [id, chunks] of located) cache.set(id, [...chunks].sort());
  }
  // A known task the index cannot place is in no chunk, as active map rows are; only a
  // task missing from both the save and the result leaves its location unknown.
  for (const row of missing) if (!cache.has(row.id)) cache.set(row.id, row.chunks ?? (definitions && sources.has(row.id) ? [] : null));
  return recent.map(row => ({ ...row, chunks: cache.get(row.id) }));
}

export function pluginDoneList({ rows = null, chunkId, now }) {
  const recent = recentDoneRows(rows, now);
  const strip = ({ chunks, ...row }) => row;
  const hereKnown = rows !== null && chunkId !== null && recent.every(row => row.chunks !== null);
  const here = hereKnown ? recent.filter(row => row.chunks.includes(chunkId)).slice(0, PLUGIN_DONE_LIMIT) : [];
  const all = recent.slice(0, PLUGIN_DONE_LIMIT);
  return { here: here.map(strip), all: all.map(strip), hereCount: here.length, allCount: all.length, hereKnown };
}

const plain = value => text(String(value?.label ?? value?.name ?? value ?? '')
  .replace(/~\|([^|]*)\|~/g, (_, label) => label.split('#')[0]).replace(/\[\+\]/g, '')
  .replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), PLUGIN_ROLL_LIMITS.text);

/** The same cached prediction delta used by Chunk Info / If unlocked and pool
 * ranking. Never infer hypothetical task counts from current chunk locations. */
export function pluginRollSummary(prediction, chunk = {}) {
  if (prediction?.cancelled || !Array.isArray(prediction?.delta?.tasksAdded)) return null;
  const delta = prediction.delta, newTasks = { skills: 0, quests: 0, diaries: 0, other: 0 };
  for (const task of delta.tasksAdded) newTasks[group(task.category)]++;
  const objects = delta.objectsAdded ?? [];
  const highlights = [
    ...[...Object.keys(chunk.Object ?? {}), ...Object.keys(chunk.NPC ?? {}), ...objects].filter(value => /bank/i.test(plain(value))).map(value => plain(value)),
    ...Object.keys(chunk.Quest ?? {}).map(name => plain(`Quest start: ${plain(name)}`)),
    ...(delta.trainingChanged ?? []).filter(row => !row.before?.primary && row.after?.primary).map(row => plain(`Train ${row.skill}`)),
    ...(delta.itemsAdded ?? []).map(value => plain(value)),
    ...objects.filter(value => !/bank/i.test(plain(value))).map(value => plain(value)),
  ].filter(Boolean);
  return { newTasks, highlights: [...new Set(highlights)].slice(0, PLUGIN_ROLL_LIMITS.highlights) };
}
