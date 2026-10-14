import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestMap } from '../app/web/quest-map.mjs';

class Node {
  constructor(tag, text = '', cls = '') { this.tagName = tag; this.textContent = text; this.className = cls; this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  get childElementCount() { return this.children.length; }
  get allText() { return [this.textContent, ...this.children.map(node => node.allText ?? node.textContent)].join(' '); }
  setAttribute(name, value) { this[name] = value; }
  querySelector(tag) { return this.children.find(node => node.tagName === tag) ?? this.children.map(node => node.querySelector?.(tag)).find(Boolean); }
  focus(options) { this.focused = true; this.focusOptions = options; }
}
function harness() {
  const nodes = new Map([['map-panel', new Node('section')], ['map-hover', new Node('canvas')]]);
  nodes.get('map-panel').ownerDocument = { head: new Node('head') };
  const matches = [], fits = [], writes = [], closures = [];
  const c = { $: id => nodes.get(id), el: (tag, text, cls) => new Node(tag, text, cls),
    button: (text, action) => Object.assign(new Node('button', text), { action }), plain: value => value,
    details: (title, ...children) => { const node = new Node('details'); node.append(new Node('summary', title), ...children); return node; },
    world: { surface: new Set(['100', '101', '102']), areas: new Map([['Cave', {}]]) }, memberId: 'one',
    state: { revision: 1, members: [{ id: 'one', unlocked: ['100'] }, { id: 'two', unlocked: ['101'] }] },
    definitions: { quests: { Example: '100, 101, 102, Cave, Missing', Other: '101', Empty: '' } },
    ensureFullDefinitions: async () => {}, closeDialog: () => closures.push('close'), command: value => writes.push(value),
    map: { setSearchMatches: (...args) => matches.push(args), centerOnChunks: ids => { fits.push(ids); return true; } } };
  return { c, nodes, matches, fits, writes, closures, controller: createQuestMap(c) };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };

test('view-only quest controls highlight recorded locked and group-unlocked chunks, fit and retain a visible Clear', async () => {
  const h = harness(); h.c.canWrite = () => false;
  const before = JSON.stringify(h.c.state), control = h.controller.controls({ quest: 'Example' });
  await control.children[0].action();
  assert.deepEqual(h.matches.at(-1), [['100', '101', '102'], { lockedIds: ['102'] }]);
  assert.deepEqual(h.fits, [['100', '101', '102']]);
  assert.deepEqual(h.closures, ['close']);
  const panel = h.nodes.get('map-panel').children[0];
  assert.deepEqual(panel.querySelector('button').focusOptions, { preventScroll: true });
  assert.equal(panel.hidden, false);
  assert.equal(panel.children[1].textContent, '3 chunks · 1 still locked');
  assert.match(panel.children[3].allText, /No map square for: Cave/);
  assert.match(panel.children[3].allText, /No chunk recorded for: Missing/);
  await panel.querySelector('button').action();
  assert.equal(panel.hidden, true); assert.deepEqual(h.matches.at(-1), [[]]);
  assert.equal(JSON.stringify(h.c.state), before); assert.deepEqual(h.writes, []);
});

test('another quest replaces all geometry; player, world and revision changes clear status together', async () => {
  for (const change of [c => c.memberId = 'two', c => c.state.revision++, c => c.world = { ...c.world }]) {
    const h = harness();
    await h.controller.controls({ quest: 'Example' }).children[0].action();
    await h.controller.controls({ quest: 'Other' }).children[0].action();
    assert.deepEqual(h.matches.at(-1), [['101'], { lockedIds: [] }]);
    change(h.c); h.controller.refresh();
    assert.deepEqual(h.matches.at(-1), [[]]);
    assert.equal(h.nodes.get('map-panel').children[0].hidden, true);
  }
});

test('missing geography keeps the dialog open and plainly describes the unknown step', async () => {
  const h = harness(); h.c.definitions.challenges = { Quest: { '~|Empty|~ step': { BaseQuest: 'Empty' } } };
  const controls = h.controller.controls({ quest: 'Empty' }); await controls.children[0].action();
  assert.match(controls.children[1].textContent, /No map chunks recorded.*No chunk recorded for: Empty step/);
  assert.deepEqual(h.closures, []); assert.deepEqual(h.fits, []);
});

test('Search clearing, another dialog or changed scope cannot publish late quest geometry', async () => {
  for (const change of [h => h.controller.clear(), h => h.c.memberId = 'two', h => h.c.state.revision++, h => h.guard = false]) {
    const h = harness(), load = deferred(); h.guard = true; h.c.ensureFullDefinitions = () => load.promise;
    const controls = h.controller.controls({ quest: 'Example', guard: () => h.guard });
    const showing = controls.children[0].action(); assert.equal(controls.children[0].disabled, true);
    change(h); load.resolve(); await showing;
    assert.equal(controls.children[0].disabled, false);
    assert.deepEqual(h.fits, []); assert.equal(h.nodes.get('map-panel').children.length, 0);
  }
});

test('loading failure can be retried and an unavailable fit falls back to the first chunk', async () => {
  const h = harness(); h.c.ensureFullDefinitions = async () => { throw Error('offline'); };
  const controls = h.controller.controls({ quest: 'Other' }); await controls.children[0].action();
  assert.match(controls.children[1].textContent, /unavailable.*Try Show on map again/);
  h.c.ensureFullDefinitions = async () => {}; h.c.map.centerOnChunks = () => false;
  h.c.map.centerOnChunk = id => h.fits.push(id); await controls.children[0].action();
  assert.deepEqual(h.fits, ['101']);
});

test('long interior lists collapse to a count with the names one click away', async () => {
  const h = harness();
  h.c.world = { surface: new Set(['100']), areas: new Map(['A', 'B', 'C', 'D'].map(name => [name, {}])) };
  h.c.definitions = { quests: { Big: '100, A, B, C, D' } };
  await h.controller.controls({ quest: 'Big' }).children[0].action();
  const notes = h.nodes.get('map-panel').children[0].children[3];
  assert.equal(notes.children.length, 1);
  assert.equal(notes.children[0].tagName, 'details');
  assert.equal(notes.children[0].children[0].textContent, '4 places have no map square (caves, buildings and similar)');
  assert.equal(notes.children[0].children[1].textContent, 'A; B; C; D.');
});
