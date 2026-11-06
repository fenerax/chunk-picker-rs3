// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('failure to checkpoint optional legacy folding cannot block startup or discard current atomic decisions', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-optional-checkpoint-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initialState = createGroupState([{ id: 'owner', name: 'Explorer' }]);
  initialState.provenance = { pluginAutoHandled: { owner: { items: ['custom:committed'], achievements: [] } } };
  const seed = await openStore({ dataDir, initialState, retention: false });
  await seed.close();
  const file = path.join(dataDir, 'state.json'), before = await readFile(file);
  await writeFile(path.join(dataDir, 'plugin-achievements.json'), JSON.stringify({ v: 1, players: { owner: { handled: [1] } } }));
  const rename = fs.promises.rename;
  let failures = 0;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === file) { failures++; throw Object.assign(new Error('Synthetic optional checkpoint failure'), { code: 'EIO' }); }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  let store;
  try {
    store = await openStore({ dataDir, retention: false });
    assert.ok(failures);
    assert.ok(store.isPluginHandled('owner', 'items', 'custom:committed'));
    assert.equal(store.getInfo().revision, 0);
    assert.ok((await store.backup()).state);
    assert.deepEqual(await readFile(file), before);
  } finally { await store?.close(); t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('optional fallback does not catch malformed gameplay', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rs3-optional-gameplay-'));
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]), retention: false });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const invalid = store.getState(); invalid.members[0].unlocked = ['invalid'];
  invalid.provenance = { optionalSidecarEvidence: { schemaVersion: 99 } };
  await assert.rejects(store.replace(invalid, 0), /chunk/i);
  assert.equal(store.getInfo().revision, 0);
});
