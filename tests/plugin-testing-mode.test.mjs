// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { createGroupState, importBackup } from '../app/core/state.mjs';
import { pluginTestingMode, pluginTestingSettings, withPluginTestingMode } from '../app/core/plugin-testing.mjs';
import { GAME_ITEMS } from '../app/integrations/game-items.mjs';
import { openPluginItems, openPluginJournalCommits } from '../app/plugin-items.mjs';
import { mapTransferRoster } from '../app/save-transfer.mjs';
import { routePermissions } from '../app/picker-context-http.mjs';
import { scratch } from './helpers/save-surface-corpus.mjs';
import { assertDeclared } from './helpers/save-surface.mjs';
import { frozenRuntime } from './helpers/frozen-release.mjs';

const at = '2026-11-01T12:00:00.000Z', admin = { admin: true };
const player = 'synthetic-one', partner = 'synthetic-two';
const snapshot = '0123456789abcdef', journalId = 'aaaaaaaaaaaaaaaa';
const freshSnapshot = 'fedcba9876543210';
const itemId = 857, goal = GAME_ITEMS.get(itemId).goalId;
const tasks = [{ id: 'synthetic-diary', category: 'Diary', label: '~|Synthetic#Easy|~ Synthetic achievement' },
  { id: goal, category: 'BiS', label: 'Obtain synthetic equipment' },
  { id: 'synthetic-quest', category: 'Quest', label: 'Synthetic quest' }];
const achievement = (part = 1, parts = 1) => ({ snapshot, part, parts, complete: part === 1 ? [[1, 'Synthetic achievement', 0, 0]] : [] });
const items = (events = [], backpack = []) => ({ snapshot, worn: [], backpack, pouch: [], journal: { id: journalId, events } });

async function fixture(t, { betaAsLive = false, beforeBody = async () => {}, beforeMutation = async () => {}, beforeCommit, provenance } = {}) {
  let store, controller, input, output, seq = 0;
  const close = async () => { try { await controller?.close(); } finally { await store?.close(); } };
  // Hooks run in registration order: close writers before scratch removes files.
  t.after(close);
  const dataDir = await scratch(t, 'testing-mode');
  const initialState = createGroupState([{ id: player, name: 'Explorer 1' }, { id: partner, name: 'Explorer 2' }]);
  if (provenance !== undefined) initialState.provenance = provenance;
  initialState.tasks = tasks;
  initialState.members[0].transportFacts = { currencies: { coins: 123 } };
  let now = Date.parse(at);
  const catalogue = new Map(tasks.map(task => [task.id, task]));
  async function start() {
    store = await openStore({ dataDir, initialState, retention: false, world: { chunks: new Map([['100', { id: '100' }]]) },
      now: () => new Date(now).toISOString(), taskCatalogue: catalogue, beforeCommit });
    controller = await openGamePlugin({ dataDir, store, world: { chunks: new Map() }, registry: { resolve: () => ({}) },
      questMapping: new Map([['synthetic quest', [{ taskId: 'synthetic-quest', label: 'Synthetic quest' }]]]),
      taskCatalogue: () => tasks, clock: () => now, itemsBetaAsLive: betaAsLive,
      serializeMutation: async operation => { await beforeMutation(); return operation(); },
      bodyJSON: async () => { await beforeBody(); return input; },
      json: async (_request, _response, status, value) => { assert.equal(status, 200); output = value; },
      checkRequestOrigin() {}, log() {},
    });
  }
  await start();
  const credentials = {};
  for (const id of [player, partner]) credentials[id] = (await controller.create(admin, { memberId: id, label: 'Synthetic key' })).key;
  return { dataDir, get store() { return store; }, get controller() { return controller; },
    state: () => store.getState(), close,
    restart: async () => { await close(); await start(); },
    toggle: (enabled, identity = { memberId: player }, memberId = player) => controller.setTestingMode(identity,
      { memberId, enabled, expectedRevision: store.getInfo().revision }),
    async status() {
      const request = { method: 'GET', url: '/api/plugin/v1/status', headers: { authorization: `Bearer ${credentials[player]}` } };
      await controller.handle(request, {}, { route: request.url, security: {} }); return output;
    },
    async send(body = {}, memberId = player) {
      now += 1001;
      input = { v: 1, seq: ++seq, sentAt: new Date(now).toISOString(), world: { id: 1, beta: false }, position: { x: 50, z: 50, floor: 0 }, ...body };
      const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${credentials[memberId]}` } };
      await controller.handle(request, {}, { route: request.url, security: {} }); return output;
    },
  };
}

test('testing reports acknowledge each part and discard all progress, containers and review evidence', async t => {
  const f = await fixture(t, { betaAsLive: true });
  await f.toggle(true);
  const before = f.state(), disk = await readFile(path.join(f.dataDir, 'state.json'));
  assert.deepEqual((await f.send({ achievements: achievement(1, 2) })).achievements, { snapshot, received: 1, parts: 2 });
  assert.deepEqual((await f.send({ achievements: achievement(2, 2) })).achievements, { snapshot, received: 2, parts: 2 });
  const reply = await f.send({ items: { ...items([
    [1, itemId, 'Synthetic live journal', 'live'], [2, itemId, 'Synthetic beta journal', 'beta'],
    [3, itemId, 'Synthetic unknown journal', 'unknown'], [4, itemId, 'Synthetic legacy journal'],
  ], [[0, itemId, 1, 'Synthetic equipment'], [1, 995, 999, 'Synthetic coins']]),
    worn: [[0, itemId, 1, 'Synthetic worn equipment']], toolbelt: [['HATCHET', 1]], pouch: [[0, 995, 999, 'Synthetic pouch']] } });
  assert.deepEqual(reply.items, { snapshot, journal: { id: journalId, event: 4 } });
  assert.equal((await f.send({ bank: { snapshot, part: 1, parts: 2, age: 0, rows: [[itemId, 1]] } })).bank, null);
  assert.deepEqual((await f.send({ bank: { snapshot, part: 2, parts: 2, age: 0, rows: [[995, 1000]] } })).bank, { snapshot });
  await f.send({ skills: { ATTACK: { level: 50, xp: 101333 } } });
  await f.send({ quests: { finished: ['Synthetic quest'], started: [] } });
  await f.send({ diagnostics: ['Synthetic testing diagnostic'] });
  assert.deepEqual(f.state(), before, 'Only delivery bookkeeping changes, never the save');
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), disk);
  assert.equal(f.controller.progressSnapshot(before.members[0]), null);
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
  const backup = await f.store.backup(), evidence = backup.optionalSidecarEvidence.entries.pluginItems.players[player];
  assert.deepEqual(evidence.records, {});
  assert.deepEqual(evidence.commits.journals, [{ id: journalId, committed: 4, pending: [] }]);
  for (const filename of ['plugin-achievements.json', 'plugin-items.json', 'plugin-item-journal-beta.json', 'plugin-item-journal-unknown.json']) {
    await assert.rejects(readFile(path.join(f.dataDir, filename)), { code: 'ENOENT' });
  }
  assertDeclared(backup, []);
  await f.toggle(false);
  assert.deepEqual((await f.status()).achievements, { snapshot, received: 2, parts: 2 }, 'The plugin need not replay an acknowledged testing snapshot after disabling');
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null);
  await f.restart();
  assert.deepEqual(f.controller.review(admin, player), { preview: null }, 'There is no saved testing evidence to recover or apply');
});

function acknowledgedHold() {
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  return { entered: entered.promise, release: released.resolve,
    wait: () => { entered.resolve(); return released.promise; } };
}

async function assertHeldTestingReport(t, phase, body) {
  const hold = acknowledgedHold();
  const f = await fixture(t, { [phase]: hold.wait });
  await f.toggle(true);
  const before = f.state();
  const inFlight = f.send(body);
  try {
    await Promise.race([hold.entered, inFlight.then(() => { throw new Error('Report completed before the acknowledged hold.'); })]);
    await f.toggle(false);
  } finally { hold.release(); }
  await inFlight;
  await f.toggle(false);
  assert.equal(f.store.getPluginTestingMode(player), false);
  assert.deepEqual(f.state().members, before.members);
  assert.deepEqual(f.state().history, before.history);
  assert.deepEqual(f.state().provenance.pluginAutoHandled ?? {}, {});
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null);
  const evidence = (await f.store.backup()).optionalSidecarEvidence?.entries.pluginItems?.players[player];
  assert.equal(evidence?.records.live, undefined);
  if (body.items) {
    assert.deepEqual(evidence.records, {});
    assert.deepEqual(evidence.commits.journals, [{ id: journalId, committed: 1, pending: [] }]);
  }
}

test('a testing report held during body parsing stays quarantined after switching off', async t => {
  await assertHeldTestingReport(t, 'beforeBody', { achievements: achievement() });
  await assertHeldTestingReport(t, 'beforeBody', { items: items([[1, itemId, 'Synthetic held journal', 'live']],
    [[0, itemId, 1, 'Synthetic item'], [1, 995, 999, 'Synthetic coins']]) });
  await assertHeldTestingReport(t, 'beforeBody', { bank: { snapshot, part: 1, parts: 1, age: 0, rows: [[itemId, 1], [995, 1000]] } });
  await assertHeldTestingReport(t, 'beforeBody', { skills: { ATTACK: { level: 50, xp: 101333 } }, quests: { finished: ['Synthetic quest'], started: [] } });
});

test('a testing report held in the mutation queue stays quarantined after switching off', async t => {
  await assertHeldTestingReport(t, 'beforeMutation', { achievements: achievement() });
  await assertHeldTestingReport(t, 'beforeMutation', { items: items([[1, itemId, 'Synthetic held journal', 'live']],
    [[0, itemId, 1, 'Synthetic item'], [1, 995, 999, 'Synthetic coins']]) });
  await assertHeldTestingReport(t, 'beforeMutation', { bank: { snapshot, part: 1, parts: 1, age: 0, rows: [[itemId, 1], [995, 1000]] } });
  await assertHeldTestingReport(t, 'beforeMutation', { skills: { ATTACK: { level: 50, xp: 101333 } }, quests: { finished: ['Synthetic quest'], started: [] } });
});

test('multipart testing sets finish with counters only after disabling; fresh live sets still apply', async t => {
  const f = await fixture(t);
  await f.toggle(true);
  await f.send({ achievements: achievement(1, 2) });
  await f.send({ bank: { snapshot, part: 1, parts: 2, age: 0, rows: [[itemId, 1]] } });
  await f.toggle(false);
  const before = f.state();
  assert.equal((await f.send({ achievements: achievement(2, 2) })).achievements.received, 2);
  assert.deepEqual((await f.send({ bank: { snapshot, part: 2, parts: 2, age: 0, rows: [[995, 999]] } })).bank, { snapshot });
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
  await f.send({ achievements: { ...achievement(), snapshot: freshSnapshot } });
  assert.deepEqual(f.state().members[0].completedTasks, ['synthetic-diary']);
});

test('failed testing acknowledgements stay dropped after disabling until a successful reply; fresh live events work', async t => {
  for (const changedSnapshot of [false, true]) await t.test(changedSnapshot ? 'journal identity retry' : 'snapshot retry', async t => {
    const f = await fixture(t);
    await f.toggle(true);
    const blocked = path.join(f.dataDir, 'plugin-item-journal-commits.json');
    await mkdir(blocked);
    const report = { items: items([[1, itemId, 'Synthetic testing event', 'live']],
      [[0, itemId, 1, 'Synthetic testing equipment'], [1, 995, 999, 'Synthetic testing coins']]) };
    const before = f.state();
    await assert.rejects(f.send(report), { status: 503 });
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.controller.review(admin, player), { preview: null });
    await f.toggle(false);
    await rmdir(blocked);
    const beforeRetry = f.state();
    if (changedSnapshot) report.items.snapshot = freshSnapshot;
    assert.equal((await f.send(report)).items.journal.event, 1);
    assert.deepEqual(f.state(), beforeRetry, 'Neither retry containers, journal nor coins become live');
    assert.deepEqual(f.controller.review(admin, player), { preview: null });
    const evidence = (await f.store.backup()).optionalSidecarEvidence.entries.pluginItems.players[player];
    assert.deepEqual(evidence.records, {});
    assert.deepEqual(evidence.commits.journals, [{ id: journalId, committed: 1, pending: [] }]);
    await f.send({ items: { ...items([[2, itemId, 'Synthetic fresh live event', 'live']], [[0, 995, 456, 'Synthetic live coins']]), snapshot: 'bbbbbbbbbbbbbbbb' } });
    const after = f.state();
    assert.deepEqual(after.members[0].completedTasks, [goal]);
    assert.equal(after.members[0].transportFacts.currencies.coins, 456);
    assert.deepEqual(after.history.slice(beforeRetry.history.length).map(entry => entry.command.type), ['set-transport-facts', 'apply-game-progress']);
  });
});
test('a mixed retry drops only the original testing boundary and applies its new live journal suffix', async t => {
  for (const changedSnapshot of [false, true]) await t.test(changedSnapshot ? 'new snapshot' : 'testing snapshot', async t => {
    const f = await fixture(t);
    await f.toggle(true);
    const blocked = path.join(f.dataDir, 'plugin-item-journal-commits.json');
    await mkdir(blocked);
    const testingEvent = [1, 995, 'Synthetic testing event', 'live'];
    await assert.rejects(f.send({ items: items([testingEvent], [[0, 995, 999, 'Synthetic testing coins']]) }), { status: 503 });
    await f.toggle(false); await rmdir(blocked);
    const before = f.state();
    const reply = await f.send({ items: { ...items([testingEvent, [2, itemId, 'Synthetic new live equipment', 'live']],
      [[0, 995, 999, 'Synthetic retry coins']]), snapshot: changedSnapshot ? freshSnapshot : snapshot } });
    assert.equal(reply.items.journal.event, 2, 'Only a processed live suffix may be acknowledged beyond the testing boundary');
    assert.deepEqual(f.state().members[0].completedTasks, [goal]);
    assert.equal(f.state().members[0].transportFacts.currencies.coins, 123, 'Retry containers cannot publish testing coins');
    assert.deepEqual(f.state().history.slice(before.history.length).map(entry => entry.command.type), ['apply-game-progress']);
    const evidence = (await f.store.backup()).optionalSidecarEvidence.entries.pluginItems.players[player];
    assert.equal(evidence.records.live.items[995], undefined);
    assert.ok(evidence.records.live.items[itemId].wornAt, 'The fresh journal event supplies the worn evidence');
    assert.equal(evidence.records.unknown, undefined);
    assert.deepEqual(evidence.commits.journals, [{ id: journalId, committed: 2, pending: [] }]);
  });
});

test('filling the 32 unacknowledged testing snapshot slots fails closed until acknowledgement succeeds', async t => {
  const f = await fixture(t);
  await f.toggle(true);
  const blocked = path.join(f.dataDir, 'plugin-item-journal-commits.json');
  await mkdir(blocked);
  const event = [1, 995, 'Synthetic testing event', 'live'];
  for (let index = 0; index < 32; index++) {
    await assert.rejects(f.send({ items: { ...items([event]), snapshot: index.toString(16).padStart(16, '0') } }), { status: 503 });
  }
  await f.toggle(false);
  const before = f.state();
  await f.send({ skills: { ATTACK: { level: 50, xp: 101333 } }, quests: { finished: ['Synthetic quest'], started: [] } });
  await assert.rejects(f.send({ items: { ...items([], [[0, itemId, 1, 'Synthetic unsafe equipment'], [1, 995, 999, 'Synthetic unsafe coins']]),
    snapshot: freshSnapshot } }), { status: 503 });
  assert.deepEqual(f.state(), before, 'Unrecorded snapshot IDs still cannot publish any non-journal progress');
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null);
  await rmdir(blocked);
  assert.equal((await f.send({ items: items([event]) })).items.journal.event, 1);
  await f.send({ items: { ...items([[2, itemId, 'Synthetic new live equipment', 'live']], [[0, 995, 456, 'Synthetic live coins']]), snapshot: freshSnapshot } });
  assert.deepEqual(f.state().members[0].completedTasks, [goal]);
  assert.equal(f.state().members[0].transportFacts.currencies.coins, 456, 'Successful acknowledgement releases the overflow quarantine');
});

async function seedFullLedger(f) {
  await f.close();
  const commits = await openPluginJournalCommits({ dataDir: f.dataDir, members: () => f.state().members });
  try { await commits.put(player, { journals: [{ id: journalId, committed: 0,
    pending: Array.from({ length: 256 }, (_, index) => [index + 1, 995, 'Synthetic pending coins', 'unknown']) }] }); }
  finally { await commits.close(); }
  await f.restart();
}

test('testing drops event 257 through the existing acknowledgement ledger without a capacity deadlock', async t => {
  const f = await fixture(t);
  await f.toggle(true); await seedFullLedger(f);
  const before = f.state(), previousReview = f.controller.review(admin, player);
  assert.equal((await f.send({ items: items([[257, itemId, 'Synthetic discarded suffix', 'live']]) })).items.journal.event, 257);
  const entry = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-item-journal-commits.json'))).players[player].journals[0];
  assert.deepEqual(entry, { id: journalId, committed: 257, pending: [] });
  assert.deepEqual(f.state(), before);
  assert.deepEqual(f.controller.review(admin, player), previousReview, 'The discarded report adds no evidence to the existing retention notice');
  await f.toggle(false);
  await f.send({ items: { ...items([[258, itemId, 'Synthetic live successor', 'live']]), snapshot: freshSnapshot } });
  assert.deepEqual(f.state().members[0].completedTasks, [goal]);
});

test('a full live ledger drains its durable 256 events before accepting the overflow suffix on redelivery', async t => {
  const f = await fixture(t);
  await seedFullLedger(f);
  const report = { items: items([[257, itemId, 'Synthetic queued suffix', 'live']]) };
  assert.equal((await f.send(report)).items.journal.event, 256);
  const entry = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-item-journal-commits.json'))).players[player].journals[0];
  assert.deepEqual(entry, { id: journalId, committed: 256, pending: [] });
  assert.deepEqual(f.state().members[0].completedTasks, [], 'The unaccepted suffix has not supplied evidence');
  assert.equal((await f.send(report)).items.journal.event, 257);
  assert.deepEqual(f.state().members[0].completedTasks, [goal]);
});

test('mode is per-player, defaults off, and mode off retains live ticks, currency and skill review', async t => {
  const f = await fixture(t);
  assert.equal(f.store.getPluginTestingMode(player), false);
  await f.toggle(true);
  await f.send({ achievements: achievement() }, partner);
  assert.deepEqual(f.state().members[1].completedTasks, ['synthetic-diary']);
  await f.toggle(false);
  await f.send({ achievements: achievement() });
  await f.send({ items: items([], [[0, itemId, 1, 'Synthetic item'], [1, 995, 456, 'Synthetic coins']]) });
  await f.send({ skills: { ATTACK: { level: 2, xp: 90 } } });
  const state = f.state();
  assert.deepEqual(new Set(state.members[0].completedTasks), new Set(['synthetic-diary', goal]));
  assert.equal(state.members[0].transportFacts.currencies.coins, 456);
  assert.equal(f.controller.review(admin, player).skills.length, 1);
  assert.equal(f.controller.progressSnapshot(state.members[0]).skills[0].level, 2);
  assert.deepEqual(state.provenance.pluginAutoHandled[player], { achievements: [1], items: [goal] });
  await f.toggle(true);
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null);
  await f.toggle(false);
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null, 'Prior skill observations cannot cross the testing boundary');
});

test('testing mode also blocks automatic matches from previously retained live evidence', async t => {
  const hold = acknowledgedHold();
  let holdNext = false;
  const f = await fixture(t, { beforeMutation: () => holdNext ? hold.wait() : undefined });
  await f.close();
  const records = await openPluginItems({ dataDir: f.dataDir, members: () => f.state().members });
  try { await records.put(player, { baselineAt: at, items: { [itemId]: { name: 'Synthetic retained item', ownedAt: at, wornAt: null, first: true } }, handled: [], journal: null }); }
  finally { await records.close(); }
  await f.restart(); await f.toggle(true);
  const before = f.state();
  await f.send({ items: items() });
  await f.send({ bank: { snapshot, part: 1, parts: 1, age: 0, rows: [] } });
  assert.deepEqual(f.state().members, before.members);
  assert.deepEqual(f.state().history, before.history);
  holdNext = true;
  const inFlight = f.send({ items: items() });
  try { await hold.entered; await f.toggle(false); }
  finally { hold.release(); }
  await inFlight;
  assert.deepEqual(f.state().members, before.members);
  assert.deepEqual(f.state().history, before.history);
});

test('only the player or an administrator can change testing mode; viewers and other players cannot', async t => {
  const f = await fixture(t);
  assert.equal(routePermissions.POST['/api/game-plugin/testing-mode'], 'write');
  await assert.rejects(f.toggle(true, { memberId: partner }), { status: 403 });
  await assert.rejects(f.toggle(true, { admin: true, readOnly: true }), { status: 403 });
  await assert.rejects(f.controller.setTestingMode(admin, { memberId: player, enabled: 'true', expectedRevision: 0 }), { status: 400 });
  await assert.rejects(f.controller.setTestingMode(admin, { memberId: player, enabled: true, expectedRevision: 1 }));
  await f.toggle(true, admin);
  assert.equal(f.controller.list(admin).testingModes[player], true);
  await f.toggle(false);
  assert.equal(f.controller.list(admin).testingModes?.[player] ?? false, false);
});

function observeCalculationReads(store) {
  const original = store.getCalculationSnapshot;
  let captures = 0, materializations = 0;
  store.getCalculationSnapshot = () => {
    captures++;
    return new Proxy(original(), { get(target, key, receiver) {
      if (key === 'state') { materializations++; throw new Error('Testing-mode refresh materialized calculation state.'); }
      return Reflect.get(target, key, receiver);
    } });
  };
  return { get captures() { return captures; }, get materializations() { return materializations; },
    restore() { store.getCalculationSnapshot = original; } };
}

test('save subscribers capture nothing and lazy testing refresh uses only metadata before listing status or cached progress', async t => {
  const f = await fixture(t);
  await f.send({ skills: { ATTACK: { level: 2, xp: 90 } } });
  const owner = f.state().members[0];
  assert.equal(f.controller.progressSnapshot(owner).skills[0].level, 2);
  const reads = observeCalculationReads(f.store);
  try {
    await f.store.command({ type: 'set-note', memberId: player, chunkId: '100', note: 'Synthetic metadata refresh' }, f.store.getInfo().revision);
    assert.equal(reads.captures, 0);
    await f.store.setPluginTestingMode(player, true, f.store.getInfo().revision);
    assert.equal(reads.captures, 0);
    assert.equal(f.controller.list(admin).testingModes[player], true);
    assert.equal(reads.captures, 1);
    assert.equal(f.controller.progressSnapshot(owner), null);
    assert.equal(reads.captures, 1, 'A clean mode cache needs no further snapshots');
    await f.store.setPluginTestingMode(player, false, f.store.getInfo().revision);
    assert.equal(reads.captures, 1);
    assert.equal(f.controller.list(admin).testingModes?.[player] ?? false, false);
    assert.equal(reads.captures, 2);
    assert.equal(f.controller.progressSnapshot(owner), null, 'Listing status cleared the prior skill observation');
    assert.equal(reads.captures, 2);
    assert.equal(reads.materializations, 0);
  } finally { reads.restore(); }
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
});

test('restored testing-mode flips clear cached progress and partial reports lazily before the next report even when the final mode matches', async t => {
  const f = await fixture(t), off = await f.store.backup();
  await f.toggle(true);
  const on = await f.store.backup();
  await f.toggle(false);
  await f.send({ skills: { ATTACK: { level: 2, xp: 90 } } });
  await f.send({ achievements: achievement(1, 2) });
  await f.send({ bank: { snapshot, part: 1, parts: 2, age: 0, rows: [[itemId, 1]] } });
  assert.equal(f.controller.progressSnapshot(f.state().members[0]).skills[0].level, 2);
  const reads = observeCalculationReads(f.store);
  try {
    await f.store.replace(on, f.store.getInfo().revision);
    await f.store.replace(off, f.store.getInfo().revision);
    assert.equal(reads.captures, 0, 'Restore subscribers must defer all calculation reads too');
    assert.equal(reads.materializations, 0);
  } finally { reads.restore(); }
  assert.equal(f.store.getPluginTestingMode(player), false);
  const before = f.state();
  const achievementReply = await f.send({ achievements: achievement(2, 2) });
  assert.equal(achievementReply.achievements, null, 'A pre-restore partial set cannot complete');
  const bankReply = await f.send({ bank: { snapshot, part: 2, parts: 2, age: 0, rows: [[995, 999]] } });
  assert.equal(bankReply.bank, null, 'A pre-restore bank assembly cannot complete');
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null);
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
  assert.deepEqual(f.state().members, before.members);
  assert.deepEqual(f.state().history, before.history);
});

test('unchanged testing settings do not write metadata, including untouched whole and member restores', async t => {
  const f = await fixture(t), before = f.state(), backup = await f.store.backup();
  assert.equal(withPluginTestingMode(before, player, false), before);
  const enabled = withPluginTestingMode(before, player, true);
  assert.equal(withPluginTestingMode(enabled, player, true), enabled);
  assert.equal(withPluginTestingMode(enabled, partner, false), enabled);
  const disk = await readFile(path.join(f.dataDir, 'state.json'));
  let events = 0;
  const unsubscribe = f.store.subscribe(() => { events++; });
  try { await f.toggle(false); }
  finally { unsubscribe(); }
  assert.equal(events, 0);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), disk);
  assert.deepEqual(f.state(), before);
  assert.doesNotMatch(JSON.stringify(backup), /"pluginTesting(?:Mode|Watermarks)"/);
  await f.store.replace(backup, f.store.getInfo().revision);
  assert.doesNotMatch(JSON.stringify(await f.store.backup()), /"pluginTesting(?:Mode|Watermarks)"/);
  const reviewed = await f.store.prepareTransfer(serialize({ backup, memberId: player, sourceMemberId: player }),
    { route: '/api/member-restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() } });
  await f.store.applyTransfer(reviewed.ticket, f.store.getInfo().revision);
  assert.doesNotMatch(JSON.stringify(await f.store.backup()), /"pluginTesting(?:Mode|Watermarks)"/);
});

test('array and other non-plain provenance stay intact and enabling testing is refused with 409', async t => {
  const f = await fixture(t, { provenance: ['synthetic'] }), before = f.state();
  assert.deepEqual(before.provenance, ['synthetic']);
  assert.equal(withPluginTestingMode(before, player, false), before);
  assert.throws(() => withPluginTestingMode({ ...before, provenance: 'synthetic' }, player, true), { status: 409 });
  const disk = await readFile(path.join(f.dataDir, 'state.json'));
  await f.toggle(false);
  await assert.rejects(f.toggle(true), error => error.status === 409 && /provenance.*plain object/i.test(error.message));
  assert.deepEqual(f.state(), before);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), disk);
  assert.deepEqual((await f.store.backup()).state.provenance, ['synthetic']);
  const mapped = mapTransferRoster(before, before.members, { [player]: player, [partner]: partner });
  assert.deepEqual(mapped.provenance, ['synthetic']);
});

test('whole-save testing settings survive disk, export and mapped transfer while member imports keep destination settings', async t => {
  const f = await fixture(t);
  const off = await f.store.backup();
  await f.toggle(true);
  await f.send({ items: items([[1, itemId, 'Synthetic discarded portable event', 'live']]) });
  await f.restart();
  assert.equal(f.store.getPluginTestingMode(player), true);
  const backup = await f.store.backup();
  assertDeclared(backup, []);
  assert.equal(backup.schemaVersion, 1);
  assert.equal(pluginTestingMode(importBackup(backup), player), true);
  const mapped = mapTransferRoster(importBackup(backup), [{ id: 'target', name: 'Explorer' }, { id: 'other', name: 'Other' }],
    { [player]: 'target', [partner]: 'other' });
  assert.deepEqual(pluginTestingSettings(mapped), { target: true });
  await f.toggle(false);
  await f.store.replace(backup, f.store.getInfo().revision);
  assert.equal(f.store.getPluginTestingMode(player), true);
  await f.send({ items: { ...items([[2, itemId, 'Synthetic discarded destination event', 'live']]), snapshot: freshSnapshot } });
  await f.toggle(false);
  await f.toggle(true, admin, partner);
  const reviewed = await f.store.prepareTransfer(serialize({ backup, memberId: player, sourceMemberId: player }),
    { route: '/api/member-restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() } });
  await f.store.applyTransfer(reviewed.ticket, f.store.getInfo().revision);
  assert.equal(f.store.getPluginTestingMode(player), false, 'An enabled source must not turn on the destination setting');
  assert.equal(f.store.getPluginTestingMode(partner), true);
  await f.toggle(true);
  const disabledSource = await f.store.prepareTransfer(serialize({ backup: off, memberId: player, sourceMemberId: player }),
    { route: '/api/member-restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() } });
  await f.store.applyTransfer(disabledSource.ticket, f.store.getInfo().revision);
  assert.equal(f.store.getPluginTestingMode(player), true, 'A default-off source must not turn off the destination setting');
  assert.equal(f.store.getPluginTestingMode(partner), true);
});

test('the exact frozen runtime preserves testing metadata, chunks, ticks, History and Undo while ignoring the switch', async t => {
  const f = await fixture(t), frozen = await frozenRuntime(t);
  await f.store.command({ type: 'set-chunk', memberId: player, chunkId: '100', status: 'unlocked' }, 0);
  await f.store.command({ type: 'complete-task', memberId: player, taskId: 'synthetic-diary', completed: true }, 1);
  await f.toggle(true);
  await f.send({ items: items([[1, itemId, 'Synthetic discarded frozen event', 'live']]) });
  await f.store.command({ type: 'set-note', memberId: player, chunkId: '100', note: 'Synthetic Undo sentinel' }, 2);
  const before = f.state(); await f.close();
  const old = await frozen.openStore({ dataDir: f.dataDir, retention: false, now: () => at });
  try {
    const loaded = old.getState();
    assert.equal(pluginTestingMode(loaded, player), true);
    assert.equal(old.getPluginTestingMode, undefined, 'The frozen receiver has no testing-mode enforcement');
    assert.deepEqual(loaded.members, before.members); assert.deepEqual(loaded.history, before.history);
    const undone = await old.command({ type: 'undo' }, loaded.revision);
    assert.deepEqual(undone.members[0].unlocked, ['100']);
    assert.deepEqual(undone.members[0].completedTasks, ['synthetic-diary']);
    assert.equal(undone.members[0].notes?.['100'], undefined);
    assert.equal(pluginTestingMode(frozen.core.importBackup(frozen.core.exportBackup(undone)), player), true);
  } finally { await old.close(); }
});

test('malformed optional testing metadata never vetoes starting, restoring or exporting', async t => {
  const f = await fixture(t);
  const backup = await f.store.backup();
  backup.state.provenance = { ...backup.state.provenance, pluginTestingMode: 'unusable optional data' };
  await f.store.replace(backup, f.store.getInfo().revision); await f.restart();
  assert.equal(f.store.getPluginTestingMode(player), false);
  assert.equal((await f.store.backup()).schemaVersion, 1);
  const archived = { ...f.state(), provenance: { restore: { incomingProvenance: { pluginTestingMode: { [player]: true } } } } };
  assert.equal(pluginTestingMode(archived, player), true);
});
