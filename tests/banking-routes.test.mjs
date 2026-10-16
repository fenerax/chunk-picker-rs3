import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createBankingRoutes } from '../app/training/banking-routes.mjs';

const baseAt = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
const directions = [[-1, 0], [0, 1], [1, 0], [0, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]];
const method = { id: 'synthetic-tree', skill: 'Woodcutting' };
function fixture(points) {
  const admitted = new Set(points.map(([x, y]) => `${x},${y}`)), regions = new Map(), components = new Map();
  for (const [x, y] of points) {
    const base = baseAt(x, y), i = (x & 63) * 64 + (y & 63);
    if (!regions.has(base)) regions.set(base, Buffer.alloc(12288));
    const raw = regions.get(base); raw.writeUInt16LE(1, i * 2);
    for (const [d, [dx, dy]] of directions.entries()) if (admitted.has(`${x + dx},${y + dy}`)) raw[8192 + i] |= 1 << d;
    components.set(`${base}-1000001`, { free: true });
  }
  return { world: { cacheWalking: { components } }, tileData: { regions: [...regions].map(([base, raw]) =>
    [base, deflateRawSync(raw).toString('base64'), 'ffffffffffffffff']) },
  availability: { members: false, access: { bases: [...regions.keys()], components: [...components.keys()] } } };
}
const bank = (x, y, extra = {}) => ({ id: `bank-${x}-${y}`, label: 'Synthetic bank', kind: 'bank', members: false,
  chunkId: baseAt(x, y), x, y, witnessTiles: [[x, y]], ...extra });
const spot = (x, y) => ({ id: 'gathering-spot', chunkId: baseAt(x, y), x, y });
const catalogue = { stations: [{ id: 'stone', name: 'Synthetic stone', mapId: 7, plane: 0, x: 69, y: 70, chunkId: baseAt(69, 70),
  coordinateEvidence: { role: 'exact-teleport-destination' }, componentWitness: { mapId: 7, plane: 0 } }],
routes: [{ id: 'home-stone', from: null, to: 'stone', kind: 'lodestone', members: false, f2p: true,
  requirements: { confirmations: ['stone-activated'] } }] };
const unlocked = { gatheringTravelUnlocks: { confirmations: { 'stone-activated': true } } };

test('personal exact lodestone landing has an outbound bank walk and complete return walk', () => {
  const f = fixture(Array.from({ length: 42 }, (_, i) => [69 + i, 70]));
  const provider = createBankingRoutes({ ...f, destinations: [bank(71, 70)], transportCatalogue: catalogue });
  const query = extra => provider.routesForGathering({ method, spots: [spot(110, 70)], availability: { ...f.availability, ...extra } })[0];
  assert.equal(query({}).teleportOption, undefined);
  const result = query(unlocked);
  assert.equal(result.teleportOption.lodestone.id, 'stone');
  assert.equal(result.teleportOption.outboundTileSteps, 2);
  assert.equal(result.teleportOption.returnTileSteps, 39);
  assert.deepEqual(result.teleportOption.returnRuns, [39]);
  assert.equal(query({ ...unlocked, gatheringLodestones: 'off' }).teleportOption, undefined);
  const blocked = fixture(Array.from({ length: 41 }, (_, i) => [70 + i, 70]));
  const fallback = createBankingRoutes({ ...blocked, destinations: [bank(71, 70)], transportCatalogue: catalogue })
    .routesForGathering({ method, spots: [spot(110, 70)], availability: { ...blocked.availability, ...unlocked } })[0];
  assert.equal(fallback.status, 'routed'); assert.equal(fallback.teleportOption, undefined);
});

test('injected upstairs evidence participates in selection without granting an entrance', () => {
  const f = fixture(Array.from({ length: 11 }, (_, i) => [70 + i, 70]));
  const upper = { ...bank(75, 75), plane: 2, mapId: 7, entryPoint: { x: 71, y: 70, plane: 0, mapId: 7 },
    witnessTiles: [[71, 70]], interiorTileSteps: 16, interiorSeconds: 12,
    interiorEstimate: { estimated: true, accessEffect: 'none', assumptions: ['Synthetic stairs estimate.'] } };
  const query = (destinations, candidate = upper) => createBankingRoutes({ ...f, destinations,
    interiorCandidates: { schemaVersion: 1, candidates: [candidate] } }).routesForGathering({ method, spots: [spot(70, 70)], availability: f.availability })[0];
  assert.equal(query([bank(80, 70)]).destination.id, 'bank-80-70');
  const result = query([]);
  assert.equal(result.tileSteps, 1); assert.equal(result.extraTravelSeconds, 24);
  assert.equal(result.destination.plane, 2); assert.equal(result.exactWithinModel, false);
  assert(result.limitations.includes('Synthetic stairs estimate.'));
  assert.equal(query([], { ...upper, witnessTiles: [[90, 90]] }).status, 'no-bank');
});

test('teleport can choose a different bank and includes both interior legs', () => {
  const points = [...Array.from({ length: 101 }, (_, i) => [69 + i, 70]), ...Array.from({ length: 90 }, (_, i) => [169, 71 + i])];
  const f = fixture(points), provider = createBankingRoutes({ ...f, transportCatalogue: catalogue,
    destinations: [bank(169, 160), bank(69, 70, { interiorSeconds: 7.2 })] });
  const result = provider.routesForGathering({ method, spots: [spot(169, 70)], availability: { ...f.availability, ...unlocked } })[0];
  assert.equal(result.destination.id, 'bank-169-160');
  assert.equal(result.teleportOption.destination.id, 'bank-69-70');
  assert.equal(result.teleportOption.outboundTileSteps, 0); assert.equal(result.teleportOption.returnTileSteps, 100);
  assert.equal(result.teleportOption.extraTravelSeconds, 14.4);
});

test('weighted search still prohibits locked diagonal corners', () => {
  const f = fixture([[70, 70], [71, 71]]);
  const result = createBankingRoutes({ ...f, destinations: [bank(71, 71)] })
    .routesForGathering({ method, spots: [spot(70, 70)], availability: f.availability })[0];
  assert.equal(result.status, 'no-bank');
});
