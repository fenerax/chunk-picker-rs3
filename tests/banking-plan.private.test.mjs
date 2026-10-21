import test from 'node:test';
import assert from 'node:assert/strict';
import { withGatheringBanking, createGatheringRouteLookup } from '../app/tasks/banking-plan.mjs';
import { planTraining } from '../app/tasks/training-planner.mjs';

const method = { id: 'mining.copper', skill: 'Mining', label: 'Mine copper', level: 1, members: false,
  miningCurve: { rockId: 'copper' }, inputs: [], outputs: [{ item: 'Copper ore', quantity: 1 }] };
const row = (steps, kind = 'bank', id = 'a') => ({ status: 'routed', spot: { id, label: 'Mine', x: 3200, y: 3200 },
  tileSteps: steps, roundTripTileSteps: steps * 2, chunks: ['12850'], destination: { name: 'Bank', kind } });
const metric = { xpPerHour: 20000, orePerHour: 1000, mining: { pickaxeId: 'bronze' } };

test('route discovery happens once for all levels and fastest valid spot supplies target time', () => {
  let calls = 0;
  const availability = { gatheringMode: 'bank' };
  availability.bankingRoutes = createGatheringRouteLookup({ routesForGathering: () => { calls++; return [row(100, 'bank', 'far'), row(20, 'bank', 'near')]; } }, availability);
  const result = planTraining('Mining', 1, 3, { ...availability,
    catalogue: { skills: [{ skill: 'Mining', f2pCap: 110 }], methods: [method] } }, 'best-xp');
  assert.equal(calls, 1); assert.equal(result.recommendation.complete, true);
  assert.equal(result.recommendation.segments[0].banking.selectedSpotId, 'near');
  assert.equal(result.availableMethods[0].banking.spots.length, 2);
  const unbanked = planTraining('Mining', 1, 3, { catalogue: { skills: [{ skill: 'Mining', f2pCap: 110 }], methods: [method] } }, 'best-xp');
  assert(result.recommendation.hours > unbanked.recommendation.hours);
});

