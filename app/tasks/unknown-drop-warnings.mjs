import estimates from '../data/unknown-drop-estimates.v1.json' with { type: 'json' };
import { UNKNOWN_DROP_RULE, unknownDropRule } from '../data/settings.mjs';
import { taskRuleValueError } from '../data/settings.mjs';
import { parseDropRate } from './rates.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const contexts = new WeakMap();
// Keep closures outside graph construction so a retained context cannot keep
// its solver's nodes, edges, source records and task rows alive.
const scalarContext = (itemCosts, taskCosts) => ({
  item: name => itemCosts.get(name) ?? Infinity,
  task: id => taskCosts.get(id) ?? Infinity,
});

/** Estimates are advisory. Never substitute them into source probabilities. */
export function unknownDropEstimate(source) {
  if (Number.isFinite(source.probability)) return 0;
  const raw = source.rawRate ?? source.rate;
  if (typeof raw !== 'string') return 0;
  let denominator = 1, warning = false;
  for (const part of raw.split(' × ')) {
    const estimate = estimates.authoredEstimates[part.trim().toLowerCase()];
    if (estimate) { denominator *= estimate.denominator; warning ||= estimate.warn; }
    else {
      const rate = parseDropRate(part);
      if (!(rate > 0)) return 0;
      denominator /= rate;
    }
  }
  return warning && Number.isFinite(denominator) ? denominator : 0;
}

/** Least-cost reachable route; cycles cannot manufacture a free alternative.
 * AND requirements use the largest figure, OR sources use the smallest.
 * This is a move-on hint for one required drop, not a total task kill estimate.
 */
export function unknownDropContext(result, definitions = {}, allowedSource, rules = {}) {
  if (contexts.has(result)) return contexts.get(result);
  const sourceAllowed = allowedSource ?? (() => true);
  const nodes = [], items = new Map(), tasks = new Map(), keys = new Map();
  const node = () => { const value = { value: Infinity, parents: new Set(), deps: [], read: () => Infinity }; nodes.push(value); return value; };
  const configure = (target, deps, read) => { target.deps = deps; target.read = read; for (const dep of deps) dep.parents.add(target); };
  for (const row of result.tasks ?? []) { tasks.set(row.id, { row, node: node() }); keys.set(`${row.category}\0${row.rawLabel ?? row.label}`, row.id); }
  for (const item of result.items ?? []) items.set(item.name, { ...item, node: node() });
  const aliases = definitions.codeItems?.itemsPlus ?? {};
  function choices(token, registry = aliases) {
    const clean = String(token).replaceAll('*', ''), match = /^(.*\[\+\])(?:x(\d+))?$/.exec(clean);
    if (!match) return { names: [clean], count: 1 };
    const key = Object.hasOwn(registry, match[1]) ? match[1] : Object.keys(registry).find(key => key.toLowerCase() === match[1].toLowerCase());
    return { names: list(registry[key] ?? clean), count: Number(match[2] ?? 1) };
  }
  function sourceNode(source) {
    const target = node(), producer = source.kind === 'task' && tasks.get(source.taskId)?.node;
    const estimate = unknownDropEstimate(source);
    configure(target, producer ? [producer] : [], () => Math.max(estimate, producer?.value ?? 0));
    return target;
  }
  const sourceNodes = new WeakMap();
  for (const item of items.values()) {
    const sources = (item.sources ?? []).filter(source => source.processingMode !== 'multi');
    const deps = sources.map(source => { const target = sourceNode(source); sourceNodes.set(source, target); return target; });
    configure(item.node, deps, () => deps.reduce((cost, dep) => Math.min(cost, dep.value), Infinity));
  }
  for (const { row, node: target } of tasks.values()) {
    // Eligibility-cache copies retain the engine's source-policy proof in the
    // warning. Reuse it when the engine's private matcher is unavailable.
    if (!allowedSource && row.unknownDropKills > 0) {
      configure(target, [], () => row.unknownDropKills / moveOnMultiplier(rules));
      continue;
    }
    const groups = list(row.record?.Items).map(token => {
      const { names, count } = choices(token);
      const deps = names.map(name => {
        const item = items.get(name);
        // Match the caller's source policy before accepting an alternative.
        const sources = (item?.sources ?? []).filter(source => source.processingMode !== 'multi' && sourceAllowed(source, row, name));
        const deps = sources.map(source => sourceNodes.get(source)).filter(Boolean), choice = node();
        configure(choice, deps, () => deps.reduce((cost, dep) => Math.min(cost, dep.value), Infinity));
        return choice;
      });
      return { deps, count };
    });
    const dependencies = Object.entries(row.record?.Tasks ?? {}).map(([label, category]) => {
      const { names } = choices(label, definitions.codeItems?.tasksPlus ?? {});
      return { deps: names.map(name => {
        const task = tasks.get(keys.get(`${category}\0${String(name).split('--')[0]}`));
        if (!task?.row.personalCompleted) return task?.node;
        // A completed prerequisite needs no new acquisition. Its recipe still
        // needs supplies when used as a producer of additional items.
        const completed = node(); configure(completed, [], () => 0); return completed;
      }).filter(Boolean), count: 1 };
    }).filter(group => group.deps.length);
    groups.push(...dependencies);
    const deps = groups.flatMap(group => group.deps);
    configure(target, deps, () => {
      // Conditional alternatives need a selected proof before claiming reliance.
      if (row.record?.RequirementAlternatives || row.record?.PersonalRequirementAlternatives) return 0;
      return groups.reduce((cost, group) => Math.max(cost, group.deps.map(dep => dep.value).sort((a, b) => a - b)[group.count - 1] ?? Infinity), 0);
    });
  }
  const queue = [...nodes], queued = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    const target = queue[index]; queued.delete(target);
    const value = target.read();
    if (!(value < target.value)) continue;
    target.value = value;
    for (const parent of target.parents) if (!queued.has(parent)) { queued.add(parent); queue.push(parent); }
  }
  const context = scalarContext(new Map([...items].map(([name, item]) => [name, item.node.value])),
    new Map([...tasks].map(([id, task]) => [id, task.node.value])));
  contexts.set(result, context);
  return context;
}

function moveOnMultiplier(rules) {
  const raw = rules[UNKNOWN_DROP_RULE], value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return raw !== undefined && taskRuleValueError(UNKNOWN_DROP_RULE, raw) === null ? value : unknownDropRule.default;
}

export function addUnknownDropWarnings(rows, context, rules = {}) {
  const multiplier = moveOnMultiplier(rules);
  for (const row of rows) {
    if (row.unknownDropWarning && row.explanation?.endsWith(row.unknownDropWarning)) row.explanation = row.explanation.slice(0, -row.unknownDropWarning.length).trimEnd();
    delete row.unknownDropWarning; delete row.unknownDropKills;
    const estimate = row.item || row.equipmentName ? context.item(row.item ?? row.equipmentName) : context.task(row.id);
    const kills = Math.ceil(estimate * multiplier);
    if (!(estimate > 0) || !Number.isSafeInteger(kills)) continue;
    row.unknownDropWarning = `Drop rate unknown (the wiki says rare). Move on after about ${kills.toLocaleString('en-US')} kills.`;
    row.unknownDropKills = kills;
    row.explanation = `${row.explanation ?? ''} ${row.unknownDropWarning}`.trim();
  }
  return rows;
}
