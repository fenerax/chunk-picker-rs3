import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { projectPlayResult } from '../app/play-view.mjs';
import { projectDuoPlayResult, projectDuoSidebarResult } from '../app/duo-play-view.mjs';
import { builtInRules, createRuleRegistry } from '../app/core/rules.mjs';

// A small public world exercises the same complete closure and projections as
// the private oracle. The slow path disables the new reuse, not task semantics.
const ids = Array.from({ length: 12 }, (_, index) => String(12337 + index));
const engineOptions = { cacheWalking: false, cacheResources: false, cacheArchaeology: false,
  cacheShops: false, metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false };
function fixture() {
  const chunks = Object.fromEntries(ids.map((id, index) => [id, {
    Object: { [`Tree ${index % 3}`]: 1, ...(index % 2 ? { Furnace: 1 } : { Anvil: 1 }) },
    Spawn: { [`Seed ${index % 3}`]: index + 1 },
    Monster: { Imp: 1 }, Shop: { Supplies: 1 },
    ...(index === 0 ? { Connect: { Cave: true } } : {}),
  }]));
  chunks.Cave = { Connect: { [ids[0]]: true }, Spawn: { Token: 2 } };
  const challenges = {
    Nonskill: { First: { Items: ['Seed 0'], Output: 'Key' },
      Second: { Tasks: { First: 'Nonskill' }, Output: 'Permit' },
      Cave: { UnlocksArea: true, Items: ['Permit'] },
      Bench: { Items: ['Permit'], 'Output Object': 'Workbench', Chunks: [ids[0], ids[1]] } },
    Woodcutting: Object.fromEntries([0, 1, 2].map(index => [`Logs ${index}`, {
      Level: index * 10 + 1, Objects: [`Tree ${index}`], Primary: true, Output: `Logs ${index}`,
    }])),
    Firemaking: Object.fromEntries([0, 1, 2].map(index => [`Burn ${index}`, {
      Level: index * 10 + 1, Items: [`Logs ${index}`], Primary: true,
    }])),
    Crafting: { Craft: { Level: 1, Items: ['Token'], Objects: ['Workbench'], Primary: true, Output: 'Badge' },
      Competing: { Level: 10, Items: ['Token'], Output: 'Badge' } },
    Quest: { Finish: { Items: ['Key'], QuestPoints: 2, Reward: 'Medal' } },
    Extra: { Alias: { Items: ['Seeds[+]x2'] }, Gate: { Items: ['Badge', 'Medal'] },
      Points: { QuestPointsNeeded: 2 }, Missing: { Items: ['Absent'] } },
  };
  // Repeated false producer proofs and cycles must remain path-specific. The
  // late independent producer turns those proofs true after either unlock.
  Object.assign(challenges.Nonskill, {
    'Cycle A': { Items: ['Cycle B'], Output: 'Cycle A' },
    'Cycle B': { Items: ['Cycle A'], Output: 'Cycle B' },
    'Late root': { Chunks: [ids.at(-1)], Output: 'Cycle A' },
    'Ordered left': { Tasks: { 'Ordered right': 'Nonskill', 'Late root': 'Nonskill' } },
    'Ordered right': { Tasks: { 'Ordered left': 'Nonskill' } },
  });
  for (let index = 0; index < 8; index++) challenges.Extra[`Cycle consumer ${index}`] = { Items: ['Cycle A', 'Cycle B'] };
  const definitions = { chunks, challenges, walkableChunks: ids, walkableChunksF2P: ids,
    shopItems: { Supplies: { Token: true, 'Seed 0': 3 } },
    drops: { Imp: { LootDropTable: { 1: '1/2' }, Token: { 2: '1/4' } } },
    objectItems: { 'Tree 0': { 'Seed 0': true }, 'Tree 1': { 'Seed 1': '1/2@2' } },
    codeItems: { itemsPlus: { 'Seeds[+]': ['Seed 0', 'Seed 1', 'Seed 2'] },
      dropTables: { LootDropTable: { Token: '1/3@2', NestedDropTable: '1/2' },
        NestedDropTable: { 'Seed 2': '1/4', CycleDropTable: '1/2' }, CycleDropTable: { CycleDropTable: '1/2' } } },
    taskUnlocks: { Objects: { 'Tree 2': Object.fromEntries(ids.map(id => [id, [{ First: 'Nonskill' }, { Second: 'Nonskill' }]])) },
      Items: { Badge: { Second: 'Nonskill' } }, Shops: { 'Supplies^Permit': { [ids[1]]: { First: 'Nonskill' } } } },
  };
  const state = { schemaVersion: 1, revision: 0, history: [], tasks: [], rules: { 'access.shared': true },
    taskRules: { 'Show Nonskill Tasks': true, Boosting: true }, members: [
      { id: 'a', name: 'A', unlocked: [ids[0]], selected: [], completedTasks: [], sourceMapId: 'old',
        teleports: [{ destination: ids[0], available: true }, { destination: ids[5], available: true }] },
      { id: 'b', name: 'B', unlocked: [ids[5]], selected: [], completedTasks: [],
        teleports: [{ destination: ids[0], available: true }, { destination: ids[5], available: true }] },
    ], legacy: { maps: { old: { chunkinfo: { completedChallenges: { Extra: { Missing: true } }, backlog: { Extra: { Points: true } } } } } } };
  const engine = createTaskEngine(definitions, engineOptions);
  return { definitions, state, engine };
}
const bytes = value => JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child);
const registry = createRuleRegistry(builtInRules.some(rule => rule.id === 'content.f2p') ? []
  : [{ id: 'content.f2p', type: 'boolean', default: true }]);
function compare(engine, definitions, state, memberId) {
  const saved = bytes(state);
  const slow = createTaskEngine(definitions, engineOptions).evaluate(state, memberId,
    { reuseEligibility: false, reuseObligations: false });
  const fast = engine.evaluate(state, memberId);
  assert.equal(bytes(fast), bytes(slow), `${memberId}: complete result and property/source order`);
  const retained = engine.evaluate(state, memberId);
  assert.equal(retained.metrics.eligibilityCacheHit, true);
  assert.equal(bytes(retained), bytes(slow), `${memberId}: retained eligibility bytes`);
  assert.deepEqual(retained.processing, slow.processing, `${memberId}: retained processing proof`);
  for (const key of Object.keys(slow.metrics).filter(key => key !== 'elapsedMs')) assert.equal(fast.metrics[key], slow.metrics[key], key);
  slow.presentation = selectPresentedTasks(slow, state, memberId, definitions, { reuse: false });
  fast.presentation = selectPresentedTasks(fast, state, memberId, definitions);
  assert.equal(bytes(fast), bytes(slow), `${memberId}: complete presentation`);
  const slowPlay = projectPlayResult(slow, { reuse: false }), fastPlay = projectPlayResult(fast);
  assert.equal(bytes(fastPlay), bytes(slowPlay), `${memberId}: play bytes`);
  assert.equal(bytes(projectDuoPlayResult(fastPlay, state)), bytes(projectDuoPlayResult(slowPlay, state)), `${memberId}: peer bytes`);
  assert.equal(bytes(projectDuoSidebarResult(fastPlay, state, registry, memberId)),
    bytes(projectDuoSidebarResult(slowPlay, state, registry, memberId, { reuse: false })), `${memberId}: sidebar bytes`);
  assert.equal(bytes(state), saved, 'read-only input');
}

test('complete calculation and all projections match without reuse across both owners and every fixture unlock', () => {
  const { engine, definitions, state } = fixture();
  for (const owner of state.members) {
    for (const id of [null, ...ids.filter(id => !owner.unlocked.includes(id))]) {
      const after = structuredClone(state);
      if (id) after.members.find(member => member.id === owner.id).unlocked.push(id);
      for (const member of after.members) compare(engine, definitions, after, member.id);
    }
  }
});

test('obligation proofs stay cold-equivalent across growth, retraction, source gates and completion edits', () => {
  const { engine, definitions, state } = fixture();
  const check = () => { for (const member of state.members) compare(engine, definitions, state, member.id); };
  check();
  for (const member of state.members) {
    for (const edit of [
      () => member.unlocked.push(ids.at(-1)),
      () => member.sourceBacklogs = { items: { 'Cycle A': true } },
      () => member.sourceBacklogs.items['Cycle A'] = false,
      () => member.taskStatus = { [taskId('Nonskill', 'Late root')]: { backlogged: true } },
      () => member.taskStatus[taskId('Nonskill', 'Late root')].backlogged = false,
      () => member.completedTasks.push(taskId('Nonskill', 'Cycle A'), taskId('Nonskill', 'Ordered left')),
      () => member.completedTasks = [],
      () => member.areaOverrides = { Cave: false },
      () => member.areaOverrides.Cave = true,
      () => member.unlocked.pop(),
    ]) { edit(); state.revision++; check(); }
  }
  for (const value of [false, true]) {
    state.rules['access.shared'] = value; state.revision++; check();
    state.rules['content.f2p'] = value; state.revision++; check();
  }
});
