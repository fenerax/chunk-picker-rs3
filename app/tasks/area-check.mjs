import trainingCatalogue from '../data/training/catalogue.mjs';
import { skillCaps, f2pCap } from './engine.mjs';
import { buildTrainingAvailability } from './training-availability.mjs';
import { trainingMethodBlockers } from './training-planner.mjs';
import { divinationEvidence } from '../data/divination-training.mjs';
import { selectPresentedTasks } from './presentation.mjs';

export const AREA_CHECK_FORMAT = 'area-check-v1';
export const AREA_CHECK_MAX_CHUNKS = 128;
export const AREA_CHECK_MIN_TRAINING_GAP = 15;
const skills = Object.keys(skillCaps).filter(skill => skill !== 'Combat');
const trialCaps = new Map(trainingCatalogue.skills.map(row => [row.skill, row.f2pCap]));
const spatialBlockers = new Set(['access', 'chunks', 'objects', 'npcs', 'monsters', 'monster', 'shops', 'mix',
  'membership', 'unsupported', 'rule', 'backlog', 'items', 'item', 'object', 'npc', 'shop', 'chunk', 'area', 'unsupported-selector']);
const brief = method => ({ id: method.id, label: method.label });
const compareMethods = (a, b) => a.level - b.level || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

/** Shared HTTP/worker validation; this draft is never a gameplay command. */
export function normalizeAreaCheckRequest(draft, { state, world, memberId } = {}) {
  if (!state?.members?.some(member => member.id === memberId)) throw new RangeError(`Unknown area-check member: ${memberId}.`);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError('Area check requires a draft object.');
  for (const key of Object.keys(draft)) if (!['chunkIds', 'asMembers'].includes(key)) throw new TypeError(`Unknown area-check field: ${key}.`);
  if (!Array.isArray(draft.chunkIds)) throw new TypeError('Area-check chunkIds must be an array.');
  if (draft.chunkIds.length > AREA_CHECK_MAX_CHUNKS) throw new RangeError(`Area check supports at most ${AREA_CHECK_MAX_CHUNKS} chunks.`);
  if (draft.asMembers !== undefined && typeof draft.asMembers !== 'boolean') throw new TypeError('Area-check asMembers must be boolean.');
  if (!(world?.chunks instanceof Map)) throw new TypeError('Area check requires a known world.');
  for (const id of draft.chunkIds) {
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new TypeError('Area-check chunks must be positive safe integer base IDs.');
    if (!world.chunks.has(id) || world.surface && !world.surface.has(id)) throw new RangeError(`Area-check chunk ${id} is outside the known surface world.`);
  }
  return { chunkIds: [...new Set(draft.chunkIds)].sort((a, b) => Number(a) - Number(b)), asMembers: draft.asMembers ?? false };
}

function scenarioState(state, memberId, chunkIds, alone, asMembers) {
  const copy = structuredClone(state);
  if (asMembers) copy.rules['content.f2p'] = false;
  for (const member of copy.members) {
    if (member.id === memberId) {
      member.unlocked = alone ? [...chunkIds] : [...new Set([...member.unlocked, ...chunkIds])];
      member.selected = []; member.pendingRoll = [];
    } else if (alone) {
      member.unlocked = []; member.selected = []; member.pendingRoll = []; member.teleports = [];
    }
  }
  return copy;
}

function candidateMethods(result, state, memberId, definitions, catalogue) {
  const methods = new Map();
  for (const task of result.tasks ?? []) {
    // Own obligations and shared capability have different jobs: a partner's
    // usable training source belongs in this comparison when normal shared
    // access admits it. The engine's spatial/source blockers remain decisive.
    // This reviewed static placement can be inventoried before its quest route
    // opens. Keep the missing object/access prerequisite visible and blocked;
    // this advisory candidate never seeds engine access or training. A place
    // marker in neighbouring 18486 cannot substitute for the harvest in 18485.
    const colossi = divinationEvidence.colossi;
    const conditionalColossi = task.id === colossi.pickerId && state.rules['content.f2p'] === false
      && result.access?.bases?.includes(colossi.chunkId)
      && JSON.stringify(task.record?.Objects) === JSON.stringify([colossi.object])
      && (task.blockers ?? []).every(blocker => !spatialBlockers.has(blocker.kind) || blocker.kind === 'objects')
      && !result.access?.backloggedSources?.objects?.[colossi.object];
    if (!skills.includes(task.category) || !task.primaryMethod || task.record?.NoXp
      || !conditionalColossi && (task.blockers ?? []).some(blocker => spatialBlockers.has(blocker.kind))) continue;
    const method = { id: task.id, label: task.label, level: task.level, status: task.status,
      blockers: (task.blockers ?? []).map(({ kind, detail }) => ({ kind, detail })),
      provenance: conditionalColossi ? 'reviewed-divination-location' : 'task-engine' };
    if (Number.isSafeInteger(method.level) && method.level >= 1) methods.set(`${task.category}\0${method.label}\0${method.level}`, { ...method, skill: task.category });
  }
  // Reuse the Helper's fail-closed selectors for reviewed methods absent from
  // the challenge catalogue (notably ordinary combat). Potential skill levels
  // come from the same fixed point, never from a separate reachability engine.
  const availability = buildTrainingAvailability(result, { state, memberId, definitions, sourceLocations: {} });
  availability.skills = Object.fromEntries(Object.entries(result.training ?? {}).map(([skill, row]) => [skill, row.level]));
  for (const method of catalogue.methods ?? []) {
    if (!skills.includes(method.skill) || !Number.isSafeInteger(method.level) || method.level < 1) continue;
    // A known challenge owns its rule/primary decisions, even when those
    // decisions exclude it. Helper variants must not re-admit a disabled task.
    if ((result.tasks ?? []).some(task => task.category === method.skill
      && (method.matches ?? []).includes(task.rawLabel))) continue;
    const blockers = trainingMethodBlockers(method, availability);
    if (blockers.some(blocker => spatialBlockers.has(blocker.kind) || blocker.kind === 'alternatives'
      && blocker.alternatives?.every(choice => spatialBlockers.has(choice.kind)))) continue;
    const spatial = requirement => requirement.anyOf ? requirement.anyOf.some(spatial)
      : ['object', 'npc', 'monster', 'shop', 'chunk', 'area'].includes(requirement.kind);
    if (!(method.requirements ?? []).some(spatial) && blockers.some(blocker => blocker.kind === 'item'
      || blocker.kind === 'alternatives' && blocker.alternatives?.some(choice => choice.kind === 'item'))) continue;
    const cap = result.training?.[method.skill]?.cap ?? skillCaps[method.skill];
    if (method.level > cap || !availability.members && method.skill === 'Invention') continue;
    const key = `${method.skill}\0${method.label}\0${method.level}`;
    // Matching retained tasks already carry the rule and source decisions.
    const matching = [...methods.values()].find(row => row.skill === method.skill && row.level === method.level
      && (row.label === method.label || (method.matches ?? []).some(label => label.replace(/~\|([^|]+)\|~/g, '$1') === row.label)));
    if (matching) continue;
    methods.set(key, { id: method.id, label: method.label, skill: method.skill, level: method.level,
      status: blockers.length ? 'blocked' : 'available', blockers: blockers.map(({ kind, detail }) => ({ kind, detail })), provenance: 'helper-catalogue' });
  }
  return [...methods.values()].sort(compareMethods);
}

function localTrainingRequirements(tasks, skill, cap) {
  // Item and dependency tasks inherit location ownership from the engine, so
  // wield/equip goals count without a direct Chunks field. Unanchored global
  // goals and primary method entry levels do not create training targets.
  return tasks.filter(task => ['Chunks', 'Objects', 'NPCs', 'Monsters', 'Monster', 'Shops', 'Mix', 'Items'].some(field => task.record?.[field]?.length)
    || Object.keys(task.record?.Tasks ?? {}).length)
    .flatMap(task => {
      const level = Math.max(Number(task.record?.Skills?.[skill] ?? 0), Number(task.record?.SkillsNeeded?.[skill] ?? 0),
        Number(task.record?.Requirements?.[skill] ?? 0), task.category === skill && !task.primary ? Number(task.level ?? 0) : 0);
      return Number.isSafeInteger(level) && level >= 1 && level <= cap ? [{ id: task.id, label: task.label, level }] : [];
    }).sort(compareMethods);
}

function trainingGapSummary(found, requirements) {
  if (!requirements.length) return { trainingGaps: [], largestGap: null, gapTarget: null };
  const targetLevel = requirements.at(-1).level;
  const gapTarget = { level: targetLevel, kind: 'requirement',
    requirements: requirements.filter(row => row.level === targetLevel) };
  const usable = found.filter(method => method.status === 'available' && !method.blockers.length && method.level <= targetLevel);
  const levels = [...new Set(usable.map(method => method.level))];
  const evidence = method => ({ ...brief(method), level: method.level });
  const trainingGaps = levels.flatMap((fromLevel, index) => {
    const toLevel = levels[index + 1] ?? targetLevel;
    if (toLevel - fromLevel < AREA_CHECK_MIN_TRAINING_GAP) return [];
    const kind = toLevel === targetLevel ? gapTarget.kind : 'method';
    return [{ fromLevel, toLevel, size: toLevel - fromLevel, kind,
      methods: usable.filter(method => method.level === fromLevel).map(evidence),
      evidence: kind === 'requirement' ? gapTarget.requirements
        : usable.filter(method => method.level === toLevel).map(evidence) }];
  });
  const largestGap = [...trainingGaps].sort((a, b) => b.size - a.size || a.fromLevel - b.fromLevel)[0] ?? null;
  return { trainingGaps, largestGap, gapTarget };
}

function skillSummary(skill, result, methods, members, asMembers, empty, localRequirements) {
  const training = result.training?.[skill] ?? {};
  const cap = skill === 'Invention' && !members ? 1 : training.cap ?? (members ? skillCaps[skill] : f2pCap(skill));
  const found = empty ? [] : methods.filter(method => method.skill === skill && method.level <= cap);
  const endpoints = level => level === undefined ? null : { level, methods: found.filter(method => method.level === level).map(brief) };
  const levels = [...new Set(found.map(method => method.level))];
  const passive = Number(training.passiveLevel ?? 1);
  const observed = training.observedCapabilityLevel;
  // This reference deliberately is not asserted to be either player's level.
  const trial = trialCaps.get(skill);
  const useReference = asMembers && trial > 1 && trial < skillCaps[skill] && !(observed >= 1) && passive <= trial;
  const fromLevel = useReference ? trial : Math.max(passive, observed ?? 1);
  const source = useReference ? 'f2p-reference' : observed >= 1 ? 'personal' : 'engine-passive';
  const first = found.filter(method => method.level > fromLevel)[0];
  // An earlier conditional method may provide XP once its separate gates are
  // met. A later entry threshold is therefore not an established XP gap.
  const potentialStarter = found.some(method => method.level <= fromLevel);
  const requirements = empty ? [] : localRequirements.filter(row => row.level > fromLevel && row.level <= cap);
  const highestRequirement = requirements.at(-1);
  const target = highestRequirement && (first && first.level <= highestRequirement.level ? first : highestRequirement);
  const kind = target === first ? 'first-method' : 'requirement';
  const bootstrapGap = !empty && !training.primary && !potentialStarter && target ? {
    fromLevel, toLevel: target.level, size: target.level - fromLevel, source, kind,
    methods: (kind === 'first-method' ? found : requirements).filter(method => method.level === target.level).map(brief),
  } : null;
  return { cap, lowest: endpoints(levels[0]), highest: endpoints(levels.at(-1)), methodCount: found.length,
    availableCount: found.filter(method => method.status === 'available').length,
    methods: found.map(({ skill: unused, ...method }) => method), bootstrapGap,
    ...trainingGapSummary(found, empty ? [] : localRequirements.filter(row => row.level <= cap)),
    entrySpans: levels.slice(1).map((level, index) => ({ fromLevel: levels[index], toLevel: level, size: level - levels[index] })),
    reachableLevel: empty ? null : training.level ?? null, repeatability: !empty && training.primary ? 'engine-primary' : 'unknown' };
}

/** Two immutable drafts, both evaluated by the ordinary task fixed point.
 * Method levels are entry requirements. Neither entry spacing nor the highest
 * method is an XP ceiling. Primary training to cap remains the engine's model. */
export function analyzeAreaCheck(state, memberId, draft, { engine, definitions = {}, world, catalogue = trainingCatalogue } = {}) {
  const normalized = normalizeAreaCheckRequest(draft, { state, world, memberId });
  if (typeof engine?.evaluate !== 'function') throw new TypeError('Area check requires a task engine.');
  const aloneState = scenarioState(state, memberId, normalized.chunkIds, true, normalized.asMembers);
  const combinedState = scenarioState(state, memberId, normalized.chunkIds, false, normalized.asMembers);
  const alone = engine.evaluate(aloneState, memberId), combined = engine.evaluate(combinedState, memberId);
  // The ordinary active list owns eligibility, rule visibility, goal ranking,
  // backlog and shared completion. Satisfied duties need no new grind target.
  // Select once per scope; training methods still describe available capability.
  const aloneTargets = selectPresentedTasks(alone, aloneState, memberId, definitions).tasks;
  const combinedTargets = selectPresentedTasks(combined, combinedState, memberId, definitions).tasks;
  const members = combinedState.rules['content.f2p'] === false;
  const aloneMethods = normalized.chunkIds.length ? candidateMethods(alone, aloneState, memberId, definitions, catalogue) : [];
  const combinedMethods = candidateMethods(combined, combinedState, memberId, definitions, catalogue);
  const rows = skills.map(skill => {
    const cap = skill === 'Invention' && !members ? 1 : combined.training?.[skill]?.cap ?? (members ? skillCaps[skill] : f2pCap(skill));
    const aloneRequirements = normalized.chunkIds.length ? localTrainingRequirements(aloneTargets, skill, cap) : [];
    const combinedRequirements = localTrainingRequirements(combinedTargets, skill, cap);
    return { skill, cap,
      alone: skillSummary(skill, alone, aloneMethods, members, normalized.asMembers, !normalized.chunkIds.length, aloneRequirements),
      combined: skillSummary(skill, combined, combinedMethods, members, normalized.asMembers, false, combinedRequirements) };
  });
  const biggestGaps = Object.fromEntries(['alone', 'combined'].map(scope => [scope, rows.filter(row => row[scope].largestGap)
    .map(row => ({ skill: row.skill, ...row[scope].largestGap })).sort((a, b) => b.size - a.size || a.skill.localeCompare(b.skill))]));
  return { format: AREA_CHECK_FORMAT, memberId, stateRevision: state.revision, ...normalized, members, rows, biggestGaps,
    limitations: [
      'Lowest and highest are catalogue method entry levels, not XP ceilings. Training gaps are stretches of at least 15 levels using an older available method, ending at or below the highest active task requirement in each scope. Targets follow the ordinary task list rules, backlog and shared completion. Without an active task requirement there is no gap. They do not measure XP rates or prove better methods do not exist.',
      'Can\'t start warnings identify an unestablished route to a needed method or task requirement in the current engine, not proof that no game method exists. Without a task requirement there is no warning. Missing-source or missing-supply methods are excluded. Conditional methods remain in details but never close training gaps.',
      'The task engine models an available primary method as training to the allowed skill cap. It does not verify renewable supplies, zero-XP exceptions, finite rewards or a continuous XP route for every retained method.',
      'Saved manual primary/passive/max controls remain capability declarations. They can change reachable levels or suppress Can\'t start warnings without supplying a training location.',
      'Alone keeps personal progress and rules, clears other ownership, and uses only selected chunks. Combined adds selected chunks to the current personal map and retains normal connected-partner access.',
      'Can\'t start warnings using an F2P reference level in a members draft start from the reviewed F2P trial cap when personal level evidence is absent. They do not assert that the player has reached that level.',
      'Members methods rely on retained tasks and the reviewed Divination supplement. Wider Havenhythe coverage remains incomplete, so the members-start research may contain methods and gaps absent from this result.',
      'Retained primary flags may differ from researched XP behaviour, including zero-XP shortcuts. Treat the members-start research as a separate evidence check, not a catalogue guarantee.',
    ] };
}
