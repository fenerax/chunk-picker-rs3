import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { playerControlSkills } from '../app/core/player-controls.mjs';
const observedSkill = playerControlSkills[0];
import { gzipSync, gunzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';

async function fixture(t, { dataDir: suppliedDirectory, ...options } = {}) {
  const dataDir = suppliedDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'rs3-history-pages-'));
  const state = createGroupState([{ id: 'actor1', name: 'Player', runescapeName: 'Fixture One' }, { id: 'reed', name: 'Reed' }]);
  state.tasks.push({ id: 'custom:quest', label: 'Helpful quest', category: 'custom' });
  const world = { chunks: new Map([['100', { id: '100', name: 'Lumbridge' }]]), neighbors: new Map(), walkable: new Set(['100']), f2p: new Set(['100']) };
  const store = await openStore({ dataDir, initialState: state, world, retention: { backupDays: 90, historyEntries: 2 }, ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return store;
}
const actor = { kind: 'invite', inviteId: 'reed-test', label: 'Reed phone', memberId: 'reed' };

test('bounded history pages span archive segments, keep newest overrides and attach backup events', async t => {
  const store = await fixture(t);
  for (let revision = 0; revision < 12; revision++) await store.command({ type: 'set-note', memberId: revision === 0 ? 'actor1' : 'reed', chunkId: '100', note: String(revision) }, revision, { actor });
  await store.command({ type: 'undo', undoRevision: 1 }, 12, { actor });
  for (let revision = 13; revision < 19; revision++) await store.command({ type: 'set-note', memberId: 'reed', chunkId: '100', note: String(revision) }, revision);
  assert.ok(store.getInfo().retention.historyArchives > 1);
  const seen = [], revision = store.getInfo().revision;
  let before;
  do {
    const page = await store.queryHistory({ limit: 3, before, stateRevision: revision });
    assert.ok(page.history.length <= 3);
    assert.equal(page.stateRevision, revision);
    assert.ok(page.history.every(event => !Object.hasOwn(event, 'undo') && Object.hasOwn(event, 'hasUndo')));
    seen.push(...page.history);
    before = page.nextBefore;
    assert.equal(page.hasMore, before !== null);
  } while (before !== null);
  assert.deepEqual(seen.map(event => event.revision), Array.from({ length: 19 }, (_, index) => 19 - index));
  assert.equal(seen.at(-1).undoneRevision, 13);
  const backups = await store.listBackups();
  assert.equal(backups.find(backup => backup.revision === 0).event, null);
  assert.equal(backups.find(backup => backup.revision === 1).event.undoneRevision, 13);
  assert.equal(backups.find(backup => backup.revision === 12).event.actor.label, 'Reed phone');
});

test('archive projections that stop matching do not leave stale matches or short pages', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-history-projection-'));
  const store = await fixture(t, { dataDir });
  for (let revision = 0; revision < 9; revision++) await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'needle' + revision }, revision);
  const references = store.getState().provenance.historyArchive;
  const first = JSON.parse(gunzipSync(await readFile(path.join(dataDir, 'history', references[0].id))));
  const newerFile = path.join(dataDir, 'history', references[1].id);
  const newer = JSON.parse(gunzipSync(await readFile(newerFile)));
  const override = structuredClone(first.events.find(event => event.revision === 3));
  override.command.note = 'new text';
  newer.events.unshift(override);
  await writeFile(newerFile, gzipSync(JSON.stringify(newer)));
  const page = await store.queryHistory({ q: 'needle', before: 4, limit: 1 });
  assert.deepEqual(page.history.map(event => event.revision), [2]);
  assert.equal(page.hasMore, true);
  assert.deepEqual((await store.queryHistory({ q: 'needle', before: page.nextBefore, limit: 1 })).history.map(event => event.revision), [1]);
});

test('search uses readable task, chunk, player and actor labels and filters affected or actor player', async t => {
  const store = await fixture(t);
  await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Collect feathers' }, 0, { actor });
  await store.command({ type: 'set-task-status', memberId: 'actor1', taskId: 'custom:quest', challengeCompleted: true }, 1);
  await store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 2);
  const labels = { chunkName: () => 'Lumbridge', ruleLabel: () => 'Free to play' };
  assert.deepEqual((await store.queryHistory({ q: 'LUMBRIDGE', labels })).history.map(event => event.revision), [1]);
  assert.deepEqual((await store.queryHistory({ q: 'helpful quest' })).history.map(event => event.revision), [2]);
  assert.deepEqual((await store.queryHistory({ q: 'collect feathers' })).history.map(event => event.revision), [1]);
  assert.deepEqual((await store.queryHistory({ q: 'reed phone' })).history.map(event => event.revision), [1]);
  assert.deepEqual((await store.queryHistory({ q: 'Player' })).history.map(event => event.revision), [2, 1]);
  assert.deepEqual((await store.queryHistory({ q: 'free to play', labels })).history.map(event => event.revision), [3]);
  assert.deepEqual((await store.queryHistory({ player: 'reed' })).history.map(event => event.revision), [1]);
  assert.deepEqual((await store.queryHistory({ player: 'actor1', type: 'tasks' })).history.map(event => event.revision), [2]);
  assert.deepEqual((await store.queryHistory({ q: '[.*' })).history, []);
  assert.deepEqual((await store.queryHistory({ before: 0 })).history, []);
  assert.deepEqual((await store.queryHistory({ q: 'a river town', labels: { chunkName: () => '<b>~|A river town#link|~[+]</b>' } })).history.map(event => event.revision), [1]);
  await assert.rejects(() => store.queryHistory({ stateRevision: 2 }), { code: 'REVISION_CONFLICT' });
  for (const options of [{ limit: 0 }, { limit: 501 }, { before: NaN }, { type: 'set-note' }, { q: 'x'.repeat(201) }]) await assert.rejects(() => store.queryHistory(options), TypeError);
});

test('on-demand History details preserve large sync commands without undo snapshots', async t => {
  const store = await fixture(t);
  await store.command({ type: 'apply-runemetrics', memberId: 'actor1', runescapeName: 'Fixture One',
    fetchedAt: '2026-10-10T12:00:00.000Z', skills: [{ skill: observedSkill, level: 1, xp: 0 }], quests: [] }, 0);
  for (let revision = 1; revision < 7; revision++) await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: String(revision) }, revision);
  const page = await store.queryHistory({ before: 2 });
  assert.equal(page.history[0].command.skills, undefined);
  const details = await store.readHistoryEvent(1, { stateRevision: 7 });
  assert.deepEqual(details.event.command.skills, [{ skill: observedSkill, level: 1, xp: 0 }]);
  assert.equal(details.event.undo, undefined);
  details.event.command.skills[0].level = 99;
  assert.equal((await store.readHistoryEvent(1)).event.command.skills[0].level, 1);
  await assert.rejects(() => store.readHistoryEvent(8), { code: 'ENOENT' });
  await assert.rejects(() => store.readHistoryEvent(1, { stateRevision: 6 }), { code: 'REVISION_CONFLICT' });
});

test('restore retains the preceding live chain for paging and backup context', async t => {
  const store = await fixture(t);
  await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'Saved' }, 0, { actor });
  const backup = await store.backup();
  await store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 1);
  await store.replace(backup, 2, { actor });
  await store.command({ type: 'set-note', memberId: 'actor1', chunkId: '100', note: 'After restore' }, 3);
  const page = await store.queryHistory();
  assert.deepEqual(page.history.map(event => event.revision), [4, 3, 2, 1]);
  assert.equal(page.history[1].type, 'restore');
  assert.equal((await store.listBackups()).find(row => row.revision === 3).event.type, 'restore');
  await store.replace(backup, 4, { actor });
  assert.deepEqual((await store.queryHistory()).history.map(event => event.revision), [5, 4, 3, 2, 1]);
  const backups = await store.listBackups();
  assert.equal(backups.find(row => row.revision === 1).event.actor.label, 'Reed phone');
  assert.equal(backups.find(row => row.revision === 2).event.type, 'set-rule');
  assert.equal(backups.find(row => row.revision === 3).event.type, 'restore');
});
