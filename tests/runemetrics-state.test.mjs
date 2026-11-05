import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGroupState, validateState, exportBackup, importBackup, previewRestore } from '../app/core/state.mjs';
import { validateRuneScapeName, sameRuneScapeName, validateRuneMetricsTimestamp } from '../app/core/game-progress.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';

const fetchedAt = '2026-10-07T17:00:00.000Z';
const now = () => '2026-10-07T18:00:00.000Z';
const quest = { id: 'quest:cooks-assistant', label: "Cook's Assistant", category: 'Quest' };
function group() {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }, { id: 'other', name: 'Other' }]);
  state.members[0].runescapeName = 'DemoExplorer'; state.members[1].runescapeName = 'SecondActor1';
  state.tasks = [quest, { id: 'skill:cook', label: 'Cook food', category: 'Cooking' }];
  return state;
}
function batch(extra = {}) {
  return { type: 'apply-runemetrics', memberId: 'actor1', runescapeName: 'DemoExplorer', fetchedAt,
    skills: [{ skill: 'Cooking', level: 30, xp: 13400.5 }], quests: [{ taskId: quest.id, title: quest.label }], ...extra };
}
function apply(state, command) { return applyCommand(state, command, { now, expectedRevision: state.revision }); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}


test('RuneScape names validate ASCII syntax and account equivalence while name edits undo', () => {
  for (const valid of ['x', 'Name 9', 'Player-name', 'Player_name', '123456789012']) assert.equal(validateRuneScapeName(` ${valid} `), valid);
  for (const invalid of ['', '   ', '1234567890123', 'Éclair', 'x/y', 'x\ny', '<script>', null, 12]) assert.throws(() => validateRuneScapeName(invalid), /RuneScape name/);
  assert.equal(sameRuneScapeName(' Some_Name ', 'some name'), true);
  assert.equal(sameRuneScapeName('some-name', 'some name'), false);
  assert.equal(sameRuneScapeName(undefined, undefined), false);
  assert.equal(sameRuneScapeName('', ''), false);
  assert.equal(sameRuneScapeName('_', '_'), true);
  const state = group(), changed = apply(state, { type: 'set-runescape-name', memberId: 'actor1', name: ' New_account ' });
  assert.equal(changed.members[0].runescapeName, 'New_account');
  assert.equal(changed.history[0].command.name, 'New_account');
  assert.deepEqual(apply(changed, { type: 'undo' }).members, state.members);
  const custom = apply(state, { type: 'set-runescape-name', memberId: 'other', name: 'Another' });
  assert.equal(Object.hasOwn(apply(custom, { type: 'undo' }).members[2], 'runescapeName'), false);
});

test('RuneMetrics timestamps require a real ISO UTC calendar date', () => {
  for (const value of [fetchedAt, '2026-10-07T17:00:00Z', '2026-10-07T17:00:00.1Z']) assert.equal(validateRuneMetricsTimestamp(value), value);
  for (const value of ['2026-10-07', '2026-10-07T17:00:00+00:00', '2026-02-30T17:00:00Z', '2026-10-07T25:00:00Z', 'bad', null]) assert.throws(() => validateRuneMetricsTimestamp(value), /ISO UTC/);
});


test('invalid RuneMetrics batches fail atomically before history time and stale revisions reject', () => {
  const state = freeze(group()), before = JSON.stringify(state);
  const invalid = [
    { runescapeName: 'SecondActor1' }, { fetchedAt: '2026-02-30T17:00:00Z' }, { skills: null }, { quests: {} },
    { skills: [{ skill: 'Unknown', level: 1, xp: 0 }] }, { skills: [{ skill: 'Combat', level: 1, xp: 0 }] },
    ...[0, 121, 1.5, '30'].map(level => ({ skills: [{ skill: 'Cooking', level, xp: 0 }] })),
    ...[-1, '5', Infinity, NaN].map(xp => ({ skills: [{ skill: 'Cooking', level: 1, xp }] })),
    { skills: [...batch().skills, ...batch().skills] }, { quests: [...batch().quests, ...batch().quests] },
    { quests: [{ taskId: 'unknown', title: 'Unknown' }] }, { quests: [{ taskId: 'skill:cook', title: 'Cook food' }] },
    { quests: [{ taskId: quest.id, title: '' }] }, { skills: [{ ...batch().skills[0], source: 'manual' }] },
    { quests: [{ ...batch().quests[0], completed: true }] }, { source: 'manual' }, { source: null },
    ...[null, {}, [], { current: 1 }, { current: -1, max: 10 }, { current: 2, max: 1 },
      { current: 1.5, max: 10 }, { current: 1, max: Number.MAX_SAFE_INTEGER + 1 },
      { current: 1, max: 10, extra: true }].map(questPoints => ({ questPoints })),
  ];
  const options = { expectedRevision: 0, now: () => { throw new Error('Rejected command must not request a timestamp'); } };
  for (const extra of invalid) assert.throws(() => applyCommand(state, batch(extra), options), error => error instanceof TypeError);
  assert.throws(() => applyCommand(state, batch(), { expectedRevision: 1, now }), /Revision conflict/);
  assert.equal(JSON.stringify(state), before);
});

test('Platform API observations coexist with legacy facts and round trip through restore and sparse undo', () => {
  const state = apply(group(), batch());
  const next = apply(state, batch({ source: 'platform-api', questPoints: { current: 42, max: 450 },
    skills: [{ skill: 'Crafting', level: 10, xp: 1200 }] }));
  const provenance = { source: 'platform-api', fetchedAt, runescapeName: 'DemoExplorer' };
  assert.deepEqual(next.members[0].questPointProgress, { current: 42, max: 450, ...provenance });
  assert.deepEqual(next.members[0].runeMetricsSync, provenance);
  assert.equal(next.members[0].skillProgress.Crafting.source, 'platform-api');
  assert.equal(next.members[0].skillProgress.Cooking.source, 'runemetrics');
  assert.equal(next.members[0].questProgress[quest.id].source, 'platform-api');
  assert.deepEqual(importBackup(exportBackup(next)), next);
  const preview = previewRestore(next, state);
  assert.equal(preview.members[0].questPointProgress.changed, true);
  assert.equal(preview.members[0].questPointProgress.after, null);
  assert.ok(preview.warnings.some(warning => /personal quest points/.test(warning)));
  const noPoints = apply(next, batch({ source: 'platform-api', fetchedAt: '2026-10-07T17:30:00Z', skills: [], quests: [] }));
  assert.deepEqual(noPoints.members[0].questPointProgress, next.members[0].questPointProgress, 'Missing endpoint data cannot erase saved observations');
  assert.deepEqual(apply(apply(noPoints, { type: 'undo' }), { type: 'undo' }).members, state.members);
  for (const mutate of [
    value => { value.members[0].questPointProgress.current = 451; },
    value => { value.members[0].questPointProgress.source = 'manual'; },
    value => { value.history.at(-1).undo.memberChanges[0].changes.find(change => change.path[0] === 'questPointProgress').after.value.max = -1; },
  ]) {
    const invalid = structuredClone(next); mutate(invalid);
    assert.throws(() => validateState(invalid), TypeError);
  }
});



function observedState(engine, skills) {
  const state = group();
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.members[0].unlocked = ['100']; state.members[1].unlocked = ['100'];
  state.rules['content.f2p'] = false;
  return apply(state, batch({ skills, quests: [] }));
}
function row(result, category, label) { return result.tasks.find(task => task.id === taskId(category, label)); }



