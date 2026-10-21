import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createTaskFilters, appendTaskPin } from '../app/web/task-filters.mjs';
import { TASK_FILTERS_STORAGE_KEY } from '../app/web/task-filters-model.mjs';
import { TASK_VIEW_STORAGE_KEY, readTaskViewPreferences, writeTaskViewPreferences, bindTaskViewPreferences } from '../app/web/task-view-preferences.mjs';
import { bindHideCompletedPreference } from '../app/web/screen-controls.mjs';

// Browser controller only: fake DOM and in-memory storage, no server or saves.
class Node {
  constructor(tag, text = '') {
    Object.assign(this, { tagName: tag.toUpperCase(), _text: text, childNodes: [], attributes: {}, events: {}, dataset: {}, className: '', hidden: false });
  }
  get children() { return this.childNodes.filter(node => node.tagName !== '#TEXT'); }
  get textContent() { return this._text + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parent) node.parent.childNodes = node.parent.childNodes.filter(child => child !== node);
      node.parent = this; this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) { for (const node of this.childNodes) node.parent = undefined; this.childNodes = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(key, action) { (this.events[key] ??= []).push(action); }
  emit(key, event = {}) { for (const action of this.events[key] ?? []) action({ target: this, ...event }); }
  focus() { document.activeElement = this; }
}
const document = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text) };
const walk = node => [node, ...node.childNodes.flatMap(walk)];
const task = (id, category = 'Mining', extra = {}) => ({ id, label: id, category, status: 'available', blockers: [], ...extra });

test('Escape dismisses Skill first and then Filter & sort, restoring each trigger without writes', () => {
  const h = harness(); h.select([task('mine')]);
  const root = h.controller.element, toggle = h.byId('task-filters-toggle');
  const skills = h.nodes().find(node => node.tagName === 'DETAILS'), summary = skills.children[0];
  toggle.emit('click'); skills.open = true; document.activeElement = h.choice('Mining');
  let prevented = false, stopped = false;
  skills.emit('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(skills.open, false);
  assert.equal(document.activeElement, summary); assert.equal(toggle.attributes['aria-expanded'], 'true');
  prevented = stopped = false;
  root.emit('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true);
  assert.equal(toggle.attributes['aria-expanded'], 'false'); assert.equal(root.dataset.expanded, 'false');
  assert.equal(document.activeElement, toggle); assert.equal(h.writes.length, 0);
  root.emit('keydown', { key: 'Escape', preventDefault() { assert.fail('collapsed filters must allow outer Escape'); } });
});

test('secondary display choice keeps Clear visible even when every task matches', () => {
  const h = harness();
  assert.equal(h.select([task('mine')], { externalActive: true }).length, 1);
  assert.equal(h.byId('task-filters-clear').hidden, false);
  h.byId('task-filters-clear').emit('click'); assert.equal(h.searchClears(), 1);
  h.select([task('mine')]); assert.equal(h.byId('task-filters-clear').hidden, true);
});

test('personal Group modes explain fixed readiness and restore the ordinary switch', () => {
  const h = harness({ doable: true }), options = { state: { members: [{ id: 'actor1', name: 'Player' }] }, memberId: 'actor1' };
  h.controller.select([task('mine')], options, { group: true, doableFixed: true });
  const control = h.byId('task-doable');
  assert.equal(control.disabled, true); assert.equal(control.checked, true);
  assert.match(control.title, /already shows tasks Player can do now/);
  h.controller.select([task('mine')], options);
  assert.equal(control.disabled, false); assert.equal(control.title, ''); assert.equal(control.checked, true);
});

test('claim controls persist, show activity and hidden counts, and Clear resets both', () => {
  const h = harness({ hidePartnerClaims: true, onlyMyClaims: true });
  const snapshot = { members: [{ id: 'actor1' }, { id: 'reed' }], taskClaims: { mine: { memberId: 'actor1' }, theirs: { memberId: 'reed' } } };
  const rows = [task('mine'), task('theirs'), task('free')];
  assert.equal(h.byId('task-hide-partner-claims').parent.textContent, 'Hide tasks my partner is doing');
  assert.equal(h.byId('task-only-my-claims').parent.textContent, 'Only my claimed tasks');
  assert.equal(h.byId('task-hide-partner-claims').checked, true);
  assert.equal(h.byId('task-only-my-claims').checked, true);
  assert.deepEqual(h.controller.select(rows, { state: snapshot, memberId: 'actor1' }).map(row => row.id), ['mine']);
  assert.match(h.byId('task-filter-summary').textContent, /2 hidden by filters/);
  assert.equal(h.byId('task-filters-toggle').textContent, 'Filter & sort · on');
  h.change(h.byId('task-only-my-claims'), false);
  assert.equal(h.saved().onlyMyClaims, false); assert.equal(h.changes(), 1);
  h.byId('task-filters-clear').emit('click');
  assert.equal(h.byId('task-hide-partner-claims').checked, false); assert.equal(h.byId('task-only-my-claims').checked, false);
  assert.equal(h.saved().hidePartnerClaims, false); assert.equal(h.saved().onlyMyClaims, false);
  assert.equal(h.controller.select(rows, { state: snapshot, memberId: 'actor1' }).length, 3);
  assert.equal(h.byId('task-filters-clear').hidden, true);
});

function harness(initial = {}, options = {}) {
  const values = new Map([[TASK_FILTERS_STORAGE_KEY, JSON.stringify(initial)]]), writes = [];
  const storage = { getItem: key => values.get(key), setItem: (key, value) => { writes.push({ key, value }); values.set(key, value); } };
  let changes = 0, searchClears = 0;
  const controller = createTaskFilters({ document, getClaimMemberId: options.getClaimMemberId, getStorage: options.getStorage ?? (() => storage), onChange: () => changes++, clearSearch: () => searchClears++ });
  const nodes = () => walk(controller.element);
  const byId = id => { const node = nodes().find(value => value.id === id); assert.ok(node, `Missing ${id}`); return node; };
  const choice = category => { const node = nodes().find(value => value.dataset.taskSkill === category); assert.ok(node, `Missing skill ${category}`); return node; };
  const select = (rows, display = {}) => controller.select(rows, { memberId: 'actor1' }, display);
  const change = (node, value) => { if (node.type === 'checkbox') node.checked = value; else node.value = value; node.emit('change'); };
  return { controller, nodes, byId, choice, select, change, writes, saved: () => JSON.parse(values.get(TASK_FILTERS_STORAGE_KEY)), changes: () => changes, searchClears: () => searchClears };
}

test('persisted filters initialize controls and retain unavailable selected categories', () => {
  const initial = { skills: ['Mining', 'Absent skill'], doable: true, pinned: true, sort: 'name', folded: ['Mining'] }, h = harness(initial);
  h.select([task('mining'), task('quest', 'Quests')]);
  assert.equal(h.byId('task-doable').checked, true); assert.equal(h.byId('task-pinned').checked, true);
  assert.equal(h.byId('task-sort').value, 'name'); assert.equal(h.choice('Mining').checked, true); assert.equal(h.choice('Absent skill').checked, true);
  assert.equal(h.choice('Quests').checked, false); assert.deepEqual(h.controller.preferences(), { hidePartnerClaims: false, onlyMyClaims: false, ...initial });
  assert.ok(h.nodes().some(node => node.tagName === 'SUMMARY' && node.textContent === 'Skill (2)'));
  assert.equal(h.changes(), 0); assert.equal(h.writes.length, 0);
  h.select([task('quest', 'Quest'), task('achievement', 'Diary'), task('gear', 'BiS')]);
  assert.equal(h.choice('Quest').parent.textContent, 'Quests');
  assert.equal(h.choice('Diary').parent.textContent, 'Achievements');
  assert.equal(h.choice('BiS').parent.textContent, 'BiS');
});

test('multi-select skills update one notification and one stored preference per change', () => {
  const h = harness(), rows = [task('mine'), task('fish', 'Fishing'), task('quest', 'Quests')]; h.select(rows);
  const mining = h.choice('Mining');
  h.change(h.choice('Mining'), true); assert.equal(h.changes(), 1); assert.equal(h.writes.length, 1);
  h.select(rows); assert.equal(h.choice('Mining'), mining, 'Selecting a skill retains its focused checkbox'); h.change(h.choice('Fishing'), true); assert.equal(h.changes(), 2); assert.equal(h.writes.length, 2);
  assert.deepEqual(h.saved().skills, ['Mining', 'Fishing']); assert.deepEqual(h.select(rows).map(row => row.id), ['mine', 'fish']);
  h.change(h.choice('Mining'), false); assert.equal(h.changes(), 3); assert.equal(h.writes.length, 3);
  assert.deepEqual(h.saved().skills, ['Fishing']); assert.deepEqual(h.select(rows).map(row => row.id), ['fish']);
  assert.ok(h.writes.every(write => write.key === TASK_FILTERS_STORAGE_KEY));
});

test('doable, pinned and sort controls persist each change with one notification', () => {
  const h = harness();
  h.change(h.byId('task-doable'), true); assert.equal(h.changes(), 1); assert.equal(h.saved().doable, true);
  h.change(h.byId('task-pinned'), true); assert.equal(h.changes(), 2); assert.equal(h.saved().pinned, true);
  h.change(h.byId('task-sort'), 'level'); assert.equal(h.changes(), 3); assert.equal(h.saved().sort, 'level');
  assert.equal(h.writes.length, 3);
});

test('Clear resets skills, doable, pins, sort and search while preserving category folds', () => {
  const h = harness({ skills: ['Mining'], doable: true, pinned: true, sort: 'level', folded: ['Mining', 'BiS'] });
  h.select([task('mine')], { search: 'mine' }); h.byId('task-filters-clear').emit('click');
  const expected = { skills: [], doable: false, pinned: false, hidePartnerClaims: false, onlyMyClaims: false, sort: 'default', folded: ['Mining', 'BiS'] };
  assert.deepEqual(h.controller.preferences(), expected); assert.deepEqual(h.saved(), expected);
  assert.equal(h.byId('task-doable').checked, false); assert.equal(h.byId('task-pinned').checked, false); assert.equal(h.byId('task-sort').value, 'default');
  assert.equal(h.searchClears(), 1); assert.equal(h.changes(), 1); assert.equal(h.writes.length, 1);
  h.select([task('mine')]); assert.equal(h.choice('Mining').checked, false); assert.equal(h.byId('task-filters-clear').hidden, true);
});

test('folded category paints only on first unfold and remembers folds with accessible controls', () => {
  const h = harness({ folded: ['Mining'] }), heading = document.createElement('h2'), icon = document.createElement('span'), label = document.createTextNode('Mining'), body = document.createElement('div');
  heading.append(icon, label); let paints = 0;
  assert.equal(h.controller.category(heading, 'Mining', body, () => paints++), false);
  const button = heading.children[0];
  assert.strictEqual(button.childNodes[0], icon); assert.strictEqual(button.childNodes[1], label);
  assert.equal(button.getAttribute('aria-controls'), body.id); assert.ok(body.id); assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(body.hidden, true); assert.equal(paints, 0);
  button.emit('click'); assert.equal(paints, 1); assert.equal(body.hidden, false); assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.deepEqual(h.saved().folded, []);
  button.emit('click'); assert.equal(body.hidden, true); assert.deepEqual(h.saved().folded, ['Mining']);
  button.emit('click'); assert.equal(paints, 1); assert.equal(body.hidden, false); assert.deepEqual(h.saved().folded, []);
  assert.equal(h.changes(), 0); assert.equal(h.writes.length, 3);
  const next = document.createElement('div'), nextHeading = document.createElement('h2');
  assert.equal(h.controller.category(nextHeading, 'Mining', next, () => paints++), true);
  assert.notEqual(next.id, body.id);
});

test('initially open category retains already painted body across fold toggles', () => {
  const h = harness(), heading = document.createElement('h2'), body = document.createElement('div'); let lazyPaints = 0;
  assert.equal(h.controller.category(heading, 'Mining', body, () => lazyPaints++), true);
  const button = heading.children[0]; button.emit('click'); button.emit('click');
  assert.equal(lazyPaints, 0); assert.equal(body.hidden, false); assert.equal(button.getAttribute('aria-expanded'), 'true');
});

test('bulk folding follows shown groups, single folds update its label, and empty views hide it', () => {
  const h = harness({ folded: ['Absent', 'Mining'] }), bulk = h.byId('task-category-fold-all');
  assert.equal(bulk.hidden, true);
  h.select([task('mine'), task('fish', 'Fishing')]);
  assert.equal(bulk.textContent, 'Collapse all');
  const headings = [], bodies = [];
  for (const category of ['Mining', 'Fishing']) {
    const heading = document.createElement('h3'), body = document.createElement('div');
    h.controller.category(heading, category, body, () => {}); headings.push(heading); bodies.push(body);
  }
  assert.equal(bulk.type, 'button');
  assert.equal(bulk.getAttribute('aria-controls'), bodies.map(body => body.id).join(' '));
  headings[1].children[0].emit('click'); assert.equal(bulk.textContent, 'Expand all');
  headings[0].children[0].emit('click'); assert.equal(bulk.textContent, 'Collapse all');
  bulk.emit('click'); assert.equal(bulk.textContent, 'Expand all');
  assert.deepEqual(h.saved().folded, ['Absent', 'Fishing', 'Mining']);
  assert.equal(h.changes(), 1); assert.equal(h.writes.length, 3);
  const reopened = harness(h.saved()); reopened.select([task('mine')]);
  assert.equal(reopened.byId('task-category-fold-all').textContent, 'Expand all');
  reopened.byId('task-category-fold-all').emit('click');
  assert.deepEqual(reopened.saved().folded, ['Absent', 'Fishing'], 'unshown folds survive expansion');
  assert.equal(reopened.byId('task-category-fold-all').getAttribute('aria-label'), 'Collapse all skill groups');
  h.select([], { search: 'no match' });
  assert.equal(bulk.hidden, true); assert.equal(bulk.getAttribute('aria-controls'), '');
  bulk.emit('click'); assert.equal(h.writes.length, 3);
});

for (const group of [false, true]) test(`bulk folds reuse lazy painting in the ${group ? 'duo' : 'solo'} list renderer`, async () => {
  const h = harness({ folded: ['Fishing'] }), target = document.createElement('div');
  const controls = new Map(['hide-completed', 'show-blocked', 'show-all', 'task-count'].map(id => [id, new Node('input')]));
  const tasks = [task('mine'), ...Array.from({ length: 75 }, (_, i) => task(`fish${i}`, 'Fishing'))];
  const entries = tasks.map(task => ({ task, memberIds: ['actor1', 'reed'] }));
  const results = ['actor1', 'reed'].map(memberId => ({ memberId, stateRevision: 1, tasks }));
  let painted = 0;
  const c = { el: (tag, text, cls) => { const node = new Node(tag, text); node.className = cls ?? ''; return node; },
    button: (text, action, cls) => { const node = new Node('button', text); node.className = cls ?? ''; node.addEventListener('click', action); return node; },
    $: id => controls.get(id), taskRenderGeneration: 1, activeTaskFilters: () => h.controller,
    state: { revision: 1, members: [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }] }, memberId: 'actor1', sandbox: { signature: () => '' },
  };
  const source = (await readFile(new URL('../app/web/screen-tasks.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  runInContext(source + '\ncreateScreenTasks(c);', createContext({ c, document, createTaskClaimClock: () => ({}), createTaskIconPainter: () => ({ append() {} }),
    selectDuoTasks: () => ({ rows: entries, counts: { union: entries.length } }),
  }));
  const row = value => { painted++; return new Node('div', (value.task ?? value).id); };
  c.taskFiltersView = h.controller;
  c.taskRow = row; c.duoView = () => ({ row, filter: () => 'all', personalFilter: () => 'group', selectionNeedsInspection: () => false });
  c.duoResults = () => ({ results: () => new Map(results.map(value => [value.memberId, value])) });
  const render = async () => {
    const jobs = []; ++c.taskRenderGeneration;
    if (group) c.renderDuoTasks(target, jobs, c.taskRenderGeneration, '');
    else { h.select(tasks); c.grouped(target, tasks, jobs, c.taskRenderGeneration, true); }
    await c.paintTaskJobs(jobs, c.taskRenderGeneration);
  };
  await render(); assert.equal(painted, 1);
  const bulk = h.byId('task-category-fold-all'); bulk.emit('click'); await render();
  assert.equal(bulk.textContent, 'Expand all'); assert.equal(painted, 1);
  assert.ok(walk(target).filter(node => node.className === 'task-category-body').every(node => node.hidden));
  bulk.emit('click'); await render();
  assert.equal(bulk.textContent, 'Collapse all'); assert.equal(painted, 72, 'only the first 70 rows per group are painted');
  assert.ok(walk(target).some(node => node.textContent === 'Show more Fishing tasks (5)'));
  const bodies = walk(target).filter(node => node.className === 'task-category-body');
  assert.ok(bodies.every(node => !node.hidden));
  assert.equal(bulk.getAttribute('aria-controls'), bodies.map(body => body.id).join(' '));
});

test('phone Filter toggle changes expansion without applying filters or saving preferences', () => {
  const h = harness(), toggle = h.byId('task-filters-toggle'), panel = h.byId('task-filters-panel');
  assert.equal(toggle.getAttribute('aria-controls'), panel.id); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.emit('click'); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(h.controller.element.dataset.expanded, 'true');
  toggle.emit('click'); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(h.controller.element.dataset.expanded, 'false');
  assert.equal(h.changes(), 0); assert.equal(h.writes.length, 0);
});

test('blocked storage getter still allows changing and clearing browser controls', () => {
  let reads = 0; const h = harness({}, { getStorage: () => { reads++; throw new Error('Storage blocked'); } });
  assert.equal(reads, 1); h.select([task('mine')]); h.change(h.choice('Mining'), true); h.change(h.byId('task-doable'), true);
  assert.deepEqual(h.controller.preferences().skills, ['Mining']); assert.equal(h.controller.preferences().doable, true);
  h.byId('task-filters-clear').emit('click'); assert.deepEqual(h.controller.preferences().skills, []); assert.equal(h.changes(), 3); assert.equal(h.searchClears(), 1);
});

test('summary includes owner-hidden rows and Clear remains available for empty selections', () => {
  const h = harness({ skills: ['Unavailable'] }), rows = [task('mine'), task('fish', 'Fishing')];
  assert.deepEqual(h.select(rows, { ownerHidden: 3 }), []);
  assert.match(h.byId('task-filter-summary').textContent, /5 hidden by filters/); assert.equal(h.byId('task-filter-summary').getAttribute('role'), 'status');
  assert.equal(h.byId('task-filters-clear').hidden, false); assert.equal(h.choice('Unavailable').checked, true);
  h.byId('task-filters-clear').emit('click'); assert.equal(h.select(rows).length, 2);
  assert.match(h.byId('task-filter-summary').textContent, /0 hidden by filters/); assert.equal(h.byId('task-filters-clear').hidden, true);
  h.select([], { search: 'no results' }); assert.equal(h.byId('task-filters-clear').hidden, false);
  assert.deepEqual(h.select(rows, { search: 'mine' }).map(row => row.id), ['mine']);
  assert.match(h.byId('task-filter-summary').textContent, /1 hidden by filters/);
});

test('pin marker exposes a Pinned label and hides its decorative icon from assistive technology', () => {
  const content = document.createElement('div'); appendTaskPin(document, content, false); assert.equal(content.childNodes.length, 0);
  appendTaskPin(document, content, true); assert.equal(content.children.length, 1);
  const star = content.children[0]; assert.equal(star.className, 'task-pin-star'); assert.equal(star.getAttribute('role'), 'img'); assert.equal(star.getAttribute('aria-label'), 'Pinned');
  assert.equal(star.children[0].className, 'task-pin-icon'); assert.equal(star.children[0].getAttribute('aria-hidden'), 'true');
});


test('claim filter controller reads the current session identity independently of the viewed map', () => {
  let sessionMember = 'reed';
  const h = harness({onlyMyClaims:true}, {getClaimMemberId:()=>sessionMember});
  const snapshot = {members:[{id:'actor1'},{id:'reed'}], taskClaims:{actor1Claim:{memberId:'actor1'},reedClaim:{memberId:'reed'}}};
  const rows = [task('actor1Claim'),task('reedClaim'),task('free')];
  const options = {state:snapshot,memberId:'actor1'};
  assert.deepEqual(h.controller.select(rows,options).map(row=>row.id), ['reedClaim']);
  h.change(h.byId('task-only-my-claims'),false);
  h.change(h.byId('task-hide-partner-claims'),true);
  assert.deepEqual(h.controller.select(rows,options).map(row=>row.id), ['reedClaim','free']);
  sessionMember = 'actor1';
  assert.deepEqual(h.controller.select(rows,options).map(row=>row.id), ['actor1Claim','free']);
});

test('task view stores the local filters and Group view under a stable key', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(readTaskViewPreferences(storage), { showBlocked: false, showAll: false, groupView: true });
  assert.equal(writeTaskViewPreferences(storage, { showBlocked: true, showAll: true, groupView: false, hideChecked: false }), true);
  assert.deepEqual(readTaskViewPreferences(storage), { showBlocked: true, showAll: true, groupView: false });
  assert.deepEqual(JSON.parse(values.get(TASK_VIEW_STORAGE_KEY)), { showBlocked: true, showAll: true, groupView: false });
  assert.doesNotMatch(TASK_VIEW_STORAGE_KEY, /:v\d|\d+\.\d+/);
});

test('missing, malformed and denied storage use both filters off', () => {
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  for (const storage of [undefined, denied, { getItem: () => '{' }, { getItem: () => '{"showBlocked":1,"showAll":"true"}' }]) {
    assert.deepEqual(readTaskViewPreferences(storage), { showBlocked: false, showAll: false, groupView: true });
  }
  assert.equal(writeTaskViewPreferences(denied, {}), false);
  assert.equal(writeTaskViewPreferences(undefined, {}), false);
});

test('binding resets restored controls, writes changes, and leaves Hide completed alone', () => {
  const nodes = new Map(['hide-completed', 'show-blocked', 'show-all', 'group-view'].map(id => [id, { checked: true, addEventListener(_, fn) { this.change = fn; } }]));
  let saved;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  bindTaskViewPreferences(id => nodes.get(id), () => storage);
  assert.equal(nodes.get('show-blocked').checked, false);
  assert.equal(nodes.get('show-all').checked, false);
  assert.equal(nodes.get('hide-completed').checked, true);
  nodes.get('group-view').checked = false; nodes.get('group-view').change();
  nodes.get('show-blocked').checked = true; nodes.get('show-blocked').change();
  bindTaskViewPreferences(id => nodes.get(id), () => storage);
  assert.equal(nodes.get('show-blocked').checked, true);
  assert.equal(nodes.get('group-view').checked, false);
  bindTaskViewPreferences(id => nodes.get(id), () => { throw Error('denied'); });
  assert.equal(nodes.get('show-blocked').checked, false);
});

test('uifix: Hide completed saves hideChecked for its owner and rolls back a refused preference', async () => {
  let change, failure=false, renders=0; const sent=[], owner={preferences:{hideChecked:true}};
  const control={checked:false,addEventListener(_event,action){change=action;}};
  const c={$:()=>control,memberId:'one',canWrite:()=>true,sandbox:{active:false},showError(){},
    command:async payload=>{sent.push(payload);if(failure)throw Error('Refused');owner.preferences.hideChecked=payload.value;},
    applyPreferences(){control.checked=owner.preferences.hideChecked;},renderTasks(){renders++;}};
  bindHideCompletedPreference(c); await change();
  assert.deepEqual(sent,[{type:'set-preference',memberId:'one',preferenceId:'hideChecked',value:false}]);
  assert.equal(owner.preferences.hideChecked,false);
  control.checked=true; failure=true; await change(); assert.equal(control.checked,false); assert.equal(renders,1);
  c.canWrite=()=>false; await change(); assert.equal(sent.length,2,'Viewers retain a local filter without saving');
});

test('uifix: existing task-view records migrate without resetting the local filters', () => {
  const old=JSON.stringify({showBlocked:true,showAll:true});
  assert.deepEqual(readTaskViewPreferences({getItem:()=>old}),{showBlocked:true,showAll:true,groupView:true});
});

test('task controls disable browser form restoration', async () => {
  const shell = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
  for (const id of ['hide-completed', 'show-blocked', 'show-all', 'group-view']) {
    assert.match(shell, new RegExp(`<input[^>]*id="${id}"[^>]*autocomplete="off"`));
  }
});
