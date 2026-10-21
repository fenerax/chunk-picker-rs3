import test from 'node:test';
import assert from 'node:assert/strict';
import { createCopyLists } from '../app/web/copy-lists.mjs';

class Element {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      this.children.push(node);
      node.parentElement = this;
    }
  }
  after(...nodes) {
    const parent = this.parentElement;
    for (const node of nodes) node.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, ...nodes);
    for (const node of nodes) node.parentElement = parent;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  querySelector(selector) { return walk(this).find(node => node.tagName.toLowerCase() === selector) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  async click() {
    assert.equal(this.disabled, false);
    await this.listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} });
  }
}

const walk = root => root.children.flatMap(child => [child, ...walk(child)]);

function fixture(t) {
  const saved = new Map(['document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const document = { createElement: tag => new Element(tag, document), activeElement: null };
  document.head = document.createElement('head');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  const root = document.createElement('main');
  const sidebar = document.createElement('aside');
  const heading = document.createElement('h2');
  const taskCount = document.createElement('span'); taskCount.id = 'task-count';
  const search = document.createElement('input');
  const completed = document.createElement('details'); completed.id = 'completed-details';
  const summary = document.createElement('summary');
  heading.append(taskCount); completed.append(summary); sidebar.append(heading, search, completed);
  const mapPanel = document.createElement('section');
  const counts = document.createElement('div'); counts.id = 'map-counts';
  counts.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  mapPanel.append(counts); root.append(sidebar, mapPanel);
  const members = [{ id: 'actor1', name: 'Player', unlocked: ['1'] }, { id: 'donald', name: 'Donald', unlocked: ['2', '3'] }];
  let selected = members[0];
  const commands = [];
  const context = {
    el: tag => document.createElement(tag),
    $: id => walk(root).find(node => node.id === id),
    plain: text => String(text ?? '').replace(/<[^>]*>/gu, ''),
    state: { members }, member: () => selected, sandbox: { active: false },
    world: { chunks: new Map([['1', { name: 'Lumbridge' }], ['2', { name: '<b>Draynor</b>' }], ['3', { name: '3' }]]) },
    canWrite: () => false,
    command: (...args) => { commands.push(args); throw new Error('viewer cannot write'); },
  };
  const view = createCopyLists(context);
  const byId = id => walk(root).find(node => node.id === id);
  const copy = async id => {
    const button = byId(id);
    assert.ok(button, `${id} button exists for a viewer`);
    await button.click();
    const textarea = byId(`${id}-text`);
    assert.equal(textarea.parentElement.hidden, false);
    assert.equal(textarea.readOnly, true);
    assert.equal(textarea.selectionEnd, textarea.value.length);
    assert.deepEqual(commands, []);
    return textarea.value;
  };
  return { root, sidebar, heading, search, completed, summary, mapPanel, counts, context, members, view, byId, copy,
    select: owner => { selected = owner; } };
}

test('active tasks preserve supplied category and item order beyond the screen row limit', async t => {
  const f = fixture(t);
  const rows = Array.from({ length: 75 }, (_, index) => ({ category: index % 2 ? 'Skills' : 'Quests', label: `<b>T${index}</b>` }));
  f.view.tasks(rows, []);
  const text = await f.copy('copy-active-tasks');
  const date = text.split('\n')[0].split(' — ').at(-1);
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(text, `Player — Active tasks (75) — ${date}\n\nQuests:\n${rows.filter(row => row.category === 'Quests').map(row => `- ${f.context.plain(row.label)}`).join('\n')}\n\nSkills:\n${rows.filter(row => row.category === 'Skills').map(row => `- ${f.context.plain(row.label)}`).join('\n')}`);
  const fallback = f.byId('copy-active-tasks-text').parentElement;
  assert.equal(f.sidebar.children.indexOf(fallback), f.sidebar.children.indexOf(f.heading) + 1);
  assert.equal(f.sidebar.children.indexOf(f.search), f.sidebar.children.indexOf(fallback) + 1);
  assert.equal(f.byId('copy-active-tasks').parentElement.parentElement, f.heading);
});

test('completed tasks refresh their snapshot and expose recovery outside closed details', async t => {
  const f = fixture(t);
  f.view.tasks([{ category: 'Skills', label: 'Active only' }], [{ category: 'Quests', label: 'Old completed' }]);
  assert.match(await f.copy('copy-completed-tasks'), /\n\nQuests:\n- Old completed$/u);
  f.view.tasks([{ category: 'Skills', label: 'Active only' }], [{ category: 'Achievements', label: '<i>New completed</i>' }]);
  assert.equal(f.byId('copy-completed-tasks-text').parentElement.hidden, true);
  const text = await f.copy('copy-completed-tasks');
  assert.match(text, /^Player — Completed tasks \(1\) — \d{4}-\d{2}-\d{2}\n\nAchievements:\n- New completed$/u);
  assert.equal(f.byId('copy-completed-tasks').parentElement.parentElement, f.summary);
  const fallback = f.byId('copy-completed-tasks-text').parentElement;
  assert.equal(fallback.parentElement === f.sidebar, true);
  assert.equal(f.sidebar.children.indexOf(fallback), f.sidebar.children.indexOf(f.completed) + 1);
  assert.equal(Boolean(f.completed.open), false);
  assert.equal(f.byId('copy-completed-tasks-text').ownerDocument.activeElement, f.byId('copy-completed-tasks-text'));
  assert.equal(walk(f.root).filter(node => node.id === 'copy-completed-tasks').length, 1);
});

test('personal and group task headers follow the selected member and sandbox mode', async t => {
  const f = fixture(t);
  const rows = [{ category: 'Skills', label: 'Fish shrimp' }];
  f.select(f.members[1]);
  f.view.tasks(rows, rows);
  assert.match(await f.copy('copy-active-tasks'), /^Donald — Active tasks \(1\)/u);
  f.context.sandbox.active = true;
  const duoRows = [{ task: rows[0], label: 'Both', facts: { completedBy: [f.members[1].id] } }];
  f.view.tasks(rows, duoRows, true);
  assert.match(await f.copy('copy-active-tasks'), /^Player & Donald — Sandbox active tasks \(1\)/u);
  assert.match(await f.copy('copy-completed-tasks'), /^Player & Donald — Completed tasks \(1\)/u);
  assert.match(await f.copy('copy-completed-tasks'), /Fish shrimp · Both · Done by Donald/u);
  f.view.tasks(rows, duoRows, true, f.members[1].id);
  assert.match(await f.copy('copy-completed-tasks'), /^Donald — Completed tasks \(1\)/u);
  f.view.tasks(rows, duoRows, true, 'both');
  assert.match(await f.copy('copy-completed-tasks'), /^Player & Donald — Shared completed tasks \(1\)/u);
});

test('map owner switches refresh unlocked and eligible pool lists with chunk names and ids', async t => {
  const f = fixture(t);
  f.view.map(f.members[0], { eligible: [{ id: '2' }], excluded: [{ id: '1' }], all: [{ id: '1' }, { id: '2' }] });
  assert.match(await f.copy('copy-unlocked-chunks'), /^Player — Unlocked chunks \(1\) — .*\n- Lumbridge \(1\)$/u);
  assert.match(await f.copy('copy-pool-chunks'), /^Player — Roll pool chunks \(1\) — .*\n- Draynor \(2\)$/u);
  f.members[0].selected = ['2'];
  f.view.map(f.members[0], { eligible: [{ id: '2' }] });
  assert.match(await f.copy('copy-pool-chunks'), /Draynor \(2\) \(added by hand\)$/u);
  f.context.sandbox.active = true;
  f.view.map(f.members[1], { eligible: [{ id: '3' }, { id: '1' }], excluded: [{ id: '2' }] });
  assert.equal(f.byId('copy-unlocked-chunks-text').parentElement.hidden, true);
  assert.equal(f.byId('copy-pool-chunks-text').parentElement.hidden, true);
  assert.match(await f.copy('copy-unlocked-chunks'), /^Donald — Sandbox unlocked chunks \(2\) — .*\n- Draynor \(2\)\n- 3$/u);
  assert.match(await f.copy('copy-pool-chunks'), /^Donald — Sandbox roll pool chunks \(2\) — .*\n- 3\n- Lumbridge \(1\)$/u);
  const unlockedFallback = f.byId('copy-unlocked-chunks-text').parentElement;
  const poolFallback = f.byId('copy-pool-chunks-text').parentElement;
  assert.deepEqual(f.mapPanel.children, [f.counts, unlockedFallback, poolFallback]);
  assert.equal(f.byId('copy-unlocked-chunks').parentElement.parentElement, f.counts.children[0]);
  assert.equal(f.byId('copy-pool-chunks').parentElement.parentElement, f.counts.children[2]);
});
