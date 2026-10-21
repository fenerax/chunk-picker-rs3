import { datasetJSON } from "../dataset-runtime.mjs";
const helperTrainingCatalogue = await datasetJSON("app/data/training/methods.f2p.json");
const deathWoodcuttingGuide = await datasetJSON("app/data/training/death-woodcutting-guide.v1.json");
import { resolveDeathSettings } from '../core/death-settings.mjs';
import { skillCaps } from './engine.mjs';
import { collectionRules } from './collection.mjs';
import { xpForLevel, levelForXp } from '../core/experience.mjs';

// The existing death estimator includes guide handling/banking assumptions.
// Keep that reviewed route independent of Helper's new at-tree curve until
// death supply routes can model banking and personal gathering settings.
export const trainingCatalogue = { ...helperTrainingCatalogue, methods: helperTrainingCatalogue.methods.map(method => {
  const guide = deathWoodcuttingGuide.methods.find(row => row.id === method.id);
  return guide ? { ...method, ...guide } : method;
}) };
export { xpForLevel } from '../core/experience.mjs';
export { planTraining } from './training-planner.mjs';
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const nameOf = source => source.source ?? source.name ?? '';
const knownHours = value => Number.isFinite(value) && value >= 0;
const issue = (code, detail) => ({ code, detail });
const cleanItem = item => String(item).replaceAll('*', '');
const processingSkills = new Set('Runecrafting Magic Herblore Cooking Firemaking Fletching Smithing Crafting Construction Divination Archaeology Summoning Invention Necromancy'.split(' '));
const SOURCE_LIMITATIONS = 'A reachable source means you can obtain the item. It does not record what is in your inventory or the group bank.';

/** Probability must be the composed numeric evidence, never a rounded label.
 * log1p keeps the acquisition percentile usable for extremely tiny rates. */
export function estimateDrop(probability, secondsPerKill) {
  if (!(Number.isFinite(probability) && probability > 0 && probability <= 1)) return { status: 'unknown', hours: null,
    unknown: [issue('unknown-drop-probability', 'No usable drop rate is recorded.')] };
  if (!(Number.isFinite(secondsPerKill) && secondsPerKill > 0)) return { status: 'unknown', hours: null,
    unknown: [issue('missing-kill-throughput', 'No usable time per kill is recorded.')] };
  const expectedKills = 1 / probability;
  const kills95 = probability === 1 ? 1 : Math.ceil(Math.log(0.05) / Math.log1p(-probability));
  const hours = expectedKills * (secondsPerKill / 3600), acquisition95Hours = kills95 * (secondsPerKill / 3600);
  if (![expectedKills, kills95, hours, acquisition95Hours].every(Number.isFinite)) return { status: 'unknown', hours: null,
    unknown: [issue('numeric-range', 'This probability is outside the finite numeric range of the estimator.')] };
  return { status: 'estimated', probability, secondsPerKill, expectedKills, kills95, hours, acquisition95Hours, unknown: [] };
}

/** Sources already passed the engine's access/section/member gates. Preserve
 * exact task-specific source restrictions when comparing permitted routes. */
export function permittedSources(sources, record = {}) {
  return sources.filter(source => (!record.NonShop || !String(source.kind).includes('shop'))
    && (!record.AllowedSources || list(record.AllowedSources).includes(nameOf(source)))
    && (!record.Source || String(source.kind).includes(record.Source)));
}

export function estimateItemDrop(item, sources, settings, record = {}) {
  const candidates = permittedSources(sources, record).map(source => {
    if (source.kind !== 'drop') return { source, status: 'unknown', hours: null,
      unknown: [issue('unpriced-source', `${nameOf(source) || source.kind || 'Source'} has no supported estimate for the time needed to obtain this item.`)] };
    const secondsPerKill = settings.monsterSecondsPerKill[nameOf(source)] ?? settings.defaultSecondsPerKill;
    const value = estimateDrop(source.unknownRate ? null : source.probability, secondsPerKill);
    return { ...value, unknown: value.unknown.map(reason => ({ ...reason, source: nameOf(source), rawRate: source.rawRate ?? source.rate,
      detail: `${nameOf(source) || 'Unnamed monster'}: ${reason.detail}${source.rawRate || source.rate ? ` Recorded rate: ${source.rawRate || source.rate}.` : ''}` })), source, assumptions: [Object.hasOwn(settings.monsterSecondsPerKill, nameOf(source))
      ? `Uses this player's ${secondsPerKill} seconds per kill, including respawns, travel and banking for ${nameOf(source)}.`
      : `Uses the configurable ${secondsPerKill} seconds per kill placeholder; this is not a measured combat rate.`] };
  });
  const fastest = candidates.filter(value => knownHours(value.hours)).sort((a, b) => a.hours - b.hours)[0];
  const unknown = candidates.flatMap(value => value.unknown ?? []);
  if (!candidates.length) unknown.push(issue('missing-source', `No permitted source for ${item} is available after the unlock.`));
  return { ...(fastest ?? { status: 'unknown', hours: null }), status: fastest ? unknown.length ? 'partial' : 'estimated' : 'unknown',
    item, alternatives: candidates, unknown, assumptions: [...(fastest?.assumptions ?? []), SOURCE_LIMITATIONS] };
}

function requiredSkills(row) {
  const record = row.record ?? {}, targets = {};
  for (const values of [record.Requirements, record.SkillsNeeded, record.Skills]) for (const [raw, level] of Object.entries(values ?? {})) {
    const skill = Object.keys(skillCaps).find(name => name.toLowerCase() === raw.toLowerCase());
    if (skill && Number.isSafeInteger(level) && level > 1) targets[skill] = Math.max(targets[skill] ?? 1, level);
  }
  for (const { skill, level } of row.equipRequirements ?? []) if (skillCaps[skill] && Number.isSafeInteger(level) && level > 1) targets[skill] = Math.max(targets[skill] ?? 1, level);
  if (skillCaps[row.category] && Number.isSafeInteger(row.level) && row.level > 1) targets[row.category] = Math.max(targets[row.category] ?? 1, row.level);
  return targets;
}

function startingProgress(result, progress = {}) {
  const xp = {}, assumptions = {};
  const completedTargets = (result.tasks ?? []).filter(row => row.personalCompleted && row.record?.NoBoost === true).map(requiredSkills);
  for (const skill of Object.keys(skillCaps)) {
    const known = progress[skill];
    if (Number.isFinite(known?.xp) && known.xp >= 0) { xp[skill] = known.xp; assumptions[skill] = 'Uses supplied personal XP.'; continue; }
    if (Number.isSafeInteger(known?.level) && known.level >= 1 && known.level <= 120) {
      xp[skill] = xpForLevel(known.level); assumptions[skill] = `Uses the start of verified level ${known.level}; exact XP within that level is unknown.`; continue;
    }
    // NoBoost completed actions give a defensible personal level lower bound.
    // Partner checks, planning ceilings and prospective XP never become facts.
    const level = Math.max(1, ...completedTargets.map(targets => targets[skill] ?? 1));
    xp[skill] = xpForLevel(Math.min(120, level));
    assumptions[skill] = level > 1 ? `Uses the start of level ${level}, proved by personal completion of an unboostable action; exact current XP is unknown.`
      : 'No measured personal XP is saved. This is an explicit level-1, zero-XP scenario.';
  }
  return { xp, assumptions };
}

function reachableMethods(result, catalogue) {
  const matches = new Map(), byLabel = new Map();
  for (const method of catalogue.methods) for (const label of method.matches) byLabel.set(`${method.skill}\u0000${label}`, method);
  for (const row of result.tasks ?? []) if (row.status === 'available' && row.primaryMethod !== false && (row.primaryMethod || row.primary)) {
    const method = byLabel.get(`${row.category}\u0000${row.rawLabel}`);
    if (method) {
      const previous = matches.get(method.id);
      // Both own and connected partner methods are usable capabilities.
      if (!previous || previous.row.obligation === false && row.obligation !== false) matches.set(method.id, { ...method, row });
    }
  }
  return [...matches.values()];
}

function throughput(method, xp) {
  if (method.rateProfiles?.length) {
    const level = levelForXp(xp), profile = method.rateProfiles.filter(value => value.minLevel <= level).at(-1);
    if (!profile) return null;
    return { seconds: 3600 * method.xpPerAction / profile.xpPerHour + (method.handlingSeconds ?? 0), profile };
  }
  return Number.isFinite(method.processingSeconds) && method.processingSeconds > 0 ? { seconds: method.processingSeconds } : null;
}

/** A small segmented, self-supplied route. It only spends rows admitted by the
 * engine; primary presentation suppression does not remove a usable method. */
export function estimateSkill(skill, targetLevel, result, { catalogue = trainingCatalogue, progress = {} } = {}) {
  if (skill === 'Invention' || skill === 'Combat' || !Number.isSafeInteger(targetLevel) || targetLevel > 120) return { kind: 'training', skill, targetLevel,
    status: 'unknown', hours: null, unknown: [issue('unsupported-skill-target', `${skill} needs a dedicated progression model.`)], assumptions: [] };
  const initial = startingProgress(result, progress), initialXp = initial.xp[skill] ?? 0;
  const targetXp = xpForLevel(targetLevel), methods = reachableMethods(result, catalogue), skillMethods = methods.filter(method => method.skill === skill);
  const stateXp = { ...initial.xp }, route = [], sourceIds = new Set(), assumptions = new Set([initial.assumptions[skill] ?? 'Explicit level-1 scenario.']);
  const unknown = [], excluded = new Set();
  const indexes = new Map((result.items ?? []).map(item => [item.name, item.sources ?? []]));
  const gathering = methods.filter(method => method.skill === 'Woodcutting');
  let totalSeconds = 0, currentXp = initialXp;
  const supplies = (method, actions, mutate) => {
    if (!method.input) return { seconds: 0, segments: [], assumptions: [] };
    const sourceRows = indexes.get(method.input) ?? [];
    const available = gathering.filter(value => value.output === method.input && sourceRows.some(source => source.kind === 'task' && source.taskId === value.row.id));
    if (!available.length) return { unknown: issue('unknown-input-supply', `Acquisition time for consumed ${method.input} is not covered by a reachable curated gathering method.`) };
    // Other permitted routes may be faster; do not quietly price them as drops
    // or a shop with unlimited free stock.
    const unmappedSupply = sourceRows.some(source => !available.some(value => source.kind === 'task' && source.taskId === value.row.id));
    const workXp = mutate ? stateXp : { ...stateXp };
    const segments = [], addedAssumptions = [];
    let remaining = actions, seconds = 0;
    while (remaining > 0) {
      const wcXp = workXp.Woodcutting ?? 0, currentLevel = levelForXp(wcXp);
      const choices = available.filter(value => value.level <= currentLevel).map(value => ({ method: value, rate: throughput(value, wcXp) })).filter(value => value.rate);
      if (!choices.length) return { unknown: issue('unpriced-prerequisite', `The ${method.input} source needs Woodcutting ${Math.min(...available.map(value => value.level))}; no verified starting level or timed route to obtain the first supplies is available.`) };
      const best = choices.sort((a, b) => a.rate.seconds - b.rate.seconds)[0];
      const nextLevel = best.method.rateProfiles?.find(profile => profile.minLevel > currentLevel)?.minLevel;
      const count = Math.min(remaining, nextLevel ? Math.max(1, Math.ceil((xpForLevel(nextLevel) - wcXp) / best.method.xpPerAction)) : remaining);
      const duration = count * best.rate.seconds;
      seconds += duration; remaining -= count; workXp.Woodcutting = wcXp + count * best.method.xpPerAction;
      segments.push({ methodId: best.method.id, label: best.method.label, actions: count, secondsPerAction: best.rate.seconds,
        xpPerAction: best.method.xpPerAction, hours: duration / 3600, sourceIds: best.method.sourceIds, viaPartner: best.method.row.obligation === false });
      addedAssumptions.push(...best.method.assumptions);
    }
    return { seconds, segments, assumptions: addedAssumptions, unknownAlternative: unmappedSupply
      ? issue('unpriced-supply-alternative', `Other reachable ${method.input} sources have no acquisition-time data.`) : null };
  };
  // Bootstrap a gathering prerequisite using reachable normal-log training.
  const bootstrapWoodcutting = wanted => {
    if (levelForXp(stateXp.Woodcutting) >= wanted) return true;
    const bootstrap = estimateSkill('Woodcutting', wanted, result, { catalogue, progress: { ...progress, Woodcutting: { xp: stateXp.Woodcutting } } });
    if (!knownHours(bootstrap.hours)) return false;
    stateXp.Woodcutting = xpForLevel(wanted);
    totalSeconds += bootstrap.hours * 3600;
    route.push(...bootstrap.route.map(segment => ({ ...segment, prerequisite: true })));
    for (const id of bootstrap.sourceIds ?? []) sourceIds.add(id);
    bootstrap.assumptions.forEach(value => assumptions.add(value));
    return true;
  };
  if (skill !== 'Woodcutting' && currentXp < targetXp) {
    const firstSuppliers = gathering.filter(method => skillMethods.some(value => value.input === method.output));
    if (firstSuppliers.length && !bootstrapWoodcutting(Math.min(...firstSuppliers.map(value => value.level)))) unknown.push(issue('unpriced-prerequisite', 'The picker cannot find a timed route to gather the first logs from this player’s starting progress.'));
  }
  while (currentXp < targetXp && !unknown.length) {
    const currentLevel = levelForXp(currentXp);
    const choices = [];
    for (const method of skillMethods.filter(value => value.level <= currentLevel)) {
      const rate = throughput(method, currentXp);
      if (!rate) { excluded.add(method.id); continue; }
      const supply = supplies(method, 1, false);
      if (supply.unknown) { excluded.add(method.id); continue; }
      choices.push({ method, rate, supply, efficiency: method.xpPerAction / (rate.seconds + supply.seconds) });
    }
    const chosen = choices.sort((a, b) => b.efficiency - a.efficiency)[0];
    if (!chosen) { unknown.push(issue('missing-training-route', `${skill} cannot be trained from level ${currentLevel} with the reachable curated methods.`)); break; }
    const nextLevel = Math.min(targetLevel, ...skillMethods.filter(value => value.level > currentLevel).map(value => value.level),
      ...(chosen.method.rateProfiles ?? []).filter(value => value.minLevel > currentLevel).map(value => value.minLevel));
    const nextXp = Math.min(targetXp, xpForLevel(nextLevel));
    let actions = Math.max(1, Math.ceil((nextXp - currentXp) / chosen.method.xpPerAction));
    // Gathering also advances Woodcutting. Re-rank artisan methods when a new
    // tree/rate profile becomes executable rather than freezing an oak choice
    // for an entire level-25-to-99 segment after willow gets faster.
    if (chosen.method.input) {
      const supplier = gathering.find(method => method.id === chosen.supply.segments[0]?.methodId);
      const wcLevel = levelForXp(stateXp.Woodcutting);
      const breakpoints = gathering.flatMap(method => [method.level, ...(method.rateProfiles ?? []).map(profile => profile.minLevel)]).filter(level => level > wcLevel);
      if (supplier && breakpoints.length) actions = Math.min(actions, Math.max(1, Math.ceil((xpForLevel(Math.min(...breakpoints)) - stateXp.Woodcutting) / supplier.xpPerAction)));
    }
    const supply = supplies(chosen.method, actions, true);
    if (supply.unknown) { unknown.push(supply.unknown); break; }
    const seconds = actions * chosen.rate.seconds + supply.seconds;
    const toXp = currentXp + actions * chosen.method.xpPerAction;
    route.push({ methodId: chosen.method.id, label: chosen.method.label, fromXp: currentXp, toXp, actions, xpPerAction: chosen.method.xpPerAction,
      processingSeconds: actions * chosen.rate.seconds, supplySeconds: supply.seconds, processingSecondsPerAction: chosen.rate.seconds, secondsPerAction: seconds / actions,
      hours: seconds / 3600, sourceIds: chosen.method.sourceIds, supplies: supply.segments, viaPartner: chosen.method.row.obligation === false });
    totalSeconds += seconds; currentXp = toXp;
    if (skill === 'Woodcutting') stateXp.Woodcutting = currentXp;
    for (const id of [...chosen.method.sourceIds, ...supply.segments.flatMap(value => value.sourceIds)]) sourceIds.add(id);
    [...chosen.method.assumptions, ...supply.assumptions].forEach(value => assumptions.add(value));
    if (supply.unknownAlternative) excluded.add(supply.unknownAlternative.detail);
  }
  const matchedRows = new Set(methods.map(method => method.row.id));
  const unpriced = (result.tasks ?? []).filter(row => row.category === skill && row.status === 'available' && (row.primaryMethod ?? row.primary)
    && !matchedRows.has(row.id) && !list(row.record?.Category).some(value => /skillcape|BIS|Relic/i.test(value)));
  if (unpriced.length && initialXp < targetXp) unknown.push(issue('unmapped-method', `${unpriced.length} other reachable ${skill} method${unpriced.length === 1 ? '' : 's'} have no reviewed XP per action and total action time.`));
  if (excluded.size) unknown.push(issue('unpriced-alternative', 'Some reachable method or supply alternatives could be faster but have no complete timing data.'));
  const completeRoute = currentXp >= targetXp;
  return { kind: 'training', skill, targetLevel, targetXp, startingLevel: levelForXp(initialXp), startingXp: initialXp,
    hours: completeRoute ? totalSeconds / 3600 : null, status: completeRoute ? unknown.length ? 'partial' : 'estimated' : 'unknown', route,
    sourceIds: [...sourceIds], sources: catalogue.sources.filter(source => sourceIds.has(source.id)), unknown, assumptions: [...assumptions, SOURCE_LIMITATIONS],
    limitations: ['This is the fastest priced route in the small curated catalogue, not a globally optimal cross-skill route. Gathering XP is tracked within the route; time shared with other tasks is not added again.'] };
}

const familyOf = row => row.record?.Label === 'Every Drop' ? `item:${row.item}` : row.record?.Label === 'All Droptables'
  ? `collection:${row.collectionSource}:${row.item}:${row.quantity}` : row.record?.Label === 'Kill X' ? `kills:${row.monster}`
    : row.equipmentName ? `item:${row.equipmentName}` : row.id;

function duties(result, member) {
  const selectedEquipment = new Set(result.equipmentPlanning?.obligationIds ?? result.presentation?.tasks?.filter(row => row.equipmentName).map(row => row.id) ?? []);
  const map = new Map();
  for (const row of result.tasks ?? []) {
    if (row.obligation === false || row.challengeSatisfied || row.personalCompleted || member.completedTasks?.includes(row.id)) continue;
    if (row.equipmentName && !selectedEquipment.has(row.id)) continue;
    const family = familyOf(row), duty = map.get(family) ?? { family, row, rows: [], targets: {} };
    duty.rows.push(row);
    for (const [skill, level] of Object.entries(requiredSkills(row))) duty.targets[skill] = Math.max(duty.targets[skill] ?? 1, level);
    map.set(family, duty);
  }
  return map;
}

/** Pure advisory estimate over predictChunk's full baseline/post-unlock result.
 * The worker owns prediction, scheduling, and revision/member/candidate caching. */
export function estimateChunk(state, memberId, chunkId, { prediction, baseline, catalogue = trainingCatalogue, progress = {} } = {}) {
  const member = state.members.find(value => value.id === memberId);
  if (!member) throw new RangeError(`Unknown member: ${memberId}`);
  if (!prediction?.result?.tasks || !baseline?.tasks) throw new TypeError('Chunk estimates require full baseline and hypothetical prediction results.');
  const settings = resolveDeathSettings(member), before = duties(baseline, member), after = duties(prediction.result, member);
  const taskRules = collectionRules(state, memberId), skillCache = new Map();
  const skillEstimate = (skill, level) => {
    const key = `${skill}:${level}`;
    if (!skillCache.has(key)) skillCache.set(key, estimateSkill(skill, level, prediction.result, { catalogue, progress }));
    return skillCache.get(key);
  };
  const breakdown = [], items = new Map((prediction.result.items ?? []).map(item => [item.name, item.sources ?? []]));
  const knownTargets = {};
  for (const duty of before.values()) if (duty.rows.some(row => row.status === 'available')) for (const [skill, level] of Object.entries(duty.targets)) knownTargets[skill] = Math.max(knownTargets[skill] ?? 1, level);
  const emittedSkills = new Map();
  const decorate = (duty, value) => ({ id: duty.row.id, label: duty.row.label, taskIds: duty.rows.map(row => row.id),
    obligationFamily: duty.family, qualifyingLocations: list(duty.row.record?.Chunks), ...value });
  for (const duty of after.values()) {
    const old = before.get(duty.family), raised = Object.entries(duty.targets).some(([skill, level]) => level > (old?.targets[skill] ?? 1));
    const activated = old && old.rows.every(row => row.status !== 'available') && duty.rows.some(row => row.status === 'available');
    if (old && !raised && !activated && Number(duty.row.amount ?? 0) <= Number(old.row.amount ?? 0)) continue;
    const row = duty.row, backlogged = duty.rows.every(value => member.taskStatus?.[value.id]?.backlogged || value.blockers?.some(blocker => blocker.kind === 'backlog'));
    if (backlogged) { breakdown.push(decorate(duty, { kind: 'task', status: 'deferred', hours: null, assumptions: ['This player has backlogged the task, so its time is deferred.'], unknown: [] })); continue; }
    if (duty.rows.every(value => value.status !== 'available') && duty.rows.some(value => value.blockers?.some(blocker => blocker.kind === 'membership'))) {
      breakdown.push(decorate(duty, { kind: 'task', status: 'deferred', hours: null, assumptions: ['Your current membership rule defers this task. The estimate does not assume you will become a member.'], unknown: [] })); continue;
    }
    if (duty.rows.every(value => value.status !== 'available') && duty.rows.some(value => value.status === 'unsupported' || value.blockers?.some(blocker => !['training'].includes(blocker.kind)))) {
      breakdown.push(decorate(duty, { kind: 'task', status: 'unknown', hours: null, unknown: [issue('unpriced-prerequisite',
        `This task on your own map is unavailable: ${duty.rows.flatMap(value => value.blockers ?? []).map(value => value.detail).join(' ') || 'Unsupported requirements.'}`)], assumptions: [] })); continue;
    }
    if (row.record?.Label === 'Kill X') {
      const secondsPerKill = settings.monsterSecondsPerKill[row.monster] ?? settings.defaultSecondsPerKill;
      breakdown.push(decorate(duty, { kind: 'kills', status: 'estimated', hours: row.amount * secondsPerKill / 3600, expectedKills: row.amount,
        secondsPerKill, source: { kind: 'monster', name: row.monster }, assumptions: ['Zero kill progress is assumed; partial kill progress is not recorded.', Object.hasOwn(settings.monsterSecondsPerKill, row.monster)
          ? 'Uses this player’s saved time per kill, including respawns, travel and banking.' : 'Uses your starting estimate for seconds per kill; this is not a measured rate.'], unknown: [] }));
      continue;
    }
    const item = row.item ?? row.equipmentName ?? (/^(obtain|get|collect|loot)\b/i.test(row.label)
      && list(row.record?.Items).length === 1 ? cleanItem(list(row.record.Items)[0]) : undefined);
    if (item) {
      let sources = items.get(item) ?? duty.rows.flatMap(value => value.sources ?? []);
      if (row.equipmentName && [undefined, false, 'false', 0].includes(taskRules['Wield Crafted Items'])) sources = sources.filter(source => !(source.kind === 'task' && processingSkills.has(source.category)));
      if (row.record?.Label === 'All Droptables') sources = duty.rows.flatMap(value => value.sources ?? []).filter(source => nameOf(source) === row.collectionSource
        && (row.quantity === undefined || source.quantity === row.quantity));
      const record = row.record?.Label === 'Every Drop' ? { ...row.record, Source: 'drop' } : row.record;
      const acquisition = estimateItemDrop(item, sources, settings, record);
      const parts = Object.entries(duty.targets).map(([skill, level]) => skillEstimate(skill, level));
      const prepUnknown = parts.flatMap(part => part.unknown), knownPreparationHours = parts.filter(part => knownHours(part.hours)).reduce((sum, part) => sum + part.hours, 0);
      breakdown.push(decorate(duty, { kind: 'drop', ...acquisition,
        hours: knownHours(acquisition.hours) ? acquisition.hours + knownPreparationHours : null, acquisitionHours: acquisition.hours,
        status: knownHours(acquisition.hours) ? acquisition.unknown.length || prepUnknown.length ? 'partial' : 'estimated' : 'unknown',
        parts, unknown: [...acquisition.unknown, ...prepUnknown], assumptions: [...acquisition.assumptions, ...new Set(parts.flatMap(part => part.assumptions))],
        sources: parts.flatMap(part => part.sources ?? []) }));
      continue;
    }
    const targets = Object.entries(duty.targets).filter(([skill, level]) => level > (knownTargets[skill] ?? 1));
    if (targets.length === 1) {
      const [skill, level] = targets[0], existing = emittedSkills.get(skill);
      if (existing && existing.targetLevel >= level) { existing.taskIds.push(...duty.rows.map(value => value.id)); continue; }
      const value = decorate(duty, { label: `${skill} level ${level} — ${row.label}`, ...skillEstimate(skill, level) });
      if (existing) { value.taskIds.push(...existing.taskIds); breakdown.splice(breakdown.indexOf(existing), 1); }
      emittedSkills.set(skill, value); breakdown.push(value);
    } else if (targets.length > 1) {
      const parts = targets.map(([skill, level]) => skillEstimate(skill, level));
      const complete = parts.every(part => knownHours(part.hours));
      breakdown.push(decorate(duty, { kind: 'training', status: complete ? parts.some(part => part.unknown.length) ? 'partial' : 'estimated' : 'unknown',
        hours: complete ? parts.reduce((sum, part) => sum + part.hours, 0) : null, parts, unknown: parts.flatMap(part => part.unknown),
        assumptions: ['Required skill-training times are added separately; time saved by training several skills together is unknown.', ...new Set(parts.flatMap(part => part.assumptions))] }));
    } else {
      breakdown.push(decorate(duty, { kind: 'task', status: 'unknown', hours: null, unknown: [issue('unpriced-obligation',
        'The picker cannot yet estimate the extra time for this task, its prerequisites or its existing skill goal.')], assumptions: [] }));
    }
  }
  const priced = breakdown.filter(row => knownHours(row.hours)).sort((a, b) => b.hours - a.hours), slowest = priced[0] ?? null;
  const unknown = breakdown.flatMap(row => row.unknown.map(value => ({ id: row.id, label: row.label, ...value })));
  const hours = slowest?.hours ?? (breakdown.some(row => row.status === 'unknown') ? null : 0);
  const death = knownHours(hours) && hours > settings.deathThresholdHours;
  return { chunkId, memberId, stateRevision: state.revision, catalogueVersion: catalogue.version, thresholdHours: settings.deathThresholdHours, hours, death,
    status: unknown.length ? 'undetermined' : death ? 'estimated-exceeds' : 'estimated-below', slowest, breakdown, unknown,
    assumptions: ['The warning compares the single slowest new or increased task, using hours before rounding.',
      'Hours count the selected player’s active play on a solo route. Partner territory can supply training and items; it does not add personal tasks.',
      'Estimates are advice. Tasks and alternative routes with unknown times may change the result; drop chances cannot guarantee when an item arrives.'] };
}
