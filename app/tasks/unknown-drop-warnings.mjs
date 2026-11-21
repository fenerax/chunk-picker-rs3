import estimates from '../data/unknown-drop-estimates.v1.mjs';
import { UNKNOWN_DROP_RULE, unknownDropRule } from '../data/settings.mjs';
import { taskRuleValueError } from '../data/settings.mjs';
import { parseDropRate } from './rates.mjs';
import { processingSkills } from './processing.mjs';
import { relaxesAchievementDependency } from './achievements.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const contexts = new WeakMap();
const lowerRegistryCache = new WeakMap();
function lookupAlias(registry, key) {
  if (!registry) return undefined;
  if (Object.hasOwn(registry, key)) return registry[key];
  let lower = lowerRegistryCache.get(registry);
  if (!lower) {
    lower = new Map();
    for (const k of Object.keys(registry)) {
      const lk = k.toLowerCase();
      if (!lower.has(lk)) lower.set(lk, registry[k]);
    }
    lowerRegistryCache.set(registry, lower);
  }
  return lower.get(key.toLowerCase());
}
// Keep closures outside graph construction so a retained context cannot keep
// its solver's nodes, edges, source records and task rows alive.
const scalarContext = (itemCosts, taskCosts, wieldCosts = new Map()) => ({
  item: name => itemCosts.get(name) ?? Infinity,
  task: id => taskCosts.get(id) ?? Infinity,
  wield: name => wieldCosts.get(name) ?? itemCosts.get(name) ?? Infinity,
});
const craftedSource = source => source.kind === 'task' && processingSkills.has(source.category);
// Same equipment source policy and truth test as time estimates.
const wieldCraftedAllowed = rules => ![undefined, false, 'false', 0].includes(rules['Wield Crafted Items']);

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
  // The engine's consumer matcher admits virtual outputs only for the right
  // category and producer/consumer levels. Without that proof keep them out of
  // ordinary supplies; cached warning rows below retain the admitted cost.
  const sourceAllowed = allowedSource ?? (source => source.processingMode !== 'multi');
  const ZERO = { id: -1, value: 0, constant: true, parents: null };
  const INF = { id: -2, value: Infinity, constant: true, parents: null };
  const nodes = [], items = new Map(), tasks = new Map(), keys = new Map();
  const node = () => { const value = { id: nodes.length, value: Infinity, parents: [], read: null }; nodes.push(value); return value; };
  const addParent = (dep, target) => {
    if (dep.constant) return;
    const parents = dep.parents;
    if (parents.length === 0 || parents[parents.length - 1] !== target) parents.push(target);
  };
  const configure = (target, deps, read) => {
    target.read = read;
    for (let i = 0; i < deps.length; i++) addParent(deps[i], target);
  };
  const minRead = deps => () => {
    let cost = Infinity;
    for (let i = 0; i < deps.length; i++) {
      const v = deps[i].value;
      if (v < cost) cost = v;
    }
    return cost;
  };
  const maxRead = deps => () => {
    let cost = 0;
    for (let i = 0; i < deps.length; i++) {
      const v = deps[i].value;
      if (v > cost) cost = v;
    }
    return cost;
  };
  for (const row of result.tasks ?? []) { tasks.set(row.id, { row, node: node() }); keys.set(`${row.category}\0${row.rawLabel ?? row.label}`, row.id); }
  for (const item of result.items ?? []) items.set(item.name, { ...item, node: node() });
  const aliases = definitions.codeItems?.itemsPlus ?? {};
  const taskAliases = definitions.codeItems?.tasksPlus ?? {};
  function choices(token, registry = aliases) {
    const raw = String(token);
    const clean = raw.includes('*') ? raw.replaceAll('*', '') : raw;
    if (!clean.includes('[+]')) return { names: [clean], count: 1, alias: false };
    const match = /^(.*\[\+\])(?:x(\d+))?$/.exec(clean);
    if (!match) return { names: [clean], count: 1, alias: false };
    return { names: list(lookupAlias(registry, match[1]) ?? clean), count: Number(match[2] ?? 1), alias: true };
  }
  function sourceNode(source) {
    // Task outputs and task rewards both depend on their producing task. A
    // reward already received needs no new acquisition; a recipe output still
    // needs its supplies to make another.
    const producing = (source.kind === 'task' || source.kind === 'reward') && source.taskId !== undefined ? tasks.get(source.taskId) : undefined;
    const producer = producing && !(source.kind === 'reward' && producing.row.personalCompleted) ? producing.node : null;
    const estimate = unknownDropEstimate(source);
    if (!producer && estimate === 0) return ZERO;
    const target = node();
    if (!producer) {
      target.read = () => estimate;
    } else {
      addParent(producer, target);
      target.read = () => Math.max(estimate, producer.value);
    }
    return target;
  }
  // The engine waives some diary tiers (Show Diary Tasks Any, Combat Mastery);
  // a waived prerequisite costs nothing here either.
  const anyAchievements = taskRuleEnabled(rules, 'Show Diary Tasks Any', false);
  const sourceNodes = new WeakMap(), wieldNodes = new Map();
  for (const item of items.values()) {
    const allSources = item.sources ?? [];
    for (let i = 0; i < allSources.length; i++) sourceNodes.set(allSources[i], sourceNode(allSources[i]));
    // Virtual outputs can supply a particular task, but are not standalone
    // collection or equipment proof.
    let itemZero = false, wieldZero = false;
    const deps = [], wieldDeps = [];
    for (let i = 0; i < allSources.length; i++) {
      const source = allSources[i];
      if (source.processingMode === 'multi') continue;
      const sn = sourceNodes.get(source);
      if (sn === ZERO) itemZero = true;
      else if (!itemZero) deps.push(sn);
      if (!craftedSource(source)) {
        if (sn === ZERO) wieldZero = true;
        else if (!wieldZero) wieldDeps.push(sn);
      }
    }
    if (itemZero) item.node.read = () => 0;
    else if (deps.length) configure(item.node, deps, minRead(deps));
    // Equipment with Wield Crafted Items off admits no processing-task source
    // (the engine's equipment policy), so a recipe is no alternative there.
    const wield = wieldZero ? ZERO : wieldDeps.length ? node() : INF;
    if (!wieldZero && wieldDeps.length) configure(wield, wieldDeps, minRead(wieldDeps));
    wieldNodes.set(item.name, wield);
  }
  function itemChoice(name, row) {
    const allSources = items.get(name)?.sources;
    if (!allSources?.length) return INF;
    let deps;
    for (let i = 0; i < allSources.length; i++) {
      const source = allSources[i];
      if (!sourceAllowed(source, row, name)) continue;
      const sn = sourceNodes.get(source);
      if (sn === ZERO) return ZERO;
      if (!deps) deps = [sn];
      else deps.push(sn);
    }
    if (!deps) return INF;
    if (deps.length === 1) return deps[0];
    const choice = node();
    configure(choice, deps, minRead(deps));
    return choice;
  }
  const multiplier = !allowedSource ? moveOnMultiplier(rules) : 0;
  for (const { row, node: target } of tasks.values()) {
    // Eligibility-cache copies retain the engine's source-policy proof in the
    // warning. Reuse it when the engine's private matcher is unavailable.
    if (!allowedSource && row.unknownDropKills > 0) {
      const fixed = row.unknownDropKills / multiplier;
      target.read = () => fixed;
      continue;
    }
    let impossible = false;
    const groups = [];
    const pushGroup = (rawDeps, count) => {
      if (impossible) return;
      let zeros = 0;
      const filtered = [];
      for (let i = 0; i < rawDeps.length; i++) {
        const dep = rawDeps[i];
        if (!dep || dep === INF) continue;
        if (dep === ZERO) { zeros++; continue; }
        filtered.push(dep);
      }
      if (zeros >= count) return;
      const needed = count - zeros;
      if (filtered.length < needed) { impossible = true; return; }
      groups.push({ deps: filtered, count: needed });
    };
    const recordItems = row.record?.Items;
    if (recordItems != null) {
      for (const token of list(recordItems)) {
        if (impossible) break;
        const { names, count } = choices(token);
        const deps = [];
        for (let i = 0; i < names.length; i++) deps.push(itemChoice(names[i], row));
        pushGroup(deps, count);
      }
    }
    const recordTasks = row.record?.Tasks;
    if (!impossible && recordTasks) {
      const rowLabel = row.rawLabel ?? row.label;
      for (const label of Object.keys(recordTasks)) {
        if (impossible) break;
        const category = recordTasks[label];
        const { names, count, alias } = choices(label, taskAliases);
        const dependency = { category, token: String(label), alias };
        const rawNames = names.length === 1 ? [String(names[0]).split('--')[0]] : [...new Set(names.map(name => String(name).split('--')[0]))];
        const self = name => category === row.category && name === rowLabel;
        // All-self links are annotations; mixed aliases must still satisfy their
        // count using distinct, reachable non-self prerequisites, as in check().
        if (rawNames.every(self)) continue;
        const deps = [];
        for (let i = 0; i < rawNames.length; i++) {
          const name = rawNames[i];
          if (self(name)) continue;
          const task = tasks.get(keys.get(`${category}\0${name}`));
          if (task && relaxesAchievementDependency(row.category, row.record ?? {}, dependency, task.row.record, anyAchievements)) deps.push(ZERO);
          else if (!task?.row.personalCompleted) { if (task?.row.status === 'available') deps.push(task.node); }
          // A completed prerequisite needs no new acquisition. Its recipe still
          // needs supplies when used as a producer of additional items.
          else deps.push(ZERO);
        }
        pushGroup(deps, count);
      }
    }
    const payments = !impossible && (row.dialogueSupply ?? row.record?.DialogueSupply)?.paymentAlternatives;
    if (payments) {
      const clauses = [];
      for (let i = 0; i < payments.length; i++) {
        const clause = payments[i];
        const clauseDeps = [];
        let clauseImpossible = false;
        for (const name of Object.keys(clause)) {
          const dep = itemChoice(name, row);
          if (dep === INF) { clauseImpossible = true; break; }
          if (dep !== ZERO) clauseDeps.push(dep);
        }
        if (clauseImpossible) continue;
        if (clauseDeps.length === 0) { clauses.push(ZERO); break; }
        if (clauseDeps.length === 1) { clauses.push(clauseDeps[0]); continue; }
        const payment = node();
        // Payment quantities do not change this one-drop move-on hint. The
        // engine requires every payment item in one reachable clause.
        configure(payment, clauseDeps, maxRead(clauseDeps));
        clauses.push(payment);
      }
      pushGroup(clauses, 1);
    }
    if (impossible) continue;
    if (groups.length === 0) {
      target.read = () => 0;
      continue;
    }
    const allDeps = [];
    for (let i = 0; i < groups.length; i++) {
      const gdeps = groups[i].deps;
      for (let j = 0; j < gdeps.length; j++) allDeps.push(gdeps[j]);
    }
    configure(target, allDeps, () => {
      // Skill/point and personal-completion alternatives are separate gates;
      // neither replaces unconditional Items, Tasks or dialogue payments.
      let cost = 0;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i], gdeps = group.deps;
        let gcost;
        if (group.count === 1) {
          gcost = Infinity;
          for (let j = 0; j < gdeps.length; j++) if (gdeps[j].value < gcost) gcost = gdeps[j].value;
        } else {
          const vals = gdeps.map(dep => dep.value).sort((a, b) => a - b);
          gcost = vals[group.count - 1] ?? Infinity;
        }
        if (gcost > cost) cost = gcost;
      }
      return cost;
    });
  }
  const inQueue = new Uint8Array(nodes.length);
  const queue = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].read !== null) { inQueue[i] = 1; queue.push(nodes[i]); }
  }
  for (let index = 0; index < queue.length; index++) {
    const target = queue[index]; inQueue[target.id] = 0;
    const value = target.read();
    if (!(value < target.value)) continue;
    target.value = value;
    const parents = target.parents;
    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i];
      if (!inQueue[parent.id]) { inQueue[parent.id] = 1; queue.push(parent); }
    }
  }
  const itemCosts = new Map();
  for (const [name, item] of items) itemCosts.set(name, item.node.value);
  const taskCosts = new Map();
  for (const [id, task] of tasks) taskCosts.set(id, task.node.value);
  const wieldCosts = new Map();
  for (const [name, wield] of wieldNodes) wieldCosts.set(name, wield.value);
  const context = scalarContext(itemCosts, taskCosts, wieldCosts);
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
    const estimate = row.item ? context.item(row.item)
      : row.equipmentName ? (wieldCraftedAllowed(rules) ? context.item(row.equipmentName) : context.wield(row.equipmentName))
        : context.task(row.id);
    const kills = Math.ceil(estimate * multiplier);
    if (!(estimate > 0) || !Number.isSafeInteger(kills)) continue;
    row.unknownDropWarning = `Drop rate unknown (the wiki says rare). Move on after about ${kills.toLocaleString('en-US')} kills.`;
    row.unknownDropKills = kills;
    row.explanation = `${row.explanation ?? ''} ${row.unknownDropWarning}`.trim();
  }
  return rows;
}
