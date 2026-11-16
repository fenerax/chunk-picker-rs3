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
import { taskExplanation } from '../app/tasks/task-provenance.mjs';
import { appendTaskHow } from '../app/web/task-how.mjs';

const graph = await readScreenGraph();
const taskDialogSource = ['showTask', 'taskDetailSections'].map(name => screenFunctionSource(graph, name)).join('\n');

function dialogHarness() {
  const controls = [], buttons = [], nodes = [], attempts = [], accepted = [];
  const state = { revision: 7, members: [
    { id: 'reed', name: 'Reed', completedTasks: [], taskStatus: {} },
    { id: 'actor1', name: 'Player', completedTasks: [], taskStatus: {} },
  ] };
  const node = (tag, textContent) => { const value = { tag, textContent, value: '', dataset: {}, children: [],
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    addEventListener() {}, setAttribute() {} }; nodes.push(value); return value; };
  const context = createContext({ appendTaskClaim, createTaskClaimClock,
    supportsFeature: feature => supportsDatasetFeature({ capabilities: { features: {} } }, feature),
    canWrite: () => true, advanced: () => false, createMapDisplay: () => ({ sizes: { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1 }, open() {}, close() {}, refresh() {}, isOpen: () => false }), createHelperView: () => ({}), createBackupStatus: () => ({ start() {}, refresh: async () => {}, line: () => null }), createDuoCoordination, sandbox: { active: false }, duoEnabled: () => false, state, memberId: 'reed', result: undefined, shownResult: undefined, fullResult: undefined, definitions: {}, document: { createElement: node }, itemIcon: () => null,
    createNoteEditor, noteDrafts: new Map(), renderTaskEquipment, renderTaskBlockerGuidance, taskExplanation, createTaskFilters, appendTaskPin, isTaskPinned, createTaskPinChecker, dialogCurrent: () => true,
    appendTaskHow, appendTaskWhy() {}, preferences: () => ({}), viewCache: undefined, icon: () => null,
    createWhyChainDisclosure: () => node('div'),
    el: node, field: () => node('label'), openDialog(title, content) { context.dialog = content; return 1; },
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
  return { context, state, controls, buttons, attempts, accepted, nodes };
}

const dialogText = node => [node.textContent ?? '', ...node.children.map(dialogText)].join(' ');
function howDialog({ ownerId = 'reed', status = 'available', enabled = true } = {}) {
  const harness = dialogHarness(), { context, state } = harness;
  const task = { id: 'Extra:Gather', label: 'Gather supplies', category: 'Extra', status };
  const result = { memberId: ownerId, stateRevision: state.revision, tasks: [task] };
  const calls = [], preferences = { showTaskHow: enabled };
  context.preferences = () => preferences;
  context.sandbox.signature = () => 'saved';
  context.duoDetails = new Map();
  context.api = async (url, body, signal) => { calls.push({ url, signal }); return {
    context: { memberId: ownerId, stateRevision: 7 }, subject: { id: task.id },
    proofStatus: 'complete', root: 'goal', nodes: { goal: { kind: 'task', label: 'Gather synthetic supplies.', allOf: [] } },
  }; };
  context.showTask(task, false, { memberId: ownerId, result });
  return { ...harness, calls, preferences, toggle: harness.buttons.find(button => button.label === 'How?') };
}

test('available task details opened without a sidebar row lazily load How for the displayed owner', async () => {
  for (const ownerId of ['reed', 'actor1']) {
    const harness = howDialog({ ownerId });
    assert.ok(harness.toggle, 'task details offer How?');
    assert.equal(harness.calls.length, 0);
    await harness.toggle.action();
    assert.equal(harness.calls.length, 1);
    const request = new URL(harness.calls[0].url, 'http://fixture');
    assert.equal(request.pathname, '/api/task-how');
    assert.equal(request.searchParams.get('memberId'), ownerId);
    assert.equal(request.searchParams.get('taskId'), 'Extra:Gather');
    assert.equal(request.searchParams.get('revision'), '7');
    assert.ok(harness.calls[0].signal instanceof AbortSignal);
    assert.match(dialogText(harness.context.dialog), /Gather synthetic supplies/);
  }
});

test('task detail How respects the preference and task availability', () => {
  for (const options of [{ enabled: false }, { status: 'blocked' }, { status: 'completed' }]) {
    const harness = howDialog(options);
    assert.equal(harness.toggle, undefined);
    assert.equal(harness.calls.length, 0);
  }
});

test('task detail How rejects late proofs after the dialog or saved context changes', async () => {
  for (const change of [h => h.state.revision++, h => { h.context.memberId = 'actor1'; },
    h => { h.context.dialogCurrent = () => false; }, h => { h.preferences.showTaskHow = false; },
    h => { h.context.sandbox.signature = () => 'changed'; }]) {
    const harness = howDialog(); let resolve;
    const proof = await harness.context.api('/fixture');
    harness.context.api = () => new Promise(done => { resolve = done; });
    const pending = harness.toggle.action();
    change(harness); resolve(proof); await pending;
    assert.doesNotMatch(dialogText(harness.context.dialog), /Gather synthetic supplies/);
    assert.ok(harness.buttons.some(button => button.label === 'Retry How'));
  }
});

test('task detail How validates proof identity and refuses sandbox or disabled requests', async () => {
  for (const change of [h => { h.context.sandbox.active = true; }, h => { h.preferences.showTaskHow = false; }]) {
    const harness = howDialog(); change(harness); await harness.toggle.action();
    assert.equal(harness.calls.length, 0);
  }
  for (const mutate of [proof => proof.context.memberId = 'actor1', proof => proof.context.stateRevision++, proof => proof.subject.id = 'Extra:Other']) {
    const harness = howDialog(), proof = await harness.context.api('/fixture'); mutate(proof);
    harness.context.api = async () => proof;
    await harness.toggle.action();
    assert.doesNotMatch(dialogText(harness.context.dialog), /Gather synthetic supplies/);
    assert.ok(harness.buttons.some(button => button.label === 'Retry How'));
  }
});

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
