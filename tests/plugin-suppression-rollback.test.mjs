// @test full solo dataset=default
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from '../app/storage/store.mjs';
import { openGamePlugin } from '../app/game-plugin.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { reconcileForRollback } from '../scripts/linux/reconcile-plugin-suppression.mjs';
import { reconcilePluginHandledSidecars } from '../app/storage/plugin-handled-sidecars.mjs';

const execute = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const release = '06e15939dbf73ecd1a0e7bc9c29088e0281ca11e';
let checkout, frozenStore, frozenPlugin;
before(async () => {
  try { await execute('git', ['cat-file', '-e', `${release}^{commit}`], { cwd: root }); }
  catch { return; } // A shallow public checkout may not contain the pinned release.
  await mkdir(path.join(root, '.local'), { recursive: true });
  checkout = path.join(root, '.local', `frozen-plugin-runtime-${randomUUID()}`);
  await execute('git', ['worktree', 'add', '--detach', checkout, release], { cwd: root });
  ({ openStore: frozenStore } = await import(pathToFileURL(path.join(checkout, 'app/storage/store.mjs'))));
  ({ openGamePlugin: frozenPlugin } = await import(pathToFileURL(path.join(checkout, 'app/game-plugin.mjs'))));
});
after(async () => {
  if (checkout) await execute('git', ['worktree', 'remove', checkout], { cwd: root });
});

const itemTask = 'rs3:goal:equipment:000dc1', achievementTask = 'diary:synthetic';
const tasks = [{ id: itemTask, category: 'BiS', label: 'Obtain a Yew shortbow' },
  { id: achievementTask, category: 'Diary', label: '~|Synthetic Achievements#Easy|~ First Task' }];
const identity = { admin: true }, now = '2026-11-01T12:00:00.000Z';

async function failedSidecarWindow(t, kind) {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await mkdtemp(path.join(root, '.local', 'rollback-suppression-test-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer' }]); initialState.tasks = tasks;
  const catalogue = new Map(tasks.map(row => [row.id, row]));
  let store = await openStore({ dataDir, initialState, taskCatalogue: catalogue, retention: false, now: () => now });
  let controller, input, seq = 0;
  t.after(async () => { await controller?.close(); await store?.close(); await rm(dataDir, { recursive: true, force: true }); });
  const file = path.join(dataDir, `plugin-${kind}.json`), held = file + '.synthetic-held';
  const previous = kind === 'items' ? { baselineAt: now, items: {}, handled: ['custom:previous'],
    journal: { id: 'aaaaaaaaaaaaaaaa', event: 0 }, bank: { snapshot: 'bbbbbbbbbbbbbbbb', seenAt: now, coins: 0 } } : { handled: [99] };
  await writeFile(file, JSON.stringify({ v: 1, players: { owner: previous } }));
  async function openController(open) {
    controller = await open({ dataDir, store, clock: () => Date.parse(now), world: { chunks: new Map() },
      registry: { resolve: () => ({}) }, questMapping: new Map(), taskCatalogue: () => tasks,
      serializeMutation: operation => operation(), bodyJSON: async () => input,
      json: async (_request, _response, status) => assert.equal(status, 200), checkRequestOrigin: () => {}, log: () => {} });
    return (await controller.create(identity, { memberId: 'owner', label: 'Synthetic plugin' })).key;
  }
  async function send(key) {
    input = { v: 1, seq: ++seq, sentAt: now, position: { x: 50, z: 50, floor: 0 }, world: { id: 1, beta: false },
      ...(kind === 'items' ? { items: { snapshot: '0123456789abcdef', worn: [], backpack: [[0, 857, 1, 'Yew shortbow']],
        journal: { id: 'aaaaaaaaaaaaaaaa', events: [] } } }
        : { achievements: { snapshot: '0123456789abcdef', part: 1, parts: 1, complete: [[1, 'First Task', 0, 0]] } }) };
    const request = { method: 'POST', url: '/api/plugin/v1/report', headers: { authorization: `Bearer ${key}` } };
    await controller.handle(request, {}, { route: request.url, security: {} });
  }
  const key = await openController(openGamePlugin), command = store.command;
  store.command = async (...args) => {
    const result = await command(...args);
    if (args[0].type === 'apply-game-progress') { await rename(file, held); await mkdir(file); }
    return result;
  };
  await send(key);
  assert.equal(store.getInfo().revision, 1);
  const taskId = kind === 'items' ? itemTask : achievementTask;
  assert.ok(store.getState().members[0].completedTasks.includes(taskId));
  await controller.close(); controller = null; // Keep writes failing THROUGH shutdown.
  await store.close(); store = null;
  const retained = JSON.parse(await readFile(held, 'utf8')).players.owner;
  return { dataDir, file, held, previous: retained, taskId,
    repair: async () => { await rm(file, { recursive: true }); await rename(held, file); },
    replayFrozen: async () => {
      store = await frozenStore({ dataDir, retention: false, taskCatalogue: catalogue, now: () => now });
      await store.command({ type: 'undo' }, store.getInfo().revision);
      const revision = store.getInfo().revision;
      const legacyKey = await openController(frozenPlugin);
      await send(legacyKey);
      assert.equal(store.getInfo().revision, revision, 'Frozen controller must not author a new tick after Undo');
      assert.deepEqual(store.getState().members[0].completedTasks, []);
    } };
}

for (const kind of ['items', 'achievements']) for (const bridge of ['startup', 'rollback-command']) {
  test(`${bridge} heals the failed ${kind} sidecar before frozen-controller Undo and replay`, async t => {
    if (!frozenStore) return t.skip('Pinned rollback release is unavailable in this shallow checkout.');
    const f = await failedSidecarWindow(t, kind);
    // Reconciliation must fence startup/rollback while the failure persists.
    if (bridge === 'startup') await assert.rejects(openStore({ dataDir: f.dataDir, retention: false }));
    else await assert.rejects(execute(process.execPath, [path.join(root, 'scripts/linux/reconcile-plugin-suppression.mjs'), f.dataDir]),
      error => error.code === 1 && /Rollback refused/.test(error.stderr));
    await f.repair();
    const saved = await readFile(path.join(f.dataDir, 'state.json'));
    if (bridge === 'startup') { const healed = await openStore({ dataDir: f.dataDir, retention: false }); await healed.close(); }
    else await reconcileForRollback(f.dataDir);
    assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), saved, 'Reconciliation never changes gameplay or Undo');
    const record = JSON.parse(await readFile(f.file, 'utf8')).players.owner;
    assert.deepEqual(record.handled, kind === 'items' ? ['custom:previous', itemTask].sort() : [1, 99]);
    assert.deepEqual({ ...record, handled: f.previous.handled }, f.previous, 'Keep baseline, journal, bank and existing decisions');
    await reconcileForRollback(f.dataDir); // Idempotent on the same checkpoint.
    await f.replayFrozen();
  });
}

test('the stopped reconciliation step refuses a live writer', async t => {
  await mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await mkdtemp(path.join(root, '.local', 'rollback-owner-test-'));
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]), retention: false });
  try { await assert.rejects(reconcileForRollback(dataDir), /already|holds|owner|lock/i); }
  finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

for (const bridge of ['startup', 'rollback-command']) test(`${bridge} refuses a failed sidecar directory sync and retries unchanged markers`, async t => {
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
  try {
    await assert.rejects(bridge === 'startup' ? openStore({ dataDir, retention: false }) : reconcileForRollback(dataDir), /Synthetic directory failure/);
    assert.ok(synced && closed);
    assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), saved);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  try { await reconcileForRollback(dataDir); } // Retry also syncs already-installed markers.
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
    await assert.rejects(reconcilePluginHandledSidecars({ dataDir, state }), /Invalid plugin item record/);
    assert.equal(await readFile(file, 'utf8'), bytes);
    await assert.rejects(readFile(path.join(dataDir, 'plugin-achievements.json')), { code: 'ENOENT' });
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});
