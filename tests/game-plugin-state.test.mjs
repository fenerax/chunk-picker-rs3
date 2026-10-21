import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, applyValidatedCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';
import { observedSkills, validateGamePluginProvenance, validateRuneMetricsProvenance } from '../app/core/game-progress.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

// Synthetic state and definitions only; no server, saved game or output files.
const fetchedAt = '2026-10-19T17:00:00.000Z';
const now = () => '2026-10-19T18:00:00.000Z';
const quest = { id: 'quest:fixture', label: 'Fixture quest', category: 'Quest' };
const provenance = { source: 'game-plugin', fetchedAt, memberId: 'player' };
const engineOptions = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
  retainedUnsupportedCorrections: false, divinationTraining: false,
  skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };
function group() {
  const state = createGroupState([{ id: 'player', name: 'Player' }, { id: 'partner', name: 'Partner' }]);
  state.tasks = [quest, { id: 'cooking:fixture', label: 'Fixture cooking', category: 'Cooking' }];
  return state;
}
function batch(extra = {}) {
  return { type: 'apply-game-progress', memberId: 'player', fetchedAt,
    skills: [{ skill: 'Cooking', level: 30, xp: 13400.5 }], quests: [{ taskId: quest.id, title: quest.label }], ...extra };
}
const apply = (state, command, implementation = applyCommand) => implementation(state, command, { now, expectedRevision: state.revision });

for (const implementation of [applyCommand, applyValidatedCommand]) {
  test(`${implementation.name}: game plugin progress records player provenance, History and Undo without account names`, () => {
    const state = group(), before = structuredClone(state);
    const changed = apply(state, batch(), implementation);
    assert.deepEqual(state, before);
    assert.equal(Object.hasOwn(state.members[0], 'runescapeName'), false);
    assert.deepEqual(changed.members[0].skillProgress.Cooking, { level: 30, xp: 13400.5, ...provenance });
    assert.deepEqual(changed.members[0].questProgress[quest.id], { title: quest.label, ...provenance });
    assert.deepEqual(changed.members[0].completedTasks, [quest.id]);
    assert.deepEqual(changed.members[1], state.members[1]);
    assert.equal(Object.hasOwn(changed.members[0], 'runeMetricsSync'), false);
    assert.equal(changed.history[0].type, 'apply-game-progress');
    assert.deepEqual(changed.history[0].command, batch());
    assert.deepEqual(importBackup(exportBackup(changed)).members, changed.members);
    assert.deepEqual(validateState(changed), changed);
    const undone = apply(changed, { type: 'undo' }, implementation);
    assert.deepEqual(undone.members, state.members);
    assert.equal(undone.history[0].undoneRevision, 2);
    assert.equal(undone.history[1].command.undoRevision, 1);
  });

  test(`${implementation.name}: invalid plugin batches reject atomically before History timestamp`, () => {
    const state = group(), before = structuredClone(state);
    const invalid = [
      { memberId: 'missing' }, { memberId: null }, { fetchedAt: '2026-02-30T17:00:00Z' },
      { skills: null }, { quests: {} }, { runescapeName: 'Unneeded' }, { source: 'game-plugin' },
      { skills: [{ skill: 'Unknown', level: 1, xp: 0 }] },
      ...[0, 121, 1.5, '30'].map(level => ({ skills: [{ skill: 'Cooking', level, xp: 0 }] })),
      ...[-1, '5', Infinity, NaN].map(xp => ({ skills: [{ skill: 'Cooking', level: 30, xp }] })),
      { skills: [...batch().skills, ...batch().skills] }, { quests: [...batch().quests, ...batch().quests] },
      { skills: [{ ...batch().skills[0], memberId: 'partner' }] },
      { quests: [{ ...batch().quests[0], source: 'game-plugin' }] },
      { quests: [{ taskId: 'missing', title: 'Missing' }] },
      { quests: [{ taskId: 'cooking:fixture', title: 'Cooking' }] },
      { quests: [{ taskId: quest.id, title: ' ' }] },
      { quests: [{ taskId: '__proto__', title: 'Unsafe' }] },
    ];
    const options = { expectedRevision: 0, now: () => { throw new Error('Rejected command requested timestamp'); } };
    for (const extra of invalid) assert.throws(() => implementation(state, batch(extra), options), TypeError);
    assert.throws(() => implementation(state, batch(), { expectedRevision: 1, now }), /Revision conflict/);
    assert.deepEqual(state, before);
  });
}

test('plugin provenance validates exact source fields and matching member in saves and historical patches', () => {
  const state = apply(group(), batch());
  validateGamePluginProvenance(provenance, 'player');
  assert.throws(() => validateGamePluginProvenance(provenance, 'partner'), /memberId/);
  assert.throws(() => validateRuneMetricsProvenance(provenance), /Unknown|runemetrics/);
  for (const field of ['skillProgress', 'questProgress']) {
    const key = field === 'skillProgress' ? 'Cooking' : quest.id;
    for (const extra of [{ memberId: 'partner' }, { memberId: undefined }, { runescapeName: 'Unneeded' }, { source: 'unknown' }]) {
      const bad = structuredClone(state);
      Object.assign(bad.members[0][field][key], extra);
      assert.throws(() => validateState(bad), TypeError);
    }
    const historical = structuredClone(state);
    const patch = historical.history[0].undo.memberChanges[0].changes.find(change => change.path[0] === field && change.path[1] === key);
    patch.after.value.memberId = 'partner';
    assert.throws(() => validateState(historical), /memberId/);
  }
  const sync = structuredClone(state);
  sync.members[0].runeMetricsSync = provenance;
  assert.throws(() => validateState(sync), /Unknown|runemetrics/);
});

test('plugin changes preserve RuneMetrics sync and undo restores earlier observations and personal completion', () => {
  let state = group();
  state = apply(state, { type: 'set-runescape-name', memberId: 'player', name: 'Fixture' });
  state = apply(state, { ...batch(), type: 'apply-runemetrics', runescapeName: 'Fixture', skills: [{ skill: 'Cooking', level: 20, xp: 5000 }] });
  const changed = apply(state, batch());
  assert.deepEqual(changed.members[0].runeMetricsSync, state.members[0].runeMetricsSync);
  assert.deepEqual(apply(changed, { type: 'undo' }).members, state.members);
  const nameChanged = apply(changed, { type: 'set-runescape-name', memberId: 'player', name: 'NewFixture' });
  assert.deepEqual(nameChanged.members[0].skillProgress.Cooking, changed.members[0].skillProgress.Cooking);
  assert.throws(() => apply(nameChanged, { ...batch(), type: 'apply-runemetrics', runescapeName: 'Fixture' }), /account binding/);
});

test('plugin batches retain all 29 canonical RuneScape skills independently of training controls', () => {
  assert.equal(observedSkills.length, 29);
  const skills = observedSkills.map(skill => ({ skill, level: 30, xp: 13400.5 }));
  const changed = apply(group(), batch({ skills, quests: [] }));
  assert.deepEqual(Object.keys(changed.members[0].skillProgress), [...observedSkills]);
  assert.deepEqual(changed.members[0].skillProgress.Necromancy, { level: 30, xp: 13400.5, ...provenance });
  assert.deepEqual(apply(changed, { type: 'undo' }).members, group().members);
});

test('plugin quest completion clears matching claims and older sparse Undo preserves later independent changes', () => {
  const claimed = apply(group(), { type: 'claim-task', memberId: 'player', taskId: quest.id });
  const changed = apply(claimed, batch());
  assert.equal(Object.hasOwn(changed.taskClaims, quest.id), false);
  const later = apply(changed, { type: 'set-journal', memberId: 'partner', note: 'Independent note' });
  const undone = apply(later, { type: 'undo', undoRevision: changed.revision }, applyValidatedCommand);
  assert.deepEqual(undone.members[0], claimed.members[0]);
  assert.equal(undone.members[1].journal, 'Independent note');
  assert.deepEqual(validateState(undone), undone);
});

test('engine trusts only the owning player plugin observation and retains RuneMetrics account matching', () => {
  const definitions = { chunks: { '100': {} }, challenges: { Extra: { 'Cook requirement': { SkillsNeeded: { Cooking: 30 } } } } };
  const engine = createTaskEngine(definitions, engineOptions);
  const state = group();
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.members[0].unlocked = ['100']; state.members[1].unlocked = ['100'];
  const changed = apply(state, batch({ quests: [] }));
  const observed = engine.evaluate(changed, 'player');
  assert.equal(observed.training.Cooking.observedLevel, 30);
  assert.equal(observed.training.Cooking.observedSource, 'game-plugin');
  assert.equal(observed.training.Cooking.observedFetchedAt, fetchedAt);
  assert.equal(observed.training.Cooking.observedRunescapeName, null);
  assert.ok(observed.training.Cooking.level >= 30);
  assert.equal(engine.evaluate(changed, 'partner').training.Cooking.observedLevel, null);
  const mismatched = structuredClone(changed);
  mismatched.members[0].skillProgress.Cooking.memberId = 'partner';
  assert.equal(engine.evaluate(mismatched, 'player').training.Cooking.observedLevel, null);
  const runeMetrics = structuredClone(changed);
  runeMetrics.members[0].runescapeName = 'Fixture';
  runeMetrics.members[0].skillProgress.Cooking = { level: 30, xp: 13400.5, source: 'runemetrics', fetchedAt, runescapeName: 'Fixture' };
  assert.equal(engine.evaluate(runeMetrics, 'player').training.Cooking.observedLevel, 30);
  runeMetrics.members[0].runescapeName = 'Changed';
  assert.equal(engine.evaluate(runeMetrics, 'player').training.Cooking.observedLevel, null);
});
