// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { createGroupState, importBackup } from '../app/core/state.mjs';
import { pluginTestingMode, pluginTestingSettings } from '../app/core/plugin-testing.mjs';
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

async function fixture(t, { betaAsLive = false } = {}) {
  let store, controller, input, output, seq = 0;
  const close = async () => { try { await controller?.close(); } finally { await store?.close(); } };
  // Hooks run in registration order: close writers before scratch removes files.
  t.after(close);
  const dataDir = await scratch(t, 'testing-mode');
  const initialState = createGroupState([{ id: player, name: 'Explorer 1' }, { id: partner, name: 'Explorer 2' }]);
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
      serializeMutation: operation => operation(), bodyJSON: async () => input,
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
  assert.equal(after.provenance.pluginAutoHandled, undefined);
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
  assert.equal(f.state().provenance.pluginAutoHandled, undefined);
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
  const f = await fixture(t);
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

test('testing settings survive disk, export, mapped transfer, whole restore and member restore', async t => {
  const f = await fixture(t);
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
  assert.equal(f.store.getPluginTestingMode(player), true);
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
    assert.equal(undone.members[0].notes['100'], undefined);
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
