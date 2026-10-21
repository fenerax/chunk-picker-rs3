import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAreaCheck } from '../app/tasks/area-check.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';

// Small in-memory engine fixtures; no store, full catalogue or browser.
function fixture() {
  const definitions = {
    chunks: { '13105': { Object: { 'Local source': true } } },
    walkableChunks: ['13105'], walkableChunksF2P: ['13105'],
    equipment: { 'Corrupt dragon dagger': {}, 'Corrupt dragon chainbody': {}, 'Gravite longsword': {} },
    codeItems: { itemsPlus: { 'CorruptDragonWeapon[+]': ['Corrupt dragon dagger'], 'GraviteMeleeWeapon[+]': ['Gravite longsword'] } },
    challenges: {
      Nonskill: { 'Obtain local equipment': { Objects: ['Local source'], Output: ['Corrupt dragon dagger', 'Corrupt dragon chainbody', 'Gravite longsword'] } },
      Attack: {
        'Practise melee': { Objects: ['Local source'], Level: 1, Primary: true },
        'Wield a corrupt dragon weapon': { Items: ['CorruptDragonWeapon[+]'], Level: 60 },
        'Wield a gravite melee weapon': { Items: ['GraviteMeleeWeapon[+]'], Level: 55 },
      },
      Defence: {
        'Practise defence': { Objects: ['Local source'], Level: 1, Primary: true },
        'Wear a piece of corrupt dragon armour': { Items: ['Corrupt dragon chainbody'], Level: 60 },
      },
    },
  };
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['13105'] }, { id: 'player2', name: 'Player 2', unlocked: [] }]);
  const context = { definitions, state, engine: createTaskEngine(definitions), world: buildWorld(definitions), catalogue: { methods: [] } };
  const analyze = () => analyzeAreaCheck(state, 'player1', { chunkIds: ['13105'] }, context);
  const target = (skill, scope = 'combined') => analyze().rows.find(row => row.skill === skill)[scope].gapTarget;
  const task = label => context.engine.catalogue.find(row => row.label === label);
  return { ...context, context, analyze, target, task };
}

test('non-permanent wield and wear goals follow the same saved rule as the active list', () => {
  const f = fixture(), member = f.state.members[0];
  for (const allowed of [false, true]) {
    member.taskRules = { 'Non-permanent BiS': allowed };
    const result = f.analyze();
    const active = selectPresentedTasks(f.engine.evaluate(f.state, 'player1'), f.state, 'player1', f.definitions).tasks;
    for (const scope of ['alone', 'combined']) {
      const attack = result.rows.find(row => row.skill === 'Attack')[scope];
      assert.equal(attack.gapTarget.level, allowed ? 60 : 55);
      assert.deepEqual(attack.gapTarget.requirements.map(task => task.label), [allowed ? 'Wield a corrupt dragon weapon' : 'Wield a gravite melee weapon']);
      assert.equal(attack.trainingGaps[0].toLevel, allowed ? 60 : 55);
      const defence = result.rows.find(row => row.skill === 'Defence')[scope];
      assert.equal(defence.gapTarget?.level ?? null, allowed ? 60 : null);
      assert.ok(attack.gapTarget.requirements.every(task => active.some(row => row.id === task.id)));
    }
    assert.equal(active.some(task => task.label === 'Wear a piece of corrupt dragon armour'), allowed);
  }
});

test('personal equipment rule overrides the shared rule without changing the save during analysis', () => {
  const f = fixture();
  f.state.taskRules = { 'Non-permanent BiS': false };
  f.state.members[0].taskRules = { 'Non-permanent BiS': true };
  const saved = structuredClone(f.state);
  assert.equal(f.target('Attack').level, 60);
  assert.deepEqual(f.state, saved);
  f.state.members[0].taskRules = {};
  assert.equal(f.target('Attack').level, 55, 'repairable gravite remains permanent under the shared rule');
});

test('backlogged, personally completed and partner-satisfied duties are excluded from targets', () => {
  for (const handling of ['backlog', 'completed', 'challenge', 'partner']) {
    const f = fixture(), id = f.task('Wield a corrupt dragon weapon').id;
    if (handling === 'backlog') f.state.members[0].taskStatus = { [id]: { backlogged: true } };
    if (handling === 'completed') f.state.members[0].completedTasks = [id];
    if (handling === 'challenge') f.state.members[0].taskStatus = { [id]: { challengeCompleted: true } };
    if (handling === 'partner') f.state.members[1].taskStatus = { [id]: { challengeCompleted: true } };
    for (const scope of ['alone', 'combined']) {
      assert.ok(!f.target('Attack', scope)?.requirements.some(task => task.id === id), handling);
    }
    if (handling === 'backlog') assert.equal(f.target('Attack').level, 55);
    else assert.equal(f.target('Attack'), null, 'the active list also suppresses lower goals already covered by completion');
    if (handling === 'partner') {
      f.state.rules['tasks.completion'] = 'personal';
      assert.equal(f.target('Attack').level, 60, 'personal completion rules retain the other member’s unfinished duty');
    }
  }
});

test('task-list category switches, NeverShow and blocked rules suppress requirements too', () => {
  const cases = [
    ['Quest', 'Show Quest Tasks', {}],
    ['Diary', 'Achievement', {}],
    ['Extra', 'BIS Skilling', { Category: ['BIS Skilling'] }],
    ['Quest', null, { NeverShow: true }],
    ['Quest', 'Special', { Category: ['Special'] }],
  ];
  for (const [category, rule, extra] of cases) {
    const f = fixture();
    f.definitions.challenges[category] = { 'Local obligation': { Objects: ['Local source'], Requirements: { Attack: 80 }, ...extra } };
    f.context.engine = createTaskEngine(f.definitions);
    if (!extra.NeverShow) assert.equal(f.target('Attack').level, 80, `${category} is initially visible`);
    f.state.members[0].taskRules = rule ? { [rule]: false } : {};
    assert.equal(f.target('Attack').level, 60, `${rule ?? 'NeverShow'} cannot set the target`);
  }
  const f = fixture();
  f.state.members[0].taskRules = { 'Show Skill Tasks': false };
  assert.equal(f.target('Attack'), null);
  assert.equal(f.target('Defence'), null);
});

test('training, missing-source, membership and unsupported blockers never set targets', () => {
  const f = fixture();
  f.definitions.challenges.Quest = {
    'Blocked training duty': { Objects: ['Local source'], Requirements: { Attack: 90, Construction: 20 } },
    'Missing-source duty': { Objects: ['Elsewhere'], Requirements: { Attack: 90 } },
    'Members duty': { Objects: ['Local source'], Requirements: { Attack: 90 }, 'Not F2P': true },
    'Unsupported duty': { Objects: ['Local source'], Requirements: { Attack: 90 }, UnknownGate: true },
  };
  f.context.engine = createTaskEngine(f.definitions);
  assert.equal(f.target('Attack').level, 60);
  assert.equal(f.target('Construction'), null);
});

test('the selected skill alternative supplies the target, including cross-skill requirements', () => {
  const f = fixture();
  f.definitions.challenges.Attack['Wield a corrupt dragon weapon'].Requirements = { Magic: 40 };
  f.definitions.challenges.Attack['Use another melee goal'] = { Objects: ['Local source'], Level: 60, Requirements: { Magic: 70 } };
  f.state.members[0].primaryOverrides = { Magic: true };
  f.context.engine = createTaskEngine(f.definitions);
  const chosen = f.context.engine.catalogue.find(row => row.label === 'Use another melee goal');
  f.state.members[0].taskAlternatives = { Attack: { '60': chosen.id } };
  assert.equal(f.target('Magic').level, 70);
  assert.deepEqual(f.target('Magic').requirements.map(task => task.id), [chosen.id]);
});
