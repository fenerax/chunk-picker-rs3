import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXpChoiceCatalogue, buildXpChoiceView, xpRewardSlots, validateXpChoices, resolveXpChoices } from '../app/core/xp-choices.mjs';

const task = { id: 'reward', label: 'Reward', rawLabel: '~|Reward|~', category: 'Quest', record: { XpReward: { Mining: 50, Anyx3: 1000, 'Mining|Woodcutting': 200 } } };
const identities = definitions => Object.entries(definitions.challenges).flatMap(([category, records]) =>
  Object.keys(records).map(rawLabel => ({ id: `${category}:${rawLabel}`, category, rawLabel, label: rawLabel })));
const membershipRows = definitions => [...buildXpChoiceCatalogue(definitions, identities(definitions)).values()];

test('retained choosable sources classify all member diaries while preserving F2P quests and Lumbridge', async () => {
  const { loadOriginalData } = await import('../app/data/original-data.mjs');
  const { definitionBytes } = await loadOriginalData({ loadTaskMap: false });
  const definitions = JSON.parse(definitionBytes);
  const rows = membershipRows(definitions), free = rows.filter(row => !row.members);
  assert.equal(rows.length, 124); assert.equal(rows.filter(row => row.members).length, 107); assert.equal(free.length, 17);
  assert.equal(free.filter(row => row.category === 'Quest').length, 13);
  assert.deepEqual(free.filter(row => row.category === 'Diary').map(row => row.rawLabel),
    ['Beginner', 'Easy', 'Medium', 'Hard'].map(tier => `~|Lumbridge Achievements#${tier}|~ Complete the ${tier} Achievements`));
  for (const row of rows.filter(row => row.rawLabel.startsWith('~|Underworld Achievements#'))) assert.equal(row.members, true);
  for (const name of ['Missing, Presumed Death', "Three's Company (unabridged saga)"])
    assert(free.some(row => row.rawLabel.startsWith(`~|${name}|~`)));
});

test('original skill metadata includes Invention only outside F2P reward choices', () => {
  const slots = xpRewardSlots(task);
  assert(slots[0].skills.includes('Invention'));
  assert(!xpRewardSlots(task, { f2p: true })[0].skills.includes('Invention'));
  assert.throws(() => validateXpChoices(task, ['Invention', null, null, 'Mining'], { f2p: true }), /Invalid skill/);
});

