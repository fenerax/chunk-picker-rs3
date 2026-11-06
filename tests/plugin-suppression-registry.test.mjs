// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { frozenRuntime } from './helpers/frozen-release.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';

const at = '2026-11-01T12:00:00.000Z';
const roster = [{ id: 'source', name: 'Explorer 1' }, { id: 'second', name: 'Explorer 2' }];
const record = world => ({ baselineAt: at, items: { 857: { name: 'Synthetic bow', ownedAt: at, wornAt: null, first: true } },
  handled: [`custom:${world}`], journal: null });
async function directory(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-registry-acceptance-'));
  t.after(() => rm(dataDir, { recursive: true, force: true })); return dataDir;
}
test('a real #133 export restores and transfers through the registered pluginItems entry', async t => {
  const prior = await frozenRuntime(t, { release: '18206f72f19ab1d6dd127fad56dc5c4946dd919f' });
  const dataDir = await directory(t), source = await prior.openStore({ dataDir, initialState: createGroupState(roster), retention: false });
  let exported;
  try {
    for (const world of ['live', 'beta', 'unknown']) {
      const items = await prior.items.openPluginItems({ dataDir, members: () => roster, ...(world === 'live' ? {} : { journalWorld: world }) });
      try { await items.put('source', record(world)); } finally { await items.close(); }
    }
    exported = await source.backup();
  } finally { await source.close(); }
  assert.equal(exported.optionalSidecarEvidence.schemaVersion, 1);
  assert.deepEqual(Object.keys(exported.optionalSidecarEvidence.entries), ['pluginItems']);
  const restoredDir = await directory(t), restored = await openStore({ dataDir: restoredDir, initialState: createGroupState(roster), retention: false });
  try {
    await restored.replace(exported, 0);
    assert.equal(restored.isPluginHandled('source', 'items', 'custom:live'), true);
    assert.equal(restored.isPluginHandled('source', 'items', 'custom:beta'), false);
    const portable = await restored.backup();
    assert.ok(portable.optionalSidecarEvidence.entries.pluginItems.players.source.records.unknown.items[857]);
    const destinationDir = await directory(t), destination = await openStore({ dataDir: destinationDir,
      initialState: createGroupState([{ id: 'owner', name: 'Explorer 3' }, { id: 'partner', name: 'Explorer 4' }]), retention: false });
    try {
      const prepared = await destination.prepareTransfer(serialize({ backup: portable, memberId: 'partner', sourceMemberId: 'source' }), {
        dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() }, route: '/api/member-restore/preview' });
      await destination.applyTransfer(prepared.ticket, 0);
      const evidence = (await destination.backup()).optionalSidecarEvidence.entries.pluginItems.players;
      assert.deepEqual(Object.keys(evidence), ['partner']);
      for (const world of ['live', 'beta', 'unknown']) assert.deepEqual(evidence.partner.records[world].handled, record(world).handled);
      assert.equal(destination.isPluginHandled('partner', 'items', 'custom:live'), true);
      assert.equal(destination.isPluginHandled('owner', 'items', 'custom:live'), false);
    } finally { await destination.close(); }
  } finally { await restored.close(); }
});

for (const archived of [false, true]) test(`${archived ? 'archived' : 'standalone'} downloads capture late file-backed journal evidence through the registry`, async t => {
  const dataDir = await directory(t);
  let now = '2026-01-01T00:00:00.000Z';
  const store = await openStore({ dataDir, initialState: createGroupState(roster), retention: { backupDays: 1, historyEntries: 10 }, now: () => now });
  try {
    for (let revision = 0; revision < 4; revision++) await store.command({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(revision % 2) }, revision);
    now = '2026-01-04T00:00:00.000Z'; await store.close();
    const row = (await store.listBackups()).find(row => row.revision === (archived ? 1 : 0));
    await writeFile(path.join(dataDir, 'plugin-item-journal-beta.json'), JSON.stringify({ v: 1, players: { source: record('beta') } }));
    const download = await store.readBackup(row.id);
    assert.deepEqual(download.optionalSidecarEvidence.entries.pluginItems.players.source.records.beta, record('beta'));
    assert.deepEqual(download.state.provenance.pluginItemEvidence.players.source.records.beta, record('beta'));
    assert.equal(download.state.provenance.pluginAutoHandled?.source?.items.includes('custom:beta') ?? false, false);
  } finally { await store.close(); }
});
