import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { importBackup as loadRollbackBackup, applyCommand as rollbackCommand } from './fixtures/rollback-main/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { mapTransferRoster } from '../app/save-transfer.mjs';
import { withOptionalSidecarEvidence } from '../app/optional-sidecar-evidence.mjs';

const roster = [{ id: 'synthetic-player', name: 'Synthetic player', runescapeName: 'FixtureActor' }];
const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} };
const world = { chunks: new Map() };
const now = '2026-11-04T12:05:00.000Z';

for (const sourceId of ['manual.name', 'x'.repeat(65), 'x'.repeat(80)]) test(`worker restore maps roster source IDs with and without evidence (${sourceId.length} characters)`, async t => {
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer 1' }, { id: 'partner', name: 'Explorer 2' }]);
  const { store } = await scratch(t, { initialState });
  const incoming = createGroupState([{ id: 'source', name: 'Source explorer' }, { id: sourceId, name: 'Second explorer' }]);
  incoming.provenance = { pluginAutoHandled: { source: { achievements: [1], items: ['custom:sample'] } } };
  for (const evidence of [false, true]) {
    const backup = evidence ? await withOptionalSidecarEvidence(exportBackup(incoming)) : exportBackup(incoming);
    const reviewed = await store.prepareTransfer(serialize({ backup, rosterMapping: { source: 'owner', [sourceId]: 'partner' } }),
      { dataset, world, route: '/api/restore/preview' });
    assert.equal(store.getInfo().revision, 0, 'Both previews leave the destination untouched');
    if (evidence) await store.applyTransfer(reviewed.ticket, 0);
  }
  assert.deepEqual(store.getState().provenance.pluginAutoHandled, { owner: { achievements: [1], items: ['custom:sample'] } });
});
function platformSave() {
  const state = createGroupState(roster);
  state.tasks = [{ id: 'synthetic-quest', category: 'Quest', label: 'Synthetic quest' }];
  return applyCommand(state, { type: 'apply-runemetrics', source: 'platform-api', memberId: roster[0].id,
    runescapeName: roster[0].runescapeName, fetchedAt: '2026-11-04T12:00:00Z',
    skills: [{ skill: 'Attack', level: 7, xp: 700 }], quests: [{ taskId: state.tasks[0].id, title: state.tasks[0].label }] });
}
async function scratch(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'synthetic-transfer-platform-'));
  const store = await openStore({ dataDir, initialState: createGroupState(roster), retention: false, now: () => now, ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, store };
}

for (const entrypoint of ['member-upload', 'member-retained', 'member-noop', 'whole-upload', 'whole-retained', 'import', 'direct-worker', 'direct-hook']) {
  test(`${entrypoint} reconciles mapped replay suppression with destination decisions`, async t => {
    const owner = roster[0].id, initialState = createGroupState([...roster, { id: 'partner', name: 'Destination partner' }]);
    initialState.provenance = { pluginAutoHandled: {
      [owner]: { achievements: [9], items: ['custom:previous'] },
      partner: { achievements: [7], items: ['custom:partner'] },
    } };
    const { store, dataDir } = await scratch(t, { initialState,
      ...(entrypoint === 'direct-hook' ? { prepareState: state => state } : {}) });
    const incoming = createGroupState([{ ...roster[0], id: 'source',
      ...(entrypoint !== 'member-noop' ? { name: 'Source explorer', runescapeName: 'SourceActor' } : {}) }, ...roster]);
    incoming.provenance = { pluginAutoHandled: {
      source: { achievements: [1, 1], items: ['custom:incoming', 'custom:incoming'] },
      [owner]: { achievements: [2], items: ['custom:other'] },
      absent: { achievements: [3], items: ['custom:absent'] },
    } };
    const member = entrypoint.startsWith('member'), backup = exportBackup(incoming);
    const expected = { [owner]: { achievements: [1, 9], items: ['custom:incoming', 'custom:previous'] },
      partner: { achievements: member ? [7] : [2, 7], items: member ? ['custom:partner'] : ['custom:other', 'custom:partner'] } };
    if (entrypoint.startsWith('direct')) {
      const mapped = mapTransferRoster(incoming, roster, { source: owner, [owner]: 'partner' });
      const preview = await store.previewReplacement(mapped);
      assert.deepEqual(preview.state.provenance.pluginAutoHandled, expected);
      await store.replace(mapped, 0);
    } else {
      const backupId = '0000000000000000-0123456789abcdef.json.gz';
      if (entrypoint.endsWith('retained')) await writeFile(path.join(dataDir, 'backups', backupId), gzipSync(JSON.stringify(backup)));
      const reviewed = await store.prepareTransfer(serialize({
        ...(entrypoint.endsWith('retained') ? { backupId } : { backup }),
        ...(member ? { memberId: owner, sourceMemberId: 'source' } : { rosterMapping: { source: owner, [owner]: 'partner' } }),
      }), { dataset, world, route: member ? '/api/member-restore/preview' : entrypoint === 'import' ? '/api/import/preview' : '/api/restore/preview' });
      assert.deepEqual(store.getState(), initialState, 'Preview does not publish replay policy');
      await store.applyTransfer(reviewed.ticket, 0);
    }
    assert.deepEqual(store.getState().provenance.pluginAutoHandled, expected);
    if (!member) assert.deepEqual(store.getState().provenance.restore.incomingProvenance.pluginAutoHandled[owner].achievements,
      [1, 1], 'Archived source evidence is separate from the reconciled live replay policy');
    assert.deepEqual(loadRollbackBackup(await store.backup()), store.getState(), 'Previously live release can load the additive extension');
    if (member && entrypoint !== 'member-noop') {
      const rollback = rollbackCommand(loadRollbackBackup(await store.backup()), { type: 'undo' });
      assert.deepEqual(rollback.provenance.pluginAutoHandled, expected, 'Old-release Undo retains replay decisions');
      await store.command({ type: 'undo' }, store.getInfo().revision);
      assert.deepEqual(store.getState().provenance.pluginAutoHandled, expected, 'Member restore Undo retains replay decisions');
    }
    assert.deepEqual(incoming.provenance.pluginAutoHandled.source.achievements, [1, 1], 'Source backup is unchanged');
    const reopened = await openStore({ dataDir, readOnly: true });
    try { assert.deepEqual(reopened.getState().provenance.pluginAutoHandled, expected, 'Replay policy survives reopening the saved bytes'); }
    finally { await reopened.close(); }
  });
}

for (const member of [false, true]) test(`optional evidence envelope survives ${member ? 'member' : 'whole-picker'} restore, export and retained backup`, async t => {
  const owner = roster[0].id, initialState = createGroupState(roster);
  initialState.provenance = { pluginAutoHandled: { [owner]: { achievements: [9], items: ['custom:previous'] } } };
  const { store } = await scratch(t, { initialState });
  const source = createGroupState([{ id: 'source', name: 'Source explorer' }]);
  const backup = exportBackup(source);
  backup.optionalSidecarEvidence = { schemaVersion: 1, entries: {
    pluginReplaySuppression: { version: 1, players: { source: { achievements: [1], items: ['custom:exported'] } } },
    syntheticEvidence: { version: 1, players: { source: { labels: ['Synthetic evidence'] } } },
  } };
  const reviewed = await store.prepareTransfer(serialize({ backup,
    ...(member ? { memberId: owner, sourceMemberId: 'source' } : { rosterMapping: { source: owner } }) }),
  { dataset, world, route: member ? '/api/member-restore/preview' : '/api/restore/preview' });
  await store.applyTransfer(reviewed.ticket, 0);
  assert.equal(store.isPluginHandled(owner, 'achievements', 1), true);
  assert.equal(store.isPluginHandled(owner, 'items', 'custom:exported'), true);
  assert.equal(store.isPluginHandled(owner, 'achievements', 9), true);
  const exported = JSON.parse((await store.exportBackup({ dataset })).bytes.toString());
  assert.deepEqual(exported.optionalSidecarEvidence.entries.pluginReplaySuppression.players[owner],
    { achievements: [1, 9], items: ['custom:exported', 'custom:previous'] });
  assert.deepEqual(exported.optionalSidecarEvidence.entries.syntheticEvidence.players, { [owner]: { labels: ['Synthetic evidence'] } });
  assert.deepEqual(loadRollbackBackup(exported), exported.state);
  // A subsequent replacement retains this exact evidence in its preimage.
  const revision = store.getInfo().revision;
  await store.replace(store.getState(), revision);
  const retained = (await store.listBackups()).find(backup => backup.revision === revision);
  const restored = await store.readBackup(retained.id);
  assert.deepEqual(restored.state.provenance.optionalSidecarEvidence.entries.syntheticEvidence,
    exported.optionalSidecarEvidence.entries.syntheticEvidence);
});
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
      if (phase === 'temp-sync') {
        assert.equal(publishedBackup, undefined, 'A failure before the final union gate publishes no backup');
        assert.deepEqual(await readdir(backups), []);
      } else {
        const retained = JSON.parse(gunzipSync(await readFile(publishedBackup)));
        assert.equal(retained.retentionPinned, true);
        delete retained.retentionPinned;
        assert.deepEqual(retained, JSON.parse(previous));
      }
      assert(!(await readdir(dataDir)).some(name => name.endsWith('.tmp')));
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  });
}
