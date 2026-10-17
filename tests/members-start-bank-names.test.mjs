import test from 'node:test';
import assert from 'node:assert/strict';
import { createMembersStart } from '../app/web/members-start.mjs';
import { membersStartBankCondition, membersStartPools } from '../app/core/members-start.mjs';

test('starting-bank names and conditional requirements remain findable without changing eligibility', async () => {
  class Node {
    constructor(tag, text = '') { Object.assign(this, { tag, textContent: text ?? '', children: [], events: {}, attributes: {}, value: '' }); }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, callback) { this.events[key] = callback; }
  }
  const data = {
    optionA: [{ chunkId: '100', place: 'Village', bank: 'Village bank', requirementsNote: 'No extra requirements.' }],
    optionAConditional: [{ chunkId: '200', place: 'Cave surface entrance', bank: 'Cave keeper bank', condition: 'Pay with carried gems each visit.', requirementsNote: 'Check the payment in-game. Research detail remains here.' },
      { chunkId: '201', place: 'Hill', bank: 'Hill bank', requirementsNote: 'Needs 40 Crafting. Confirm each player’s level.' }],
    optionAF2PExtension: [], optionB: [{ chunkId: '300', place: 'Harbour', requirementsNote: 'Check access.' }],
    optionBConditional: [{ chunkId: '301', place: 'Nursery', condition: 'Needs Trader Woes completed.', requirementsNote: 'Confirm the achievement for each player.' }],
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
  const optional = nodes().find(node => node.tag === 'fieldset' && walk(node).some(child => child.textContent === 'Optional banks'));
  assert.ok(walk(optional).some(node => node.textContent === 'Cave surface entrance'));
  assert.ok(walk(optional).some(node => node.textContent === 'Condition: Pay with carried gems each visit.'));
  assert.ok(walk(optional).some(node => node.textContent === 'Condition: Needs 40 Crafting.'));
  assert.ok(nodes().some(node => node.textContent === 'one: 1 bank'));
  const conditional = nodes().find(node => node.tag === 'label' && walk(node).some(child => child.textContent === 'Include conditional banks')).children[0];
  assert.equal(conditional.checked, false);
  conditional.checked = true; conditional.events.change();
  assert.ok(nodes().some(node => node.tag === 'strong' && node.textContent === 'Cave keeper bank'));
  assert.ok(nodes().some(node => node.textContent === 'Cave surface entrance'));
  const detail = nodes().find(node => node.tag === 'details' && node.children.some(child => child.textContent === data.optionAConditional[0].requirementsNote));
  assert.ok(detail);
  assert.ok(detail.children.some(node => node.tag === 'summary' && node.textContent === 'More detail'));
  assert.notEqual(detail.open, true);
  assert.ok(nodes().some(node => node.textContent === 'Condition: Needs 40 Crafting.'));
  assert.equal(nodes().some(node => node.textContent === 'Conditional bank — check requirements below'), false);
  const search = nodes().find(node => node.type === 'search'); search.value = 'keeper'; search.events.input();
  const firstList = nodes().find(node => node.tag === 'ul' && node.children.some(child => child.tag === 'li' && walk(child).some(descendant => descendant.textContent === 'Village bank')));
  assert.deepEqual(firstList.children.map(node => node.hidden), [true, false, true]);
  search.value = 'CARRIED GEMS'; search.events.input();
  assert.deepEqual(firstList.children.map(node => node.hidden), [true, false, true]);
  search.value = '40 crafting'; search.events.input();
  assert.deepEqual(firstList.children.map(node => node.hidden), [true, true, false]);
  search.value = 'research detail'; search.events.input();
  assert.deepEqual(firstList.children.map(node => node.hidden), [true, false, true]);
  assert.ok(nodes().some(node => node.textContent === '1 of 3 banks shown'));
  assert.equal(calls.length, 0);
  nodes().find(node => node.tag === 'button' && node.textContent === 'Review members start').events.click();
  assert.equal(nodes().filter(node => node.type === 'search').length, 0);
  assert.ok(nodes().some(node => node.tag === 'strong' && node.textContent === 'Village bank'));
  assert.equal(nodes().find(node => node.tag === 'button' && node.textContent === 'Reset group maps and roll starting banks').disabled, true);
  assert.equal(calls.length, 0);
  nodes().find(node => node.tag === 'button' && node.textContent === 'Back').events.click();
  const havenhythe = nodes().find(node => node.type === 'radio' && node.value === 'optionB');
  havenhythe.checked = true; havenhythe.events.change();
  assert.ok(nodes().some(node => node.textContent === 'Condition: Needs Trader Woes completed.'));
  assert.ok(nodes().some(node => node.textContent === 'one: 1 bank'));
  assert.equal(nodes().find(node => node.attributes['data-members-key'] === 'one: I have done Trader Woes').checked, false);
  const trader = nodes().find(node => node.attributes['data-members-key'] === 'one: I have done Trader Woes');
  trader.checked = true; trader.events.change();
  assert.ok(nodes().some(node => node.textContent === 'one: 2 banks'));
  assert.ok(nodes().some(node => node.textContent === 'two: 1 bank'));
  assert.equal(calls.length, 0);
});

test('old bank notes supply only their first sentence as the condition', () => {
  assert.equal(membersStartBankCondition({ condition: 'Pay every visit.', requirementsNote: 'Location. Research caveat.' }), 'Pay every visit.');
  for (const [note, expected] of [
    ['  Needs 40 Crafting. Check each player.  ', 'Needs 40 Crafting.'],
    ['Bring supplies! Check details.', 'Bring supplies!'],
    ['Access unlocked? Check details.', 'Access unlocked?'],
    ['Requires level 40', 'Requires level 40'],
    ['Cost is 1.5 coins. Check details.', 'Cost is 1.5 coins.'],
    ['', ''],
  ]) assert.equal(membersStartBankCondition({ requirementsNote: note }), expected);
  assert.equal(membersStartBankCondition({}), '');
});

test('bank pools preserve conditions and reject non-string condition fields', () => {
  const bank = { chunkId: '100', place: 'Village', condition: 'Bring supplies.' };
  assert.equal(membersStartPools({ optionA: [bank] }, ['one'])[0].banks[0].condition, bank.condition);
  for (const condition of [null, false, 20, [], {}]) {
    assert.throws(() => membersStartPools({ optionA: [{ ...bank, condition }] }, ['one']), /Bank condition must be a string/);
  }
  assert.doesNotThrow(() => membersStartPools({ optionA: [{ chunkId: '100', place: 'Village' }] }, ['one']));
});
