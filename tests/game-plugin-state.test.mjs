import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, applyValidatedCommand, createGroupState, validateState, exportBackup, importBackup, previewRestore } from '../app/core/state.mjs';
import { observedSkills, validateGamePluginProvenance, validateRuneMetricsProvenance, validateAchievementProgress } from '../app/core/game-progress.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

// Synthetic state and definitions only; no server, saved game or output files.
const fetchedAt = '2026-10-19T17:00:00.000Z';
const now = () => '2026-10-19T18:00:00.000Z';
const quest = { id: 'quest:fixture', label: 'Fixture quest', category: 'Quest' };
const diary = { id: 'diary:fixture', label: 'Fixture achievement', category: 'Diary' };
const achievement = { taskId: diary.id, title: diary.label, achievementId: 0 };
const provenance = { source: 'game-plugin', fetchedAt, memberId: 'player' };
const engineOptions = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
  retainedUnsupportedCorrections: false, divinationTraining: false,
  skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };
function group() {
  const state = createGroupState([{ id: 'player', name: 'Player' }, { id: 'partner', name: 'Partner' }]);
  state.tasks = [quest, diary, { id: 'cooking:fixture', label: 'Fixture cooking', category: 'Cooking' }];
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
    assert.equal(changed.history[0].source, 'game-plugin');
    assert.equal(changed.history[0].command.memberId, 'player');
    assert.deepEqual(changed.history[0].command, batch());
    assert.deepEqual(importBackup(exportBackup(changed)).members, changed.members);
    assert.deepEqual(validateState(changed), changed);
    const undone = apply(changed, { type: 'undo' }, implementation);
    assert.deepEqual(undone.members, state.members);
    assert.equal(undone.history[0].undoneRevision, 2);
    assert.equal(undone.history[1].command.undoRevision, 1);
  });

  test(`${implementation.name}: achievements join skills and quests in one reversible batch`, () => {
    const state = group(), command = batch({ achievements: [achievement] });
    const changed = apply(state, command, implementation);
    assert.equal(changed.revision, state.revision + 1);
    assert.equal(changed.history.length, 1);
    assert.equal(changed.history[0].source, 'game-plugin');
    assert.equal(changed.history[0].command.memberId, 'player');
    assert.deepEqual(changed.history[0].command, command);
    assert.deepEqual(changed.members[0].completedTasks, [quest.id, diary.id]);
    assert.deepEqual(changed.members[0].achievementProgress[diary.id], { title: diary.label, achievementId: 0, ...provenance });
    assert.deepEqual(changed.members[1], state.members[1]);
    assert.deepEqual(importBackup(exportBackup(changed)), changed);
    assert.deepEqual(apply(changed, { type: 'undo' }, implementation).members, state.members);

    const only = apply(state, batch({ skills: [], quests: [], achievements: [achievement] }), implementation);
    assert.deepEqual(only.members[0].completedTasks, [diary.id]);
    assert.equal(Object.hasOwn(only.members[0], 'skillProgress'), false);
    assert.equal(Object.hasOwn(only.members[0], 'questProgress'), false);
    assert.deepEqual(apply(only, { type: 'undo' }, implementation).members, state.members);
  });

  test(`${implementation.name}: achievement observations preserve already completed tasks and provenance`, () => {
    const manual = apply(group(), { type: 'complete-task', memberId: 'player', taskId: diary.id, completed: true }, implementation);
    const repeatedManual = apply(manual, batch({ skills: [], quests: [], achievements: [achievement] }), implementation);
    assert.equal(Object.hasOwn(repeatedManual.members[0], 'achievementProgress'), false);
    assert.deepEqual(repeatedManual.members, manual.members);
    const original = apply(group(), batch({ skills: [], quests: [], achievements: [achievement] }), implementation);
    const repeated = apply(original, batch({ fetchedAt: now(), skills: [], quests: [], achievements: [{ ...achievement, title: 'Later title', achievementId: 99 }] }), implementation);
    assert.deepEqual(repeated.members, original.members);
    assert.equal(Object.hasOwn(repeated.history.at(-1), 'undo'), false);
  });

  test(`${implementation.name}: manual unticks clear achievement provenance and Undo restores it`, () => {
    const observed = apply(group(), batch({ skills: [], quests: [], achievements: [achievement] }), implementation);
    const unticked = apply(observed, { type: 'complete-task', memberId: 'player', taskId: diary.id, completed: false }, implementation);
    assert.equal(unticked.members[0].completedTasks.includes(diary.id), false);
    assert.equal(Object.hasOwn(unticked.members[0].achievementProgress, diary.id), false);
    assert.deepEqual(apply(unticked, { type: 'undo' }, implementation).members, observed.members);
    const reticked = apply(unticked, { type: 'complete-task', memberId: 'player', taskId: diary.id, completed: true }, implementation);
    assert.equal(reticked.members[0].completedTasks.includes(diary.id), true);
    assert.equal(Object.hasOwn(reticked.members[0].achievementProgress, diary.id), false);

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
      ...[null, {}, 'achievement'].map(achievements => ({ achievements })),
      { achievements: [null] }, { achievements: [{ ...achievement, source: 'game-plugin' }] },
      { achievements: [{ ...achievement, memberId: 'player' }] },
      { achievements: [{ ...achievement, taskId: 'missing' }] },
      { achievements: [{ ...achievement, taskId: quest.id }] },
      { achievements: [{ ...achievement, taskId: '__proto__' }] },
      { achievements: [achievement, achievement] },
      ...[undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0'].map(achievementId => ({ achievements: [{ ...achievement, achievementId }] })),
      ...[undefined, '', ' ', 'x'.repeat(121), 'line\nfeed', 'control\u0085'].map(title => ({ achievements: [{ ...achievement, title }] })),
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

test('achievement provenance rejects malformed save rows and sparse historical values', () => {
  const state = apply(group(), batch({ skills: [], quests: [], achievements: [achievement] }));
  const value = state.members[0].achievementProgress[diary.id];
  const tasks = new Map(state.tasks.map(task => [task.id, task]));
  validateAchievementProgress(diary.id, value, tasks, 'player');
  for (const extra of [{ source: 'runemetrics' }, { memberId: 'partner' }, { runescapeName: 'Unneeded' },
    { title: 'x'.repeat(121) }, { title: 'line\nfeed' }, { achievementId: -1 }, { achievementId: '0' }, { fetchedAt: 'yesterday' }]) {
    const bad = structuredClone(state);
    Object.assign(bad.members[0].achievementProgress[diary.id], extra);
    assert.throws(() => validateState(bad), TypeError);
    const historical = structuredClone(state);
    const patch = historical.history[0].undo.memberChanges[0].changes.find(change => change.path[0] === 'achievementProgress' && change.path[1] === diary.id);
    Object.assign(patch.after.value, extra);
    assert.throws(() => validateState(historical), TypeError);
  }
  for (const taskId of [quest.id, 'missing']) assert.throws(() => validateAchievementProgress(taskId, value, tasks, 'player'), TypeError);
});

test('achievement claims, task deletion, restore warning and older sparse Undo preserve provenance', () => {
  const state = group();
  const customDiary = { ...diary, id: 'custom:diary' };
  state.tasks.push(customDiary);
  const claimed = apply(state, { type: 'claim-task', memberId: 'player', taskId: customDiary.id });
  const changed = apply(claimed, batch({ skills: [], quests: [], achievements: [{ ...achievement, taskId: customDiary.id }] }));
  assert.equal(Object.hasOwn(changed.taskClaims, customDiary.id), false);
  const preview = previewRestore(changed, claimed);
  assert.deepEqual(preview.members[0].achievementProgress.removed, [customDiary.id]);
  assert.ok(preview.warnings.some(warning => warning.includes('personal achievement progress')));
  const later = apply(changed, { type: 'set-journal', memberId: 'partner', note: 'Independent note' });
  const undone = apply(later, { type: 'undo', undoRevision: changed.revision }, applyValidatedCommand);
  assert.deepEqual(undone.members[0], claimed.members[0]);
  assert.equal(undone.members[1].journal, 'Independent note');
  assert.deepEqual(validateState(undone), undone);
  const deleted = apply(changed, { type: 'delete-task', taskId: customDiary.id }, applyValidatedCommand);
  assert.equal(Object.hasOwn(deleted.members[0].achievementProgress, customDiary.id), false);
  assert.deepEqual(apply(deleted, { type: 'undo' }, applyValidatedCommand).members, changed.members);
});

test('old saves and plugin batches without achievements retain their existing shape', () => {
  const original = group();
  assert.deepEqual(validateState(original), original);
  assert.deepEqual(importBackup(exportBackup(original)), original);
  const changed = apply(original, batch());
  assert.equal(Object.hasOwn(changed.members[0], 'achievementProgress'), false);
  assert.equal(Object.hasOwn(changed.history[0].command, 'achievements'), false);
  assert.deepEqual(importBackup(exportBackup(changed)), changed);
});


test('plugin History source is explicit, validated and optional on older events', () => {
  const changed = apply(group(), batch());
  const old = structuredClone(changed);
  delete old.history[0].source;
  assert.deepEqual(validateState(old), old);
  assert.deepEqual(importBackup(exportBackup(old)), old);
  for (const mutate of [
    event => { event.source = 'unknown'; },
    event => { event.type = 'complete-task'; },
    event => { event.command.type = 'complete-task'; },
    event => { delete event.command.memberId; },
    event => { event.command.memberId = '__proto__'; },
  ]) {
    const bad = structuredClone(changed);
    mutate(bad.history[0]);
    assert.throws(() => validateState(bad), /History source|history memberId/);
  }
});
