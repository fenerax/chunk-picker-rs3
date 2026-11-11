// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityIndex } from '../app/tasks/identity.mjs';
import { createResidentState } from '../app/core/state.mjs';
import { fixture, first, second } from './helpers/owned-format2-fixture.mjs';

test('narrow lookup preserves suppression before a later target joins a historical alias', () => {
  const f = fixture();
  f.state.identityRegistry.aliases['second-alias'] = second;
  const resident = createResidentState(f.state, f.base);
  const scenarios = [
    { taskMap: { 'second-alias': 't_shared', t_shared: 't_early', 'first-alias': 't_shared' },
      history: { current: { t_shared: 't_early' }, historical: { t_shared: 't_late' } } },
    { taskMap: { 'second-alias': 't_root', t_root: 't_shared', t_shared: 't_early', 'first-alias': 't_shared' },
      history: { mappings: { t_shared: 't_early' }, tombstones: { t_shared: 't_late' } } },
    { taskMap: { t_shared: 't_early', 'first-alias': 't_shared' },
      history: { current: { t_shared: 't_early' } } },
    { taskMap: { t_cycle: 't_shared', t_shared: 't_cycle', 'first-alias': 't_shared' },
      history: { current: { t_shared: 't_cycle' }, historical: { t_cycle: 't_late' } } },
  ];
  for (const options of scenarios) for (const id of [first, second]) {
    const full = buildIdentityIndex(f.state.tasks, { ...options, savedRegistry: f.state.identityRegistry }).lookup(id);
    const narrow = buildIdentityIndex(resident.tasks, { ...options, savedRegistry: resident.identityRegistry, lookupIds: new Set([id]) }).lookup(id);
    assert.deepEqual(narrow, full);
  }
  const result = buildIdentityIndex(resident.tasks, { ...scenarios[0], savedRegistry: resident.identityRegistry, lookupIds: new Set([first]) }).lookup(first);
  assert(!result.aliases.includes('t_early'));
  assert(result.aliases.includes('t_late'));
});
