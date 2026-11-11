// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityIndex } from '../app/tasks/identity.mjs';
import { createResidentState } from '../app/core/state.mjs';
import { fixture, first, second, generated } from './helpers/owned-format2-fixture.mjs';

test('narrow owned lookup preserves ordered historical mappings without retaining unrelated indexes', () => {
  const f = fixture(), state = createResidentState(f.state, f.base);
  const taskMap = { collision: 't_mixed', 'first-alias': 't_first', t_first: 't_chain', absent: 't_unused' };
  const history = { current: { collision: 't_current' }, historical: { 'first-alias': 't_old' },
    mappings: { t_old: 't_follow' }, tombstones: { collision: 't_gone' },
    conflicts: [{ label: 'first-alias', ids: ['t_conflict_a', 't_conflict_b'] }] };
  for (const id of [first, second, generated]) {
    const expected = buildIdentityIndex(f.state.tasks, { savedRegistry: f.state.identityRegistry, taskMap, history }).lookup(id);
    const actual = buildIdentityIndex(state.tasks, { savedRegistry: state.identityRegistry, taskMap, history, lookupIds: new Set([id]) }).lookup(id);
    assert.deepEqual(actual, expected);
  }
  let originalCounts, extendedCounts;
  const options = { savedRegistry: state.identityRegistry, taskMap, history, lookupIds: new Set([first]) };
  const expected = buildIdentityIndex(state.tasks, { ...options, onIndexBuiltForTests: counts => { originalCounts = counts; } }).lookup(first);
  const unrelated = 'rs3:task:unrelated-synthetic';
  const extended = buildIdentityIndex([...state.tasks, { id: unrelated, category: 'Synthetic', label: 'Unrelated', aliases: ['unrelated'] }], {
    ...options, taskMap: { ...taskMap, unrelated: 't_unrelated', t_unrelated: 't_unrelated_chain', missing: 't_missing' },
    onIndexBuiltForTests: counts => { extendedCounts = counts; },
  }).lookup(first);
  assert.deepEqual(extended, expected);
  assert.deepEqual(extendedCounts, originalCounts, 'unrelated catalogue and mapping rows allocate no narrow index entries');
  assert.equal(originalCounts.entries, 1);
  assert.equal(originalCounts.mappedLabels, 0, 'narrow lookups never build the complete historical label table');
  for (const alias of ['t_first', 't_chain', 't_old', 't_follow', 't_conflict_a', 't_conflict_b']) assert(expected.aliases.includes(alias));
  assert(!expected.aliases.includes('t_unrelated'));
});
