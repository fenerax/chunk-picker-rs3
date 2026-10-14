import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuoTaskView } from '../app/web/duo-task-view.mjs';
import { readDuoPersonalFilter, writeDuoPersonalFilter, DUO_TASK_FILTER_STORAGE_KEY } from '../app/web/duo-task-preferences.mjs';

// Exercise the shipped row/controller without browser startup or a server.
class Node {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.classList = { add() {}, toggle() {} }; }
  append(...nodes) { for (const node of nodes) { node.remove?.(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, action) { (this.events[key] ??= []).push(action); }
  async emit(key, event = {}) { if (this.disabled && ['click', 'change'].includes(key)) return; await Promise.all((this.events[key] ?? []).map(action => action({ preventDefault() {}, stopPropagation() {}, target: this, ...event }))); if (key === 'click' && this.type === 'submit') await this.parent.emit('submit'); }
  focus() {}
  querySelector(selector) { return walk(this).find(node => node.tagName === selector.toUpperCase()); }
}
const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
const find = (root, tag, text) => walk(root).find(node => node.tagName === tag.toUpperCase() && (text === undefined || node.textContent === text));
const click = (root, text) => { const node = find(root, 'button', text); assert.ok(node, `Missing button: ${text}`); return node.emit('click'); };

function harness({ selected = 'actor1', editable = true, claimMember, explicitMember = false, storage, getStorage = () => storage, getViewerId = () => 'viewer' } = {}) {
  const state = { revision: 7, members: [{ id: 'actor1', name: 'Player', taskStatus: {}, completedTasks: [] }, { id: 'reed', name: 'Reed', taskStatus: {}, completedTasks: [] }] };
  const commands = [], revisions = [], backlogs = [], popups = [], hovers = [], filters = [], errors = [];
  const document = { createElement: tag => new Node(tag) };
  const view = createDuoTaskView({ document, getState: () => state, getSelectedMember: () => selected,
    getStorage, getViewerId,
    getClaimMember: () => claimMember ?? selected, actingForMember: () => explicitMember,
    command: async (payload, revision) => { commands.push(payload); revisions.push(revision); }, backlog: (...args) => backlogs.push(args),
    showTask: (...args) => popups.push(args), attachHover: (...args) => hovers.push(args),
    appendIcon() {}, showError: error => errors.push(error), canEdit: () => editable, onFilter: () => filters.push(view.filter()),
  });
  return { view, state, commands, revisions, backlogs, popups, hovers, filters, errors, setSelected: id => { selected = id; view.refresh(); } };
}

test('secondary filter persists per viewer, refreshes selected player wording and clears alongside owner chips', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let viewer = 'actor1';
  const h = harness({ storage, getViewerId: () => viewer }); h.view.setEnabled(true);
  const picker = find(h.view.controls(), 'select');
  assert.equal(h.view.personalFilter(), 'group'); assert.equal(h.view.selectionNeedsInspection(), false);
  assert.ok(walk(picker).some(node => node.textContent === 'Not done by Player'));
  picker.value = 'not-done'; await picker.emit('change'); assert.equal(h.view.personalFilter(), 'not-done');
  assert.equal(h.view.selectionNeedsInspection(), true);
  assert.equal(readDuoPersonalFilter(storage, 'actor1'), 'not-done');
  assert.equal(harness({ storage, getViewerId: () => 'actor1' }).view.personalFilter(), 'not-done');
  h.setSelected('reed'); assert.equal(picker.value, 'not-done'); assert.ok(walk(picker).some(node => node.textContent === 'Not done by Reed'));
  viewer = 'reed'; h.view.refresh(); assert.equal(picker.value, 'group');
  picker.value = 'only-player'; await picker.emit('change'); assert.equal(readDuoPersonalFilter(storage, 'reed'), 'only-player');
  viewer = 'actor1'; h.view.refresh(); assert.equal(picker.value, 'not-done');
  await click(h.view.controls(), 'Both'); h.view.clearFilter();
  assert.equal(h.view.filter(), 'all'); assert.equal(h.view.personalFilter(), 'group'); assert.equal(readDuoPersonalFilter(storage, 'actor1'), 'group');
  assert.equal(readDuoPersonalFilter(storage, 'reed'), 'only-player');
  assert.ok([...values.keys()].every(key => key.startsWith(`${DUO_TASK_FILTER_STORAGE_KEY}:`)));
  assert.equal(h.commands.length, 0);
});

test('secondary filter survives denied or corrupt storage without changing gameplay', async () => {
  for (const getStorage of [() => { throw new Error('Denied'); }, () => ({ getItem: () => '{broken', setItem: () => { throw new Error('Quota'); } })]) {
    const h = harness({ getStorage }); h.view.setEnabled(true);
    const picker = find(h.view.controls(), 'select'); assert.equal(picker.value, 'group');
    picker.value = 'only-player'; await picker.emit('change'); assert.equal(h.view.personalFilter(), 'only-player');
    h.view.clearFilter(); assert.equal(h.view.personalFilter(), 'group'); assert.equal(h.commands.length, 0);
  }
  assert.equal(writeDuoPersonalFilter(undefined, 'only-player'), false);
});

test('inspection rows attribute each blocker and use the admitted owner for popup and hover', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']);
  goal.tasksByMember.actor1 = { ...goal.task, status: 'blocked', blockers: [{ detail: 'Needs Mining 40' }] };
  goal.tasksByMember.reed = { ...goal.task, status: 'unsupported', blockers: [{ detail: 'Needs review of recipe' }] };
  goal.memberId = 'reed'; goal.task = goal.tasksByMember.reed; goal.displayMemberIds = ['reed']; goal.inspectionOnly = true;
  const row = h.view.row(goal);
  assert.ok(walk(row).some(node => node.textContent === 'Reed: Needs review of recipe'));
  assert.equal(walk(row).some(node => node.textContent === 'Player: Needs Mining 40'), false);
  await click(row, goal.task.label); assert.equal(h.popups[0][2].memberId, 'reed'); assert.strictEqual(h.hovers[0][2], goal.tasksByMember.reed);
  goal.displayMemberIds = ['actor1', 'reed'];
  const all = h.view.row(goal); assert.ok(walk(all).some(node => node.textContent === 'Player: Needs Mining 40'));
});

test('not-done row shows a personal unchecked box with partner completion attribution and checks the selected player', async () => {
  const h = harness(), goal = entry(['actor1', 'reed'], ['reed']);
  goal.personalCompletion = true; goal.filterMemberIds = goal.displayMemberIds = ['actor1'];
  const row = h.view.row(goal), check = find(row, 'input');
  assert.equal(check.checked, false); assert.ok(walk(row).some(node => node.textContent === 'Done by Reed'));
  check.checked = true; await check.emit('change');
  assert.deepEqual(h.commands, [{ type: 'set-task-status', memberId: 'actor1', taskId: goal.id, challengeCompleted: true }]);
  assert.equal(find(row, 'select'), undefined);
});
function entry(memberIds = ['reed'], completedBy = []) {
  const task = { id: 'rs3:task:test', label: 'Owner-specific goal', category: 'Mining', status: 'available', level: 20 };
  const facts = { group: completedBy.length > 0, personal: false, completedBy };
  return { id: task.id, task, memberIds, label: memberIds.length > 1 ? 'Both' : memberIds[0] === 'reed' ? 'Reed' : 'Player', memberId: memberIds[0], facts,
    factsByMember: Object.fromEntries(memberIds.map(id => [id, facts])), tasksByMember: Object.fromEntries(memberIds.map(id => [id, task])) };
}

test('a personally completed row retains the partner claim badge without allowing takeover', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']);
  goal.factsByMember.actor1 = { group: true, personal: true, completedBy: ['actor1'] };
  h.state.taskClaims = { [goal.id]: { memberId: 'reed', at: '2026-10-11T12:00:00Z' } };
  const row = h.view.row(goal);
  assert.ok(walk(row).some(node => node.textContent === 'Reed is doing this'));
  const takeover = find(row, 'button', 'Take over'); assert.equal(takeover.disabled, true);
  await takeover.emit('click'); assert.equal(h.commands.length, 0);
  assert.ok(!walk(row).some(node => node.className === 'task-claim-confirm'));
});

test('an unfinished partner contribution cannot be claimed by a player who already finished its family', () => {
  const h = harness(), goal = entry(['reed']);
  goal.facts.completedBy = ['actor1'];
  h.state.taskClaims = { [goal.id]: { memberId: 'reed', at: '2026-10-11T12:00:00Z' } };
  const row = h.view.row(goal);
  assert.ok(find(row, 'button', 'Take over').disabled);
  assert.ok(walk(row).some(node => node.textContent === 'Reed is doing this'));
});

test('completed rows omit a new claim action but allow clearing an existing own claim', async () => {
  const h = harness(), goal = entry(['actor1', 'reed'], ['actor1']);
  assert.equal(find(h.view.row(goal), 'button', 'I’m doing this'), undefined);
  h.state.taskClaims = { [goal.id]: { memberId: 'actor1', at: '2026-10-11T12:00:00Z' } };
  const row = h.view.row(goal), stop = find(row, 'button', 'Stop doing this'); assert.equal(stop.disabled, false);
  await stop.emit('click'); assert.deepEqual(h.commands, [{ type: 'clear-task-claim', memberId: 'actor1', taskId: goal.id }]);
});

test('completed claim clearing keeps current-revision and editing guards', async () => {
  for (const editable of [true, false]) {
    const h = harness({ editable }), goal = entry(['actor1', 'reed'], ['actor1']);
    h.state.taskClaims = { [goal.id]: { memberId: 'actor1', at: '2026-10-11T12:00:00Z' } };
    const stop = find(h.view.row(goal), 'button', 'Stop doing this');
    if (editable) h.state.revision++;
    await stop.emit('click'); assert.equal(h.commands.length, 0);
    assert.equal(h.errors.length, editable ? 1 : 0);
  }
});

test('group filters expose the members and Both, retain choice, and hide when disabled', async () => {
  const h = harness(), controls = h.view.controls(); h.view.setEnabled(true);
  assert.equal(h.view.filter(), 'all');
  for (const [label, id] of [['Reed', 'reed'], ['Both', 'both'], ['Player', 'actor1'], ['All', 'all']]) {
    await click(controls, label); assert.equal(h.view.filter(), id);
  }
  assert.deepEqual(h.filters, ['reed', 'both', 'actor1', 'all']);
  h.view.setEnabled(false); assert.equal(controls.hidden, true);
  h.view.setEnabled(true); assert.equal(controls.hidden, false);
});

test('partner-only row shows its owner and routes popup, hover, check and backlog to that owner', async () => {
  const h = harness(), goal = entry(), row = h.view.row(goal);
  assert.ok(walk(row).some(node => node.textContent === 'Reed'));
  await click(row, goal.task.label);
  assert.equal(h.popups[0][2].memberId, 'reed'); assert.equal(h.popups[0][2].duoEntry, goal);
  assert.equal(h.hovers[0][3], 'reed');
  const check = find(row, 'input'); check.checked = true; await check.emit('change');
  assert.equal(h.commands[0].memberId, 'reed'); assert.equal(h.commands[0].taskId, goal.id); assert.equal(h.commands[0].challengeCompleted, true);
  const backlogButton = walk(row).find(node => node.tagName === 'BUTTON' && /Backlog/.test(node.textContent || node.attributes['aria-label'] || ''));
  assert.ok(backlogButton); await backlogButton.emit('click');
  assert.equal(h.backlogs[0][3], 'reed');
});

test('Both rows require confirmation for checks and default to the selected owner', async () => {
  const h = harness({ selected: 'reed' }), goal = entry(['actor1', 'reed']), row = h.view.row(goal);
  assert.ok(walk(row).some(node => node.textContent === 'Both'));
  await click(row, goal.task.label); assert.equal(h.popups[0][2].memberId, 'reed'); assert.equal(h.popups[0][2].duoEntry, goal);
  const check = find(row, 'input'); check.checked = true; await check.emit('change');
  assert.equal(h.commands.length, 0);
  const chooser = find(row, 'select'); assert.ok(chooser); assert.equal(chooser.value, 'reed');
  await click(row, 'Cancel'); assert.equal(h.commands.length, 0); assert.equal(find(row, 'select'), undefined);
  check.checked = true; await check.emit('change'); find(row, 'select').value = 'actor1';
  await click(row, 'Mark done');
  assert.deepEqual(h.commands.map(({ type, memberId, taskId, challengeCompleted }) => ({ type, memberId, taskId, challengeCompleted })), [{ type: 'set-task-status', memberId: 'actor1', taskId: goal.id, challengeCompleted: true }]);
});

test('Both backlog chooser confirms the chosen owner before opening its reason form', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']), row = h.view.row(goal);
  const backlogButton = walk(row).find(node => node.tagName === 'BUTTON' && /Backlog/.test(node.textContent || node.attributes['aria-label'] || ''));
  assert.ok(backlogButton); await backlogButton.emit('click'); assert.equal(h.backlogs.length, 0);
  const chooser = find(row, 'select'); assert.equal(chooser.value, 'actor1'); chooser.value = 'reed';
  const confirm = walk(row).find(node => node.tagName === 'BUTTON' && node.type === 'submit');
  assert.equal(confirm.textContent, 'Backlog…'); await confirm.emit('click');
  assert.equal(h.backlogs[0][3], 'reed'); assert.equal(h.commands.length, 0);
});

test('shared done checks use group completion and name the completing member', () => {
  const h = harness(), row = h.view.row(entry(['actor1', 'reed'], ['reed']));
  assert.equal(find(row, 'input').checked, true);
  assert.ok(walk(row).some(node => node.textContent === 'Done by Reed'));
});

test('Both popup and hover use the preferred owner’s task evidence', async () => {
  const h = harness({ selected: 'reed' }), goal = entry(['actor1', 'reed']);
  const reedTask = { ...goal.task, level: 35, explanation: 'Reed-specific requirement' };
  goal.tasksByMember.reed = reedTask;
  const row = h.view.row(goal); await click(row, goal.task.label);
  assert.equal(h.popups[0][0], reedTask); assert.equal(h.popups[0][2].memberId, 'reed'); assert.equal(h.popups[0][2].duoEntry, goal);
  assert.equal(h.hovers[0][2], reedTask); assert.equal(h.hovers[0][3], 'reed');
});

test('clearing a shared check still confirms the member whose record will change', async () => {
  const h = harness(), goal = entry(['actor1', 'reed'], ['reed']), row = h.view.row(goal);
  const check = find(row, 'input'); check.checked = false; await check.emit('change');
  assert.equal(check.checked, true); assert.equal(h.commands.length, 0);
  find(row, 'select').value = 'reed'; await click(row, 'Clear check');
  assert.equal(h.commands[0].memberId, 'reed'); assert.equal(h.commands[0].challengeCompleted, false);
});

test('updating or sandbox rows disable mutations and task popups that could expose stale commands', async () => {
  const h = harness({ editable: false }), goal = entry(), row = h.view.row(goal);
  assert.equal(find(row, 'input').disabled, true);
  const backlogButton = walk(row).find(node => node.tagName === 'BUTTON' && /Backlog/.test(node.textContent || node.attributes['aria-label'] || ''));
  assert.equal(backlogButton.disabled, true);
  assert.equal(find(row, 'button', goal.task.label).disabled, true);
  await click(row, goal.task.label); assert.equal(h.popups.length, 0); assert.equal(h.commands.length, 0);
});

test('Both check and backlog commands use the canonical union identity after selecting another owner', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']);
  goal.id = 'rs3:task:canonical'; goal.task.id = 'historical-ambiguous';
  goal.tasksByMember.reed = { ...goal.task, id: goal.id };
  const row = h.view.row(goal), check = find(row, 'input'); check.checked = true; await check.emit('change');
  find(row, 'select').value = 'reed'; await click(row, 'Mark done');
  assert.equal(h.commands[0].memberId, 'reed'); assert.equal(h.commands[0].taskId, goal.id);
  await click(row, 'Backlog…'); find(row, 'select').value = 'reed';
  const confirm = walk(row).find(node => node.tagName === 'BUTTON' && node.type === 'submit'); await confirm.emit('click');
  assert.equal(h.backlogs[0][1].id, goal.id); assert.equal(h.backlogs[0][3], 'reed');
});

test('backlogged partner rows restore the canonical owner in one revision-checked command', async () => {
  const h = harness(), goal = entry(); goal.stateRevision = 7; goal.id = 'canonical';
  const row = h.view.row(goal, { backlogged: true });
  assert.equal(find(row, 'button', 'I’m doing this'), undefined);
  await click(row, 'Restore…');
  assert.deepEqual(h.commands, [{ type: 'clear-backlog', memberId: 'reed', taskIds: ['canonical'] }]);
  assert.deepEqual(h.revisions, [7]);
  assert.equal(h.backlogs.length, 0);
});

test('shared backlog row Restore asks whose record to restore; viewer rows hide it', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']); goal.stateRevision = 7;
  const row = h.view.row(goal, { backlogged: true }); await click(row, 'Restore…');
  assert.equal(h.commands.length, 0); find(row, 'select').value = 'reed'; await click(row, 'Restore');
  assert.deepEqual(h.commands, [{ type: 'clear-backlog', memberId: 'reed', taskIds: [goal.id] }]);
  const viewer = harness({ editable: false }), viewerRow = viewer.view.row(goal, { backlogged: true });
  const restore = find(viewerRow, 'button', 'Restore…'); assert.equal(restore.hidden, true); assert.equal(restore.disabled, true);
  await restore.emit('click'); assert.equal(viewer.commands.length, 0);
});

test('saved disclosure row confirmations cannot write after the saved revision changes', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']); goal.stateRevision = 7;
  const row = h.view.row(goal, { backlogged: true }); await click(row, 'Restore…');
  h.state.revision = 8; await click(row, 'Restore');
  assert.equal(h.commands.length, 0); assert.equal(h.errors.length, 1);
});

test('one click claims for the selected player even on a partner-only task', async () => {
  const h = harness(), goal = entry(), row = h.view.row(goal);
  await click(row, 'I’m doing this');
  assert.deepEqual(h.commands, [{ type: 'claim-task', memberId: 'actor1', taskId: goal.id }]);
  assert.equal(h.popups.length, 0);
});

test('claims show the name and time in either player view and own claim clears in one click', async () => {
  const h = harness({ selected: 'reed' }), goal = entry(['actor1', 'reed']);
  h.state.taskClaims = { [goal.id]: { memberId: 'reed', at: new Date(Date.now() - 7200000).toISOString() } };
  const row = h.view.row(goal);
  assert.ok(walk(row).some(node => node.textContent === 'Reed is doing this'));
  assert.ok(walk(row).some(node => node.textContent === '2 h ago'));
  await click(row, 'Stop doing this');
  assert.deepEqual(h.commands, [{ type: 'clear-task-claim', memberId: 'reed', taskId: goal.id }]);
});

test('taking a partner claim needs a confirm and Cancel saves nothing', async () => {
  const h = harness(), goal = entry(['actor1', 'reed']);
  h.state.taskClaims = { [goal.id]: { memberId: 'reed', at: new Date().toISOString() } };
  const row = h.view.row(goal);
  await click(row, 'Take over'); assert.equal(h.commands.length, 0);
  await click(row, 'Cancel'); assert.equal(h.commands.length, 0);
  await click(row, 'Take over');
  const confirm = walk(row).filter(node => node.tagName === 'BUTTON' && node.textContent === 'Take over').at(-1);
  await confirm.emit('click');
  assert.deepEqual(h.commands, [{ type: 'claim-task', memberId: 'actor1', taskId: goal.id, takeover: true }]);
});

test('a stale takeover confirm cannot claim after another revision arrives', async () => {
  const h = harness(), goal = entry();
  h.state.taskClaims = { [goal.id]: { memberId: 'reed', at: new Date().toISOString() } };
  const row = h.view.row(goal); await click(row, 'Take over'); h.state.revision++;
  await walk(row).filter(node => node.tagName === 'BUTTON' && node.textContent === 'Take over').at(-1).emit('click');
  assert.equal(h.commands.length, 0); assert.match(h.errors[0].message, /changed/);
});

test('updating rows disable the visible claim action and completed tasks have none', () => {
  const h = harness({ editable: false });
  assert.equal(find(h.view.row(entry()), 'button', 'I’m doing this').disabled, true);
  assert.equal(find(h.view.row(entry(['actor1', 'reed'], ['actor1'])), 'button', 'I’m doing this'), undefined);
});


test('session identity claims and clears independently of the selected map', async () => {
  const h = harness({ selected: 'reed', claimMember: 'actor1' }), goal = entry();
  const row = h.view.row(goal), claim = find(row, 'button', 'I’m doing this');
  await claim.emit('click');
  assert.deepEqual(h.commands, [{ type: 'claim-task', memberId: 'actor1', taskId: goal.id }]);
  assert.equal(Object.hasOwn(claim.attributes, 'aria-pressed'), false);
  h.state.taskClaims = { [goal.id]: { memberId: 'actor1', at: new Date().toISOString() } };
  await click(h.view.row(goal), 'Stop doing this');
  assert.deepEqual(h.commands[1], { type: 'clear-task-claim', memberId: 'actor1', taskId: goal.id });
});

test('master claims explicitly name the selected player and confirm named takeovers', async () => {
  const h = harness({ selected: 'actor1', explicitMember: true }), goal = entry();
  const row = h.view.row(goal), claim = find(row, 'button', 'Claim for Player');
  assert.ok(claim, 'Master button must name the selected member');
  assert.equal(Object.hasOwn(claim.attributes, 'aria-pressed'), false);
  assert.equal(claim.attributes['aria-label'], `Claim for Player: ${goal.task.label}`);
  await claim.emit('click');
  assert.equal(h.commands[0].memberId, 'actor1');
  h.state.taskClaims = { [goal.id]: { memberId: 'reed', at: new Date().toISOString() } };
  const takeover = h.view.row(goal);
  await click(takeover, 'Take over for Player');
  assert.equal(h.commands.length, 1);
  assert.ok(walk(takeover).some(node => node.textContent === 'Take over from Reed for Player?'));
  await walk(takeover).filter(node => node.textContent === 'Take over for Player').at(-1).emit('click');
  assert.deepEqual(h.commands[1], { type: 'claim-task', memberId: 'actor1', taskId: goal.id, takeover: true });
});

test('a viewer can see ownership but cannot claim, clear or take over', async () => {
  const h = harness({ editable: false, claimMember: 'actor1' }), goal = entry();
  for (const owner of [undefined, 'actor1', 'reed']) {
    h.state.taskClaims = owner ? { [goal.id]: { memberId: owner, at: new Date().toISOString() } } : {};
    const row = h.view.row(goal), action = walk(row).find(node => node.className === 'task-claim-action');
    assert.equal(action.disabled, true);
    assert.equal(Object.hasOwn(action.attributes, 'aria-pressed'), false);
    await action.emit('click');
    assert.equal(h.commands.length, 0);
    assert.ok(!walk(row).some(node => node.className === 'task-claim-confirm'));
  }
});
