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
import { openPluginItems } from '../app/plugin-items.mjs';
import { mapTransferRoster } from '../app/save-transfer.mjs';
import { routePermissions } from '../app/picker-context-http.mjs';
import { scratch } from './helpers/save-surface-corpus.mjs';
import { assertDeclared } from './helpers/save-surface.mjs';
import { frozenRuntime } from './helpers/frozen-release.mjs';

const at = '2026-11-01T12:00:00.000Z', admin = { admin: true };
const player = 'synthetic-one', partner = 'synthetic-two';
const snapshot = '0123456789abcdef', journalId = 'aaaaaaaaaaaaaaaa';
const itemId = 857, goal = GAME_ITEMS.get(itemId).goalId;
const tasks = [{ id: 'synthetic-diary', category: 'Diary', label: '~|Synthetic#Easy|~ Synthetic achievement' },
  { id: goal, category: 'BiS', label: 'Obtain synthetic equipment' },
  { id: 'synthetic-quest', category: 'Quest', label: 'Synthetic quest' }];
const achievement = (part = 1, parts = 1) => ({ snapshot, part, parts, complete: part === 1 ? [[1, 'Synthetic achievement', 0, 0]] : [] });
const items = (events = [], backpack = []) => ({ snapshot, worn: [], backpack, pouch: [], journal: { id: journalId, events } });

async function fixture(t, { betaAsLive = false, beforeBody = async () => {}, beforeMutation = async () => {}, provenance } = {}) {
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
      now: () => new Date(now).toISOString(), taskCatalogue: catalogue });
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

test('testing mode quarantines live achievements, containers, toolbelt, bank and journals without ticks or live evidence', async t => {
  const f = await fixture(t, { betaAsLive: true });
  await f.toggle(true);
  const before = f.state();
  await f.send({ achievements: achievement() });
  await f.send({ items: { ...items([[1, itemId, 'Synthetic journal item', 'live']], [[0, itemId, 1, 'Synthetic item'], [1, 995, 999, 'Synthetic coins']]), toolbelt: [] } });
  await f.send({ bank: { snapshot, part: 1, parts: 1, age: 0, rows: [[itemId, 1], [995, 1000]] } });
  await f.send({ skills: { ATTACK: { level: 50, xp: 101333 } }, quests: { finished: ['Synthetic quest'], started: [] } });
  const after = f.state();
  assert.deepEqual(after.members, before.members);
  assert.deepEqual(after.history, before.history);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.provenance.pluginAutoHandled ?? {}, {});
  assert.equal(f.controller.progressSnapshot(after.members[0]), null);
  const review = f.controller.review(admin, player);
  assert.equal(review.achievements[0].world, 'unknown');
  assert.ok(review.items.some(row => row.taskId === goal && row.world === 'unknown'));
  assert.deepEqual(review.skills, []); assert.deepEqual(review.quests, []);
  assert.throws(() => f.controller.findReview(admin, { previewId: review.previewId, expectedRevision: after.revision }, true), { status: 409 });
  const backup = await f.store.backup();
  const evidence = backup.optionalSidecarEvidence.entries.pluginItems.players[player];
  assert.equal(evidence.records.live, undefined);
  assert.deepEqual(evidence.records.unknown.handled, []);
  assert.deepEqual(evidence.commits.journals, [{ id: journalId, committed: 1, pending: [] }]);
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-achievements.json')), { code: 'ENOENT' });
  assertDeclared(backup, []);
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
  assert.equal(f.store.getPluginTestingMode(player), false);
  assert.deepEqual(f.state().members, before.members);
  assert.deepEqual(f.state().history, before.history);
  assert.deepEqual(f.state().provenance.pluginAutoHandled ?? {}, {});
  assert.equal(f.controller.progressSnapshot(f.state().members[0]), null);
  const evidence = (await f.store.backup()).optionalSidecarEvidence?.entries.pluginItems?.players[player];
  assert.equal(evidence?.records.live, undefined);
  if (body.items) {
    assert.ok(evidence.records.unknown.items[itemId]);
    assert.deepEqual(evidence.records.unknown.handled, []);
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

test('turning testing mode off and restarting never replays testing journal evidence or incomplete assemblies', async t => {
  const f = await fixture(t);
  await f.toggle(true);
  await f.send({ achievements: achievement(1, 2) });
  await f.send({ items: { ...items([[1, itemId, 'Synthetic journal item', 'live']]), worn: null, backpack: null } });
  await f.toggle(false);
  assert.deepEqual(f.controller.review(admin, player), { preview: null });
  await f.send({ achievements: achievement(2, 2) });
  await f.restart();
  const reply = await f.send({ items: items([[1, itemId, 'Synthetic journal item', 'live']], [[0, 995, 123, 'Synthetic coins']]) });
  assert.equal(reply.items.journal.event, 1);
  assert.deepEqual(f.state().members[0].completedTasks, []);
  assert.deepEqual(f.state().history, []);
  const evidence = (await f.store.backup()).optionalSidecarEvidence.entries.pluginItems.players[player];
  assert.deepEqual(evidence.records.live?.items ?? {}, {});
  assert.ok(evidence.records.unknown.items[itemId]);
  assert.deepEqual(f.state().provenance.pluginAutoHandled ?? {}, {});
});

test('a failed testing journal intent write rejects without evidence and its durable quarantine survives an off-toggle and restart', async t => {
  const f = await fixture(t);
  await f.toggle(true);
  const before = f.state(), blocked = path.join(f.dataDir, 'plugin-item-journal-commits.json');
  await mkdir(blocked);
  const report = { items: items([[1, itemId, 'Synthetic unacknowledged item', 'live']]) };
  await assert.rejects(f.send(report), { status: 503 });
  assert.deepEqual(f.state().members, before.members);
  assert.deepEqual(f.state().history, before.history);
  assert.equal(f.controller.review(admin, player).preview, null);
  assert.equal((await f.status()).items?.journal?.event ?? 0, 0);
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-item-journal-unknown.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.dataDir, 'plugin-items.json')), { code: 'ENOENT' });
  const backup = await f.store.backup();
  const retained = backup.state.provenance.pluginItemEvidence.players[player];
  assert.deepEqual(retained.records, {});
  assert.deepEqual(retained.commits.journals[0].pending, [[1, itemId, 'Synthetic unacknowledged item', 'unknown']]);
  assertDeclared(backup, []);
  await f.restart();
  await f.store.replace(backup, f.store.getInfo().revision);
  await rmdir(blocked);
  await f.toggle(false); await f.restart();
  const beforeRetry = f.state();
  const reply = await f.send({ items: { ...report.items, backpack: [[0, 995, 123, 'Synthetic coins']] } });
  assert.equal(reply.items.journal.event, 1);
  assert.deepEqual(f.state().members, beforeRetry.members);
  assert.deepEqual(f.state().history, beforeRetry.history);
  assert.deepEqual(f.state().provenance.pluginAutoHandled ?? {}, {});
  const evidence = (await f.store.backup()).optionalSidecarEvidence.entries.pluginItems.players[player];
  assert.deepEqual(evidence.records.live?.items ?? {}, {});
  assert.ok(evidence.records.unknown.items[itemId]);
  assert.deepEqual(evidence.commits.journals[0].pending, []);
  assert.deepEqual(f.state().provenance.pluginItemEvidence.players[player].commits.journals[0].pending, []);
});

test('failed testing journal retention leaves only non-live pending events which drain safely after switching off', async t => {
  const f = await fixture(t);
  await f.toggle(true);
  const blocked = path.join(f.dataDir, 'plugin-item-journal-unknown.json');
  await mkdir(blocked);
  const reply = await f.send({ items: items([[1, itemId, 'Synthetic pending item', 'live']]) });
  assert.equal(reply.items.journal?.event ?? 0, 0);
  const pending = JSON.parse(await readFile(path.join(f.dataDir, 'plugin-item-journal-commits.json'), 'utf8'));
  assert.equal(pending.players[player].journals[0].pending[0][3], 'unknown');
  await rmdir(blocked);
  await f.toggle(false); await f.restart();
  await f.send({ items: items([[1, itemId, 'Synthetic pending item', 'live']], [[0, 995, 123, 'Synthetic coins']]) });
  assert.deepEqual(f.state().members[0].completedTasks, []);
  assert.deepEqual(f.state().history, []);
  const evidence = (await f.store.backup()).optionalSidecarEvidence.entries.pluginItems.players[player];
  assert.deepEqual(evidence.records.live?.items ?? {}, {});
  assert.deepEqual(evidence.commits.journals[0].pending, []);
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
  assert.doesNotMatch(JSON.stringify(backup), /"pluginTestingMode"/);
  await f.store.replace(backup, f.store.getInfo().revision);
  assert.doesNotMatch(JSON.stringify(await f.store.backup()), /"pluginTestingMode"/);
  const reviewed = await f.store.prepareTransfer(serialize({ backup, memberId: player, sourceMemberId: player }),
    { route: '/api/member-restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() } });
  await f.store.applyTransfer(reviewed.ticket, f.store.getInfo().revision);
  assert.doesNotMatch(JSON.stringify(await f.store.backup()), /"pluginTestingMode"/);
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
  await f.toggle(true); await f.restart();
  assert.equal(f.store.getPluginTestingMode(player), true);
  const backup = await f.store.backup();
  assert.equal(backup.schemaVersion, 1);
  assert.equal(pluginTestingMode(importBackup(backup), player), true);
  const mapped = mapTransferRoster(importBackup(backup), [{ id: 'target', name: 'Explorer' }, { id: 'other', name: 'Other' }],
    { [player]: 'target', [partner]: 'other' });
  assert.deepEqual(pluginTestingSettings(mapped), { target: true });
  await f.toggle(false);
  await f.store.replace(backup, f.store.getInfo().revision);
  assert.equal(f.store.getPluginTestingMode(player), true);
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
