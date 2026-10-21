import test from 'node:test';
import assert from 'node:assert/strict';
import { countMapTasks, createMapTaskCounts } from '../app/web/map-task-counts.mjs';

const registry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
const task = (id, extra = {}) => ({ id, label: id, category: 'Extra', status: 'available', ...extra });
const state = () => ({ revision: 3, rules: {}, tasks: [], members: ['actor1', 'reed'].map(id => ({ id, name: id, unlocked: ['12342', '12341'], completedTasks: [], taskStatus: {} })) });
const result = (memberId, tasks, taskLocations, presented = tasks) => ({ memberId, stateRevision: 3, tasks, taskLocations, presentation: { tasks: presented } });
const count = (snapshot, results, options) => countMapTasks({ state: snapshot, results, registry, memberId: 'actor1', ...options });

test('default personal badges exclude blocked, backlog, completion, hidden and unpresented tasks', () => {
  const snapshot = state(); snapshot.members[0].taskStatus.backlog = { backlogged: true }; snapshot.members[1].completedTasks = ['done'];
  const rows = [task('active'), task('blocked', { status: 'blocked' }), task('backlog'), task('done'), task('hidden', { hidden: true }), task('lower')];
  const own = result('actor1', rows, Object.fromEntries(rows.map(row => [row.id, ['12342', '12342', '99999']])), rows.slice(0, -1));
  assert.deepEqual([...count(snapshot, [own])], [['12342', 1]]);
  assert.deepEqual([...count(snapshot, [result('reed', [task('peer')], { peer: ['12342'] })])], []);
});

test('group counts shared tasks once and uses locations only from attributed active owners', () => {
  const snapshot = state(), shared = task('shared'), own = task('own'), peer = task('peer');
  const a = result('actor1', [shared, own], { shared: ['12342'], own: ['12341'] });
  const b = result('reed', [shared, peer], { shared: ['12342', '12341'], peer: ['12342'] });
  assert.deepEqual([...count(snapshot, [a])].sort(), [['12341', 1], ['12342', 1]]);
  assert.deepEqual([...count(snapshot, [a, b], { groupView: true })].sort(), [['12341', 2], ['12342', 2]]);
  snapshot.members[1].taskStatus.shared = { backlogged: true };
  assert.deepEqual([...count(snapshot, [a, b], { groupView: true })].sort(), [['12341', 1], ['12342', 2]]);
  assert.equal(count(snapshot, [a], { groupView: true }).size, 0, 'Partial group results never masquerade as combined counts');
  assert.equal(count({ ...snapshot, revision: 4 }, [a, b], { groupView: true }).size, 0);
});

test('result refresh reuses count identity through filter redraws and clears during stale or Sandbox views', () => {
  const snapshot = state(), a = result('actor1', [task('a')], { a: ['12342'] }), paints = [];
  const c = { state: snapshot, registry, memberId: 'actor1', result: a, sandbox: { active: false }, duoEnabled: () => false, map: { setTaskCounts: value => paints.push(value) } };
  const cache = createMapTaskCounts(c), first = cache.refresh();
  assert.equal(cache.refresh(), first); assert.equal(paints.length, 1);
  c.result = { ...a, taskLocations: { a: ['12341'] } }; assert.notEqual(cache.refresh(), first);
  c.state = { ...snapshot, revision: 4 }; assert.equal(cache.refresh().size, 0);
  c.state = snapshot; c.sandbox.active = true; assert.equal(cache.refresh().size, 0);
});

test('Chunk Info reads the same entries the badge counts, with each owner task id', () => {
  const snapshot = state(), shared = task('shared'), own = task('own'), peer = task('peer');
  const a = result('actor1', [shared, own], { shared: ['12342'], own: ['12342'] }), b = result('reed', [shared, peer], { shared: ['12342'], peer: ['12342'] });
  const c = { state: snapshot, registry, memberId: 'actor1', result: a, sandbox: { active: false }, duoEnabled: () => false, map: {} };
  const cache = createMapTaskCounts(c);
  assert.deepEqual(cache.at('12342').map(entry => entry.taskIdByMember.actor1).sort(), ['own', 'shared']);
  assert.equal(cache.at(12342).length, cache.refresh().get('12342'));
  c.duoEnabled = () => true; c.duoResults = () => ({ results: () => new Map([['actor1', a], ['reed', b]]) });
  const group = cache.at('12342');
  assert.equal(group.length, 3); assert.equal(group.length, cache.refresh().get('12342'));
  assert.deepEqual(group.find(entry => entry.taskIdByMember.reed === 'peer').memberIds, ['reed']);
  assert.deepEqual(cache.at('12341'), []);
  c.sandbox.active = true; assert.deepEqual(cache.at('12342'), []);
});