import { taskRuleCutoffDefaults, taskRuleCategoryCounts, taskRuleParents, EARLY_TRAVEL_UNLOCKS_RULE } from '../data/settings.mjs';
import { FUTURE_SLAYER_UNLOCKS_RULE } from '../data/slayer-unlock-gates.mjs';

// Authored unset behavior, independent of captured upstream defaults or save
// payloads. Literal fallbacks in engine/presentation are checked against this
// contract by automatic-rule-defaults.test.mjs. Unknown category tags default on.
export const taskRuleBooleanDefaults = Object.freeze({
  [FUTURE_SLAYER_UNLOCKS_RULE]: false,
  [EARLY_TRAVEL_UNLOCKS_RULE]: false,
  // F2P is normalized from shared content.f2p, whose unset value is true.
  F2P: true, Skills: true, Quests: true, Achievement: true, Extra: true,
  Attack: true, Strength: true, Defence: true, Constitution: true, Ranged: true,
  Prayer: true, Magic: true, Cooking: true, Woodcutting: true, Fletching: true,
  Fishing: true, Firemaking: true, Crafting: true, Smithing: true, Mining: true,
  Herblore: true, Agility: true, Thieving: true, Slayer: true, Farming: true,
  Runecrafting: true, Hunter: true, Construction: true, Summoning: true,
  Dungeoneering: true, Divination: true, Invention: true, Archaeology: true, Necromancy: true,
  'Show Skill Tasks': true, 'Show Quest Tasks': true,
  'Show Best in Slot Tasks': true, 'Show Best in Slot Prayer Tasks': true,
  BIS: true, 'BIS Prayer': true, 'BIS Skilling': true, 'BIS Skilling Relics': true, 'PvM Relics': true,
  'Non-permanent BiS': true, 'Cleaning Herbs': true, 'Shortcut Task': true,
  InsidePOH: true, 'Primary Spawns': true, 'Rare Drop': true,
  Boss: true, Minigame: true, 'Puro-Puro': true,
  Boosting: false, Skiller: false, 'Farming Primary': false,
  'Wield Crafted Items': false, 'Multi Step Processing': false,
  'Secondary Primary': false, 'Smithing by Smelting': false,
  'Show Diary Tasks Any': false, 'Show Quest Tasks Complete': false,
  'Show Diary Tasks Complete': false, 'Show Nonskill Tasks': false,
  'Hide Partial Products': false, 'Consumable Primary BiS': false,
  'Show Best in Slot Melee Style Tasks': false, 'Show Best in Slot 1H and 2H': false,
  'Show Best in Slot Shield': false, 'Show Best in Slot Defensive Tasks': false,
  'Show Best in Slot Weight Tasks': false,
  'Highest Level': false, 'Kill X': false, 'Kill X Boss': false,
  'All Shops': false, 'Every Drop': false, 'All Droptables': false,
  'Every Drop Thieving': false, 'Every Drop Implings': false, 'Every Drop BGH': false,
  'All Droptables Nest': false, RDT: false,
  'House storage tasks': false,
  'Rare Drop Inclusive': false, 'Secondary Primary Inclusive': true,
});

/** Undefined means no authored automatic value (for example a retained rule). */
export function taskRuleDefault(id) {
  if (Object.hasOwn(taskRuleBooleanDefaults, id)) return taskRuleBooleanDefaults[id];
  if (Object.hasOwn(taskRuleCutoffDefaults, id)) return taskRuleCutoffDefaults[id];
  if (id === 'Kill X Amount') return 1;
  if (Object.hasOwn(taskRuleCategoryCounts, id) && taskRuleCategoryCounts[id]) return true;
  return undefined;
}

/** Legacy literal fallbacks are checked against this contract; unknown tags default on. */
export function taskRuleEnabled(rules, id, fallback = taskRuleDefault(id) ?? true) {
  const own = rules[id] === undefined ? fallback : ![false, 'false', 0].includes(rules[id]);
  return own && taskRuleParentsEnabled(rules, id);
}

/** Effective dependency only: never clear a saved child preference. */
export function taskRuleParentsEnabled(rules, id) {
  for (let parent = taskRuleParents[id]; parent; parent = taskRuleParents[parent]) {
    const value = rules instanceof Map ? rules.get(parent) : rules[parent];
    if (value === undefined ? !(taskRuleDefault(parent) ?? true) : [false, 'false', 0].includes(value)) return false;
  }
  return true;
}
