import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { pluginTaskRows, pluginTaskList, pluginTaskFrom, PLUGIN_TASK_LIMITS } from '../app/game-plugin-tasks.mjs';

const registry = { resolve: rules => ({ 'tasks.completion': 'any', 'access.shared': false, ...rules }) };
const task = (id, extra = {}) => ({ id, label: id, category: 'Skills', status: 'available', ...extra });
const makeState = (revision = 3) => ({ revision, rules: {}, tasks: [], history: [], members: ['a', 'b'].map(id => ({ id, name: `Explorer ${id}`,
  unlocked: ['12850'], selected: [], pendingRoll: [], completedTasks: [], taskStatus: {} })) });
const result = (tasks, taskLocations, presented = tasks.map(row => row.id)) => ({ tasks, taskLocations, presentation: { tasks: presented } });

test('in-game rows follow the Active Tasks order and drop blocked, hidden, backlog and completed tasks', () => {
  const state = makeState();
  state.members[0].taskStatus = { fav: { favorite: true }, later: { backlogged: true } };
  state.members[0].completedTasks = ['done'];
  const rows = [task('b-low', { level: 5 }), task('b-high', { level: 40 }), task('fav', { category: 'Quests' }), task('blocked', { status: 'blocked' }),
    task('hidden', { hidden: true }), task('later'), task('done'), task('unshown')];
  const listed = pluginTaskRows({ state, result: result(rows, { 'b-low': ['12850-1'], 'b-high': ['13106'] }, rows.slice(0, -1).map(row => row.id)), registry, memberId: 'a' });
  assert.deepEqual(listed.map(row => row.id), ['fav', 'b-high', 'b-low']);
  assert.deepEqual(listed[1], { id: 'b-high', label: 'b-high', category: 'Skills', level: 40, chunks: ['13106'] });
  assert.deepEqual(listed[2].chunks, ['12850'], 'Interior suffixes map to the surface chunk the game reports');
  const next = { ...state, revision: 4 }; next.members = [{ ...state.members[0], completedTasks: ['done', 'b-low'] }, state.members[1]];
  assert.deepEqual(pluginTaskRows({ state: next, result: { ...result(rows, {}, rows.slice(0, -1).map(row => row.id)), stateRevision: 3 }, registry, memberId: 'a', stale: true })
    .map(row => row.id), ['fav', 'b-high'], 'A stale list is read against the current save');
});

test('the response caps both lists, keeps true counts and never sends chunk lists or control characters', () => {
  const state = makeState(), many = Array.from({ length: 130 }, (_, index) => task(`t${String(index).padStart(3, '0')}`, { label: `Task\n${index}\u0007${'x'.repeat(200)}` }));
  const locations = Object.fromEntries(many.map((row, index) => [row.id, index % 2 ? ['12850'] : ['13106']]));
  const body = pluginTaskList({ rows: pluginTaskRows({ state, result: result(many, locations), registry, memberId: 'a' }), chunkId: '12850', stateRevision: 3, stale: false });
  assert.equal(body.allCount, 130); assert.equal(body.all.length, PLUGIN_TASK_LIMITS.all); assert.equal(body.allFrom, 0);
  assert.equal(body.hereCount, 65); assert.equal(body.here.length, PLUGIN_TASK_LIMITS.here);
  assert.ok(body.here.every(row => !('chunks' in row)) && body.all.every(row => !('chunks' in row)));
  assert.ok(body.all.every(row => row.label.length <= PLUGIN_TASK_LIMITS.label && !/[\x00-\x1f\x7f]/.test(row.label)));
  const unknown = pluginTaskList({ rows: pluginTaskRows({ state, result: result(many, undefined), registry, memberId: 'a' }), chunkId: '12850', stateRevision: 3, stale: false });
  assert.equal(unknown.hereKnown, false); assert.deepEqual(unknown.here, []); assert.equal(unknown.allCount, 130);
  assert.deepEqual(pluginTaskList({ rows: null, chunkId: null, stateRevision: 3, stale: false }),
    { v: 1, ready: false, stale: false, stateRevision: 3, chunkId: null, here: [], all: [], allFrom: 0, hereCount: 0, allCount: 0, hereKnown: false });
});

test('from pages through the whole active list and refuses anything else in the query', () => {
  const state = makeState(), many = Array.from({ length: 130 }, (_, index) => task(`t${String(index).padStart(3, '0')}`));
  const rows = pluginTaskRows({ state, result: result(many, {}), registry, memberId: 'a' });
  const page = from => pluginTaskList({ rows, chunkId: null, stateRevision: 3, stale: false, from });
  const second = page(100);
  assert.deepEqual([second.allFrom, second.allCount, second.all.length, second.all[0].id, second.all.at(-1).id], [100, 130, 30, 't100', 't129']);
  assert.deepEqual(page(30).all.map(row => row.id), many.slice(30, 130).map(row => row.id));
  assert.deepEqual([page(500).all, page(500).allCount], [[], 130], 'Past the end is an empty page, not an error');
  assert.equal(pluginTaskFrom(''), 0); assert.equal(pluginTaskFrom('?from=100'), 100); assert.equal(pluginTaskFrom('?from=0'), 0);
  for (const bad of ['?chunk=1', '?from=-1', '?from=1.5', '?from=', '?from=1e3', '?from=1234567', '?from=1&from=2', '?from=1&x=2']) assert.equal(pluginTaskFrom(bad), null, bad);
});

test('the tasks route reads the saved list only, keeps the last list after a tick and needs a plugin key', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-tasks-'));
  let at = Date.parse('2026-10-21T12:00:00Z'), state = makeState(), saved = null, output, input, claimReads = 0;
  const controller = await openGamePlugin({ dataDir, clock: () => at,
    // No task worker, scheduler or pool calculation is reachable from here.
    store: { getInfo: () => ({ revision: state.revision }), getCalculationSnapshot: () => ({ state, members: state.members }),
      getTaskClaimState: () => { claimReads++; return structuredClone(state); }, peekRollPool: () => null },
    world: { chunks: new Map([['12850', { name: 'Lumbridge' }]]) }, registry, questMapping: new Map(),
    serializeMutation: operation => operation(), bodyJSON: async () => input,
    json: async (_request, _response, _status, value) => { output = value; }, checkRequestOrigin: () => {},
    savedTasks: memberId => memberId === 'a' ? saved : null,
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const { key } = await controller.create({ admin: true }, { memberId: 'a', label: 'Tasks test' });
  const call = async (method, url) => { at += 1001; await controller.handle({ method, url, headers: { authorization: `Bearer ${key}` } }, {}, { route: url.split('?')[0], security: {} }); return output; };
  const tasks = () => call('GET', '/api/plugin/v1/tasks');

  const empty = await tasks();
  assert.equal(empty.ready, false); assert.equal(claimReads, 0, 'Nothing saved means nothing parsed');
  input = { v: 1, seq: 1, sentAt: new Date(at).toISOString(), position: { x: 50, z: 50, floor: 0 } };
  await call('POST', '/api/plugin/v1/report');

  const bytes = Buffer.from(JSON.stringify(result([task('here'), task('away'), task('ticked')], { here: ['12850'], away: ['13106'], ticked: ['12850'] })));
  saved = { bytes, revision: 3 };
  const fresh = await tasks();
  assert.deepEqual({ ready: fresh.ready, stale: fresh.stale, chunkId: fresh.chunkId, hereKnown: fresh.hereKnown }, { ready: true, stale: false, chunkId: '12850', hereKnown: true });
  assert.deepEqual(fresh.here.map(row => row.id), ['here', 'ticked']);
  assert.deepEqual(fresh.all.map(row => row.id), ['away', 'here', 'ticked']);
  await tasks(); assert.equal(claimReads, 1, 'Repeated reads at one revision reuse the rows');
  assert.equal((await call('GET', '/api/plugin/v1/status')).activeTaskCount, 3);

  // A tick clears the server's saved results. The plugin keeps the last list and
  // applies the new completion without starting a calculation.
  state = makeState(4); state.members[0].completedTasks = ['ticked']; saved = null;
  const stale = await tasks();
  assert.equal(stale.stale, true); assert.equal(stale.stateRevision, 4);
  assert.deepEqual(stale.all.map(row => row.id), ['away', 'here']);
  assert.equal((await call('GET', '/api/plugin/v1/status')).activeTaskCount, null, 'Status never reports a stale count');

  // Lists saved while the player has a key are kept even if the plugin was not reading.
  const later = Buffer.from(JSON.stringify(result([task('new')], { new: ['12850'] })));
  controller.rememberTasks('a', later);
  assert.deepEqual((await tasks()).all.map(row => row.id), ['new']);
  controller.rememberTasks('b', later);
  const page = await call('GET', '/api/plugin/v1/tasks?from=1');
  assert.deepEqual([page.allFrom, page.all, page.allCount], [1, [], 1], 'The route passes from through');
  await assert.rejects(call('GET', '/api/plugin/v1/tasks?chunk=1'), { status: 400 });
  await assert.rejects(call('GET', '/api/plugin/v1/tasks?from=-1'), { status: 400 });
  await assert.rejects(call('GET', '/api/plugin/v1/status?from=1'), { status: 400 });
  await assert.rejects(controller.handle({ method: 'GET', url: '/api/plugin/v1/tasks', headers: {} }, {}, { route: '/api/plugin/v1/tasks', security: {} }), { status: 401 });
  await assert.rejects(controller.handle({ method: 'GET', url: '/api/plugin/v1/tasks', headers: { authorization: `Bearer ${key}`, 'content-length': '2' } }, {}, { route: '/api/plugin/v1/tasks', security: {} }), { status: 400 });
});
