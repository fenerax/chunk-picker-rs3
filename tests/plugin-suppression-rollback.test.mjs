// @test full solo dataset=default
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from '../app/storage/store.mjs';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { deployStopped } from '../scripts/linux/operator.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { frozenRuntime } from './helpers/frozen-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let checkout, frozenStore, frozenPlugin;
before(async () => {
  const frozen = await frozenRuntime({ after });
  checkout = frozen.checkout; frozenStore = frozen.openStore;
  ({ openGamePlugin: frozenPlugin } = await import(pathToFileURL(path.join(checkout, 'app/game-plugin.mjs'))));
});

const itemTask = 'rs3:goal:equipment:000dc1', achievementTask = 'diary:synthetic';
const tasks = [{ id: itemTask, category: 'BiS', label: 'Obtain a Yew shortbow' },
  { id: achievementTask, category: 'Diary', label: '~|Synthetic Achievements#Easy|~ First Task' }];
const identity = { admin: true }, now = '2026-11-01T12:00:00.000Z';
const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });

async function runStartGate(dataDir) {
  const controlDir = await mkdtemp(path.join(root, '.local', 'synthetic-start-control-'));
  try { await checkStart({ dataDir, controlDir }); }
  catch (error) { throw error.cause ?? error; }
  finally { await rm(controlDir, { recursive: true, force: true }); }
}

async function failedSidecarWindow(t, kind, { directory, legacy = false, atomic = false } = {}) {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = directory ?? await mkdtemp(path.join(root, '.local', 'rollback-suppression-test-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer' }]); initialState.tasks = tasks;
  if (atomic) initialState.provenance = { pluginAutoHandled: { owner: { items: ['custom:atomic'], achievements: [98] } } };
  const catalogue = new Map(tasks.map(row => [row.id, row]));
  let store = await (legacy ? frozenStore : openStore)({ dataDir, initialState, taskCatalogue: catalogue, retention: false, now: () => now });
  let activeDir = dataDir, activeMember = 'owner';
  let controller, input, seq = 0;
  t.after(async () => { await controller?.close(); await store?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const file = path.join(dataDir, `plugin-${kind}.json`), held = file + '.synthetic-held';
  const previous = kind === 'items' ? { baselineAt: now, items: {}, handled: ['custom:previous'],
    journal: { id: 'aaaaaaaaaaaaaaaa', event: 0 }, bank: { snapshot: 'bbbbbbbbbbbbbbbb', seenAt: now, coins: 0 } } : { handled: [99] };
  await writeFile(file, JSON.stringify({ v: 1, players: { owner: previous } }));
  async function openController(open) {
    controller = await open({ dataDir: activeDir, store, clock: () => Date.parse(now), world: { chunks: new Map() },
      registry: { resolve: () => ({}) }, questMapping: new Map(), taskCatalogue: () => tasks,
      serializeMutation: operation => operation(), bodyJSON: async () => input,
      json: async (_request, _response, status) => assert.equal(status, 200), checkRequestOrigin: () => {}, log: () => {} });
    return (await controller.create(identity, { memberId: activeMember, label: 'Synthetic plugin' })).key;
  }
  async function send(key) {
    input = { v: 1, seq: ++seq, sentAt: now, position: { x: 50, z: 50, floor: 0 }, world: { id: 1, beta: false },
      ...(kind === 'items' ? { items: { snapshot: '0123456789abcdef', worn: [], backpack: [[0, 857, 1, 'Yew shortbow']],
        journal: { id: 'aaaaaaaaaaaaaaaa', events: [] } } }
        : { achievements: { snapshot: '0123456789abcdef', part: 1, parts: 1, complete: [[1, 'First Task', 0, 0]] } }) };
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
    await controller.handle(request, {}, { route: request.url, security: {} });
  }
  const key = await openController(legacy ? frozenPlugin : openGamePlugin), command = store.command;
  store.command = async (...args) => {
    const result = await command(...args);
    if (!legacy && args[0].type === 'apply-game-progress') { await rename(file, held); await mkdir(file); }
    return result;
  };
  await send(key);
  assert.equal(store.getInfo().revision, 1);
  const taskId = kind === 'items' ? itemTask : achievementTask;
  assert.ok(store.getState().members[0].completedTasks.includes(taskId));
  if (legacy) await store.command({ type: 'undo' }, store.getInfo().revision);
  await controller.close(); controller = null; // Keep writes failing THROUGH shutdown.
  await store.close(); store = null;
  const retained = JSON.parse(await readFile(legacy ? file : held, 'utf8')).players.owner;
  return { dataDir, file, held, previous: retained, taskId,
    close: async () => { await controller?.close(); controller = null; await store?.close(); store = null; },
    repair: async () => { await rm(file, { recursive: true }); await rename(held, file); },
    replayFrozen: async ({ target = dataDir, memberId = 'owner', undo = true, current = false } = {}) => {
      activeDir = target; activeMember = memberId;
      store = await (current ? openStore : frozenStore)({ dataDir: target, retention: false, taskCatalogue: catalogue, now: () => now });
      if (undo) await store.command({ type: 'undo' }, store.getInfo().revision);
      const revision = store.getInfo().revision;
      const legacyKey = await openController(current ? openGamePlugin : frozenPlugin);
      await send(legacyKey);
      assert.equal(store.getInfo().revision, revision, 'Current controller must not author a new tick after owner Undo');
      assert.deepEqual(store.getState().members[0].completedTasks, []);
    } };
}

for (const kind of ['items', 'achievements']) {
  test(`current owner Undo never re-ticks ${kind} while its sidecar remains unavailable`, async t => {
    const f = await failedSidecarWindow(t, kind);
    await runStartGate(f.dataDir);
    await f.replayFrozen({ current: true });
    await f.close();
    await f.replayFrozen({ current: true, undo: false });
    await f.close();
  });

  test(`emergency frozen rollback keeps ${kind} ticks, chunks, History and Undo despite lost replay policy`, async t => {
    const f = await failedSidecarWindow(t, kind);
    // Frozen release cannot read an inaccessible optional sidecar. An operator
    // may omit it during emergency recovery; gameplay must remain intact.
    await rm(f.file, { recursive: true });
    await runStartGate(f.dataDir);
    const store = await frozenStore({ dataDir: f.dataDir, retention: false, world });
    try {
      const state = store.getState();
      assert.ok(state.members[0].completedTasks.includes(f.taskId));
      assert.equal(state.history.at(-1).type, 'apply-game-progress');
      await store.command({ type: 'set-chunk', memberId: 'owner', chunkId: '12341', status: 'unlocked' }, state.revision);
      assert.ok(store.getState().members[0].unlocked.includes('12341'));
      await store.command({ type: 'undo' }, store.getInfo().revision);
      assert.ok(!store.getState().members[0].unlocked.includes('12341'));
      await store.command({ type: 'undo' }, store.getInfo().revision);
      assert.deepEqual(store.getState().members[0].completedTasks, []);
      assert.ok(store.getState().history.some(row => row.type === 'apply-game-progress'));
    } finally { await store.close(); }
  });

  test(`current ${kind} Undo survives portable restore and mapped member transfer`, async t => {
    const f = await failedSidecarWindow(t, kind);
    await f.replayFrozen({ current: true }); await f.close();
    const source = await openStore({ dataDir: f.dataDir, retention: false });
    let portable;
    try { portable = await source.backup(); } finally { await source.close(); }
    const directory = await mkdtemp(path.join(root, '.local', 'current-replay-transfer-'));
    const initialState = createGroupState([{ id: 'partner', name: 'Explorer' }]); initialState.tasks = tasks;
    const destination = await openStore({ dataDir: directory, initialState, retention: false });
    t.after(async () => { await destination.close(); await rm(directory, { recursive: true, force: true }); });
    const result = await destination.prepareTransfer(serialize({ backup: portable, memberId: 'partner', sourceMemberId: 'owner' }),
      { dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() }, route: '/api/member-restore/preview' });
    await destination.applyTransfer(result.ticket, 0);
    await destination.close();
    await f.replayFrozen({ target: directory, memberId: 'partner', current: true, undo: false });
    await f.close();
  });
}
for (const carrier of ['atomic', 'capsule', 'items-capsule']) for (const kind of carrier === 'items-capsule' ? ['items'] : ['items', 'achievements']) {
  test(`real frozen restore recovers archived ${carrier} ${kind} decisions before startup and replay`, async t => {
    // Registered item evidence comes from a real legacy controller, which writes
    // its handled decision only to the sidecar. Current ticks need no lowering.
    const legacy = carrier === 'items-capsule';
    const f = await failedSidecarWindow(t, kind, { legacy });
    if (!legacy) {
      await f.repair();
      await f.replayFrozen({ current: true }); // Owner Undo is part of the source save.
    }
    await f.close();
    const source = await openStore({ dataDir: f.dataDir, retention: false });
    let portable;
    try { portable = await source.backup(); } finally { await source.close(); }
    const players = portable.state.provenance.pluginAutoHandled;
    portable.state.provenance = carrier === 'atomic' ? { pluginAutoHandled: players } : {
      optionalSidecarEvidence: { schemaVersion: 1, entries: carrier === 'capsule'
        ? { pluginReplaySuppression: { version: 1, players } }
        : { pluginItems: portable.optionalSidecarEvidence.entries.pluginItems } } };
    delete portable.optionalSidecarEvidence; // Exercise only the selected state carrier.
    const destination = await mkdtemp(path.join(root, '.local', 'frozen-archive-replay-'));
    t.after(() => rm(destination, { recursive: true, force: true }));
    const old = await frozenStore({ dataDir: destination, initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]), retention: false });
    try { await old.replace(portable, 0); } finally { await old.close(); }
    const disk = JSON.parse(await readFile(path.join(destination, 'state.json')));
    assert.ok(disk.state.provenance.restore.incomingProvenance);
    assert.equal(disk.state.provenance.pluginAutoHandled, undefined);
    // Reopen independently, with no gate-produced legacy carrier to hide a
    // missing archive read in the current runtime's publication/capture path.
    const direct = await mkdtemp(path.join(root, '.local', 'current-archive-replay-'));
    t.after(() => rm(direct, { recursive: true, force: true }));
    await writeFile(path.join(direct, 'state.json'), JSON.stringify(disk));
    const recovered = await openStore({ dataDir: direct, retention: false });
    try {
      assert.equal(recovered.isPluginHandled('owner', kind, kind === 'items' ? itemTask : 1), true);
      assert.ok((await recovered.backup()).optionalSidecarEvidence.entries.pluginReplaySuppression.players.owner[kind].includes(kind === 'items' ? itemTask : 1));
    } finally { await recovered.close(); }
    await runStartGate(destination);
    const current = await openStore({ dataDir: destination, retention: false });
    try {
      assert.equal(current.isPluginHandled('owner', kind, kind === 'items' ? itemTask : 1), true);
      const exported = await current.backup();
      assert.ok(exported.optionalSidecarEvidence.entries.pluginReplaySuppression.players.owner[kind].includes(kind === 'items' ? itemTask : 1));
      if (carrier === 'items-capsule') assert.ok(exported.optionalSidecarEvidence.entries.pluginItems.players.owner.records.live.handled.includes(itemTask));
    } finally { await current.close(); }
    await f.replayFrozen({ target: destination, undo: false, current: true }); await f.close();
  });
}


async function operatorFixture(t) {
  const dataDir = await mkdtemp(path.join(root, '.local', 'operator-optional-store-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer' }]); initialState.tasks = tasks;
  const store = await openStore({ dataDir, initialState, retention: false });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  await store.close(); const dest = { dataDir };
  const controlDir = await mkdtemp(path.join(root, '.local', 'suppression-operator-control-'));
  t.after(() => rm(controlDir, { recursive: true, force: true }));
  const settings = { dataDir: dest.dataDir, controlDir, current: path.join(controlDir, 'current.json'), minFreeBytes: 0 };
  await writeFile(dest.dataDir + '.dataset.json', '{}');
  t.after(() => rm(dest.dataDir + '.dataset.json', { force: true }));
  const releases = [];
  for (const name of ['old', 'candidate']) {
    const core = path.join(controlDir, name); await mkdir(core);
    const config = path.join(controlDir, `${name}-config.json`), bytes = JSON.stringify({ coreRoot: core, dataDir: dest.dataDir });
    await writeFile(config, bytes);
    const pointer = path.join(controlDir, `${name}-pointer.json`);
    await writeFile(pointer, JSON.stringify({ config: { path: config, sha256: createHash('sha256').update(bytes).digest('hex') } }));
    releases.push(await readRelease(pointer, dest.dataDir));
  }
  await writeFile(settings.current, releases[0].pointerBytes);
  return { settings, current: releases[0], candidate: releases[1] };
}

for (const kind of ['items', 'achievements']) test(`real operator rollback admits optional ${kind} failure and ignores obsolete plugin refusals`, async t => {
  const f = await operatorFixture(t);
  await writeFile(path.join(f.settings.controlDir, 'plugin-reconciliation-refused.json'), '{}');
  let active = true, starts = 0, window, rollbackChecked = false;
  const controller = {
    state: async () => ({ active, stopped: !active }), stop: async () => { active = false; },
    start: async () => {
      const lock = JSON.stringify({ pid: process.pid }), digest = value => createHash('sha256').update(value).digest('hex');
      await writeFile(path.join(f.settings.controlDir, 'operation.lock'), lock);
      await writeFile(path.join(f.settings.controlDir, 'start-permit.json'), JSON.stringify({ expiresAt: Date.now() + 20000,
        lockSha256: digest(lock), pointerSha256: digest(await readFile(f.settings.current)), processIdentity: 'synthetic:start' }));
      await checkStart(f.settings, { identity: async () => 'synthetic:start' });
      starts++;
      if (starts === 1) window = await failedSidecarWindow(t, kind, { directory: f.settings.dataDir });
      else {
        const old = await frozenStore({ dataDir: f.settings.dataDir, retention: false });
        try {
          assert.ok(old.getState().members[0].completedTasks.includes(window.taskId));
          await old.command({ type: 'undo' }, old.getInfo().revision);
          assert.deepEqual(old.getState().members[0].completedTasks, []);
        } finally { await old.close(); }
      }
      active = true;
    },
  };
  await assert.rejects(deployStopped({ ...f, controller, check: async ({ phase }) => { if (phase === 'rollback') rollbackChecked = true; },
    wait: async () => {}, request: async release => ({ ready: release === f.current, savesReady: true }) }), /Private readiness/);
  assert.ok(rollbackChecked); assert.equal(starts, 2); assert.equal(active, true);
  await window.close();
});
