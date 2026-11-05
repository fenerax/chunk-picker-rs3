import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createGroupState, importBackup } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { openPluginKeys } from '../app/plugin-keys.mjs';
import { writeRegistryJson, lockRegistry } from '../app/storage/registry-lock.mjs';

const root = fileURLToPath(new URL('../.local/durability-tests/', import.meta.url));
const firstDay = '2026-01-01T00:00:00.000Z', nextDay = '2026-01-02T00:00:00.000Z';
const questPoints = new Map();
const initialState = () => createGroupState([{ id: 'synthetic-player', name: 'Synthetic player' }]);
async function directory(t) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'save-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('startup retains the exact previous save before adding daily observations without a revision or format change', async t => {
  const dataDir = await directory(t);
  const initial = await openStore({ dataDir, initialState: initialState(), progressQuestPoints: questPoints, now: firstDay });
  await initial.close();
  const file = path.join(dataDir, 'state.json'), previous = await readFile(file);
  const before = new Set(await readdir(path.join(dataDir, 'backups')));
  const loaded = await openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay });
  t.after(() => loaded.close());
  const added = (await readdir(path.join(dataDir, 'backups'))).filter(name => !before.has(name));
  assert.equal(added.length, 1);
  const retained = gunzipSync(await readFile(path.join(dataDir, 'backups', added[0])));
  assert.deepEqual(retained, previous);
  const oldDocument = JSON.parse(previous), newDocument = JSON.parse(await readFile(file));
  assert.equal(newDocument.format, oldDocument.format);
  assert.equal(newDocument.schemaVersion, oldDocument.schemaVersion);
  const oldState = importBackup(retained.toString('utf8')), newState = importBackup(newDocument);
  assert.equal(newState.progressSnapshots.days.length, 2);
  assert.equal(oldState.progressSnapshots.days.length, 1);
  assert.equal(newState.revision, oldState.revision);
  assert.deepEqual(newState.history, oldState.history);
  delete oldState.progressSnapshots; delete newState.progressSnapshots;
  assert.deepEqual(newState, oldState);
  assert((await loaded.listBackups()).some(backup => backup.id === added[0]));
  await loaded.close();
  // An unchanged observation must not add another backup or rewrite the save.
  const saved = await readFile(file), backups = await readdir(path.join(dataDir, 'backups'));
  const unchanged = await openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay });
  await unchanged.close();
  assert.deepEqual(await readFile(file), saved);
  assert.deepEqual(await readdir(path.join(dataDir, 'backups')), backups);
});

test('a startup observation leaves state.json untouched if retaining the previous save fails', async t => {
  const dataDir = await directory(t);
  const initial = await openStore({ dataDir, initialState: initialState(), progressQuestPoints: questPoints, now: firstDay });
  await initial.close();
  const file = path.join(dataDir, 'state.json'), previous = await readFile(file);
  const rename = fs.promises.rename, failure = Object.assign(new Error('Synthetic backup publication failure'), { code: 'ENOSPC' });
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (path.dirname(to) === path.join(dataDir, 'backups')) throw failure;
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay }), error => error === failure);
  assert.deepEqual(await readFile(file), previous);
  assert(!(await readdir(dataDir)).includes('store.lock'));
});

test('plugin key publication preserves hash-only credentials and revocation across reopen', async t => {
  const dataDir = await directory(t);
  const keys = await openPluginKeys({ dataDir });
  const { key, record } = await keys.create('synthetic-player', 'Synthetic plugin');
  const saved = await readFile(path.join(dataDir, 'plugin-keys.json'), 'utf8');
  assert(!saved.includes(key));
  assert.equal(keys.authenticate({ headers: { authorization: `Bearer ${key}` } }).id, record.id);
  await keys.revoke(record.id); await keys.close();
  const reopened = await openPluginKeys({ dataDir });
  t.after(() => reopened.close());
  assert.equal(reopened.list()[0].revoked, true);
  assert.throws(() => reopened.authenticate({ headers: { authorization: `Bearer ${key}` } }), { status: 401 });
});

test('registry JSON and its exclusive lock retain their shared publication API', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'registry.json');
  const release = await lockRegistry(dataDir);
  try {
    const document = { schemaVersion: 1, entries: [] };
    await writeRegistryJson(file, document);
    assert.deepEqual(JSON.parse(await readFile(file)), document);
    await assert.rejects(lockRegistry(dataDir), { code: 'REGISTRY_LOCKED' });
  } finally { await release(); }
  const next = await lockRegistry(dataDir); await next();
});
