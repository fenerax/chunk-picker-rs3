import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXpChoiceCatalogue, buildXpChoiceView } from '../app/core/xp-choices.mjs';
import { createXpChoices, renderXpChoiceSource } from '../app/web/lamp-choices.mjs';
import { describeHistoryEvent, historyChangeType } from '../app/web/history-text.mjs';

function node(tag, textContent = '', className = '') {
  return { tag, textContent, className, children: [], value: '', attributes: {}, listeners: {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(name, action) { this.listeners[name] = action; } };
}
const all = root => [root, ...root.children.flatMap(all)];
const base = { el: node, plain: String, button: (label, action, cls) => ({ ...node('button', label, cls), action }) };
const source = (extra = {}) => ({ id: 'lamp:one', label: 'A lamp', availableInMode: true, choices: ['Mining'],
  slots: [{ index: 0, amount: 250, skills: ['Mining', 'Fishing'], selection: 'Mining' }], ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('per-source form saves only changed valid selections and represents unchosen explicitly', async () => {
  const commands = [], root = renderXpChoiceSource(base, source(), { canEdit: true, onSave: async (...args) => commands.push(args) });
  const select = all(root).find(row => row.tag === 'select'), save = all(root).find(row => row.tag === 'button');
  assert.deepEqual(select.children.map(row => [row.textContent, row.value]), [['Not chosen yet', ''], ['Mining', 'Mining'], ['Fishing', 'Fishing']]);
  assert.equal(save.disabled, true);
  select.value = ''; select.listeners.change(); assert.equal(save.disabled, false);
  await save.action(); assert.deepEqual(commands, [['lamp:one', [null]]]);
  assert.ok(all(root).every(row => !Object.keys(row.attributes).some(key => /^(style|on)/.test(key))));
});

test('viewers and unavailable member sources get text, without source write controls', () => {
  for (const [row, canEdit] of [[source(), false], [source({ availableInMode: false }), true]]) {
    const nodes = all(renderXpChoiceSource(base, row, { canEdit }));
    assert.ok(nodes.some(row => row.textContent === 'Mining'));
    assert.equal(nodes.filter(row => ['select', 'button'].includes(row.tag)).length, 0);
  }
});

test('ambiguous import stays visible and can be explicitly cleared', async () => {
  const calls = [], root = renderXpChoiceSource(base, source({ ambiguous: true, importedAllocation: { Mining: 123 },
    slots: [{ index: 0, amount: 250, skills: ['Mining'], selection: null }] }), { canEdit: true, onSave: async (...args) => calls.push(args) });
  assert.ok(all(root).some(row => row.textContent.includes('123 Mining XP')));
  const save = all(root).find(row => row.tag === 'button'); assert.equal(save.disabled, false);
  await save.action(); assert.deepEqual(calls, [['lamp:one', [null]]]);
});

test('unknown imported source shows its allocation and accurate read-only wording', () => {
  const nodes = all(renderXpChoiceSource(base, source({ unknownSource: true, importedAllocation: { Mining: 123 }, slots: [] }), { canEdit: true }));
  assert.ok(nodes.some(row => row.textContent.includes('123 Mining XP') && row.textContent.includes('source is unknown')));
  assert.ok(nodes.every(row => !['button', 'select'].includes(row.tag)));
  assert.ok(nodes.every(row => !row.textContent.includes('Members reward')));
});

test('saved choices outside current skill rules stay visible and can be cleared', async () => {
  const calls = [], root = renderXpChoiceSource(base, source({ slots: [{ index: 0, amount: 250, skills: [], selection: 'Invention' }] }),
    { canEdit: true, onSave: async (...args) => calls.push(args) });
  const select = all(root).find(row => row.tag === 'select');
  assert.deepEqual(select.children.map(row => row.textContent), ['Not chosen yet', 'Invention (unavailable)']);
  assert.equal(select.children[1].disabled, true);
  select.value = ''; select.listeners.change(); await all(root).find(row => row.tag === 'button').action();
  assert.deepEqual(calls, [['lamp:one', [null]]]);
});

test('failed revision save keeps the draft and tells the player to refresh', async () => {
  const root = renderXpChoiceSource(base, source(), { canEdit: true, onSave: async () => { throw Object.assign(new Error('conflict'), { status: 409 }); } });
  const select = all(root).find(row => row.tag === 'select'); select.value = 'Fishing'; select.listeners.change();
  await all(root).find(row => row.tag === 'button').action();
  assert.equal(select.value, 'Fishing'); assert.equal(select.disabled, false);
  assert.ok(all(root).some(row => row.textContent.includes('Your save changed. Refresh choices')));
});

function harness({ writable = true, sessionMember, api } = {}) {
  let generation = 0, content;
  const calls = [], state = { revision: 7, members: [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }] };
  const c = { ...base, state, memberId: 'actor1', sessionMember, canWrite: () => writable, sandbox: { active: false },
    openDialog: (_, root) => { content = root; return ++generation; }, dialogCurrent: value => value === generation,
    api: api ?? (async path => ({ stateRevision: state.revision, memberId: new URL(path, 'http://fixture').searchParams.get('memberId'), f2p: true, rows: [source()] })),
    command: async (...args) => { calls.push(args); state.revision++; } };
  return { c, calls, view: createXpChoices(c), close: () => generation++, get content() { return content; } };
}

test('dialog commands target the displayed owner at the reviewed revision and reload', async () => {
  const h = harness({ sessionMember: 'actor1' }); await h.view.open();
  const select = all(h.content).find(row => row.tag === 'select' && row.attributes['aria-label']?.startsWith('A lamp'));
  select.value = 'Fishing'; select.listeners.change();
  await all(h.content).find(row => row.textContent === 'Save choices').action();
  assert.deepEqual(h.calls, [[{ type: 'set-xp-choices', memberId: 'actor1', taskId: 'lamp:one', choices: ['Fishing'] }, 7]]);
  assert.equal(h.c.state.revision, 8);
});

test('viewer and partner views have no Save choices buttons', async () => {
  for (const options of [{ writable: false }, { sessionMember: 'reed' }]) {
    const h = harness(options); await h.view.open();
    assert.equal(all(h.content).filter(row => row.textContent === 'Save choices').length, 0);
    assert.equal(all(h.content).filter(row => row.tag === 'select').length, 1, 'player chooser is display-only');
    assert.deepEqual(h.calls, []);
  }
});

test('F2P shows usable sources and saved member choices while hiding unassigned member sources', async () => {
  const h = harness({ api: async () => ({ stateRevision: 7, memberId: 'actor1', f2p: true, rows: [
    source({ label: 'Free lamp', source: 'unset' }),
    source({ label: 'Unused member lamp', source: 'unset', availableInMode: false }),
    source({ label: 'Saved member lamp', source: 'imported', availableInMode: false }),
  ] }) });
  await h.view.open();
  const headings = all(h.content).filter(row => row.tag === 'h3').map(row => row.textContent);
  assert.deepEqual(headings, ['Free lamp', 'Saved member lamp']);
});

test('trusted F2P catalogue hides unset member rewards and renders saved ones read-only beside editable Lumbridge', async () => {
  const labels = {
    unset: '~|Varrock Achievements#Easy|~ Complete the Easy Achievements',
    authored: '~|Wilderness Achievements#Easy|~ Complete the Easy Achievements',
    imported: '~|Wilderness Achievements#Medium|~ Complete the Medium Achievements',
    free: '~|Lumbridge Achievements#Easy|~ Complete the Easy Achievements',
  };
  const definitions = { challenges: { Diary: Object.fromEntries(Object.values(labels).map(label => [label, { XpReward: { Any: 100 } }])) } };
  const tasks = Object.entries(labels).map(([id, rawLabel]) => ({ id, category: 'Diary', rawLabel, label: rawLabel }));
  const catalogue = buildXpChoiceCatalogue(definitions, tasks);
  const state = { rules: { 'content.f2p': true }, members: [{ id: 'actor1', sourceMapId: 'old', xpChoices: { authored: ['Mining'] } }],
    legacy: { maps: { old: { chunkinfo: { assignedXpRewards: { Diary: { [labels.imported]: { Fishing: 100 } } } } } } } };
  const before = structuredClone(state);
  const h = harness({ api: async () => ({ stateRevision: 7, ...buildXpChoiceView(state, 'actor1', catalogue) }) });
  await h.view.open();
  const nodes = all(h.content), headings = nodes.filter(row => row.tag === 'h3').map(row => row.textContent);
  assert.equal(headings.length, 3);
  assert(!headings.some(label => label.startsWith('Varrock')));
  assert(headings.some(label => label.startsWith('Lumbridge')));
  assert.equal(nodes.filter(row => row.textContent === 'Save choices').length, 1);
  const rewardSelects = nodes.filter(row => row.tag === 'select' && row.attributes['aria-label'] !== 'XP choices player');
  assert.equal(rewardSelects.length, 1);
  assert.match(rewardSelects[0].attributes['aria-label'], /Lumbridge/);
  for (const id of ['authored', 'imported']) {
    const saved = buildXpChoiceView(state, 'actor1', catalogue).rows.find(row => row.id === id);
    const rendered = all(renderXpChoiceSource(base, saved, { canEdit: true }));
    assert(rendered.every(row => !['button', 'select'].includes(row.tag)));
    assert(rendered.some(row => row.textContent === (id === 'authored' ? 'Mining' : 'Fishing')));
  }
  assert.deepEqual(state, before);
  assert.deepEqual(h.calls, []);
});

test('stale player loads and closed dialogs cannot repaint or save old source controls', async () => {
  const wait = deferred(), h = harness({ api: () => wait.promise });
  const opening = h.view.open(); h.close();
  wait.resolve({ stateRevision: 7, memberId: 'actor1', rows: [source()] }); await opening;
  assert.equal(all(h.content).filter(row => row.textContent === 'Save choices').length, 0);
  const active = harness(); await active.view.open();
  const select = all(active.content).find(row => row.tag === 'select' && row.attributes['aria-label']?.startsWith('A lamp'));
  select.value = 'Fishing'; select.listeners.change(); active.close();
  await all(active.content).find(row => row.textContent === 'Save choices').action();
  assert.deepEqual(active.calls, []);
});

test('XP choice history uses the source name and the progress filter', () => {
  const event = { type: 'set-xp-choices', command: { memberId: 'actor1', taskId: 'quest:test', taskLabel: 'Test quest' } };
  assert.equal(historyChangeType(event), 'progress');
  assert.equal(describeHistoryEvent(event, { memberName: () => 'Player' }), 'Changed XP choices for “Test quest” for Player');
});
