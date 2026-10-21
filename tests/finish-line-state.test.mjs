import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, applyValidatedCommand, validateState, exportBackup, importBackup, getUndoEligibility, taskClaimInvalidatingEvent } from '../app/core/state.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';
import { buildProgressModel } from '../app/core/progress-timeline.mjs';
import { MAX_FINISH_LINE_CUSTOM_ITEMS, MAX_FINISH_LINE_ITEMS } from '../app/core/finish-line.mjs';

const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const options = { now: () => '2026-10-13T12:00:00.000Z' };
const setting = { type: 'set-finish-line-item', itemId: 'skill:Mining', target: 60 };
const add = { type: 'add-finish-line-custom', itemId: 'finish:shared-bank', text: 'Fill the shared bank' };
const tick = { type: 'set-finish-line-custom', itemId: add.itemId, memberId: 'actor1', completed: true };

for (const apply of [applyCommand, applyValidatedCommand]) {
  test(`${apply.name} keeps shared targets separate from account progress and round trips every save surface`, { timeout: 10000 }, () => {
    let state = createGroupState(owners);
    assert.equal(validateState(state).finishLine, undefined);
    const original = structuredClone(state);
    state = apply(state, setting, { ...options, expectedRevision: 0 });
    state = apply(state, { ...setting, enabled: false }, options);
    state = apply(state, { type: setting.type, itemId: 'quest:rs3:task:000abc', enabled: true }, options);
    state = apply(state, { type: setting.type, itemId: 'achievement:rs3:task:000abd', enabled: false }, options);
    state = apply(state, { type: setting.type, itemId: 'gear:magic', enabled: true }, options);
    state = apply(state, add, options);
    state = apply(state, tick, options);
    state = apply(state, { ...tick, memberId: 'reed' }, options);
    state = apply(state, { ...tick, completed: false }, options);
    assert.deepEqual(state.finishLine.items['skill:Mining'], { target: 60, enabled: false });
    assert.deepEqual(state.finishLine.customItems, [{ id: add.itemId, text: add.text, completedBy: ['reed'] }]);
    assert.deepEqual(state.members, original.members);
    assert.deepEqual(state.rules, original.rules);
    assert.deepEqual(state.tasks, original.tasks);
    assert.deepEqual(importBackup(exportBackup(state)).finishLine, state.finishLine);
    assert.deepEqual(projectPlayState(state).finishLine, state.finishLine);
    const baseline = projectPlayState(state);
    const changed = apply(state, { type: setting.type, itemId: 'skill:Mining', target: 80 }, options);
    const projected = projectPlayState(changed); delete projected.tasks;
    assert.deepEqual(mergeCommandState(baseline, { state: projected, baseRevision: state.revision, unchangedFields: ['tasks'] }).finishLine, changed.finishLine);
    assert.equal(describeHistoryEvent(state.history[5]), `Added F2P finish line item “${add.text}”`);
    assert.equal(describeHistoryEvent(state.history.at(-1), { memberName: id => owners.find(owner => owner.id === id)?.name }), `Unticked F2P finish line item “${add.text}” for Player`);
  });

  test(`${apply.name} guards shared Undo, preserves independent personal Undo and restores optional absence`, { timeout: 10000 }, () => {
    const original = createGroupState(owners);
    let state = apply(original, setting, options);
    assert.equal(state.history[0].undo.finishLineChange.before.exists, false);
    assert.equal(getUndoEligibility(state).canUndo, true);
    assert.equal(apply(state, { type: 'undo' }, options).finishLine, undefined);
    state = apply(state, add, options);
    state = apply(state, tick, options);
    const ticked = state;
    state = apply(state, { ...tick, memberId: 'reed' }, options);
    assert.equal(getUndoEligibility(state, ticked.revision).canUndo, false);
    assert.deepEqual(apply(state, { type: 'undo' }, options).finishLine, ticked.finishLine);
    const beforeDelete = state;
    state = apply(state, { type: 'delete-finish-line-custom', itemId: add.itemId }, options);
    assert.deepEqual(state.finishLine.customItems, []);
    assert.deepEqual(apply(state, { type: 'undo' }, options).finishLine, beforeDelete.finishLine);
    const personal = apply(beforeDelete, { type: 'set-journal', memberId: 'actor1', note: 'Keep training' }, options);
    const later = apply(personal, { type: setting.type, itemId: 'skill:Mining', enabled: true }, options);
    const undonePersonal = apply(later, { type: 'undo', undoRevision: personal.revision }, options);
    assert.deepEqual(undonePersonal.finishLine, later.finishLine);
    assert.equal(undonePersonal.members[0].journal, undefined);
    assert.doesNotThrow(() => validateState(undonePersonal));
    const restored = apply(later, { type: 'replace-member', memberId: 'reed', member: original.members[1], source: 'Backup' }, options);
    assert.deepEqual(restored.finishLine, later.finishLine);
    assert.equal(createGameplayFingerprint()(original), createGameplayFingerprint()(later));
    assert.equal(createTaskReuseFingerprint()(original), createTaskReuseFingerprint()(undonePersonal));
  });

  test(`${apply.name} rejects malformed commands atomically and does not mutate shared baseline trees`, { timeout: 10000 }, () => {
    const state = apply(apply(createGroupState(owners), setting, options), add, options), before = JSON.stringify(state);
    const invalid = [
      { ...setting, target: 0 }, { ...setting, target: 121 }, { ...setting, target: 1.5 }, { ...setting, target: '60' },
      { ...setting, enabled: null }, { type: setting.type, itemId: 'skill:Mining' }, { ...setting, itemId: 'skill:Unknown' },
      { ...setting, itemId: 'skill:Agility', target: 6 }, { ...setting, itemId: 'skill:Necromancy', target: 21 },
      { ...setting, itemId: 'gear:magic' }, { ...setting, itemId: '__proto__' }, { ...setting, itemId: 'quest:rs3:task:constructor' },
      { ...setting, memberId: 'reed' }, { ...add, text: '' }, { ...add, itemId: 'finish:new', text: ' padded ' },
      { ...add, itemId: 'finish:new', text: 'a'.repeat(501) }, { ...add, itemId: 'finish:new', text: 'newline\ntext' },
      add, { ...add, itemId: 'finish:__proto__' }, { ...tick, memberId: 'absent' }, { ...tick, completed: 'true' },
      { ...tick, itemId: 'finish:missing' }, { type: 'delete-finish-line-custom', itemId: 'finish:missing' },
      { type: setting.type, itemId: 'finish:missing', enabled: false },
    ];
    for (const command of invalid) assert.throws(() => apply(state, command, options), TypeError, JSON.stringify(command));
    assert.throws(() => apply(state, setting, { ...options, expectedRevision: 0 }), /Revision conflict/);
    const next = apply(state, tick, options);
    next.finishLine.customItems[0].completedBy.push('reed');
    assert.equal(JSON.stringify(state), before);
  });

  test(`${apply.name} includes or excludes custom rows and deletes their overrides with reversible guards`, { timeout: 10000 }, () => {
    let state = apply(createGroupState(owners), add, options);
    const excluded = apply(state, { type: setting.type, itemId: add.itemId, enabled: false }, options);
    assert.deepEqual(excluded.finishLine.items[add.itemId], { enabled: false });
    assert.deepEqual(excluded.finishLine.customItems, state.finishLine.customItems);
    assert.deepEqual(apply(excluded, { type: 'undo' }, options).finishLine, state.finishLine);
    state = apply(excluded, { type: 'delete-finish-line-custom', itemId: add.itemId }, options);
    assert.equal(state.finishLine.items[add.itemId], undefined);
    assert.deepEqual(state.finishLine.customItems, []);
    assert.deepEqual(apply(state, { type: 'undo' }, options).finishLine, excluded.finishLine);
    assert.doesNotThrow(() => importBackup(exportBackup(excluded)));
    const malformed = structuredClone(excluded); malformed.finishLine.customItems = [];
    assert.throws(() => validateState(malformed), /absent custom item/);
  });
}

test('finish line saved-state and undo validation reject tampering and bounded overflows', { timeout: 10000 }, () => {
  const state = applyCommand(applyCommand(createGroupState(owners), setting, options), add, options);
  for (const mutate of [
    row => { row.finishLine.customItems[0].completedBy = ['absent']; },
    row => { row.finishLine.customItems[0].completedBy = ['actor1', 'actor1']; },
    row => { row.finishLine.items['skill:Mining'].target = 121; },
    row => { row.finishLine.extra = true; },
    row => { row.history.at(-1).undo.finishLineChange.before.value.items['skill:Mining'].target = 0; },
    row => { row.history.at(-1).undo.finishLineChange.after.value.customItems[0].text = 'Changed guard'; },
  ]) {
    const changed = structuredClone(state); mutate(changed); assert.throws(() => validateState(changed), TypeError);
  }
  const many = createGroupState(owners);
  many.finishLine = { items: {}, customItems: Array.from({ length: MAX_FINISH_LINE_CUSTOM_ITEMS + 1 }, (_, i) => ({ id: `finish:item-${i}`, text: 'Extra', completedBy: [] })) };
  assert.throws(() => validateState(many), /at most/);
  many.finishLine.customItems = [];
  many.finishLine.items = Object.fromEntries(Array.from({ length: MAX_FINISH_LINE_ITEMS + 1 }, (_, i) => [`quest:rs3:task:test-${i}`, { enabled: true }]));
  assert.throws(() => validateState(many), /Too many/);
  assert.equal(taskClaimInvalidatingEvent({ command: setting }), false);
  assert.equal(taskClaimInvalidatingEvent({ command: tick }), false);
});

test('unchanged checklist saves and their Undo leave progress history continuous', { timeout: 10000 }, () => {
  let state = applyCommand(createGroupState(owners), setting, options);
  state = applyCommand(state, setting, options);
  assert.equal(state.history.at(-1).undo, undefined);
  state = applyCommand(state, { type: 'undo' }, options);
  const model = buildProgressModel(state, options);
  assert.equal(model.history.boundary, null);
  assert.equal(model.history.points.length, state.history.length + 1);
  assert.ok(model.history.points.every(point => point.duo.unlocked === model.current.duo.unlocked));
});
