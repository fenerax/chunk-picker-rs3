import { datasetValue } from '../dataset-runtime.mjs';
// Authored source frontier. A recipe's availability is separate from permission
// to publish its outputs as proof for another recipe, training method or area.
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const enabled = (rules, name, fallback = false) => rules[name] === undefined ? fallback : ![false, 'false', 0].includes(rules[name]);
const clean = value => String(value).replace(/\*/g, '');
export const processingSkills = datasetValue("app/tasks/processing.mjs#processingSkills");
const milestone = task => list(task.record?.Category).includes('Skill guide unlock');

export function isProcessingRecipe(task, definitions = {}) {
  const data = task.record ?? {};
  if (!processingSkills.has(task.category) || data.ManualNonProcessing || milestone(task)) return false;
  if (Object.entries(data.Tasks ?? {}).some(([name, category]) => name.split('--')[0] === task.rawLabel && name.includes('--') && ['Quest', 'Diary'].includes(category))) return false;
  return list(data.Items).some(token => !definitions.codeItems?.tools?.[clean(token)]);
}

// Redundant no-XP outputs have the same publication gate even when their
// activity is tools-only or otherwise exempt from consumable-input ranking.
export const isProcessingSourceTask = (task, definitions) => isProcessingRecipe(task, definitions)
  || !!task.record?.NoXp && list(task.record.Output).length > 0;

export function processingLevel(row, rules, definitions, items, access = {}) {
  const data = row.record ?? {}, requirement = Number(row.level ?? data.Level ?? 1);
  let boost = 0, saw = 0;
  if (enabled(rules, 'Boosting') && !data.NoBoost) for (const [source, amount] of Object.entries(definitions.codeItems?.boostItems?.[row.category] ?? {})) {
    if (definitions.codeItems?.boostTaskBans?.[row.category]?.[row.rawLabel]?.includes(source)) continue;
    const [name, field = 'items'] = source.split('~');
    const sources = items.get(name)?.sources ?? [];
    if (!(field === 'items' ? items.has(name) && (!sources.length || sources.some(source => source.processingMode !== 'multi')) : access[field]?.includes(name))) continue;
    if (name === 'Crystal saw') { if (row.category === 'Construction' && list(data.Items).includes('Saw[+]')) saw = 3; }
    else if (typeof amount === 'number') boost = Math.max(boost, amount);
    else if (/^\d+(?:\.\d+)?%\+\d+$/.test(amount)) {
      const [percent, extra] = amount.split('%+').map(Number), first = Math.floor(requirement * percent / 100 + extra);
      boost = Math.max(boost, Math.floor((requirement - first) * percent / 100 + extra));
    }
  }
  return Math.max(1, requirement - boost - saw);
}

/** worker.js:4815–5070 and 2193–2328: group by each usable input, take the
 * union of the lowest methods, then retain candidates below that skill frontier.
 * This operates on the current admitted source pass, never a speculative chain.
 */
export function selectProcessingSources(rows, itemRows, training, rules, definitions = {}, access = {}, ordinaryInput) {
  const items = new Map(itemRows.map(item => [item.name, item]));
  const eligible = new Set(), candidates = new Set(), conditional = new Set(), multi = new Set(), groups = new Map(), effectiveLevels = {}, diagnostics = [], sourceExclusions = {};
  const byId = new Map(rows.map(row => [row.id, row]));
  const level = row => effectiveLevels[row.id] ??= processingLevel(row, rules, definitions, items, access);
  const sourceRow = source => byId.get(source.taskId);
  // A star on a nonskill SOURCE name marks an independent gathering route.
  // Only unstarred nonskill sources expand through their declared inputs
  // (worker:4848,4902); this is distinct from a star on the consuming item.
  const expandedNonskill = source => source.category === 'Nonskill' && !String(source.name ?? sourceRow(source)?.rawLabel ?? '').includes('*');
  const acceptedRoot = source => source.processingMode !== 'multi' && !expandedNonskill(source) && (source.category !== 'Farming' || enabled(rules, 'Farming Primary') || list(sourceRow(source)?.record.Category).includes('Token'))
    && (!processingSkills.has(source.category) || enabled(rules, 'Multi Step Processing'));
  const expand = token => {
    const key = clean(token), match = /^(.*\[\+\])(?:x\d+)?$/.exec(key);
    const aliases = definitions.codeItems?.itemsPlus ?? {}, alias = match?.[1] ?? key;
    let alternatives = aliases[alias];
    if (match && alternatives === undefined) {
      const names = Object.keys(aliases).filter(name => name.toLowerCase() === alias.toLowerCase());
      if (names.length === 1) alternatives = aliases[names[0]];
    }
    return list(alternatives ?? key);
  };
  const ordinary = ordinaryInput ?? ((row, name) => (items.get(name)?.sources ?? []).some(source => source.processingMode !== 'multi'));
  const ordinaryIngredients = row => list(row.record?.Items).every(token => {
    const count = Number(/\[\+\]x(\d+)$/.exec(clean(token))?.[1] ?? 1);
    return new Set(expand(token).filter(name => ordinary(row, name))).size >= count;
  });
  function rootInputs(name, row, visiting = new Set()) {
    if (visiting.has(name)) return [];
    const sources = items.get(name)?.sources ?? [];
    if (sources.some(acceptedRoot)) return [name];
    const expanded = [];
    for (const source of sources.filter(expandedNonskill)) {
      const producer = sourceRow(source);
      if (!producer) {
        eligible.add(row.id);
        diagnostics.push({ kind: 'unsupported-processing-presentation', taskId: row.id, detail: 'The source for this non-skill ingredient is kept as recorded; its original ingredients are unknown.' });
      } else for (const token of list(producer.record?.Items)) for (const input of expand(token)) expanded.push(...rootInputs(input, row, new Set([...visiting, name])));
    }
    return expanded;
  }
  for (const row of rows) {
    if (row.personalCompleted && row.status !== 'unsupported') { eligible.add(row.id); continue; }
    if (row.status !== 'available') continue;
    // One duplicate is sufficient evidence. Preserve the gate's short-circuit
    // rather than scanning every output to build an exhaustive explanation.
    let duplicate;
    if (row.record?.NoXp && list(row.record.Output).some(name => {
      if (!(items.get(name)?.sources ?? []).some(source => source.taskId !== row.id && source.processingMode !== 'multi')) return false;
      duplicate = name; return true;
    })) {
      sourceExclusions[row.id] = { kind: 'no-xp-duplicate-output', items: [duplicate],
        detail: `This no-XP recipe duplicates ${duplicate}, already available from an independent source. The current duplicate-output rule excludes all of this recipe’s outputs from supplies and training.` };
      continue;
    }
    // One independent ingredient cannot turn a conditional ingredient into
    // ordinary supplies. Otherwise a winning bowstring/thread group admits
    // the finished product, raises its skill frontier and admits its own
    // previously excluded intermediate producer on the next replay.
    if (isProcessingSourceTask(row, definitions) && !ordinaryIngredients(row)) {
      candidates.add(row.id);
      conditional.add(row.id);
      continue;
    }
    if (!isProcessingRecipe(row, definitions)) { eligible.add(row.id); continue; }
    const data = row.record ?? {};
    if (Object.keys(data.Tasks ?? {}).some(name => name.includes('--'))) {
      eligible.add(row.id);
      diagnostics.push({ kind: 'unsupported-processing-source', taskId: row.id, detail: 'Required highest-task linking retains its declared recipe without input ranking.' });
      continue;
    }
    for (const token of list(data.Items)) {
      for (const name of expand(token)) {
        if (definitions.codeItems?.tools?.[name] || row.category === 'Magic' && definitions.codeItems?.magicTools?.[name]) continue;
        const sources = items.get(name)?.sources ?? [];
        if (!sources.length) continue;
        const roots = rootInputs(name, row);
        for (const root of roots) {
          if (definitions.codeItems?.tools?.[root] || row.category === 'Magic' && definitions.codeItems?.magicTools?.[root]) continue;
          const groupKey = `${row.category}\u0000${root}`, group = groups.get(groupKey) ?? [];
          if (!group.includes(row)) group.push(row);
          groups.set(groupKey, group);
          candidates.add(row.id);
        }
        if (!roots.length && !data['Not Processing'] && sources.some(source => source.processingMode !== 'multi' && source.category !== 'Nonskill')) multi.add(row.id);
      }
    }
  }
  const priority = row => Number.isFinite(Number(row.record?.Priority)) ? Number(row.record.Priority) : Infinity;
  const primary = row => !!row.record?.Primary && (row.processingPrimary ?? row.primaryMethod) !== false;
  const byKey = new Map(rows.map(row => [`${row.category}\u0000${row.rawLabel}`, row]));
  // The upstream promotion pass intentionally checks exact task keys in its
  // selected set (worker:2275,2332). Alias resolution establishes catalogue
  // availability earlier, but does not grant this later frontier promotion.
  const promotionDependencies = row => Object.entries(row.record?.Tasks ?? {}).every(([label, category]) =>
    eligible.has(byKey.get(`${category}\u0000${label}`)?.id));
  for (const group of groups.values()) {
    if (enabled(rules, 'Highest Level')) { for (const row of group) eligible.add(row.id); continue; }
    let winner;
    for (const row of group) {
      // Hiding intermediate goals is a presentation preference. Their sources
      // still prove a usable next step (for example unfired bowl -> bowl).
      if (row.record?.NeverShow) continue;
      if (!winner || level(row) < level(winner) || level(row) === level(winner) && !primary(winner) && priority(row) < priority(winner)) winner = row;
    }
    if (winner) eligible.add(winner.id);
  }
  const frontier = new Map();
  for (const row of rows) if (eligible.has(row.id) && processingSkills.has(row.category) && !milestone(row)) frontier.set(row.category, Math.max(frontier.get(row.category) ?? 0, level(row)));
  for (const [skill, data] of Object.entries(training ?? {})) {
    const personal = Math.max(Number(data.passiveLevel ?? 1), Number(data.observedCapabilityLevel ?? 1));
    if (frontier.has(skill)) frontier.set(skill, Math.max(frontier.get(skill), personal));
  }
  for (const id of candidates) {
    const row = byId.get(id);
    if (!conditional.has(id) && level(row) <= (frontier.get(row.category) ?? 0) && promotionDependencies(row)) eligible.add(id);
  }
  const multiFrontier = new Map();
  for (const row of rows) if (eligible.has(row.id) && processingSkills.has(row.category) && !milestone(row)) multiFrontier.set(row.category,
    Math.max(multiFrontier.get(row.category) ?? 0, Number(row.level ?? 1), Number(training?.[row.category]?.passiveLevel ?? 1)));
  for (const id of multi) {
    const row = byId.get(id);
    if (Number(row.level ?? 1) <= (multiFrontier.get(row.category) ?? 0) && promotionDependencies(row)) eligible.add(id);
  }
  const multiTaskIds = enabled(rules, 'Multi Step Processing') ? [...candidates].filter(id => !eligible.has(id)
    && (training?.[byId.get(id).category]?.primary || training?.[byId.get(id).category]?.manualPrimary)) : [];
  return { eligibleTaskIds: [...eligible], multiTaskIds, effectiveLevels, diagnostics, sourceExclusions };
}
