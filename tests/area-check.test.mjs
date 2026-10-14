import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAreaCheck, normalizeAreaCheckRequest, AREA_CHECK_MAX_CHUNKS } from '../app/tasks/area-check.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { predictChunk } from '../app/core/planning.mjs';

const emptyCatalogue = { methods: [] };
function fixture() {
  const definitions = {
    chunks: { '12850': { Object: { 'Starter rock': true, Tree: true } }, '12851': { Object: { 'High rock': true, Colossus: true } },
      '12852': { Object: { 'Highest rock': true } } },
    walkableChunks: ['12850', '12851', '12852'], walkableChunksF2P: ['12850', '12851', '12852'],
    sections: { '12850': { '0': ['12851'] }, '12851': { '0': ['12850', '12852'] }, '12852': { '0': ['12851'] } },
    challenges: {
      Mining: { 'Mine starter rock': { Level: 1, Primary: true, Objects: ['Starter rock'] },
        'Mine high rock': { Level: 40, Primary: true, Objects: ['High rock'] },
        'Mine highest rock': { Level: 80, Primary: true, Objects: ['Highest rock'] } },
      Woodcutting: { 'Cut trees': { Level: 1, Primary: true, Objects: ['Tree'] },
        'Chop useless log': { Level: 1, Primary: true, NoXp: true, Objects: ['Tree'] } },
      Divination: { 'Harvest Colossus energy': { Level: 77, Primary: true, Objects: ['Colossus'], 'Not F2P': true } },
      Quest: { 'Open bridge': { Chunks: ['12851'], Skills: { Construction: 30, Slayer: 28, Divination: 77 }, 'Not F2P': true } },
    },
  };
  const engine = createTaskEngine(definitions), world = buildWorld(definitions);
  const state = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['12850'] }, { id: 'reed', name: 'Reed', unlocked: [] }]);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  return { definitions, engine, world, state, catalogue: emptyCatalogue };
}
const row = (result, skill) => result.rows.find(value => value.skill === skill);







test('empty selection has empty alone summaries and preserves current combined capabilities', () => {
  const context = fixture();
  const result = analyzeAreaCheck(context.state, 'actor1', { chunkIds: [] }, context);
  assert.ok(result.rows.every(value => value.alone.methodCount === 0 && value.alone.lowest === null
    && value.alone.highest === null && value.alone.reachableLevel === null && value.alone.bootstrapGap === null));
  assert.equal(row(result, 'Mining').combined.lowest.level, 1);
});

test('selection validation is bounded, canonical and rejects unknown/interior IDs and fields', () => {
  const context = fixture();
  const options = { ...context, memberId: 'actor1' };
  assert.deepEqual(normalizeAreaCheckRequest({ chunkIds: ['12851', '12850', '12851'] }, options),
    { chunkIds: ['12850', '12851'], asMembers: false });
  assert.throws(() => normalizeAreaCheckRequest({ chunkIds: Array(AREA_CHECK_MAX_CHUNKS + 1).fill('12850') }, options), /at most 128/);
  for (const id of ['12850-0', 'unknown', 12850, '01']) assert.throws(() => normalizeAreaCheckRequest({ chunkIds: [id] }, options), /base IDs/);
  assert.throws(() => normalizeAreaCheckRequest({ chunkIds: ['123'] }, options), /outside/);
  assert.throws(() => normalizeAreaCheckRequest({ chunkIds: [], asMembers: 'true' }, options), /boolean/);
  assert.throws(() => normalizeAreaCheckRequest({ chunkIds: [], extra: true }, options), /Unknown area-check field/);
  assert.throws(() => normalizeAreaCheckRequest({ chunkIds: [] }, { ...options, memberId: 'other' }), /Unknown area-check member/);
});

test('Helper candidates defer known challenges to engine rules and fail closed on absent locations', () => {
  const context = fixture();
  context.state.members[0].taskRules = { Special: false };
  context.definitions.challenges.Mining['Mine starter rock'].Category = ['Special'];
  context.engine = createTaskEngine(context.definitions);
  context.catalogue = { methods: [
    { id: 'known', skill: 'Mining', label: 'Mine starter rock', level: 1, members: false, matches: ['Mine starter rock'], requirements: [{ kind: 'object', name: 'Starter rock' }] },
    { id: 'absent', skill: 'Woodcutting', label: 'Absent tree', level: 1, members: false, requirements: [{ kind: 'object', name: 'Absent tree' }] },
    { id: 'global-item', skill: 'Crafting', label: 'Spin absent flax', level: 1, members: false, inputs: [{ item: 'Absent flax' }] },
  ] };
  const result = analyzeAreaCheck(context.state, 'actor1', { chunkIds: ['12850'] }, context);
  assert.equal(row(result, 'Mining').alone.methodCount, 0);
  assert.ok(result.rows.every(value => value.alone.methods.every(method => !['known', 'absent', 'global-item'].includes(method.id))));
});


test('disconnected partner training cannot enter either range', () => {
  const context = fixture();
  context.state.members[1].unlocked = ['12852'];
  context.definitions.sections['12851']['0'] = ['12850'];
  context.definitions.sections['12852']['0'] = [];
  context.engine = createTaskEngine(context.definitions);
  context.world = buildWorld(context.definitions);
  const result = analyzeAreaCheck(context.state, 'actor1', { chunkIds: ['12851'] }, context);
  assert.equal(row(result, 'Mining').alone.highest.level, 40);
  assert.equal(row(result, 'Mining').combined.highest.level, 40);
});



test('a requirement at a usable method entry marks that interval as the target', () => {
  const context = fixture();
  context.definitions.challenges.Quest['Mining goal'] = { Chunks: ['12851'], Requirements: { Mining: 40 } };
  context.engine = createTaskEngine(context.definitions);
  const mining = row(analyzeAreaCheck(context.state, 'actor1', { chunkIds: ['12850', '12851'] }, context), 'Mining').alone;
  assert.equal(mining.trainingGaps.length, 1);
  assert.equal(mining.trainingGaps[0].kind, 'requirement');
  assert.equal(mining.trainingGaps[0].toLevel, 40);
  assert.equal(mining.trainingGaps[0].evidence[0].label, 'Mining goal');
});


test('training-blocked goals cannot become targets until current chunks admit them', () => {
  const context = fixture();
  context.definitions.challenges.Quest['Lower mining goal'] = { Chunks: ['12851'], Skills: { Mining: 20 } };
  context.definitions.challenges.Quest['Highest mining goal'] = { Chunks: ['12851'], Requirements: { Mining: 30 } };
  context.engine = createTaskEngine(context.definitions);
  const mining = row(analyzeAreaCheck(context.state, 'actor1', { chunkIds: ['12851'] }, context), 'Mining');
  assert.equal(mining.alone.gapTarget, null);
  assert.equal(mining.alone.bootstrapGap, null, 'the first method does not create a target from a blocked duty');
  assert.equal(mining.combined.gapTarget.level, 30);
  assert.equal(mining.combined.bootstrapGap, null, 'current chunks supply the starting method');
  assert.equal(mining.combined.trainingGaps[0].toLevel, 30);
});






test('Area check leaves gameplay fingerprints, task evaluation and unlock predictions unchanged', () => {
  const context = fixture(), fingerprint = createGameplayFingerprint();
  const clean = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child));
  const saved = structuredClone(context.state), beforeFingerprint = fingerprint(context.state);
  const beforeTasks = clean(context.engine.evaluate(context.state, 'actor1'));
  const beforePrediction = clean(predictChunk(context.state, 'actor1', '12851', context));
  for (const asMembers of [false, true]) analyzeAreaCheck(context.state, 'actor1', { chunkIds: ['12851', '12852'], asMembers }, context);
  assert.deepEqual(context.state, saved);
  assert.equal(createGameplayFingerprint()(context.state), beforeFingerprint);
  assert.deepEqual(clean(context.engine.evaluate(context.state, 'actor1')), beforeTasks);
  assert.deepEqual(clean(predictChunk(context.state, 'actor1', '12851', context)), beforePrediction);
});
