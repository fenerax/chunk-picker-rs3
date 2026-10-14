import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { predictChunk, prepareChunkPrediction } from '../app/core/planning.mjs';

function fixture(mode) {
  const definitions = {
    chunks: {
      '12850': { Spawn: { Seed: 1 }, Shop: { General: true }, Object: { Furnace: true } },
      '12851': { Monster: { Goblin: true }, Object: { Tree: true }, Connect: { Cave: true } },
      '12852': { Sections: { '1': { Spawn: { Coal: 2 } }, '2': { Spawn: { Gem: 1 } } } },
      '12853': { Monster: { Thug: true }, Spawn: { 'Unknown token': 1 } },
      Cave: { Spawn: { Gem: 3 }, Connect: { '12851': true } },
    },
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850', '12852-1'] }, '12852': { '1': ['12851'], '2': ['12853'] } },
    walkableChunks: ['12850', '12851', '12852', '12853'], walkableChunksF2P: ['12850', '12851', '12852', '12853'],
    codeItems: { itemsPlus: { 'Fuel[+]': ['Seed', 'Coal'] }, dropTables: { Table: { Coin: '1/10@2', Nested: { '1': '1/2' } }, Nested: { Coin: { '3': 'Always' }, Rare: { '1': 'Unknown' } } } },
    drops: { Goblin: { Table: { '1': '1/10' }, Coin: { '1': 'Always' }, Ore: { '2': '1/100' } }, Thug: { Ore: { '1': '1/1000' } } },
    shopItems: { General: { Seed: true, Coin: 5 } }, objectItems: { Furnace: { Ore: 'Always@1' } },
    taskUnlocks: { Items: { 'Ore^Goblin': [{ Gate: 'Quest' }], Product: [{ Gate: 'Quest' }] }, Shops: { 'General^Coal': { '12850': [{ Gate: 'Quest' }] } } },
    equipment: { Product: { slot: 'main hand weapon', class: 'melee', tier: 1, requirements: { Attack: 1 } } },
    challenges: {
      Woodcutting: { 'Cut ~|Logs|~': { Objects: ['Tree'], Level: 1, Primary: true, Output: 'Logs' }, Oak: { Level: 15, Items: ['Logs*'], Primary: true, Output: 'Oak logs' } },
      Smithing: { Make: { Items: ['Ore'], Objects: ['Furnace'], Output: 'Product', Primary: true }, High: { Level: 40 } },
      Attack: { Wield: { Items: ['Product'], Level: 1 } },
      Quest: { Gate: { Chunks: ['12851'], QuestPoints: 1, XpReward: { Smithing: 1000 } }, Member: { Chunks: ['12853'], 'Not F2P': true } },
      Extra: { Pair: { Items: ['Fuel[+]x2'] }, Nonshop: { Items: ['Coin'], NonShop: true }, Drop: { Items: ['Ore'], Source: 'drop' }, Cave: { Chunks: ['Cave'] }, Unknown: { Bespoke: true }, A: { Items: ['B'], Output: 'A' }, B: { Items: ['A'], Output: 'B' }, Self: { Tasks: { Self: 'Extra' } } },
    },
  };
  const world = buildWorld(definitions, { cacheWalking: false });
  const state = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['12850'] }, { id: 'reed', name: 'Reed', unlocked: ['12852', '12853'] }]);
  const catalogue = createTaskEngine(definitions, { cacheWalking: false }).catalogue;
  state.tasks = catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.members[1].sectionOverrides = { '12852-1': true, '12852-2': true };
  state.members[0].taskRules = { Boosting: true, 'Rare Drop': false, 'Rare Drop Amount': '1/100', 'Secondary Primary Amount': '1/100', 'Wield Crafted Items': false };
  if (mode === 'unshared') state.rules['access.shared'] = false;
  if (mode === 'member-inclusive') { state.rules['content.f2p'] = false; state.members[0].taskRules['Rare Drop Inclusive'] = true; state.members[0].taskRules['Wield Crafted Items'] = true; }
  if (mode === 'backlogs') { state.members[0].sourceBacklogs = { items: { Ore: true }, objects: { Tree: true } }; state.members[0].areaOverrides = { Cave: false }; state.members[0].taskRules.Skills = false; }
  if (mode === 'personal') { state.rules['tasks.completion'] = 'personal'; state.members[1].completedTasks = [taskId('Quest', 'Gate')]; state.members[0].pendingRoll = ['12851', '12853']; state.members[0].passiveLevels = { Smithing: 40 }; state.members[0].maxLevels = { Woodcutting: 5 }; }
  if (mode === 'legacy-all') { state.rules['tasks.completion'] = 'all'; state.members[0].sourceMapId = 'old'; state.legacy = { maps: { old: { rules: { 'Rare Drop': true }, chunkinfo: { manualMonsters: { Items: { 'Manual-_-20ore': true } }, passiveSkill: { Attack: 10 }, backloggedSources: { items: { Ore: true } } } } } }; state.members[0].taskStatus = { [taskId('Quest', 'Gate')]: { challengeCompleted: true } }; state.members[1].completedTasks = [taskId('Quest', 'Gate')]; }
  return { definitions, state, world };
}

const fingerprint = value => createHash('sha256').update(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child)).digest('hex');

// Complete JSON output from the full (uncached) evaluator once the house-storage and
// training helpers joined it (codex/helpers 7772b1a); prediction caching must reproduce it.
// Only elapsedMs is omitted; row/source/diagnostic ordering and counters are covered.
// F2P audit 2026-10-08: the exact fixture names Seed (cache ID 39702) and
// Coin (34335) are members items. F2P now excludes their spawn/shop/drop paths
// and dependent Pair/Nonshop goals, and reports members-only-item diagnostics.
// Refresh only the five free-mode hashes; member-inclusive remains unchanged.
// Processing parity 2026-10-08: every scenario previously reported Product as
// an own origin even though its quest-gated output had not been admitted. Own
// supply queries now require actual source proof, removing that phantom origin
// in all six baselines. The two backlogged scenarios also perform fewer checks.
// Full before/after object diffs verified no other gameplay changes; coverage
// metadata additionally records the new processing fields and bounded support.
// Data accuracy 2026-10-09: complete object diffs against 10f75a6 change only
// supportedFields (RequirementAlternatives) in five fixtures. The legacy-all
// fixture also derives passive Combat 4 from its declared Attack 10, using the
// pinned combat formula. No task/item/access/prediction outcome otherwise changes.
// Settings wording 2026-10-12: compare complete baseline and prediction JSON
// against a disposable source copy of 6f8de57^ (6c8fcb6), using these identical
// six fixtures and options. All original hashes reproduced. The 122 changed
// leaves are seven user-facing explanation, blocker-detail and coverage texts.
// Object keys, arrays, counters and every gameplay value remain identical.
// Exact path/value diffs and matching gameplay hashes are recorded locally in
// .local/prediction-wording-audit/report.json; audit.mjs reproduces the comparison.
// Membership H6 2026-10-12: a complete object comparison against the isolated
// pre-change app reproduced all six old hashes. Only coverage.supportedFields
// gains RequirementAlternativesDescription; task/item/access outcomes are equal.
// .local/prediction-membership-audit.json records every changed leaf.
// Hand-recorded equipment 2026-10-12: all six previous hashes reproduce after
// deleting only prediction.state.members[0/1].obtainedEquipment, each default [].
// No baseline, gameplay, ordering or counter changes occur in these fixtures.
// .local/bis-prediction-audit.{mjs,json} record the exact schema-only diff.
// Divination 2026-10-13: removing only PersonalQuestProgress from the baseline
// and prediction result's coverage.supportedFields reproduces all six previous
// complete JSON hashes. No fixture gameplay, ordering or counters change.
// .local/prediction-divination-audit.json records the twelve metadata additions.
// Craftdata H4/H5 2026-10-13: all six complete fingerprints below still pass.
// These fixtures contain no repaired retained record, conditional mixed-input
// chain, completed unsupported task or Hide Partial Products variant. Their
// task/item/access/prediction outputs and counters therefore remain unchanged.
// F2P batch 4 2026-10-14: removing only ManualChecks and CompletedTasks from
// baseline and prediction.result coverage.supportedFields restores all six
// previous complete JSON hashes. Gameplay, ordering and counters are unchanged.
// A local audit for that batch recorded the 24 added metadata entries.
const expected = {
  shared: 'e1b7796a3782ff476910b6f9e2f41a85d2a44f31c98af5efdbd9acad86733308',
  unshared: 'e1500e0bd03897ff96f9917e8fa2957f87d19aa08704602a403902aa9200c684',
  'member-inclusive': 'a7a57344d83b9b070a6e7fb892eee58c4888f4d79260de5e23c8068751f305c7',
  backlogs: '96f0283c49e0a4d880901a084d8ce2e3af579d3472f948f237df25e99ab3c718',
  personal: '61a8562b8ce58b41a8cf38237a1360007474e28f6b6484befb37b0a58f3decfb',
  'legacy-all': '862cbd61bd23d4509460e4537986fc8f77b053ed6e3cd2ec32c1c7debf81e652',
};



test('worker baseline cache distinguishes unchanged revision with different rules or input fingerprints', async t => {
  const { definitions, state, world } = fixture('shared');
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate());
  await once(worker, 'message');
  let id = 0;
  const send = async input => { const response = once(worker, 'message'); worker.postMessage({ id: ++id, type: 'death-estimates', state, memberId: 'actor1', chunkIds: ['12851'], ...(input === undefined ? {} : { input }) }); const [message] = await response; assert.equal(message.error, undefined); return message.result; };
  assert.equal((await send()).cache.baselineHit, false);
  assert.equal((await send()).cache.baselineHit, true);
  state.rules['access.shared'] = false;
  assert.equal((await send()).cache.baselineHit, false);
  assert.equal((await send('input-one')).cache.baselineHit, false);
  assert.equal((await send('input-one')).cache.baselineHit, true);
  state.members[0].taskRules.Boosting = false;
  assert.equal((await send('input-one')).cache.baselineHit, false, 'Explicit input does not hide an effective-rule change');
  assert.equal((await send('input-two')).cache.baselineHit, false);
});

test('worker accepts a bounded keyed state snapshot and rejects an evicted key without returning gameplay', async t => {
  const { definitions, state, world } = fixture('shared');
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate());
  await once(worker, 'message');
  let id = 0;
  const send = async (snapshotKey, fullState, memberId = 'actor1') => {
    const response = once(worker, 'message');
    worker.postMessage({ id: ++id, type: 'predict', snapshotKey, ...(fullState ? { state } : {}), memberId, chunkId: '12851', input: snapshotKey });
    return (await response)[0];
  };
  const first = await send('one', true), repeat = await send('one', false);
  assert.equal(first.error, undefined);
  assert.equal(fingerprint(first.result), fingerprint(repeat.result));
  assert.equal((await send('one', false, 'reed')).error, undefined, 'Both member baselines can share one state snapshot');
  for (const key of ['two', 'three', 'four', 'five']) assert.equal((await send(key, true)).error, undefined);
  const evicted = await send('one', false);
  assert.match(evicted.error.message, /state snapshot is missing/);
  assert.equal(evicted.result, undefined);
  assert.equal((await send('one', true)).error, undefined, 'Resending full state recovers an evicted snapshot');
});

test('ordinary worker evaluation leaves full-state prediction cloning lazy, even with large retained records', async t => {
  const { definitions, state, world } = fixture('shared');
  state.legacy = { maps: { synthetic: { chunkinfo: {}, capturedRecord: 'Synthetic retained evidence. '.repeat(40000) } } };
  const workerUrl = new URL('../app/tasks/worker.mjs', import.meta.url).href;
  const instrumentation = `
    import { parentPort } from 'node:worker_threads';
    let fullStateStringifies = 0;
    const stringify = JSON.stringify;
    JSON.stringify = (value, ...options) => {
      if (value && typeof value.schemaVersion === 'number' && Array.isArray(value.members) && Array.isArray(value.tasks)) fullStateStringifies++;
      return stringify(value, ...options);
    };
    const post = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = (message, ...options) => post({ ...message, fullStateStringifies }, ...options);
    await import(${JSON.stringify(workerUrl)});
  `;
  const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(instrumentation).toString('base64')}`), { workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate());
  await once(worker, 'message');
  let id = 0;
  const send = async type => {
    const response = once(worker, 'message');
    worker.postMessage({ id: ++id, type, state, memberId: 'actor1', chunkId: '12851' });
    const [message] = await response;
    assert.equal(message.error, undefined);
    return message;
  };
  const evaluated = await send('evaluate');
  assert.equal(evaluated.fullStateStringifies, 0, 'Task views must not prepare an unused prediction snapshot');
  assert.equal(evaluated.timingMs.predictionMs, 0);
  const predicted = await send('predict');
  assert.ok(predicted.fullStateStringifies > 0, 'The first prediction validates an independent full-state snapshot');
  const repeated = await send('predict');
  assert.equal(repeated.fullStateStringifies, predicted.fullStateStringifies, 'Later candidates reuse the prepared snapshot');
  assert.equal(fingerprint(repeated.result), fingerprint(predicted.result));
});
