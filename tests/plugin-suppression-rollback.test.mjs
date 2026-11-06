// @test full solo dataset=default
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from '../app/storage/store.mjs';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';
import { reconcilePluginHandledSidecars } from '../app/storage/plugin-handled-sidecars.mjs';
import { inventory } from '../scripts/linux/files.mjs';
import { deployStopped } from '../scripts/linux/operator.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { toolsClosure } from '../scripts/linux/tools-package.mjs';
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

async function runStartGate(dataDir) {
  const controlDir = await mkdtemp(path.join(root, '.local', 'synthetic-start-control-'));
  try { await checkStart({ dataDir, controlDir }); }
  catch (error) { throw error.cause ?? error; }
  finally { await rm(controlDir, { recursive: true, force: true }); }
}

test('installed tools contain the start gate without runtime dataset loaders', async () => {
  const closure = await toolsClosure(root);
  for (const file of ['scripts/linux/plugin-suppression-gate.mjs', 'app/storage/plugin-replay-checkpoint.mjs', 'app/storage/process-guard.mjs', 'app/storage/static-field.mjs']) {
    assert.ok(closure.files.some(row => row.path === file), file);
  }
  assert.ok(!closure.files.some(row => ['app/storage/store.mjs', 'app/dataset-runtime.mjs'].includes(row.path)));
});

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
      assert.equal(store.getInfo().revision, revision, 'Frozen controller must not author a new tick after Undo');
      assert.deepEqual(store.getState().members[0].completedTasks, []);
    } };
}

for (const kind of ['items', 'achievements']) for (const bridge of ['startup', 'start-gate']) {
  test(`${bridge} heals the failed ${kind} sidecar before frozen-controller Undo and replay`, async t => {
    const f = await failedSidecarWindow(t, kind);
    // Reconciliation must fence startup/rollback while the failure persists.
    if (bridge === 'startup') await assert.rejects(openStore({ dataDir: f.dataDir, retention: false }));
    else {
      const before = await inventory(f.dataDir);
      await assert.rejects(runStartGate(f.dataDir));
      assert.deepEqual(await inventory(f.dataDir), before, 'A refused ExecStartPre leaves picker bytes unchanged');
    }
    await f.repair();
    const saved = await readFile(path.join(f.dataDir, 'state.json'));
    if (bridge === 'startup') { const healed = await openStore({ dataDir: f.dataDir, retention: false }); await healed.close(); }
    else await runStartGate(f.dataDir);
    const after = JSON.parse(await readFile(path.join(f.dataDir, 'state.json'))), before = JSON.parse(saved);
    assert.deepEqual({ ...after.state, provenance: undefined }, { ...before.state, provenance: undefined }, 'Reconciliation never changes gameplay or Undo');
    if (bridge === 'startup') assert.deepEqual(after.state.provenance.pluginAutoHandled.owner[kind],
      kind === 'items' ? ['custom:previous', itemTask].sort() : [1, 99]);
    const record = JSON.parse(await readFile(f.file, 'utf8')).players.owner;
    assert.deepEqual(record.handled, kind === 'items' ? ['custom:previous', itemTask].sort() : [1, 99]);
    assert.deepEqual({ ...record, handled: f.previous.handled }, f.previous, 'Keep baseline, journal, bank and existing decisions');
    await runStartGate(f.dataDir); // Idempotent on the same checkpoint.
    await f.replayFrozen();
  });
}

test('the stopped reconciliation step refuses a live writer', async t => {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await mkdtemp(path.join(root, '.local', 'rollback-owner-test-'));
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]), retention: false });
  try { await assert.rejects(runStartGate(dataDir), /already|holds|owner|lock/i); }
  finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('ExecStartPre admits an uninitialized store but refuses orphaned replay evidence without changing bytes', async t => {
  const f = await emptyStore(t); await f.store.close();
  await rm(path.join(f.dataDir, 'state.json'));
  for (const name of ['plugin-items.json', 'plugin-achievements.json']) await rm(path.join(f.dataDir, name), { force: true });
  const before = await inventory(f.dataDir);
  await runStartGate(f.dataDir);
  assert.deepEqual(await inventory(f.dataDir), before);
  await sidecar(f.dataDir, 'items', [itemTask]);
  const orphaned = await inventory(f.dataDir);
  await assert.rejects(runStartGate(f.dataDir), /no owning checkpoint/);
  assert.deepEqual(await inventory(f.dataDir), orphaned);
});

test('ExecStartPre reconciles recovered gameplay without requiring regenerated credentials', async t => {
  const f = await emptyStore(t); await f.store.close();
  await rm(path.join(f.dataDir, 'access-token'));
  const before = await inventory(f.dataDir);
  await runStartGate(f.dataDir);
  assert.deepEqual(await inventory(f.dataDir), before);
});

test('ExecStartPre reads compact provenance and completion-codec saves and refuses corrupt dependencies unchanged', async t => {
  const state = suppressed(createGroupState([{ id: 'owner', name: 'Explorer' }]), 'items');
  state.tasks = tasks;
  state.provenance.syntheticArchive = 'a'.repeat(270000);
  const f = await emptyStore(t, { initialState: state, completionCodec: true });
  await f.store.command({ type: 'complete-task', memberId: 'owner', taskId: itemTask, completed: true }, 0);
  await f.store.close();
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json')));
  assert.equal(document.schemaVersion, 2);
  assert.ok(document.storage.fields.provenance);
  await rm(path.join(f.dataDir, 'plugin-items.json'));
  await runStartGate(f.dataDir);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir, 'plugin-items.json'))).players.owner.handled, [itemTask]);
  await rm(path.join(f.dataDir, 'plugin-items.json'));
  const file = path.join(f.dataDir, 'static', document.storage.fields.provenance.id);
  await writeFile(file, 'synthetic-corrupt-dependency');
  const before = await inventory(f.dataDir);
  await assert.rejects(runStartGate(f.dataDir));
  assert.deepEqual(await inventory(f.dataDir), before);
});

for (const bridge of ['startup', 'start-gate']) test(`${bridge} refuses a failed sidecar directory sync and retries unchanged markers`, async t => {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await mkdtemp(path.join(root, '.local', 'rollback-sync-test-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer' }]);
  initialState.provenance = { pluginAutoHandled: { owner: { achievements: [1], items: [itemTask] } } };
  const store = await openStore({ dataDir, initialState, retention: false }); await store.close();
  await rm(path.join(dataDir, 'plugin-items.json')); await rm(path.join(dataDir, 'plugin-achievements.json'));
  const saved = await readFile(path.join(dataDir, 'state.json'));
  const { open, rename } = fs.promises;
  let published = false, synced = false, closed = false;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    await rename(from, to);
    if (to === path.join(dataDir, 'plugin-items.json')) published = true;
  });
  t.mock.method(fs.promises, 'open', async (file, flags, ...options) => {
    if (file === dataDir && flags === 'r' && published) return {
      async sync() { synced = true; throw Object.assign(new Error('Synthetic directory failure'), { code: 'EIO' }); },
      async close() { closed = true; },
    };
    return open(file, flags, ...options);
  });
  syncBuiltinESMExports();
  const before = await inventory(dataDir);
  try {
    await assert.rejects(bridge === 'startup' ? openStore({ dataDir, retention: false }) : runStartGate(dataDir), /Synthetic directory failure/);
    assert.ok(synced && closed);
    assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), saved);
    if (bridge === 'start-gate') assert.deepEqual(await inventory(dataDir), before, 'Refusal restores every picker byte');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  try { await runStartGate(dataDir); } // Retry also syncs already-installed markers.
  finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('sidecar reconciliation refuses an overflowing union before publishing either sidecar', async t => {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await mkdtemp(path.join(root, '.local', 'rollback-capacity-test-'));
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]), retention: false });
  const record = { baselineAt: now, items: {}, handled: Array.from({ length: 2000 }, (_, i) => `custom:${i}`).sort(), journal: null };
  const file = path.join(dataDir, 'plugin-items.json'), bytes = JSON.stringify({ v: 1, players: { owner: record } });
  await writeFile(file, bytes);
  const state = store.getState(); state.provenance = { pluginAutoHandled: { owner: { achievements: [1], items: [itemTask] } } };
  try {
    await assert.rejects(reconcilePluginHandledSidecars({ dataDir, state }), /Invalid plugin (item record|suppression IDs)/);
    assert.equal(await readFile(file, 'utf8'), bytes);
    await assert.rejects(readFile(path.join(dataDir, 'plugin-achievements.json')), { code: 'ENOENT' });
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

const transferOptions = { dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
  route: '/api/restore/preview', world: { chunks: new Map() } };
const backup = state => ({ format: 'rs3-chunk-picker', schemaVersion: 1, state });
async function emptyStore(t, settings = {}) {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await mkdtemp(path.join(root, '.local', 'suppression-union-test-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer' }]); initialState.tasks = tasks;
  const store = await openStore({ dataDir, initialState, retention: false, ...settings });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, initialState };
}
function record(kind, handled) {
  return kind === 'items' ? { baselineAt: now, items: {}, handled, journal: null } : { handled };
}
const marker = kind => kind === 'items' ? itemTask : 1;
const full = kind => kind === 'items' ? Array.from({ length: 2000 }, (_, i) => `custom:${i}`).sort()
  : Array.from({ length: 20000 }, (_, i) => i + 100);
async function sidecar(dataDir, kind, ids) {
  await writeFile(path.join(dataDir, `plugin-${kind}.json`), JSON.stringify({ v: 1, players: { owner: record(kind, ids) } }));
}
function suppressed(state, kind) {
  return { ...state, provenance: { ...state.provenance, pluginAutoHandled: { owner: {
    items: kind === 'items' ? [itemTask] : [], achievements: kind === 'achievements' ? [1] : [],
  } } } };
}

for (const kind of ['items', 'achievements']) {
  for (const atomic of [false, true]) for (const transport of ['replace', 'whole', 'member']) {
    test(`portable ${transport} retains frozen-only ${kind} decisions${atomic ? ' alongside atomic decisions' : ''}`, async t => {
      const f = await failedSidecarWindow(t, kind, { legacy: true, atomic });
      const source = await openStore({ dataDir: f.dataDir, retention: false });
      let portable;
      try {
        assert.ok(source.getState().provenance.pluginAutoHandled.owner[kind].includes(marker(kind)));
        const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json')));
        assert.ok(disk.state.provenance.pluginAutoHandled.owner[kind].includes(marker(kind)), 'Fold-back is durable before serving');
        portable = await source.backup();
      } finally { await source.close(); }
      const memberId = transport === 'replace' ? 'owner' : 'partner';
      const initialState = createGroupState([{ id: memberId, name: 'Explorer' }]); initialState.tasks = tasks;
      const dest = await emptyStore(t, { initialState });
      if (transport === 'replace') await dest.store.replace(portable, 0);
      else {
        const prepared = await dest.store.prepareTransfer(serialize({ backup: portable,
          ...(transport === 'member' ? { memberId, sourceMemberId: 'owner' } : { rosterMapping: { owner: memberId } }) }),
        { ...transferOptions, route: transport === 'member' ? '/api/member-restore/preview' : transferOptions.route });
        await dest.store.applyTransfer(prepared.ticket, 0);
      }
      await dest.store.close();
      await f.replayFrozen({ target: dest.dataDir, memberId, undo: false, current: true });
    });
  }

  for (const transport of ['replace', 'whole', 'member', 'publication', 'replace-publication', 'preview-race']) {
    test(`${transport} refuses a ${kind} legacy/atomic union overflow before publication`, async t => {
      let inject = false, target;
      const dest = await emptyStore(t, { beforeCommit: async () => { if (inject) await sidecar(target, kind, full(kind)); } });
      target = dest.dataDir;
      const incoming = backup(suppressed(dest.initialState, kind));
      const before = await readFile(path.join(target, 'state.json'));
      let operation;
      if (!['publication', 'replace-publication', 'preview-race'].includes(transport)) await sidecar(target, kind, full(kind));
      if (transport === 'replace' || transport === 'replace-publication') {
        inject = transport === 'replace-publication';
        operation = () => dest.store.replace(incoming, 0);
      }
      else {
        const prepare = () => dest.store.prepareTransfer(serialize({ backup: incoming,
          ...(transport === 'member' ? { memberId: 'owner', sourceMemberId: 'owner' } : {}) }),
        { ...transferOptions, route: transport === 'member' ? '/api/member-restore/preview' : transferOptions.route });
        if (transport === 'publication' || transport === 'preview-race') {
          const preview = await prepare(); inject = transport === 'publication';
          if (transport === 'preview-race') await sidecar(target, kind, full(kind));
          operation = () => dest.store.applyTransfer(preview.ticket, 0);
        } else operation = async () => { const preview = await prepare(); await dest.store.applyTransfer(preview.ticket, 0); };
      }
      await assert.rejects(operation(), /Invalid plugin|evidence|suppression/i);
      assert.equal(dest.store.getInfo().revision, 0);
      assert.deepEqual(await readFile(path.join(target, 'state.json')), before);
      await dest.store.close();
      const reopened = await openStore({ dataDir: target, retention: false });
      await reopened.close(); // The refused restore has not made the picker unstartable.
    });
  }

  for (const bridge of ['startup', 'start-gate']) test(`${bridge} refuses ${kind} overflow before changing the checkpoint or sidecars`, async t => {
    const dest = await emptyStore(t);
    await dest.store.close();
    const file = path.join(dest.dataDir, 'state.json'), document = JSON.parse(await readFile(file));
    document.state = suppressed(document.state, kind);
    const bytes = JSON.stringify(document); await writeFile(file, bytes);
    await sidecar(dest.dataDir, kind, full(kind));
    const legacyBytes = await readFile(path.join(dest.dataDir, `plugin-${kind}.json`));
    await assert.rejects(bridge === 'startup' ? openStore({ dataDir: dest.dataDir, retention: false }) : runStartGate(dest.dataDir), /Invalid plugin/);
    assert.equal(await readFile(file, 'utf8'), bytes);
    assert.deepEqual(await readFile(path.join(dest.dataDir, `plugin-${kind}.json`)), legacyBytes);
  });

  for (const fault of ['invalid', 'unreadable', 'overflow']) test(`portable capture refuses ${fault} legacy ${kind} evidence`, async t => {
    const dest = await emptyStore(t, { initialState: suppressed(createGroupState([{ id: 'owner', name: 'Explorer' }]), kind) });
    const file = path.join(dest.dataDir, `plugin-${kind}.json`);
    await rm(file, { force: true });
    if (fault === 'invalid') await writeFile(file, '{}');
    if (fault === 'unreadable') await mkdir(file);
    if (fault === 'overflow') await sidecar(dest.dataDir, kind, full(kind));
    await assert.rejects(dest.store.backup(), /Invalid|unavailable|directory|EISDIR/i);
    await assert.rejects(dest.store.exportBackup({ dataset: transferOptions.dataset }), /Invalid|unavailable|directory|EISDIR/i);
  });
}

async function operatorFixture(t) {
  const dest = await emptyStore(t); await dest.store.close();
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

for (const kind of ['items', 'achievements']) for (const repair of [false, true]) {
  test(`real operator rollback ${repair ? 'heals' : 'refuses'} the failed ${kind} sidecar before frozen replay`, async t => {
    const f = await operatorFixture(t);
    let active = true, starts = 0, window, rollbackChecked = false;
    const controller = {
      state: async () => ({ active, stopped: !active }), stop: async () => { active = false; },
      start: async () => {
        assert.equal(active, false);
        // Real systemd start runs the common ExecStartPre. The fixture supplies
        // only the operator owner proof, not an alternate reconciliation path.
        const lock = JSON.stringify({ pid: process.pid }), digest = value => createHash('sha256').update(value).digest('hex');
        await writeFile(path.join(f.settings.controlDir, 'operation.lock'), lock);
        await writeFile(path.join(f.settings.controlDir, 'start-permit.json'), JSON.stringify({ expiresAt: Date.now() + 20000,
          lockSha256: digest(lock), pointerSha256: digest(await readFile(f.settings.current)), processIdentity: 'synthetic:start' }));
        const before = await inventory(f.settings.dataDir);
        try { await checkStart(f.settings, { identity: async () => 'synthetic:start' }); }
        catch (error) {
          assert.deepEqual(await inventory(f.settings.dataDir), before, 'A refused start changes no picker bytes');
          assert.equal(active, false); throw error;
        }
        starts++;
        if (starts === 1) {
          window = await failedSidecarWindow(t, kind, { directory: f.settings.dataDir });
          if (repair) await window.repair();
        } else await window.replayFrozen();
        active = true;
      },
    };
    const check = async ({ phase }) => {
      if (phase === 'rollback') {
        rollbackChecked = true;
        if (repair) assert.ok(!JSON.parse(await readFile(window.file)).players.owner.handled.includes(marker(kind)), 'Compatibility-only probe has not healed live evidence');
      }
    };
    try {
      await assert.rejects(deployStopped({ ...f, controller, check, wait: async () => {},
        request: async release => ({ ready: release === f.current, savesReady: true }) }),
      repair ? /Private readiness/ : error => error.code === 'PLUGIN_RECONCILIATION_FAILED');
      assert.ok(rollbackChecked);
      assert.equal(starts, repair ? 2 : 1);
      assert.equal(active, repair);
    } finally { await window?.close(); }
  });
}

test('service start reconciliation gates every active picker, including quarantined stores', async t => {
  const first = await emptyStore(t), second = await emptyStore(t);
  await first.store.close(); await second.store.close();
  const registryDir = path.join(first.dataDir, 'registry'), pickerRoot = path.join(first.dataDir, 'pickers');
  await mkdir(registryDir); await mkdir(pickerRoot);
  const owner = randomUUID(), id = `p_${'a'.repeat(32)}`, target = path.join(pickerRoot, id);
  await rename(second.dataDir, target);
  const document = { schemaVersion: 1, accounts: [{ id: owner, identities: [], defaultPickerId: id, createdAt: now,
    memberships: [{ pickerId: id, role: 'owner', memberId: 'owner' }] }],
  pickers: [{ id, kind: 'default', ownerAccountId: owner, lifecycle: 'active', provisioning: 'ready', memberIds: ['owner'], createdAt: now }], capabilities: [] };
  await writeFile(path.join(registryDir, 'registry.json'), JSON.stringify(document));
  await writeFile(path.join(target, 'operator-quarantine.json'), '{}');
  const file = path.join(target, 'state.json'), state = JSON.parse(await readFile(file)); state.state = suppressed(state.state, 'items');
  await writeFile(file, JSON.stringify(state));
  await writeFile(path.join(target, 'plugin-items.json'), '{}');
  const legacyFile = path.join(first.dataDir, 'state.json'), legacy = JSON.parse(await readFile(legacyFile));
  legacy.state = suppressed(legacy.state, 'achievements'); await writeFile(legacyFile, JSON.stringify(legacy));
  const controlDir = await mkdtemp(path.join(root, '.local', 'suppression-service-control-'));
  t.after(() => rm(controlDir, { recursive: true, force: true }));
  const settings = { dataDir: first.dataDir, controlDir, multiPicker: { registryDir, pickerRoot } };
  const before = await inventory(first.dataDir);
  await assert.rejects(checkStart(settings), { code: 'PLUGIN_RECONCILIATION_FAILED' });
  assert.deepEqual(await inventory(first.dataDir), before);
  await rm(path.join(target, 'plugin-items.json'));
  await checkStart(settings);
  assert.deepEqual(JSON.parse(await readFile(path.join(target, 'plugin-items.json'))).players.owner.handled, [itemTask]);
  assert.deepEqual(JSON.parse(await readFile(path.join(first.dataDir, 'plugin-achievements.json'))).players.owner.handled, [1]);
  document.pickers[0].provisioning = 'reserved';
  await writeFile(path.join(registryDir, 'registry.json'), JSON.stringify(document));
  for (const directory of [target, first.dataDir]) {
    const file = path.join(directory, 'state.json'), checkpoint = await readFile(file);
    await rm(file);
    const orphaned = await inventory(first.dataDir);
    await assert.rejects(checkStart(settings), { code: 'PLUGIN_RECONCILIATION_FAILED' });
    assert.deepEqual(await inventory(first.dataDir), orphaned, 'Neither reserved pickers nor legacy stores may bypass orphaned decisions');
    await writeFile(file, checkpoint);
  }
});

for (const kind of ['items', 'achievements']) test(`owner Undo keeps ${kind} suppressed through restore, member transfer and frozen rollback`, async t => {
  const f = await failedSidecarWindow(t, kind); await f.repair();
  await f.replayFrozen({ current: true }); // Undo the automatic tick, then report again.
  await f.close();
  const source = await openStore({ dataDir: f.dataDir, retention: false });
  let portable;
  try { portable = await source.backup(); } finally { await source.close(); }
  const restored = await emptyStore(t);
  await restored.store.replace(portable, 0);
  portable = await restored.store.backup();
  const initialState = createGroupState([{ id: 'partner', name: 'Explorer' }]); initialState.tasks = tasks;
  initialState.members[0].notes = { '12341': 'Synthetic destination note' };
  const destination = await emptyStore(t, { initialState });
  const preview = await destination.store.prepareTransfer(serialize({ backup: portable, memberId: 'partner', sourceMemberId: 'owner' }),
    { ...transferOptions, route: '/api/member-restore/preview' });
  await destination.store.applyTransfer(preview.ticket, 0);
  assert.deepEqual(destination.store.getState().members[0].notes ?? {}, {});
  await destination.store.command({ type: 'undo' }, destination.store.getInfo().revision); // Undo the member restore too.
  assert.deepEqual(destination.store.getState().members[0].notes, initialState.members[0].notes);
  await destination.store.close();
  await runStartGate(destination.dataDir);
  await f.replayFrozen({ target: destination.dataDir, memberId: 'partner', undo: false });
  await f.close();
});

for (const failure of ['publication', 'cleanup']) test(`ExecStartPre restores exact sidecar preimages on ${failure} failure`, async t => {
  const state = suppressed(createGroupState([{ id: 'owner', name: 'Explorer' }]), 'items');
  state.provenance.pluginAutoHandled.owner.achievements = [1];
  const f = await emptyStore(t, { initialState: state }); await f.store.close();
  await sidecar(f.dataDir, 'items', ['custom:previous']); await sidecar(f.dataDir, 'achievements', [99]);
  const before = await inventory(f.dataDir), original = fs.promises.rename, remove = fs.promises.rm;
  let published = false, failed = false;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (failure === 'publication' && from.endsWith('.new') && to === path.join(f.dataDir, 'plugin-items.json')) throw Object.assign(new Error('Synthetic publication failure'), { code: 'EIO' });
    await original(from, to);
    if (from.endsWith('.new')) published = true;
  });
  t.mock.method(fs.promises, 'rm', async (file, ...args) => {
    if (failure === 'cleanup' && published && !failed && file.includes('plugin-items.json.reconcile-') && file.endsWith('.previous')) {
      failed = true;
      throw Object.assign(new Error('Synthetic cleanup failure'), { code: 'EIO' });
    }
    return remove(file, ...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(runStartGate(f.dataDir), new RegExp(`Synthetic ${failure} failure`));
    assert.ok(published, 'Exercise rollback after an earlier sidecar was installed');
    assert.deepEqual(await inventory(f.dataDir), before);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  await runStartGate(f.dataDir);
});
