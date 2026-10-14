import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkColourPicker, chunkColourLegend } from '../app/web/chunk-colour-picker.mjs';
import { readScreenGraph, screenFunctionSource } from './browser-screen-harness.mjs';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag, text, cls) { Object.assign(this, { tag, textContent: text, className: cls, children: [], attributes: {}, events: {}, hidden: false, disabled: false }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.events[type] = callback; }
  focus() { this.focused = true; }
  contains(node) { return node === this || this.children.some(child => child instanceof Element && child.contains(node)); }
  querySelector() { return null; }
}
const find = (node, predicate) => predicate(node) ? node : node.children?.filter(child => child instanceof Element).map(child => find(child, predicate)).find(Boolean);
function fixture({ writable = true } = {}) {
  let selected = 'actor1';
  const state = { revision: 5, members: [{ id: 'actor1', name: 'Player', chunkColours: {}, chunkColourNames: {} }, { id: 'reed', name: 'Reed' }] };
  const writes = [], el = (...args) => new Element(...args);
  const button = (text, action, cls) => { const node = el('button', text, cls); node.click = action; return node; };
  const picker = createChunkColourPicker({ el, button, host: el('div'), state: () => state, memberId: () => selected, canWrite: () => writable,
    chunkName: () => 'Lumbridge', command: (payload, revision, unused, guard) => {
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      writes.push({ payload, revision, guard, reject, success: () => {
        const owner = state.members.find(member => member.id === payload.memberId);
        if (payload.type === 'set-chunk-colour') owner.chunkColours[payload.chunkId] = payload.colour;
        else owner.chunkColourNames[payload.colour] = payload.name;
        state.revision++; resolve({ state });
      } }); return promise;
    } });
  const labelled = label => find(picker.element, node => node.attributes?.['aria-label'] === label);
  const text = label => find(picker.element, node => node.textContent === label);
  return { picker, writes, state, labelled, text, el, select: id => { selected = id; } };
}

test('four choices and clear send one reviewed command and block duplicate saves', async () => {
  const ui = fixture(); ui.picker.open('12850');
  const pending = ui.labelled('Tint Red').click();
  assert.equal(ui.labelled('Tint Blue').disabled, true);
  await ui.labelled('Tint Blue').click(); assert.equal(ui.writes.length, 1);
  assert.deepEqual(ui.writes[0].payload, { type: 'set-chunk-colour', memberId: 'actor1', chunkId: '12850', colour: 'red' });
  assert.equal(ui.writes[0].revision, 5); ui.writes[0].success(); await pending;
  assert.equal(ui.labelled('Tint Red').attributes['aria-pressed'], 'true');
  await ui.labelled('Tint Red').click(); assert.equal(ui.writes.length, 1, 'the current tint does not create a redundant revision');
  const clear = ui.text('Clear colour').click(); assert.equal(ui.writes[1].revision, 6); assert.equal(ui.writes[1].payload.colour, null);
  ui.writes[1].success(); await clear; assert.equal(ui.text('Clear colour').disabled, true);
});

test('names save as short plain text commands and appear in the legend', async () => {
  const ui = fixture(); ui.picker.open('12850'); const input = ui.labelled('Red colour name');
  assert.equal(input.maxLength, 24); input.value = ' Next ';
  const row = find(ui.picker.element, node => node.tag === 'form');
  row.events.submit({ preventDefault() {} });
  assert.deepEqual(ui.writes[0].payload, { type: 'rename-chunk-colour', memberId: 'actor1', colour: 'red', name: 'Next' });
  ui.writes[0].success(); await Promise.resolve(); await Promise.resolve();
  assert.ok(ui.labelled('Tint Next'));
  const legend = chunkColourLegend({ el: ui.el, state: ui.state }, ui.state.members);
  assert.ok(find(legend, node => node.children?.includes('Next')));
});

test('conflicts retain the reviewed revision until an explicit reload; player switches abandon reviews', async () => {
  const ui = fixture(); ui.picker.open('12850'); let pending = ui.labelled('Tint Blue').click();
  ui.state.revision = 8; ui.writes[0].reject(Object.assign(new Error('Changed'), { status: 409 })); await pending;
  assert.ok(ui.text('Another save arrived. Reload colours, then try again.'));
  pending = ui.labelled('Tint Blue').click(); assert.equal(ui.writes[1].revision, 5);
  ui.writes[1].reject(Object.assign(new Error('Changed'), { status: 409 })); await pending;
  ui.text('Reload colours').click(); pending = ui.labelled('Tint Blue').click(); assert.equal(ui.writes[2].revision, 8);
  ui.select('reed'); assert.equal(ui.writes[2].guard(), false); ui.picker.close(); ui.writes[2].success(); await pending;
  assert.equal(ui.picker.isOpen(), false);
});

test('view-only callers cannot open controls', () => {
  const ui = fixture({ writable: false }); ui.picker.open('12850');
  assert.equal(ui.picker.isOpen(), false); assert.equal(ui.picker.element.children.length, 0); assert.equal(ui.writes.length, 0);
});

test('open chunk details refresh for inherited clears and personal/group colour summaries', async () => {
  const nodes = new Map(), el = (...args) => new Element(...args);
  const c = { el, button: (text, action, cls) => el('button', text, cls), $: id => {
    if (!nodes.has(id)) nodes.set(id, el('div')); return nodes.get(id);
  }, memberId: 'actor1', state: { members: [{ id: 'actor1', name: 'Player', notes: {} }], rules: {} },
  pool: { eligible: [], excluded: [] }, result: null, preferences: () => ({}), chunkTab: 'contents', sandbox: { active: false } };
  const signature = runInNewContext(`(${screenFunctionSource(await readScreenGraph(), 'chunkSignature')})`, c);
  const inherited = signature('12853'); c.state.members[0].chunkColours = { 12853: null };
  const cleared = signature('12853'); assert.notEqual(cleared, inherited);
  c.$('group-view').checked = true; assert.notEqual(signature('12853'), cleared);
});
