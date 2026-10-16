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

const route = (extra = {}) => ({ status: 'routed', spot: { id: 'spot', label: 'Synthetic resource' },
  tileSteps: 100, roundTripTileSteps: 200, chunks: ['257'], destination: { kind: 'bank', name: 'Synthetic bank' }, ...extra });
const mining = { id: 'ore', skill: 'Mining', miningCurve: { rockId: 'copper' } };
const syntheticMetric = { xpPerHour: 24000, orePerHour: 1200 };

test('processing slows gathering and reports secondary XP without blending the target skill', () => {
  const method = { id: 'wood', skill: 'Woodcutting', woodcuttingCurve: { treeId: 'oak' } };
  const availability = { gatheringProcessing: 'fletch-drop', skills: { Fletching: 15 } };
  const input = { xpPerHour: 60000, logsPerHour: 1000 }, result = withGatheringBanking(input, method, 45, availability, true);
  assert(result.xpPerHour < input.xpPerHour); assert(result.banking.processing.processingXpPerHour.Fletching > 0);
  assert(Math.abs(result.xpPerHour / result.logsPerHour - 60) < 1e-8);
  const yew = withGatheringBanking(input, { ...method, woodcuttingCurve: { treeId: 'yew' } }, 75, availability, true);
  assert.equal(yew.xpPerHour, null); assert.equal(yew.banking.processing.reasonCode, 'members-required');
  assert.equal(withGatheringBanking(input, method, 45, { ...availability, gatheringProcessing: 'cook-drop' }, true).xpPerHour, input.xpPerHour);
});

test('unavailable processing clears every mixed-species derived rate', () => {
  const species = [{ id: 'trout', fishPerHour: 360, xpPerHour: 18000 }, { id: 'salmon', fishPerHour: 240, xpPerHour: 16800 }];
  const input = { xpPerHour: 34800, fishPerHour: 600, species, fishing: { species, fishPerHour: 600, xpPerHour: 34800 } };
  const result = withGatheringBanking(input, { id: 'fish', skill: 'Fishing' }, 35,
    { gatheringProcessing: 'cook-drop', skills: { Cooking: 60 } }, true);
  assert.equal(result.xpPerHour, null); assert.equal(result.species[0].fishPerHour, null);
  assert.equal(result.fishing.fishPerHour, null); assert.equal(result.fishing.species[1].xpPerHour, null);
});

test('bank comparison selects the faster travel cycle including stairs and saved Surge gate', () => {
  const routed = route({ extraTravelSeconds: 14.4, walkingRuns: [100], teleportOption: route({
    outboundTileSteps: 5, returnTileSteps: 100, outboundRuns: [5], returnRuns: [100], teleportSeconds: 10.2,
    extraTravelSeconds: 14.4, lodestone: { name: 'Synthetic stone' } }) });
  const availability = { gatheringMode: 'bank', bankingRoutes: () => [routed] };
  const result = withGatheringBanking(syntheticMetric, mining, 7, availability, true), spot = result.banking.spots[0];
  assert.equal(spot.travel.mode, 'lodestone'); assert.equal(spot.tileSteps, 105);
  assert(Math.abs(spot.rates.walking.travelSeconds - 87.6) < 1e-8);
  assert.equal(spot.walkingSeconds, 134.4);
  assert(withGatheringBanking(syntheticMetric, mining, 7, { ...availability, gatheringSurge: 'on', skills: { Agility: 5 } }, true).xpPerHour > result.xpPerHour);
  assert.equal(withGatheringBanking(syntheticMetric, mining, 7, { ...availability, gatheringSurge: 'on', skills: { Agility: 4 } }, true).xpPerHour, result.xpPerHour);
  const slow = { ...routed, teleportOption: { ...routed.teleportOption, teleportSeconds: 1000 } };
  assert.equal(withGatheringBanking(syntheticMetric, mining, 7, { ...availability, bankingRoutes: () => [slow] }, true).banking.spots[0].travel.mode, 'walk');
});
