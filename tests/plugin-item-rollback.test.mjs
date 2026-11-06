import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { frozenRuntime } from './helpers/frozen-release.mjs';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState, importBackup, validateState } from '../app/core/state.mjs';
import { portablePluginItemEvidence } from '../app/core/plugin-item-evidence.mjs';
import { exportPluginItemEvidence, openPluginItems, openPluginJournalCommits } from '../app/plugin-items.mjs';
import { mapTransferRoster } from '../app/save-transfer.mjs';

const at = '2026-11-01T12:00:00.000Z', journal = 'aaaaaaaaaaaaaaaa';
const roster = [{ id: 'a', name: 'Explorer 1' }, { id: 'b', name: 'Explorer 2' }];
const fact = { name: 'Synthetic retained item', ownedAt: at, wornAt: at, first: true };
const record = ids => ({ baselineAt: at, items: Object.fromEntries(ids.map(id => [id, fact])), handled: [], journal: { id: journal, event: 1 } });
const evidence = (ids, world = 'unknown', player = 'a') => ({ v: 1, players: { [player]: { records: { [world]: record(ids) },
  commits: { journals: [{ id: journal, committed: 1, pending: [] }] } } } });
const document = state => ({ format: 'rs3-chunk-picker', schemaVersion: 1, state });
const archived = (ids, world = 'unknown') => document({ ...createGroupState(roster), provenance: {
  restore: { incomingProvenance: { restore: { incomingProvenance: { pluginItemEvidence: evidence(ids, world) } } } } } });

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rs3-journal-rollback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('portable journals survive real frozen storage import, restore, transfer and Undo', async t => {
  const old = await frozenRuntime(t), oldCore = old.core;
  for (const world of ['unknown', 'beta']) for (const boundary of ['import', 'whole-save restore', 'member transfer', 'Undo']) await t.test(`${world}: ${boundary}`, async t => {
    const sourceDir = await directory(t), oldDir = await directory(t), destination = await directory(t);
    const source = await openStore({ dataDir: sourceDir, initialState: createGroupState(roster), retention: false });
    let portable;
    try {
      const items = await openPluginItems({ dataDir: sourceDir, journalWorld: world, members: () => roster });
      const commits = await openPluginJournalCommits({ dataDir: sourceDir, members: () => roster });
      try { await items.put('a', record([34830])); await commits.put('a', evidence([34830], world).players.a.commits); }
      finally { await items.close(); await commits.close(); }
      portable = boundary === 'member transfer' ? JSON.parse((await source.exportBackup({ dataset: {
        datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} } })).bytes.toString()) : await source.backup();
      assert.ok(portable.state.provenance.pluginItemEvidence.players.a.records[world].items[34830]);
      assert.deepEqual(portable.state.provenance.pluginItemEvidence.players, portable.optionalSidecarEvidence.entries.pluginItems.players);
      const prior = structuredClone(portable.state.provenance.pluginItemEvidence);
      prior.players.a.records[world].items[1205] = fact;
      portable.state.provenance.restore = { incomingProvenance: { pluginItemEvidence: prior } };
      portable.state.provenance.pluginItemEvidence.players.a.records[world].handled = ['synthetic-dismissed', 'unmapped:1205'];
      portable.optionalSidecarEvidence.entries.pluginItems.players.a.records[world].handled = ['synthetic-dismissed', 'unmapped:1205'];
    } finally { await source.close(); }
    if (boundary === 'member transfer') portable = document(mapTransferRoster(importBackup(portable),
      [{ id: 'x', name: 'Explorer X' }, { id: 'y', name: 'Explorer Y' }], { a: 'x', b: 'y' }));
    let frozenStore = await old.openStore({ dataDir: oldDir, initialState: boundary === 'import' || boundary === 'Undo'
      ? oldCore.importBackup(portable) : oldCore.createGroupState(roster), retention: false });
    let returned;
    try {
      if (boundary === 'whole-save restore' || boundary === 'member transfer') {
        await frozenStore.replace(portable, frozenStore.getInfo().revision);
        // A repeated restore exercises more than one incomingProvenance boundary.
        await frozenStore.replace(await frozenStore.backup(), frozenStore.getInfo().revision);
        assert.equal(frozenStore.getState().provenance.pluginItemEvidence, undefined);
      }
      const owner = boundary === 'member transfer' ? 'x' : 'a';
      await frozenStore.command({ type: 'set-journal', memberId: owner, note: 'Synthetic frozen edit' }, frozenStore.getInfo().revision);
      await frozenStore.close();
      frozenStore = await old.openStore({ dataDir: oldDir, retention: false });
      await frozenStore.command({ type: 'undo' }, frozenStore.getInfo().revision);
      returned = await frozenStore.backup();
      assert.equal(returned.optionalSidecarEvidence, undefined, 'Frozen export really discards the optional envelope');
    } finally { await frozenStore.close(); }
    const frozenOwner = boundary === 'member transfer' ? 'x' : 'a';
    assert.ok((await exportPluginItemEvidence(oldDir)).players[frozenOwner].records[world].items[34830],
      'Captured inherited evidence recovers the exact frozen disk provenance');
    const upgraded = await openStore({ dataDir: oldDir, retention: false });
    try { assert.equal(upgraded.getPluginItemEvidence().players[frozenOwner].commits.journals[0].committed, 1); }
    finally { await upgraded.close(); }
    let resumed = await openStore({ dataDir: destination, initialState: createGroupState(roster), retention: false });
    try {
      if (boundary === 'member transfer') {
        const prepared = await resumed.prepareTransfer(serialize({ backup: returned, memberId: 'b', sourceMemberId: 'x' }), {
          dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
          world: { chunks: new Map() }, route: '/api/member-restore/preview' });
        await resumed.applyTransfer(prepared.ticket, resumed.getInfo().revision);
      } else await resumed.replace(returned, resumed.getInfo().revision);
      await resumed.close();
      resumed = await openStore({ dataDir: destination, retention: false });
      const recovered = await exportPluginItemEvidence(destination), owner = boundary === 'member transfer' ? 'b' : 'a';
      assert.ok(recovered.players[owner].records[world].items[34830].wornAt);
      assert.equal(recovered.players[owner].records[world].items[1205], undefined, 'Frozen boundaries cannot refill deliberately cleared archive facts');
      assert.ok(recovered.players[owner].records[world].handled.includes('synthetic-dismissed'), 'Frozen boundaries preserve durable journal dismissals');
      assert.equal(recovered.players[owner].commits.journals[0].committed, 1);
      if (owner === 'b') assert.equal(recovered.players.a, undefined, 'Member remap does not assign evidence to the other player');
      assert.equal(resumed.getState().history.filter(row => row.command?.type === 'sync-game-plugin').length, 0);
    } finally { await resumed.close(); }
  });
});

test('archived evidence follows repeated roster mappings without resurrecting old owners', () => {
  const source = importBackup(archived([34830]));
  let mapped = mapTransferRoster(source, roster, { a: 'b', b: 'a' });
  assert.ok(validateState(mapped).provenance.pluginItemEvidence.players.b);
  mapped = mapTransferRoster(mapped, roster, { a: 'b', b: 'a' });
  const recovered = validateState(mapped).provenance.pluginItemEvidence;
  assert.ok(recovered.players.a);
  assert.equal(recovered.players.b, undefined);
  assert.deepEqual(portablePluginItemEvidence(source), evidence([34830]));
});

for (const limit of ['handled tasks', 'pending events', 'unfinished journals']) test(`frozen recovery omits overflowing optional ${limit} without vetoing gameplay`, () => {
  const state = archived([34830]).state;
  state.provenance.pluginItemEvidence = evidence([34830]);
  const root = state.provenance.pluginItemEvidence.players.a;
  const incoming = state.provenance.restore.incomingProvenance.restore.incomingProvenance.pluginItemEvidence.players.a;
  if (limit === 'handled tasks') {
    root.records.unknown.handled = Array.from({ length: 1001 }, (_, i) => `synthetic-a-${String(i).padStart(4, '0')}`);
    incoming.records.unknown.handled = Array.from({ length: 1000 }, (_, i) => `synthetic-b-${String(i).padStart(4, '0')}`);
  } else if (limit === 'pending events') {
    root.commits.journals = [{ id: journal, committed: 0, pending: Array.from({ length: 129 }, (_, i) => [i + 129, 34830, 'Synthetic pending', 'unknown']) }];
    incoming.commits.journals = [{ id: journal, committed: 0, pending: Array.from({ length: 128 }, (_, i) => [i + 1, 34830, 'Synthetic pending', 'unknown']) }];
  } else {
    const unfinished = i => ({ id: i.toString(16).padStart(16, '0'), committed: 0, pending: [[1, 34830, 'Synthetic pending', 'unknown']] });
    root.commits.journals = Array.from({ length: 5 }, (_, i) => unfinished(i));
    incoming.commits.journals = Array.from({ length: 4 }, (_, i) => unfinished(i + 5));
  }
  assert.deepEqual(validateState(state).members, state.members);
  assert.equal(portablePluginItemEvidence(state), undefined);
});

for (const world of ['unknown', 'beta']) for (const entrypoint of ['load', 'replace', 'preview', 'transfer', 'member']) test(`${world}: ${entrypoint} remains available with an oversized optional frozen provenance union`, async t => {
  const full = Array.from({ length: 500 }, (_, index) => 10000 + index), incoming = archived(full, world);
  if (entrypoint === 'load') {
    incoming.state.provenance.pluginItemEvidence = evidence([34830], world);
    assert.deepEqual(importBackup(incoming).members, incoming.state.members);
    return;
  }
  const dir = await directory(t), initialState = createGroupState(roster);
  initialState.provenance = { pluginItemEvidence: evidence([34830], world) };
  const store = await openStore({ dataDir: dir, initialState, retention: false });
  try {
    const before = await readFile(path.join(dir, 'state.json')), state = store.getState();
    const options = { dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
      world: { chunks: new Map() }, route: entrypoint === 'member' ? '/api/member-restore/preview' : '/api/restore/preview' };
    const operation = entrypoint === 'replace' ? () => store.replace(incoming, state.revision)
      : entrypoint === 'preview' ? () => store.previewReplacement(incoming)
        : () => store.prepareTransfer(serialize({ backup: incoming, ...(entrypoint === 'member' ? { memberId: 'a', sourceMemberId: 'a' } : {}) }), options);
    const result = await operation();
    if (['transfer', 'member'].includes(entrypoint)) await store.applyTransfer(result.ticket, state.revision);
    if (entrypoint === 'preview') assert.deepEqual(await readFile(path.join(dir, 'state.json')), before);
    else assert.equal(store.getInfo().revision, state.revision + 1);
    assert.ok((await store.backup()).state);
  } finally { await store.close(); }
});
