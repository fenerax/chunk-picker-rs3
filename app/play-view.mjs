import { lookupPermanentId, resolveIdentity } from './tasks/identity.mjs';
import { helperTaskLevels } from './helper-task-levels.mjs';

export const PLAY_VIEW = 'play-v1';
const factKeys = ['id', 'label', 'category', 'status', 'hidden', 'obligation', 'aliases', 'completionGroup', 'completionIds'];
const displayKeys = ['level', 'primary', 'generated', 'equipmentName', 'item', 'rawLabel', 'wiki'];

/** Materialize only the identities queried by browser facts, retaining every
 * competing candidate. The browser need not download the authored registry. */
export function projectIdentityRegistry(state) {
  const entries = {}, aliases = {}, savedAliases = {}, references = new Map();
  const add = (id, category) => {
    if (typeof id !== 'string') return;
    const categories = references.get(id) ?? new Set();
    categories.add(category); references.set(id, categories);
  };
  for (const task of state.tasks ?? []) { add(task.id); add(task.id, task.category); }
  for (const member of state.members ?? []) {
    for (const id of member.completedTasks ?? []) add(id);
    for (const id of Object.keys(member.taskStatus ?? {})) add(id);
    for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) for (const id of Object.values(groups)) { add(id); add(id, category); }
  }
  for (const id of Object.keys(state.taskClaims ?? {})) add(id);
  for (const [id, categories] of references) {
    const persisted = state.identityRegistry?.aliases?.[id];
    const saved = (typeof persisted === 'string' ? [persisted] : Array.isArray(persisted) ? persisted : [])
      .filter(target => state.identityRegistry?.entries?.[target]);
    if (saved.length) savedAliases[id] = saved;
    const candidates = new Set();
    for (const category of categories) for (const target of resolveIdentity(id, state.identityRegistry, category).candidates) candidates.add(target);
    if (candidates.size && (candidates.size !== 1 || !candidates.has(id))) aliases[id] = [...candidates];
    for (const target of candidates) {
      const entry = state.identityRegistry?.entries?.[target] ?? lookupPermanentId(target);
      if (!entry) continue;
      const ownPrefix = entry.category ? `rs3:${encodeURIComponent(entry.category)}:` : undefined;
      const categoryAliases = [...new Set((entry.aliases ?? []).flatMap(alias => {
        const prefix = typeof alias === 'string' ? /^rs3:[^:]+:/.exec(alias)?.[0] : undefined;
        return prefix && prefix !== ownPrefix ? [prefix] : [];
      }))];
      entries[target] = { ...(entry.category ? { category: entry.category } : {}),
        ...(categoryAliases.length ? { aliases: categoryAliases } : {}) };
    }
  }
  return { schemaVersion: 1, entries, aliases, savedAliases, unresolved: [] };
}

/** A display projection, never a backup or an input to durable validation. */
export function projectPlayState(state) {
  const { provenance, identityRegistry, progressSnapshots, ...display } = state;
  const wanted = new Set();
  const add = (id, category) => {
    if (typeof id !== 'string') return;
    wanted.add(id);
    for (const candidate of resolveIdentity(id, identityRegistry, category).candidates) wanted.add(candidate);
  };
  for (const member of state.members ?? []) {
    for (const id of member.completedTasks ?? []) add(id);
    for (const id of Object.keys(member.taskStatus ?? {})) add(id);
    for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) for (const id of Object.values(groups)) { add(id); add(id, category); }
  }
  for (const id of Object.keys(state.taskClaims ?? {})) add(id);
  for (const goal of state.groupGoals ?? []) if (goal.link?.kind === 'task') add(goal.link.id);
  const tasks = (state.tasks ?? []).filter(task => task.id.startsWith('custom:') || task.id.startsWith('rs3:task:custom:') || wanted.has(task.id));
  return { ...display, tasks, identityRegistry: projectIdentityRegistry({ ...state, tasks }) };
}

/** Browser facts always retain identity, scope and completion-family evidence.
 * Hidden rows need display fields only in an explicitly opened planning view. */
export function projectPlayTask(task, { retainHiddenDisplay = false, reuse = true } = {}) {
  let projected;
  if (reuse) {
    projected = {};
    for (const key of factKeys) if (Object.hasOwn(task, key)) projected[key] = task[key];
    if (!task.hidden || retainHiddenDisplay) for (const key of displayKeys) if (Object.hasOwn(task, key)) projected[key] = task[key];
  } else {
    const keys = [...factKeys];
    if (!task.hidden || retainHiddenDisplay) keys.push(...displayKeys);
    projected = Object.fromEntries(keys.filter(key => Object.hasOwn(task, key)).map(key => [key, task[key]]));
  }
  if (!task.hidden || retainHiddenDisplay) { const levels = helperTaskLevels(task); if (Object.keys(levels).length) projected.skillRequirements = levels; }
  if (task.record?.RequirementAlternatives && Number(task.level ?? task.record.Level ?? 1) === 1) delete projected.level;
  if ((!task.hidden || retainHiddenDisplay) && task.blockers?.length) projected.blockers = [{ detail: task.blockers[0].detail }];
  if ((!task.hidden || retainHiddenDisplay) && typeof task.record?.Description === 'string') projected.description = task.record.Description;
  return projected;
}

export function projectPlayResult(result, { reuse = true } = {}) {
  let tasks, completedTasks;
  if (reuse) {
    const rows = result.tasks ?? [];
    tasks = new Array(rows.length); completedTasks = [];
    // Both arrays follow catalogue order, just as the independent reference
    // map and filter passes do, without allocating callback pairs per row.
    for (let index = 0; index < rows.length; index++) {
      if (!(index in rows)) continue;
      const task = rows[index];
      tasks[index] = projectPlayTask(task);
      if (result.presentation) {
        const reasons = result.presentation.suppressed?.[task.id];
        if (reasons?.length && reasons.every(reason => reason === 'Challenge already satisfied.')) completedTasks.push({ id: task.id });
      }
    }
  } else {
    tasks = (result.tasks ?? []).map(task => projectPlayTask(task, { reuse: false }));
    if (result.presentation) completedTasks = (result.tasks ?? []).filter(task => {
      const reasons = result.presentation.suppressed?.[task.id];
      return reasons?.length && reasons.every(reason => reason === 'Challenge already satisfied.');
    }).map(task => ({ id: task.id }));
  }
  return { format: PLAY_VIEW,
    tasks,
    ...(result.presentation ? { presentation: {
      tasks: result.presentation.tasks.map(task => ({ id: task.id })),
      // Recover only completion-hidden display rows; other presentation gates
      // remain authoritative without shipping the suppressed catalogue.
      completedTasks } } : {}),
    ...(result.metrics ? { metrics: result.metrics } : {}),
    ...(result.access ? { access: result.access } : {}),
    // The chunk panel and task explanations name each boss gate's state.
    ...(result.bossGates ? { bossGates: result.bossGates.map(({ id, boss, monsters, open, openedBy, reason }) => ({ id, boss, monsters, open, openedBy, reason })) } : {}),
    ...(result.partnerConnections ? { partnerConnections: result.partnerConnections } : {}),
    ...(result.collectionPlanning ? { collectionPlanning: { completionGroups: result.collectionPlanning.completionGroups } } : {}),
  };
}
