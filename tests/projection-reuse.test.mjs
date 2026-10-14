import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentMembersOnly, membersEquipmentRequirement, selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { projectPlayResult, projectPlayTask } from '../app/play-view.mjs';

const row = (id, extras = {}) => ({ id, label: id, rawLabel: id, category: 'Extra',
  status: 'available', hidden: false, obligation: true, record: {}, ...extras });
const equalBytes = (actual, expected) => {
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
};

test('presentation reuse preserves decoded legacy flags, explicit false, order and later edits', () => {
  const tasks = [row('completed'), row('legacy done'), row('explicit false'), row('legacy backlog'),
    row('low', { category: 'Woodcutting', level: 20, primary: true }),
    row('high', { category: 'Woodcutting', level: 60, primary: true }),
    row('peer', { category: 'Woodcutting', level: 60, primary: true })];
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'one', sourceMapId: 'map',
    completedTasks: ['completed'], taskStatus: { 'explicit false': { challengeCompleted: false } } }],
  legacy: { maps: { map: { chunkinfo: {
    completedChallenges: { Extra: { 'legacy%20done': true, 'explicit%20false': true } },
    backlog: { Extra: { 'legacy%20backlog': true } },
  } } } } };
  const result = { tasks, metrics: { processingPasses: 1 } };
  const before = structuredClone({ state, result });
  const compare = () => equalBytes(selectPresentedTasks(result, state, 'one'),
    selectPresentedTasks(result, state, 'one', {}, { reuse: false }));
  compare();
  assert.deepEqual({ state, result }, before);
  assert.ok(selectPresentedTasks(result, state, 'one').tasks.some(task => task.id === 'explicit false'));
  state.members[0].completedTasks.push('high');
  delete state.legacy.maps.map.chunkinfo.backlog.Extra['legacy%20backlog'];
  compare();
  assert.ok(selectPresentedTasks(result, state, 'one').tasks.some(task => task.id === 'legacy backlog'));
});

test('play loops preserve whitelisted property order, hidden rows and completed suppression', () => {
  const tasks = [row('active', { level: 1, primary: false, aliases: [], completionIds: [],
    record: { Description: '', RequirementAlternatives: [{}] }, blockers: [{ detail: 'first' }, { detail: 'second' }] }),
  row('done', { hidden: true, level: 99, wiki: 'example', record: { Description: 'Hidden' } }),
  row('other', { item: 'Item', generated: true, equipmentName: 'Armour' })];
  const result = { tasks, presentation: { tasks: [tasks[0]], suppressed: {
    done: ['Challenge already satisfied.'], other: ['Challenge already satisfied.', 'Task is backlogged.'],
  } }, metrics: { catalogueCount: 3 }, access: { areas: [] }, partnerConnections: [],
  collectionPlanning: { completionGroups: {} } };
  const before = structuredClone(result);
  equalBytes(projectPlayResult(result), projectPlayResult(result, { reuse: false }));
  for (const task of tasks) for (const retainHiddenDisplay of [false, true]) equalBytes(
    projectPlayTask(task, { retainHiddenDisplay }), projectPlayTask(task, { retainHiddenDisplay, reuse: false }));
  assert.deepEqual(result, before);
  equalBytes(projectPlayResult({}), projectPlayResult({}, { reuse: false }));
  const sparse = { tasks: new Array(3) };
  sparse.tasks[1] = tasks[0];
  equalBytes(projectPlayResult(sparse), projectPlayResult(sparse, { reuse: false }));
});

test('equipment membership requirements preserve alias counts, distinct choices and case', () => {
  const definitions = { equipment: {
    'fixture member': { members: true }, 'fixture free': { members: false },
    'fixture other': { members: false },
  }, codeItems: { itemsPlus: {
    'Choice[+]': ['fixture member', 'fixture free', 'fixture free'],
    'Enough[+]': ['fixture member', 'fixture free', 'fixture other'],
    'Unknown[+]': ['fixture member', 'fixture unclassified'],
  } } };
  const restriction = token => membersEquipmentRequirement({}, { Items: [token] }, definitions);
  assert.equal(restriction('Choice[+]'), false);
  assert.equal(restriction('Choice[+]x2'), true);
  assert.equal(restriction('*Choice[+]*x2'), true);
  assert.equal(restriction('Enough[+]x2'), false);
  assert.equal(restriction('Unknown[+]'), false);
  assert.equal(restriction('Unknown[+]x2'), true);
  assert.equal(restriction('choice[+]x2'), false);
  assert.equal(equipmentMembersOnly('Coins', { members: false }), false);
  assert.equal(equipmentMembersOnly('Coins', { members: true }), true);
  // The fourth argument permits private, selection-local work instrumentation
  // without adding counters or fields to the serializable presentation result.
  const calls = [];
  const selection = { membersOnly: (name, data) => { calls.push(name); return data.members === true; } };
  assert.equal(membersEquipmentRequirement({ equipmentName: 'fixture member' }, {}, definitions, selection), true);
  assert.deepEqual(calls, ['fixture member']);
});

test('membership reuse classifies repeated tokens once and refreshes after definition changes', () => {
  let equipmentReads = 0;
  const equipment = new Proxy({ 'fixture member': { members: true }, 'fixture free': { members: false } }, {
    get(target, key) { equipmentReads++; return Reflect.get(target, key); },
  });
  const definitions = { equipment, codeItems: { itemsPlus: { 'Choice[+]': ['fixture member', 'fixture free', 'fixture free'] } } };
  const tasks = Array.from({ length: 40 }, (_, index) => row(`membership-${index}`, {
    record: { Items: [index % 2 ? '*Choice[+]*x2' : 'Choice[+]x2'] },
  }));
  const state = { rules: { 'content.f2p': true }, members: [{ id: 'one', completedTasks: [] }] };
  const result = { tasks, metrics: { processingPasses: 1 } };
  const select = reuse => selectPresentedTasks(result, state, 'one', definitions, { reuse });
  equipmentReads = 0;
  const fast = select(true), fastReads = equipmentReads;
  equipmentReads = 0;
  const reference = select(false), referenceReads = equipmentReads;
  equalBytes(fast, reference);
  assert.ok(fastReads < referenceReads, `${fastReads} equipment reads should be fewer than ${referenceReads}`);
  assert.equal(fast.tasks.length, 0);
  equipment['fixture member'].members = false;
  equalBytes(select(true), select(false));
  assert.equal(select(true).tasks.length, tasks.length);
  definitions.codeItems.itemsPlus['Choice[+]'] = ['fixture member', 'fixture free', 'Coins'];
  equipment['fixture member'].members = true;
  equalBytes(select(true), select(false));
  assert.equal(select(true).tasks.length, tasks.length);
});
