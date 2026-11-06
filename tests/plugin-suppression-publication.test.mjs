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

for (const kind of ['items', 'achievements']) for (const fault of ['unreadable', 'invalid', 'overflow']) {
  for (const publication of ['replace', 'automatic-tick', 'note', 'action-session', 'transfer']) {
    test(`${publication} keeps gameplay available with ${fault} optional ${kind} evidence`, async t => {
      const f = await fixture(t, publication === 'replace' ? { prepareState: state => state } : {});
      if (['note', 'action-session'].includes(publication)) await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
      const file = path.join(f.dataDir, `plugin-${kind}.json`);
      if (fault === 'unreadable') await mkdir(file);
      else if (fault === 'invalid') await writeFile(file, '{}');
      else await sidecar(f.dataDir, kind);
      const revision = f.store.getInfo().revision;
      if (publication === 'replace') await f.store.replace(suppressed(f.initialState, kind), revision);
      else if (publication === 'automatic-tick') await f.store.command(tick(kind), revision, { pluginHandled: suppression(kind) });
      else if (publication === 'note') {
        f.store.getStateSnapshot({ view: 'play-v1' });
        await f.store.commandSerialized({ type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Synthetic note' }, revision, { view: 'play-v1' });
      } else if (publication === 'action-session') await f.store.openActionSession(randomUUID());
      else {
        const result = await f.store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state: suppressed(f.initialState, kind) } }),
          { dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() }, route: '/api/restore/preview' });
        await f.store.applyTransfer(result.ticket, revision);
      }
      assert.ok(f.store.isPluginHandled('owner', kind, marker(kind)), 'Valid atomic decisions survive optional capture failure');
      assert.ok((await f.store.backup()).state);
      await f.store.close();
      const reopened = await openStore({ dataDir: f.dataDir, world, retention: false });
      try { assert.ok(reopened.isPluginHandled('owner', kind, marker(kind))); } finally { await reopened.close(); }
    });
  }
}

for (const kind of ['items', 'achievements']) {
  test(`owner Undo and preparation hooks preserve committed ${kind} with unusable optional archives`, async t => {
    let discard = false;
    const f = await fixture(t, { prepareState: state => discard ? { ...state, provenance: {
      optionalSidecarEvidence: { schemaVersion: 99 }, restore: { incomingProvenance: 'invalid optional archive' } } } : state });
    await f.store.command(tick(kind), 0, { pluginHandled: suppression(kind) });
    await mkdir(path.join(f.dataDir, `plugin-${kind}.json`));
    discard = true;
    await f.store.command({ type: 'undo' }, 1);
    assert.deepEqual(f.store.getState().members[0].completedTasks, []);
    assert.ok(f.store.isPluginHandled('owner', kind, marker(kind)));
    await f.store.replace({ ...f.initialState, provenance: { optionalSidecarEvidence: { schemaVersion: 99 } } }, 2);
    assert.ok(f.store.isPluginHandled('owner', kind, marker(kind)));
    assert.ok((await f.store.backup()).state);
  });

  test(`committed ${kind} at capacity survives an overflowing imported union`, async t => {
    const f = await fixture(t, { prepareState: state => state });
    const state = f.initialState;
    state.provenance = { pluginAutoHandled: { owner: { items: kind === 'items' ? full(kind) : [], achievements: kind === 'achievements' ? full(kind) : [] } } };
    await f.store.replace(state, 0);
    await f.store.replace(suppressed(f.initialState, kind), 1);
    assert.deepEqual(f.store.getState().provenance.pluginAutoHandled.owner[kind], full(kind));
  });
}
