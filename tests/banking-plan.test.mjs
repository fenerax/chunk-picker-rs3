import test from 'node:test';
import assert from 'node:assert/strict';
import { withGatheringBanking, createGatheringRouteLookup } from '../app/tasks/banking-plan.mjs';
import { planTraining } from '../app/tasks/training-planner.mjs';

const method = { id: 'mining.copper', skill: 'Mining', label: 'Mine copper', level: 1, members: false,
  miningCurve: { rockId: 'copper' }, inputs: [], outputs: [{ item: 'Copper ore', quantity: 1 }] };
const row = (steps, kind = 'bank', id = 'a') => ({ status: 'routed', spot: { id, label: 'Mine', x: 3200, y: 3200 },
  tileSteps: steps, roundTripTileSteps: steps * 2, chunks: ['12850'], destination: { name: 'Bank', kind } });
const metric = { xpPerHour: 20000, orePerHour: 1000, mining: { pickaxeId: 'bronze' } };

test('bank mode reduces XP and resources by the same cycle fraction without deriving Mining XP from ore', () => {
  const result = withGatheringBanking(metric, method, 7, { gatheringMode: 'bank', gatheringOreBox: 'bronze', bankingRoutes: () => [row(100)] }, true);
  assert(result.xpPerHour < metric.xpPerHour);
  assert.equal(result.xpPerHour / result.orePerHour, 20);
  assert.equal(result.banking.drop.xpPerHour, 20000);
  assert.equal(result.banking.spots[0].walkingSeconds, 120);
  assert.equal(result.banking.spots[0].tileSteps, 200);
  assert.equal(result.banking.spots[0].rates.walking.capacity, 147);
  assert.equal(metric.xpPerHour, 20000);
});

test('drop mode shows bank comparison while preserving baseline, and inaccessible banks never invent time', () => {
  const available = { bankingRoutes: () => [{ status: 'no-bank', spot: { id: 'x', label: 'Mine' } }] };
  const drop = withGatheringBanking(metric, method, 7, available, true);
  assert.equal(drop.xpPerHour, 20000); assert.equal(drop.banking.status, 'no-bank');
  const bank = withGatheringBanking(metric, method, 7, { ...available, gatheringMode: 'bank' }, true);
  assert.equal(bank.xpPerHour, null); assert.equal(bank.orePerHour, null);
  const unknown = withGatheringBanking(metric, method, 7, { gatheringMode: 'bank' }, true);
  assert.equal(unknown.banking.status, 'unknown'); assert.equal(unknown.xpPerHour, null);
  const unlocated = withGatheringBanking(metric, method, 7, { bankingRoutes: () => [{ status: 'unknown', tileSteps: null, roundTripTileSteps: null, spot: { id: 'missing' } }] }, true);
  assert.equal(unlocated.banking.spots[0].tileSteps, null);
  assert.equal(unlocated.banking.spots[0].walkingSeconds, null);
});


test('mixed fish rows, supplies and XP retain their shares in a banked plan', () => {
  const fish = { id: 'fly', skill: 'Fishing', fishingCurve: { methodId: 'fly-fishing' }, inputs: [{ item: 'Feather' }] };
  const species = [{ id: 'trout', item: 'Raw trout', label: 'Trout', fishPerHour: 600, xpPerHour: 30000 },
    { id: 'salmon', item: 'Raw salmon', label: 'Salmon', fishPerHour: 400, xpPerHour: 28000 }];
  const result = withGatheringBanking({ xpPerHour: 58000, fishPerHour: 1000, species,
    fishing: { species, fishPerHour: 1000, xpPerHour: 58000 } }, fish, 30,
  { gatheringMode: 'bank', bankingRoutes: () => [row(100)] }, true);
  assert.equal(result.banking.spots[0].rates.walking.capacity, 27);
  assert.equal(result.species[0].fishPerHour / result.species[1].fishPerHour, 1.5);
  assert.equal(result.fishing.species[0].fishPerHour, result.species[0].fishPerHour);
  assert.equal(result.xpPerHour / result.fishPerHour, 58);
});

test('running is Advanced only and never changes walking plan rates', () => {
  const input = { gatheringMode: 'bank', bankingRoutes: () => [row(400)], bankingAdvanced: true };
  const result = withGatheringBanking(metric, method, 7, input, true);
  assert(result.banking.spots[0].rates.running);
  assert.equal(result.xpPerHour, result.banking.spots[0].rates.walking.xpPerHour);
  assert.equal(withGatheringBanking(metric, method, 7, input).banking.spots[0].rates.running, undefined);
});
