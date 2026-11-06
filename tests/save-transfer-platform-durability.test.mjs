import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { gunzipSync } from 'node:zlib';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { importBackup as loadRollbackBackup } from './fixtures/rollback-main/state.mjs';
import { openStore } from '../app/storage/store.mjs';

const roster = [{ id: 'synthetic-player', name: 'Synthetic player', runescapeName: 'FixtureActor' }];
const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} };
const world = { chunks: new Map() };
const now = '2026-11-04T12:05:00.000Z';
function platformSave() {
  const state = createGroupState(roster);
  state.tasks = [{ id: 'synthetic-quest', category: 'Quest', label: 'Synthetic quest' }];
  return applyCommand(state, { type: 'apply-runemetrics', source: 'platform-api', memberId: roster[0].id,
    runescapeName: roster[0].runescapeName, fetchedAt: '2026-11-04T12:00:00Z',
    skills: [{ skill: 'Attack', level: 7, xp: 700 }], quests: [{ taskId: state.tasks[0].id, title: state.tasks[0].label }] });
}
async function scratch(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'synthetic-transfer-platform-'));
  const store = await openStore({ dataDir, initialState: createGroupState(roster), retention: false, now: () => now });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, store };
}
function prepare(store, backup, member = false) {
  return store.prepareTransfer(serialize({ backup,
    ...(member ? { memberId: roster[0].id, sourceMemberId: roster[0].id } : {}) }),
  { dataset, world, route: member ? '/api/member-restore/preview' : '/api/restore/preview' });
}

for (const member of [false, true]) test(`worker ${member ? 'member' : 'whole-picker'} restore preserves Platform provenance and rollback loading`, async t => {
  const { dataDir, store } = await scratch(t), source = platformSave();
  const review = await prepare(store, exportBackup(source), member);
  const { state } = await store.applyTransfer(review.ticket, 0);
  const durable = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(state.history.at(-1).at, now, 'worker keeps the writer clock');
  assert.deepEqual(loadRollbackBackup(durable), state);
  assert.equal(state.members[0].runeMetricsSync.source, 'official-api');
  assert.equal(state.members[0].skillProgress.Attack.source, 'official-api');
  assert.equal(state.members[0].questProgress['synthetic-quest'].source, 'official-api');
  if (member) {
    const undone = await store.command({ type: 'undo' }, state.revision);
    assert.equal(undone.members[0].runeMetricsSync, undefined);
    assert.deepEqual(loadRollbackBackup(await store.backup()), undone);
  } else {
    assert.equal(state.provenance.restore.incomingHistory.at(-1).command.source, 'platform-api');
  }
  const invalid = exportBackup(source);
  invalid.state.members[0].runeMetricsSync.source = 'platform-api';
  const previous = await readFile(path.join(dataDir, 'state.json'));
  await assert.rejects(prepare(store, invalid, member), /source must be runemetrics, official-api or hiscores/);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), previous);
});

for (const phase of ['backup-sync', 'temp-sync', 'rename', 'directory-sync']) {
  test(`worker restore keeps atomic publication and durability policy during ${phase} failure`, async t => {
    const { dataDir, store } = await scratch(t);
    const review = await prepare(store, exportBackup(platformSave()));
    const file = path.join(dataDir, 'state.json'), previous = await readFile(file), original = store.getState();
    const backups = path.join(dataDir, 'backups'), { open, rename } = fs.promises;
    const failure = Object.assign(new Error('Synthetic transfer publication failure'), { code: 'EIO' });
    let publishedBackup, publishedState = false, tempSynced = false, directorySynced = false;
    const warnings = [];
    t.mock.method(fs.promises, 'rename', async (from, to) => {
      if (to === file) {
        assert(tempSynced, 'replacement bytes must be synced before rename');
        assert(publishedBackup, 'previous save must be retained first');
        if (phase === 'rename') throw failure;
      }
      await rename(from, to);
      if (path.dirname(to) === backups) publishedBackup = to;
      if (to === file) publishedState = true;
    });
    t.mock.method(fs.promises, 'open', async (target, flags, ...options) => {
      if (flags === 'r' && ((phase === 'backup-sync' && publishedBackup && target === backups)
        || (publishedState && target === dataDir))) {
        return { async sync() { directorySynced = true; throw failure; }, async close() {} };
      }
      const handle = await open(target, flags, ...options);
      if (typeof target === 'string' && target.startsWith(file + '.') && flags === 'wx') {
        const sync = handle.sync.bind(handle);
        t.mock.method(handle, 'sync', async () => {
          if (phase === 'temp-sync') throw failure;
          await sync(); tempSynced = true;
        });
      }
      return handle;
    });
    t.mock.method(console, 'warn', message => {
      assert.equal(store.getState().revision, 1, 'adopt published state before warning');
      warnings.push(message);
    });
    syncBuiltinESMExports();
    try {
      if (phase === 'directory-sync') {
        const applied = await store.applyTransfer(review.ticket, 0);
        assert(directorySynced);
        assert.deepEqual(importBackup(await readFile(file, 'utf8')), applied.state);
        assert.deepEqual(loadRollbackBackup(await store.backup()), applied.state);
        assert.equal(store.getInfo().durabilityWarnings, 1);
        assert.equal(warnings.length, 1);
      } else {
        await assert.rejects(store.applyTransfer(review.ticket, 0), error => error === failure);
        assert.deepEqual(await readFile(file), previous);
        assert.deepEqual(store.getState(), original);
        assert.equal(store.getInfo().durabilityWarnings, 0);
        assert.deepEqual(warnings, []);
      }
      const retained = JSON.parse(gunzipSync(await readFile(publishedBackup)));
      assert.equal(retained.retentionPinned, true);
      delete retained.retentionPinned;
      assert.deepEqual(retained, JSON.parse(previous));
      assert(!(await readdir(dataDir)).some(name => name.endsWith('.tmp')));
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  });
}
