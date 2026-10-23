import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTaskWhy, catalogued, createRuleDescriber, renderTaskWhy } from '../app/web/task-why.mjs';

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.hidden = false; }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') { const text = new Node('#text'); text.textContent = node; node = text; } node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(key, action) { (this.events[key] ??= []).push(action); }
  click() { return Promise.all((this.events.click ?? []).map(action => action())); }
}
const document = { createElement: tag => new Node(tag) };
const all = node => [node, ...node.children.flatMap(all)];
const text = node => all(node).map(value => value.textContent ?? '').join('');
const button = (label, action, cls) => { const node = new Node('button'); node.textContent = label; node.className = cls; node.addEventListener('click', action); return node; };
const icon = name => Object.assign(new Node('span'), { className: `icon icon-${name}` });

const task = { id: 'x:lantern', label: 'Obtain an ~|attuned lantern|~', rawLabel: 'Obtain an ~|attuned lantern|~', category: 'Extra', status: 'available', blockers: [],
  record: { Category: ['Gear Goals'], Label: 'Gear Goals', Set: 'Lantern set', Priority: 1 },
  sources: [{ kind: 'drop', source: 'Fixture ghost', location: 'Fixture cellar', rate: '1/2000', probability: 0.0005 }] };
const loser = { id: 'x:plain', label: 'Obtain a lantern', rawLabel: 'Obtain a lantern', category: 'Extra', status: 'blocked',
  blockers: [{ kind: 'outclassed', detail: 'preferred' }], record: { Category: ['Gear Goals'], Set: 'Lantern set', Priority: 2 } };
const rulesModule = async () => ({
  rulesCatalogue: { sections: [{ name: 'Visible Tasks', rows: [{ key: 'Gear Goals', label: 'Gear Goals' }] }, { name: 'Item Sources', rows: [{ key: 'Rare Drop', label: 'Rare Drop' }] }] },
  taskRuleValue: (state, memberId, { id }) => id === 'Rare Drop Amount' ? { value: '1000', source: 'Automatic' }
    : id === 'Gear Goals' ? { value: state.members[0].taskRules['Gear Goals'], source: 'Personal override' } : { value: true, source: 'Automatic' },
});
const state = { members: [{ id: 'fixture', taskRules: { 'Gear Goals': true } }] };

test('rule descriptions read the Rules screen labels and keep internal tags out', async () => {
  const describe = await createRuleDescriber(state, 'fixture', rulesModule);
  assert.deepEqual(describe('Gear Goals'), { label: 'Gear Goals', section: 'Visible Tasks', value: true, on: true, source: 'Personal override', catalogued: true });
  assert.equal(catalogued(describe)('Internal tag'), undefined);
  assert.equal(catalogued(describe)('Rare Drop Amount').value, '1000');
  assert.equal((await createRuleDescriber({ members: [{ id: 'fixture', taskRules: { 'Gear Goals': 'false' } }] }, 'fixture', rulesModule))('Gear Goals').on, false);
});

test('the explanation names the rule, category, set and rare drop in plain lines', async () => {
  const describeRule = catalogued(await createRuleDescriber(state, 'fixture', rulesModule));
  const { explainTask } = await import('../app/tasks/task-provenance.mjs');
  const card = renderTaskWhy(explainTask(task, { result: { tasks: [task, loser] }, describeRule }), { document });
  const lines = card.children.map(text);
  assert.deepEqual(lines, [
    'Why this task?',
    'Rule: Gear Goals, on (your setting) · Rules → Visible Tasks',
    'Extra: goals outside skills, quests and diaries, such as gear, collection logs and drops',
    'Picked over: Obtain a lantern (same set)',
    'Possible from: Fixture ghost, Fixture cellar (1/2000, counts because Rare Drop is on)',
  ]);
});

test('with a rule opener the panel links to the rule instead of naming its section', async () => {
  const describeRule = catalogued(await createRuleDescriber(state, 'fixture', rulesModule));
  const { explainTask } = await import('../app/tasks/task-provenance.mjs');
  const opened = [];
  const card = renderTaskWhy(explainTask(task, { result: { tasks: [task] }, describeRule }), { document, openRule: id => opened.push(id) });
  assert.equal(text(card.children[1]), 'Rule: Gear Goals, on (your setting)');
  const link = all(card).find(node => node.className === 'task-why-link');
  assert.equal(link.textContent, 'Change in Rules → Visible Tasks');
  await link.click();
  assert.deepEqual(opened, ['Gear Goals']);
});

test('the ? button loads once opened, toggles, and reports a load failure inline', async () => {
  const row = new Node('div'); let loads = 0;
  const describeRule = catalogued(await createRuleDescriber(state, 'fixture', rulesModule));
  const toggle = appendTaskWhy(row, task, { document, button, icon, load: async value => { loads++; return { task: value, result: { tasks: [value] }, describeRule }; } });
  const panel = row.children[1];
  assert.equal(loads, 0); assert.equal(panel.hidden, true);
  assert.equal(toggle.getAttribute('aria-label'), 'Why is Obtain an attuned lantern here?');
  assert.equal(toggle.getAttribute('aria-controls'), panel.id);
  await toggle.click();
  assert.equal(loads, 1); assert.equal(panel.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(text(panel), /Rule: Gear Goals, on/);
  await toggle.click();
  assert.equal(panel.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  const failing = new Node('div');
  const broken = appendTaskWhy(failing, task, { document, button, icon, load: async () => { throw new Error('The selected map or saved state changed while loading. Open the panel again.'); } });
  await broken.click();
  assert.match(text(failing.children[1]), /saved state changed/);
});
