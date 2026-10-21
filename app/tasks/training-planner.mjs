import { datasetJSON } from "../dataset-runtime.mjs";
import trainingCatalogue from '../data/training/catalogue.mjs';
import { personalQuestProgressBlocker } from './personal-quest-progress.mjs';
import { xpForLevel, levelForXp } from '../core/experience.mjs';
import { skillCaps, f2pCap } from './engine.mjs';
import { skillGuideBreakpoints } from '../data/skill-guides.mjs';
import { MINING_PICKAXES, MINING_PROFILES, lookupMiningRate } from '../training/mining-rates.mjs';
const miningRateCatalogue = await datasetJSON("app/data/training/mining-rates.v1.json");
import { WOODCUTTING_HATCHETS, lookupWoodcuttingRate } from '../training/woodcutting-rates.mjs';
const woodcuttingRateCatalogue = await datasetJSON("app/data/training/woodcutting-rates.v1.json");
import { fishingMetrics, fishingSegment, fishingOutputQuantity, canMergeFishing, mergeFishingSegment } from './fishing-plan.mjs';
import { withGatheringBanking } from './banking-plan.mjs';
import { gatheringSettingDefinitions, calculatorBankingSettingDefinitions as bankingSettingDefinitions } from '../core/gathering-settings.mjs';

export const trainingPreferences = Object.freeze(['best-xp', 'balanced', 'money-making']);
const list = value => value == null ? [] : Array.isArray(value) ? value : value instanceof Set ? [...value] : [value];
const sets = { object: 'objects', npc: 'npcs', monster: 'monsters', shop: 'shops', area: 'areas' };
const positive = value => Number.isFinite(value) && value > 0;

function alternatives(requirement, availability) {
  const name = String(requirement.name ?? requirement.id ?? '').replaceAll('*', '');
  const countMatch = /^(.*\[\+\])(?:x(\d+))?$/.exec(name);
  if (!countMatch) return { names: [name], count: 1 };
  const aliases = availability.aliases?.[requirement.kind] ?? {};
  const exact = aliases[countMatch[1]];
  const same = Object.keys(aliases).filter(alias => alias.toLowerCase() === countMatch[1].toLowerCase());
  const values = exact ?? (same.length === 1 ? aliases[same[0]] : undefined);
  return { names: values ? Array.isArray(values) ? values : Object.keys(values) : [], count: Number(countMatch[2] ?? 1), alias: name };
}

function requirementBlockers(requirement, availability) {
  if (requirement.anyOf) {
    const choices = requirement.anyOf.map(choice => requirementBlockers(choice, availability));
    if (choices.some(choice => !choice.length)) return [];
    return [{ kind: 'alternatives', detail: 'At least one of these requirements is needed.', alternatives: choices.flat() }];
  }
  const { kind, level } = requirement;
  if (kind === 'quest-progress') {
    const proof = requirement.completedMethod;
    if (proof && (availability.completedTasks ?? []).some(task => task.category === proof.category
      && [task.id, task.rawLabel, task.label].some(name => [proof.id, proof.name].includes(name)))) return [];
    const blocker = personalQuestProgressBlocker({ quest: requirement.name, progress: requirement.progress, detail: requirement.detail }, availability.completedQuests);
    return blocker ? [blocker] : [];
  }
  if (kind === 'task') {
    const completed = (availability.completedTasks ?? []).some(task => task.category === requirement.category
      && [task.id, task.rawLabel, task.label].includes(requirement.name ?? requirement.id));
    return completed ? [] : [{ kind: 'task', name: requirement.name ?? requirement.id, category: requirement.category,
      detail: `Personal completion of ${requirement.name ?? requirement.id} (${requirement.category}) is needed.`, locations: [] }];
  }
  if (!['item', 'chunk', 'quest', 'skill', ...Object.keys(sets)].includes(kind)) return [{ kind: 'unsupported-selector', name: requirement.name ?? requirement.id,
    detail: `The picker cannot yet check this ${kind} requirement.`, locations: [] }];
  if (kind === 'monster' && requirement.name === 'Monster[+]') return list(availability.access?.monsters).length ? []
    : [{ kind, name: requirement.name, detail: 'Need an available monster.', locations: [] }];
  const { names, count, alias } = alternatives(requirement, availability);
  if (!names.length) return [{ kind: 'unsupported-selector', name: alias, detail: `Unknown ${kind} alias ${alias}.`, locations: [] }];
  const access = availability.access ?? {};
  const has = name => {
    if (kind === 'item') return list(availability.items).some(item => (typeof item === 'string' ? item : item.name) === name);
    if (kind === 'chunk') return /^\d+-\d+$/.test(name) ? list(access.sections).includes(name) : list(access.bases).includes(name) || list(access.areas).includes(name);
    if (kind === 'quest') return list(availability.completedQuests).includes(name);
    if (kind === 'skill') return Number.isFinite(availability.skills?.[name]) && availability.skills[name] >= level;
    if (kind === 'monster' && name === 'Monster[+]') return list(access.monsters).length > 0;
    return !!sets[kind] && list(access[sets[kind]]).includes(name);
  };
  if (names.filter(has).length >= count) return [];
  const locations = names.flatMap(name => list(availability.sourceLocations?.[`${kind}:${name}`]));
  const unique = [...new Map(locations.map(location => [JSON.stringify(location), location])).values()];
  return [{ kind, name: requirement.name ?? requirement.id, ...(level ? { level } : {}),
    detail: kind === 'skill' ? `${names[0]} ${level} is needed; current level ${availability.skills?.[names[0]] ?? 'unknown'}.`
      : `Need ${requirement.name ?? requirement.id}${count > 1 ? ` (${count} alternatives)` : ''}.`,
    locations: unique, ...(alias ? { alternatives: names } : {}) }];
}

/** All selectors fail closed. Obtainable items are capabilities, not inventory. */
export function trainingMethodBlockers(method, availability = {}) {
  const blockers = [];
  if (availability.members !== true && method.members !== false) blockers.push({ kind: 'membership', detail: method.members === true ? 'This method requires membership.' : 'Membership has not been reviewed for this method.' });
  for (const requirement of method.requirements ?? []) blockers.push(...requirementBlockers(requirement, availability));
  for (const input of method.inputs ?? []) {
    const missing = requirementBlockers({ kind: 'item', name: input.item }, availability);
    if (!blockers.some(blocker => blocker.kind === 'item' && blocker.name === input.item)) blockers.push(...missing);
  }
  for (const [name, level] of Object.entries(method.requiredSkills ?? {})) blockers.push(...requirementBlockers({ kind: 'skill', name, level }, availability));
  return blockers;
}

function hourlyRate(method, level) {
  const profile = (method.rateProfiles ?? []).filter(value => value.minLevel <= level).sort((a, b) => b.minLevel - a.minLevel)[0];
  // xpPerHour is a reviewed effective rate; processingSeconds is a recipe
  // interval and is deliberately not promoted to an effective hourly rate.
  const rate = profile?.xpPerHour ?? method.xpPerHour;
  if (!positive(rate)) return null;
  return profile && positive(method.xpPerAction) && positive(method.handlingSeconds) && method.rateIncludesHandling !== true
    ? 3600 * method.xpPerAction / (3600 * method.xpPerAction / rate + method.handlingSeconds) : rate;
}

function miningRate(method, level, availability) {
  if (!method.miningCurve) return null;
  const strengthKnown = Number.isSafeInteger(availability.skills?.Strength) && availability.skills.Strength >= 1;
  const strengthLevel = strengthKnown ? Math.min(120, availability.skills.Strength) : 1;
  const selected = availability.miningPickaxe ?? 'auto';
  const tools = MINING_PICKAXES.filter(tool => selected === 'auto' || selected === tool.id);
  const rates = tools.map(tool => lookupMiningRate({ rockId: method.miningCurve.rockId, miningLevel: level,
    strengthLevel, pickaxeId: tool.id, profileId: availability.miningAttention ?? 'active' }, miningRateCatalogue))
    .filter(rate => rate !== null).sort((a, b) => b.xpPerHour - a.xpPerHour || b.orePerHour - a.orePerHour);
  const rate = rates[0];
  if (!rate) return null;
  return { ...rate, strengthLevel, strengthSource: strengthKnown ? 'saved' : 'conservative-default', attention: rate.profileId,
    assumptions: [...rate.assumptions, strengthKnown ? `Uses this player's saved Strength level ${strengthLevel}.`
      : 'Strength is unknown; conservatively assumes level 1.',
    selected === 'auto' ? 'Assumes the strongest F2P pickaxe this Mining level allows; ownership and acquisition are not confirmed.'
      : 'Uses the selected pickaxe as an estimate assumption; ownership and acquisition are not confirmed.'] };
}

function metrics(method, level, availability = {}, detail = false) {
  const mining = miningRate(method, level, availability);
  const fish = fishingMetrics(method, level);
  const woodcutting = method.woodcuttingCurve ? lookupWoodcuttingRate({ treeId: method.woodcuttingCurve.treeId,
    woodcuttingLevel: level, hatchetId: availability.woodcuttingHatchet ?? 'auto' }, woodcuttingRateCatalogue) : null;
  if (woodcutting) woodcutting.assumptions = [...woodcutting.assumptions,
    (availability.woodcuttingHatchet ?? 'auto') === 'auto'
      ? 'Assumes the strongest F2P hatchet this Woodcutting level allows; ownership and acquisition are not confirmed.'
      : 'Uses the selected hatchet as an estimate assumption; ownership and acquisition are not confirmed.'];
  const xpPerHour = method.miningCurve ? mining?.xpPerHour ?? null
    : method.woodcuttingCurve ? woodcutting?.xpPerHour ?? null
    : method.fishingCurve ? fish.fishing?.xpPerHour ?? null : hourlyRate(method, level);
  const gpPerAction = positive(method.xpPerAction) && Number.isFinite(method.economics?.gpPerAction) ? method.economics.gpPerAction : null;
  const gpPerHour = xpPerHour !== null && gpPerAction !== null ? gpPerAction * xpPerHour / method.xpPerAction
    : Number.isFinite(method.economics?.gpPerHour) ? method.economics.gpPerHour : null;
  const result = { method, xpPerHour, gpPerAction, costPerXp: xpPerHour && gpPerHour !== null ? -gpPerHour / xpPerHour : null, gpPerHour, ...fish,
    ...(method.miningCurve ? { orePerHour: mining?.orePerHour ?? null, xpPerOre: mining?.xpPerOre ?? null,
      mining, modelAssumptions: mining?.assumptions ?? [] } : {}),
    ...(method.woodcuttingCurve ? { logsPerHour: woodcutting?.logsPerHour ?? null,
      woodcutting, modelAssumptions: woodcutting?.assumptions ?? [] } : {}) };
  const adjusted = withGatheringBanking(result, method, level, availability, detail);
  if (adjusted !== result && gpPerHour !== null && xpPerHour > 0) {
    adjusted.gpPerHour = adjusted.xpPerHour === null ? null : gpPerHour * adjusted.xpPerHour / xpPerHour;
    adjusted.costPerXp = adjusted.gpPerHour === null || !adjusted.xpPerHour ? null : -adjusted.gpPerHour / adjusted.xpPerHour;
  }
  return adjusted;
}

function choose(choices, preference, cheapCostPerXp) {
  const timed = choices.filter(choice => choice.xpPerHour !== null);
  if (preference === 'best-xp') return timed.sort((a, b) => b.xpPerHour - a.xpPerHour || a.method.id.localeCompare(b.method.id))[0];
  const priced = timed.filter(choice => choice.gpPerHour !== null);
  if (preference === 'money-making') return priced.sort((a, b) => b.gpPerHour - a.gpPerHour || b.xpPerHour - a.xpPerHour || a.method.id.localeCompare(b.method.id))[0];
  const cheap = priced.filter(choice => choice.costPerXp <= cheapCostPerXp);
  return cheap.length ? choose(cheap, 'best-xp', cheapCostPerXp)
    : priced.sort((a, b) => a.costPerXp - b.costPerXp || b.xpPerHour - a.xpPerHour || a.method.id.localeCompare(b.method.id))[0];
}

function planPreference(skill, initialXp, targetXp, methods, availability, preference) {
  let currentXp = initialXp, hours = 0, netGp = 0, unknownCost = false;
  const segments = [], issues = [];
  const cap = availability.f2pCap ?? (availability.members === true ? skillCaps[skill] : f2pCap(skill));
  while (currentXp < targetXp) {
    const level = levelForXp(currentXp);
    const eligible = methods.filter(method => method.level <= level && (method.maxLevel ?? cap) >= level);
    const chosen = choose(eligible.map(method => metrics(method, level, availability)), preference, availability.cheapCostPerXp ?? 1);
    if (!chosen) {
      issues.push({ code: eligible.length ? preference === 'best-xp' ? 'unknown-rate' : 'unknown-economics' : 'nothing-available',
        detail: eligible.length ? `No reviewed ${preference === 'best-xp' ? 'hourly rate' : 'hourly rate and economics'} for ${skill} at level ${level}.`
          : `No available ${skill} method at level ${level}.` });
      break;
    }
    const { method, xpPerHour, gpPerAction } = chosen;
    const breakpoints = [...((chosen.mining || chosen.woodcutting || chosen.fishing) && level < 120 ? [level + 1] : []), ...methods.flatMap(value => [value.level, (value.maxLevel ?? cap) + 1, ...(value.rateProfiles ?? []).map(profile => profile.minLevel)])]
      .filter(value => Number.isSafeInteger(value) && value > level && value <= 120);
    const nextXp = Math.min(targetXp, breakpoints.length ? xpForLevel(Math.min(...breakpoints)) : targetXp);
    const xpNeeded = nextXp - currentXp, actions = !chosen.woodcutting && !chosen.fishing && positive(method.xpPerAction) ? Math.ceil(xpNeeded / method.xpPerAction) : null;
    const xpEarned = actions === null ? xpNeeded : actions * method.xpPerAction;
    const duration = xpEarned / xpPerHour, gp = chosen.gpPerHour === null ? null : gpPerAction === null || actions === null ? chosen.gpPerHour * duration : gpPerAction * actions;
    const segment = { methodId: method.id, label: chosen.label ?? method.label, fromLevel: level, toLevel: levelForXp(currentXp + xpEarned),
      fromXp: currentXp, toXp: currentXp + xpEarned, xpNeeded, xpEarned, xpPerAction: method.xpPerAction, actions, hours: duration, xpPerHour,
      netGp: gp, costGp: gp === null ? null : Math.max(0, -gp), profitGp: gp === null ? null : Math.max(0, gp),
      costPerXp: chosen.costPerXp, gpPerHour: chosen.gpPerHour, priceDate: method.economics?.priceDate ?? null,
      estimateQuality: method.estimateQuality ?? 'fixture', requirements: method.requirements ?? [],
      inputs: (method.inputs ?? []).map(input => ({ ...input, totalQuantity: input.quantity === null ? null
        : chosen.fishing ? input.quantity * chosen.fishPerHour * duration : actions === null ? null : input.quantity * actions })),
      outputs: (chosen.fishing && chosen.banking?.mode === 'bank' ? chosen.fishing.species.map(fish => ({ item: fish.item, quantity: null })) : method.outputs ?? []).map(output => ({ ...output, totalQuantity: chosen.fishing ? fishingOutputQuantity(chosen.fishing, output, duration)
        : output.quantity === null ? null : chosen.woodcutting ? output.quantity * chosen.logsPerHour * duration : actions === null ? null : output.quantity * actions })),
      sourceIds: [...new Set([...(method.sourceIds ?? []), ...(method.economics?.sourceIds ?? [])])], assumptions: method.assumptions ?? [],
      ...(chosen.mining ? { orePerHour: chosen.orePerHour, oreProduced: chosen.orePerHour * duration, xpPerOre: chosen.xpPerOre, mining: chosen.mining,
        modelAssumptions: chosen.modelAssumptions, xpPerHourStart: xpPerHour, xpPerHourEnd: xpPerHour,
        orePerHourStart: chosen.orePerHour, orePerHourEnd: chosen.orePerHour } : {}),
      ...(chosen.woodcutting ? { logsPerHour: chosen.logsPerHour, logsProduced: chosen.logsPerHour * duration,
        woodcutting: chosen.woodcutting, modelAssumptions: chosen.modelAssumptions,
        xpPerHourStart: xpPerHour, xpPerHourEnd: xpPerHour,
        logsPerHourStart: chosen.logsPerHour, logsPerHourEnd: chosen.logsPerHour } : {}),
      ...(chosen.fishing ? fishingSegment(chosen.fishing, duration) : {}),
      ...(chosen.banking ? { banking: chosen.banking } : {}),
      ...(preference === 'money-making' && gp !== null && gp <= 0 ? { note: 'No profitable reviewed method is available at this level; this is the best reviewed GP/hour option for the bootstrap.' } : {}) };
    const previous = segments.at(-1);
    if (chosen.mining && previous?.methodId === method.id && previous.mining?.pickaxeId === chosen.mining.pickaxeId
      && previous.mining?.profileId === chosen.mining.profileId) {
      const ore = previous.orePerHour * previous.hours + segment.orePerHour * segment.hours;
      previous.toLevel = segment.toLevel; previous.toXp = segment.toXp;
      previous.xpNeeded += segment.xpNeeded; previous.xpEarned += segment.xpEarned; previous.hours += segment.hours;
      previous.xpPerHour = previous.xpEarned / previous.hours; previous.orePerHour = ore / previous.hours;
      previous.oreProduced += segment.oreProduced;
      previous.xpPerOre = previous.xpEarned / ore;
      previous.xpPerHourEnd = segment.xpPerHour; previous.orePerHourEnd = segment.orePerHour;
      previous.miningEnd = segment.mining;
    } else if (chosen.woodcutting && previous?.methodId === method.id && previous.woodcutting?.hatchetId === chosen.woodcutting.hatchetId) {
      previous.toLevel = segment.toLevel; previous.toXp = segment.toXp;
      previous.xpNeeded += segment.xpNeeded; previous.xpEarned += segment.xpEarned; previous.hours += segment.hours;
      previous.logsProduced += segment.logsProduced;
      previous.xpPerHour = previous.xpEarned / previous.hours; previous.logsPerHour = previous.logsProduced / previous.hours;
      previous.xpPerHourEnd = segment.xpPerHour; previous.logsPerHourEnd = segment.logsPerHour;
      previous.woodcuttingEnd = segment.woodcutting;
      for (const key of ['netGp', 'costGp', 'profitGp']) previous[key] = previous[key] === null || segment[key] === null ? null : previous[key] + segment[key];
      previous.gpPerHour = previous.netGp === null ? null : previous.netGp / previous.hours;
      for (let index = 0; index < previous.outputs.length; index++) {
        const before = previous.outputs[index].totalQuantity, added = segment.outputs[index].totalQuantity;
        previous.outputs[index].totalQuantity = before === null || added === null ? null : before + added;
      }
    } else if (chosen.fishing && canMergeFishing(previous, segment)) mergeFishingSegment(previous, segment);
    else segments.push(segment);
    hours += duration; if (gp === null) unknownCost = true; else netGp += gp;
    currentXp += xpEarned;
  }
  const complete = currentXp >= targetXp;
  return { preference, status: complete ? unknownCost ? 'partial' : 'estimated' : segments.length ? 'incomplete' : 'unavailable',
    complete, segments, xpNeeded: Math.max(0, targetXp - initialXp), xpRemaining: Math.max(0, targetXp - currentXp),
    hours: complete ? hours : null, partialHours: hours,
    netGp: complete && !unknownCost ? netGp : null, partialNetGp: unknownCost ? null : netGp, issues };
}

/** Pure advisory plan. Pass availability.catalogue for fixtures/custom data.
 * preference is all (default), best-xp, balanced, or money-making; all three
 * plans are always returned, with recommendation selecting the requested one.
 * Economics value consumed/gathered items at dated GE guide prices; they do
 * not assume an ironman can buy supplies. Time excludes supply acquisition. */
export function planTraining(skill, fromLevel, toLevel, availability = {}, preference = 'all') {
  if (!Object.hasOwn(skillCaps, skill) || skill === 'Combat') throw new RangeError(`Unknown training skill: ${skill}`);
  if (!Number.isSafeInteger(toLevel) || toLevel < 1 || toLevel > 120) throw new RangeError('Target level must be an integer from 1 through 120.');
  if (fromLevel !== null && fromLevel !== undefined && (!Number.isSafeInteger(fromLevel) || fromLevel < 1 || fromLevel > 120)) throw new RangeError('Starting level must be an integer from 1 through 120, or unknown.');
  if (preference !== 'all' && !trainingPreferences.includes(preference)) throw new RangeError(`Unknown training preference: ${preference}`);
  for (const definition of [...bankingSettingDefinitions, ...gatheringSettingDefinitions]) if (availability[definition.id] !== undefined && !definition.options.includes(availability[definition.id])) throw new RangeError(`Choose a valid ${definition.label.toLowerCase()}.`);
  if (availability.cheapCostPerXp !== undefined && (!Number.isFinite(availability.cheapCostPerXp) || availability.cheapCostPerXp < 0)) throw new RangeError('Cheap cost per XP must be finite and nonnegative.');
  if (skill === 'Mining') {
    if (availability.miningPickaxe !== undefined && availability.miningPickaxe !== 'auto' && !MINING_PICKAXES.some(tool => tool.id === availability.miningPickaxe)) throw new RangeError('Choose a reviewed F2P Mining pickaxe.');
    if (availability.miningAttention !== undefined && !MINING_PROFILES.some(profile => profile.id === availability.miningAttention)) throw new RangeError('Choose a reviewed Mining attention profile.');
  }
  if (skill === 'Woodcutting' && availability.woodcuttingHatchet !== undefined && availability.woodcuttingHatchet !== 'auto'
    && !WOODCUTTING_HATCHETS.some(tool => tool.id === availability.woodcuttingHatchet)) throw new RangeError('Choose a reviewed F2P Woodcutting hatchet.');
  if (skill === 'Woodcutting' && fromLevel != null) {
    const selected = WOODCUTTING_HATCHETS.find(tool => tool.id === availability.woodcuttingHatchet);
    if (selected && fromLevel < selected.level) throw new RangeError(`${selected.label} requires Woodcutting ${selected.level}; choose a usable hatchet or Best for my level.`);
  }
  const catalogue = availability.catalogue ?? trainingCatalogue;
  const skillInfo = catalogue.skills?.find(value => value.skill === skill);
  const cap = availability.f2pCap ?? (availability.members === true ? skillCaps[skill] : skillInfo?.f2pCap ?? f2pCap(skill));
  const base = { schemaVersion: 1, catalogueVersion: catalogue.version, skill, fromLevel: fromLevel ?? null, toLevel, preference, cap,
    ...(['Mining', 'Woodcutting', 'Fishing'].includes(skill) ? { gatheringMode: availability.gatheringMode ?? 'drop',
      gatheringProcessing: skill === 'Fishing' && availability.gatheringProcessing === 'cook-drop' ? 'cook-drop'
        : skill === 'Woodcutting' && availability.gatheringProcessing === 'fletch-drop' ? 'fletch-drop' : 'none' } : {}),
    ...(skill === 'Mining' ? { miningSettings: { pickaxeId: availability.miningPickaxe ?? 'auto', profileId: availability.miningAttention ?? 'active' } } : {}),
    ...(skill === 'Woodcutting' ? { woodcuttingSettings: { hatchetId: availability.woodcuttingHatchet ?? 'auto' } } : {}),
    skillGuideBreakpoints: skillGuideBreakpoints(skill, { catalogue: availability.skillGuideCatalogue, members: availability.members === true }),
    limitations: ['Recommendations compare reviewed catalogue methods only; rates depend on gear and attention.',
      'Reachable items prove obtainability, not inventory stock. Gather/travel/buy time is excluded; input quantities are shown.',
      'GP is a dated Grand Exchange guide-price opportunity-cost estimate, not guaranteed sale profit or an ironman purchase route.'] };
  if (fromLevel === null || fromLevel === undefined) return { ...base, status: 'unknown-level', plans: {}, recommendation: null,
    issues: [{ code: 'unknown-level', detail: 'Your current level is unknown. Enter a starting level or sync RuneMetrics.' }], lockedMethods: [] };
  if (skill === 'Invention' || toLevel > cap || availability.members !== true && skillInfo?.status === 'unavailable') return { ...base, status: 'unavailable', plans: {}, recommendation: null,
    issues: [{ code: 'skill-cap', detail: skill === 'Invention' ? 'Invention requires membership and a dedicated XP curve.' : `${skill} ${toLevel} exceeds the ${availability.members === true ? 'skill' : 'F2P'} cap ${cap}.` }], lockedMethods: [] };
  const startingXp = availability.currentXp ?? xpForLevel(fromLevel);
  if (!Number.isFinite(startingXp) || startingXp < xpForLevel(fromLevel)
    || fromLevel < skillCaps[skill] && fromLevel < 120 && startingXp >= xpForLevel(fromLevel + 1)) throw new RangeError('Current XP must be finite and within the starting level (capped skills may retain virtual XP).');
  const targetXp = xpForLevel(toLevel);
  const candidates = catalogue.methods.filter(method => method.skill === skill).map(method => {
    // The trained skill advances within this plan. Fold its prerequisites into
    // the method breakpoint; other skills still require personal observations.
    const ownSkills = (method.requirements ?? []).filter(requirement => requirement.kind === 'skill' && requirement.name === skill);
    return { ...method, level: Math.max(method.level, method.requiredSkills?.[skill] ?? 1, ...ownSkills.map(requirement => requirement.level)),
      requirements: (method.requirements ?? []).filter(requirement => !ownSkills.includes(requirement)),
      requiredSkills: Object.fromEntries(Object.entries(method.requiredSkills ?? {}).filter(([name]) => name !== skill)) };
  });
  const admitted = [], lockedMethods = [];
  for (const method of candidates) {
    const blockers = trainingMethodBlockers(method, availability);
    if (blockers.length) lockedMethods.push({ methodId: method.id, label: method.label, level: method.level, maxLevel: method.maxLevel ?? cap,
      ...Object.fromEntries(Object.entries(metrics(method, Math.max(fromLevel, method.level), availability)).filter(([name]) => name !== 'method')),
      blockers, sourceIds: method.sourceIds ?? [] });
    else admitted.push(method);
  }
  const plans = Object.fromEntries(trainingPreferences.map(value => [value, planPreference(skill, startingXp, targetXp, admitted, availability, value)]));
  // Report whether a locked method beats the current available recommendation.
  for (const locked of lockedMethods) {
    locked.betterFor = trainingPreferences.filter(value => {
      if (locked.level > fromLevel || locked.maxLevel < fromLevel || locked.xpPerHour === null) return false;
      if (value !== 'best-xp' && locked.gpPerHour === null) return false;
      const current = plans[value].segments[0];
      if (!current) return true;
      if (value === 'best-xp') return locked.xpPerHour > current.xpPerHour;
      if (value === 'money-making') return locked.gpPerHour > current.gpPerHour;
      return locked.costPerXp <= (availability.cheapCostPerXp ?? 1) && (current.costPerXp > (availability.cheapCostPerXp ?? 1) || locked.xpPerHour > current.xpPerHour);
    });
  }
  const used = new Set(Object.values(plans).flatMap(plan => plan.segments.flatMap(segment => segment.sourceIds)));
  for (const method of candidates) for (const id of [...(method.sourceIds ?? []), ...(method.economics?.sourceIds ?? [])]) used.add(id);
  return { ...base, startingXp, targetXp, xpNeeded: Math.max(0, targetXp - startingXp),
    status: Object.values(plans).every(plan => plan.status === 'estimated') ? 'estimated' : Object.values(plans).some(plan => plan.complete) ? 'partial' : 'unavailable',
    plans, recommendation: preference === 'all' ? null : plans[preference], lockedMethods,
    availableMethods: admitted.map(method => ({ methodId: method.id, label: method.label, level: method.level, maxLevel: method.maxLevel ?? cap,
      eligibleNow: method.level <= fromLevel && (method.maxLevel ?? cap) >= fromLevel,
      ...Object.fromEntries(Object.entries(metrics(method, Math.max(fromLevel, method.level), availability, true)).filter(([name]) => name !== 'method')),
      estimateQuality: method.estimateQuality, sourceIds: method.sourceIds ?? [], assumptions: method.assumptions ?? [] })),
    sources: (catalogue.sources ?? []).filter(source => used.has(source.id)),
    issues: availability.currentXp === undefined ? [{ code: 'level-floor', detail: `Exact XP is unknown; starts at the threshold for level ${fromLevel}.` }] : [] };
}
