import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { buildPartnerSupplyModel, formatPartnerSupplySummary } from '../app/web/partner-supply-model.mjs';

function fixture(tasks = []) {
  const state = createGroupState([{ id: 'a', name: 'Player' }, { id: 'b', name: 'Reed' }]);
  state.revision = 4;
  const results = new Map(state.members.map(member => [member.id, { memberId: member.id, stateRevision: 4, tasks: member.id === 'a' ? tasks : [], items: [], ownItems: [] }]));
  return { state, results };
}
const task = (id, names = ['Logs'], extra = {}) => ({ id, label: id, category: 'Firemaking', obligation: true, hidden: false, status: 'available',
  partnerItemNeeds: [{ requirement: 'Logs', count: 1, ownCount: 0, items: names,
    sources: Object.fromEntries(names.map(name => [name, [{ kind: 'spawn', own: false }]])) }], sources: names.map(item => ({ item, kind: 'spawn', own: false })), ...extra });
const supply = (results, names = ['Logs'], extra = {}) => { results.get('b').items = names.map(name => ({ name, sources: [{ kind: 'spawn', own: true, ...extra }] })); };
const requests = (state, results) => buildPartnerSupplyModel(state, results).members[0].requests;

test('groups concrete supplies and retains active and blocked task reasons without inventing quantities or mutating input', () => {
  const { state, results } = fixture([task('Burn logs'), task('Light beacon', ['Logs'], { status: 'blocked' })]);
  supply(results); const before = structuredClone({ state, results });
  const rows = requests(state, results);
  assert.equal(rows.length, 1); assert.equal(rows[0].label, 'Logs'); assert.equal(rows[0].choiceCount, null);
  assert.equal(rows[0].items[0].quantity, null); assert.deepEqual(rows[0].needs.map(need => need.taskId), ['Burn logs', 'Light beacon']);
  assert.equal(rows[0].items[0].sources[0].memberId, 'b');
  assert.deepEqual({ state, results }, before);
});

test('only current matching results establish readiness', () => {
  const { state, results } = fixture([task('t')]); supply(results);
  results.get('b').stateRevision = 3;
  assert.deepEqual(buildPartnerSupplyModel(state, results).members.map(member => member.ready), [false, false]);
  assert.equal(requests(state, results).length, 0);
  results.get('b').stateRevision = 4; results.get('b').memberId = 'a';
  assert.equal(buildPartnerSupplyModel(state, results).members[0].ready, false);
  results.get('b').memberId = 'b'; delete results.get('b').items;
  assert.equal(buildPartnerSupplyModel(state, results).members[0].ready, false, 'current lightweight results lack full supply evidence');
});

test('supplier own provenance and receiver admitted ordinary source must both agree', () => {
  for (const extra of [{ own: false }, { processingMode: 'multi' }]) {
    const { state, results } = fixture([task('t')]); supply(results, ['Logs'], extra);
    assert.equal(requests(state, results).length, 0);
  }
  for (const sources of [[], [{ item: 'Logs', own: true }], [{ item: 'Logs', own: false, processingMode: 'multi' }]]) {
    const { state, results } = fixture([task('t', ['Logs'], { sources })]); supply(results);
    assert.equal(requests(state, results).length, 0);
  }
});

test('distinct aliases retain choices and ask only for the missing quota', () => {
  const row = task('t', ['Oak logs', 'Willow logs'], { partnerItemNeeds: [{ requirement: 'Logs[+]x2', count: 2, ownCount: 1, items: ['Oak logs', 'Willow logs'],
    sources: { 'Oak logs': [{ kind: 'spawn', own: false }], 'Willow logs': [{ kind: 'spawn', own: false }] } }] });
  const { state, results } = fixture([row]); supply(results, ['Oak logs', 'Willow logs']);
  const request = requests(state, results)[0];
  assert.equal(request.choiceCount, 1); assert.equal(request.items.length, 2); assert.ok(request.items.every(item => item.quantity === null));
  row.partnerItemNeeds[0].ownCount = 2; assert.equal(requests(state, results).length, 0);
  row.partnerItemNeeds[0].ownCount = 0; supply(results, ['Oak logs']); assert.equal(requests(state, results).length, 0);
});

test('scope, backlog, completed facts and collection targets exclude requests', () => {
  const rows = [task('ok'), task('outside', ['Logs'], { obligation: false }), task('hidden', ['Logs'], { hidden: true }),
    task('unsupported', ['Logs'], { status: 'unsupported' }), task('never', ['Logs'], { record: { NeverShow: true } }),
    task('collection', ['Logs'], { kind: 'collection' }), task('backlog'), task('complete')];
  const { state, results } = fixture(rows); supply(results);
  state.members[0].taskStatus = { backlog: { backlogged: true } }; state.members[1].completedTasks = ['complete'];
  assert.deepEqual(requests(state, results)[0].needs.map(need => need.taskId), ['ok']);
  state.rules['tasks.completion'] = 'personal';
  assert.deepEqual(requests(state, results)[0].needs.map(need => need.taskId), ['ok', 'complete']);
});

test('engine source-policy evidence excludes supplier shops and unrelated sources and absent evidence fails closed', () => {
  const eligible = { kind: 'drop', source: 'Goblin', location: '12341-0', own: false };
  const row = task('NonShop duty', ['Logs'], { record: { NonShop: true }, sources: [
    { ...eligible, item: 'Logs' }, { kind: 'shop', source: 'General store', item: 'Logs', own: false },
  ] });
  row.partnerItemNeeds[0].sources.Logs = [eligible];
  const { state, results } = fixture([row]);
  results.get('b').items = [{ name: 'Logs', sources: [
    { ...eligible, own: true, probability: 0.5 },
    { kind: 'shop', source: 'General store', own: true },
    { kind: 'drop', source: 'Other monster', location: '12341-0', own: true },
  ] }];
  assert.deepEqual(requests(state, results)[0].items[0].sources.map(source => source.source), ['Goblin']);
  delete row.partnerItemNeeds[0].sources;
  assert.equal(requests(state, results).length, 0);
});

test('same item with different task source policies remains separate with the correct reasons', () => {
  const drop = { kind: 'drop', source: 'Goblin', location: '12341-0', own: false };
  const shop = { kind: 'shop', source: 'General store', location: '12341-0', own: false };
  const constrained = (id, source) => {
    const row = task(id, ['Logs'], { sources: [{ ...source, item: 'Logs' }] });
    row.partnerItemNeeds[0].sources.Logs = [source]; return row;
  };
  const { state, results } = fixture([constrained('Drop duty', drop), constrained('Shop duty', shop)]);
  results.get('b').items = [{ name: 'Logs', sources: [{ ...drop, own: true }, { ...shop, own: true }] }];
  const rows = requests(state, results);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.needs[0].label, row.items[0].sources[0].kind]), [['Drop duty', 'drop'], ['Shop duty', 'shop']]);
});

test('canonical completion aliases and completion families stay authoritative', () => {
  const { state, results } = fixture([task('current'), task('drop:new', ['Logs'], { completionGroup: 'family' })]); supply(results);
  state.identityRegistry = { entries: { current: { category: 'Firemaking' } }, aliases: { old: 'current' } };
  state.members[1].completedTasks = ['old', 'drop:old'];
  results.get('a').tasks.push({ id: 'drop:old', label: 'old', category: 'Extra', obligation: false });
  results.get('a').collectionPlanning = { completionGroups: { family: ['drop:new', 'drop:old'] } };
  assert.equal(requests(state, results).length, 0);
});

test('house-storage uses chosen parts and authored material quantities, retaining differing per-task quantities', () => {
  const storage = (id, quantity) => task(id, ['Plank', 'Hat'], { partnerItemNeeds: [], houseStorage: { parts: ['Hat'], materials: { Plank: quantity } } });
  const { state, results } = fixture([storage('wardrobe', 4), storage('chest', 2)]); supply(results, ['Plank', 'Hat']);
  const rows = requests(state, results), plank = rows.find(row => row.label === 'Plank');
  assert.equal(plank.items[0].quantity, null); assert.deepEqual(plank.needs.map(need => need.quantity), [4, 2]);
  assert.equal(rows.find(row => row.label === 'Hat').items[0].quantity, null);
  results.get('a').ownItems = ['Hat']; assert.deepEqual(requests(state, results).map(row => row.label), ['Plank']);
});

test('whole quest inherits hidden direct step supplies with parent attribution and personal completion boundaries', () => {
  const step = (id, item, extra = {}) => task(id, [item], { category: 'Quest', baseQuest: "Cook's Assistant", hidden: true, obligation: false, ...extra });
  const parent = task('Cook complete', [], { category: 'Quest', baseQuest: "Cook's Assistant", partnerItemNeeds: [], dependencyTaskIds: ['return'],
    record: { Tasks: { 'Alternative step[+]': 'Quest' } } });
  const middle = step('return', 'Nothing', { partnerItemNeeds: [], dependencyTaskIds: ['milk', 'egg', 'flour', 'external', 'never', 'backlog', 'unsupported'] });
  const milk = step('milk', 'Bucket of milk');
  const egg = step('egg', 'Egg', { dependencyTaskIds: ['return'] });
  const flour = step('flour', 'Pot of flour');
  const external = step('external', 'External item', { baseQuest: 'Another quest' });
  const alternative = step('alternative', 'Alternative item');
  const never = step('never', 'Never item', { record: { NeverShow: true } });
  const backlog = step('backlog', 'Backlog item');
  const unsupported = step('unsupported', 'Unsupported item', { status: 'unsupported' });
  const { state, results } = fixture([parent, middle, milk, egg, flour, external, alternative, never, backlog, unsupported]);
  supply(results, ['Bucket of milk', 'Egg', 'Pot of flour', 'External item', 'Alternative item', 'Never item', 'Backlog item', 'Unsupported item']);
  state.members[0].completedTasks = ['milk'];
  state.members[1].completedTasks = ['egg'];
  state.members[0].taskStatus = { backlog: { backlogged: true } };
  const rows = requests(state, results);
  assert.deepEqual(rows.map(row => row.label), ['Egg', 'Pot of flour']);
  assert.ok(rows.every(row => row.needs.length === 1 && row.needs[0].taskId === parent.id && row.needs[0].label === parent.label));
  flour.personalCompleted = true;
  assert.deepEqual(requests(state, results).map(row => row.label), ['Egg']);
});

test('active requests follow existing presentation while blocked obligations remain inspectable', () => {
  const { state, results } = fixture([task('active'), task('lower method'), task('blocked', ['Logs'], { status: 'blocked' })]); supply(results);
  results.get('a').presentation = { tasks: ['active'] };
  assert.deepEqual(requests(state, results)[0].needs.map(need => need.taskId), ['active', 'blocked']);
});

test('membership and level-cap blocked goals and personal reward sources never become trade requests', () => {
  const { state, results } = fixture([task('members goal', ['Logs'], { status: 'blocked', blockers: [{ kind: 'membership' }] }),
    task('quest reward', ['Silverlight'])]);
  supply(results, ['Logs']);
  results.get('b').items.push({ name: 'Silverlight', sources: [{ kind: 'reward', own: true }] });
  const reward = results.get('a').tasks[1]; reward.sources = [{ item: 'Silverlight', kind: 'reward', own: false }];
  reward.partnerItemNeeds[0].sources = { Silverlight: [{ kind: 'reward', own: false }] };
  assert.deepEqual(requests(state, results), []);
});

test('empty summaries name both players instead of copying blank text', () => {
  const { state, results } = fixture();
  const summary = formatPartnerSupplySummary(buildPartnerSupplyModel(state, results));
  assert.match(summary, /Player: No partner supplies needed/);
  assert.match(summary, /Reed: No partner supplies needed/);
});

test('summary escapes Discord formatting and mentions, retains reasons and stays bounded', () => {
  const { state, results } = fixture([task('@everyone *beacon*')]); supply(results);
  state.members[1].name = '@here **Reed**';
  const model = buildPartnerSupplyModel(state, results), text = formatPartnerSupplySummary(model);
  assert.ok(text.includes('Ask @\u200bhere \\*\\*Reed\\*\\* for Logs'));
  assert.ok(text.includes('@\u200beveryone \\*beacon\\*')); assert.ok(!text.includes('@everyone'));
  model.members[0].requests = Array.from({ length: 200 }, () => structuredClone(model.members[0].requests[0]));
  assert.ok(formatPartnerSupplySummary(model).length <= 1920);
});
