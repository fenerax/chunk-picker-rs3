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
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12850'] }, { id: 'player2', name: 'Player 2', unlocked: [] }]);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  return { definitions, engine, world, state, catalogue: emptyCatalogue };
}
const row = (result, skill) => result.rows.find(value => value.skill === skill);

test('alone and combined use ordinary fixed points without changing saved map or progress', () => {
  const context = fixture(), before = structuredClone(context.state);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12852', '12851'] }, context);
  assert.equal(result.format, 'area-check-v1');
  assert.equal(result.rows.length, 29);
  assert.deepEqual(result.chunkIds, ['12851', '12852']);
  const mining = row(result, 'Mining');
  assert.equal(mining.alone.lowest.level, 40);
  assert.equal(mining.alone.highest.level, 80);
  assert.equal(mining.alone.bootstrapGap, null, 'method entry alone creates no task requirement');
  assert.equal(mining.combined.lowest.level, 1);
  assert.equal(mining.combined.highest.level, 80);
  assert.equal(mining.combined.bootstrapGap, null);
  assert.equal(mining.combined.repeatability, 'engine-primary');
  assert.deepEqual(mining.combined.entrySpans, [{ fromLevel: 1, toLevel: 40, size: 39 }, { fromLevel: 40, toLevel: 80, size: 40 }]);
  assert.equal(mining.combined.reachableLevel, 110, 'highest entry level is not an XP ceiling');
  assert.deepEqual(context.state, before);
});

test('a shared facility cannot admit missing artefact methods or global achievement targets', () => {
  const context = fixture();
  context.definitions.challenges.Archaeology = {
    'Restore foreign artefact': { Level: 24, Primary: true, Objects: ['High rock'], Items: ['Foreign artefact'] },
    'Excavate local cache': { Level: 52, Primary: true, Objects: ['High rock'] },
  };
  context.definitions.challenges.Diary = { 'Global low-level achievement': { Skills: { Construction: 25, Divination: 13 } } };
  context.definitions.challenges.Quest['Local archaeology gate'] = { Chunks: ['12851'], Skills: { Archaeology: 52 } };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'], asMembers: true }, context);
  assert.equal(row(result, 'Archaeology').alone.lowest.level, 52);
  for (const skill of ['Archaeology', 'Construction', 'Divination']) {
    assert.equal(row(result, skill).alone.gapTarget, null, 'blocked local duties and unanchored global goals are not active targets');
    assert.equal(row(result, skill).alone.bootstrapGap, null);
  }
});

test('F2P rejects members methods; members draft keeps conditional methods without blocked task targets', () => {
  const context = fixture();
  const f2p = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'] }, context);
  assert.equal(row(f2p, 'Divination').alone.methodCount, 0);
  assert.equal(row(f2p, 'Construction').alone.bootstrapGap, null);
  assert.equal(row(f2p, 'Invention').cap, 1);
  const members = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'], asMembers: true }, context);
  const divination = row(members, 'Divination').alone;
  assert.equal(divination.lowest.level, 77);
  assert.equal(divination.lowest.methods[0].label, 'Harvest Colossus energy');
  assert.equal(divination.bootstrapGap, null);
  for (const skill of ['Divination', 'Construction', 'Slayer']) assert.equal(row(members, skill).alone.gapTarget, null);
  assert.deepEqual(members.biggestGaps.alone, [], 'conditional methods cannot establish usable-method gaps');
  assert.notEqual(context.state.rules['content.f2p'], false);
});

test('personal progress remains capability evidence without admitting a blocked target', () => {
  const context = fixture();
  Object.assign(context.state.members[0], { runescapeName: 'Test account', skillProgress: { Divination: {
    source: 'runemetrics', runescapeName: 'Test account', level: 70, xp: 800000, fetchedAt: '2026-10-13T00:00:00.000Z' } } });
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'], asMembers: true }, context);
  assert.equal(row(result, 'Divination').alone.reachableLevel, 70);
  assert.equal(row(result, 'Divination').alone.gapTarget, null);
  assert.equal(row(result, 'Divination').alone.bootstrapGap, null);
});

test('a conditional earlier method is not silently an XP cap at its entry level', () => {
  const context = fixture();
  context.definitions.challenges.Hunter = {
    'Fill a birdhouse': { Level: 5, Primary: true, Objects: ['High rock'] },
    'Hunt a later creature': { Level: 20, Primary: true, Objects: ['High rock'] },
  };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'], asMembers: true }, context);
  assert.equal(row(result, 'Hunter').alone.lowest.level, 5);
  assert.equal(row(result, 'Hunter').alone.bootstrapGap, null);
  assert.equal(row(result, 'Hunter').alone.methods[0].status, 'blocked');
});

test('NoXp entries are excluded and legacy method fields retain their meaning', () => {
  const context = fixture();
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850'] }, context);
  const woodcutting = row(result, 'Woodcutting').alone;
  assert.equal(woodcutting.methodCount, 1);
  assert.equal(woodcutting.highest.level, 1);
  assert.equal(woodcutting.reachableLevel, 110);
  assert.equal(woodcutting.bootstrapGap, null);
});

test('combined includes connected partner training while alone excludes other ownership', () => {
  const context = fixture();
  context.state.members[1].unlocked = ['12852'];
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'] }, context);
  assert.equal(row(result, 'Mining').alone.highest.level, 40);
  assert.equal(row(result, 'Mining').combined.highest.level, 80);
});

test('training gaps name the older usable method and next-method evidence', () => {
  const context = fixture();
  context.definitions.challenges.Quest['Mining goal'] = { Chunks: ['12851'], Skills: { Mining: 110 } };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850', '12851', '12852'] }, context);
  const mining = row(result, 'Mining').alone;
  assert.deepEqual(mining.trainingGaps.map(({ fromLevel, toLevel, size, kind, methods, evidence }) =>
    ({ fromLevel, toLevel, size, kind, methods: methods.map(value => value.label), evidence: evidence.map(value => value.label) })), [
    { fromLevel: 1, toLevel: 40, size: 39, kind: 'method', methods: ['Mine starter rock'], evidence: ['Mine high rock'] },
    { fromLevel: 40, toLevel: 80, size: 40, kind: 'method', methods: ['Mine high rock'], evidence: ['Mine highest rock'] },
    { fromLevel: 80, toLevel: 110, size: 30, kind: 'requirement', methods: ['Mine highest rock'], evidence: ['Mining goal'] },
  ]);
  assert.equal(mining.gapTarget.level, 110);
  assert.equal(mining.gapTarget.kind, 'requirement');
  assert.equal(mining.largestGap.fromLevel, 40);
  assert.deepEqual(result.biggestGaps.alone.find(value => value.skill === 'Mining'), { skill: 'Mining', ...mining.largestGap });
  assert.equal(mining.bootstrapGap, null);
  assert.equal(mining.methods.length, 3);
  assert.deepEqual(mining.entrySpans, [{ fromLevel: 1, toLevel: 40, size: 39 }, { fromLevel: 40, toLevel: 80, size: 40 }]);
});

test('each scope clips gaps to its own highest quest or task requirement', () => {
  const context = fixture();
  context.definitions.challenges.Mining['Mine local starter rock'] = { Level: 1, Primary: true, Objects: ['High rock'] };
  context.definitions.challenges.Quest['Local mining gate'] = { Chunks: ['12851'], Skills: { Mining: 60 } };
  context.definitions.challenges.Diary = {
    'Local mining task': { Objects: ['High rock'], SkillsNeeded: { Mining: 70 } },
    'Global mining achievement': { Skills: { Mining: 100 } },
    'Existing-map mining goal': { Objects: ['Starter rock'], Requirements: { Mining: 90 } },
  };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851', '12852'] }, context);
  const mining = row(result, 'Mining');
  for (const scope of ['alone', 'combined']) {
    const target = scope === 'alone' ? 70 : 90;
    assert.equal(mining[scope].gapTarget.level, target);
    assert.equal(mining[scope].gapTarget.kind, 'requirement');
    assert.deepEqual(mining[scope].gapTarget.requirements.map(value => value.label), [scope === 'alone' ? 'Local mining task' : 'Existing-map mining goal']);
    assert.deepEqual(mining[scope].trainingGaps.map(gap => [gap.fromLevel, gap.toLevel]),
      scope === 'alone' ? [[1, 40], [40, 70]] : [[1, 40], [40, 80]]);
    assert.equal(mining[scope].highest.level, 80, 'legacy ranges still show all candidate entries above the target');
    assert.ok(mining[scope].trainingGaps.every(gap => gap.toLevel <= target));
  }
  assert.equal(mining.alone.bootstrapGap, null);
  assert.equal(mining.combined.bootstrapGap, null);
});

test('wield and equipment targets inherit item ownership and read Requirements as well as category Level', () => {
  const context = fixture();
  context.definitions.challenges.Nonskill = {
    'Obtain local weapon': { Objects: ['Starter rock'], Output: ['Local weapon'] },
  };
  context.definitions.challenges.Attack = {
    'Wield a gravite melee weapon': { Items: ['Local weapon'], Level: 55, Requirements: { Attack: 55, Dungeoneering: 35 } },
    'Wield a weapon with only a category level': { Items: ['Local weapon'], Level: 50 },
    'Wield a higher weapon from elsewhere': { Items: ['Absent weapon'], Level: 90 },
  };
  context.definitions.challenges.Defence = {
    'Equip local armour': { Items: ['Local weapon'], Level: 40, Requirements: { Defence: 45 } },
  };
  context.state.members[0].primaryOverrides = { Attack: true, Defence: true, Dungeoneering: true };
  context.catalogue = { methods: [{ id: 'fight', skill: 'Attack', label: 'Fight local monster', level: 1, members: false,
    requirements: [{ kind: 'object', name: 'Starter rock' }] }] };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850'] }, context);
  for (const scope of ['alone', 'combined']) {
    const attack = row(result, 'Attack')[scope];
    assert.equal(attack.gapTarget.level, 55);
    assert.equal(attack.trainingGaps[0].toLevel, 55);
    assert.equal(attack.trainingGaps[0].evidence[0].label, 'Wield a gravite melee weapon');
    assert.equal(row(result, 'Dungeoneering')[scope].gapTarget.level, 35);
    assert.equal(row(result, 'Defence')[scope].gapTarget.level, 45);
    assert.equal(row(result, 'Defence')[scope].bootstrapGap, null);
  }
  delete context.definitions.challenges.Attack['Wield a gravite melee weapon'];
  context.engine = createTaskEngine(context.definitions);
  const levelOnly = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850'] }, context);
  assert.equal(row(levelOnly, 'Attack').alone.gapTarget.level, 50);
  assert.equal(row(levelOnly, 'Attack').alone.gapTarget.requirements[0].label, 'Wield a weapon with only a category level');
});

test('non-primary local skill tasks supply Level goals but primary entries create no target', () => {
  const context = fixture();
  context.definitions.challenges.Cooking = {
    'Cook a repeatable meal': { Level: 1, Primary: true, Objects: ['Starter rock'] },
    'Cook a local task meal': { Level: 45, Objects: ['Starter rock'] },
  };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850'] }, context);
  assert.equal(row(result, 'Cooking').alone.gapTarget.level, 45);
  assert.equal(row(result, 'Cooking').alone.trainingGaps[0].evidence[0].label, 'Cook a local task meal');
  assert.equal(row(result, 'Woodcutting').alone.gapTarget, null);
  assert.deepEqual(row(result, 'Woodcutting').alone.trainingGaps, []);
});

test('no task requirement means no gaps or cannot-start warnings in either content mode', () => {
  const context = fixture();
  context.definitions.challenges.Construction = { 'Build a simple chair': { Level: 1, Primary: true, Objects: ['Starter rock'] } };
  context.engine = createTaskEngine(context.definitions);
  for (const [asMembers, cap] of [[false, 20], [true, 120]]) {
    const summary = row(analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850'], asMembers }, context), 'Construction').alone;
    assert.equal(summary.cap, cap, 'the display limit remains available');
    assert.equal(summary.gapTarget, null);
    assert.deepEqual(summary.trainingGaps, []);
    assert.equal(summary.bootstrapGap, null);
    const mining = row(analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851', '12852'], asMembers }, context), 'Mining').alone;
    assert.equal(mining.bootstrapGap, null, 'a high first method cannot create a warning without a task requirement');
    assert.deepEqual(mining.trainingGaps, [], 'spacing between methods alone does not create gaps');
  }
});

test('15 levels is the inclusive minimum and smaller stretches stay only in entrySpans', () => {
  const context = fixture();
  context.definitions.challenges.Mining = Object.fromEntries([1, 15, 30].map(level =>
    [`Mine level ${level}`, { Level: level, Primary: true, Objects: ['Starter rock'] }]));
  context.definitions.challenges.Quest['Mining goal'] = { Chunks: ['12850'], Skills: { Mining: 44 } };
  context.engine = createTaskEngine(context.definitions);
  const mining = row(analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850'] }, context), 'Mining').alone;
  assert.deepEqual(mining.entrySpans, [{ fromLevel: 1, toLevel: 15, size: 14 }, { fromLevel: 15, toLevel: 30, size: 15 }]);
  assert.deepEqual(mining.trainingGaps.map(({ fromLevel, toLevel, size }) => ({ fromLevel, toLevel, size })),
    [{ fromLevel: 15, toLevel: 30, size: 15 }]);
  assert.equal(mining.largestGap.size, 15);
});

test('blocked conditional, missing source and missing supply methods cannot close a usable-method gap', () => {
  const context = fixture();
  context.definitions.challenges.Quest['Mining goal'] = { Chunks: ['12851'], Skills: { Mining: 70 } };
  context.definitions.challenges.Mining['Conditional mining method'] = {
    Level: 20, Primary: true, Objects: ['Starter rock'], Skills: { Construction: 30 },
  };
  context.definitions.challenges.Mining['Unsupplied mining method'] = {
    Level: 25, Primary: true, Objects: ['Starter rock'], Items: ['Foreign artefact'],
  };
  context.definitions.challenges.Mining['Missing mining source'] = { Level: 30, Primary: true, Objects: ['Absent rock'] };
  context.engine = createTaskEngine(context.definitions);
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12850', '12851'], asMembers: true }, context);
  const mining = row(result, 'Mining').alone;
  assert.ok(mining.methods.some(method => method.label === 'Conditional mining method' && method.status === 'blocked'));
  assert.ok(mining.methods.every(method => !['Unsupplied mining method', 'Missing mining source'].includes(method.label)));
  assert.deepEqual(mining.entrySpans, [{ fromLevel: 1, toLevel: 20, size: 19 }, { fromLevel: 20, toLevel: 40, size: 20 }]);
  assert.deepEqual(mining.trainingGaps.map(gap => [gap.fromLevel, gap.toLevel]), [[1, 40], [40, 70]]);
  assert.ok(mining.trainingGaps.every(gap => gap.methods.every(method => method.label !== 'Conditional mining method')));
});

test('scopes use their own usable methods and empty or wholly conditional coverage has no training gap', () => {
  const context = fixture();
  context.definitions.challenges.Quest['Mining goal'] = { Chunks: ['12851'], Skills: { Mining: 110 } };
  context.engine = createTaskEngine(context.definitions);
  context.state.members[1].unlocked = ['12852'];
  const result = analyzeAreaCheck(context.state, 'player1', { chunkIds: ['12851'] }, context);
  assert.deepEqual(row(result, 'Mining').alone.trainingGaps, []);
  assert.equal(row(result, 'Mining').alone.largestGap, null);
  assert.equal(row(result, 'Mining').alone.bootstrapGap, null, 'the alone goal is training-blocked');
  assert.equal(row(result, 'Mining').alone.gapTarget, null);
  assert.deepEqual(row(result, 'Mining').combined.trainingGaps.map(gap => [gap.fromLevel, gap.toLevel]), [[1, 40], [40, 80], [80, 110]]);
  const empty = analyzeAreaCheck(context.state, 'player1', { chunkIds: [] }, context);
  assert.ok(empty.rows.every(value => value.alone.trainingGaps.length === 0 && value.alone.largestGap === null && value.alone.gapTarget === null));
  assert.deepEqual(empty.biggestGaps.alone, []);
});

