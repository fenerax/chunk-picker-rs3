import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { aliasSuggestions, diagnoseTask } from '../scripts/review-task-icons.mjs';

test('alias suggestions never resolve a row or strip its equipment tier', () => {
  const lookup = name => ['Rune arrow', 'Potion', 'Platebody', 'Weapon'].includes(name) ? '/fixture.png' : null;
  assert.deepEqual(aliasSuggestions('Rune arrows', lookup), [{ kind: 'plural', candidate: 'Rune arrow', suggestionOnly: true }]);
  assert.deepEqual(aliasSuggestions('Weapon (tier 99)', lookup), []);
  assert.deepEqual(aliasSuggestions('Monk’s robe', name => name === "Monk's robe" ? '/fixture.png' : null),
    [{ kind: 'apostrophe', candidate: "Monk's robe", suggestionOnly: true }]);
  for (const name of ['Potion (unf)', 'Potion (4)', 'Potion (3 doses)', 'Platebody (noted)', 'Weapon (charged)', 'Platebody set']) assert.equal(aliasSuggestions(name, lookup).length, 1);
  const row = diagnoseTask({ id: 'x', label: 'Obtain Rune arrows', category: 'BiS' }, { names: () => ['Rune arrows'], lookup, manifestNames: new Set() });
  assert.equal(row.reason, 'possible-alias');
  assert.deepEqual(row.candidates, ['Rune arrows']);
  assert.equal(row.unmatched[0].reason, 'not-in-manifest');
});

test('missing categories and itemless goals remain distinct', () => {
  const options = { names: () => [], lookup: () => null, manifestNames: new Set() };
  assert.equal(diagnoseTask({ category: 'Quest' }, options).reason, 'category-without-icon');
  assert.equal(diagnoseTask({ category: 'Extra' }, options).reason, 'no-identifiable-item');
});

test('diagnostic retains pinned manifest rejection reasons', () => {
  const manifestUnmatched = new Map([['ghost hunter body', [{ version: 'fixture', reason: 'ambiguous-variant' }]]]);
  const row = diagnoseTask({ category: 'BiS' }, { names: () => ['Ghost hunter body'], lookup: () => null, manifestNames: new Set(), manifestUnmatched });
  assert.deepEqual(row.unmatched[0].manifestReasons, [{ version: 'fixture', reason: 'ambiguous-variant' }]);
});

test('diagnostic requires explicit isolated input and rejects output options', () => {
  for (const args of [[], ['--save', '.local/duo'], ['--output', 'report.json'], ['--baseline', '--current']]) {
    const result = spawnSync(process.execPath, ['scripts/review-task-icons.mjs', ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});
