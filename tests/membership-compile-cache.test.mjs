import test from 'node:test';
import assert from 'node:assert/strict';
import { itemMembershipBlocker, membershipOutputItems, taskItemMembershipBlockers } from '../app/tasks/membership.mjs';

test('membership root expansion preserves mixed tables, duplicate order and root-specific cycle cutoffs', () => {
  const definitions = { skillItems: { Crafting: {
    A: { B: true, Ashes: true, 'Magic shortbow': false },
    B: { A: true, 'Magic shortbow': true },
    Outer: { A: true, B: true },
  }, Smithing: { A: { 'Iron bar': true } } } };
  const cache = new Map();
  for (const [category, root] of [['Crafting', 'A'], ['Crafting', 'B'], ['Crafting', 'Outer'], ['Smithing', 'A']]) {
    const expected = membershipOutputItems(category, root, definitions);
    assert.deepEqual(membershipOutputItems(category, root, definitions, new Set(), cache), expected);
    assert.deepEqual(membershipOutputItems(category, root, definitions, new Set(), cache), expected);
  }
  assert.deepEqual(cache.get('Crafting').get('Outer'), ['Magic shortbow', 'Ashes', 'Ashes', 'Magic shortbow']);
  assert.throws(() => cache.get('Crafting').get('A').push('Poison'), TypeError);
  assert.deepEqual(membershipOutputItems('Crafting', 'A', definitions, new Set(['B']), cache), ['Ashes'],
    'A nonempty recursion path bypasses the root memo.');
});

