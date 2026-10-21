import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { applyCommand, createGroupState, exportBackup, importBackup } from '../app/core/state.mjs';

async function directory(t) {
  const root = path.resolve('.local', 'storage-owned-load-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
const original = () => exportBackup(createGroupState([{ id: 'actor1', name: 'Player' }]));

test('private-file owned validation preserves public import errors and rejects without replacing evidence', async t => {
  const unsafe = original();
  unsafe.state.members[0].taskStatus = JSON.parse('{"__proto__":{"note":"unsafe"}}');
  const unknownReference = original();
  unknownReference.state.members[0].completedTasks = ['unknown task'];
  const invalidRevision = original();
  invalidRevision.state.revision = -1;
  const nonfinite = JSON.stringify(original()).replace('"revision":0', '"revision":1e999');
  const documents = ['{broken', 'null', '[]', JSON.stringify({ ...original(), format: 'wrong' }),
    JSON.stringify({ ...original(), schemaVersion: 99 }), JSON.stringify({ ...original(), state: null }),
    JSON.stringify(unsafe), JSON.stringify(unknownReference), JSON.stringify(invalidRevision), nonfinite];
  for (const bytes of documents) {
    let expected;
    assert.throws(() => importBackup(bytes), error => { expected = error.message; return true; });
    const dataDir = await directory(t);
    await writeFile(path.join(dataDir, 'state.json'), bytes);
    await assert.rejects(() => openStore({ dataDir }), error => error.cause?.message === expected);
    assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
    assert.deepEqual(await readdir(path.join(dataDir, 'backups')), []);
    assert(!(await readdir(dataDir)).includes('store.lock'));
  }
});

test('load preparation that only reorders object keys preserves the revision, bytes and backups', async t => {
  const dataDir = await directory(t);
  const state = applyCommand(createGroupState([{ id: 'actor1', name: 'Player' }]),
    { type: 'set-rule', ruleId: 'access.shared', value: false }, { now: '2026-10-07T12:00:00.000Z' });
  const bytes = `${JSON.stringify(exportBackup(state), null, 2)}\n`;
  await writeFile(path.join(dataDir, 'state.json'), bytes);
  let retainedInput;
  const store = await openStore({ dataDir, prepareState(input) {
    retainedInput = input;
    return Object.fromEntries(Object.entries(input).reverse());
  } });
  t.after(() => store.close());
  retainedInput.members[0].name = 'Hook retains a detached input';
  assert.deepEqual(store.getState(), state);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
  assert.deepEqual(await store.listBackups(), []);
  await store.close();
  const reopened = await openStore({ dataDir });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getState(), state);
});
