import test from 'node:test';
import assert from 'node:assert/strict';
import { createMembersStart } from '../app/web/members-start.mjs';

test('starting-bank names and conditional requirements remain findable without changing eligibility', async () => {
  class Node {
    constructor(tag, text = '') { Object.assign(this, { tag, textContent: text ?? '', children: [], events: {}, attributes: {}, value: '' }); }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, callback) { this.events[key] = callback; }
  }
  const data = {
    optionA: [{ chunkId: '100', place: 'Village', bank: 'Village bank', requirementsNote: 'No extra requirements.' }],
    optionAConditional: [{ chunkId: '200', place: 'Cave surface entrance', bank: 'Cave keeper bank', requirementsNote: 'Check the payment in-game.' }],
    optionAF2PExtension: [], optionB: [{ chunkId: '300', place: 'Harbour', requirementsNote: 'Check access.' }], optionBConditional: [],
  };
  const el = (tag, text) => new Node(tag, text);
  const state = { revision: 4, members: ['one', 'two'].map(id => ({ id, name: id, unlocked: [], selected: [], pendingRoll: [] })) };
  let content, generation = 0;
  const calls = [];
  const ctx = { el, input: type => Object.assign(el('input'), { type }), state: () => state,
    button: (label, click) => { const node = el('button', label); node.events.click = click; return node; },
    api: async () => ({ data }), command: command => calls.push(command),
    openDialog: (title, node) => { content = node; return ++generation; }, dialogCurrent: value => value === generation,
  };
  const walk = node => [node, ...node.children.flatMap(walk)];
  const nodes = () => walk(content);
  await createMembersStart(ctx).open();
  assert.ok(nodes().some(node => node.tag === 'strong' && node.textContent === 'Village bank'));
  assert.equal(nodes().some(node => node.tag === 'strong' && node.textContent === 'Cave keeper bank'), false);
  const conditional = nodes().find(node => node.tag === 'label' && walk(node).some(child => child.textContent === 'Include conditional banks')).children[0];
  conditional.checked = true; conditional.events.change();
  assert.ok(nodes().some(node => node.tag === 'strong' && node.textContent === 'Cave keeper bank'));
  assert.ok(nodes().some(node => node.textContent === 'Cave surface entrance'));
  assert.ok(nodes().some(node => node.textContent === 'Conditional bank — check requirements below'));
  const search = nodes().find(node => node.type === 'search'); search.value = 'keeper'; search.events.input();
  const firstList = nodes().find(node => node.tag === 'ul' && node.children.some(child => child.tag === 'li' && walk(child).some(descendant => descendant.textContent === 'Village bank')));
  assert.deepEqual(firstList.children.map(node => node.hidden), [true, false]);
  assert.ok(nodes().some(node => node.textContent === '1 of 2 banks shown'));
  assert.equal(calls.length, 0);
  nodes().find(node => node.tag === 'button' && node.textContent === 'Review members start').events.click();
  assert.equal(nodes().filter(node => node.type === 'search').length, 0);
  assert.ok(nodes().some(node => node.tag === 'strong' && node.textContent === 'Village bank'));
  assert.equal(nodes().find(node => node.tag === 'button' && node.textContent === 'Reset group maps and roll starting banks').disabled, true);
  assert.equal(calls.length, 0);
});
