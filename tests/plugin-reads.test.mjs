import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { pluginDoneRows, pluginDoneList, pluginDoneLocations, rememberActiveLocations, PLUGIN_REMEMBERED_LOCATIONS, pluginRollSummary, PLUGIN_DONE_LIMIT, PLUGIN_DONE_AGE_MS } from '../app/game-plugin-tasks.mjs';

const now = Date.parse('2026-10-30T12:00:00Z');
const registry = { resolve: rules => ({ 'tasks.completion': 'any', 'access.shared': true, ...rules }) };
const state = () => ({ revision: 4, rules: {}, tasks: [], history: [], members: ['a', 'b'].map(id => ({
  id, name: `Player ${id}`, unlocked: ['12850'], selected: [], pendingRoll: ['13106', '13362'], completedTasks: [], taskStatus: {},
})) });
const task = (id, category = 'Skills', extra = {}) => ({ id, label: id, category, status: 'available', ...extra });
const result = tasks => ({ tasks, presentation: { tasks: tasks.map(row => row.id) },
  taskLocations: Object.fromEntries(tasks.map(row => [row.id, ['12850-1']])) });
const completion = (id, memberId, at, extra = {}) => ({ type: 'complete-task', at: new Date(at).toISOString(), command: { memberId, taskId: id, completed: true }, ...extra });

async function fixture(t, save = state(), savedResult = null) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'plugin-reads-'));
  let at = now, output, input, saved = savedResult && { bytes: Buffer.from(JSON.stringify(savedResult)), revision: save.revision };
  let prediction = null, claimReads = 0, historyReads = 0, poolWarms = 0;
  const controller = await openGamePlugin({ dataDir, clock: () => at, registry, questMapping: new Map(),
    store: { getInfo: () => ({ revision: save.revision }), getCalculationSnapshot: () => ({ state: save, members: save.members }),
      getTaskClaimState: () => { claimReads++; return save; },
      getTaskCompletionHistory: () => { historyReads++; return save.history; }, peekRollPool: () => null,
      rollPool: () => { poolWarms++; } },
    peekPrediction: () => prediction,
    world: { chunks: new Map([['12850', { name: 'Home' }], ['13106', { name: 'East' }], ['13362', { name: 'Far east' }]]) },
    savedTasks: () => saved, bodyJSON: async () => input, json: async (_req, _res, _status, value) => { output = value; },
    serializeMutation: operation => operation(), checkRequestOrigin: () => {},
  });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  const { key } = await controller.create({ admin: true }, { memberId: 'a', label: 'Read test' });
  return { save, controller, setSaved(value) { saved = value; }, setPrediction(value) { prediction = value; }, advance(ms) { at += ms; },
    get poolWarms() { return poolWarms; },
    get reads() { return { claimReads, historyReads }; },
    async call(route = 'tasks', report = null) {
      at += 1001; input = report && { v: 1, seq: 1, sentAt: new Date(at).toISOString(), position: { x: 50, z: 50, floor: 0 }, ...report };
      const url = `/api/plugin/v1/${route}`;
      await controller.handle({ method: report ? 'POST' : 'GET', url, headers: { authorization: `Bearer ${key}` } }, {}, { route: url.split('?')[0], security: {} });
      return output;
    },
  };
}

test('finished lists are personal, newest first, capped at 20 over a rolling seven days', () => {
  const save = state(), tasks = Array.from({ length: 26 }, (_, index) => task(`t${String(index).padStart(2, '0')}`, 'Mining', { level: index + 1 }));
  tasks.push(task('partner'), task('old'), task('unknown'), task('future'));
  const saved = result(tasks);
  save.members[0].completedTasks = [...tasks.filter(row => row.id !== 'partner').map(row => row.id)];
  save.members[1].completedTasks = ['partner'];
  save.history = tasks.slice(0, 26).map((row, index) => completion(row.id, 'a', now - index * 1000));
  save.history.push(completion('partner', 'b', now), completion('old', 'a', now - PLUGIN_DONE_AGE_MS - 1), completion('future', 'a', now + 1));
  for (const row of tasks.slice(0, 6)) saved.taskLocations[row.id] = ['13106'];
  const rows = pluginDoneRows({ state: save, result: saved, registry, memberId: 'a' });
  assert.equal(rows.find(row => row.id === 'unknown').doneAt, null);
  const listed = pluginDoneList({ rows, chunkId: '12850', now });
  assert.equal(listed.allCount, PLUGIN_DONE_LIMIT); assert.equal(listed.hereCount, 14);
  assert.deepEqual(listed.all.map(row => row.id), tasks.slice(0, 20).map(row => row.id));
  assert.deepEqual(listed.here.map(row => row.id), tasks.slice(6, 20).map(row => row.id));
  assert.equal(listed.all[0].doneAt, new Date(now).toISOString());
  assert.ok(listed.all.every(row => row.done === true && !('chunks' in row) && row.level > 0));
  assert.ok(!rows.some(row => row.id === 'partner'));
  const expired = pluginDoneList({ rows, chunkId: '12850', now: now + PLUGIN_DONE_AGE_MS + 1001 });
  assert.equal(expired.allCount, 0);
  assert.equal(pluginDoneList({ rows, chunkId: '12850', now: now + PLUGIN_DONE_AGE_MS }).allCount, 2, 'Seven-day boundary is inclusive');
  assert.equal(pluginDoneList({ rows, chunkId: null, now }).hereKnown, false);
  assert.deepEqual(pluginDoneList({ rows: rows.map(row => ({ ...row, chunks: null })), chunkId: '12850', now }).here, []);
});

test('finished rows reuse picker tick, alias, family and undo evidence, independently of group rules', () => {
  const save = state(); save.rules['tasks.completion'] = 'all';
  save.members[0].taskStatus = { alias: { challengeCompleted: true }, undone: { challengeCompleted: true }, undated: { challengeCompleted: true } };
  save.history = [
    { type: 'tick-active-tasks', at: new Date(now - 500).toISOString(), command: { memberId: 'a', taskIds: ['alias'] } },
    { type: 'set-task-status', at: new Date(now).toISOString(), undoneRevision: 5, command: { memberId: 'a', taskId: 'undone', challengeCompleted: true } },
    completion('alias', 'b', now),
  ];
  const tasks = [task('canonical', 'Skills', { aliases: ['alias'], completionIds: ['canonical', 'alias'] }), task('undone'), task('undated')];
  const rows = pluginDoneRows({ state: save, result: result(tasks), registry, memberId: 'a' });
  assert.equal(rows.find(row => row.id === 'canonical').doneAt, new Date(now - 500).toISOString());
  assert.equal(rows.find(row => row.id === 'undone').doneAt, null);
  assert.deepEqual(pluginDoneList({ rows, chunkId: '12850', now }).all.map(row => row.id), ['canonical']);
});

test('existing v1 fields retain START values for finished tasks and a pending roll', async t => {
  const save = state(); save.members[0].completedTasks = ['finished'];
  save.history = [completion('finished', 'a', now - 1000)];
  const f = await fixture(t, save, result([task('active'), task('finished')]));
  const { done, ...tasks } = await f.call();
  assert.deepEqual(tasks, { v: 1, ready: true, stale: false, stateRevision: 4, chunkId: null, hereKnown: false,
    here: [], all: [{ id: 'active', label: 'active', category: 'Skills' }], allFrom: 0, hereCount: 0, allCount: 1 });
  assert.equal(done.allCount, 1);
  const { rollChoice, pendingRoll, ...status } = await f.call('status');
  assert.deepEqual(status, { v: 1, accepts: ['achievements', 'items', 'item-journal-world', 'toolbelt', 'pouch', 'bank'], achievements: null, items: null, bank: null,
    player: { id: 'a', name: 'Player a' }, chunkId: null, chunkName: null, state: 'unknown', activeTaskCount: 1,
    unlockedChunkCount: 1, pendingProgress: false, seenAt: null, nearby: null, pickableCount: null,
    partners: [{ name: 'Player b', chunkId: null, chunkName: null, seenAt: null }] });
  assert.deepEqual(pendingRoll.map(({ summary, ...row }) => row), [{ chunkId: '13106', chunkName: 'East' }, { chunkId: '13362', chunkName: 'Far east' }]);
  assert.equal(rollChoice, true);
  assert.deepEqual((await f.call('tasks?from=1')).all, []);
});

test('saved and retained finished rows share active staleness, revision caching and current position rules', async t => {
  const save = state(), f = await fixture(t, save);
  const missing = await f.call(); assert.equal(missing.ready, false); assert.equal(missing.done.allCount, 0);
  const saved = result([task('finish'), task('active')]);
  f.setSaved({ bytes: Buffer.from(JSON.stringify(saved)), revision: 4 });
  await f.call('report', {});
  const before = await f.call(); assert.equal(before.done.allCount, 0);
  await f.call(); assert.deepEqual([f.reads.claimReads, f.reads.historyReads], [1, 2]);
  save.revision++; save.members[0].completedTasks = ['finish']; save.history = [completion('finish', 'a', now)]; f.setSaved(null);
  const stale = await f.call();
  assert.equal(stale.stale, true); assert.equal(stale.done.here[0].id, 'finish'); assert.equal(stale.hereCount, 1);
  assert.equal(stale.done.here[0].doneAt, new Date(now).toISOString());
  f.setSaved({ bytes: Buffer.from(JSON.stringify(saved)), revision: 5 });
  assert.equal((await f.call()).stale, false);
  f.advance(PLUGIN_DONE_AGE_MS); assert.equal((await f.call()).done.allCount, 0);
  assert.equal(f.reads.claimReads, 3, 'A fresh replacement was cached once, then only the window changed');
});

test('rollChoice follows member override, legacy map setting and the UI default', async t => {
  const save = state(), f = await fixture(t, save);
  assert.equal((await f.call('status')).rollChoice, true);
  save.members[0].sourceMapId = 'map'; save.legacy = { maps: { map: { settings: { roll2: false } } } }; save.revision++;
  assert.equal((await f.call('status')).rollChoice, false);
  save.members[0].preferences = { roll2: true }; save.revision++;
  assert.equal((await f.call('status')).rollChoice, true);
  save.members[0].preferences.roll2 = false; save.revision++;
  assert.equal((await f.call('status')).rollChoice, false);
});

test('roll summaries group the exact prediction delta and bound plain-text highlights', () => {
  const summary = pluginRollSummary({ delta: { tasksAdded: [task('mine', 'Mining'), task('skill', 'Skills'), task('quest', 'Quest'),
    task('diary', 'Diaries'), task('other', 'Achievements')], objectsAdded: ['~|Bank#FF0000|~', '<b>Tree</b>'],
    trainingChanged: [{ skill: 'Mining', before: { primary: false }, after: { primary: true } }], itemsAdded: [{ name: 'x'.repeat(90) }, { name: 'last' }] } }, { Quest: { '~|quest#FF0000|~': true } });
  assert.deepEqual(summary.newTasks, { skills: 2, quests: 1, diaries: 1, other: 1 });
  assert.deepEqual(summary.highlights, ['Bank', 'Quest start: quest', 'Train Mining', 'x'.repeat(60)]);
  assert.ok(summary.highlights.every(row => typeof row === 'string' && row.length <= 60 && !/[~|<>\x00-\x1f]/.test(row)));
  assert.equal(pluginRollSummary(null), null); assert.equal(pluginRollSummary({ delta: {} }), null);
  assert.equal(pluginRollSummary({ cancelled: true, delta: { tasksAdded: [] } }), null);
  assert.deepEqual(pluginRollSummary({ delta: { tasksAdded: [] } }), { newTasks: { skills: 0, quests: 0, diaries: 0, other: 0 }, highlights: [] });
});

test('GET status summaries only peek while preserving missing-pool warmup', async t => {
  const f = await fixture(t);
  const first = await f.call('status'); assert.ok(first.pendingRoll.every(row => row.summary === null));
  await delay(10);
  f.setPrediction({ delta: { tasksAdded: [task('q', 'Quest')] } });
  const next = await f.call('status'); assert.equal(next.pendingRoll[0].summary.newTasks.quests, 1);
  await f.call('status'); await delay(10);
  assert.deepEqual(f.reads, { claimReads: 0, historyReads: 0 });
  f.save.revision++; f.setPrediction(null);
  assert.equal((await f.call('status')).pendingRoll[0].summary, null, 'No summary survives a changed prediction scope');
  assert.equal('lastRoll' in next, false, 'A post-unlock state cannot reuse the pre-unlock prediction');
  await delay(10); assert.ok(f.poolWarms >= 1, 'Status still warms a missing roll pool, as before');
});


test('done location recovery indexes at most 20 recent rows once and keeps missing evidence unknown', () => {
  const tasks = [], indexed = new Set();
  for (let index = 0; index < 25; index++) {
    const row = task(`done${index}`);
    Object.defineProperty(row, 'record', { enumerable: true, get() { indexed.add(row.id); return { Chunks: ['12850-1'] }; } });
    tasks.push(row);
  }
  const rows = tasks.map((row, index) => ({ id: row.id, label: row.label, category: row.category, done: true,
    doneAt: new Date(now - index * 1000).toISOString(), chunks: null }));
  const world = { chunks: new Map([['12850', {}]]), definitions: { chunks: { '12850': { Sections: { '1': {} } } } } };
  const cache = new Map(), input = { rows, state: state(), result: { tasks, taskLocations: {} }, world, now, cache };
  const located = pluginDoneLocations(input);
  assert.equal(located.length, 20); assert.equal(indexed.size, 20);
  assert.ok(!indexed.has('done20')); assert.ok(located.every(row => row.chunks.includes('12850')));
  indexed.clear(); pluginDoneLocations(input); assert.equal(indexed.size, 0, 'Repeated reads reuse location evidence');
  const unknown = pluginDoneLocations({ ...input, rows: [{ ...rows[0], id: 'unknown' }], cache: new Map() });
  assert.equal(unknown[0].chunks, null);
  const listed = pluginDoneList({ rows: unknown, chunkId: '12850', now });
  assert.equal(listed.hereKnown, false); assert.deepEqual(listed.here, []); assert.equal(listed.allCount, 1);
  // A generated goal has no authored record and play results strip its sources. Unremembered,
  // its location is unknown, but it must not hide the finishes known to be here.
  const goal = { id: 'goal', label: 'Obtain a cape', category: 'Equipment' };
  const mixed = pluginDoneLocations({ ...input, rows: [rows[0], { ...rows[1], id: 'goal' }],
    result: { tasks: [tasks[0], goal], taskLocations: {} }, cache: new Map() });
  assert.equal(mixed.find(row => row.id === 'goal').chunks, null);
  const partial = pluginDoneList({ rows: mixed, chunkId: '12850', now });
  assert.equal(partial.hereKnown, false); assert.deepEqual(partial.here.map(row => row.id), [rows[0].id]);
  assert.equal(partial.allCount, 2);
  // Remembered from when it was active, the goal stays in its chunk after finishing.
  const remembered = pluginDoneLocations({ ...input, rows: [rows[0], { ...rows[1], id: 'goal' }],
    result: { tasks: [tasks[0], goal], taskLocations: {} }, cache: new Map(), remembered: new Map([['goal', ['12850']]]) });
  const shown = pluginDoneList({ rows: remembered, chunkId: '12850', now });
  assert.equal(shown.hereKnown, true); assert.deepEqual(shown.here.map(row => row.id), [rows[0].id, 'goal']);
  // A custom task is in no chunk, as on the map.
  const custom = pluginDoneLocations({ ...input, rows: [{ ...rows[0], id: 'custom:walk' }],
    result: { tasks: [{ id: 'custom:walk', label: 'walk', category: 'Custom' }], taskLocations: {} }, cache: new Map() });
  assert.deepEqual(custom[0].chunks, []);
});

test('active generated goals remember their location; authored and custom tasks do not, and memory is bounded', () => {
  const world = { chunks: new Map([['12850', {}]]), definitions: { challenges: { Quest: { Alpha: { Chunks: ['12850'] } } } } };
  const result = { tasks: [{ id: 'authored', label: 'Alpha', category: 'Quest' }, { id: 'goal', label: 'Obtain a cape', category: 'Equipment' }] };
  const memory = new Map();
  rememberActiveLocations({ memory, world, state: state(), result, rows: [
    { id: 'authored', chunks: ['12850'] }, { id: 'goal', chunks: ['12850'] }, { id: 'custom:walk', chunks: ['12850'] }, { id: 'nowhere', chunks: [] }] });
  assert.deepEqual([...memory], [['goal', ['12850']]]);
  const many = Array.from({ length: PLUGIN_REMEMBERED_LOCATIONS + 10 }, (_, index) => ({ id: `goal${index}`, chunks: ['12850'] }));
  rememberActiveLocations({ memory, world, state: state(), result: { tasks: [] }, rows: many });
  assert.equal(memory.size, PLUGIN_REMEMBERED_LOCATIONS);
  assert.ok(!memory.has('goal') && !memory.has('goal0') && memory.has(`goal${PLUGIN_REMEMBERED_LOCATIONS + 9}`), 'The oldest entries go first');
});
