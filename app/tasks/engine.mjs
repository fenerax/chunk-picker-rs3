import { datasetValue } from '../dataset-runtime.mjs';
import { prepareTaskDefinitions } from '../dataset-pipeline.mjs';
import { requireSelectedDataset } from '../dataset-runtime.mjs';
import { importedXpAllocations, xpChoiceAllocation } from '../core/xp-choices.mjs';
import { buildAccessIndex, calculateAccess, collectBaseItemSources, baseItemSourceView, walkingConnections, copyAccess } from './access.mjs';
import { decodeLegacyText, hasGameplayMigration, projectMemberTaskFacts } from './migration.mjs';
import { playerControlSkills, resolvePlayerControls } from '../core/player-controls.mjs';
import { sameRuneScapeName, observedSkills } from '../core/game-progress.mjs';
import { configureAutomaticTransport, registerAutomaticTransportEngineFactory } from '../core/automatic-transport.mjs';
import { taskRuleCutoffDefaults, taskRuleDiagnostics } from '../data/settings.mjs';
import { parseDropRate, composeDropRates, passesRateCutoff as evaluateRateCutoff, rateEvidence } from './rates.mjs';
import { evaluatePartnerConnections } from '../core/territory.mjs';
import { effectiveSectionOverrides } from '../core/rules.mjs';
import { createSurfaceEligibility } from '../core/cache-surface.mjs';
import { permanentTaskId, legacyTaskId, isPermanentId } from './identity.mjs';
import { relaxesAchievementDependency } from './achievements.mjs';
import { applyMetadataCorrections } from '../data/metadata-corrections.mjs';
import { applyRetainedTaskCorrections } from '../data/retained-task-corrections.mjs';
import { applyRetainedUnsupportedCorrections } from '../data/retained-unsupported-corrections.mjs';
import { applyCacheShops } from '../data/cache-shops.mjs';
import { applyEquipmentCorrections } from '../data/equipment-corrections.mjs';
import { applyArchaeologyTaskCorrections } from '../data/archaeology-task-corrections.mjs';
import { buildHouseStorageCatalogue, evaluateHouseStorage } from './house-storage.mjs';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_MILESTONES_RULE, SKILL_GUIDE_CORRECTIONS_RULE, applySkillGuideTasks, skillGuideCatalogue } from '../data/skill-guides.mjs';
import { applySkillguideCombatCorrections } from '../data/skillguide-combat-corrections.mjs';
import { sourceMembershipBlocker as evaluateSourceMembership, sourceMembershipRequiredItems } from '../data/source-membership.mjs';
import { membershipSourceBlocker, membershipSourcePolicies } from '../data/access-policy.mjs';
import { itemMembershipBlocker as evaluateItemMembership, taskItemMembershipBlockers } from './membership.mjs';
import { isProcessingSourceTask, processingSkills, selectProcessingSources } from './processing.mjs';
import { combatLevelFromSkills } from '../core/combat-level.mjs';
import { createEligibilityCache } from './eligibility-cache.mjs';
import { createObligationCache } from './obligation-cache.mjs';
import { recordedEquipment } from './recorded-equipment.mjs';
import { applyDivinationTraining } from '../data/divination-training.mjs';
import { personalQuestProgressBlocker } from './personal-quest-progress.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';
import { withActivityTimingTags } from '../data/activity-timing.mjs';
import { compileDialogueSupply, dialogueSupplyBlocker, dialogueSupplyNote, dialoguePaymentText, compileFiniteRewards, finiteRewardPreview,
  compilePersonalAlternatives, personalAlternativesBlocker, compileSourceLocations, sourceLocationBlocker } from './reviewed-supplies.mjs';

// Authored implementation. Reference JSON is declarative input, never executable code.
export const taskId = permanentTaskId;
registerAutomaticTransportEngineFactory(createTaskEngine);
const locationSensitiveMembership = new Set(membershipSourcePolicies.filter(policy => Array.isArray(policy.locations))
  .map(policy => `${policy.kind}\u0000${policy.source}`));
const keyOf = (category, label) => `${category}\u0000${label}`;
export function plainLabel(value) {
  return String(value).replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0]).replace(/\*+$/g, '');
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const on = taskRuleEnabled;
const F2P = datasetValue("app/tasks/engine.mjs#F2P");
const TWENTY = datasetValue("app/tasks/engine.mjs#TWENTY");
export const skillCaps = datasetValue("app/tasks/engine.mjs#skillCaps");
export const f2pCap = skill => TWENTY.has(skill) ? 20 : F2P.has(skill) ? skillCaps[skill] ?? 99 : 5;
const FIELD_ALIASES = { Priamry: 'Primary', primary: 'Primary', priority: 'Priority', level: 'Level', skills: 'Skills', Sklls: 'Skills', CHunks: 'Chunks', Itmems: 'Items', NotF2P: 'Not F2P', 'No Equip': 'Not Equip' };
const KNOWN = new Set(`Chunks Level Primary Priority Category Objects NoPet Skills Output Tasks Mix NPCs Monsters SkillsNeeded NoBoost Not F2P|Allow Virtual|Partial|Not Equip|Output Object|Shops|TotalVirtualLevelNeeded|Requirements|Categories|AllowMulti|Source|Hide drops|BaseQuest|Description|QuestPoints|Reward|XpReward|RuneScore|QuestPointsNeeded|KudosNeeded|ManualShow|CombatScore|CombatScoreNeeded|TotalLevelNeeded|Not Skiller|Label|AllowedSources|NonShop|Monster|Set|UnlocksArea|Sections|ConnectsSections|Kudos|ClueTier|ClueType|OutputVar`.split('|').flatMap((v, i) => i === 0 ? v.replace('Not F2P', 'Not_F2P').split(' ').map(x => x.replace('_', ' ')) : [v]));
KNOWN.add('Items');
KNOWN.add('PickerId');
KNOWN.add('RequirementAlternatives');
KNOWN.add('RequirementAlternativesDescription');
KNOWN.add('PersonalQuestProgress');
KNOWN.add('ManualChecks');
KNOWN.add('CompletedTasks');
KNOWN.add('DialogueSupply');
KNOWN.add('FiniteRewards');
KNOWN.add('PersonalRequirementAlternatives');
KNOWN.add('SourceLocations');
function compileManualChecks(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(reason => typeof reason !== 'string' || !reason.trim())) return null;
  return value.map(reason => reason.trim());
}
const pointRequirements = ['QuestPointsNeeded', 'KudosNeeded', 'CombatScoreNeeded', 'TotalLevelNeeded', 'TotalVirtualLevelNeeded'];
function compileRequirementAlternatives(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length) return null;
  const clauses = [];
  for (const clause of value) {
    if (!clause || typeof clause !== 'object' || Array.isArray(clause) || !Object.keys(clause).length
      || Object.keys(clause).some(key => key !== 'Skills' && !pointRequirements.includes(key))) return null;
    const needs = Object.entries(clause.Skills ?? {});
    if (clause.Skills !== undefined && (!clause.Skills || typeof clause.Skills !== 'object' || Array.isArray(clause.Skills) || !needs.length)) return null;
    if (needs.some(([skill, level]) => !skillCaps[skill] || !Number.isSafeInteger(level) || level < 1)
      || pointRequirements.some(key => clause[key] !== undefined && (!Number.isSafeInteger(clause[key]) || clause[key] < 1))) return null;
    clauses.push({ needs, points: pointRequirements.filter(key => clause[key] !== undefined).map(key => [key, clause[key]]) });
  }
  return clauses;
}
for (const field of ['ManualNonProcessing', 'NeverShow', 'NoXp', 'AlwaysValid', 'Not Processing']) KNOWN.add(field);
const PROCESSING = datasetValue("app/tasks/engine.mjs#PROCESSING");
const MONSTER_TRAINING = datasetValue("app/tasks/engine.mjs#MONSTER_TRAINING");
const MAYBE_PRIMARY = datasetValue("app/tasks/engine.mjs#MAYBE_PRIMARY");
const PRESENTATION_RULES = datasetValue("app/tasks/engine.mjs#PRESENTATION_RULES");
const UNSUPPORTED_RULES = datasetValue("app/tasks/engine.mjs#UNSUPPORTED_RULES");
const canonicalSkills = new Map(Object.keys(skillCaps).map(name => [name.toLowerCase(), name]));
const unavailableCheck = Object.freeze([null]);
const availableCheck = Object.freeze([]);

function compileAlias(token, aliases, stripStars = true) {
  const clean = stripStars ? String(token).replace(/\*/g, '') : String(token);
  const match = /^(.*\[\+\])(?:x(\d+))?$/.exec(clean);
  let alternatives = match ? aliases?.[match[1]] : null;
  if (match && !alternatives) {
    const same = Object.keys(aliases ?? {}).filter(key => key.toLowerCase() === match[1].toLowerCase());
    if (same.length === 1) alternatives = aliases[same[0]];
  }
  return { token: String(token), displayLabel: plainLabel(token), clean, alternatives, alias: !!match, count: match?.[2] ? Number(match[2]) : 1 };
}
function normalize(record) {
  const result = { ...record };
  for (const [old, current] of Object.entries(FIELD_ALIASES)) if (record[old] !== undefined) {
    if (result[current] === undefined) result[current] = record[old];
    delete result[old];
  }
  return result;
}
function experienceLevel(xp, ceiling = 120) {
  let points = 0;
  for (let level = 1; level < ceiling; level++) {
    points += Math.floor(level + 300 * 2 ** (level / 7));
    if (Math.floor(points / 4) > xp) return level;
  }
  return ceiling;
}

/** Cache additions and combat corrections are independent, persisted opt-ins.
 * Explicit booleans force a preview scenario; omitted options read state.rules.
 * Separate compiled variants keep disabled outputs out of capability closure. */
export function createTaskEngine(definitions, options = {}) {
  const { dataset, reviewedOverlays = Boolean(dataset), skillGuideTasks, skillGuideMilestones, skillGuideCorrections, retainedTaskCorrections, retainedUnsupportedCorrections, divinationTraining, skillGuideCatalogue: catalogue = skillGuideCatalogue,
    skillGuideCorrectionOverlay = applySkillguideCombatCorrections, ...baseOptions } = options;
  for (const [name, value] of Object.entries({ skillGuideTasks, skillGuideMilestones, skillGuideCorrections })) {
    if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
  }
  if (!definitions || typeof definitions.challenges !== 'object') throw new TypeError('Task definitions need challenges.');
  if (dataset) requireSelectedDataset(dataset);
  definitions = prepareTaskDefinitions(definitions, dataset, { ...baseOptions, reviewedOverlays, divinationTraining, retainedTaskCorrections, retainedUnsupportedCorrections });
  if (dataset) {
    for (const key of ['cacheWalking', 'cacheResources', 'cacheArchaeology', 'cacheShops']) baseOptions[key] ??= dataset.capabilities[key];
    baseOptions.dataset = dataset;
  }
  const variants = new Map();
  const accessIndexes = [];
  let engine, baselineProvider;
  const configureProviders = () => {
    if (!baselineProvider) return;
    for (const { index } of accessIndexes) {
      configureAutomaticTransport(index.world, baselineProvider);
      if (index.retained?.world) configureAutomaticTransport(index.retained.world, baselineProvider);
      if (index.retainedResourceWorld) configureAutomaticTransport(index.retainedResourceWorld, baselineProvider);
    }
  };
  const variant = (tasks, corrections, milestones) => {
    const key = `${tasks}:${corrections}:${milestones}`;
    if (!variants.has(key)) {
      let data = definitions;
      if (corrections) {
        data = skillGuideCorrectionOverlay(data);
        data = applyMetadataCorrections(data, { corrections: catalogue.metadataCorrections ?? [] });
      }
      if (tasks) data = applySkillGuideTasks(data, { catalogue, includeInformationalMilestones: milestones });
      variants.set(key, createCompiledTaskEngine(data, { ...baseOptions, metadataCorrections: false, equipmentCorrections: false }, accessIndexes));
      configureProviders();
    }
    return variants.get(key);
  };
  const variantForRules = rules => variant(skillGuideTasks ?? rules?.[SKILL_GUIDE_TASKS_RULE] === true,
    skillGuideCorrections ?? rules?.[SKILL_GUIDE_CORRECTIONS_RULE] === true,
    skillGuideMilestones ?? rules?.[SKILL_GUIDE_MILESTONES_RULE] === true);
  const initial = variant(skillGuideTasks === true, skillGuideCorrections === true, skillGuideMilestones === true);
  engine = Object.freeze({ datasetDigest: dataset?.digest, catalogue: initial.catalogue,
    prepare(rules) { variantForRules(rules).prepare(); },
    evaluate(state, memberId, evaluateOptions) {
      return variantForRules(state.rules).evaluate(state, memberId, evaluateOptions);
    } });
  baselineProvider = { definitions, engine };
  configureProviders();
  return engine;
}

function createCompiledTaskEngine(definitions, { dataset, cacheWalking = false, cacheResources = false, resourceCatalogue, resourceSelectors,
  cacheArchaeology = false, archaeologyCatalogue, metadataCorrections = false, equipmentCorrections = false, cacheShops = false, shopCatalogue,
  lodestones, transportRoutes, transportFactsByMember } = {}, accessIndexes = []) {
  if (!definitions || typeof definitions.challenges !== 'object') throw new TypeError('Task definitions need challenges.');
  definitions = applyCacheShops(definitions, { enabled: cacheShops, shops: shopCatalogue });
  if (metadataCorrections) definitions = applyMetadataCorrections(definitions);
  if (equipmentCorrections) definitions = applyEquipmentCorrections(definitions);
  definitions = applyArchaeologyTaskCorrections(definitions, { enabled: cacheArchaeology });
  // Guide variants change skill challenges, while the location graph and
  // resource projection often stay identical. Share that compiled index only
  // when every other definition branch and the access-relevant Nonskill branch
  // still has the exact same identity. Custom overlays remain independent.
  const accessBranches = Object.entries(definitions).filter(([key]) => key !== 'challenges');
  accessBranches.push(['challenges.Nonskill', definitions.challenges.Nonskill]);
  const environment = `${dataset?.digest ?? 'injected'}:${cacheWalking}:${cacheResources}:${cacheArchaeology}`;
  let accessIndex = accessIndexes.find(entry => entry.environment === environment && entry.branches.length === accessBranches.length
    && entry.branches.every(([key, value], index) => key === accessBranches[index][0] && value === accessBranches[index][1]))?.index;
  if (!accessIndex) {
    accessIndex = buildAccessIndex(definitions, { dataset, cacheWalking, cacheResources, resourceCatalogue, resourceSelectors,
      cacheArchaeology, archaeologyCatalogue, lodestones, transportRoutes, transportFactsByMember });
    accessIndexes.push({ branches: accessBranches, environment, index: accessIndex });
  }
  const code = definitions.codeItems ?? {};
  const compiled = [], byKey = new Map(), compileDiagnostics = [];
  for (const [category, entries] of Object.entries(definitions.challenges)) for (const [rawLabel, rawRecord] of Object.entries(entries)) {
    const record = normalize(withActivityTimingTags(category, rawRecord));
    for (const field of ['Skills', 'SkillsNeeded', 'Requirements']) if (record[field]) {
      record[field] = Object.fromEntries(Object.entries(record[field]).map(([skill, level]) => {
        const canonical = canonicalSkills.get(skill.toLowerCase()) ?? (skill === 'Constituiton' ? 'Constitution' : skill);
        return [canonical, typeof level === 'string' && /^\d+$/.test(level) ? Number(level) : level];
      }));
    }
    for (const [name, value] of Object.entries(record.Tasks ?? {})) if (skillCaps[name] && typeof value === 'number') {
      record.Skills = { ...record.Skills, [name]: value };
      record.Tasks = { ...record.Tasks }; delete record.Tasks[name];
    }
    // Some reference records have exact task requirements at the record root.
    // Promote only an existing, category-qualified task; arbitrary keys stay hard gates.
    for (const [field, value] of Object.entries(record)) if (!KNOWN.has(field) && typeof value === 'string' && definitions.challenges[value]?.[field]) {
      record.Tasks = { ...record.Tasks, [field]: value }; delete record[field];
    }
    const unknown = Object.keys(record).filter(field => !KNOWN.has(field));
    const requirementAlternatives = compileRequirementAlternatives(record.RequirementAlternatives);
    if (requirementAlternatives === null) unknown.push('Invalid RequirementAlternatives');
    const manualChecks = compileManualChecks(record.ManualChecks);
    if (manualChecks === null) unknown.push('Invalid ManualChecks');
    const dialogueSupply = compileDialogueSupply(record.DialogueSupply);
    if (dialogueSupply === null) unknown.push('Invalid DialogueSupply');
    if (dialogueSupply && (!array(record.NPCs).length || array(record.NPCs).some(name => typeof name !== 'string' || !name.trim())
      || !array(record.Output).length || array(record.Output).some(name => typeof name !== 'string' || !name.trim()))) unknown.push('DialogueSupply needs an NPC and output');
    const finiteRewards = compileFiniteRewards(record.FiniteRewards, record);
    if (finiteRewards === null) unknown.push('Invalid FiniteRewards');
    const personalAlternatives = compilePersonalAlternatives(record.PersonalRequirementAlternatives);
    if (personalAlternatives === null) unknown.push('Invalid PersonalRequirementAlternatives');
    const sourceLocations = compileSourceLocations(record.SourceLocations);
    if (sourceLocations === null) unknown.push('Invalid SourceLocations');
    const completedDependencies = record.CompletedTasks === undefined ? [] : record.CompletedTasks;
    const validCompletedDependencies = Array.isArray(completedDependencies) && completedDependencies.every(isPermanentId);
    if (!validCompletedDependencies) unknown.push('Invalid CompletedTasks');
    const requirements = [];
    for (const [field, aliases] of [['Chunks','chunksPlus'], ['Items','itemsPlus'], ['Objects','objectsPlus'], ['NPCs','npcsPlus'], ['Monsters','monstersPlus'], ['Monster','monstersPlus'], ['Shops','shopsPlus'], ['Mix','mixPlus']]) {
      for (const token of array(record[field])) requirements.push({ field, ...compileAlias(token, code[aliases]) });
    }
    const dependencies = Object.entries(record.Tasks ?? {}).map(([label, cat]) => ({ category: cat, ...compileAlias(label, code.tasksPlus, false) }));
    const level = Number(record.Level ?? 1);
    const needs = { ...record.Requirements, ...record.SkillsNeeded, ...record.Skills };
    if (skillCaps[category] !== undefined) needs[category] = Math.max(Number(needs[category] ?? 1), level);
    const wiki = /~\|([^|]+)\|~/.exec(rawLabel)?.[1];
    const item = { id: taskId(category, rawLabel, record), key: keyOf(category, rawLabel), order: compiled.length, label: plainLabel(rawLabel), rawLabel, category, level, record, unknown, requirements, dependencies,
      wiki: wiki ? `https://runescape.wiki/w/${encodeURIComponent(wiki.replace(/#/g, '/'))}` : undefined,
      needs: Object.entries(needs), presentationNeeds: Object.entries({ ...record.Requirements, ...record.SkillsNeeded, ...record.Skills, ...(skillCaps[category] ? { [category]: level } : {}) }),
      tags: array(record.Category), manualChecks: manualChecks ?? [], dialogueSupply, finiteRewards: finiteRewards ?? [], personalAlternatives: personalAlternatives ?? [], sourceLocations: sourceLocations ?? [], completedDependencies: validCompletedDependencies ? [...new Set(completedDependencies)] : [], requirementAlternatives: requirementAlternatives ?? [], localRequirements: requirements.filter(requirement => requirement.field !== 'Items'), itemRequirements: requirements.filter(requirement => requirement.field === 'Items') };
    if (unknown.length) compileDiagnostics.push({ kind: 'unknown-metadata', taskId: item.id, fields: unknown });
    compiled.push(item); byKey.set(item.key, item);
  }
  const byId = new Map(compiled.map(task => [task.id, task]));
  // Compile the original tier exceptions once. Rule switches choose the set;
  // repeated eligibility passes still count category-qualified distinct tasks.
  for (const task of compiled) for (const dependency of task.dependencies) {
    const names = [...new Set((dependency.alternatives ?? [dependency.clean]).map(name => name.split('--')[0]))];
    for (const [field, any] of [['relaxedAlways', false], ['relaxedAny', true]]) {
      dependency[field] = new Set(names.filter(name => relaxesAchievementDependency(task.category, task.record,
        dependency, byKey.get(keyOf(dependency.category, name))?.record, any)));
    }
  }
  const catalogue = Object.freeze([...compiled.map(({ id, label, category, rawLabel, level }) => Object.freeze({ id, label, category, rawLabel, level, kind: 'task', aliases: Object.freeze([legacyTaskId(category, rawLabel)]) })), ...buildHouseStorageCatalogue()]);
  const processingSetFields = new Set(['bases', 'sections', 'components', 'compatibilitySections', 'areas', 'blockedAreas',
    'objects', 'npcs', 'monsters', 'shops', 'possibleAreas']);
  const emptyProcessingAccess = Object.freeze({});
  const uniqueTaskKeys = compiled.length === byKey.size;
  const entrances = new Map();
  for (const [from, edges] of accessIndex.reverse) for (const edge of edges) {
    const list = entrances.get(edge.to) ?? [];
    if (!list.includes(from)) list.push(from);
    entrances.set(edge.to, list);
  }
  const outputGates = new Map();
  for (const [selector, requirements] of Object.entries(definitions.taskUnlocks?.Items ?? {})) {
    const [item, source] = selector.split('^');
    const list = outputGates.get(item) ?? [];
    list.push({ source, requirements }); outputGates.set(item, list);
  }
  const producers = new Map();
  const declaredOutputRoots = new Map();
  function declaredOutputs(category, output, seen = new Set()) {
    if (typeof output !== 'string' || seen.has(output)) return [];
    const table = definitions.skillItems?.[category]?.[output] ?? code.dropTables?.[output];
    if (!table) return [output];
    // Only a root traversal has a path-independent cycle boundary.
    let roots;
    if (!seen.size) {
      roots = declaredOutputRoots.get(category);
      if (roots?.has(output)) return roots.get(output);
      if (!roots) declaredOutputRoots.set(category, roots = new Map());
    }
    const outputs = Object.keys(table).flatMap(name => declaredOutputs(category, name, new Set([...seen, output])));
    if (roots) roots.set(output, Object.freeze(outputs));
    return outputs;
  }
  for (const task of compiled) for (const [kind, outputs] of [['task', task.record.Output], ['reward', task.record.Reward]]) for (const output of array(outputs)) {
    for (const name of kind === 'task' ? declaredOutputs(task.category, output) : typeof output === 'string' ? [output] : []) {
      const list = producers.get(name) ?? []; list.push({ task, kind, output }); producers.set(name, list);
    }
  }

  let evaluationPrepared = false, processingTasks, recipeIds, processingBoostFields,
    processingRowsForDiscovery, capabilitySeeds, primarySkillTasks, pointTasks, unsupportedTasks;
  function includeCapabilityTask(task, tasks) {
    if (!task || tasks.has(task)) return;
    tasks.add(task);
    for (const dependency of task.dependencies) for (const name of dependency.alternatives ?? [dependency.clean]) {
      includeCapabilityTask(byKey.get(keyOf(dependency.category, name.split('--')[0])), tasks);
    }
    for (const id of task.completedDependencies) includeCapabilityTask(byId.get(id), tasks);
  }
  function prepareEvaluation() {
    if (evaluationPrepared) return;
    // The initial variant may be used only for its identity catalogue. Runtime
    // metadata belongs to variants actually selected for prepare/evaluation.
    const itemMembership = new Map(), membershipOutputRoots = new Map();
    const itemBlockerFor = name => {
      if (!itemMembership.has(name)) itemMembership.set(name, evaluateItemMembership(name, true, definitions));
      return itemMembership.get(name);
    };
    for (const task of compiled) {
      const itemBlockers = taskItemMembershipBlockers(task.record, task.category, definitions, task.rawLabel, itemBlockerFor, membershipOutputRoots);
      const source = evaluateSourceMembership('Task', task.rawLabel, true, task.category);
      task.membershipBlockers = [...itemBlockers,
        ...sourceMembershipRequiredItems(task.category, task.rawLabel, task.record, true)
          .map(itemBlockerFor).filter(Boolean),
        ...(source ? [{ kind: 'membership', code: source.code ?? 'members-only-method', detail: source.detail,
          evidence: source.evidence, ...(source.item ? { item: source.item } : {}) }] : [])];
      task.invalidRequirements = task.requirements.filter(requirement => requirement.alias && !requirement.alternatives && requirement.clean !== 'Monster[+]');
      task.invalidDependencies = task.dependencies.filter(dependency => dependency.alias ? !dependency.alternatives : !byKey.has(keyOf(dependency.category, dependency.clean.split('--')[0])));
      task.invalidCompletedDependencies = task.completedDependencies.filter(id => !byId.has(id));
      task.invalidCompletedDependencies.push(...task.personalAlternatives.filter(clause => clause.completedTask && !byId.has(clause.completedTask)).map(clause => clause.completedTask));
    }
    unsupportedTasks = new Set(compiled.filter(task => task.unknown.length || task.record.Categories || task.record.OutputVar
      || task.invalidRequirements.length || task.invalidDependencies.length || task.invalidCompletedDependencies.length
      || task.needs.some(([skill, level]) => !skillCaps[skill] || typeof level !== 'number' || !Number.isFinite(level))
      || task.dependencies.some(dependency => (dependency.alternatives ?? [dependency.clean])
        .every(name => !byKey.has(keyOf(dependency.category, name.split('--')[0]))))));
    const completionDependents = new Map();
    for (const task of compiled) for (const id of task.completedDependencies) {
      const dependents = completionDependents.get(id) ?? [];
      dependents.push(task); completionDependents.set(id, dependents);
    }
    // Set iteration visits added entries, propagating unsupported prerequisites
    // through the whole completion graph without admitting cycles as evidence.
    for (const target of unsupportedTasks) for (const task of completionDependents.get(target.id) ?? []) unsupportedTasks.add(task);
    for (const task of compiled) task.unsupportedCompletedDependencies = task.completedDependencies
      .map(id => byId.get(id)).filter(target => target && unsupportedTasks.has(target));
    processingBoostFields = [...new Set(Object.values(code.boostItems ?? {}).flatMap(entries => Object.keys(entries ?? {})
      .map(source => source.split('~')[1] ?? 'items').filter(field => field !== 'items')))];
    processingTasks = new Set(compiled.filter(task => isProcessingSourceTask(task, definitions)));
    recipeIds = new Set([...processingTasks].map(task => task.id));
    // Nonprocessing rows contribute only literal prerequisite eligibility and
    // gathering-source metadata. Keep those dependencies, plus every skill row
    // that can establish a frontier, without explaining unrelated catalogue rows.
    const processingInputs = new Set(compiled.filter(task => processingSkills.has(task.category) || processingTasks.has(task)
      || task.category === 'Nonskill' || task.category === 'Farming'));
    for (const task of [...processingInputs]) for (const [label, category] of Object.entries(task.record.Tasks ?? {})) {
      const target = byKey.get(keyOf(category, label));
      if (target) processingInputs.add(target);
    }
    processingRowsForDiscovery = compiled.filter(task => processingInputs.has(task));
    const capabilityTasks = new Set(compiled.filter(task => ['Output', 'Reward', 'Output Object', 'Primary', 'XpReward',
      'QuestPoints', 'Kudos', 'CombatScore', 'UnlocksArea', 'ConnectsSections'].some(field => task.record[field])));
    capabilitySeeds = new Set();
    primarySkillTasks = compiled.filter(task => task.record.Primary && skillCaps[task.category]);
    pointTasks = compiled.filter(task => ['QuestPoints', 'Kudos', 'CombatScore', 'XpReward'].some(field => task.record[field] !== undefined));
    for (const task of capabilityTasks) includeCapabilityTask(task, capabilitySeeds);
    for (const task of processingRowsForDiscovery) for (const dependency of task.dependencies) {
      for (const name of dependency.alternatives ?? [dependency.clean]) {
        includeCapabilityTask(byKey.get(keyOf(dependency.category, name.split('--')[0])), capabilitySeeds);
      }
    }
    evaluationPrepared = true;
  }
  function* evaluatePass(state, memberId, { ownItemQueries = [], reuseObligations = true } = {}, admitted = new Set(), multiAdmitted = new Set(), replay, projectOnly = false) {
    const started = performance.now();
    const sourceMembershipBlocker = replay.membership.source, itemMembershipBlocker = replay.membership.item;
    const member = state.members.find(value => value.id === memberId);
    if (!member) throw new TypeError(`Unknown member: ${memberId}`);
    const legacyMap = state.legacy?.maps?.[member.sourceMapId] ?? {};
    const legacy = legacyMap.chunkinfo ?? {};
    const xpAllocations = importedXpAllocations(state, member);
    const authoredXpTasks = new Set(Object.keys(member.xpChoices ?? {}));
    const playerControls = resolvePlayerControls(state, member);
    const observedProgress = {};
    for (const skill of observedSkills) {
      if (!Object.hasOwn(skillCaps, skill)) continue;
      const observation = member.skillProgress?.[skill];
      const boundObservation = observation?.source === 'game-plugin' ? observation.memberId === member.id
        : observation?.source === 'runemetrics' && sameRuneScapeName(observation.runescapeName, member.runescapeName);
      if (boundObservation
        && Number.isSafeInteger(observation.level) && observation.level >= 1 && observation.level <= 120
        && Number.isFinite(observation.xp) && observation.xp >= 0) observedProgress[skill] = observation;
    }
    const rules = { ...(!hasGameplayMigration(state, member) ? legacyMap.rules : {}), ...state.taskRules, ...member.taskRules };
    const ruleDiagnostics = taskRuleDiagnostics(rules, { memberId });
    for (const { ruleId } of ruleDiagnostics) {
      if (Object.hasOwn(taskRuleCutoffDefaults, ruleId)) rules[ruleId] = taskRuleCutoffDefaults[ruleId];
      else delete rules[ruleId];
    }
    const anyAchievements = on(rules, 'Show Diary Tasks Any', false);
    const f2p = state.rules?.['content.f2p'] ?? true;
    rules.F2P = f2p;
    const membershipByTask = replay.membershipByTask ??= (() => {
      const rows = [];
      return { get(task) {
        if (!f2p || !task.membershipBlockers.length) return availableCheck;
        // Public blockers may be edited by a caller. Keep the compiled metadata
        // template immutable in use and clone only each positive invocation row.
        return rows[task.order] ??= task.membershipBlockers.map(blocker => ({ ...blocker,
          ...(Array.isArray(blocker.candidateIds) ? { candidateIds: [...blocker.candidateIds] } : {}) }));
      } };
    })();
    // These gates cannot change during the capability closure. The ordinary
    // pass only tests whether any blocker exists; final explanation still
    // evaluates every guard in its original order, including dynamic access.
    const staticBlocked = replay.staticBlocked ??= new Set(compiled.filter(task => task.unknown.length || task.manualChecks.length || task.record.Categories || task.record.OutputVar
      || task.invalidRequirements.length || task.invalidDependencies.length || task.invalidCompletedDependencies.length || task.unsupportedCompletedDependencies.length || f2p && task.record['Not F2P']
      || membershipByTask.get(task).length
      || task.record['Not Skiller'] && on(rules, 'Skiller', false)
      || task.tags.some(tag => !PRESENTATION_RULES.has(tag) && !MAYBE_PRIMARY.has(tag) && !on(rules, tag))
      || task.level > 1 && task.tags.includes('InsidePOH Primary') && !on(rules, 'InsidePOH', true)
      || member.taskStatus?.[task.id]?.backlogged));
    // Rules are fixed throughout this evaluation. Source probabilities recur
    // across methods, provenance queries and fixed-point passes.
    const cutoffCache = replay.cutoffCache ??= { rare: new Map(), primary: new Map() };
    const passesRateCutoff = (probability, currentRules, kind = 'rare') => {
      const cache = cutoffCache[kind];
      if (!cache.has(probability)) cache.set(probability, evaluateRateCutoff(probability, currentRules, kind));
      return cache.get(probability);
    };
    const caps = Object.fromEntries(Object.keys(skillCaps).map(skill => [skill, Math.min(skillCaps[skill], f2p ? f2pCap(skill) : Infinity)]));
    for (const [skill, limit] of Object.entries(playerControls.maxLevels)) if (caps[skill] && Number.isFinite(Number(limit)) && Number(limit) >= 1) caps[skill] = Math.min(caps[skill], Number(limit));
    const unlockedSlayerCap = caps.Slayer;
    let effectiveSlayerLock = playerControls.slayerLock, slayerLockRelease = null;
    if (effectiveSlayerLock) caps.Slayer = Math.min(caps.Slayer, effectiveSlayerLock.level);
    const releaseSlayerLock = reason => {
      if (!effectiveSlayerLock) return false;
      effectiveSlayerLock = null; slayerLockRelease = reason; caps.Slayer = unlockedSlayerCap;
      return true;
    };
    const releaseForTargets = access => {
      if (!effectiveSlayerLock) return;
      for (const [field, mapping] of [['monster', code.slayerTasks], ['boss', code.reaperTasks]]) {
        const target = effectiveSlayerLock[field];
        const reachable = Object.keys(mapping?.[target] ?? {}).find(name => access.monsters.has(name) && (definitions.slayerMonsters?.[name] === undefined || Number(definitions.slayerMonsters[name]) <= effectiveSlayerLock.level));
        if (reachable) { releaseSlayerLock({ kind: 'target', name: reachable, assignment: target }); return; }
      }
    };
    const restrictSlayerMonsters = (access, level, getBoost = () => 0) => {
      for (const monster of access.monsters) if (Object.hasOwn(definitions.slayerMonsters ?? {}, monster)) {
        const required = Number(definitions.slayerMonsters[monster]);
        const amount = getBoost(monster), reachableBoost = Number.isFinite(amount) ? Math.max(0, amount) : 0;
        const boostedLevel = Math.min(unlockedSlayerCap, level + reachableBoost);
        if (!Number.isFinite(required) || required > boostedLevel) {
          access.monsters.delete(monster);
          access.diagnostics.push({ code: 'slayer-level-required', kind: 'Monster', source: monster, requiredLevel: required, reachableLevel: level, reachableBoost, boostedLevel });
        }
      }
    };
    const recordedCompleted = new Set(member.completedTasks ?? []);
    // Keep the saved checkmark visible, but a checkmark cannot supply a recipe,
    // level, reward or prerequisite whose hard requirements are still unknown.
    const valid = new Set(), validRows = [], completed = recordedCompleted;
    const completedTask = task => completed.has(task.id) && !unsupportedTasks.has(task);
    const supportedPersonalCompletions = new Set([...recordedCompleted].filter(id => byId.has(id) && completedTask(byId.get(id))));
    const personallyCompletedQuests = compiled.filter(task => task.category === 'Quest' && completedTask(task)
      && task.record.QuestPoints !== undefined && (!member.questProgress?.[task.id]
        || sameRuneScapeName(member.questProgress[task.id].runescapeName, member.runescapeName)))
      .flatMap(task => [task.record.BaseQuest, plainLabel(task.rawLabel).replace(/ Complete the quest$/, '')].filter(Boolean));
    function admitTask(task) {
      valid.add(task.key);
      let first = 0, last = validRows.length;
      while (first < last) {
        const middle = (first + last) >>> 1;
        if (validRows[middle].order < task.order) first = middle + 1;
        else last = middle;
      }
      validRows.splice(first, 0, task);
    }
    const discoveryTasks = projectOnly || replay.fullDiscovery ? null : new Set(capabilitySeeds);
    let discoveryExpanded = false;
    function observeCapabilityTask(key) {
      const task = byKey.get(key);
      if (discoveryTasks && task && !discoveryTasks.has(task)) {
        includeCapabilityTask(task, discoveryTasks);
        discoveryExpanded = true;
      }
      return valid.has(key);
    }
    // Personal completion above can seed capabilities. Challenge satisfaction
    // is neutral in the retained proof and applied only by the final overlay.
    const challengeSatisfied = () => false;
    for (const task of compiled) if (completedTask(task)) { valid.add(task.key); validRows.push(task); }
    const discoveryRows = uniqueTaskKeys && discoveryTasks
      ? processingRowsForDiscovery.filter(task => !staticBlocked.has(task) || completedTask(task))
      : processingRowsForDiscovery;
    const checkableTasks = [], multiRows = [];
    let blockedCheckCount = 0;
    for (const task of compiled) {
      if (multiAdmitted.has(task.id)) multiRows.push(task);
      if (!uniqueTaskKeys || !staticBlocked.has(task)) checkableTasks.push(task);
      else if (!discoveryTasks && !valid.has(task.key) && (!processingTasks.has(task) || admitted.has(task.id))) blockedCheckCount++;
    }
    const shared = state.rules?.['access.shared'] !== false && state.members.some(owner => owner.id !== memberId && owner.unlocked?.length);
    let ownAccess, connections, connectionKey, access;
    const ownItems = new Set(), ownTaskKeys = new Set();
    const travelSections = access => [...(accessIndex.world.cacheWalking ? access.components : access.sections)].sort();
    let cachedAccess, accessTaskReads, accessTaskOrder;
    const sameTaskReads = entry => [...entry.reads].every(([task, present]) => valid.has(task) === present)
      && (!entry.order || entry.order.length === valid.size && [...valid].every((task, index) => task === entry.order[index]));
    const readValidTask = task => {
      const present = observeCapabilityTask(task);
      accessTaskReads.set(task, present);
      return present;
    };
    // Preserve the Set contract. Raw access currently uses only has; a future
    // iterator/size reader conservatively makes the entire ordered Set a
    // dependency instead of silently omitting those reads.
    const taskSetReaders = new Set(['size', 'keys', 'values', 'entries', 'forEach', Symbol.iterator]);
    const accessValidTasks = new Proxy(valid, { get(target, property) {
      if (property === 'has') return readValidTask;
      if (taskSetReaders.has(property)) accessTaskOrder ??= [...target];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    function memoAccess(index, evaluationState, ownerId, options = {}) {
      const parentTasks = options.validTasks ?? accessValidTasks;
      const territory = value => value ? [[...value.bases], [...value.sections], value.transportNoop === true] : null;
      const key = JSON.stringify([ownerId, evaluationState.rules?.['access.transport'], options.collectSources !== false,
        territory(options.territory), territory(options.retainedTerritory)]);
      let cache = replay.rawAccess.get(index);
      if (!cache) { cache = new Map(); replay.rawAccess.set(index, cache); }
      const entries = cache.get(key) ?? [];
      let entry = entries.find(sameTaskReads);
      if (entry) {
        // A subcall hit must remain visible to the enclosing access dependency
        // trace, including any future reader of the whole ordered task Set.
        for (const task of entry.reads.keys()) parentTasks.has(task);
        if (entry.order) void parentTasks.size;
        return entry.value;
      }
      const reads = new Map();
      let order;
      const tasks = new Proxy(accessValidTasks, { get(target, property) {
        if (property === 'has') return task => { const present = parentTasks.has(task); reads.set(task, present); return present; };
        if (taskSetReaders.has(property)) order ??= [...valid];
        return Reflect.get(parentTasks, property);
      } });
      const value = calculateAccess(index, evaluationState, ownerId, { ...options, validTasks: tasks, legacyRules: rules,
        membershipChecks: replay.membership, resolveAccess: memoAccess, getSurfaceEligibility, transportMemo: replay.transportMemo });
      replay.rawAccessEvaluations++;
      entry = { value, reads, order }; entries.push(entry); cache.set(key, entries);
      return value;
    }
    function getSurfaceEligibility(world, claimed, overrides, { f2p }) {
      let cache = replay.surfaceEligibility.get(world);
      if (!cache) { cache = new Map(); replay.surfaceEligibility.set(world, cache); }
      const key = JSON.stringify([[...claimed], Object.entries(overrides), f2p]);
      let eligibility = cache.get(key);
      if (!eligibility) { eligibility = createSurfaceEligibility(world, claimed, overrides, { f2p }); cache.set(key, eligibility); }
      return eligibility;
    }
    function refreshAccess() {
      // State and rules stay fixed throughout this evaluation. Only observed
      // task reads can affect the previous raw result; when a short-circuiting
      // gate changes, recompute and observe the newly visited dependencies.
      cachedAccess = cachedAccess && sameTaskReads(cachedAccess) ? cachedAccess : replay.access.find(sameTaskReads);
      if (cachedAccess) {
        for (const key of cachedAccess.reads.keys()) observeCapabilityTask(key);
        ownAccess = copyAccess(cachedAccess.own);
        access = cachedAccess.shared === cachedAccess.own ? ownAccess : copyAccess(cachedAccess.shared);
        connections = cachedAccess.connections;
        return;
      }
      accessTaskReads = new Map();
      accessTaskOrder = undefined;
      calculateFreshAccess();
      replay.accessEvaluations++;
      cachedAccess = { own: ownAccess, shared: access, connections, reads: accessTaskReads, order: accessTaskOrder };
      replay.access.push(cachedAccess);
      // Slayer restrictions and produced objects mutate only these copies.
      ownAccess = copyAccess(cachedAccess.own);
      access = cachedAccess.shared === cachedAccess.own ? ownAccess : copyAccess(cachedAccess.shared);
    }
    function calculateFreshAccess() {
      ownAccess = memoAccess(accessIndex, state, memberId);
      if (!shared) { access = ownAccess; return; }
      const sectionsByMember = Object.fromEntries(state.members.filter(owner => owner.id !== memberId).map(owner => [owner.id, travelSections(memoAccess(accessIndex, state, owner.id, { collectSources: false }))]));
      const walkingRoutes = walkingConnections(accessIndex, accessValidTasks);
      const personalTravelSeeds = state.rules?.['access.transport'] === true ? travelSections(memoAccess(accessIndex,
        { ...state, rules: { ...state.rules, 'access.transport': false } }, memberId, { collectSources: false })) : undefined;
      const key = JSON.stringify([travelSections(ownAccess), sectionsByMember, walkingRoutes]);
      if (key !== connectionKey) {
        connectionKey = key;
        connections = evaluatePartnerConnections(accessIndex.world, state, memberId, { sectionsByMember: { ...sectionsByMember, [memberId]: travelSections(ownAccess) }, sectionOverrides: effectiveSectionOverrides(state, member), walkingRoutes, lodestones, personalTravelSeeds, transportMemo: replay.transportMemo });
      }
      const bases = new Set([...ownAccess.bases, ...connections.bases]);
      const sections = new Set([...ownAccess.sections, ...connections.sections]);
      let retainedTerritory;
      if (accessIndex.retained) {
        const retainedOwn = memoAccess(accessIndex.retained, state, memberId, { collectSources: false });
        const retainedSections = Object.fromEntries(state.members.map(owner => [owner.id,
          [...(owner.id === memberId ? retainedOwn : memoAccess(accessIndex.retained, state, owner.id,
            { collectSources: false })).sections]]));
        const retainedConnections = evaluatePartnerConnections(accessIndex.retainedResourceWorld, state, memberId,
          { sectionsByMember: retainedSections, sectionOverrides: effectiveSectionOverrides(state, member),
            walkingRoutes: walkingConnections(accessIndex.retained, accessValidTasks).filter(([from, to]) => accessIndex.resourceBoundaryAllowed(from, to)), lodestones, transportMemo: replay.transportMemo });
        retainedTerritory = { bases: new Set([...retainedOwn.bases, ...retainedConnections.bases]),
          sections: new Set([...retainedOwn.sections, ...retainedConnections.sections]), transportNoop: retainedConnections.transportNoop === true };
      }
      access = !retainedTerritory && bases.size === ownAccess.bases.size && sections.size === ownAccess.sections.size ? ownAccess
        : memoAccess(accessIndex, state, memberId, { territory: { bases, sections, transportNoop: connections.transportNoop === true }, retainedTerritory });
    }
    refreshAccess();
    releaseForTargets(access);
    if (playerControls.primaryOverrides.Slayer === true) releaseSlayerLock({ kind: 'manual-primary' });
    const initialSlayerLevel = Math.min(caps.Slayer, Math.max(1, Number(playerControls.passiveLevels.Slayer ?? 1), observedProgress.Slayer?.level ?? 1, Number(playerControls.slayerLock?.level ?? 1), ...compiled.filter(task => task.category === 'Slayer' && completedTask(task)).map(task => task.level)));
    restrictSlayerMonsters(access, initialSlayerLevel);
    const producedObjects = new Map();
    let previousBaseEntry, previousBaseOwn, previousBaseOwnObjects, previousBaseAlias, previousBase, baseUnchanged;
    // Replays often visit the same resource view. Track the task gates read by
    // collection separately from access gates, and clone mutable source records
    // before ownership/primary annotations can touch a cached resource result.
    function collectSources() {
      const view = baseItemSourceView(access);
      const entries = replay.base.get(view) ?? [];
      let entry = entries.find(sameTaskReads);
      if (!entry) {
        const reads = new Map();
        const tasks = { has(key) { const present = observeCapabilityTask(key); reads.set(key, present); return present; } };
        entry = { reads, value: collectBaseItemSources(definitions, access, { validTasks: tasks, rules,
          expansionCache: replay.expansions, membershipChecks: replay.membership }) };
        replay.baseCollections++;
        entries.push(entry); replay.base.set(view, entries);
      }
      for (const key of entry.reads.keys()) observeCapabilityTask(key);
      const ownObjects = JSON.stringify([...producedObjects.keys()].map(name => [name,
        [...(ownAccess.locations.get(`Object:${name}`) ?? [])]]));
      const alias = access === ownAccess;
      if (entry === previousBaseEntry && cachedAccess.own === previousBaseOwn && ownObjects === previousBaseOwnObjects
        && alias === previousBaseAlias) {
        baseUnchanged = true;
        return previousBase;
      }
      baseUnchanged = false;
      previousBaseEntry = entry; previousBaseOwn = cachedAccess.own;
      previousBaseOwnObjects = ownObjects; previousBaseAlias = alias;
      return previousBase = { items: new Set(entry.value.items), diagnostics: [...entry.value.diagnostics],
        sources: new Map([...entry.value.sources].map(([name, sources]) => [name, sources.map(source => ({ ...source }))])) };
    }
    let base = collectSources();
    const ownSource = source => source.own === true;
    const baseSourceKinds = { drop: 'Monster', shop: 'Shop', object: 'Object', spawn: 'Spawn' };
    const markBaseSources = () => {
      const alias = access === ownAccess;
      const entries = alias ? null : replay.baseOwnership.get(previousBaseEntry) ?? [];
      const ownership = alias ? undefined : entries.find(value => value.own === previousBaseOwn && value.objects === previousBaseOwnObjects);
      const flags = alias ? null : ownership?.flags ?? new Map();
      for (const [name, list] of base.sources) {
        const saved = ownership?.flags.get(name), values = !alias && !ownership ? [] : null;
        let anyOwn = false;
        for (let index = 0; index < list.length; index++) {
          const source = list[index];
          let own = alias || saved?.[index];
          if (!alias && !saved) {
            const locations = ownAccess.locations.get(`${baseSourceKinds[source.kind]}:${source.kind === 'spawn' ? name : source.source}`);
            own = (Array.isArray(locations) ? locations.includes(source.location)
              : locations instanceof Set ? locations.has(source.location) : locations ? [...locations].includes(source.location) : false)
              || source.kind === 'shop' && ownLocation(source.location);
          }
          source.own = own;
          anyOwn ||= own;
          if (!alias && !ownership) values.push(own);
        }
        if (anyOwn) ownItems.add(name);
        if (!alias && !ownership) flags.set(name, values);
      }
      if (!alias && !ownership) {
        entries.push({ own: previousBaseOwn, objects: previousBaseOwnObjects, flags });
        replay.baseOwnership.set(previousBaseEntry, entries);
      }
    };
    markBaseSources();
    let items = new Set(base.items), sources = new Map(base.sources);
    const manualItems = [...Object.entries(legacy.manualMonsters?.Items ?? {}).map(([name, primary]) => [decodeLegacyText(name), primary, 'manual']), ...Object.keys(legacy.manualEquipment ?? {}).map(name => [decodeLegacyText(name), false, 'drop'])];
    const membershipDiagnostics = [];
    for (const [name, primary, kind] of manualItems) if (!access.backloggedSources?.items?.[name]) {
      const membership = itemMembershipBlocker(name, f2p, definitions);
      if (membership) { membershipDiagnostics.push({ ...membership, source: 'Manually declared item/equipment' }); continue; }
      items.add(name); ownItems.add(name); sources.set(name, [...(sources.get(name) ?? []), { kind, source: kind === 'drop' ? 'Manually declared equipment' : 'Manually declared item', primary: !!primary, own: true }]);
    }
    // Personal obtain evidence supplies the item even when its original source
    // is unreachable. Membership and equip requirements still apply normally.
    for (const record of recordedEquipment(member, definitions)) {
      const membership = itemMembershipBlocker(record.name, f2p, definitions);
      if (membership) { membershipDiagnostics.push({ ...membership, source: 'Personal obtain record' }); continue; }
      items.add(record.name); ownItems.add(record.name);
      sources.set(record.name, [...(sources.get(record.name) ?? []), { kind: 'recorded', source: 'Personal obtain record', primary: true, own: true, provenance: record.provenance }]);
    }
    const passive = Object.fromEntries(Object.keys(skillCaps).map(skill => [skill, 1]));
    for (const [skill, level] of Object.entries(playerControls.passiveLevels)) if (caps[skill] && Number.isFinite(Number(level))) passive[skill] = Math.max(1, Math.min(Number(level), caps[skill]));
    // Observed base levels are independent personal capability evidence. Keep the
    // raw observation separate from manual controls and apply only planning caps.
    for (const [skill, observation] of Object.entries(observedProgress)) passive[skill] = Math.max(passive[skill], Math.min(observation.level, caps[skill]));
    // A lock explicitly declares the reached Slayer level as well as restricting
    // further assignment training. It is personal evidence, not a group ceiling.
    passive.Slayer = Math.max(passive.Slayer, Math.min(Number(playerControls.slayerLock?.level ?? 1), caps.Slayer));
    for (const task of compiled) if (completedTask(task) && caps[task.category]) passive[task.category] = Math.max(passive[task.category], Math.min(task.level, caps[task.category]));
    passive.Combat = Math.max(passive.Combat, combatLevelFromSkills(passive, { f2p }));
    const levels = { ...passive }, trained = new Set(), ownTraining = new Set(), trainingVia = new Map();
    const refreshSlayerLevel = () => {
      passive.Slayer = Math.min(caps.Slayer, Math.max(passive.Slayer, Number(playerControls.passiveLevels.Slayer ?? 1), observedProgress.Slayer?.level ?? 1, Number(playerControls.slayerLock?.level ?? 1), ...compiled.filter(task => task.category === 'Slayer' && completedTask(task)).map(task => task.level)));
      levels.Slayer = trained.has('Slayer') ? caps.Slayer : passive.Slayer;
    };
    let points = { QuestPointsNeeded: 0, KudosNeeded: 0, CombatScoreNeeded: 0, TotalLevelNeeded: 0, TotalVirtualLevelNeeded: 0 };
    const counters = { passes: 0, checks: 0, dependencyChecks: 0, accessPasses: 0 };
    const outputCache = replay.outputCache ??= new Map();
    const sourceList = item => sources.get(item) ?? [];
    const ordinaryItem = (name, own = false) => sourceList(name).some(source => source.processingMode !== 'multi' && (!own || ownSource(source)));
    const sourceName = value => typeof value === 'string' ? value : value.name ?? value.source ?? value.task ?? value.location ?? '';
    const sourceType = value => typeof value === 'string' ? value : value.kind ?? value.type ?? '';
    const sourcePrimary = source => {
      if (sourceType(source) === 'drop') return passesRateCutoff(source.probability, rules, 'primary');
      if (sourceType(source) === 'shop') return true;
      if (sourceType(source) === 'spawn') return on(rules, 'Primary Spawns', true);
      if (source.category === 'Farming' && !on(rules, 'Farming Primary', false)) return false;
      if (Object.hasOwn(source, 'probability')) return source.primary === true && passesRateCutoff(source.probability, rules, 'primary');
      return source.primary === true;
    };
    const matchesItemSources = (list, record, category, itemName) => {
      // Virtual outputs from an unselected processing candidate are conditional
      // multistep supplies, not ordinary output or equipment proof (worker:4457).
      let allowMulti;
      // Prayer recipes consume crafted materials (incense, urns, etc.). Wielding
      // restrictions apply to equipment/training rows, not those recipe inputs.
      const prayerRecipe = category === 'Prayer' && array(record?.Output).length > 0 && !definitions.equipment?.[itemName];
      const excludeCrafted = (MONSTER_TRAINING.has(category) || ['Ranged', 'Summoning', 'Necromancy'].includes(category) || category === 'Prayer' && !prayerRecipe || record?.Category?.includes('BIS Skilling')) && !record?.['Not Equip'] && !on(rules, 'Wield Crafted Items', false);
      // With an output, Source describes the produced loot/shop channel. Keep
      // Source-only selectors and the explicit input constraints above intact.
      let nonShop = !record?.NonShop, allowed = !record?.AllowedSources,
        channel = !record?.Source || array(record.Output).length > 0;
      for (const source of list) {
        if (source.processingMode === 'multi') {
          allowMulti ??= on(rules, 'Multi Step Processing', false)
            && !(['Extra', 'Nonskill'].includes(category) || (MONSTER_TRAINING.has(category) || ['Ranged', 'Prayer', 'Summoning', 'Necromancy'].includes(category)) && !record?.['Not Equip']);
          if (!(allowMulti && Number(record?.Level ?? 1) >= source.producerLevel)) continue;
        }
        const type = excludeCrafted || !nonShop || !channel ? sourceType(source) : null;
        if (excludeCrafted && type === 'task' && PROCESSING.has(source.category)) continue;
        nonShop ||= !type.includes('shop');
        allowed ||= record.AllowedSources.includes(sourceName(source));
        channel ||= type.includes(record.Source);
        // Each constraint can be witnessed by a different admitted source.
        if (nonShop && allowed && channel) return true;
      }
      return false;
    };
    const hasItem = (name, record, category, own = false) => items.has(name) && matchesItemSources(own ? sourceList(name).filter(ownSource) : sourceList(name), record, category, name);
    const ordinaryProcessingInput = (row, name) => items.has(name)
      && matchesItemSources(sourceList(name).filter(source => source.processingMode !== 'multi'), row.record, row.category, name);
    function ownItemOrigin(name, task, visiting) {
      if (itemMembershipBlocker(name, f2p, definitions)) return false;
      if (hasItem(name, task?.record, task?.category, true)) return true;
      // Queries ask for admitted supply proof. The producer catalogue is used
      // only below to define a task's own obligation, not to assert inventory.
      if (!task) return false;
      if (access.backloggedSources?.items?.[name]) return false;
      const list = (producers.get(name) ?? []).filter(producer => (!f2p || !producer.task.record['Not F2P'] && !membershipByTask.get(producer.task).length)
        && obligation(producer.task, new Set(visiting)) && (producer.kind === 'reward' || outputItems(producer.task, producer.output).some(item => item.name === name
          && !(item.tables ?? []).some(table => sourceMembershipBlocker('DropItem', name, f2p, table)))))
        .map(producer => ({ kind: producer.kind, name: producer.task.rawLabel, category: producer.task.category }));
      return matchesItemSources(list, task?.record, task?.category, name);
    }
    const availableLocation = name => /^\d+-\d+$/.test(name) ? access.sections.has(name) : access.bases.has(name) || access.areas.has(name);
    function ownLocation(name) { return /^\d+-\d+$/.test(name) ? ownAccess.sections.has(name) : ownAccess.areas.has(name) || ownAccess.bases.has(name) && (!accessIndex.baseSections.has(name) || accessIndex.baseSections.get(name).some(id => ownAccess.sections.has(id))); }
    function ownRequirement(requirement, task, visiting = new Set(), defining = true) {
      const has = name => requirement.field === 'Chunks' ? ownLocation(name) : requirement.field === 'Items' ? defining ? ownItemOrigin(name, task, visiting) : hasItem(name, task?.record, task?.category, true)
        : requirement.field === 'Mix' ? ownAccess.npcs.has(name) || ownAccess.monsters.has(name)
          : ['Monsters', 'Monster'].includes(requirement.field) ? name === 'Monster[+]' ? ownAccess.monsters.size > 0 : ownAccess.monsters.has(name)
            : ownAccess[requirement.field.toLowerCase()]?.has(name) ?? false;
      return requirement.alternatives ? requirement.alternatives.filter(has).length >= requirement.count : has(requirement.clean);
    }
    // Spatial requirements define a task. Supplies may be sourced from the
    // capability map. Location-free item/dependency goals inherit own provenance.
    const ownRootProofs = new Set();
    const obligationCache = createObligationCache({ enabled: reuseObligations });
    function obligation(task, visiting = new Set()) {
      const root = visiting.size === 0;
      if (root && ownRootProofs.has(task)) return true;
      const own = obligationCache.evaluate(task, visiting, () => computeObligation(task, visiting));
      // Personal reachability and source ownership only grow in this closure.
      // Recursive calls still use their path-specific cycle guard, and a fresh
      // replay gets a fresh proof cache whenever admissions retract/change mode.
      if (root && own) ownRootProofs.add(task);
      return own;
    }
    function computeObligation(task, visiting) {
      if (visiting.has(task.key)) return ownTaskKeys.has(task.key);
      visiting.add(task.key);
      if (sourceLocationBlocker(task.sourceLocations, ownAccess)) return false;
      const local = task.localRequirements;
      if (task.record.UnlocksArea) return ownAccess.areas.has(task.rawLabel) || ownAccess.possibleAreas.has(task.rawLabel);
      if (task.record.ConnectsSections) return array(task.record.Sections).every(name => ownAccess.bases.has(name.split('-')[0]) || ownLocation(name)) && array(task.record.Sections).some(ownLocation);
      if (local.length) return local.every(requirement => ownRequirement(requirement, task));
      const itemRequirements = task.itemRequirements;
      if (itemRequirements.length) return itemRequirements.every(requirement => ownRequirement(requirement, task, visiting));
      if (task.dependencies.length) return task.dependencies.every(dependency => (dependency.alternatives ?? [dependency.clean]).filter(name => {
        const target = byKey.get(keyOf(dependency.category, name.split('--')[0]));
        const relaxed = anyAchievements ? dependency.relaxedAny : dependency.relaxedAlways;
        return target && (target.key === task.key || relaxed.has(name.split('--')[0]) || obligation(target, new Set(visiting)));
      }).length >= dependency.count);
      if (task.record.ClueTier) return (ownAccess.clues.get(task.record.ClueTier) ?? 0) > 0;
      return true;
    }
    const requirementNameAvailable = (field, name, task) => {
      if (field === 'Chunks') return availableLocation(name);
      if (field === 'Items') return hasItem(name, task.record, task.category);
      if (field === 'Mix') return access.npcs.has(name) || access.monsters.has(name);
      if (field === 'Monsters' || field === 'Monster') return name === 'Monster[+]' ? access.monsters.size > 0 : access.monsters.has(name);
      return access[field.toLowerCase()]?.has(name) ?? false;
    };
    const requirementAvailable = (requirement, task) => {
      if (requirement.clean === 'Monster[+]') return access.monsters.size > 0;
      if (requirement.alias && !requirement.alternatives) return false;
      const has = name => requirementNameAvailable(requirement.field, name, task);
      return requirement.alternatives ? requirement.alternatives.filter(has).length >= requirement.count : has(requirement.clean);
    };
    function boost(skill, task) {
      if (!on(rules, 'Boosting', false) || task.record.NoBoost) return 0;
      let best = 0, saw = 0;
      for (const [name, amount] of Object.entries(code.boostItems?.[skill] ?? {})) {
        if (code.boostTaskBans?.[skill]?.[task.rawLabel]?.includes(name)) continue;
        const [itemName, field = 'items'] = name.split('~');
        if (!(field === 'items' ? items.has(itemName) && sourceList(itemName).some(source => source.processingMode !== 'multi') : access[field]?.has(itemName))) continue;
        if (itemName === 'Crystal saw') { if (skill === 'Construction' && task.record.Items?.includes('Saw[+]')) saw = 3; continue; }
        if (typeof amount === 'number') best = Math.max(best, amount);
        else if (/^\d+(?:\.\d+)?%\+\d+$/.test(amount)) {
          const [percent, addition] = amount.split('%+').map(Number);
          best = Math.max(best, Math.floor(levels[skill] * percent / 100 + addition));
        }
      }
      return best + saw;
    }
    const failedRequirements = new Map();
    const failedTrainingNeeds = new Map();
    const fixedRequirementFields = new Set(['Chunks', 'NPCs', 'Shops']);
    function needBlocked(task, [skill, required]) {
      if (typeof required !== 'number' || !Number.isFinite(required) || !caps[skill]) return true;
      if (required > caps[skill] && !(task.record['Allow Virtual'] && !f2p && required <= 120)) return true;
      return required > (levels[skill] ?? 1) && required > (levels[skill] ?? 1) + boost(skill, task);
    }
    function check(task, explain = false) {
      counters.checks++;
      if (!explain && staticBlocked.has(task)) return unavailableCheck;
      const { record, category } = task;
      const blockers = explain ? [] : null;
      let blocked = false;
      const add = (kind, detail) => { blocked = true; if (explain) blockers.push({ kind, detail }); };
      // The boolean path already tested all immutable guards in staticBlocked.
      // Keep their original order only when building the public explanation.
      if (explain) {
        if (task.unknown.length) add('unsupported', `Some task requirements are not yet supported: ${task.unknown.join(', ')}.`);
        if (record.Categories) add('unsupported', `Special task-group requirements are not yet supported: ${record.Categories.join(', ')}.`);
        if (record.OutputVar) add('unsupported', 'The items this task produces can vary; the picker cannot yet check them.');
        for (const requirement of task.invalidRequirements) add('unsupported', `Unknown ${requirement.field.toLowerCase()} alias ${requirement.token}.`);
        for (const dependency of task.invalidDependencies) add('unsupported', `Unknown task reference ${dependency.token} (${dependency.category}).`);
        for (const id of task.invalidCompletedDependencies) add('unsupported', `Unknown completed task reference ${id}.`);
        for (const target of task.unsupportedCompletedDependencies) add('unsupported', `Completion prerequisite ${target.label} (${target.category}) has unsupported requirements.`);
        if (f2p && record['Not F2P']) add('membership', 'This activity requires membership.');
        const membership = membershipByTask.get(task);
        if (membership.length) { blocked = true; blockers.push(...membership); }
        if (record['Not Skiller'] && on(rules, 'Skiller', false)) add('rule', 'Unavailable under the skiller rule.');
        for (const tag of task.tags) if (!PRESENTATION_RULES.has(tag) && !MAYBE_PRIMARY.has(tag) && !on(rules, tag)) add('rule', `Turned off in Rules: ${tag}.`);
        if (task.level > 1 && task.tags.includes('InsidePOH Primary') && !on(rules, 'InsidePOH', true)) add('rule', 'InsidePOH is disabled for workbench tasks above level 1.');
        if (member.taskStatus?.[task.id]?.backlogged) add('backlog', 'This task is backlogged by the current member.');
      }
      if (record.UnlocksArea && access.blockedAreas?.has(task.rawLabel)) add('access', explain ? `${task.rawLabel} is manually blocked by the current member.` : undefined);
      if (blocked) return explain ? blockers : unavailableCheck;
      // Manual checks need in-game evidence, never inferred map or supply access.
      // A recorded personal completion uses the existing completed-task path.
      for (const reason of task.manualChecks) add('manual-check', reason);
      if (Object.hasOwn(record, 'PersonalQuestProgress')) {
        const prerequisite = personalQuestProgressBlocker(record.PersonalQuestProgress, personallyCompletedQuests);
        if (prerequisite) add(prerequisite.kind, prerequisite.detail);
      }
      const personalAlternative = personalAlternativesBlocker(task.personalAlternatives, personallyCompletedQuests, supportedPersonalCompletions,
        id => byId.get(id)?.label ?? 'the entry confirmation');
      if (personalAlternative) add(personalAlternative.kind, personalAlternative.detail);
      const payment = dialogueSupplyBlocker(task.dialogueSupply, name => hasItem(name, record, category));
      if (payment) add(payment.kind, payment.detail);
      const sourceLocation = sourceLocationBlocker(task.sourceLocations, access);
      if (sourceLocation) add(sourceLocation.kind, sourceLocation.detail);
      for (const id of task.completedDependencies) {
        counters.dependencyChecks++;
        const target = byId.get(id);
        if (target && !completedTask(target)) add('personal-completion', explain ? `Requires ${target.label} (${target.category}) with personal completion evidence.` : undefined);
      }
      if (record.UnlocksArea && !access.areas.has(task.rawLabel) && !access.bases.has(task.rawLabel)) {
        const entrance = access.possibleAreas?.has(task.rawLabel) ?? (entrances.get(task.rawLabel) ?? []).some(availableLocation);
        if (!entrance) add('access', explain ? `No reachable entrance to ${task.rawLabel}.` : undefined);
      }
      if (record.ConnectsSections) {
        if (!array(record.Sections).every(name => /^\d+-\d+$/.test(name) ? access.bases.has(name.split('-')[0]) : access.areas.has(name) || access.bases.has(name))) add('access', 'Both connected section bases must be unlocked.');
        if (!array(record.Sections).some(availableLocation)) add('access', 'Neither connected section is reachable.');
      }
      if (!explain) {
        const failed = failedRequirements.get(task);
        // Any still-missing local condition proves the same boolean rejection,
        // without revisiting earlier successful item/provenance requirements.
        // Raw spatial fields cannot change through Slayer/object publication.
        if (failed && (failed.raw === cachedAccess.shared || !requirementAvailable(failed.requirement, task))) return unavailableCheck;
        if (replay.spatialFailures.get(cachedAccess.shared)?.has(task)) return unavailableCheck;
      }
      for (const requirement of task.requirements) if (!requirementAvailable(requirement, task)) {
        add(explain ? requirement.alias && !requirement.alternatives && requirement.clean !== 'Monster[+]' ? 'unsupported' : requirement.field.toLowerCase() : undefined, explain ? `${requirement.field}: ${requirement.displayLabel}${requirement.count > 1 ? ` (need ${requirement.count} distinct alternatives)` : ''}.` : undefined);
        if (!explain) {
          const raw = fixedRequirementFields.has(requirement.field) && requirement.clean !== 'Monster[+]' ? cachedAccess.shared : null;
          failedRequirements.set(task, { requirement, raw });
          if (raw) {
            let failures = replay.spatialFailures.get(raw);
            if (!failures) replay.spatialFailures.set(raw, failures = new Map());
            failures.set(task, requirement);
          }
          return unavailableCheck;
        }
      }
      if (!explain) failedRequirements.delete(task);
      if (!explain && task.needs.length) {
        const failed = failedTrainingNeeds.get(task);
        if (failed && needBlocked(task, failed)) {
          // The original boolean path visits every declared dependency after
          // local conditions pass, even when training already proves rejection.
          counters.dependencyChecks += task.dependencies.length;
          return unavailableCheck;
        }
        failedTrainingNeeds.delete(task);
      }
      let failedNeed;
      for (const need of task.needs) {
        const [skill, required] = need;
        if (typeof required !== 'number' || !Number.isFinite(required) || !caps[skill]) {
          failedNeed ??= need;
          add('unsupported', explain ? `Invalid skill requirement ${skill}: ${String(required)}.` : undefined); continue;
        }
        if (required > caps[skill] && !(record['Allow Virtual'] && !f2p && required <= 120)) {
          failedNeed ??= need;
          add('membership', explain ? `${skill} ${required} exceeds the ${f2p ? 'free-to-play or saved' : 'real or saved'} level cap ${caps[skill]}.` : undefined);
        } else if (required > (levels[skill] ?? 1) && required > (levels[skill] ?? 1) + boost(skill, task)) {
          failedNeed ??= need;
          add('training', explain ? `${skill} ${required} needs an accessible primary training method or personal level/completion evidence; currently reachable level ${levels[skill] ?? 1}.${disconnectedExplanation()}` : undefined);
        }
      }
      if (!explain && failedNeed) failedTrainingNeeds.set(task, failedNeed);
      for (const dependency of task.dependencies) {
        counters.dependencyChecks++;
        const names = dependency.alternatives ?? [dependency.clean];
        if (dependency.alias && !dependency.alternatives) { add('unsupported', `Unknown task alias ${dependency.token}.`); continue; }
        const relaxed = anyAchievements ? dependency.relaxedAny : dependency.relaxedAlways;
        const hits = new Set();
        for (const name of names) {
          const raw = name.split('--')[0], cat = dependency.category;
          if (raw === task.rawLabel && cat === category) continue; // reference self-links annotate alternative production routes
          const targetKey = keyOf(cat, raw);
          const target = byKey.get(targetKey);
          if (relaxed.has(raw) || (category === 'Slayer' && cat === 'Quest' ? target && completedTask(target) : valid.has(targetKey))) hits.add(targetKey);
        }
        if (names.every(name => name.split('--')[0] === task.rawLabel && dependency.category === category)) continue;
        if (hits.size < dependency.count) add(explain ? names.every(name => !byKey.has(keyOf(dependency.category, name.split('--')[0]))) ? 'unsupported' : category === 'Slayer' && dependency.category === 'Quest' ? 'personal-completion' : 'tasks' : undefined, explain ? `Requires ${dependency.displayLabel} (${dependency.category})${category === 'Slayer' && dependency.category === 'Quest' ? ' with personal completion evidence' : ''}.` : undefined);
      }
      for (const name of ['QuestPointsNeeded', 'KudosNeeded', 'CombatScoreNeeded', 'TotalLevelNeeded', 'TotalVirtualLevelNeeded']) if (record[name] !== undefined && points[name] < record[name]) add('points', explain ? `${name}: needs ${record[name]}, reachable ${points[name]}.` : undefined);
      if (task.requirementAlternatives.length && !task.requirementAlternatives.some(clause =>
        clause.needs.every(([skill, required]) => required <= caps[skill] && required <= (levels[skill] ?? 1))
        && clause.points.every(([name, required]) => points[name] >= required))) {
        add('requirements', explain ? typeof record.RequirementAlternativesDescription === 'string' ? `Requires ${record.RequirementAlternativesDescription}` : `Requires one of: ${task.requirementAlternatives.map(clause => [
          ...clause.needs.map(([skill, required]) => `${skill} ${required}`),
          ...clause.points.map(([name, required]) => `${name === 'TotalLevelNeeded' ? 'total level' : name} ${required}`)
        ].join(' and ')).join(' or ')}.` : undefined);
      }
      if (record.ClueTier) {
        const clues = access.clues.get(record.ClueTier);
        if (!(typeof clues === 'number' ? clues > 0 : clues?.size > 0)) add('clue', explain ? `No accessible ${record.ClueTier} clue location.` : undefined);
      }
      return explain ? blockers : blocked ? unavailableCheck : availableCheck;
    }
    const sourceIndexes = new Map();
    const sourceKey = source => JSON.stringify([sourceName(source), sourceType(source), source.taskId, source.location, source.rate, source.quantity, JSON.stringify(source.tables)]);
    function addSource(name, source) {
      const list = sources.get(name) ?? [];
      let index = sourceIndexes.get(name);
      if (!index) {
        index = new Map(); sourceIndexes.set(name, index);
        for (const value of list) {
          const key = sourceKey(value), bucket = index.get(key) ?? [];
          bucket.push(value); index.set(key, bucket);
        }
      }
      const key = sourceKey(source), bucket = index.get(key) ?? [];
      // Keep the original strict predicate: JSON keys can collide for null,
      // undefined or nonfinite quantities, and the first match is authoritative.
      const existing = bucket.find(value => sourceName(value) === sourceName(source) && sourceType(value) === sourceType(source)
        && value.taskId === source.taskId && value.location === source.location && value.rate === source.rate && value.quantity === source.quantity
        && JSON.stringify(value.tables) === JSON.stringify(source.tables));
      if (!existing) { list.push(source); sources.set(name, list); bucket.push(source); index.set(key, bucket); obligationCache.clear(); return true; }
      if (source.own === true && existing.own !== true) { existing.own = true; ownItems.add(name); obligationCache.clear(); return true; }
      if (source.primary === true && existing.primary !== true) { existing.primary = true; obligationCache.clear(); return true; }
      return false;
    }
    function primaryEligible(task, forSelection = false) {
      if (unsupportedTasks.has(task)) return false;
      if (!forSelection && processingTasks.has(task) && !admitted.has(task.id) && !completedTask(task)) return false;
      if (!task.record.Primary) return task.record.Primary;
      const secondaryInputs = task.itemRequirements.filter(requirement => requirement.token.includes('*')).some(requirement => !(requirement.alternatives ?? [requirement.clean]).some(item => sourceList(item).some(sourcePrimary)));
      const disabledMethod = task.tags.some(tag => MAYBE_PRIMARY.has(tag) && !on(rules, tag));
      return task.record.Primary && (!task.tags.includes('Secondary Primary') || on(rules, 'Secondary Primary', false)) && !secondaryInputs && !disabledMethod;
    }
    function outputItems(task, output, path = [], probability = 1, ratesPath = [], quantity = '1') {
      if (path.includes(output)) return [];
      const cacheKey = keyOf(task.category, output);
      if (!path.length && outputCache.has(cacheKey)) return outputCache.get(cacheKey);
      const table = definitions.skillItems?.[task.category]?.[output] ?? code.dropTables?.[output];
      if (!table) {
        if (typeof output !== 'string' || ratesPath.length && !on(rules, 'Rare Drop', true) && !passesRateCutoff(probability, rules)) return [];
        const rate = ratesPath.join(' × ');
        return [{ name: output, ...(ratesPath.length ? { rate, probability, quantity, tables: path, ...rateEvidence(rate, probability) } : {}) }];
      }
      const result = [];
      for (const [item, rates] of Object.entries(table)) {
        const rows = typeof rates === 'string' ? [[rates.split('@')[1] ?? '1', rates.split('@')[0]]] : Object.entries(rates ?? {});
        for (const [childQuantity, rate] of rows) {
          const amount = /^\d+$/.test(quantity) && /^\d+$/.test(childQuantity) ? String(Number(quantity) * Number(childQuantity)) : `${quantity} × ${childQuantity}`;
          result.push(...outputItems(task, item, [...path, output], composeDropRates(probability, parseDropRate(rate)), [...ratesPath, String(rate ?? '')], amount));
        }
      }
      if (!path.length) outputCache.set(cacheKey, result);
      return result;
    }
    const publications = new Map();
    let publicationReads;
    function outputGate(name, task, kind = 'task', evidence = {}) {
      if (itemMembershipBlocker(name, f2p, definitions)) return false;
      if ((evidence.tables ?? []).some(table => sourceMembershipBlocker('DropItem', name, f2p, table))) return false;
      if (access.backloggedSources?.items?.[name]) return false;
      const satisfies = value => value === undefined || value === true || (Array.isArray(value) ? value.every(satisfies) : value && typeof value === 'object' && Object.entries(value).every(([label, category]) => {
        const key = keyOf(category, label), present = observeCapabilityTask(key);
        publicationReads?.set(key, present);
        return present;
      }));
      for (const { source, requirements } of outputGates.get(name) ?? []) {
        if (source === undefined || source === task.rawLabel || source?.endsWith('-source') && task.rawLabel.toLowerCase().includes(source.slice(0, -7).toLowerCase()) || source === '' && kind === 'drop') {
          if (!satisfies(requirements)) return false;
        }
      }
      return true;
    }
    function materialize(task, multi = false) {
      // Completion remains personal prerequisite evidence; it cannot manufacture
      // supplies through a currently members-only activity.
      if (f2p && (task.record['Not F2P'] || membershipByTask.get(task).length
        || task.needs.some(([skill, level]) => typeof level === 'number' && level > f2pCap(skill)))) return false;
      if (unsupportedTasks.has(task)) return false;
      // A recorded purchase does not make future goods free or preserve an
      // inaccessible seller. Recheck payment/source capability on this adapter.
      if (task.dialogueSupply && check(task).length) return false;
      if (sourceLocationBlocker(task.sourceLocations, access)) return false;
      if (processingTasks.has(task) && !admitted.has(task.id) && !completedTask(task) && !(multi && multiAdmitted.has(task.id))) return false;
      let changed = false;
      const own = obligation(task);
      const primary = !multi && !!primaryEligible(task);
      let modes = publications.get(task);
      const previousPublication = modes?.get(multi);
      if (previousPublication && previousPublication.access === cachedAccess && previousPublication.own === own
        && previousPublication.primary === primary && sameTaskReads(previousPublication)) return false;
      const reads = publicationReads = new Map();
      const remember = () => {
        if (!modes) { modes = new Map(); publications.set(task, modes); }
        modes.set(multi, { access: cachedAccess, own, primary, reads });
        publicationReads = undefined;
      };
      if (own && !ownTaskKeys.has(task.key)) { ownTaskKeys.add(task.key); obligationCache.clear(); changed = true; }
      for (const output of array(task.record.Output)) for (const { name, ...evidence } of outputItems(task, output)) if (outputGate(name, task, 'task', evidence)) {
        if (!items.has(name)) { items.add(name); changed = true; }
        if (own && !ownItems.has(name)) { ownItems.add(name); changed = true; }
        changed = addSource(name, { kind: 'task', name: task.rawLabel, taskId: task.id, category: task.category, ...evidence,
          ...(task.dialogueSupply ? { dialogueSupply: structuredClone(task.dialogueSupply), balanceVerified: false, renewable: true } : {}),
          own, ...(multi ? { processingMode: 'multi', producerLevel: task.level } : {}), ...(task.record.Source ? { sourceKind: task.record.Source } : {}), primary: primary && (!Object.hasOwn(evidence, 'probability') || passesRateCutoff(evidence.probability, rules, 'primary')) }) || changed;
      }
      if (multi) { remember(); return changed; }
      for (const name of array(task.record['Output Object'])) if (typeof name === 'string') for (const object of code.objectsPlus?.[name] ?? [name]) {
        if (sourceMembershipBlocker('Object', object, f2p)) continue;
        if (access.backloggedSources?.objects?.[object]) continue;
        const previous = producedObjects.get(object), locations = [...new Set([...(previous?.locations ?? []), ...array(task.record.Chunks).filter(availableLocation)])];
        if (!previous || own && !previous.own || locations.length !== previous.locations.length) changed = true;
        producedObjects.set(object, { taskId: task.id, own: own || previous?.own === true, locations });
      }
      for (const name of array(task.record.Reward)) if (typeof name === 'string' && outputGate(name, task, 'reward')) {
        if (!items.has(name)) { items.add(name); changed = true; }
        if (own && !ownItems.has(name)) { ownItems.add(name); changed = true; }
        changed = addSource(name, { kind: 'reward', name: task.rawLabel, taskId: task.id, own }) || changed;
      }
      remember();
      return changed;
    }
    function updateSkills() {
      let changed = false;
      const seed = (skill, own = true, task) => {
        if (!trained.has(skill)) { trained.add(skill); levels[skill] = caps[skill]; changed = true; }
        if (own) ownTraining.add(skill);
        else {
          const locations = task?.requirements.flatMap(requirement => (requirement.alternatives ?? [requirement.clean]).flatMap(name => {
            if (requirement.field === 'Chunks') return [name];
            if (requirement.field === 'Items') return sourceList(name).filter(source => !source.own).map(source => source.location).filter(Boolean);
            const kinds = requirement.field === 'Mix' ? ['NPC', 'Monster'] : [{ Objects: 'Object', NPCs: 'NPC', Monsters: 'Monster', Monster: 'Monster', Shops: 'Shop' }[requirement.field]];
            return kinds.flatMap(kind => [...(access.locations.get(`${kind}:${name}`) ?? [])]);
          })) ?? [];
          const names = state.members.filter(owner => owner.id !== memberId && owner.unlocked?.some(base => connections?.byChunk[base]?.connected && (!locations.length || locations.some(location => location.split('-')[0] === base)))).map(owner => owner.name || owner.id);
          trainingVia.set(skill, new Set([...(trainingVia.get(skill) ?? []), ...names]));
        }
      };
      for (const [skill, active] of Object.entries(playerControls.primaryOverrides)) if (active === true && caps[skill]) seed(skill);
      if (access.monsters.size) for (const skill of MONSTER_TRAINING) seed(skill, ownAccess.monsters.size > 0);
      if (access.monsters.size && Object.keys(code.ammoTools ?? {}).some(ammo => (ammo === 'No ammo' || (code.itemsPlus?.[ammo] ?? [ammo]).some(item => ordinaryItem(item))) && Object.keys(code.ammoTools[ammo]).some(weapon => ordinaryItem(weapon) && (code.rangedItems?.[weapon] ?? definitions.equipment?.[weapon]?.requirements?.Ranged ?? 1) <= passive.Ranged))) seed('Ranged', ownAccess.monsters.size > 0 && Object.keys(code.ammoTools ?? {}).some(ammo => (ammo === 'No ammo' || (code.itemsPlus?.[ammo] ?? [ammo]).some(item => ordinaryItem(item, true))) && Object.keys(code.ammoTools[ammo]).some(weapon => ordinaryItem(weapon, true) && (code.rangedItems?.[weapon] ?? definitions.equipment?.[weapon]?.requirements?.Ranged ?? 1) <= passive.Ranged)));
      if (array(code.boneItems).some(item => ordinaryItem(item))) seed('Prayer', array(code.boneItems).some(item => ordinaryItem(item, true)));
      for (const task of primarySkillTasks) if (valid.has(task.key) && caps[task.category]) {
        if (f2p && (task.record['Not F2P'] || membershipByTask.get(task).length)) continue;
        const primary = primaryEligible(task);
        const smithing = task.category !== 'Smithing' || on(rules, 'Smithing by Smelting', false) || access.objects.has('Anvil') || access.objects.has('Rusted anvil');
        if (primary && smithing && (task.level <= passive[task.category] || task.level <= passive[task.category] + boost(task.category, task))) {
          if (task.category === 'Slayer' && !/Receive a slayer assignment from |Reaper assignment/i.test(task.rawLabel) && releaseSlayerLock({ kind: 'primary-method', taskId: task.id })) {
            changed = true;
            refreshSlayerLevel();
          }
          seed(task.category, obligation(task) && task.itemRequirements.every(requirement => ownRequirement(requirement, task, new Set(), false)), task);
        }
      }
      if ([...MONSTER_TRAINING, 'Ranged', 'Magic', 'Necromancy'].some(skill => trained.has(skill))) seed('Combat', [...MONSTER_TRAINING, 'Ranged', 'Magic', 'Necromancy'].some(skill => ownTraining.has(skill)));
      return changed;
    }
    function updatePoints() {
      points = { QuestPointsNeeded: 0, KudosNeeded: 0, CombatScoreNeeded: 0, TotalLevelNeeded: Object.entries(levels).filter(([skill]) => skill !== 'Combat').reduce((sum, [, level]) => sum + level, 0), TotalVirtualLevelNeeded: Object.entries(levels).filter(([skill]) => skill !== 'Combat').reduce((sum, [skill, level]) => sum + (trained.has(skill) && !f2p ? 120 : level), 0) };
      const xp = {};
      for (const task of pointTasks) if (valid.has(task.key)) {
        points.QuestPointsNeeded += Number(task.record.QuestPoints ?? 0);
        points.KudosNeeded += Number(task.record.Kudos ?? 0);
        points.CombatScoreNeeded += Number(task.record.CombatScore ?? 0);
        for (const [skill, amount] of Object.entries(task.record.XpReward ?? {})) if (typeof amount === 'number') xp[skill] = (xp[skill] ?? 0) + amount;
      }
      for (const { category, rawLabel, allocation } of xpAllocations) {
        const task = byKey.get(keyOf(category, rawLabel));
        if (valid.has(keyOf(category, rawLabel)) && !authoredXpTasks.has(task?.id)) for (const [skill, amount] of Object.entries(allocation)) if (caps[skill] && Number.isFinite(Number(amount))) xp[skill] = (xp[skill] ?? 0) + Number(amount);
      }
      for (const task of pointTasks) if (valid.has(task.key) && authoredXpTasks.has(task.id)) {
        for (const [skill, amount] of Object.entries(xpChoiceAllocation(task, member.xpChoices[task.id]))) if (caps[skill]) xp[skill] = (xp[skill] ?? 0) + amount;
      }
      let changed = false;
      for (const [skill, amount] of Object.entries(xp)) if (caps[skill]) {
        const next = Math.min(caps[skill], experienceLevel(amount));
        if (next > passive[skill]) { passive[skill] = next; if (!trained.has(skill)) levels[skill] = next; changed = true; }
      }
      return changed;
    }
    const serializeAccess = value => ({ bases: [...value.bases], sections: [...value.sections], components: [...value.components], compatibilitySections: [...value.compatibilitySections], areas: [...value.areas], blockedAreas: [...value.blockedAreas], objects: [...value.objects], npcs: [...value.npcs], monsters: [...value.monsters], shops: [...value.shops], spawns: Object.fromEntries(value.spawns), questSteps: Object.fromEntries(value.questSteps), clues: Object.fromEntries(value.clues), locations: Object.fromEntries(value.locations), diagnostics: value.diagnostics, possibleAreas: [...value.possibleAreas], entranceSources: Object.fromEntries(value.entranceSources), backloggedSources: structuredClone(value.backloggedSources) });
    const processingAccess = () => {
      if (!on(rules, 'Boosting', false) || !processingBoostFields.length) return emptyProcessingAccess;
      // Preserve the full serializer's behavior for custom non-array fields.
      if (processingBoostFields.some(field => !processingSetFields.has(field) || !(access[field] instanceof Set))) return serializeAccess(access);
      return Object.fromEntries(processingBoostFields.map(field => [field, [...access[field]]]));
    };
    let processing, setWinners;
    while (true) {
      let changed = true;
      const roundStart = counters.passes;
      while (changed && counters.passes - roundStart < compiled.length + 2) {
        counters.passes++; changed = false;
        obligationCache.clear();
        refreshAccess(); counters.accessPasses++;
        const priorLock = effectiveSlayerLock;
        releaseForTargets(access);
        if (priorLock && !effectiveSlayerLock) { changed = true; refreshSlayerLevel(); }
        restrictSlayerMonsters(access, levels.Slayer, monster => boost('Slayer', { record: {}, rawLabel: `Kill X ~|${monster}|~` }));
        if (access !== ownAccess) restrictSlayerMonsters(ownAccess, levels.Slayer, monster => boost('Slayer', { record: {}, rawLabel: `Kill X ~|${monster}|~` }));
        for (const [name, source] of producedObjects) {
          access.objects.add(name); access.locations.set(`Object:${name}`, new Set(source.locations));
          if (source.own) { ownAccess.objects.add(name); ownAccess.locations.set(`Object:${name}`, new Set(source.locations.filter(ownLocation))); }
        }
        base = collectSources();
        if (!baseUnchanged) {
          markBaseSources();
          for (const name of base.items) if (!items.has(name)) { items.add(name); changed = true; }
          for (const [name, list] of base.sources) for (const source of list) addSource(name, source);
        }
        changed = updateSkills() || changed;
        changed = updatePoints() || changed;
        for (const task of uniqueTaskKeys ? validRows : compiled) if (uniqueTaskKeys || valid.has(task.key)) changed = materialize(task) || changed;
        counters.checks += blockedCheckCount;
        for (const task of checkableTasks) if ((!discoveryTasks || discoveryTasks.has(task)) && !valid.has(task.key) && (!processingTasks.has(task) || admitted.has(task.id)) && check(task).length === 0) {
          admitTask(task); changed = true;
          materialize(task);
        }
        for (const task of multiRows) if (!valid.has(task.key) && check(task).length === 0) changed = materialize(task, true) || changed;
        if (discoveryExpanded) { changed = true; discoveryExpanded = false; }
      }
      updatePoints();
      setWinners = new Map();
      for (const task of compiled) if (task.category === 'Extra' && task.record.Set && valid.has(task.key) && obligation(task)) {
        const previous = setWinners.get(task.record.Set);
        if (!previous || Number(task.record.Priority ?? Infinity) < Number(previous.record.Priority ?? Infinity)) setWinners.set(task.record.Set, task);
      }
      if (projectOnly) break;
      // Frontier discovery needs availability and declared recipe facts, not the
      // expensive public explanations, source provenance and equipment result.
      // Suspend here so only the stable replay builds that final projection.
      const checksBeforeSelection = counters.checks, dependenciesBeforeSelection = counters.dependencyChecks;
      const processingRows = [];
      for (const task of replay.fullDiscovery ? compiled : discoveryRows) {
        const blocked = valid.has(task.key) ? membershipByTask.get(task).length > 0 || f2p && task.record['Not F2P']
          : check(task).length > 0;
        const winner = setWinners.get(task.record.Set);
        const unavailable = blocked || task.category === 'Extra' && winner && winner.key !== task.key && valid.has(task.key);
        const personalCompleted = completedTask(task);
        if (!replay.fullDiscovery && unavailable && !personalCompleted
          && !(valid.has(task.key) && ['Nonskill', 'Farming'].includes(task.category))) continue;
        processingRows.push({ id: task.id, category: task.category, rawLabel: task.rawLabel, level: task.level, record: task.record,
          personalCompleted, processingPrimary: !unavailable && !!primaryEligible(task, true), status: unavailable ? 'blocked' : 'available' });
      }
      processing = selectProcessingSources(processingRows, [...items].map(name => ({ name, sources: sourceList(name) })),
        Object.fromEntries(Object.keys(skillCaps).map(skill => [skill, { passiveLevel: passive[skill], primary: trained.has(skill),
          manualPrimary: playerControls.primaryOverrides[skill] === true }])), rules, definitions,
        processingAccess(), ordinaryProcessingInput);
      // Public counters describe the final capability/explanation pass, as before.
      counters.checks = checksBeforeSelection;
      counters.dependencyChecks = dependenciesBeforeSelection;
      const continuation = yield processing;
      if (!continuation) break;
      admitted = continuation.admitted;
    }
    let disconnectedDetail;
    function disconnectedExplanation() {
      return disconnectedDetail ??= [...new Map(Object.values(connections?.byChunk ?? {}).filter(entry => !entry.connected).map(entry => [entry.ownerId, entry])).values()]
        .map(entry => ` ${entry.ownerName}'s chunks are not connected for ${member.name || memberId}: ${entry.reason}.`).join('');
    }
    const hideSkills = !on(rules, 'Skills', true), hideQuests = !on(rules, 'Quests', true),
      hideDiaries = !on(rules, 'Achievement', true), wholeQuests = on(rules, 'Show Quest Tasks Complete', false),
      smithingPrimary = on(rules, 'Smithing by Smelting', false) || access.objects.has('Anvil') || access.objects.has('Rusted anvil');
    const rows = compiled.map(task => {
      const blockers = valid.has(task.key) ? membershipByTask.get(task).slice() : check(task, true);
      if (valid.has(task.key) && f2p && task.record['Not F2P']) blockers.push({ kind: 'membership', detail: 'This activity requires membership.' });
      const record = task.record;
      const winner = setWinners.get(record.Set);
      if (task.category === 'Extra' && winner && winner.key !== task.key && valid.has(task.key)) blockers.push({ kind: 'outclassed', detail: `${winner.label} is the preferred reachable task in ${record.Set}.` });
      const taskSources = [];
      for (const requirement of task.requirements) {
        const names = requirement.alternatives ?? [requirement.clean];
        for (const name of names) {
          if (!(name === 'Monster[+]' ? access.monsters.size > 0 : requirementNameAvailable(requirement.field, name, task))) continue;
          if (requirement.field === 'Items') {
            for (const source of sourceList(name)) taskSources.push({ ...typeof source === 'object' ? source : { name: source }, item: name });
          } else taskSources.push({ kind: requirement.field.toLowerCase(), name,
            locations: [...(access.locations.get(`${requirement.field === 'Objects' ? 'Object' : requirement.field === 'NPCs' ? 'NPC' : requirement.field === 'Monsters' ? 'Monster' : 'Shop'}:${name}`) ?? [])]
              .filter(location => !task.sourceLocations.length || task.sourceLocations.filter(selector => selector.field === requirement.field && selector.name === name)
                .every(selector => selector.locations.includes(location))) });
        }
      }
      const filters = [];
      const own = obligation(task);
      if (!own) filters.push('This task is outside the member’s own reachable map; partner access is a convenience.');
      if (caps[task.category] && hideSkills) filters.push('Skills are hidden by the task rule.');
      if (task.category === 'Quest' && hideQuests) filters.push('Quests are hidden by the task rule.');
      if (task.category === 'Quest' && wholeQuests && record.QuestPoints === undefined && !record.ManualShow) filters.push('Quest tasks are configured to show whole completion tasks.');
      if (task.category === 'Diary' && hideDiaries) filters.push('Achievement tasks are hidden by the task rule.');
      const partnerTraining = [], partnerSupplies = [], partnerItemNeeds = [];
      for (const [skill, level] of task.presentationNeeds) if (level > passive[skill] && trained.has(skill) && !ownTraining.has(skill)) {
        partnerTraining.push(`${skill} training available via ${[...(trainingVia.get(skill) ?? [])].join(' and ')}'s connected chunks.`);
      }
      for (const requirement of task.itemRequirements) if (!ownRequirement(requirement, task, new Set(), false) && requirementAvailable(requirement, task)) {
        partnerSupplies.push(`${requirement.displayLabel} supplies available via connected partner chunks.`);
        // Share the proof already used above. An alias counts distinct choices,
        // never units; consumers need not recalculate task source policies.
        const names = requirement.alternatives ?? [requirement.clean];
        const needed = names.filter(name => hasItem(name, record, task.category) && !hasItem(name, record, task.category, true));
        partnerItemNeeds.push({ requirement: requirement.displayLabel, count: requirement.count,
          ownCount: names.filter(name => hasItem(name, record, task.category, true)).length,
          items: needed, sources: Object.fromEntries(needed.map(name => [name, sourceList(name)
            .filter(source => source.own === false && source.processingMode !== 'multi' && matchesItemSources([source], record, task.category, name))])) });
      }
      const explanation = blockers.length ? blockers.map(value => value.detail).join(' ') : taskSources.length ? 'You can reach the required locations, item sources, prerequisite tasks and training methods.' : completed.has(task.id) ? 'You recorded completing this task in-game.' : 'All listed requirements are met.';
      const sourceEligible = !processingTasks.has(task) || admitted.has(task.id) || completedTask(task);
      const row = { id: task.id, label: task.label, rawLabel: task.rawLabel, category: task.category, obligation: own, level: task.level, primary: !!record.Primary, ...(!sourceEligible && !blockers.length ? { sourceEligible: false } : {}), primaryMethod: !!primaryEligible(task, blockers.length > 0) && (task.category !== 'Smithing' || smithingPrimary), status: blockers.some(value => value.kind === 'unsupported') ? 'unsupported' : blockers.length ? 'blocked' : 'available', blockers, sources: taskSources, explanation: [explanation, ...partnerTraining, ...partnerSupplies, ...(!sourceEligible && !blockers.length ? ['You can make this recipe, but your processing rules exclude its products from available supplies and training.'] : [])].join(' '), personalCompleted: recordedCompleted.has(task.id), challengeSatisfied: challengeSatisfied(task.id), hidden: filters.length > 0, hiddenReasons: filters, wiki: task.wiki, baseQuest: record.BaseQuest, record };
      if (task.dialogueSupply) {
        row.dialogueSupply = structuredClone(task.dialogueSupply);
        row.explanation += ` Payment: ${dialoguePaymentText(task.dialogueSupply)}. ${dialogueSupplyNote}`;
      }
      const rewards = finiteRewardPreview(task.finiteRewards, { ...row, taskId: task.id });
      if (rewards.length) {
        row.finiteRewards = rewards;
        row.explanation += ` One-time completion reward: ${rewards.map(reward => `${reward.quantity} ${reward.item}`).join(', ')}. Held quantities are not tracked.`;
      }
      if (partnerItemNeeds.length) row.partnerItemNeeds = partnerItemNeeds;
      // Direct same-quest prerequisites retain supply evidence when the whole
      // completion row hides its steps. Alternative branches stay unexpanded.
      if (task.category === 'Quest' && record.BaseQuest) {
        const dependencyTaskIds = task.dependencies.filter(dependency => dependency.category === 'Quest' && !dependency.alias)
          .map(dependency => byKey.get(keyOf('Quest', dependency.clean.split('--')[0])))
          .filter(target => target && target.record.BaseQuest === record.BaseQuest).map(target => target.id);
        if (dependencyTaskIds.length) row.dependencyTaskIds = [...new Set(dependencyTaskIds)];
      }
      Object.defineProperty(row, 'processingPrimary', { value: !!primaryEligible(task, true) });
      return row;
    });
    const equipment = [];
    const houseStorage = evaluateHouseStorage({ rules, f2p, rows, items, sourceList, access, ownAccess, levels, caps, member, completed, challengeSatisfied });
    rows.push(...houseStorage.tasks);
    for (const [name, record] of Object.entries(definitions.equipment ?? {})) if (items.has(name) && !itemMembershipBlocker(name, f2p, definitions) && (!f2p || record.members !== true) && sourceList(name).some(source => source.processingMode !== 'multi' && (on(rules, 'Wield Crafted Items', false) || !(sourceType(source) === 'task' && PROCESSING.has(source.category)))) && Object.entries(record.requirements ?? {}).every(([skill, level]) => (levels[skill] ?? 1) >= level && (!f2p || level <= f2pCap(skill)))) equipment.push({ name, obligation: sourceList(name).some(source => source.processingMode !== 'multi' && ownSource(source) && (on(rules, 'Wield Crafted Items', false) || !(sourceType(source) === 'task' && PROCESSING.has(source.category)))), slot: record.slot, class: record.class, tier: Number(record.tier ?? 0), armour: Number(record.armour ?? 0), prayer: Number(record.prayer ?? 0), damage: Number(record.ability_damage ?? 0), accuracy: Number(record.accuracy ?? 0), sources: sourceList(name) });
    equipment.sort((a, b) => b.tier - a.tier || b.armour - a.armour || b.damage - a.damage || a.name.localeCompare(b.name));
    const diagnostics = [...compileDiagnostics, ...ruleDiagnostics, ...(access.diagnostics ?? []), ...(base.diagnostics ?? []), ...membershipDiagnostics];
    for (const rule of UNSUPPORTED_RULES) if (on(rules, rule, false)) diagnostics.push({ kind: 'unsupported-rule', rule, detail: `${rule} has no exact implementation.` });
    const unsupported = rows.filter(row => row.status === 'unsupported').length;
    const ownItemOrigins = ownItemQueries.filter(name => ownItemOrigin(name, null, new Set()));
    const serializedAccess = serializeAccess(access);
    processing = selectProcessingSources(rows, [...items].map(name => ({ name, sources: sourceList(name) })),
      Object.fromEntries(Object.keys(skillCaps).map(skill => [skill, { passiveLevel: passive[skill], primary: trained.has(skill),
        manualPrimary: playerControls.primaryOverrides[skill] === true }])), rules, definitions, serializedAccess, ordinaryProcessingInput);
    const result = { tasks: rows, houseStorage: { ...houseStorage, tasks: undefined }, playerControls, effectiveSlayerLock, slayerLockRelease, access: serializedAccess, obligationAccess: serializeAccess(ownAccess), ownItems: [...ownItems].sort(), ownItemOrigins, partnerConnections: connections ?? { regions: [], byChunk: {} }, items: [...items].sort().map(name => ({ name, sources: sourceList(name) })), equipment, training: Object.fromEntries(Object.keys(skillCaps).map(skill => [skill, { level: levels[skill], cap: caps[skill], primary: trained.has(skill), passiveLevel: passive[skill], viaPartners: ownTraining.has(skill) ? [] : [...(trainingVia.get(skill) ?? [])], primaryOverride: playerControls.primaryOverrides[skill] ?? null, manualPrimary: playerControls.primaryOverrides[skill] === true, passiveOverride: playerControls.passiveLevels[skill] ?? null, maxOverride: playerControls.maxLevels[skill] ?? null, observedLevel: observedProgress[skill]?.level ?? null, observedXp: observedProgress[skill]?.xp ?? null, observedSource: observedProgress[skill]?.source ?? null, observedFetchedAt: observedProgress[skill]?.fetchedAt ?? null, observedRunescapeName: observedProgress[skill]?.runescapeName ?? null, observedCapabilityLevel: observedProgress[skill] ? Math.min(observedProgress[skill].level, caps[skill]) : null }])), points, metrics: { ...counters, elapsedMs: performance.now() - started, catalogueCount: compiled.length, availableCount: rows.filter(row => row.status === 'available' && row.obligation).length, unsupportedCount: unsupported }, diagnostics, coverage: { declaredTasks: compiled.length, supportedTasks: compiled.length - unsupported, unsupportedTasks: unsupported, supportedFields: [...KNOWN].filter(field => !['Categories', 'OutputVar'].includes(field)), unsupportedFields: ['Categories', 'OutputVar'], unsupportedRules: UNSUPPORTED_RULES, limitations: ['Some original highest-level task links and Best in Slot comparisons are still incomplete.', 'Some optional XP choices and special item sources are still incomplete. Tasks with unsupported requirements or unidentified sources are excluded.'] } };
    Object.defineProperty(result, 'processing', { value: processing });
    result.finiteRewards = rows.flatMap(row => row.finiteRewards ?? []);
    replay.finalizations++;
    Object.defineProperties(result.metrics, { processingAccessEvaluations: { value: replay.accessEvaluations },
      processingBaseCollections: { value: replay.baseCollections }, processingFinalizations: { value: replay.finalizations },
      processingIncrementalPasses: { value: replay.incrementalPasses }, processingFallbacks: { value: replay.fullDiscovery ? 1 : 0 },
      processingRawAccessEvaluations: { value: replay.rawAccessEvaluations } });
    return result;
  }
  function computeEligibility(state, memberId, options) {
    const started = performance.now();
    prepareEvaluation();
    // Immutable replay caches are confined to one evaluation. Ordinary growth
    // resumes discovery; full, retracted and mode-changing closures start fresh.
    const replay = { access: [], rawAccess: new Map(), transportMemo: {}, surfaceEligibility: new WeakMap(), spatialFailures: new WeakMap(), base: new Map(), baseOwnership: new WeakMap(), expansions: new Map(), accessEvaluations: 0, rawAccessEvaluations: 0, baseCollections: 0,
      incrementalPasses: 0, finalizations: 0 };
    const memberItems = new Map(), memberSources = new Map(), accessSources = new Map();
    replay.membership = {
      accessSource(kind, name, location, f2p) {
        if (!f2p) return null;
        let names = accessSources.get(kind);
        if (!names) accessSources.set(kind, names = new Map());
        if (!names.has(name)) names.set(name, locationSensitiveMembership.has(`${kind}\u0000${name}`) ? new Map()
          : membershipSourceBlocker(kind, name, undefined, f2p) ?? evaluateSourceMembership(kind, name, f2p));
        const locations = names.get(name);
        if (!(locations instanceof Map)) return locations;
        if (!locations.has(location)) locations.set(location,
          membershipSourceBlocker(kind, name, location, f2p) ?? evaluateSourceMembership(kind, name, f2p));
        return locations.get(location);
      },
      item(name, f2p, definitions) {
        if (!f2p) return null;
        let cache = memberItems.get(definitions);
        if (!cache) { cache = new Map(); memberItems.set(definitions, cache); }
        if (!cache.has(name)) cache.set(name, evaluateItemMembership(name, f2p, definitions));
        return cache.get(name);
      },
      source(kind, name, f2p, category) {
        if (!f2p) return null;
        // Task membership is already prepared once per invocation; its unique
        // catalogue labels cannot benefit from a second lookup cache.
        if (kind === 'Task') return evaluateSourceMembership(kind, name, f2p, category);
        let categories = memberSources.get(kind);
        if (!categories) { categories = new Map(); memberSources.set(kind, categories); }
        let names = categories.get(category);
        if (!names) { names = new Map(); categories.set(category, names); }
        if (!names.has(name)) names.set(name, evaluateSourceMembership(kind, name, f2p, category));
        return names.get(name);
      },
    };
    let admitted = new Set(), multiAdmitted = new Set(), result;
    const seen = new Map();
    let evaluation = evaluatePass(state, memberId, options, admitted, multiAdmitted, replay);
    let processing = evaluation.next().value;
    let retainedClosure = false;
    function restartFullDiscovery() {
      replay.fullDiscovery = true;
      admitted = new Set(); multiAdmitted = new Set(); seen.clear();
      retainedClosure = false;
      evaluation = evaluatePass(state, memberId, options, admitted, multiAdmitted, replay);
      processing = evaluation.next().value;
    }
    for (let pass = 0; pass <= recipeIds.size + 2; pass++) {
      const next = new Set(processing.eligibleTaskIds.filter(id => recipeIds.has(id)));
      const nextMulti = new Set(processing.multiTaskIds.filter(id => recipeIds.has(id)));
      const signature = JSON.stringify([[...next].sort(), [...nextMulti].sort()]);
      if (next.size === admitted.size && [...next].every(id => admitted.has(id)) && nextMulti.size === multiAdmitted.size && [...nextMulti].every(id => multiAdmitted.has(id))) {
        if (!replay.fullDiscovery || retainedClosure) {
          // Discovery can retain monotone facts, but public source ordering,
          // partner training and Slayer release provenance follow a fresh pass.
          evaluation = evaluatePass(state, memberId, options, admitted, multiAdmitted, replay, true);
        }
        result = evaluation.next().value;
        const finalAdmitted = new Set(result.processing.eligibleTaskIds.filter(id => recipeIds.has(id)));
        const finalMulti = new Set(result.processing.multiTaskIds.filter(id => recipeIds.has(id)));
        if (!replay.fullDiscovery && (finalAdmitted.size !== admitted.size || [...finalAdmitted].some(id => !admitted.has(id))
          || finalMulti.size !== multiAdmitted.size || [...finalMulti].some(id => !multiAdmitted.has(id)))) {
          // A custom graph may invalidate the narrower monotone discovery.
          // Restart with the original full staged closure and an independent
          // bounded cycle search; only immutable replay memo entries survive.
          restartFullDiscovery();
          pass = -1;
          continue;
        }
        Object.defineProperty(result.metrics, 'processingPasses', { value: pass + 1, configurable: true });
        result.metrics.elapsedMs = performance.now() - started;
        result.diagnostics.push(...result.processing.diagnostics);
        return result;
      }
      if (seen.has(signature)) {
        if (!replay.fullDiscovery) {
          restartFullDiscovery();
          pass = -1;
          continue;
        }
        // Circular competing recipes must not manufacture their own source.
        // Retain only admissions shared by the cycle and replay once, failing
        // closed for the disputed sources while preserving independent roots.
        const cycle = [...seen.values()].slice(seen.get(signature).index).map(entry => entry.ids);
        const common = new Set([...next].filter(id => cycle.every(ids => ids.has(id))));
        const finalEvaluation = evaluatePass(state, memberId, options, common, new Set(), replay, true);
        result = finalEvaluation.next().value;
        result.diagnostics.push({ kind: 'processing-source-cycle', detail: 'Competing circular recipes did not stabilize; disputed output sources were excluded.' });
        Object.defineProperty(result.metrics, 'processingPasses', { value: pass + 2 });
        result.metrics.elapsedMs = performance.now() - started;
        result.diagnostics.push(...result.processing.diagnostics);
        return result;
      }
      if (pass === recipeIds.size + 2 && !replay.fullDiscovery) {
        restartFullDiscovery();
        pass = -1;
        continue;
      }
      seen.set(signature, { index: seen.size, ids: next });
      const grows = !replay.fullDiscovery && [...admitted].every(id => next.has(id)) && nextMulti.size === multiAdmitted.size
        && [...nextMulti].every(id => multiAdmitted.has(id));
      admitted = next;
      multiAdmitted = nextMulti;
      if (grows) {
        replay.incrementalPasses++;
        retainedClosure = true;
        processing = evaluation.next({ admitted }).value;
      } else {
        evaluation = evaluatePass(state, memberId, options, admitted, multiAdmitted, replay);
        retainedClosure = false;
        processing = evaluation.next().value;
      }
    }
    // Each ordinary source chain converges within its recipe count. A custom
    // oscillating catalogue cannot silently publish a speculative last pass.
    const finalEvaluation = evaluatePass(state, memberId, options, new Set(), new Set(), replay, true);
    result = finalEvaluation.next().value;
    result.diagnostics.push({ kind: 'processing-source-limit', detail: 'Processing source selection exceeded its bounded passes; recipe outputs were excluded.' });
    result.metrics.elapsedMs = performance.now() - started;
    return result;
  }
  const eligibilityCache = createEligibilityCache();
  function evaluate(state, memberId, options) {
    state = { ...state, members: state.members.map(owner => projectMemberTaskFacts(state, owner, catalogue)) };
    return eligibilityCache.evaluate(state, memberId, options, () => computeEligibility(state, memberId, options));
  }
  return Object.freeze({ catalogue, prepare: prepareEvaluation, evaluate });
}
