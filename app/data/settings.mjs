import { datasetValue, datasetRuleDefinitions, datasetRuleRecords } from "../dataset-runtime.mjs";
import { futureSlayerUnlocksRule, FUTURE_SLAYER_UNLOCKS_RULE } from './slayer-unlock-gates.mjs';
export const EARLY_TRAVEL_UNLOCKS_RULE = 'Early Travel Unlocks';
export const earlyTravelUnlocksRule = Object.freeze({
  id: EARLY_TRAVEL_UNLOCKS_RULE, label: EARLY_TRAVEL_UNLOCKS_RULE,
  description: 'Travel and reward unlocks can be chunk tasks before you can use them',
  type: 'boolean', default: false, category: 'Miscellaneous',
  difficultyMarker: 'extreme-supreme',
});
export const earlyTravelUnlocksExplanation = {
  what: earlyTravelUnlocksRule.description,
  example: 'With this off, balloon routes wait until you can reach Entrana. Cannon upgrades wait until a cannon is available.',
  grindWarning: 'Turning this on can add rewards you cannot use yet. Furniture still needs its recipe requirements.',
  sources: [
    { title: 'Balloon transport system', url: 'https://runescape.wiki/w/Balloon_transport_system?oldid=36927642' },
    { title: 'Furniture plans', url: 'https://runescape.wiki/w/Furniture_plans?oldid=37180541' },
    { title: 'Dwarf multicannon', url: 'https://runescape.wiki/w/Dwarf_multicannon?oldid=37197227' },
  ],
};

// Declarative metadata extracted from retained upstream index.js v6.9.68.
// Never execute upstream scripts or copy these defaults over imported player rules.
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export const originalSettings = datasetValue("app/data/settings.mjs#originalSettings");

export const originalSettingDescriptions = datasetValue("app/data/settings.mjs#originalSettingDescriptions");

export const originalSettingStructure = datasetValue("app/data/settings.mjs#originalSettingStructure");

export const originalRuleDefaults = datasetValue("app/data/settings.mjs#originalRuleDefaults");

export const originalRuleDescriptions = datasetValue("app/data/settings.mjs#originalRuleDescriptions");

export const originalRuleStructure = datasetValue("app/data/settings.mjs#originalRuleStructure");

export const originalRulePresets = datasetValue("app/data/settings.mjs#originalRulePresets");

export const originalRuleSubDefaults = datasetValue("app/data/settings.mjs#originalRuleSubDefaults");

export const originalTaskGeneratingRules = datasetValue("app/data/settings.mjs#originalTaskGeneratingRules");

export const originalSettingConflicts = datasetValue("app/data/settings.mjs#originalSettingConflicts");

const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').trim();
function positions(structure) {
 const result = new Map();
 for (const [category, entries] of Object.entries(structure)) for (const [id, children] of Object.entries(entries)) {
  result.set(id, { category, parent: null });
  if (Array.isArray(children)) for (const child of children) result.set(child, { category, parent: id });
 }
 return result;
}
const settingPositions = positions(originalSettingStructure);
const settingLabels = datasetValue("app/data/settings.mjs#settingLabels");
export const settingDefinitions = datasetRuleDefinitions("app/data/settings.mjs#settingDefinitions");
export const taskHowPreference = Object.freeze({ id: 'showTaskHow', label: 'Show How?', type: 'boolean', default: true });
export const authoredSettingDefinitions = Object.freeze([...datasetRuleDefinitions("app/data/settings.mjs#authoredSettingDefinitions"), taskHowPreference]);
const rulePositions = positions(originalRuleStructure);
const authoredTaskRules = datasetRuleRecords("app/data/settings.mjs#authoredTaskRules");
export const taskRuleDefinitions = Object.freeze([...datasetRuleDefinitions("app/data/settings.mjs#taskRuleDefinitions"), futureSlayerUnlocksRule, earlyTravelUnlocksRule]);
// Cutoff inputs are configuration even while their switch is off. KeyItem
// Bosses deliberately sits outside Rare Drop's polarity (and is currently inert).
export const independentTaskRuleControls = new Set([
 'Rare Drop Amount', 'Rare Drop Inclusive', 'Secondary Primary Amount',
 'Secondary Primary Inclusive', 'Kill X Amount', 'KeyItem Bosses',
]);
export const taskRuleParents = Object.freeze(Object.fromEntries(taskRuleDefinitions
 .filter(rule => rule.parent && !independentTaskRuleControls.has(rule.id))
 .map(rule => [rule.id, rule.parent])));
// Worker cutoff aliases and presentation aliases are also known task rules.
export const taskRuleCutoffDefaults = datasetValue("app/data/settings.mjs#taskRuleCutoffDefaults");
const taskRuleTypes = new Map([...taskRuleDefinitions.map(rule => [rule.id, rule.type]), ...['Skills', 'Quests', 'Quest Complete', 'BIS', 'BIS Prayer', 'Relics', 'Show Nonskill Tasks'].map(id => [id, 'boolean'])]);
const cutoffNumber = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

// Return an access-compatible rate without changing the stored value. Bare
// amounts are positive denominators; zero is the include-everything sentinel.
export function taskRuleCutoff(value) {
 if (typeof value !== 'string' && typeof value !== 'number') return null;
 const rate = String(value).trim().replaceAll('~', '');
 if (rate === 'Always') return '1/1';
 if (rate === '1/0') return rate;
 const parts = rate.split('/').map(part => part.trim());
 if (!parts.every(part => cutoffNumber.test(part))) return null;
 const numbers = parts.map(Number);
 if (!numbers.every(Number.isFinite)) return null;
 if (numbers.length === 1) {
  const number = numbers[0];
  if (number === 0) return /^\+?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(parts[0]) ? '1/0' : null;
  const probability = 1 / number;
  return Number.isFinite(probability) && probability > 0 ? `${probability}/1` : null;
 }
 const probability = numbers.slice(1).reduce((value, denominator) => value / denominator, numbers[0]);
 return numbers.every(number => number > 0) && Number.isFinite(probability) && probability > 0 && probability <= 1 ? `${probability}/1` : null;
}

export function taskRuleValueError(id, value) {
 if (Object.hasOwn(taskRuleCutoffDefaults, id)) return taskRuleCutoff(value) === null ? `Task rule ${id} must be an explicit probability a/b in (0, 1], a positive denominator (bare amounts always mean 1/X), or the documented zero sentinel.` : null;
 if (id === 'Kill X Amount') {
  const number = typeof value === 'number' ? value : typeof value === 'string' && cutoffNumber.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? null : `Task rule ${id} must be a positive safe integer.`;
 }
 return taskRuleTypes.get(id) === 'boolean' && typeof value !== 'boolean' ? `Task rule ${id} must be boolean.` : null;
}

export function taskRuleDiagnostics(rules = {}, context = {}) {
 return Object.entries(rules ?? {}).flatMap(([ruleId, value]) => {
  const error = taskRuleValueError(ruleId, value);
  return error ? [{ code: 'invalid-task-rule', ...context, ruleId, value, detail: `${error} The saved value is preserved for review; evaluation uses the rule default${Object.hasOwn(taskRuleCutoffDefaults, ruleId) ? ` (${taskRuleCutoffDefaults[ruleId]})` : ''}.` }] : [];
 });
}

export const neighborSettingDefinitions = datasetRuleDefinitions("app/data/settings.mjs#neighborSettingDefinitions");

// Direct literal references are location evidence, not proof of full behavior parity.
export const originalRuleReferences = datasetValue("app/data/settings.mjs#originalRuleReferences");

export const taskRuleCategoryCounts = datasetValue("app/data/settings.mjs#taskRuleCategoryCounts");

// Behavior coverage is scoped to authored modules, and does not assert upstream parity.
const explicitRuleBehavior = datasetValue("app/data/settings.mjs#explicitRuleBehavior");
const partialRuleBehavior = datasetValue("app/data/settings.mjs#partialRuleBehavior");
const missingGeneratedBehavior = datasetValue("app/data/settings.mjs#missingGeneratedBehavior");
const retainedRuleBehavior = datasetValue("app/data/settings.mjs#retainedRuleBehavior");
/** A category gate can change availability for authored declared rows without
 * recreating special source-generation, ranking, or UI behavior from upstream.
 * Never use original defaults as effective imported values: absence is inheritance.
 */
export function taskRuleBehavior(id) {
 if (id === EARLY_TRAVEL_UNLOCKS_RULE) return { status: 'implemented-scope', detail: 'Lets travel and cannon rewards appear early. Furniture keeps its recipe requirements.' };
 if (id === FUTURE_SLAYER_UNLOCKS_RULE) return { status: 'implemented-scope', detail: 'Includes eight Slayer Rewards before their monster, area or item is available.' };
 if (id === 'PvM Relics') return { status: 'no-effect-dataset', detail: 'No effect with the current dataset: no combat-relic goals are declared. Which combat relics should count has not been defined.' };
 if (id === 'All Droptables Nest') return { status: 'no-effect-dataset', detail: 'No effect with the current dataset: it has no matching nest-loot task. Custom inputs need both a matching loot task and an obtainable nest supply route.' };
 if (id === 'KeyItem Bosses') return { status: 'retained-only', detail: 'No effect: entry-key rarity is not included in boss drop cutoffs or time estimates. How keys should count has not been defined.' };
 if (id === 'Skiller') return { status: 'partial', detail: 'Excludes monster drops, kill-count goals and explicitly unsuitable tasks. Combat-level goals can still appear; this does not guarantee a level-3 or combat-free account.' };
 if (partialRuleBehavior[id]) return { status: 'partial', detail: partialRuleBehavior[id] };
 if (explicitRuleBehavior[id]) return { status: 'implemented-scope', detail: explicitRuleBehavior[id] };
 if (missingGeneratedBehavior[id]) return { status: 'not-implemented', detail: missingGeneratedBehavior[id] };
 if (taskRuleCategoryCounts[id]) return { status: 'category-gate', detail: 'Controls ' + taskRuleCategoryCounts[id] + ' listed tasks in this group. Some original item-source and comparison rules are not yet supported.' };
 if (retainedRuleBehavior[id]) return { status: 'retained-only', detail: retainedRuleBehavior[id] };
 return { status: 'retained-only', detail: 'Saved for compatibility with the original picker. No matching tasks or supported effect were found.' };
}

// Worker input names are inventory only; authored code does not execute worker.js.
export const originalWorkerInputNames = datasetValue("app/data/settings.mjs#originalWorkerInputNames");
