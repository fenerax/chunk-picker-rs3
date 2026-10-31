// Supplement the four native acquisition goals, preserving recipe/ownership
// requirements and exact labels/IDs. Other Ports goals keep their existing tags.
const scrollGoals = new Map([
  ['Crafting', 'Unlock the ~|Death Lotus|~ scrolls in the Ports Reward Shop'],
  ['Divination', 'Unlock the ~|scrimshaw|~ scrolls in the Ports Reward Shop'],
  ['Runecrafting', 'Unlock the ~|seasinger|~ scrolls in the Ports Reward Shop'],
  ['Smithing', 'Unlock the ~|tetsu|~ scrolls in the Ports Reward Shop'],
]);

export function withPortsScrollRule(category, record, label) {
  if (scrollGoals.get(category) !== label) return record;
  const tags = record.Category == null ? [] : Array.isArray(record.Category) ? record.Category : [record.Category];
  return tags.includes('Ports Scrolls') ? record : { ...record, Category: [...tags, 'Ports Scrolls'] };
}
