// Synthetic, bounded CPU probe; no server, save, private inputs or disk writes.
// Run through the light wrapper. Optional --root points to a base source tree.
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
  'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR']) delete process.env[key];
const rootIndex = process.argv.indexOf('--root');
const root = path.resolve(rootIndex < 0 ? '.' : process.argv[rootIndex + 1]);
const load = file => import(pathToFileURL(path.join(root, file)));
const { buildWorld } = await load('app/data/world.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const { configureAutomaticTransport } = await load('app/core/automatic-transport.mjs');
const { evaluateTransportRoutes } = await load('app/core/transport-access.mjs');
let requireTeleportReturns;
try { ({ requireTeleportReturns } = await load('app/core/teleport-returns.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; } // Pre-feature base comparison.
// Synthetic coordinates deliberately extend beyond the small public dataset.
const ids = Array.from({ length: 2048 }, (_, i) => String(((40 + i) << 8) | 40));
const definitions = { chunks: Object.fromEntries(ids.map(id => [id, {}])),
  sections: Object.fromEntries(ids.map(id => [id, { '0': [], '1': [], '2': [], '3': [] }])),
  walkableChunks: ids, walkableChunksF2P: ids, codeItems: {}, challenges: {} };
const world = buildWorld(definitions, { cacheWalking: false, cacheResources: false, cacheArchaeology: false,
  cacheShops: false, metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false, lodestones: [] });
const destinations = ids.slice(-30), owned = ids.slice(0, 100);
const catalogue = { stations: destinations.map(chunkId => ({ id: chunkId, chunkId, plane: 0, mapId: 28,
  x: (Number(chunkId) >> 8) * 64 + 1, y: (Number(chunkId) & 255) * 64 + 1, coordinateEvidence: 'synthetic' })),
  routes: destinations.map(to => ({ id: `stone-${to}`, name: 'Synthetic lodestone', from: null, to, kind: 'lodestone',
    f2p: true, members: false, automatic: { activation: 'default' },
    requirements: { levels: {}, quests: [], items: [], fare: null, conditions: [], confirmations: [`lodestone-${to}-activated`] } })) };
world.transportRoutes = catalogue;
const state = createGroupState([{ id: 'explorer', name: 'Explorer', unlocked: owned }, { id: 'partner', name: 'Partner', unlocked: owned }]);
state.tasks = Array.from({ length: 20000 }, (_, i) => ({ id: `synthetic:${i}`, category: 'Extra', label: `Task ${i}` }));
Object.assign(state.rules, { 'content.f2p': false, 'travel.automatic': true, 'access.transport': true });
configureAutomaticTransport(world, { engine: { evaluate: (input, memberId) => ({ tasks: state.tasks, items: [], training: {},
  access: { bases: input.members.find(row => row.id === memberId).unlocked, sections: [] } }) } });
const raw = catalogue.routes.map(row => ({ ...row, global: true, available: true, cost: {}, unmet: [], unknown: [] }));
function sample(fn, count = 5) {
  fn(-1);
  const times = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); fn(i); times.push(performance.now() - start); }
  return { medianMs: +times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(2), samplesMs: times.map(n => +n.toFixed(2)) };
}
const evaluate = input => evaluateTransportRoutes(world, input, 'explorer', { transportRoutes: catalogue });
const first = performance.now(), rows = evaluate(state), coldMs = performance.now() - first;
const usable = rows.filter(row => row.available || row.rollAvailable).length;
assert.equal(usable, requireTeleportReturns ? 0 : 30);
const result = { chunks: ids.length, sections: ids.length * 4, tasksPerMember: state.tasks.length, lodestones: 30,
  usable, rowsSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), coldMs: +coldMs.toFixed(2),
  ...(requireTeleportReturns ? {
    returnProofUncached: sample(() => requireTeleportReturns(world, state, 'explorer', raw, { transportRoutes: catalogue, returnProofCache: false })),
    returnProofWarm: sample(() => requireTeleportReturns(world, state, 'explorer', raw, { transportRoutes: catalogue })),
  } : {}),
  teleportsWarm: sample(() => assert.deepEqual(evaluate(state), rows)),
  selectionOnly: sample(i => { const next = structuredClone(state); next.revision++; next.members[0].selected = [ids[110 + i]];
    assert.deepEqual(evaluate(next), rows); }) };
console.log(JSON.stringify(result, null, 2));
