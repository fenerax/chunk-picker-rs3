// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { importBackup } from '../app/core/state.mjs';
import { buildSaveCorpus, storeOptions, scratch } from './helpers/save-surface-corpus.mjs';
import { frozenRuntime, requireFrozenCommit } from './helpers/frozen-release.mjs';
import { preservationDigest, assertNeverShrinks, pluginEvidenceFiles } from './helpers/save-surface.mjs';

test('the actual frozen release opens, Undoes, writes and exports the current feature corpus without evidence loss', async t => {
  const frozen = await frozenRuntime(t), corpus = await buildSaveCorpus(t);
  for (const { name, dataDir, options } of corpus.cases) await t.test(`real frozen release: ${name}`, async () => {
    let store = await openStore({ ...storeOptions, ...options, dataDir });
    const memberId = store.getState().members[0].id;
    const originalNotes = store.getState().members[0].notes;
    let before;
    try {
      await store.command({ type: 'set-note', memberId, chunkId: '100', note: 'Synthetic frozen sentinel' }, store.getInfo().revision);
      before = (await store.backup()).state;
      // Portable capture adds a redundant registered capsule. Compare the
      // provenance actually committed for the frozen runtime to read; the
      // portable round trip below separately checks exported carriers.
      const committedCapsule = store.getState().provenance?.optionalSidecarEvidence;
      if (before.provenance) {
        if (committedCapsule === undefined) delete before.provenance.optionalSidecarEvidence;
        else before.provenance.optionalSidecarEvidence = committedCapsule;
      }
    } finally { await store.close(); }
    let checkpoint = preservationDigest(before, await pluginEvidenceFiles(dataDir));
    const verify = async (state, label) => {
      const after = preservationDigest(state, await pluginEvidenceFiles(dataDir));
      assertNeverShrinks(checkpoint, after, label); checkpoint = after;
    };
    store = await frozen.openStore({ ...storeOptions, dataDir });
    let exported;
    try {
      await verify((await store.backup()).state, 'frozen open');
      const revision = store.getInfo().revision;
      const afterUndo = await store.command({ type: 'undo' }, revision);
      assert.equal(afterUndo.revision, revision + 1, 'Frozen Undo really publishes a new revision');
      assert.deepEqual(afterUndo.members[0].notes, originalNotes, 'Frozen Undo reverses the sentinel');
      await verify((await store.backup()).state, 'frozen Undo/write');
      // Exercise the old sidecar readers and writers, retaining existing records.
      const members = () => store.getState().members;
      const items = await frozen.items.openPluginItems({ dataDir, members });
      const achievements = await frozen.achievements.openPluginAchievements({ dataDir, members });
      try {
        const retained = items.get(memberId);
        if (retained) await items.put(memberId, retained);
        await achievements.add(memberId, [100]);
      } finally { await items.close(); await achievements.close(); }
      exported = frozen.core.exportBackup((await store.backup()).state);
      await verify(exported.state, 'frozen sidecar write/export');
      assert.deepEqual(frozen.core.importBackup(exported), exported.state, 'Frozen export is portable');
    } finally { await store.close(); }
    const frozenDisk = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
    assert.equal(frozenDisk.pluginCurrency, undefined, 'The frozen writer drops the declared private currency ledger');
    store = await openStore({ ...storeOptions, ...options, dataDir });
    try {
      const forward = (await store.backup()).state;
      await verify(forward, 'current reopen');
      assert.deepEqual(forward.members, exported.state.members);
      assert.deepEqual(forward.tasks, before.tasks);
    } finally { await store.close(); }
    // Sidecars are separately retained in the data directory. The portable
    // assertion checks only carriers that this format actually exports.
    const imported = await openStore({ ...storeOptions, dataDir: await scratch(t, 'export'), initialState: importBackup(exported) });
    try { assertNeverShrinks(preservationDigest(exported.state, {}), preservationDigest((await imported.backup()).state, {}), 'current opens frozen export'); }
    finally { await imported.close(); }
  });
});

test('missing frozen history is a failure even when a checkout cache is available', async t => {
  const directory = await scratch(t, 'missing-history');
  await promisify(execFile)('git', ['init', directory], { windowsHide: true });
  await assert.rejects(requireFrozenCommit(directory), /Required frozen rollback commit .* is missing/);
});
