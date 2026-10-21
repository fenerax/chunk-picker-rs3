import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMetadataCorrections } from '../app/data/metadata-corrections.mjs';
import { itemMembershipBlocker, membershipOutputItems, taskItemMembershipBlockers } from '../app/tasks/membership.mjs';

test('shared item memo retains alias quantities and isolates requirement/product descriptors', () => {
  const definitions = { codeItems: { itemsPlus: { 'Choice[+]': ['Ashes', 'Magic shortbow'] } },
    skillItems: { Crafting: { Members: { 'Magic shortbow': true }, Mixed: { Ashes: true, 'Magic shortbow': true } } } };
  const cache = new Map(), outputs = new Map(), reads = new Map();
  const lookup = name => {
    if (!cache.has(name)) {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      cache.set(name, itemMembershipBlocker(name, true, definitions));
    }
    return cache.get(name);
  };
  const record = { Items: ['Choice[+]x2', 'Magic shortbow'], Output: ['Members'] };
  const expected = taskItemMembershipBlockers(record, 'Crafting', definitions);
  const first = taskItemMembershipBlockers(record, 'Crafting', definitions, '', lookup, outputs);
  assert.deepEqual(first, expected);
  assert.equal(first.length, 3);
  first.forEach(blocker => { blocker.detail = 'Caller mutation'; });
  assert.deepEqual(taskItemMembershipBlockers(record, 'Crafting', definitions, '', lookup, outputs), expected);
  assert.deepEqual(taskItemMembershipBlockers({ Items: ['Choice[+]'], Output: ['Mixed'] }, 'Crafting', definitions, '', lookup, outputs), []);
  assert.deepEqual([...reads], [['Ashes', 1], ['Magic shortbow', 1]]);
});

