// "Why is this task here?" is derived on demand from a full evaluation result.
// Nothing here runs while tasks are evaluated or rows are painted.

const plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, (_, label) => label.split('#')[0]).replace(/\[\+\]/g, '').replace(/<[^>]*>/g, '').trim();
const list = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const key = (category, rawLabel) => `${category}\u0000${rawLabel}`;

const CATEGORY_NOTES = Object.freeze({
  Extra: 'goals outside skills, quests and diaries, such as gear, collection logs and drops',
  Nonskill: 'steps that open access or item sources for other tasks',
  BiS: 'the strongest gear you can reach',
});

/** Rules that show or hide a whole category in presentation.mjs. */
export function categoryRuleIds(category) {
  if (category === 'Quest') return ['Quests', 'Show Quest Tasks'];
  if (category === 'Diary') return ['Achievement'];
  if (category === 'Nonskill') return ['Show Nonskill Tasks'];
  if (category === 'BiS') return ['Show Best in Slot Tasks'];
  if (category === 'Extra' || !category) return [];
  return ['Skills', 'Show Skill Tasks', category];
}

const dependents = new WeakMap();
function dependentIndex(result) {
  if (!dependents.has(result)) {
    const index = new Map();
    for (const row of result.tasks ?? []) {
      for (const [label, category] of Object.entries(row.record?.Tasks ?? {})) {
        const id = key(category, label);
        if (!index.has(id)) index.set(id, []);
        index.get(id).push(row);
      }
    }
    dependents.set(result, index);
  }
  return dependents.get(result);
}

/** Shortest "needed for X → required by Y" chains, preferring doable rows. */
export function neededForChains(task, result, { limit = 3, depth = 3 } = {}) {
  const index = dependentIndex(result), rank = row => row.status === 'available' ? 0 : 1;
  const next = (row, seen) => (index.get(key(row.category, row.rawLabel ?? row.label)) ?? [])
    .filter(item => !seen.has(item.id)).sort((a, b) => rank(a) - rank(b));
  return next(task, new Set([task.id])).slice(0, limit).map(first => {
    const chain = [first], seen = new Set([task.id, first.id]);
    while (chain.length < depth) {
      const step = next(chain.at(-1), seen)[0];
      if (!step) break;
      chain.push(step); seen.add(step.id);
    }
    return chain.map(row => plain(row.label));
  });
}

/** Which other tasks share this task's set, and whether this one was preferred. */
export function setStanding(task, result) {
  const name = task.record?.Set;
  if (!name) return undefined;
  const members = (result.tasks ?? []).filter(row => row.id !== task.id && row.record?.Set === name && row.category === task.category);
  const outclassed = task.blockers?.find(blocker => blocker.kind === 'outclassed');
  if (outclassed) {
    const winner = members.find(row => !row.blockers?.some(blocker => blocker.kind === 'outclassed') && row.status === 'available');
    return { name, preferred: false, by: winner ? plain(winner.label) : undefined };
  }
  const over = members.filter(row => row.blockers?.some(blocker => blocker.kind === 'outclassed')).map(row => plain(row.label));
  return { name, preferred: task.status === 'available', over };
}

/**
 * describeRule(id) returns { label, section, on, source } for a rule the Rules
 * screen knows, or undefined for tags that are not player-facing rules.
 */
export function explainTask(task, { result = { tasks: [] }, describeRule = () => undefined, locationName = value => value, suppressed } = {}) {
  const record = task.record ?? {}, seen = new Set(), rules = [];
  const addRule = (id, reason) => {
    if (seen.has(id)) return; seen.add(id);
    const rule = describeRule(id);
    if (rule) rules.push({ id, reason, label: rule.label ?? id, section: rule.section, on: rule.on, source: rule.source });
  };
  for (const tag of list(record.Category)) addRule(tag, 'tag');
  for (const id of categoryRuleIds(task.category)) addRule(id, 'category');

  const sources = (task.sources ?? []).slice(0, 3).map(source => ({
    kind: source.kind, item: source.item, rate: source.rate,
    text: [plain(source.source ?? source.name ?? source.task ?? source.kind), ...list(source.location).slice(0, 1).map(place => plain(locationName(typeof place === 'object' ? place.id ?? place.location ?? place.name : place)))].filter(Boolean).join(', '),
    probability: source.probability,
  }));
  const rareDrop = describeRule('Rare Drop'), amount = Number(describeRule('Rare Drop Amount')?.value);
  const rare = rareDrop?.on && amount > 0 && (task.sources ?? []).some(source => source.kind === 'drop' && source.probability > 0 && source.probability <= 1 / amount);

  const reasons = suppressed ?? result.presentation?.suppressed?.[task.id] ?? [];
  const decisive = rules.filter(rule => rule.reason === 'tag');
  return {
    label: plain(task.label), category: task.category, group: record.Label && record.Label !== task.category ? plain(record.Label) : undefined,
    categoryNote: CATEGORY_NOTES[task.category],
    rules, set: setStanding(task, result), neededFor: neededForChains(task, result),
    sources, rareDrop: rare ? { label: rareDrop.label ?? 'Rare Drop', amount } : undefined,
    hidden: reasons.filter(reason => reason !== 'Task is not available.'),
    summary: (decisive.length ? decisive : rules).slice(0, 2).map(rule => rule.label).join(' and ') || undefined,
  };
}
