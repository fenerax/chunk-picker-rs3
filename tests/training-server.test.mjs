import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrainingAvailability } from '../app/tasks/training-availability.mjs';
import { withGatheringBanking } from '../app/tasks/banking-plan.mjs';

// Independent, pure request-input coverage; final HTTP acceptance runs elsewhere.
test('training request availability uses current personal levels and calculator choices without saving', () => {
  const observed = level => ({ level, xp: 50000, source: 'runemetrics', runescapeName: 'Synthetic account', fetchedAt: '2026-10-16T12:00:00Z' });
  const state = { rules: { 'content.f2p': true }, members: [{ id: 'gatherer', runescapeName: 'Synthetic account',
    preferences: { gatheringProcessing: 'cook-drop', gatheringCookingFacility: 'fire' },
    skillProgress: { Fishing: observed(30), Cooking: observed(60) },
    transportFacts: { confirmations: { 'synthetic-stone': true } },
    teleports: [{ id: 'saved', available: true, consumable: false }, { id: 'consumed', available: true, consumable: true }],
  }, { id: 'partner', transportFacts: { confirmations: { 'partner-stone': true } } }] };
  const before = structuredClone(state), availability = buildTrainingAvailability({ tasks: [], access: {} }, { state, memberId: 'gatherer' });
  const species = [{ id: 'trout', item: 'Raw trout', fishPerHour: 600, xpPerHour: 30000 }];
  const metric = { xpPerHour: 30000, fishPerHour: 600, fishing: { species, xpPerHour: 30000, fishPerHour: 600 } };
  const result = withGatheringBanking(metric, { id: 'synthetic-fish', skill: 'Fishing' }, 30, availability, true);
  assert.equal(result.banking.processing.mode, 'cook-drop');
  assert(result.banking.processing.processingXpPerHour.Cooking > 0); assert(result.banking.processing.gatheringFraction < 1);
  assert.deepEqual(availability.gatheringTravelUnlocks.confirmations, { 'synthetic-stone': true });
  assert.deepEqual(availability.gatheringTravelUnlocks.teleports.map(row => row.id), ['saved']);
  assert.deepEqual(state, before);
  state.members[0].skillProgress.Cooking.runescapeName = 'Previous account';
  const stale = buildTrainingAvailability({ tasks: [] }, { state, memberId: 'gatherer' });
  assert.equal(withGatheringBanking(metric, { id: 'synthetic-fish', skill: 'Fishing' }, 30, stale, true).banking.processing.reasonCode, 'missing-level');
});
