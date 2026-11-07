// Public, deterministic normal-size duo: 64 surface chunks, 2,048 challenges,
// two six-chunk maps, shared supplies, processing chains and ordered evidence.
import { createGroupState } from '../../app/core/state.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';

export function previewProofFixture({ taskCount = 2048 } = {}) {
  const ids = Array.from({ length: 64 }, (_, i) => String((48 + Math.floor(i / 8)) * 256 + 48 + i % 8));
  const challenges = { Woodcutting: {}, Firemaking: {}, Crafting: {}, Quest: {}, Extra: {}, Nonskill: {} };
  const chunks = Object.fromEntries(ids.map((id, i) => [id, {
    Object: { [`Tree ${i % 4}`]: 1, ...(i % 2 ? { Furnace: 1 } : { Anvil: 1 }) },
    Spawn: { [`Material ${i % 4}`]: 1 }, Monster: { Creature: 1 }, Shop: { Supplies: 1 },
  }]));
  for (let i = 0; i < taskCount / 4; i++) {
    challenges.Woodcutting[`Gather ${i}`] = { Level: i % 50 + 1, Chunks: [ids[i % ids.length]], Objects: [`Tree ${i % 4}`], Primary: true, Output: `Logs ${i}` };
    challenges.Firemaking[`Burn ${i}`] = { Level: i % 50 + 1, Items: [`Logs ${i}`], Primary: true };
    challenges.Crafting[`Make ${i}`] = { Level: i % 40 + 1, Items: [`Material ${i % 4}`], Objects: ['Anvil'], Output: `Token ${i}` };
    challenges.Extra[`Use ${i}`] = { Items: [`Token ${i}`, 'Loot'], Chunks: [ids[(i + 1) % ids.length]] };
  }
  challenges.Nonskill = { 'First permit': { Chunks: [ids[0]], Output: 'Permit' },
    'Cycle left': { Items: ['Cycle right'], Output: 'Cycle left' }, 'Cycle right': { Items: ['Cycle left'], Output: 'Cycle right' } };
  challenges.Quest = { Prepare: { Items: ['Permit'], Output: 'Medal' }, Finish: { Tasks: { Prepare: 'Quest' }, QuestPoints: 2 } };
  const definitions = { chunks, challenges, walkableChunks: ids, walkableChunksF2P: ids,
    drops: { Creature: { Loot: { 1: '1/2' } } }, shopItems: { Supplies: { 'Material 0': true, 'Material 1': true } },
    equipment: {}, codeItems: {}, objectItems: { 'Tree 0': { 'Material 0': true } } };
  const datasetOptions = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
    reviewedOverlays: false, metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
    retainedUnsupportedCorrections: false, divinationTraining: false };
  const engine = createTaskEngine(definitions, { ...datasetOptions, dataset: selectedDataset });
  const state = createGroupState([
    { id: 'one', name: 'Explorer 1', unlocked: ids.slice(0, 6), sourceMapId: 'map-one' },
    { id: 'two', name: 'Explorer 2', unlocked: ids.slice(16, 22), sourceMapId: 'map-two' },
  ]);
  const registry = createRuleRegistry();
  for (const [id, value] of Object.entries({ 'content.f2p': false, 'access.shared': true, 'travel.automatic': false, 'access.transport': false }))
    if (registry.get(id)) state.rules[id] = value;
  state.tasks = engine.catalogue;
  for (const member of state.members) {
    member.taskRules = { 'Show Nonskill Tasks': true };
    member.taskStatus = { [engine.catalogue[0].id]: { challengeCompleted: true } };
  }
  const world = buildWorld(definitions, { ...datasetOptions, dataset: selectedDataset });
  const workerData = { definitions, world: { chunks: world.chunks, surface: world.surface }, datasetOptions,
    datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest };
  return { state, definitions, engine, world, workerData };
}
