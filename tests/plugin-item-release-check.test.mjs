import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { pluginItemFiles, openPluginItems, openPluginJournalCommits, exportPluginItemEvidence } from '../app/plugin-items.mjs';
import { saveIdentity, snapshot, assertPreserved } from '../scripts/private-companion/release-pack-check.mjs';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';

test('release-pack snapshots copy and hash every durable journal file and retain recoverable evidence', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-release-journals-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'), destination = path.join(directory, 'snapshot');
  const members = [{ id: 'synthetic', name: 'Explorer' }], at = '2026-11-01T12:00:00.000Z';
  const store = await openStore({ dataDir: source, initialState: createGroupState(members), retention: false });
  try {
    for (const [journalWorld, id] of [[undefined, 857], ['unknown', 34830], ['beta', 1205]]) {
      const items = await openPluginItems({ dataDir: source, members: () => members, journalWorld });
      try { await items.put('synthetic', { baselineAt: at, items: { [id]: { name: 'Synthetic retained item', ownedAt: at, wornAt: at, first: true } },
        handled: ['synthetic-dismissed'], journal: { id: 'aaaaaaaaaaaaaaaa', event: 3 } }); }
      finally { await items.close(); }
    }
    const commits = await openPluginJournalCommits({ dataDir: source, members: () => members });
    try { await commits.put('synthetic', { journals: [{ id: 'aaaaaaaaaaaaaaaa', committed: 3, pending: [[4, 999999, 'Synthetic pending item', 'unknown']] }] }); }
    finally { await commits.close(); }
  } finally { await store.close(); }
  const before = await saveIdentity(source);
  assert.deepEqual(before.filter(row => pluginItemFiles.includes(row.path)).map(row => row.path).sort(), [...pluginItemFiles].sort());
  await snapshot(source, destination);
  assert.deepEqual(await saveIdentity(destination), before);
  for (const file of pluginItemFiles) assert.deepEqual(await readFile(path.join(destination, file)), await readFile(path.join(source, file)));
  assert.deepEqual(await exportPluginItemEvidence(destination), await exportPluginItemEvidence(source));
  const reopened = await openStore({ dataDir: destination, retention: false });
  try { assert.deepEqual((await reopened.backup()).state.provenance.pluginItemEvidence, await exportPluginItemEvidence(source)); }
  finally { await reopened.close(); }
  await writeFile(path.join(source, 'plugin-item-journal-commits.json'), JSON.stringify({ v: 1, players: {} }));
  assert.notDeepEqual(await saveIdentity(source), before, 'Overwriting the commit ledger must change the checked identity');
});

test('release probes refuse changed sidecars, missing hashes and equal-count recovered-evidence replacement', () => {
  const base = { taskIds: [], historyEvents: [], historyTypes: [], migrationArchives: [], migrationConversions: [], migrationConflicts: [],
    progressFields: {}, progressDigest: 'same', itemEvidenceFiles: [{ path: 'plugin-item-journal-commits.json', sha256: 'a'.repeat(64) }],
    itemEvidenceDigest: digestValue({ synthetic: 'retained fact' }) };
  assert.doesNotThrow(() => assertPreserved(base, structuredClone(base)));
  assert.throws(() => assertPreserved(base, { ...base, itemEvidenceFiles: [] }), /sidecars changed/);
  assert.throws(() => assertPreserved(base, { ...base, itemEvidenceFiles: undefined }), /sidecars changed/);
  assert.throws(() => assertPreserved(base, { ...base, itemEvidenceDigest: digestValue({ synthetic: 'replacement fact' }) }), /Recovered plugin item evidence changed/);
});
