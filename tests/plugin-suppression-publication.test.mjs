// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { inventory } from '../scripts/linux/files.mjs';

const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
const itemTask = 'rs3:goal:equipment:000dc1', achievementTask = 'diary:synthetic';
const tasks = [{ id: itemTask, category: 'BiS', label: 'Obtain a Yew shortbow' },
  { id: achievementTask, category: 'Diary', label: 'Synthetic achievement' }];
const now = '2026-11-01T12:00:00.000Z';
const marker = kind => kind === 'items' ? itemTask : 1;
const full = kind => kind === 'items' ? Array.from({ length: 2000 }, (_, i) => `custom:${i}`).sort()
  : Array.from({ length: 20000 }, (_, i) => i + 100);
function suppression(kind) { return { items: kind === 'items' ? [itemTask] : [], achievements: kind === 'achievements' ? [1] : [] }; }
function suppressed(state, kind) {
  return { ...state, provenance: { ...state.provenance, pluginAutoHandled: { owner: suppression(kind) } } };
}
async function sidecar(dataDir, kind, handled = full(kind)) {
  const record = kind === 'items' ? { baselineAt: now, items: {}, handled, journal: null } : { handled };
  await writeFile(path.join(dataDir, `plugin-${kind}.json`), JSON.stringify({ v: 1, players: { owner: record } }));
}
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-suppression-publication-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer', unlocked: ['12341'] }]); initialState.tasks = tasks;
  const store = await openStore({ dataDir, initialState, world, retention: false,
    taskCatalogue: new Map(tasks.map(task => [task.id, task])), now: () => now, ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, initialState };
}
function tick(kind) {
  return { type: 'apply-game-progress', memberId: 'owner', fetchedAt: now, skills: [], quests: [],
    ...(kind === 'items' ? { items: [{ taskId: itemTask, title: 'Yew shortbow', gameItemId: 857, evidence: 'owned', seen: 'Synthetic observation' }] }
      : { achievements: [{ taskId: achievementTask, achievementId: 1, title: 'Synthetic achievement' }] }) };
}

for (const kind of ['items', 'achievements']) for (const publication of ['replace', 'automatic-tick', 'note', 'action-session']) {
  test(`${publication} refuses the ${kind} legacy union overflow without publishing any files`, async t => {
    // Force in-process replacement while retaining the built-in note path in
    // the note cases, including its cached play projection from #145.
    const f = await fixture(t, publication === 'replace' ? { prepareState: state => state } : {});
    if (['note', 'action-session'].includes(publication)) await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
    await sidecar(f.dataDir, kind);
    const before = await inventory(f.dataDir), state = f.store.getState();
    if (publication === 'note') f.store.getStateSnapshot({ view: 'play-v1' });
    const publish = publication === 'replace' ? () => f.store.replace(suppressed(f.initialState, kind), state.revision)
      : publication === 'automatic-tick' ? () => f.store.command(tick(kind), state.revision, { pluginHandled: suppression(kind) })
        : publication === 'note' ? () => f.store.commandSerialized({ type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Synthetic note' }, state.revision, { view: 'play-v1' })
          : () => f.store.openActionSession(randomUUID());
    await assert.rejects(publish(), /Invalid plugin|replay evidence/i);
    assert.deepEqual(f.store.getState(), state);
    assert.deepEqual(await inventory(f.dataDir), before, 'Refusal must not create retained backups, static fields, archives or receipts');
    if (publication === 'replace' || publication === 'automatic-tick') {
      await f.store.close();
      const reopened = await openStore({ dataDir: f.dataDir, world, retention: false });
      await reopened.close();
    } else assert.ok(f.store.isPluginHandled('owner', kind, marker(kind)));
  });
}

for (const kind of ['items', 'achievements']) {
  test(`initialization validates nested ${kind} registry evidence against legacy limits`, async t => {
    const f = await fixture(t); await f.store.close();
    await rm(path.join(f.dataDir, 'state.json'));
    await sidecar(f.dataDir, kind);
    const initialState = { ...f.initialState, provenance: { optionalSidecarEvidence: { schemaVersion: 1,
      entries: { pluginReplaySuppression: { version: 1, players: { owner: suppression(kind) } } } } } };
    const before = await inventory(f.dataDir);
    await assert.rejects(openStore({ dataDir: f.dataDir, initialState, retention: false }), /Invalid plugin/);
    assert.deepEqual(await inventory(f.dataDir), before);
  });

  test(`new automatic ${kind} suppression refuses unavailable legacy evidence`, async t => {
    const f = await fixture(t);
    await mkdir(path.join(f.dataDir, `plugin-${kind}.json`));
    const before = await inventory(f.dataDir);
    await assert.rejects(f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) }), /directory|EISDIR/i);
    assert.equal(f.store.getInfo().revision, 0);
    assert.deepEqual(await inventory(f.dataDir), before);
  });

  test(`a final transfer ${kind} refusal publishes no dependencies`, async t => {
    const f = await fixture(t, { beforeCommit: () => sidecar(f.dataDir, kind) });
    const preview = await f.store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state: suppressed(f.initialState, kind) } }),
      { dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() }, route: '/api/restore/preview' });
    const before = await inventory(f.dataDir);
    await assert.rejects(f.store.applyTransfer(preview.ticket, 0), /Invalid plugin/);
    assert.equal(f.store.getInfo().revision, 0);
    assert.deepEqual((await inventory(f.dataDir)).filter(row => row.path !== `plugin-${kind}.json`), before);
  });

  test(`a ${kind} union exactly at capacity remains writable and restartable`, async t => {
    const f = await fixture(t);
    await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
    const handled = [...full(kind).slice(1), marker(kind)].sort(kind === 'items' ? undefined : (a, b) => a - b);
    await sidecar(f.dataDir, kind, handled);
    await f.store.command({ type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Synthetic note' }, 1);
    assert.deepEqual(f.store.getState().provenance.pluginAutoHandled.owner[kind], handled);
    await f.store.close();
    const reopened = await openStore({ dataDir: f.dataDir, world, retention: false });
    assert.ok(reopened.isPluginHandled('owner', kind, marker(kind)));
    await reopened.close();
  });

  test(`owner Undo preserves committed ${kind} suppression while the sidecar is unavailable`, async t => {
    const f = await fixture(t);
    await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
    await mkdir(path.join(f.dataDir, `plugin-${kind}.json`));
    await f.store.command({ type: 'undo' }, 1);
    assert.deepEqual(f.store.getState().members[0].completedTasks, []);
    assert.ok(f.store.isPluginHandled('owner', kind, marker(kind)));
  });

  test(`a final ${kind} union refusal leaves no prepared dependencies behind`, async t => {
    let inject = false, target;
    const f = await fixture(t, { beforeCommit: async () => { if (inject) await sidecar(target, kind); } });
    target = f.dataDir;
    await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
    const before = await inventory(f.dataDir);
    inject = true;
    await assert.rejects(f.store.command({ type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Synthetic note' }, 1), /Invalid plugin/);
    assert.equal(f.store.getInfo().revision, 1);
    assert.deepEqual((await inventory(f.dataDir)).filter(row => row.path !== `plugin-${kind}.json`), before,
      'Only the independently injected sidecar may differ after refusal');
  });

  test(`startup preparation refuses new ${kind} suppression before retaining a backup`, async t => {
    const f = await fixture(t);
    await sidecar(f.dataDir, kind);
    await f.store.close();
    const before = await inventory(f.dataDir);
    await assert.rejects(openStore({ dataDir: f.dataDir, world, retention: false,
      prepareState: state => suppressed(state, kind) }), /Invalid plugin/);
    assert.deepEqual(await inventory(f.dataDir), before);
  });

  test(`an unavailable other sidecar cannot hide a readable ${kind} overflow`, async t => {
    const f = await fixture(t);
    await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
    await sidecar(f.dataDir, kind);
    const unavailable = path.join(f.dataDir, `plugin-${kind === 'items' ? 'achievements' : 'items'}.json`);
    await mkdir(unavailable);
    const before = await inventory(f.dataDir);
    await assert.rejects(f.store.command({ type: 'undo' }, 1), /Invalid plugin/);
    assert.deepEqual(await inventory(f.dataDir), before);
  });
}
