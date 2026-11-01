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
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12850'] }, { id: 'player2', name: 'Player 2', unlocked: ['12852', '12853'] }]);
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
// Wiki supplies 2026-10-17: the retained rel3 core/packs reproduce all six old
// complete fingerprints. Removing only DialogueSupply, FiniteRewards,
// PersonalRequirementAlternatives and SourceLocations from supportedFields,
// plus the new empty finiteRewards arrays, restores those exact old hashes.
// Every task/item/access/prediction value, counter and ordering is unchanged.
// .local/rel4prep5/golden-diff.json records all 120 changed leaves.
// Public consolidation 2026-10-21: the historical rel3 core/packs oracle above
// predates the scrubbed public tree. Its exact private inputs are unavailable,
// so the individual input differences cannot be audited from this tree. These
// six fingerprints use the inline synthetic fixture plus committed duo-legacy
// inputs from a clean git archive of db6ae1b, with no packs, profile, local
// metadata or RS3_* environment overrides. All six reproduce run 39582931047's
// Linux output on Windows; only elapsedMs remains excluded from the full JSON.
// Boss gates 2026-10-25: every result gains a bossGates list (all gates closed
// here; no fixture monster is gated). Dropping only bossGates from the JSON
// reproduces all six previous hashes; no task, item, access or prediction
// value changes. The new hashes match on Linux CI and Windows.
// Boss gear 2026-10-25: each bossGates entry gains condition, missing and gear
// (the group gear check), and closed-gate reasons name the missing gear. All
// gates stay closed. Dropping only bossGates still reproduces main 33932ab's
// stripped hashes in all six modes, so no task, item, access or prediction
// value changes. The new hashes match CI run 40213710811 (Linux) and Windows.
// Boss names 2026-10-31: the reference repairs rename Black Stone Dragon and list
// the six Legio monsters for Legiones. Dropping only bossGates reproduces rel31
// 3b15772's stripped hashes in all six modes; the new hashes match CI run
// 41166557018 (Linux) and Windows.
// Rule explanations 2026-11-01: tasks hidden only because local sources fail the
// task's source conditions (drop-only, non-shop, Wield Crafted Items) now say so and
// list sourcePolicyRejections, instead of the wrong "outside the member's own reachable
// map" reason. A complete leaf diff against main 2a76bfd changes only explanation,
// hiddenReasons[0] and the new sourcePolicyRejections on those rows (9/9/6/0/9/0
// leaves by mode); no status, item, access or prediction value changes.
const expected = {
  shared: 'f71e3d3a6d761c8832b5f3fcadf65fb76a42d673eb3fc6d8ae6f79e6bd61c2a9',
  unshared: 'c08526cd3dd27d691c46071f70d8b2bf6e13862a7d6135fc12dfa1d6c5e45a7b',
  'member-inclusive': 'fb997d6e41ac374bcf35e2046adb44014b2d16370690432127ea3047bf8c3f87',
  backlogs: '4d09fe2e1557df80de0fda2007e64c215ed4852782fe744c1f2b896f3c08d816',
  personal: 'bdaecf3fb234784e1821b651240b204fbc0579661cfdb8d66984b39991507c70',
  'legacy-all': '69ce853874effbb7da38a1c557c03318e1a9d96ca147394ae18d7f2dbbf0fa07',
};

for (const [mode, golden] of Object.entries(expected)) test(`full prediction output retains baseline behavior: ${mode}`, () => {
  const { definitions, state, world } = fixture(mode), before = structuredClone(state);
  const engine = createTaskEngine(definitions, { cacheWalking: false });
  const baseline = engine.evaluate(state, 'player1', { ownItemQueries: ['Product', 'A', 'Ore'] });
  const prediction = predictChunk(state, 'player1', '12851', { world, engine });
  assert.equal(fingerprint({ baseline, prediction }), golden);
  const prepared = prepareChunkPrediction(state);
  assert.equal(fingerprint(prepared('player1', '12851', { world, engine })), fingerprint(prediction));
  assert.equal(fingerprint(prepared('player1', '12850', { world, engine })), fingerprint(predictChunk(state, 'player1', '12850', { world, engine })));
  assert.ok(Object.isFrozen(prediction.state));
  assert.ok(Object.isFrozen(prediction.state.tasks[0]));
  assert.ok(Object.isFrozen(prediction.state.members[0].unlocked));
  assert.deepEqual(state, before);
  state.members[0].notes = { '12850': 'Changed after preparation' };
  assert.equal(prepared('player1', '12851', { world, engine }).state.members[0].notes, undefined, 'Prepared baseline is an independent snapshot');
});

test('cancelled native prediction finishes after its baseline without hypothetical work and accepts the next request', async t => {
  const definitions = { chunks: { '12341': {}, '12342': {}, '12343': {} }, walkableChunks: ['12341', '12342', '12343'],
    walkableChunksF2P: ['12341', '12342', '12343'], challenges: { Quest: {
      'Present quest': { Chunks: ['12341'] }, 'Future quest': { Chunks: ['12342'] }, 'Partner quest': { Chunks: ['12343'] },
    } } };
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  state.members[0].unlocked = ['12341']; state.members[1].unlocked = ['12343']; state.rules['content.f2p'] = false;
  const world = buildWorld(definitions), worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }),
  });
  t.after(() => worker.terminate()); await once(worker, 'message');
  const cancellation = new SharedArrayBuffer(4); Atomics.store(new Int32Array(cancellation), 0, 1);
  const cancelledMessage = once(worker, 'message');
  worker.postMessage({ id: 1, type: 'predict', state, memberId: 'player1', chunkId: '12342', cancellation, predictionProgress: true });
  const [cancelled] = await cancelledMessage;
  assert.equal(cancelled.id, 1); assert.equal(cancelled.error, undefined); assert.deepEqual(cancelled.result, { cancelled: true });
  assert.equal(cancelled.type, undefined, 'cancellation sends a final response instead of owner preparation');
  assert.equal(cancelled.unlockReuse, undefined); assert.equal(cancelled.partnerUnlockReuse, undefined);
  assert.equal(cancelled.playJSON, undefined); assert.equal(cancelled.duoJSON, undefined); assert.equal(cancelled.duoSidebarJSON, undefined);
  assert.equal(cancelled.timingMs.predictionMs, 0); assert.equal(cancelled.evaluationMs, cancelled.timingMs.totalMs);
  const nextMessage = once(worker, 'message');
  worker.postMessage({ id: 2, type: 'predict', state, memberId: 'player1', chunkId: '12342' });
  const [next] = await nextMessage;
  assert.equal(next.id, 2); assert.equal(next.error, undefined); assert.equal(next.result.cancelled, undefined);
  assert.ok(next.result.delta.tasksAdded.some(task => task.label === 'Future quest'));
  assert.equal(next.unlockReuse.memberId, 'player1'); assert.equal(next.partnerUnlockReuse.memberId, 'player2');
});

