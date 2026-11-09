// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { inventory } from '../scripts/linux/files.mjs';

const marker = kind => kind === 'items' ? 'rs3:goal:equipment:000dc1' : 1;
const full = kind => [...(kind === 'items' ? Array.from({ length: 1999 }, (_, i) => `custom:${i}`)
  : Array.from({ length: 19999 }, (_, i) => i + 100)), marker(kind)].sort(kind === 'items' ? undefined : (a, b) => a - b);
async function sidecar(dataDir, kind, handled = full(kind)) {
  const record = kind === 'items' ? { baselineAt: '2026-01-01T00:00:00.000Z', items: {}, handled, journal: null } : { handled };
  await writeFile(path.join(dataDir, `plugin-${kind}.json`), JSON.stringify({ v: 1, players: { owner: record } }));
}
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-retained-replay-'));
  let now = '2026-01-01T00:00:00.000Z';
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]),
    retention: { backupDays: 1, historyEntries: 10 }, now: () => now });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, store, async checkpoints() {
    for (let revision = 0; revision < 4; revision++)
      await store.command({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(revision % 2) }, revision);
    now = '2026-01-04T00:00:00.000Z'; await store.close();
    const rows = await store.listBackups();
    return { standalone: rows.find(row => row.revision === 0), archived: rows.find(row => row.revision === 1) };
  } };
}
async function rawCheckpoint(f, row, archived) {
  if (!archived) return JSON.parse(gunzipSync(await readFile(path.join(f.dataDir, 'backups', row.id))));
  await assert.rejects(readFile(path.join(f.dataDir, 'backups', row.id)), { code: 'ENOENT' });
  for (const name of await readdir(path.join(f.dataDir, 'backups', 'archives'))) {
    const pack = JSON.parse(gunzipSync(await readFile(path.join(f.dataDir, 'backups', 'archives', name))));
    const snapshot = pack.snapshots.find(snapshot => snapshot.id === row.id);
    if (snapshot) return typeof snapshot.document === 'string' ? JSON.parse(snapshot.document) : snapshot.document;
  }
  assert.fail('The real retention path must have archived the selected checkpoint');
}
for (const kind of ['items', 'achievements']) for (const archived of [false, true]) {
  const label = archived ? 'archived' : 'standalone';
  test(`${label} checkpoint capture keeps all ${kind} legacy decisions at capacity`, async t => {
    const f = await fixture(t);
    await sidecar(f.dataDir, kind); // Legacy decisions arrive after startup.
    const rows = await f.checkpoints(), row = rows[label];
    const raw = await rawCheckpoint(f, row, archived);
    assert.deepEqual(raw.optionalSidecarEvidence.entries.pluginReplaySuppression.players.owner[kind], full(kind));
    const portable = await f.store.readBackup(row.id);
    assert.deepEqual(portable.state.provenance.pluginAutoHandled.owner[kind], full(kind));
    // Optional overflow cannot veto a retained download or discard its committed policy.
    const extra = kind === 'items' ? 'custom:extra' : 2;
    const changed = [...full(kind).slice(1), extra].sort(kind === 'items' ? undefined : (a, b) => a - b);
    await sidecar(f.dataDir, kind, changed);
    const before = await inventory(f.dataDir);
    const downloaded = await f.store.readBackup(row.id);
    assert.deepEqual(downloaded.state.provenance.pluginAutoHandled.owner[kind], full(kind));
    assert.deepEqual(await inventory(f.dataDir), before);
  });

  test(`${label} portable download materializes late legacy ${kind} decisions before restore`, async t => {
    const f = await fixture(t), rows = await f.checkpoints(), row = rows[label];
    const raw = await rawCheckpoint(f, row, archived);
    assert.equal(raw.state.provenance?.pluginAutoHandled, undefined);
    await sidecar(f.dataDir, kind); // Arrives after this retained checkpoint.
    const before = await inventory(f.dataDir), portable = await f.store.readBackup(row.id);
    assert.deepEqual(portable.state.provenance.pluginAutoHandled.owner[kind], full(kind));
    assert.deepEqual(portable.optionalSidecarEvidence.entries.pluginReplaySuppression.players.owner[kind], full(kind));
    assert.deepEqual(await inventory(f.dataDir), before, 'Portable reads publish no files');
    const dest = await fixture(t);
    await dest.store.replace(portable, 0);
    assert.ok(dest.store.isPluginHandled('owner', kind, marker(kind)), 'Restoring into another picker cannot reoffer the undone task');
    await dest.store.close();
    const reopened = await openStore({ dataDir: dest.dataDir, retention: false });
    try { assert.ok(reopened.isPluginHandled('owner', kind, marker(kind))); } finally { await reopened.close(); }
  });
}
