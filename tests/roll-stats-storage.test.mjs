import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';

const DAY = 86_400_000;
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-roll-stats-storage-'));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  initialState.members[0].unlocked = ['103'];
  const ids = ['100', '101', '102', '103', '104'];
  const world = { chunks: new Map(ids.map(id => [id, { id, name: id }])), neighbors: new Map(), walkable: new Set(ids), f2p: new Set(ids) };
  let clock = '2026-10-01T12:00:00.000Z', store;
  const options = { dataDir, initialState, world, now: () => clock, retention: { backupDays: 90, historyEntries: 2 } };
  store = await openStore(options);
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, get store() { return store; }, setClock(at) { clock = at; },
    async reopen() { await store.close(); store = await openStore(options); } };
}

async function fileSnapshot(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name), target = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await fileSnapshot(target, relative));
    else files[relative] = { bytes: (await readFile(target)).toString('base64'), modified: (await stat(target)).mtimeMs };
  }
  return files;
}

test('roll statistics read durable archive overrides and Undo while counting only current unlocks without saving', async t => {
  const fixtureState = await fixture(t);
  const command = async (payload, at) => {
    fixtureState.setClock(at);
    await fixtureState.store.command(payload, fixtureState.store.getInfo().revision);
  };
  const unlock = (chunkId, memberId = 'actor1') => ({ type: 'set-chunk', memberId, chunkId, status: 'unlocked' });
  await command(unlock('100'), '2026-10-01T12:00:00.000Z');
  await command(unlock('101'), '2026-10-05T12:00:00.000Z');
  await command(unlock('102'), '2026-10-06T12:00:00.000Z');
  await command({ type: 'undo', undoRevision: 3 }, '2026-10-06T13:00:00.000Z');
  await command(unlock('104'), '2026-10-07T12:00:00.000Z');
  await command({ type: 'set-chunk', memberId: 'actor1', chunkId: '104', status: 'locked' }, '2026-10-07T13:00:00.000Z');
  await command(unlock('100', 'reed'), '2026-10-08T12:00:00.000Z');
  for (let index = 0; index < 8; index++) {
    await command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: `Private note ${index}` }, '2026-10-09T12:00:00.000Z');
  }
  const references = fixtureState.store.getState().provenance.historyArchive;
  assert.ok(references.length > 1);
  const first = JSON.parse(gunzipSync(await readFile(path.join(fixtureState.dataDir, 'history', references[0].id))));
  const latestPath = path.join(fixtureState.dataDir, 'history', references.at(-1).id);
  const latest = JSON.parse(gunzipSync(await readFile(latestPath)));
  const override = structuredClone(first.events.find(event => event.revision === 1));
  assert.ok(override);
  override.at = '2026-10-03T12:00:00.000Z';
  latest.events.unshift(override);
  await writeFile(latestPath, gzipSync(JSON.stringify(latest)));
  await fixtureState.reopen();
  fixtureState.setClock('2026-10-10T12:00:00.000Z');
  const store = fixtureState.store, before = store.getState(), diskBefore = await fileSnapshot(fixtureState.dataDir);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  t.after(unsubscribe);
  const stats = await store.getRollStats({ stateRevision: 15 });
  assert.equal(stats.stateRevision, 15);
  assert.equal(stats.revision, 15);
  assert.equal(stats.asOf, '2026-10-10T12:00:00.000Z');
  const actor1 = stats.members.find(member => member.id === 'actor1');
  assert.equal(actor1.totalUnlocked, 3);
  assert.equal(actor1.datedUnlocked, 2);
  assert.equal(actor1.unknownDateCount, 1);
  assert.equal(actor1.unlocksLast7Days, 2);
  assert.deepEqual(actor1.unlocks, [
    { chunkId: '100', at: '2026-10-03T12:00:00.000Z', revision: 1, type: 'set-chunk' },
    { chunkId: '101', at: '2026-10-05T12:00:00.000Z', revision: 2, type: 'set-chunk' },
  ]);
  assert.equal(actor1.intervalCount, 1);
  for (const key of ['averageIntervalMs', 'medianIntervalMs', 'longestGapMs']) assert.equal(actor1[key], 2 * DAY);
  assert.deepEqual(actor1.timeline, [{ at: '2026-10-03T12:00:00.000Z', unlocked: 1 }, { at: '2026-10-05T12:00:00.000Z', unlocked: 2 }]);
  assert.equal(stats.members.find(member => member.id === 'reed').datedUnlocked, 1);
  assert.equal(stats.duo.totalUnlocked, 3);
  assert.equal(stats.duo.unknownDateCount, 1);
  assert.deepEqual(stats.duo.unlocks, actor1.unlocks);
  actor1.unlocks[0].chunkId = 'mutated';
  assert.equal((await store.getRollStats()).members[0].unlocks[0].chunkId, '100');
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(await fileSnapshot(fixtureState.dataDir), diskBefore);
  assert.equal(notifications, 0);
});

test('roll statistics reject stale or invalid state revisions without changing saved state', async t => {
  const { store, dataDir } = await fixture(t);
  await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Private' }, 0);
  const before = store.getState(), diskBefore = await fileSnapshot(dataDir);
  const stats = await store.getRollStats({ stateRevision: 1 });
  assert.equal(stats.members[0].totalUnlocked, 1);
  assert.equal(stats.members[0].datedUnlocked, 0);
  assert.equal(stats.members[0].averageIntervalMs, null);
  await assert.rejects(() => store.getRollStats({ stateRevision: 0 }), error => error.code === 'REVISION_CONFLICT' && error.state.revision === 1);
  for (const stateRevision of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    await assert.rejects(() => store.getRollStats({ stateRevision }), TypeError);
  }
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(await fileSnapshot(dataDir), diskBefore);
});
