import { isPermanentId } from './identity.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const name = value => typeof value === 'string' && value.trim().length > 0;

/** This adapter establishes potential repeatable supply, never affordability,
 * inventory, payment consumption or a completed transaction. Quantities remain
 * evidence for preparation; a reachable input source is the only closure gate. */
export function compileDialogueSupply(value) {
  if (value === undefined) return undefined;
  if (!object(value) || value.mode !== 'closure-only'
    || Object.keys(value).some(key => !['mode', 'paymentAlternatives'].includes(key))
    || !Array.isArray(value.paymentAlternatives) || !value.paymentAlternatives.length
    || value.paymentAlternatives.some(clause => !object(clause) || !Object.keys(clause).length
      || Object.entries(clause).some(([item, quantity]) => !name(item) || !positive(quantity)))) return null;
  return structuredClone(value);
}

export function dialogueSupplyBlocker(supply, hasItem) {
  if (!supply || supply.paymentAlternatives.some(clause => Object.keys(clause).every(hasItem))) return null;
  return { kind: 'payment-source', detail: `Requires a reachable payment source: ${dialoguePaymentText(supply)}. Check the held amount in game.` };
}

export const dialoguePaymentText = supply => supply.paymentAlternatives
  .map(clause => Object.entries(clause).map(([item, quantity]) => `${quantity} ${item}`).join(' and ')).join(' or ');

export const dialogueSupplyNote = 'Potential supply only. Check payment quantities in game; held balance and payment consumption are not tracked.';

/** Finite rewards never enter ordinary item closure. Even recorded completion
 * cannot establish an unspent stack when inventory/consumption is untracked. */
export function compileFiniteRewards(value, record = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.some(row => !object(row)
    || Object.keys(row).some(key => !['item', 'quantity'].includes(key)) || !name(row.item) || !positive(row.quantity))
    || new Set(value.map(row => row.item)).size !== value.length) return null;
  // Outputs can expand through nested tables. Keep a finite reward record
  // exclusive rather than allowing an indirect ordinary publication of it.
  if ([record.Output, record.Reward].flat().some(Boolean)) return null;
  return structuredClone(value);
}

export function finiteRewardPreview(rewards, { status, personalCompleted, taskId }) {
  if (!rewards.length || status === 'unsupported') return [];
  return rewards.map(reward => ({ ...reward, taskId, renewable: false,
    status: personalCompleted ? 'completion-recorded' : status === 'available' ? 'attainable-on-completion' : 'completion-blocked',
    remainingQuantity: null, claimStatus: 'untracked',
    detail: 'One-time reward. Completion does not establish a held or unspent stack; excluded from repeatable supplies and training.' }));
}

/** Personal alternatives reuse revision-checked task completion and quest
 * observations. Reachable tasks and shared challenge checkmarks are excluded. */
export function compilePersonalAlternatives(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.some(clause => !object(clause)
    || Object.keys(clause).length !== 1 || !(name(clause.quest) || isPermanentId(clause.completedTask)))) return null;
  return structuredClone(value);
}

export function personalAlternativesBlocker(clauses, quests, completed, labelFor = () => 'the entry confirmation') {
  if (!clauses.length || clauses.some(clause => clause.quest ? quests.includes(clause.quest) : completed.has(clause.completedTask))) return null;
  return { kind: 'personal-completion', detail: 'Requires personal evidence for one entry alternative: '
    + clauses.map(clause => clause.quest ? `completed ${clause.quest}` : `recorded ${labelFor(clause.completedTask)}`).join(' or ') + '.' };
}

const locationKinds = { Objects: 'Object', NPCs: 'NPC', Shops: 'Shop', Monsters: 'Monster' };
export function compileSourceLocations(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.some(row => !object(row)
    || Object.keys(row).some(key => !['field', 'name', 'locations'].includes(key))
    || typeof row.field !== 'string' || !Object.hasOwn(locationKinds, row.field) || !name(row.name) || !Array.isArray(row.locations)
    || !row.locations.length || row.locations.some(location => !name(location)))) return null;
  return structuredClone(value);
}

export function sourceLocationBlocker(selectors, access) {
  for (const selector of selectors) {
    const admitted = access[selector.field.toLowerCase()]?.has(selector.name);
    const locations = new Set(access.locations.get(`${locationKinds[selector.field]}:${selector.name}`) ?? []);
    if (!admitted || !selector.locations.some(location => locations.has(location))) {
      return { kind: 'source-location', detail: `Requires ${selector.name} at a reviewed source location: ${selector.locations.join(' or ')}.` };
    }
  }
  return null;
}
