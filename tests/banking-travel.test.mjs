import test from 'node:test';
import assert from 'node:assert/strict';
import { bankingTripTravel } from '../app/training/banking-travel.mjs';
import { bankingTileSearch, straightRuns } from '../app/training/banking-paths.mjs';
import { confirmedBankingLodestones } from '../app/training/banking-lodestones.mjs';

test('weighted entrances choose total cost rather than nearest surface tile', () => {
  const search = bankingTileSearch({ size: 6, neighbors: function* (node) {
    if (node > 0) yield [node - 1, 2]; if (node < 5) yield [node + 1, 0];
  } }, [{ node: 0, cost: 10, owner: 0 }, { node: 5, cost: 0, owner: 1 }]);
  assert.equal(search.distance[1], 4); assert.equal(search.owner[1], 1);
  assert.equal(search.next[1], 2);
});

test('Surge saves clear straight walking, respects turns and cooldown, and never jumps unknown geometry', () => {
  const plain = { tileSteps: 20, walkingRuns: [20] };
  assert.equal(bankingTripTravel(plain).travelSeconds, 24);
  const surge = bankingTripTravel(plain, { surge: true, gatheringSeconds: 60 });
  assert.equal(surge.surgeUses, 1); assert(Math.abs(surge.travelSeconds - 18.6) < 1e-8);
  assert.equal(bankingTripTravel({ tileSteps: 20, walkingRuns: [5, 5, 5, 5] }, { surge: true, gatheringSeconds: 60 }).surgeUses, 0);
  assert.equal(bankingTripTravel({ tileSteps: 10 }, { surge: true }).geometryMissing, true);
  const short = bankingTripTravel({ tileSteps: 10, walkingRuns: [10] }, { surge: true, gatheringSeconds: 1 });
  assert.equal(short.surgeUses, 0);
  assert.deepEqual(straightRuns([[1,1],[2,2],[3,3],[4,3]]), [2, 1]);
  assert.equal(straightRuns([[1,1],[3,3]]), null);
});

test('lodestone travel includes casting, separate outbound/return walking and upstairs overhead', () => {
  const route = { tileSteps: 100, outboundTileSteps: 5, returnTileSteps: 100, teleportSeconds: 10.2, extraTravelSeconds: 14.4,
    outboundRuns: [5], returnRuns: [100] };
  assert(Math.abs(bankingTripTravel(route).travelSeconds - 87.6) < 1e-8);
  assert(bankingTripTravel(route, { surge: true, gatheringSeconds: 100 }).travelSeconds < 87.6);
  assert.equal(bankingTripTravel({ ...route, outboundRuns: [99] }, { surge: true }), null);
});

const catalogue = {
  stations: [{ id: 'free', name: 'Free lodestone', mapId: 7, componentWitness: { plane: 0, mapId: 7 }, plane: 0, chunkId: '1', x: 1, y: 1, coordinateEvidence: { role: 'exact-teleport-destination' } },
    { id: 'member', mapId: 7, componentWitness: { plane: 0, mapId: 7 }, plane: 0, chunkId: '2', x: 2, y: 2, coordinateEvidence: { role: 'exact-teleport-destination' } }],
  routes: [{ id: 'home-free', from: null, to: 'free', kind: 'lodestone', members: false, f2p: true, requirements: { confirmations: ['free-activated'] } },
    { id: 'home-member', from: null, to: 'member', kind: 'lodestone', members: true, f2p: false, requirements: { confirmations: ['member-activated'] } }],
};
test('activation is personal; membership, negative overrides and exact landing evidence fail closed', () => {
  const available = { members: false, gatheringTravelUnlocks: { confirmations: { 'free-activated': true, 'member-activated': true } } };
  assert.deepEqual(confirmedBankingLodestones({}, catalogue), []);
  assert.deepEqual(confirmedBankingLodestones(available, catalogue).map(row => row.id), ['free']);
  assert.equal(confirmedBankingLodestones({ ...available, members: true }, catalogue).length, 2);
  assert.deepEqual(confirmedBankingLodestones({ ...available, gatheringLodestones: 'off' }, catalogue), []);
  assert.deepEqual(confirmedBankingLodestones({ ...available, gatheringTravelUnlocks: { ...available.gatheringTravelUnlocks, overrides: { 'home-free': false } } }, catalogue), []);
  assert.deepEqual(confirmedBankingLodestones(available, { ...catalogue, stations: catalogue.stations.map(row => ({ ...row, coordinateEvidence: null })) }), []);
  assert.equal(confirmedBankingLodestones({ gatheringTravelUnlocks: { overrides: { 'home-free': true } } }, catalogue).length, 1);
  assert.deepEqual(confirmedBankingLodestones({ ...available, gatheringTravelUnlocks: { ...available.gatheringTravelUnlocks,
    conditions: { 'teleport-origin-permitted': false } } }, catalogue), []);
  const manual = label => ({ gatheringTravelUnlocks: { teleports: [{ id: 'custom-stone', label, destination: '1-2', available: true, consumable: false }] } });
  assert.equal(confirmedBankingLodestones(manual('Free lodestone'), catalogue).length, 1);
  assert.deepEqual(confirmedBankingLodestones(manual('Another teleport in this chunk'), catalogue), []);
  assert.deepEqual(confirmedBankingLodestones({ gatheringTravelUnlocks: { teleports: [{ id: 'home-free', destination: '2', available: true, consumable: false }] } }, catalogue), []);
});
