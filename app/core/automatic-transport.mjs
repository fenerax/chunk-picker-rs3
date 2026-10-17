import { sameRuneScapeName } from './game-progress.mjs';
import { automaticTravelInputKey } from './travel-inputs.mjs';

export const AUTOMATIC_TRANSPORT_RULE = 'travel.automatic';
export const automaticTransportEnabled = state => state.rules?.[AUTOMATIC_TRANSPORT_RULE] === true;
// Personal acceptance is deliberately never synthesized by capability facts.
// This policy also lets the physical proof reject a route before deriving
// supplies; a force-usable declaration still bypasses that personal gate.
export const automaticConfirmationRequiresDeclaration = key => key === 'wilderness-pvp-warning-accepted';
const configurations = new WeakMap(), engines = new WeakMap(), baselines = new WeakMap(), derived = new WeakMap();
const renewableCount = 1e12;
const normalize = name => String(name).trim().toLowerCase();
let engineFactory;
// The browser imports rule/transport code too. Register from the Node-only task
// engine rather than pulling its complete reference datasets into that graph.
export function registerAutomaticTransportEngineFactory(factory) { engineFactory = factory; }

/** Attach the existing task evaluator without putting functions in saved state
 * or in the world's public/serialized rule context. */
export function configureAutomaticTransport(world, configuration) {
  const previous = configurations.get(world);
  if (previous?.engine !== configuration.engine) baselines.delete(previous?.engine ?? world);
  configurations.set(world, configuration);
  engines.delete(world);
  baselines.delete(world);
  derived.delete(world);
  return world;
}

/** Drop rebuildable results and an implicit evaluator while preserving the
 * caller's definitions and any explicitly supplied evaluator. */
export function releaseAutomaticTransportCaches(world) {
  const engine = configurations.get(world)?.engine ?? engines.get(world);
  if (engine) baselines.delete(engine);
  engines.delete(world); baselines.delete(world); derived.delete(world);
}

function baselineFor(world, state, memberId, supplied, signature) {
  if (supplied) return supplied;
  const configuration = configurations.get(world) ?? {};
  const definitions = configuration.definitions ?? world.definitions;
  if (!definitions) return null;
  let engine = configuration.engine ?? engines.get(world);
  if (!engine) {
    if (!engineFactory) return null;
    engine = engineFactory(definitions, configuration.options ?? world.automaticTransportOptions ?? {});
    engines.set(world, engine);
  }
  // The evaluator's catalogue is compiled from definitions, not state.tasks.
  // Saved quest labels affect the personal quest projection below and are
  // included by content in the capability key.
  // Projected task states and roll hooks can be distinct objects representing
  // the same save. A content key also notices in-place edits in preview/tests.
  // Retained resource worlds and exact component worlds share one dispatcher.
  // Their derived location projections differ, but their unchanged baseline
  // task result must be evaluated only once. Only supplies, training, access
  // and source records are consumed below; challenge flags on cached task rows
  // are not authoritative task-list results.
  let entries = baselines.get(engine);
  if (!entries) { entries = new Map(); baselines.set(engine, entries); }
  let cache = entries.get(signature);
  if (!cache) cache = { byMember: new Map() };
  // Predictions alternate the unchanged save and one hypothetical unlock.
  // Two exact signatures retain both without reusing a candidate's supplies
  // for another candidate or retaining an unbounded set of task results.
  entries.delete(signature); entries.set(signature, cache);
  while (entries.size > 2) entries.delete(entries.keys().next().value);
  if (!cache.byMember.has(memberId)) {
    // No automatic route can prove its own runes, fare, activation, training,
    // partner connection or item. Retain existing manual travel semantics.
    const baselineState = { ...state, rules: { ...state.rules, [AUTOMATIC_TRANSPORT_RULE]: false, 'access.transport': false } };
    cache.byMember.set(memberId, engine.evaluate(baselineState, memberId));
  }
  return cache.byMember.get(memberId);
}

/** Personal facts derived only from the unchanged reachable capability graph.
 * Obtainability is renewable supply evidence, never an inventory assertion.
 * Quest potential and another member's observations cannot prove completion. */
export function deriveAutomaticTransport(world, state, memberId, { baseline, transportFactsByMember } = {}) {
  const member = state.members.find(value => value.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const explicit = transportFactsByMember?.[memberId] ?? member.transportFacts ?? {};
  const signature = automaticTransportEnabled(state) ? automaticTravelInputKey(state, transportFactsByMember) : null;
  let cached = derived.get(world);
  if (signature && !baseline && cached?.signature === signature && cached.byMember.has(memberId)) return cached.byMember.get(memberId);
  if (signature && (!cached || cached.signature !== signature)) {
    cached = { signature, byMember: new Map() }; derived.set(world, cached);
  }
  const facts = Object.fromEntries(['levels', 'quests', 'items', 'currencies', 'conditions', 'confirmations'].map(field => [field, { ...explicit[field] }]));
  const estimatedLevels = new Set(), observedLevels = new Set(), renewableBudget = {}, itemEvidence = new Map();
  const result = automaticTransportEnabled(state) ? baselineFor(world, state, memberId, baseline, signature) : null;
  for (const [skill, observation] of Object.entries(member.skillProgress ?? {})) {
    if (observation?.source === 'runemetrics' && sameRuneScapeName(observation.runescapeName, member.runescapeName)
      && Number.isSafeInteger(observation.level) && observation.level >= 1) {
      facts.levels[skill] = observation.level; observedLevels.add(skill);
    }
  }
  for (const [skill, training] of Object.entries(result?.training ?? {})) if (!observedLevels.has(skill) && facts.levels[skill] === undefined
    && Number.isSafeInteger(training.level) && training.level >= 1) {
    facts.levels[skill] = training.level; estimatedLevels.add(skill);
  }
  for (const [skill, level] of Object.entries(member.passiveLevels ?? {})) if (!observedLevels.has(skill) && facts.levels[skill] === undefined) facts.levels[skill] = level;
  for (const [id, observation] of Object.entries(member.questProgress ?? {})) if (observation?.source === 'runemetrics'
    && sameRuneScapeName(observation.runescapeName, member.runescapeName) && member.completedTasks?.includes(id)) facts.quests[observation.title] = true;
  for (const task of state.tasks ?? []) if (task.category === 'Quest' && member.completedTasks?.includes(task.id)) {
    const observation = member.questProgress?.[task.id];
    // A sync record bound to a different character must not become a manual
    // completion merely because its old task checkbox survived a name change.
    if (!observation || observation.source !== 'runemetrics' || sameRuneScapeName(observation.runescapeName, member.runescapeName)) facts.quests[task.label] = true;
  }
  const tasks = new Map((result?.tasks ?? []).map(task => [task.id, task]));
  const renewableTasks = new Map();
  const renewableSource = (source, visiting = new Set()) => {
    if (['spawn', 'shop', 'drop', 'object'].includes(source.kind)) return true;
    if (source.kind !== 'task' || visiting.has(source.taskId)) return false;
    if (renewableTasks.has(source.taskId)) return renewableTasks.get(source.taskId);
    const task = tasks.get(source.taskId);
    if (!task || ['Quest', 'Diary', 'Achievement'].includes(task.category)) return false;
    const inputs = new Map();
    for (const input of task.sources ?? []) if (input.item) {
      const sources = inputs.get(input.item) ?? []; sources.push(input); inputs.set(input.item, sources);
    }
    if (task.record?.Items?.length && !inputs.size) return false;
    for (const field of ['Objects', 'NPCs', 'Monsters', 'Shops']) if (task.record?.[field]?.length
      && !(task.sources ?? []).some(input => input.kind === field.toLowerCase() && input.locations?.length)) return false;
    const next = new Set([...visiting, source.taskId]);
    const renewable = [...inputs.values()].every(sources => sources.some(input => renewableSource(input, next)));
    // A cyclic alternative's failure is path-dependent; only successes are
    // reusable. The task engine already excludes unsupported source cycles.
    if (renewable) renewableTasks.set(source.taskId, true);
    return renewable;
  };
  for (const item of result?.items ?? []) {
    const sources = (item.sources ?? []).filter(source => source.processingMode !== 'multi'
      && (source.kind !== 'reward' || member.completedTasks?.includes(source.taskId)
        && (!member.questProgress?.[source.taskId] || sameRuneScapeName(member.questProgress[source.taskId].runescapeName, member.runescapeName))));
    if (!sources.length) continue;
    itemEvidence.set(normalize(item.name), { name: item.name, sources });
    const renewable = sources.some(source => renewableSource(source));
    facts.items[item.name] = Math.max(facts.items[item.name] ?? 0, renewable ? renewableCount : 1);
    if (renewable) renewableBudget[`items:${item.name}`] = renewableCount;
    // Coins sold by a shop or a speculative quest reward cannot finance their
    // own purchase. Unknown currencies never acquire a fabricated balance.
    if (normalize(item.name) === 'coins' && sources.some(source => source.kind !== 'shop' && renewableSource(source))) {
      facts.currencies.coins = renewableCount;
      renewableBudget['currencies:coins'] = renewableCount;
    }
  }
  const reachableLocations = new Set(world.cacheWalking ? result?.access?.components ?? [] : result?.access?.sections ?? []);
  // Unsplit retained bases are genuine surface locations; split ownership is
  // never sufficient to seed an unentered section.
  for (const base of result?.access?.bases ?? []) if (!world.cacheWalking && world.sectionTopology.get(base)?.has('0')
    && member.sectionOverrides?.[`${base}-0`] !== false && (state.rules?.['content.f2p'] === false || world.f2p.has(base))) {
    reachableLocations.add(base);
  }
  const safeOrigin = [...reachableLocations].some(location => /^\d+(?:-\d+)?$/.test(location)
    && (Number(location.split('-')[0]) & 255) * 64 < 3520);
  if (safeOrigin && facts.conditions['teleport-origin-permitted'] === undefined) facts.conditions['teleport-origin-permitted'] = true;
  // Standard is the only F2P spellbook. Members can explicitly confirm their
  // book; unlocking an alternative book does not prove which one is active.
  const standardBook = facts.conditions['standard-spellbook-active'] ?? facts.conditions['standard-spellbook']
    ?? (state.rules?.['content.f2p'] !== false && safeOrigin ? true : undefined);
  if (standardBook !== undefined) for (const key of ['standard-spellbook-active', 'standard-spellbook']) {
    if (facts.conditions[key] === undefined) facts.conditions[key] = standardBook;
  }
  if (state.rules?.['content.f2p'] !== false && facts.conditions['free-to-play-world'] === undefined) facts.conditions['free-to-play-world'] = true;
  const reachableBases = new Set([...reachableLocations].map(location => location.split('-')[0]));
  const context = { facts, renewableBudget, estimatedLevels, observedLevels, reachableLocations, reachableBases, itemEvidence, baseline: result,
    source: result ? 'reachable-capabilities' : 'personal-facts', safeOrigin };
  if (signature && !baseline) cached.byMember.set(memberId, context);
  return context;
}

export function automaticRouteGroup(route) {
  if (route.kind === 'lodestone') return 'lodestones';
  if (route.automatic?.type === 'standard-spell' || route.id?.startsWith('spell')) return 'spells';
  if (route.kind === 'teleport') return 'items';
  return 'transport';
}

/** Only catalogue-specific known confirmations may be replaced by evidence.
 * Familiar state, achievements, boss kills, special builds and unknown quest
 * conditions remain explicit personal gates. */
export function automaticRouteFacts(route, context, destination, planningChunk) {
  const facts = { ...context.facts, confirmations: { ...context.facts.confirmations } };
  const confirmations = route.requirements?.confirmations ?? [];
  const metadata = route.automatic;
  const activation = metadata?.activation;
  // Availability is a planning capability: a player can dismiss an optional
  // follower before travel. This is preparation, not a claimed observation of
  // the current familiar or a choice between contradictory historical rules.
  if (route.kind === 'canoe' && confirmations.includes('canoe-familiar-state-supported')
    && facts.confirmations['canoe-familiar-state-supported'] === undefined) facts.confirmations['canoe-familiar-state-supported'] = true;
  const activationQuestComplete = activation === 'quest-completion' && (metadata.activationQuests ?? []).length
    && metadata.activationQuests.every(quest => facts.quests[quest] === true);
  if (route.kind === 'lodestone' && (activation === 'default' || activationQuestComplete
    || !['build', 'quest-completion'].includes(activation) && (context.reachableLocations.has(destination)
      || planningChunk && !destination && context.reachableBases.has(planningChunk)))) {
    for (const key of confirmations) if (typeof key === 'string' && key.startsWith('lodestone-') && key.endsWith('-activated')
      && facts.confirmations[key] === undefined) facts.confirmations[key] = true;
  }
  if (automaticRouteGroup(route) === 'spells' && confirmations.includes('teleport-runes-or-valid-substitution-available')) {
    const required = route.requirements?.items ?? [];
    if (required.length && required.every(item => (facts.items[typeof item === 'string' ? item : item.name] ?? 0) >= (typeof item === 'string' ? 1 : item.quantity ?? item.count ?? 1))
      && facts.confirmations['teleport-runes-or-valid-substitution-available'] === undefined) facts.confirmations['teleport-runes-or-valid-substitution-available'] = true;
  }
  if (route.id === 'explorer-ring--cabbage-port') {
    if (((metadata?.itemAlternatives ?? []).some(name => typeof name === 'string' && (facts.items[name] ?? 0) >= 1)
      || (route.itemVariants ?? []).some(variant => (variant.items ?? []).length && variant.items.every(item => (facts.items[item.name] ?? 0) >= (item.quantity ?? 1))))
      && facts.confirmations['explorer-ring-3-or-4-available'] === undefined) facts.confirmations['explorer-ring-3-or-4-available'] = true;
  }
  if (metadata?.type === 'item-teleport' && route.from === null && !confirmations.length) {
    const items = route.requirements?.items ?? [];
    if (items.length && items.every(item => (facts.items[typeof item === 'string' ? item : item.name] ?? 0) >= (typeof item === 'string' ? 1 : item.quantity ?? item.count ?? 1))
      && facts.confirmations[route.id] === undefined) facts.confirmations[route.id] = true;
  }
  return facts;
}
