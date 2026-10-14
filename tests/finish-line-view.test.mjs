import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFinishLine, createFinishLineView } from '../app/web/finish-line-view.mjs';
import { createFinishLineCopy, formatFinishLineSummary } from '../app/web/finish-line-copy.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, children: [], attributes: {}, listeners: {}, dataset: {}, value: '',
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener(name, action) { this.listeners[name] = action; },
    focus() { this.focused = true; }, select() { this.selected = true; } };
}
const all = root => [root, ...root.children.flatMap(all)];
const c = { el: node, button: (text, action, cls) => ({ ...node('button', text, cls), action }), showError() {} };
const players = [{ memberId: 'actor1', name: 'Player', done: false }, { memberId: 'reed', name: 'Reed', done: true }];
const model = () => ({ members: [{ id: 'actor1', name: 'Player', percent: 90, done: 1, total: 2 }, { id: 'reed', name: 'Reed', percent: 100, done: 2, total: 2 }],
  duo: { percent: 90, done: 1, total: 2 }, groups: [{ id: 'skills', label: 'Skills', done: 0, total: 1, items: [
    { id: 'skill:Attack', label: 'Attack', kind: 'skill', enabled: true, target: 50, players, duo: { done: false }, status: 'Player 45/50 · Reed 50/50', reason: 'Gear target.' } ] },
    { id: 'custom', label: 'Custom goals', done: 0, total: 1, items: [{ id: 'finish:goal', label: 'Celebrate', kind: 'custom', enabled: true, players, duo: { done: false }, status: 'Player To do · Reed Done' }] }] });

test('viewer sees per-player and duo progress, groups and Discord copy with no write controls', () => {
  const nodes = all(renderFinishLine(c, model()));
  assert.ok(nodes.some(row => row.textContent === 'Player 90%'));
  assert.ok(nodes.some(row => row.textContent === 'Duo 90%'));
  assert.ok(nodes.some(row => row.textContent === 'Player 45/50 · Reed 50/50'));
  assert.equal(nodes.filter(row => row.tag === 'progress').length, 3);
  assert.ok(nodes.every(row => !['input', 'form', 'button'].includes(row.tag)));
  assert.ok(nodes.every(row => !Object.keys(row.attributes).some(name => /^(?:style|on)/.test(name))));
});

test('editing emits exact include/target/custom commands and only exposes own manual ticks', async () => {
  const commands = [], nodes = all(renderFinishLine(c, model(), { edit: true, canTick: id => id === 'actor1',
    save: async (control, payload) => commands.push(payload), addCustom: async (control, text) => commands.push({ text }) }));
  const include = nodes.find(row => row.attributes['aria-label'] === 'Include Attack'); include.checked = false; await include.listeners.change();
  const target = nodes.find(row => row.type === 'number'); target.value = '55'; await target.listeners.change();
  const tick = nodes.find(row => row.attributes['aria-label'] === 'Player: Celebrate done'); tick.checked = true; await tick.listeners.change();
  assert.deepEqual(commands, [{ type: 'set-finish-line-item', itemId: 'skill:Attack', enabled: false },
    { type: 'set-finish-line-item', itemId: 'skill:Attack', target: 55 },
    { type: 'set-finish-line-custom', itemId: 'finish:goal', memberId: 'actor1', completed: true }]);
  assert.ok(!nodes.some(row => row.attributes['aria-label'] === 'Reed: Celebrate done'));
  const text = nodes.find(row => row.type === 'text'); text.value = '  Our next goal  ';
  await nodes.find(row => row.textContent === 'Add goal').action(); assert.deepEqual(commands.at(-1), { text: 'Our next goal' });
});

test('invalid levels never save; disabled items keep their status and chosen target visible', async () => {
  let saves = 0, errors = 0; const m = model(); m.groups[0].items[0].enabled = false;
  const nodes = all(renderFinishLine({ ...c, showError: () => errors++ }, m, { edit: true, save: () => saves++ }));
  assert.ok(nodes.some(row => row.textContent === 'Off · Player 45/50 · Reed 50/50'));
  const target = nodes.find(row => row.type === 'number'); target.value = '3.5'; await target.listeners.change();
  assert.equal(target.value, 50); assert.equal(errors, 1); assert.equal(saves, 0);
});

test('Discord copy is bounded, escapes user text, and offers selected read-only fallback', async () => {
  const m = model(); m.groups[1].items[0].label = '@everyone **celebrate**';
  m.groups[1].items.push(...Array.from({ length: 100 }, (_, i) => ({ ...m.groups[1].items[0], label: `Long custom goal ${i}` })));
  const text = formatFinishLineSummary(m); assert.ok(text.length <= 2000); assert.ok(!text.includes('@everyone')); assert.ok(text.includes('@\u200beveryone'));
  const nodes = all(createFinishLineCopy(c, m, () => null)); await nodes.find(row => row.textContent === 'Copy for Discord').action();
  const textarea = nodes.find(row => row.tag === 'textarea'); assert.equal(textarea.readOnly, true); assert.equal(textarea.selected, true); assert.equal(textarea.value, text);
});

function harness() {
  let generation = 0, content; const menu = node('button');
  const state = { revision: 1, rules: {}, tasks: [], members: [ { id: 'actor1', name: 'Player', unlocked: [], completedTasks: [], taskStatus: {} }, { id: 'reed', name: 'Reed', unlocked: [], completedTasks: [], taskStatus: {} } ] };
  const h = { ...c, state, memberId: 'actor1', definitions: {}, sandbox: { active: false }, sessionMember: 'actor1',
    canWrite: () => true, $: () => menu, browserUUID: () => 'safe-id',
    ensureFullDefinitions: async () => {}, ensureDuoDetails: async memberId => ({ memberId, stateRevision: state.revision, tasks: [], currentBiS: { owned: { recordedObtained: [] } } }),
    command: async payload => { h.calls.push(payload); state.revision++; }, calls: [],
    openDialog: (title, root) => { content = root; return ++generation; }, dialogCurrent: value => value === generation };
  const view = createFinishLineView(h);
  return { h, view, close: () => generation++, get nodes() { return all(content); } };
}

test('view-only invitations can open the list without editing controls', async () => {
  const f = harness(); f.h.canWrite = () => false; await f.view.open();
  assert.ok(f.nodes.some(row => row.textContent === 'Copy for Discord'));
  assert.ok(f.nodes.some(row => row.textContent === 'View only'));
  assert.ok(!f.nodes.some(row => row.textContent === 'Edit draft'));
  assert.ok(f.nodes.every(row => row.tag !== 'input'));
});

test('viewer can read saved observations before full BiS is retained; Sandbox cannot edit', async () => {
  const f = harness(); f.h.canWrite = () => false;
  f.h.ensureDuoDetails = async () => { throw Object.assign(new Error('Not retained'), { code: 'TASK_RESULTS_UNAVAILABLE' }); };
  await f.view.open(); assert.ok(f.nodes.some(row => row.textContent === 'Duo 0%'));
  f.h.sandbox.active = true; await f.view.open(); assert.ok(f.nodes.some(row => row.textContent === 'Exit Sandbox to view the saved finish line.'));
});

test('late replies cannot replace a closed dialog, and save errors offer refresh', async () => {
  const f = harness(); let resolve;
  f.h.ensureFullDefinitions = () => new Promise(yes => { resolve = yes; });
  const loading = f.view.open(); f.close(); resolve(); await loading;
  assert.ok(!f.nodes.some(row => row.textContent === 'Copy for Discord'));
  f.h.ensureFullDefinitions = async () => {}; f.h.ensureDuoDetails = async () => { throw new Error('private paths'); };
  await f.view.open(); assert.ok(f.nodes.some(row => row.textContent === 'Refresh finish line')); assert.ok(!f.nodes.some(row => row.textContent === 'private paths'));
});

test('repeated Enter cannot submit a second custom item while saving', async () => {
  let resolve, submissions = 0;
  const pending = new Promise(yes => { resolve = yes; });
  const nodes = all(renderFinishLine(c, model(), { edit: true, addCustom: () => { submissions++; return pending; } }));
  nodes.find(row => row.type === 'text').value = 'One shared goal';
  const add = nodes.find(row => row.textContent === 'Add goal'), first = add.action();
  nodes.find(row => row.tag === 'form').listeners.submit({ preventDefault() {} });
  assert.equal(submissions, 1); assert.equal(add.disabled, true); resolve(); await first;
});

test('manual tick controls match linked players and administrators including linked admins', async () => {
  for (const [sessionMember, sessionAdmin, names] of [['actor1', false, ['Player']], ['actor1', true, ['Player', 'Reed']], [null, false, []]]) {
    const f = harness(); Object.assign(f.h, { sessionMember, sessionAdmin });
    f.h.state.finishLine = { items: {}, customItems: [{ id: 'finish:goal', text: 'Our goal', completedBy: [] }] };
    await f.view.open(); await f.nodes.find(row => row.textContent === 'Edit draft').action();
    const labels = f.nodes.filter(row => row.type === 'checkbox' && row.attributes['aria-label']?.endsWith(': Our goal done')).map(row => row.attributes['aria-label'].split(':')[0]);
    assert.deepEqual(labels, names);
  }
});

test('save adoption and live refresh share one load and keep typed custom text', async () => {
  const f = harness(); let reads = 0;
  f.h.ensureDuoDetails = async memberId => { reads++; return { memberId, stateRevision: f.h.state.revision, tasks: [], currentBiS: { owned: { recordedObtained: [] } } }; };
  f.h.command = async payload => { f.h.state.revision++; f.view.refresh(); };
  await f.view.open(); await f.nodes.find(row => row.textContent === 'Edit draft').action(); reads = 0;
  const text = f.nodes.find(row => row.type === 'text'); text.value = 'Keep this draft'; text.listeners.input();
  const target = f.nodes.find(row => row.type === 'number'); target.value = 60; await target.listeners.change();
  assert.equal(reads, 2, 'one pass for two players');
  assert.equal(f.nodes.find(row => row.type === 'text').value, 'Keep this draft');
});

test('old save failure cannot display errors or repaint a reopened finish line', async () => {
  const f = harness(); let reject, errors = 0;
  f.h.showError = () => errors++;
  f.h.command = () => new Promise((resolve, no) => { reject = no; });
  await f.view.open(); await f.nodes.find(row => row.textContent === 'Edit draft').action();
  const target = f.nodes.find(row => row.type === 'number'); target.value = 60; const saving = target.listeners.change();
  f.close(); await f.view.open(); reject(new Error('stale save error')); await saving;
  assert.equal(errors, 0); assert.ok(f.nodes.some(row => row.textContent === 'Edit draft'));
});

test('rapid edits pause the next command until the first save refreshes the displayed revision', async () => {
  const f = harness(); let resolve;
  f.h.command = payload => { f.h.calls.push(payload); return new Promise(yes => { resolve = () => { f.h.state.revision++; yes(); }; }); };
  await f.view.open(); await f.nodes.find(row => row.textContent === 'Edit draft').action();
  const target = f.nodes.find(row => row.type === 'number'); target.value = 60; const saving = target.listeners.change();
  const include = f.nodes.find(row => row.attributes['aria-label'] === 'Include Strength'); include.checked = false; await include.listeners.change();
  assert.equal(f.h.calls.length, 1); resolve(); await saving;
  const currentInclude = f.nodes.find(row => row.attributes['aria-label'] === 'Include Strength'); currentInclude.checked = false;
  const next = currentInclude.listeners.change(); assert.equal(f.h.calls.length, 2); resolve(); await next;
});
