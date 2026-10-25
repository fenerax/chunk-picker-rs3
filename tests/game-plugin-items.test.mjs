import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { validatePluginReport } from '../app/integrations/game-plugin.mjs';
import { GAME_ITEMS, matchGameItems } from '../app/integrations/game-items.mjs';
import { applyCommand, createGroupState, validateState } from '../app/core/state.mjs';

const identity = { admin: true };
const journalId = 'aaaaaaaaaaaaaaaa';
const CHAINBODY = 34830, CHAINBODY_NOTED = 34831, YEW_SHORTBOW = 857, BRONZE_DAGGER = 1205, UNKNOWN = 999999;
const goal = suffix => `rs3:goal:equipment:${suffix}`;
const WEAR_TASK = 'rs3:task:000b41';
// Synthetic catalogue rows with the real generated IDs; labels are local.
const catalogue = [
  { id: goal('000597'), label: 'Obtain a Gud raider chainbody', category: 'BiS' },
  { id: goal('000dc1'), label: 'Obtain a Yew shortbow', category: 'BiS' },
  { id: goal('0002ae'), label: 'Obtain a Bronze dagger', category: 'BiS' },
  { id: WEAR_TASK, label: 'Wear a piece of gud raider equipment', category: 'Skill' },
];
const items = ({ snapshot = '0123456789abcdef', worn = [], backpack = [], events = [], id = journalId } = {}) => ({ snapshot, worn, backpack, journal: { id, events } });

async function fixture(t, { betaAsLive = false } = {}) {
  const dataDir = await mkdtemp(fileURLToPath(new URL('../.plugin-items-test-', import.meta.url)));
  let at = Date.parse('2026-10-22T12:00:00Z'), input, output, seq = 0, controller;
  const warnings = [], commands = [], taskCatalogue = new Map(catalogue.map(row => [row.id, row])), failing = { command: false };
  let state = createGroupState([{ id: 'a', name: 'Explorer 1' }, { id: 'b', name: 'Explorer 2' }]);
  const store = {
    getInfo: () => ({ revision: state.revision }), getCalculationSnapshot: () => ({ state, members: state.members }), peekRollPool: () => null,
    command: async (command, expectedRevision) => {
      if (failing.command) throw new Error('Synthetic write failure');
      state = applyCommand(state, command, { expectedRevision, now: () => new Date(at).toISOString(), taskCatalogue });
      commands.push(structuredClone(command)); return state;
    },
  };
  let queue = Promise.resolve();
  async function start() {
    controller = await openGamePlugin({ dataDir, store, clock: () => at, world: { chunks: new Map() }, registry: { resolve: () => ({}) }, questMapping: new Map(),
      serializeMutation: operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next; },
      bodyJSON: async () => input, json: async (_request, _response, status, value) => { assert.equal(status, 200); output = value; },
      checkRequestOrigin: () => {}, taskCatalogue: () => catalogue, itemsBetaAsLive: betaAsLive, log: message => warnings.push(message) });
  }
  await start();
  const { key } = await controller.create(identity, { memberId: 'a', label: 'Synthetic plugin' });
  t.after(async () => { await controller.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function send(value, beta = false) {
    at += 1001; input = { v: 1, seq: ++seq, sentAt: new Date(at).toISOString(), position: { x: 50, z: 50, floor: 0 }, world: { id: beta ? 204 : 1, beta }, items: value };
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
    await controller.handle(request, {}, { route: request.url, security: {} }); return output;
  }
  async function apply(selected) {
    const preview = controller.review(identity, 'a');
    const review = controller.findReview(identity, { previewId: preview.previewId, expectedRevision: preview.stateRevision, items: selected.map(taskId => ({ taskId })) }, true);
    await store.command(review.command, preview.stateRevision); await controller.finish('a');
    return review.command;
  }
  return { get controller() { return controller; }, get state() { return state; }, commands, send, apply, dataDir, warnings, failing,
    review: () => controller.review(identity, 'a'), restart: async () => { await controller.close(); await start(); } };
}

test('item reports are bounded, separate and keep unreadable containers as null', () => {
  const base = { v: 1, seq: 1, sentAt: '2026-10-22T12:00:00.000Z', position: { x: 1, z: 1, floor: 0 } };
  assert.doesNotThrow(() => validatePluginReport({ ...base, items: items({ worn: null, backpack: [[0, 1205, 1, 'Bronze dagger']] }) }));
  for (const bad of [
    { ...base, items: items(), achievements: { snapshot: '0123456789abcdef', part: 1, parts: 1, complete: [] } },
    { ...base, items: items(), skills: {} },
    { ...base, items: { ...items(), extra: 1 } },
    { ...base, items: items({ snapshot: 'short' }) },
    { ...base, items: items({ worn: [[0, 1, 1, 'A'], [0, 2, 1, 'B']] }) },
    { ...base, items: items({ worn: [[0, 1, 0, 'A']] }) },
    { ...base, items: items({ backpack: [[0, 1, 1, 'Bad\u0000name']] }) },
    { ...base, items: items({ backpack: Array.from({ length: 65 }, (_, slot) => [slot, 1, 1, 'A']) }) },
    { ...base, items: items({ events: [[2, 1, 'A'], [2, 1, 'A']] }) },
    { ...base, items: items({ events: Array.from({ length: 33 }, (_, index) => [index + 1, 1, 'A']) }) },
    { ...base, items: items({ id: 'xyz' }) },
  ]) assert.throws(() => validatePluginReport(bad), error => error.status === 400);
});

test('the reviewed table only maps checked IDs; possession matches Obtain goals and wearing matches Wear tasks', () => {
  assert.equal(GAME_ITEMS.get(CHAINBODY).goalId, goal('000597'));
  assert.equal(GAME_ITEMS.get(CHAINBODY_NOTED).noted, true);
  assert.equal(GAME_ITEMS.has(UNKNOWN), false);
  const task = id => catalogue.find(row => row.id === id) ?? null;
  const evidence = new Map([[CHAINBODY, { name: 'Gud raider chainbody', ownedAt: '2026-10-22T12:00:00.000Z', wornAt: null, first: true }]]);
  const owned = matchGameItems({ evidence, task, completed: new Set(), world: 'live' });
  assert.deepEqual(owned.rows.map(row => [row.taskId, row.evidence, row.seen]), [[goal('000597'), 'owned', 'owned when first seen; source unknown']]);
  evidence.get(CHAINBODY).wornAt = '2026-10-22T12:01:00.000Z';
  const worn = matchGameItems({ evidence, task, completed: new Set([goal('000597')]), world: 'live' });
  assert.deepEqual(worn.rows.map(row => [row.taskId, row.evidence]), [[WEAR_TASK, 'worn']]);
  assert.equal(matchGameItems({ evidence, task: () => null, completed: new Set(), world: 'live' }).rows.length, 0, 'Tasks absent from the catalogue are never proposed');
  const ticking = matchGameItems({ evidence, task, completed: new Set(), world: 'live', autoTick: true });
  assert.deepEqual([ticking.ticks.map(row => row.taskId), ticking.rows.map(row => row.taskId)], [[goal('000597')], [WEAR_TASK]], 'Only owned goals tick');
});

test('the eight BiS goals from the in-game test map to their checked IDs, noted copies included', () => {
  for (const [suffix, wearable, noted] of [['00080a', 10150, 10151], ['0009f0', 46845, 46846], ['0009f8', 1359, 1360], ['000a6e', 46885, 46886],
    ['000a80', 46865, 46866], ['000b61', 3385, 3386], ['000be4', 45465, 1194], ['000cb2', 4405, 4406]]) {
    assert.equal(GAME_ITEMS.get(wearable).goalId, goal(suffix)); assert.equal(GAME_ITEMS.get(wearable).noted, false);
    assert.equal(GAME_ITEMS.get(noted).goalId, goal(suffix)); assert.equal(GAME_ITEMS.get(noted).noted, true);
  }
});

test('live owned items tick their BiS goals with labels and provenance; Wear tasks stay in review', async t => {
  const f = await fixture(t);
  const value = items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow'], [1, UNKNOWN, 3, 'Mystery item']] });
  const status = await f.send(value);
  assert.deepEqual(status.items, { snapshot: value.snapshot, journal: { id: journalId, event: 0 } });
  assert.equal(f.commands.length, 1, 'One History entry for the batch');
  assert.deepEqual(f.commands[0].items.map(row => [row.taskId, row.evidence, row.gameItemId, row.seen]), [
    [goal('000dc1'), 'owned', YEW_SHORTBOW, 'owned when first seen; source unknown'],
    [goal('000597'), 'owned', CHAINBODY, 'owned when first seen; source unknown'],
  ]);
  const member = f.state.members[0];
  assert.deepEqual([...member.completedTasks].sort(), [goal('000dc1'), goal('000597')].sort());
  assert.deepEqual(member.itemProgress[goal('000597')], { title: 'Gud raider chainbody', gameItemId: CHAINBODY, evidence: 'owned',
    seen: 'owned when first seen; source unknown', source: 'game-plugin', fetchedAt: '2026-10-22T12:00:01.001Z', memberId: 'a' });
  assert.ok(f.state.tasks.some(task => task.id === goal('000597')), 'Generated goal registered from the trusted catalogue');
  assert.doesNotThrow(() => validateState(f.state));
  const preview = f.review();
  assert.deepEqual(preview.items.map(row => [row.taskId, row.evidence, row.seen, row.world]), [[WEAR_TASK, 'worn', 'worn 2026-10-22T12:00:01.001Z', 'live']]);
  assert.deepEqual(preview.unmappedItems, [{ gameItemId: UNKNOWN, name: 'Mystery item' }]);
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.players.a.items).sort(), [String(YEW_SHORTBOW), String(CHAINBODY)].sort(), 'Only reviewed IDs are stored');
  assert.equal(saved.players.a.items[CHAINBODY].first, true);
  assert.deepEqual(saved.players.a.handled, [goal('000dc1'), goal('000597')].sort());

  // Later gains tick as new; a repeat of the same report ticks nothing.
  await f.send(items({ snapshot: '1123456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }));
  assert.equal(f.commands.length, 2);
  assert.deepEqual(f.commands[1].items.map(row => [row.taskId, row.seen]), [[goal('0002ae'), 'new since 2026-10-22T12:00:02.002Z']]);
  await f.send(items({ snapshot: '1123456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }));
  assert.equal(f.commands.length, 2);
});

test('an undone item tick is not ticked again, and a failed tick waits in review', async t => {
  const f = await fixture(t);
  f.failing.command = true;
  await f.send(items({ backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.evidence]), [[goal('000dc1'), 'owned']], 'Kept for review when the write fails');
  f.failing.command = false;
  await f.send(items({ snapshot: '1123456789abcdef', backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.ok(f.state.members[0].completedTasks.includes(goal('000dc1')), 'The next report ticks it');
  const undone = applyCommand(f.state, { type: 'undo' }, { expectedRevision: f.state.revision, now: () => '2026-10-22T13:00:00.000Z' });
  assert.equal(undone.members[0].completedTasks.includes(goal('000dc1')), false);
  assert.equal(undone.members[0].itemProgress?.[goal('000dc1')], undefined, 'Undo removes the evidence');
  await f.restart();
  await f.send(items({ snapshot: '2223456789abcdef', backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.equal(f.commands.length, 1, 'Handled across restart');
});

test('Apply ticks only chosen review rows; shown live rows stay handled across restart', async t => {
  const f = await fixture(t);
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  const command = await f.apply([WEAR_TASK]);
  assert.deepEqual(command.items.map(row => [row.taskId, row.evidence, row.seen]), [[WEAR_TASK, 'worn', 'worn 2026-10-22T12:00:01.001Z']]);
  const member = f.state.members[0];
  assert.deepEqual(member.itemProgress[WEAR_TASK], { title: 'Gud raider chainbody', gameItemId: CHAINBODY, evidence: 'worn',
    seen: 'worn 2026-10-22T12:00:01.001Z', source: 'game-plugin', fetchedAt: '2026-10-22T12:00:01.001Z', memberId: 'a' });
  assert.doesNotThrow(() => validateState(f.state));
  const saved = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'));
  assert.deepEqual(saved.players.a.handled, [WEAR_TASK, goal('000597'), goal('000dc1')].sort());

  await f.restart();
  await f.send(items({ snapshot: '2223456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, YEW_SHORTBOW, 1, 'Yew shortbow']] }));
  assert.equal(f.review().preview, null, 'Handled and completed rows do not return after a restart');
});

test('a Wear row left unticked stays handled and is not offered again', async t => {
  const f = await fixture(t);
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']] }));
  await f.apply([]);
  assert.equal(f.state.members[0].completedTasks.includes(WEAR_TASK), false, 'Skipped rows stay unticked');
  await f.send(items({ snapshot: '2223456789abcdef', worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']] }));
  assert.equal(f.review().preview, null);
});

test('beta snapshots never tick, stay in memory and are labelled; journal events count once per journal', async t => {
  const f = await fixture(t);
  const status = await f.send(items({ backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']], events: [[1, CHAINBODY, 'Gud raider chainbody'], [2, CHAINBODY_NOTED, 'Gud raider chainbody']] }), true);
  assert.deepEqual(status.items.journal, { id: journalId, event: 2 });
  assert.equal(f.commands.length, 0, 'Beta items never tick');
  const rows = f.review().items;
  assert.ok(rows.every(row => row.world === 'beta'));
  assert.ok(rows.some(row => row.taskId === WEAR_TASK), 'A worn journal event is worn evidence');
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8'), { code: 'ENOENT' });
  await f.controller.finish('a');
  await f.send(items({ snapshot: '3323456789abcdef', backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']], events: [[1, CHAINBODY, 'Gud raider chainbody']] }), true);
  assert.equal(f.review().preview, null, 'Dismissed beta rows stay hidden for this run');
});

test('a scratch picker can let beta items tick as live ones would', async t => {
  const f = await fixture(t, { betaAsLive: true });
  await f.send(items({ worn: [[4, CHAINBODY, 1, 'Gud raider chainbody']], backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }), true);
  assert.deepEqual(f.commands[0].items.map(row => row.taskId), [goal('0002ae'), goal('000597')]);
  assert.deepEqual(f.review().items.map(row => [row.taskId, row.world]), [[WEAR_TASK, 'live']]);
  assert.ok(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'), 'utf8')).players.a.items[CHAINBODY]);
});

test('a first look with an unreadable container records nothing and keeps the journal unacknowledged', async t => {
  const f = await fixture(t);
  const status = await f.send(items({ worn: null, backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']], events: [[1, CHAINBODY, 'Gud raider chainbody']] }));
  assert.deepEqual(status.items, { snapshot: '0123456789abcdef', journal: null });
  assert.equal(f.review().preview, null);
});

test('saved item progress validates provenance, evidence kind and task references', () => {
  let state = createGroupState([{ id: 'a', name: 'Explorer 1' }]);
  const taskCatalogue = new Map(catalogue.map(row => [row.id, row]));
  const base = { type: 'apply-game-progress', memberId: 'a', fetchedAt: '2026-10-22T12:00:00.000Z', skills: [], quests: [] };
  const seen = 'owned when first seen; source unknown';
  for (const bad of [[{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'gift', seen }], [{ taskId: 'rs3:goal:equipment:ffffff', title: 'X', gameItemId: 1, evidence: 'owned', seen }],
    [{ taskId: goal('000597'), title: 'X', gameItemId: -1, evidence: 'owned', seen }], [{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'owned', seen, source: 'other' }],
    [{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'owned' }], [{ taskId: goal('000597'), title: 'X', gameItemId: 1, evidence: 'owned', seen: 'bad\nlabel' }]]) {
    assert.throws(() => applyCommand(state, { ...base, items: bad }, { expectedRevision: state.revision, taskCatalogue }));
  }
  state = applyCommand(state, { ...base, items: [{ taskId: goal('000597'), title: 'Gud raider chainbody', gameItemId: CHAINBODY, evidence: 'owned', seen }] }, { expectedRevision: state.revision, taskCatalogue });
  const unticked = applyCommand(state, { type: 'complete-task', memberId: 'a', taskId: goal('000597'), completed: false }, { expectedRevision: state.revision, taskCatalogue });
  assert.equal(Object.hasOwn(unticked.members[0].itemProgress, goal('000597')), false, 'Unticking clears the item evidence');
  const bad = structuredClone(state); bad.members[0].itemProgress[goal('000597')].memberId = 'b';
  assert.throws(() => validateState(bad));
});

test('a corrupt item sidecar is archived on the next write, never deleted', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.dataDir, 'plugin-items.json'), '{not json');
  await f.restart();
  assert.ok(f.warnings.some(line => /Invalid plugin item store/.test(line)));
  await f.send(items({ backpack: [[0, BRONZE_DAGGER, 1, 'Bronze dagger']] }));
  const { readdir } = await import('node:fs/promises');
  assert.ok((await readdir(f.dataDir)).some(name => name.startsWith('plugin-items.json.corrupt-')));
});
