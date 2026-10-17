import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createAreaSelection, AREA_CHECK_CAP } from '../app/web/area-check-selection.mjs';

const source = (await readFile(new URL('../app/web/area-check.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

class Node {
  constructor(tag, text = '', className = '') {
    this.tagName = tag; this.textContent = text; this.className = className;
    this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.disabled = false;
    this.classes = new Set();
    this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    this.properties = new Map(); this.style = { setProperty: (key, value) => this.properties.set(key, value) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  emit(type, event = {}) { for (const callback of this.listeners.get(type) ?? []) callback({ target: this, ...event }); }
  click() { this.emit('click'); }
  focus() {} select() {}
}
const descendants = node => [node, ...node.children.filter(value => value instanceof Node).flatMap(descendants)];
const find = (node, predicate) => descendants(node).find(predicate);
const range = { cap: 99, gapTarget: null, lowest: null, highest: null, bootstrapGap: null, methodCount: 0, availableCount: 0,
  methods: [], entrySpans: [], trainingGaps: [], largestGap: null, repeatability: 'unknown' };

function fixture(t, { group = false, viewer = false } = {}) {
  const nodes = Object.fromEntries(['map-hint', 'map-hover', 'tool-dialog', 'group-view'].map(id => [id, new Node(id)]));
  nodes['group-view'].checked = group; nodes['tool-dialog'].open = false;
  const toolbar = new Node('toolbar'), requests = [], errors = [];
  const document = new Node('document'); document.querySelector = () => toolbar;
  const c = { state: { revision: 0, members: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] },
    memberId: 'one', dialogGeneration: 0, sandbox: { active: false }, canWrite: () => !viewer,
    $: id => nodes[id], el: (tag, text, cls) => new Node(tag, text, cls), plain: value => value,
    closeChunkMenu() {}, button(text, action, cls) {
      const node = new Node('button', text, cls); node.addEventListener('click', () => Promise.resolve().then(action).catch(error => errors.push(error))); return node;
    }, input: type => Object.assign(new Node('input'), { type }),
    select: (options, value) => Object.assign(new Node('select'), { options, value }),
    field: (label, control) => { const node = new Node('field', label); node.append(control); return node; },
    list: values => { const node = new Node('ul'); node.append(...values.map(value => new Node('li', value))); return node; },
    details: (title, ...content) => { const node = new Node('details', title); node.append(...content); return node; },
    closeDialog() {
      c.dialogGeneration++;
      if (nodes['tool-dialog'].open) { nodes['tool-dialog'].open = false; setImmediate(() => nodes['tool-dialog'].emit('close')); }
    },
    openDialog(title, panel) { c.dialogGeneration++; nodes['tool-dialog'].open = true; nodes['tool-dialog'].replaceChildren(panel); return c.dialogGeneration; },
    dialogCurrent: generation => generation === c.dialogGeneration && nodes['tool-dialog'].open,
    api(path, body, signal) { return new Promise(resolve => requests.push({ path, body, signal, resolve })); },
  };
  c.map = { model: {}, hoverCanvas: nodes['map-hover'], cells: new Map([['12341', { x: 0, y: 0 }]]),
    offset: { x: 0, y: 0 }, zoom: 1, width: 128, height: 128, endDrag() {}, setHover() {}, invalidate() {} };
  const factory = runInNewContext(source + '\n({ createScreenAreaCheck, renderAreaTable, areaTaskSummary, areaDiscordMessages });', {
    document, createAreaSelection, AREA_CHECK_CAP, AbortController, URLSearchParams,
    loadIcons: async () => {}, skillIcon: () => null,
  }); factory.createScreenAreaCheck(c);
  t.after(() => { c.closeDialog(); assert.deepEqual(errors, []); });
  const toggle = find(toolbar, node => node.id === 'area-check-toggle');
  const start = async () => { toggle.click(); await nextTurn(); };
  const select = async () => { await start(); c.map.pointerTool.corner({ x: 10, y: 10 }); c.map.pointerTool.corner({ x: 10, y: 10 }); await nextTurn(); };
  const output = () => find(nodes['tool-dialog'], node => node.className === 'area-check-output');
  const complete = async (index, skill = 'Mining', scopes = { alone: range, combined: range }, rows = [{ skill, ...scopes }], tasks) => {
    const request = requests[index], query = new URL(request.path, 'http://localhost').searchParams;
    request.resolve({ memberId: query.get('memberId'), stateRevision: Number(query.get('revision')), members: query.get('asMembers') === 'true',
      chunkIds: ['12341'], rows, tasks, limitations: ['Synthetic coverage'] }); await nextTurn();
  };
  return { c, nodes, requests, toggle, start, select, output, complete, render: result => factory.renderAreaTable(c, result),
    taskSummary: factory.areaTaskSummary, discord: factory.areaDiscordMessages };
}

test('queued dialog close preserves the newly started Select another area tool', async t => {
  const h = fixture(t); await h.select();
  find(h.nodes['tool-dialog'], node => node.textContent === 'Select another area').click(); await nextTurn(); await nextTurn();
  assert.equal(h.nodes['tool-dialog'].open, false); assert.equal(h.c.map.pointerTool.active, true);
  assert.equal(h.toggle.attributes.get('aria-pressed'), 'true'); assert.equal(h.requests[0].signal.aborted, true);
});

test('live revisions clear results and export immediately, abort old work and render only the latest revision', async t => {
  const h = fixture(t); await h.select(); await h.complete(0);
  assert.ok(find(h.output(), node => node.className === 'area-check-ladders')); assert.ok(find(h.output(), node => node.textContent === 'Copy for Discord'));
  h.c.state.revision = 1; h.c.areaCheck.refreshRevision();
  assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.output().children.length, 0);
  assert.equal(h.output().attributes.get('aria-busy'), 'true');
  h.c.state.revision = 2; h.c.areaCheck.refreshRevision(); assert.equal(h.requests[1].signal.aborted, true);
  await h.complete(1, 'Stale skill'); assert.equal(h.output().children.length, 0);
  await h.complete(2, 'Latest skill'); assert.ok(find(h.output(), node => node.textContent === 'Latest skill'));
  assert.ok(!find(h.output(), node => node.textContent === 'Stale skill'));
});

test('closed dialogs and superseded option requests cannot render late responses', async t => {
  const h = fixture(t); await h.select();
  const members = find(h.nodes['tool-dialog'], node => node.tagName === 'input'); members.checked = true; members.emit('change');
  assert.equal(h.requests[0].signal.aborted, true); await h.complete(0); assert.equal(h.output().children.length, 0);
  const output = h.output(); h.c.closeDialog(); await nextTurn(); assert.equal(h.requests[1].signal.aborted, true);
  await h.complete(1); assert.equal(output.children.length, 0);
  h.c.state.revision++; h.c.areaCheck.refreshRevision(); assert.equal(h.requests.length, 2);
});

test('view-only group users can change player and members assumptions through GET requests', async t => {
  const h = fixture(t, { group: true, viewer: true }); await h.select();
  const player = find(h.nodes['tool-dialog'], node => node.tagName === 'select');
  const members = find(h.nodes['tool-dialog'], node => node.tagName === 'input');
  assert.equal(player.disabled, false); assert.equal(members.disabled, false);
  player.value = 'two'; player.emit('change'); members.checked = true; members.emit('change');
  assert.equal(h.requests.length, 3); assert.ok(h.requests.every(request => request.body === undefined));
  const query = new URL(h.requests[2].path, 'http://localhost').searchParams;
  assert.equal(query.get('memberId'), 'two'); assert.equal(query.get('asMembers'), 'true');
  await h.complete(2); assert.ok(find(h.nodes['tool-dialog'], node => String(node.textContent).includes('Two · Assumes members content')));
});

const method = { id: 'tanning', label: 'Cowhide tanning', level: 5, status: 'available', blockers: [] };
const longGap = { fromLevel: 5, toLevel: 80, size: 75, kind: 'requirement', methods: [method],
  evidence: [{ id: 'local-quest', label: 'Local quest', level: 80 }] };
const trainingRange = { ...range, lowest: { level: 5, methods: [method] }, highest: { level: 5, methods: [method] },
  gapTarget: { level: 80, kind: 'requirement', requirements: longGap.evidence },
  methods: [method], methodCount: 1, availableCount: 1, trainingGaps: [longGap], largestGap: longGap };

test('ladders name the old method and endpoint, with bootstrap and requirement details in Methods', async t => {
  const h = fixture(t); await h.select();
  const alone = { ...trainingRange, bootstrapGap: { fromLevel: 1, toLevel: 5, size: 4, source: 'personal' } };
  await h.complete(0, 'Crafting', { alone, combined: { ...trainingRange, trainingGaps: [], largestGap: null } });
  const table = find(h.output(), node => node.className === 'area-check-ladders');
  const aloneCell = find(table, node => node.attributes.get('data-label') === 'Alone');
  assert.ok(find(aloneCell, node => node.textContent === '5 → 80 on Cowhide tanning'));
  assert.ok(find(aloneCell, node => node.textContent === '80 · Area requirement'));
  assert.ok(find(table, node => node.textContent === 'No long gap'));
  assert.ok(find(aloneCell, node => node.attributes.get('aria-label')?.includes("Can't start: 1 → 5 (recorded level)")));
  const details = find(table, node => node.className === 'area-check-details');
  assert.equal(details.children.length, 0, 'method details remain lazy');
  details.open = true; details.emit('toggle');
  assert.ok(find(details, node => node.textContent === "Can't start: 1 → 5 (recorded level)"));
  assert.ok(find(details, node => node.textContent === '80 · Local quest'));
  assert.ok(find(details, node => node.textContent.includes('Area requirement · Local quest')));
  const expandedCount = details.children.length; details.emit('toggle'); assert.equal(details.children.length, expandedCount);
  assert.ok(find(table, node => node.classes.has('area-check-large-gap')));
  assert.ok(find(h.output(), node => node.textContent === 'Biggest gaps in this area: Crafting 5 → 80'));
  const children = h.output().children;
  assert.ok(children.findIndex(node => node.className === 'area-check-note') > children.indexOf(table), 'explanation appears under the table');
});

test('a bootstrap-only warning does not appear in biggest gaps or shade a row', async t => {
  const h = fixture(t); await h.select();
  const alone = { ...range, bootstrapGap: { fromLevel: 5, toLevel: 77, size: 72, source: 'f2p-reference' } };
  await h.complete(0, 'Divination', { alone, combined: range });
  assert.ok(find(h.output(), node => node.attributes.get('aria-label')?.includes("Can't start: 5 → 77 (F2P reference level)")));
  assert.ok(!find(h.output(), node => node.className === 'area-check-biggest'));
  assert.ok(!find(h.output(), node => node.classes.has('area-check-large-gap')));
});

test('no requirement keeps the bar limit without a grind or cannot-start segment', async t => {
  const h = fixture(t); await h.select();
  const alone = { ...range, cap: 20, methods: [method], methodCount: 1, availableCount: 1 };
  await h.complete(0, 'Crafting', { alone, combined: range });
  assert.ok(find(h.output(), node => node.textContent === '20 · F2P cap'));
  assert.ok(find(h.output(), node => node.textContent === 'No task here needs this skill'));
  assert.ok(!find(h.output(), node => node.classes.has('area-check-large-gap')));
  assert.ok(!find(h.output(), node => ['area-check-grind', 'area-check-unstarted'].includes(node.className)));
  h.c.state.revision++; h.c.areaCheck.refreshRevision();
  const members = find(h.nodes['tool-dialog'], node => node.tagName === 'input'); members.checked = true; members.emit('change');
  await h.complete(2, 'Crafting', { alone, combined: range });
  assert.ok(find(h.output(), node => node.textContent === '20 · Members cap'));
  assert.ok(!find(h.output(), node => node.classes.has('area-check-large-gap')));
});

test('level bars position usable ticks, all model gap segments and the muted first stretch', t => {
  const h = fixture(t);
  const next = { ...method, id: 'next', label: 'Next method', level: 40 };
  const blocked = { ...method, id: 'blocked', label: 'Blocked method', level: 20, status: 'blocked', blockers: [{ detail: 'Quest needed' }] };
  const conditional = { ...method, id: 'conditional', level: 25, blockers: [{ detail: 'Supply needed' }] };
  const beyondTarget = { ...method, id: 'beyond', level: 90 };
  const gaps = [{ ...longGap, toLevel: 40, size: 35, kind: 'method', evidence: [next] },
    { ...longGap, fromLevel: 40, size: 40, methods: [next] }];
  const alone = { ...trainingRange, methods: [method, { ...method, id: 'same-level' }, next, blocked, conditional, beyondTarget],
    trainingGaps: gaps, largestGap: gaps[1], bootstrapGap: { fromLevel: 1, toLevel: 5, source: 'personal' } };
  const output = h.render({ members: false, rows: [{ skill: 'Crafting', alone, combined: range }] });
  const scope = find(output, node => node.attributes.get('data-label') === 'Alone');
  const bar = find(scope, node => node.className === 'area-check-bar');
  const ticks = descendants(bar).filter(node => node.className === 'area-check-tick');
  assert.deepEqual(ticks.map(node => node.attributes.get('data-level')), ['5', '40']);
  assert.equal(ticks[0].properties.get('--area-start'), `${4 / 79 * 100}%`);
  const segments = descendants(bar).filter(node => node.className === 'area-check-grind');
  assert.deepEqual(segments.map(node => [node.attributes.get('data-from-level'), node.attributes.get('data-to-level')]), [['5', '40'], ['40', '80']]);
  assert.equal(segments[1].properties.get('--area-width'), `${100 - 100 * 39 / 79}%`);
  const start = find(bar, node => node.className === 'area-check-unstarted');
  assert.equal(start.attributes.get('data-from-level'), '1'); assert.equal(start.attributes.get('data-to-level'), '5');
  assert.equal(start.properties.get('--area-start'), '0%');
  assert.equal(bar.attributes.get('data-endpoint-kind'), 'requirement'); assert.equal(bar.attributes.get('data-target-level'), '80');
  assert.ok(bar.children.every(node => node.attributes.get('aria-hidden') === 'true'));
  assert.ok(descendants(bar).every(node => !node.attributes.has('style')), 'positions use CSSOM properties rather than style attribute injection');
  const text = bar.attributes.get('aria-label');
  assert.match(text, /Levels 1 to 80\. Endpoint: Area requirement/);
  assert.match(text, /Usable method entry levels: 5, 40/);
  assert.match(text, /Can't start: 1 → 5 \(recorded level\)/);
  assert.match(text, /Long gap: 5 → 40 on Cowhide tanning/);
  const line = find(scope, node => node.className === 'area-check-gap');
  assert.equal(line.textContent, '40 → 80 on Next method'); assert.ok(text.includes(line.textContent));
  assert.equal(descendants(scope).filter(node => node.tagName === 'p').length, 1, 'only the biggest gap is printed below each bar');
});

test('empty and wholly blocked bars are dashed, named unknown coverage and have cap endpoints', t => {
  const h = fixture(t);
  const alone = { ...range, methods: [{ ...method, status: 'blocked' }], methodCount: 1 };
  const output = h.render({ members: true, rows: [{ skill: 'Crafting', alone, combined: range }] });
  const bars = descendants(output).filter(node => node.className === 'area-check-bar');
  assert.equal(bars.length, 2);
  for (const bar of bars) {
    assert.ok(bar.classes.has('area-check-empty')); assert.equal(bar.children.length, 0);
    assert.equal(bar.attributes.get('data-endpoint-kind'), 'limit');
    assert.match(bar.attributes.get('aria-label'), /No task here needs this skill/);
    assert.match(bar.attributes.get('aria-label'), /Coverage is unknown/);
    assert.match(bar.attributes.get('aria-label'), /Members cap/);
  }
  const without = find(output, node => node.className === 'area-check-without-gaps');
  assert.equal(without.open, true, 'show the remaining skills when there are no long gaps');
});

test('a level-one cap remains finite and a level-one method needs no cannot-start segment', t => {
  const h = fixture(t), starter = { ...method, level: 1 };
  const alone = { ...range, cap: 1, methods: [starter], availableCount: 1 };
  const output = h.render({ members: false, rows: [{ skill: 'Invention', alone, combined: range }] });
  const scope = find(output, node => node.attributes.get('data-label') === 'Alone');
  assert.equal(find(scope, node => node.className === 'area-check-tick').properties.get('--area-start'), '0%');
  assert.ok(!find(scope, node => node.className === 'area-check-unstarted'));
  assert.ok(find(scope, node => node.textContent === '1 · F2P cap'));
});

test('largest gaps across either scope sort first and no-gap skills stay in a native disclosure', async t => {
  const h = fixture(t); await h.select();
  const rows = [
    { skill: 'No gap', alone: range, combined: range },
    { skill: 'Smaller alone', alone: { ...trainingRange, largestGap: { ...longGap, size: 15 } }, combined: range },
    { skill: 'Largest combined', alone: range, combined: trainingRange },
    { skill: 'Also no gap', alone: range, combined: range },
  ];
  const before = JSON.stringify(rows);
  await h.complete(0, undefined, undefined, rows);
  const output = find(h.output(), node => node.className === 'area-check-ladders');
  assert.deepEqual(descendants(output).filter(node => node.className === 'area-check-row').map(node => node.attributes.get('aria-label')),
    ['Largest combined', 'Smaller alone', 'Also no gap', 'No gap']);
  const without = find(output, node => node.className === 'area-check-without-gaps');
  assert.equal(without.tagName, 'details'); assert.equal(without.open, false); assert.equal(without.textContent, 'Show skills without gaps (2)');
  assert.equal(JSON.stringify(rows), before, 'rendering does not reorder the model result');
});

test('multiple methods use plain words in both visible and screen-reader gap text', t => {
  const h = fixture(t), gap = { ...longGap, methods: [method, { ...method, label: 'Second method' }, { ...method, label: 'Third method' }] };
  const alone = { ...trainingRange, largestGap: gap, trainingGaps: [gap] };
  const output = h.render({ members: false, rows: [{ skill: 'Crafting', alone, combined: range }] });
  assert.ok(find(output, node => node.textContent === '5 → 80 on Cowhide tanning and 2 more'));
  assert.ok(find(output, node => node.attributes.get('aria-label')?.includes('5 → 80 on Cowhide tanning and 2 more')));
  assert.ok(!find(output, node => String(node.textContent).includes('+2')));
});

const taskScope = categories => ({ total: categories.reduce((sum, category) => sum + category.count, 0), categories });
const taskCategory = (category, labels) => ({ category, count: labels.length,
  tasks: labels.map((label, index) => ({ id: `${category}-${index}`, label, level: 1 })) });

test('task summaries count quests, achievements and other categories with useful empty and singular text', t => {
  const h = fixture(t);
  assert.equal(h.taskSummary(taskScope([
    taskCategory('Quest', ['One quest']), taskCategory('Diary', ['First', 'Second']),
    taskCategory('Extra', ['Extra']), taskCategory('BiS', ['Gear']), taskCategory('Slayer', ['Monster']),
  ])), 'Opens 1 quest, 2 achievements, 3 other tasks');
  assert.equal(h.taskSummary(taskScope([taskCategory('Diary', ['One'])])), 'Opens 1 achievement');
  assert.equal(h.taskSummary(taskScope([taskCategory('Nonskill', ['One'])])), 'Opens 1 other task');
  assert.equal(h.taskSummary(taskScope([])), 'No new tasks');
});

test('Tasks shows both scopes with lazy plain category lists and its prediction limitation', async t => {
  const h = fixture(t); await h.select();
  assert.match(h.toggle.title, /tasks and training/);
  assert.ok(find(h.nodes['tool-dialog'], node => String(node.textContent).startsWith('Checking tasks and training')));
  const tasks = {
    alone: taskScope([taskCategory('Quest', ['Alone quest <img src=x>']), taskCategory('Diary', ['Alone achievement']),
      taskCategory('Extra', ['Extra action']), taskCategory('Nonskill', ['Nonskill action']), taskCategory('BiS', ['Gear action']),
      taskCategory('Slayer', ['Slayer action'])]),
    combined: taskScope([taskCategory('Quest', ['Combined quest'])]),
  };
  const before = JSON.stringify(tasks);
  await h.complete(0, undefined, undefined, undefined, tasks);
  const section = find(h.output(), node => node.className === 'area-check-tasks');
  assert.ok(find(section, node => node.textContent === 'Compared with your current task list.'));
  assert.ok(find(section, node => node.textContent === 'Task predictions follow the current engine, rules and saved progress; blocked near-misses are not shown.'));
  const alone = find(section, node => node.attributes.get('aria-label') === 'Alone');
  const combined = find(section, node => node.attributes.get('aria-label') === 'With current chunks');
  assert.ok(find(alone, node => node.textContent === 'Opens 1 quest, 1 achievement, 4 other tasks'));
  assert.ok(find(combined, node => node.textContent === 'Opens 1 quest'));
  const details = descendants(alone).filter(node => node.tagName === 'details');
  assert.deepEqual(details.map(node => node.textContent), ['Quests (1)', 'Achievements (1)', 'Extra (1)', 'Nonskill (1)', 'BiS (1)', 'Slayer (1)']);
  assert.ok(details.every(node => node.children.length === 0 && !node.open));
  for (const node of details) { node.open = true; node.emit('toggle'); }
  assert.ok(find(alone, node => node.tagName === 'li' && node.textContent === 'Alone quest <img src=x>'));
  assert.ok(!find(alone, node => ['button', 'a', 'input', 'img'].includes(node.tagName)), 'task labels remain text without actions or markup');
  assert.ok(!find(combined, node => node.tagName === 'li'), 'the other scope remains folded and lazy');
  const combinedDetails = find(combined, node => node.tagName === 'details'); combinedDetails.open = true; combinedDetails.emit('toggle');
  assert.ok(find(combined, node => node.textContent === 'Combined quest'));
  const count = details[0].children.length; details[0].emit('toggle'); assert.equal(details[0].children.length, count);
  assert.equal(JSON.stringify(tasks), before);
});

test('Discord copy includes concise task summaries for both scopes and retains training text', async t => {
  const h = fixture(t); await h.select();
  const tasks = { alone: taskScope([]), combined: taskScope([taskCategory('Quest', ['Quest']), taskCategory('Extra', ['Extra'])]) };
  await h.complete(0, undefined, undefined, undefined, tasks);
  const copy = find(h.output(), node => node.tagName === 'textarea').value;
  assert.match(copy, /Tasks · Alone: No new tasks\./);
  assert.match(copy, /Tasks · With current chunks: Opens 1 quest, 1 other task\./);
  assert.match(copy, /Mining: alone/);
  const messages = h.discord({ chunkIds: ['12341'], members: false, tasks, rows: [] }, 'One', 220);
  assert.ok(messages.length > 1);
  assert.ok(messages.every(message => message.length <= 220));
  assert.equal(messages.filter(message => message.includes('Tasks · Alone:')).length, 1);
  assert.equal(messages.filter(message => message.includes('Tasks · With current chunks:')).length, 1);
});
