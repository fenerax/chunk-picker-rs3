import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { taskBlockerGuidance, renderTaskBlockerGuidance } from '../app/web/screen-task-guidance.mjs';
import { createDuoTaskView } from '../app/web/duo-task-view.mjs';
import { createNoteEditor } from '../app/web/info-panels.mjs';

// Screen imports use served /core routes. Exercise its actual factory with inert
// equipment/map collaborators, as the broader screen harness does.
const dialogsSource = await readFile(new URL('../app/web/screen-task-dialogs.mjs', import.meta.url), 'utf8');
const createScreenTaskDialogs = runInNewContext(`${dialogsSource.replace(/^import .+\r?\n/gm, '').replace(/^export /gm, '')}\ncreateScreenTaskDialogs`, {
  createQuestMap: () => ({}), renderTaskEquipment: () => null, createNoteEditor, renderTaskBlockerGuidance,
});

class Node {
  constructor(tag, text = '', className = '') { Object.assign(this, { tag, textContent: text, className, children: [], events: {}, attributes: {}, dataset: {} }); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, action) { this.events[key] = action; }
  querySelector(tag) { return walk(this).find(node => node.tag === tag); }
  replaceChildren(...nodes) { this.children = nodes; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
function harness() {
  const actions = [], c = {
    memberId: 'owner',
    el: (tag, text, cls) => new Node(tag, text, cls), plain: value => value,
    button(text, action) { const node = new Node('button', text); node.action = action; return node; },
    details(text, body) { const node = new Node('details', text); node.append(body); return node; },
    sourceView(sources, result, openTask) { actions.push({ sources, result, openTask }); return new Node('sources'); },
    rulesDialog: options => actions.push(options), closeDialog: () => actions.push('close'),
    map: { centerOnChunk: id => actions.push(['center', id]) }, showChunk: id => actions.push(['chunk', id]),
    world: { chunks: new Map([['101', { name: 'Example shore' }]]) },
  };
  return { c, actions };
}

test('blocking rule routes to its exact rule and dialog owner without writing a command', () => {
  const { c, actions } = harness();
  const task = { blockers: [{ kind: 'rule', detail: 'Turned off in Rules: Misc achievements.' }] };
  const node = renderTaskBlockerGuidance(c, task, {}, { memberId: 'other', openTask() {} });
  const button = walk(node).find(row => row.tag === 'button');
  assert.equal(button.textContent, 'View blocking rule: Misc achievements'); button.action();
  assert.deepEqual(actions, [{ memberId: 'other', ruleId: 'Misc achievements' }]);
  assert.deepEqual(taskBlockerGuidance({ blockers: [{ kind: 'rule', detail: 'Unavailable under the skiller rule.' }, { kind: 'rule', detail: 'InsidePOH is disabled for workbench tasks above level 1.' }] }).rules, ['Skiller', 'InsidePOH']);
});

test('training guidance shows engine methods and connection evidence without predicting an unlock', () => {
  const { c, actions } = harness(), opened = [];
  const task = { id: 'goal', blockers: [{ kind: 'training', detail: "Thieving 37 needs an accessible primary training method; currently reachable level 5. Partner's chunks are not connected for Player: no return route." }] };
  const method = { id: 'method', category: 'Thieving', label: 'Example stall', level: 5, primaryMethod: true, status: 'blocked', blockers: [{ detail: 'Chunks: Example shore.' }], sources: [{ kind: 'chunks', name: '101', locations: ['101'] }] };
  const result = { tasks: [method, { ...method, id: 'secondary', primaryMethod: false }], training: { Thieving: { level: 5 }, Mining: { level: 99 } }, partnerConnections: { regions: [
    { ownerName: 'Partner', connected: false, reason: 'No return route', bases: ['101'] },
    { ownerName: 'Unrelated', connected: false, reason: 'No entry', bases: ['999'] },
  ] } };
  const before = structuredClone(result), node = renderTaskBlockerGuidance(c, task, result, { memberId: 'owner', openTask: row => opened.push(row) });
  const nodes = walk(node), text = nodes.map(row => row.textContent).join(' ');
  assert.match(text, /No specific unlock recommendation is known/);
  assert.match(text, /your chunks currently support level 5/); assert.match(text, /not your account level/);
  assert.match(text, /View Thieving training: Example stall/); assert.doesNotMatch(text, /Mining|Unrelated|View.*secondary/);
  nodes.find(row => row.textContent === 'View Thieving training: Example stall').action(); assert.deepEqual(opened, [method]);
  assert.equal(actions[0].sources, method.sources); assert.equal(actions[0].result, result);
  nodes.find(row => row.textContent === 'View disconnected chunk: Example shore').action();
  assert.deepEqual(actions.slice(1), ['close', ['center', '101'], ['chunk', '101']]);
  assert.deepEqual(result, before);
});

test('missing training and unsupported blockers say an unlock recommendation is unknown', () => {
  const { c } = harness();
  for (const blockers of [[{ kind: 'training', detail: 'Thieving 37 needs training.' }], [{ kind: 'unsupported', detail: 'Unknown requirement.' }]]) {
    const node = renderTaskBlockerGuidance(c, { blockers }, { training: { Thieving: { level: 5 } } }, { memberId: 'owner', openTask() {} });
    const text = walk(node).map(row => row.textContent).join(' ');
    assert.match(text, /No specific unlock recommendation is known/);
    if (blockers[0].kind === 'training') assert.match(text, /No primary Thieving training method is identified/);
    assert.ok(!walk(node).some(row => row.tag === 'button' && /Unlock|View disconnected/.test(row.textContent)));
  }
});

test('connection inspection switches the visible map to the reviewed task owner first', () => {
  const { c, actions } = harness(); c.memberId = 'selected';
  c.state = { members: [{ id: 'selected', name: 'Player A' }, { id: 'owner', name: 'Player B' }] };
  const picker = { value: 'selected', dispatchEvent(event) { assert.equal(event.type, 'change'); c.memberId = this.value; actions.push(['select', this.value]); } };
  c.$ = id => { assert.equal(id, 'member'); return picker; };
  c.showChunk = id => actions.push(['chunk', id, c.memberId]);
  const task = { blockers: [{ kind: 'training', detail: "Thieving 37: Partner's chunks are not connected for Player B." }] };
  const result = { partnerConnections: { regions: [{ ownerName: 'Partner', connected: false, reason: 'No return route', bases: ['101'] }] } };
  const node = renderTaskBlockerGuidance(c, task, result, { memberId: 'owner', openTask() {} });
  walk(node).find(row => row.textContent === 'View disconnected chunk: Example shore').action();
  assert.deepEqual(actions, [['select', 'owner'], 'close', ['center', '101'], ['chunk', '101', 'owner']]);
});

test('unavailable training exposes declared requirement locations without claiming access or an unlock', () => {
  const { c, actions } = harness();
  c.definitions = { chunks: { '101': { NPC: { 'Example trader': 1 } } } };
  const method = { id: 'method', category: 'Thieving', label: 'Example trader', level: 5, primaryMethod: true, status: 'blocked', sources: [], record: { NPCs: ['Example trader'] } };
  const task = { id: 'goal', blockers: [{ kind: 'training', detail: 'Thieving 37 needs training.' }] };
  const node = renderTaskBlockerGuidance(c, task, { tasks: [method], training: { Thieving: { level: 5 } } }, { memberId: 'owner', openTask() {} });
  const text = walk(node).map(row => row.textContent).join(' ');
  assert.match(text, /Recorded training locations/); assert.match(text, /may still be locked/); assert.match(text, /does not prove this method is available/);
  assert.deepEqual(actions[0].sources, [{ kind: 'chunks', name: 'Declared npc requirement: Example trader', locations: ['101'] }]);
});

test('known prerequisites resolve exact identifiers and never guess by display labels', () => {
  const tasks = [{ id: 'first', rawLabel: 'Raw prerequisite', category: 'Quest', label: 'Display' }, { id: 'second', rawLabel: 'Other', category: 'Quest', label: 'Raw prerequisite' }];
  const task = { id: 'goal', blockers: [{ kind: 'tasks' }], record: { Tasks: { 'Raw prerequisite': 'Quest' }, CompletedTasks: ['missing'] } };
  assert.deepEqual(taskBlockerGuidance(task, { tasks }).prerequisites, [tasks[0]]);
  assert.deepEqual(taskBlockerGuidance({ ...task, record: { CompletedTasks: 'invalid' } }, { tasks }).prerequisites, []);
});

test('duo checkbox explains challenge completion while preserving viewer guard and commands', async () => {
  const state = { revision: 1, members: [{ id: 'owner', name: 'Player' }] }, commands = [];
  const entry = { id: 'task', memberIds: ['owner'], label: 'Player', task: { id: 'task', label: 'Example task', status: 'blocked' }, facts: { group: false } };
  for (const writable of [false, true]) {
    const view = createDuoTaskView({ document: { createElement: tag => new Node(tag) }, getState: () => state, getSelectedMember: () => 'owner', getStorage: () => null,
      command: async command => commands.push(command), showError: error => { throw error; }, canEdit: () => writable });
    const check = view.row(entry).children[0];
    assert.equal(check.attributes['aria-label'], 'Counts for our chunk challenge: Example task · Player');
    assert.match(check.title, /personal in-game completion/); assert.equal(check.disabled, !writable);
    check.checked = true; await check.events.change();
  }
  assert.deepEqual(commands, [{ type: 'set-task-status', memberId: 'owner', taskId: 'task', challengeCompleted: true }]);
});

test('task dialog explains both completion controls beside their distinct existing commands', async () => {
  for (const writable of [true, false]) {
    const { c } = harness(), commands = [], task = { id: 'task', label: 'Example task', category: 'Custom', status: 'available' };
    const owner = { id: 'owner', name: 'Player', completedTasks: [], taskStatus: {} };
    let dialog;
    Object.assign(c, { memberId: 'owner', state: { revision: 1, members: [owner] }, result: { tasks: [task] }, duoDetails: new Map(),
      sandbox: { active: false }, definitions: {}, canWrite: () => writable, advanced: () => false, supportsFeature: () => false,
      command: async payload => commands.push(structuredClone(payload)), openDialog: (title, content) => { dialog = content; return 1; },
      check(text, checked, action) { const label = new Node('label', text), input = new Node('input'); input.checked = checked; input.disabled = !writable; input.action = action; label.append(input); return label; },
    });
    c.panelContext = { ...c, field: (label, input) => { const node = new Node('label', label); node.append(input); return node; } };
    createScreenTaskDialogs(c); await c.showTask(task);
    const nodes = walk(dialog), challenge = nodes.find(node => node.textContent === 'Counts for our chunk challenge · Player')?.children[0];
    const personal = nodes.find(node => node.textContent === 'Player did this in-game personally')?.children[0];
    assert.equal(challenge.disabled, !writable); assert.equal(personal.disabled, !writable);
    assert.equal(challenge.attributes['aria-describedby'], 'task-challenge-completion-help');
    assert.equal(personal.attributes['aria-describedby'], 'task-personal-completion-help');
    assert.ok(nodes.some(node => /challenge check alone does not record personal completion/.test(node.textContent)));
    if (writable) {
      await challenge.action(true); await personal.action(true);
      assert.deepEqual(commands, [
        { type: 'set-task-status', memberId: 'owner', taskId: 'task', challengeCompleted: true },
        { type: 'complete-task', memberId: 'owner', taskId: 'task', completed: true },
      ]);
    } else assert.equal(commands.length, 0);
  }
});
