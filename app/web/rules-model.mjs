import { datasetJSON } from "../dataset-runtime.mjs";
const capturedCatalogue = await datasetJSON("app/data/original-rules-ui.2026-10-08.v1.json");
import { ANCIENT_EFFIGIES_RULE, taskRuleDefinitions, taskRuleCutoffDefaults, independentTaskRuleControls, EARLY_TRAVEL_UNLOCKS_RULE, earlyTravelUnlocksExplanation } from '../data/settings.mjs';
import { hasGameplayMigration } from '../tasks/gameplay-compat.mjs';
import { isKeptTaskRule } from './kept-rules.mjs';
import { taskRuleDefault } from '../tasks/rule-defaults.mjs';
import { loadRuleExplanations } from './rule-explanations.mjs';
import { UNKNOWN_DROP_RULE, unknownDropExplanation } from '../data/settings.mjs';
import { FUTURE_SLAYER_UNLOCKS_RULE, futureSlayerUnlocksExplanation } from '../data/slayer-unlock-gates.mjs';

const own = (record, key) => Object.hasOwn(record ?? {}, key);
const text = value => String(value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();

/** Validate the captured presentation inventory; never execute upstream code. */
export function loadRulesCatalogue(raw) {
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.sections) || !Array.isArray(raw.rules) || !Array.isArray(raw.presets)) throw new TypeError('Invalid rules catalogue.');
  const keys = new Set();
  for (const rule of raw.rules) {
    if (typeof rule.key !== 'string' || !rule.key || keys.has(rule.key)) throw new TypeError('Duplicate or invalid catalogue rule.');
    keys.add(rule.key);
  }
  const sections = new Set();
  for (const section of raw.sections) {
    if (typeof section.name !== 'string' || !section.id || sections.has(section.id) || !Array.isArray(section.rows)) throw new TypeError('Invalid catalogue section.');
    sections.add(section.id);
    const rowKeys = new Set();
    for (const row of section.rows) {
      if (!keys.has(row.key) || rowKeys.has(row.key)) throw new TypeError(`Unknown or duplicate section rule: ${row.key}`);
      rowKeys.add(row.key);
      const canonical = raw.rules.find(rule => rule.key === row.key);
      if ((row.parentKey ?? null) !== (canonical.parentKey ?? null) || row.depth !== canonical.depth) throw new TypeError(`Inconsistent section hierarchy: ${row.key}`);
    }
  }
  for (const rule of raw.rules) if (rule.parentKey && !keys.has(rule.parentKey)) throw new TypeError(`Unknown parent: ${rule.parentKey}`);
  for (const rule of raw.rules) {
    const seen = new Set([rule.key]); let parent = rule.parentKey;
    while (parent) {
      if (seen.has(parent)) throw new TypeError('Cyclic catalogue hierarchy.');
      seen.add(parent); parent = raw.rules.find(row => row.key === parent)?.parentKey;
    }
  }
  for (const preset of raw.presets) if (!preset.name || !preset.values || typeof preset.values !== 'object' || Array.isArray(preset.values)) throw new TypeError('Invalid catalogue preset.');
  return raw;
}

export const rulesCatalogue = loadRulesCatalogue(capturedCatalogue);
if (rulesCatalogue.explanationsFile && !/^app\/data\/[a-z0-9.-]+\.json$/.test(rulesCatalogue.explanationsFile)) throw new TypeError('Invalid rule explanations path.');
const selectedRuleExplanations = rulesCatalogue.explanationsFile
  ? loadRuleExplanations(await datasetJSON(rulesCatalogue.explanationsFile)) : {};
const tertiaryExplanation = selectedRuleExplanations['Universal Tertiary'];
// Carry forward the existing effigy revision credit. This split changes rule
// behavior and introduces no new Wiki facts.
const effigySources = tertiaryExplanation?.sources.filter(source => source.title === 'Starved ancient effigy') ?? [];
export const ruleExplanations = Object.freeze({
  ...selectedRuleExplanations,
  ...(effigySources.length ? loadRuleExplanations({ schemaVersion: 1, entries: {
    'Universal Tertiary': { ...tertiaryExplanation, sources: tertiaryExplanation.sources.filter(source => !effigySources.includes(source)) },
    [ANCIENT_EFFIGIES_RULE]: {
      what: 'Lets ancient effigy drops count towards chunk tasks. Other requirements still apply.',
      example: 'Turn this off to exclude ancient effigy drops while keeping mimic tokens and spirit gems on.',
      sources: effigySources,
    },
  } }) : {}),
  ...loadRuleExplanations({ schemaVersion: 1, entries: { [FUTURE_SLAYER_UNLOCKS_RULE]: futureSlayerUnlocksExplanation, [UNKNOWN_DROP_RULE]: unknownDropExplanation, [EARLY_TRAVEL_UNLOCKS_RULE]: earlyTravelUnlocksExplanation } }),
});

/** Original copy and order are presentation data; current types stay registry-owned. */
export function buildRulesSections(catalogue, state, sharedDefinitions = []) {
  const definitions = new Map(taskRuleDefinitions.map(rule => [rule.id, rule])), seen = new Set();
  const sections = catalogue.sections.map(section => ({ id: section.id, name: section.name, scope: 'personal', rules: section.rows.map(row => {
    seen.add(row.key);
    const definition = definitions.get(row.key) ?? { id: row.key, label: row.label, type: 'boolean' };
    return { ...definition, label: row.key === 'Achievement' ? 'Show Achievement Tasks' : row.key === 'Rare Drop' ? 'Include drops rarer than my cutoff' : row.label ?? row.key,
      description: row.key === 'Universal Tertiary' ? definition.description : row.key === 'Rare Drop' ? 'On includes all drop rates. Off applies Rare Drop Amount and Rare Drop Inclusive; unknown rates remain included.' : row.descriptionText ?? text(row.descriptionHtml), tooltips: (row.tooltips ?? []).map(tooltip => text(tooltip.descriptionHtml)), currentDescription: definition.description, original: true,
      parent: row.parentKey ?? null, depth: row.depth ?? (row.parentKey ? 1 : 0), control: row.control,
      difficultyMarker: row.difficultyMarker,
      ...(row.key === 'F2P' ? { sharedRuleId: 'content.f2p', scope: 'shared' } : {}) };
  }) }));
  // Authored additions join their original parent, without modifying retained metadata.
  const presentationParents = { [UNKNOWN_DROP_RULE]: 'Rare Drop Amount', 'Rare Drop Inclusive': 'Rare Drop Amount', 'Secondary Primary Inclusive': 'Secondary Primary Amount' };
  for (const original of taskRuleDefinitions.filter(rule => !seen.has(rule.id))) {
    const definition = { ...original, parent: presentationParents[original.id] ?? original.parent };
    const section = definition.parent && sections.find(group => group.rules.some(rule => rule.id === definition.parent));
    if (section) {
      const index = section.rules.findIndex(rule => rule.id === definition.parent);
      let end = index + 1;
      while (end < section.rules.length && section.rules[end].parent === definition.parent) end++;
      section.rules.splice(end, 0, { ...definition, depth: (section.rules[index].depth ?? 0) + 1, original: false }); seen.add(definition.id);
    }
  }
  const itemSources = sections.find(section => section.rules.some(rule => rule.id === 'Universal Tertiary'));
  if (itemSources && definitions.has(ANCIENT_EFFIGIES_RULE)) {
    const index = itemSources.rules.findIndex(rule => rule.id === 'Universal Tertiary');
    itemSources.rules.splice(index + 1, 0, { ...definitions.get(ANCIENT_EFFIGIES_RULE), depth: 0, original: false });
    seen.add(ANCIENT_EFFIGIES_RULE);
  }
  const extra = taskRuleDefinitions.filter(rule => !seen.has(rule.id)).map(rule => ({ ...rule, depth: 0, original: false }));
  for (const member of state.members ?? []) for (const [id, value] of Object.entries(member.taskRules ?? {})) {
    if (!definitions.has(id) && !extra.some(rule => rule.id === id)) extra.push({ id, label: id, type: typeof value === 'boolean' ? 'boolean' : 'string', description: 'An older rule kept in this save.', depth: 0, original: false });
  }
  if (extra.length) sections.push({ id: 'additional-rules', name: 'Additional and older rules', scope: 'personal', rules: extra });
  const shared = sharedDefinitions.filter(rule => rule.id !== 'content.f2p').map(rule => ({ ...rule, depth: 0, scope: 'shared', sharedRuleId: rule.id }));
  if (shared.length) sections.push({ id: 'shared-map-rules', name: 'Shared map & access', scope: 'shared', rules: shared });
  return sections.map(section => ({ ...section, rules: section.rules.map(rule => ({ ...rule,
    explanation: Object.hasOwn(ruleExplanations, rule.id) ? ruleExplanations[rule.id] : undefined })) }));
}

/** Absence means automatic, not a copy of the original picker's defaults. */
export function taskRuleValue(state, memberId, definition) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError('Unknown rules player.');
  const id = definition.id;
  if (own(member.taskRules, id)) return { value: member.taskRules[id], source: 'Personal override', explicit: true };
  return taskRuleAutomaticValue(state, memberId, definition);
}

/** The value revealed by clearing this player's override, without mutating state. */
export function taskRuleAutomaticValue(state, memberId, definition) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError('Unknown rules player.');
  const id = definition.id;
  if (own(state.taskRules, id)) return { value: state.taskRules[id], source: 'Inherited', explicit: false };
  const inherited = !hasGameplayMigration(state, member) && state.legacy?.maps?.[member.sourceMapId]?.rules;
  if (own(inherited, id)) return { value: inherited[id], source: 'Imported', explicit: false };
  return { value: taskRuleDefault(id), source: 'Automatic', explicit: false };
}

export function ruleEnabled(definition, values, definitions) {
  if (independentTaskRuleControls.has(definition.id)) return true;
  let parent = definition.parent;
  while (parent) {
    if ([false, 'false', 0].includes(values.get(parent))) return false;
    parent = definitions.find(rule => rule.id === parent)?.parent;
  }
  return true;
}

export function filterRulesSections(sections, values, { query = '', onlyOn = false } = {}) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sections.flatMap(section => {
    const matches = new Set(section.rules.filter(rule => words.every(word => `${rule.label} ${rule.id} ${rule.description} ${rule.explanation?.what ?? ''} ${rule.explanation?.example ?? ''} ${rule.explanation?.grindWarning ?? ''} ${section.name}`.toLowerCase().includes(word)) && (!onlyOn || values.get(rule.id) === true)).map(rule => rule.id));
    const visible = new Set(matches);
    for (const id of matches) {
      let parent = section.rules.find(rule => rule.id === id)?.parent;
      while (parent) { visible.add(parent); parent = section.rules.find(rule => rule.id === parent)?.parent; }
    }
    const rules = section.rules.filter(rule => visible.has(rule.id)).map(rule => ({ ...rule, contextOnly: !matches.has(rule.id) }));
    return rules.length ? [{ ...section, rules }] : [];
  });
}

function personalChanges(state, memberIds, values) {
  return memberIds.flatMap(memberId => {
    const member = state.members.find(owner => owner.id === memberId);
    if (!member) throw new TypeError('Unknown rules player.');
    return Object.entries(values).flatMap(([ruleId, after]) => {
      const before = taskRuleValue(state, memberId, { id: ruleId });
      return before.explicit && Object.is(before.value, after) ? [] : [{ memberId, memberName: member.name, ruleId, before: before.value, beforeSource: before.source, after }];
    });
  });
}

export function profileCommands(state, memberIds, values, sharedRules = state.rules) {
  return memberIds.map(memberId => ({ type: 'set-profile', memberId, rules: { ...sharedRules }, taskRules: { ...state.members.find(member => member.id === memberId).taskRules, ...values } }));
}

/** UI cascades retain child overrides while their parent's control is off. */
export function planTaskRuleChange(state, memberIds, definition, value, catalogue = rulesCatalogue) {
  const changes = [], commands = [];
  for (const memberId of memberIds) {
    const values = { [definition.id]: value };
    if (value === true && catalogue.cascade.enableAllChildrenParents.includes(definition.id)) {
      for (const child of catalogue.rules.filter(rule => rule.parentKey === definition.id)) {
        const saved = taskRuleValue(state, memberId, { id: child.key });
        if (saved.source === 'Automatic' && saved.value === undefined && catalogue.cascade.enableDefaults[child.key] === true) values[child.key] = true;
      }
    }
    const memberChanges = personalChanges(state, [memberId], values);
    changes.push(...memberChanges);
    if (memberChanges.length) commands.push(Object.keys(values).length === 1
      ? { type: 'set-task-rule', memberId, ruleId: definition.id, value }
      : profileCommands(state, [memberId], values)[0]);
  }
  return { changes, commands };
}

export function reviewPreset(state, memberIds, preset, catalogue = rulesCatalogue) {
  if (!catalogue.presets.some(row => row.name === preset.name)) throw new TypeError('Unknown rules preset.');
  // Upstream presets use key membership, not raw truthiness. The Supreme
  // array is source metadata, not a valid value for a boolean task rule.
  const values = Object.fromEntries(catalogue.rules.filter(rule => !isKeptTaskRule(rule.key)).map(rule => [rule.key,
    catalogue.inputs.numeric.some(input => input.key === rule.key)
      ? String(preset.values[rule.key] ?? (rule.key === 'Kill X Amount' ? '1' : '0'))
      : own(preset.values, rule.key)]));
  const sharedRules = { ...state.rules }, changes = [];
  // F2P has one authoritative, shared control in this app.
  if (own(values, 'F2P')) {
    const after = values.F2P, before = state.rules?.['content.f2p'] ?? true;
    if (before !== after) changes.push({ memberName: 'Both players', ruleId: 'F2P', before, after, shared: true });
    sharedRules['content.f2p'] = after; delete values.F2P;
  }
  changes.push(...personalChanges(state, memberIds, values));
  return { name: preset.name, revision: state.revision, memberIds: [...memberIds], changes, commands: changes.length ? profileCommands(state, memberIds, values, sharedRules) : [] };
}
