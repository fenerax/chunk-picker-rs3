import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBossGatesModel, bossGateDetail, renderBossGates, createBossGatesView } from '../app/web/boss-gates-view.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, children: [], attributes: {}, listeners: {}, dataset: {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener(name, action) { this.listeners[name] = action; } };
}
const all = root => [root, ...root.children.flatMap(all)];
const texts = root => all(root).map(item => item.textContent).filter(Boolean);
const context = () => ({ el: node, button: (label, action, cls) => ({ ...node('button', label, cls), action }) });

const state = { revision: 3, members: [{ id: 'a', name: 'Ash' }, { id: 'b', name: 'Birch' }] };
const status = (id, fields) => ({ id, boss: id === 'mole' ? 'Giant Mole' : 'Vorago', monsters: [id], open: false, openedBy: null, reason: '', missing: [], gearItems: [],
  condition: id === 'mole' ? '40 Defence and 40 Attack and the group can get a tier-40 weapon, body and legs in one style' : 'group content, unlocked by hand', ...fields });
const results = () => new Map([
  ['a', { bossGates: [status('mole', { open: true, openedBy: 'levels', gearItems: ['Sword', 'Body', 'Legs'] }), status('vorago', {})] }],
  ['b', { bossGates: [status('mole', { missing: ['Defence 38/40', 'needs tier-40 melee legs'] }), status('vorago', { open: true, openedBy: 'manual' })] }],
]);

test('the model lists every boss with each player state and open counts', () => {
  const model = buildBossGatesModel(state, results());
  assert.deepEqual(model.members.map(({ name, ready, open }) => [name, ready, open]), [['Ash', true, 1], ['Birch', true, 1]]);
  assert.deepEqual(model.gates.map(gate => gate.id), ['mole', 'vorago']);
  const [ash, birch] = model.gates[0].players;
  assert.equal(bossGateDetail(ash), 'Gear: Sword, Body, Legs');
  assert.equal(bossGateDetail(birch), 'Defence 38/40; needs tier-40 melee legs');
  assert.equal(bossGateDetail(model.gates[1].players[0]), 'Unlock by hand from the chunk panel');
  assert.equal(bossGateDetail(model.gates[1].players[1]), 'Unlocked by hand');

  const waiting = buildBossGatesModel(state, new Map([['a', results().get('a')]]));
  assert.equal(waiting.members[1].ready, false);
  assert.equal(bossGateDetail(waiting.gates[0].players[1]), 'Still loading');
  assert.deepEqual(buildBossGatesModel(state, new Map()).gates, []);
});

test('the list shows conditions and missing pieces, and can hide bosses open for everyone', () => {
  const c = context(), model = buildBossGatesModel(state, results());
  const shown = texts(renderBossGates(c, model));
  for (const text of ['Ash: 1 of 2 open · Birch: 1 of 2 open', 'Giant Mole', `Condition: ${model.gates[0].condition}`, 'Defence 38/40; needs tier-40 melee legs', 'Locked', 'Open'])
    assert(shown.includes(text), text);
  assert(all(renderBossGates(c, model)).every(item => !Object.keys(item.attributes).some(key => /^(?:style|on)/.test(key))));

  const everyone = buildBossGatesModel(state, new Map([...results()].map(([id, result]) => [id, { bossGates: result.bossGates.map(gate => ({ ...gate, open: true, openedBy: 'manual' })) }])));
  assert(texts(renderBossGates(c, everyone, { hideOpen: true })).includes('Every boss is open for everyone.'));
  assert.equal(all(renderBossGates(c, model, { hideOpen: true })).filter(item => item.className === 'boss-gates-row').length, 2);
});

test('the dialog loads every player and reloads when the save changes', async () => {
  const c = context(), loaded = [];
  let opened, generation = 1;
  Object.assign(c, { state: { ...state }, sandbox: { active: false }, $: () => undefined, dialogCurrent: value => value === generation,
    openDialog: (title, root) => { opened = { title, root }; return generation; }, showError: error => { throw error; },
    ensureDuoDetails: async id => { loaded.push(id); return results().get(id); } });
  const view = createBossGatesView(c);
  await view.open();
  assert.equal(opened.title, 'Boss gates');
  assert.deepEqual(loaded, ['a', 'b']);
  assert(texts(opened.root).includes('Defence 38/40; needs tier-40 melee legs'));
  view.refresh(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded.length, 2, 'An unchanged save does not reload');
  c.state = { ...state, revision: 4 }; view.refresh(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loaded, ['a', 'b', 'a', 'b']);
});
