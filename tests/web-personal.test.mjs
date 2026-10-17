import { appendTaskClaim, createTaskClaimClock } from '../app/web/task-claims.mjs';
import { readScreenGraph, screenFunctionSource } from './browser-screen-harness.mjs';
import { createDuoCoordination } from '../app/web/duo-coordination.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { createNoteEditor } from '../app/web/info-panels.mjs';
import { renderTaskEquipment } from '../app/web/task-equipment.mjs';
import { createTaskFilters, appendTaskPin } from '../app/web/task-filters.mjs';
import { isTaskPinned, createTaskPinChecker } from '../app/web/task-filters-model.mjs';
import { supportsDatasetFeature } from '../app/web/dataset-features.mjs';
import { renderTaskBlockerGuidance } from '../app/web/screen-task-guidance.mjs';

const graph = await readScreenGraph();
const taskDialogSource = ['showTask', 'taskDetailSections'].map(name => screenFunctionSource(graph, name)).join('\n');

function dialogHarness() {
  const controls = [], buttons = [], nodes = [], attempts = [], accepted = [];
  const state = { revision: 7, members: [
    { id: 'reed', name: 'Reed', completedTasks: [], taskStatus: {} },
    { id: 'actor1', name: 'Player', completedTasks: [], taskStatus: {} },
  ] };
  const node = tag => { const value = { tag, value: '', dataset: {}, append() {}, replaceChildren() {}, addEventListener() {}, setAttribute() {} }; nodes.push(value); return value; };
  const context = createContext({ appendTaskClaim, createTaskClaimClock,
    supportsFeature: feature => supportsDatasetFeature({ capabilities: { features: {} } }, feature),
    canWrite: () => true, advanced: () => false, createMapDisplay: () => ({ sizes: { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1 }, open() {}, close() {}, refresh() {}, isOpen: () => false }), createHelperView: () => ({}), createBackupStatus: () => ({ start() {}, refresh: async () => {}, line: () => null }), createDuoCoordination, sandbox: { active: false }, duoEnabled: () => false, state, memberId: 'reed', result: undefined, fullResult: undefined, definitions: {}, document: { createElement: node }, itemIcon: () => null,
    createNoteEditor, renderTaskEquipment, renderTaskBlockerGuidance, createTaskFilters, appendTaskPin, isTaskPinned, createTaskPinChecker, dialogCurrent: () => true,
    el: node, field: () => node('label'), openDialog() {},
    check(label, checked, action) { controls.push({ label, checked, action }); return node('checkbox'); },
    button(label, action) { buttons.push({ label, action }); return node('button'); },
    member: () => state.members.find(owner => owner.id === context.memberId),
    async command(payload) {
      const copy = JSON.parse(JSON.stringify(payload)); attempts.push(copy);
      if (!state.members.some(owner => owner.id === payload.memberId)) throw new TypeError('Unknown member');
      accepted.push(copy);
    },
  });
  context.panelContext = { el: context.el, field: context.field, button: context.button, command: context.command, state: () => state, showError(error) { throw error; } };
  context.c = context;
  runInContext(taskDialogSource, context);
  context.showTask({ id: 'custom:obtain', label: 'Obtain equipment', category: 'Custom', status: 'available' });
  nodes.find(value => value.tag === 'textarea').value = 'Reed’s personal note';
  return { context, state, controls, buttons, attempts, accepted };
}

test('task-dialog progress and notes stay bound to the reviewed member after selection changes', async () => {
  const harness = dialogHarness();
  assert.match(harness.controls[0].label, /Counts for our chunk challenge · Reed/);
  assert.match(harness.controls[1].label, /Reed did this in-game personally/);
  harness.context.memberId = 'actor1';
  for (const control of harness.controls) await control.action(true);
  await harness.buttons.find(button => button.label === 'Save note').action();
  // Backlog moved to its own button with a reason; the three checkboxes and the note remain.
  assert.equal(harness.accepted.length, 4);
  assert.ok(harness.accepted.every(command => command.memberId === 'reed'));
  assert.deepEqual(harness.accepted.map(command => command.type), [
    'set-task-status', 'complete-task', 'set-task-status', 'set-task-status',
  ]);
  assert.equal(harness.accepted.at(-1).note, 'Reed’s personal note');
});

test('a removed task-dialog member cannot redirect stale progress or notes to the surviving member', async () => {
  const harness = dialogHarness();
  harness.state.members = harness.state.members.filter(owner => owner.id !== 'reed');
  harness.context.memberId = 'actor1';
  for (const control of harness.controls) await assert.rejects(control.action(true), /Unknown member/);
  await assert.rejects(harness.buttons.find(button => button.label === 'Save note').action(), /Unknown member/);
  assert.equal(harness.accepted.length, 0);
  assert.equal(harness.attempts.length, 4);
  assert.ok(harness.attempts.every(command => command.memberId === 'reed'));
});
