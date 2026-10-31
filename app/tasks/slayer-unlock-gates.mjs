import { FUTURE_SLAYER_UNLOCKS_RULE } from '../data/slayer-unlock-gates.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';

/** Called within the item/access closure, so newly obtainable parts open gates. */
export function evaluateSlayerUnlockGate(gate, rules, access, hasItem, { hasQuestTask = () => false, slayerLevel = 1 } = {}) {
  const bypassed = !!gate.future && taskRuleEnabled(rules, 'Permanent Unlockables')
    && taskRuleEnabled(rules, FUTURE_SLAYER_UNLOCKS_RULE);
  const available = name => gate.kind === 'items' ? hasItem(name) || (gate.itemAlternatives?.[name] ?? []).some(hasItem)
    : access[gate.kind].has(name);
  const entry = gate.entrance;
  const entranceOpen = entry && !access.blockedAreas?.has(gate.targets[0])
    && access.npcs.has(entry.npc) && hasQuestTask(entry.questTask) && slayerLevel >= (entry.slayer ?? 1);
  const open = !!(bypassed || entranceOpen || (gate.kind === 'items' ? gate.targets.every(available) : gate.targets.some(available)));
  return { open, bypassed, condition: gate.condition,
    ...(gate.future ? { ruleId: FUTURE_SLAYER_UNLOCKS_RULE } : {}),
    reason: bypassed ? 'Future Slayer unlocks is on; only the existing shop requirements apply.' : gate.condition };
}
