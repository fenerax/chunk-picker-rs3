import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openPluginAchievements } from '../app/plugin-achievements.mjs';

// The test runner redirects TEMP/TMP to an isolated directory inside this worktree.
async function fixture(t, contents) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'picker-plugin-achievements-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, 'plugin-achievements.json');
  if (contents !== undefined) await writeFile(file, contents);
  let currentMembers = [{ id: 'player-a' }, { id: 'player-b' }];
  const logs = [], options = { dataDir, members: () => currentMembers, clock: () => 123456, log: message => logs.push(message) };
  const store = await openPluginAchievements(options);
  t.after(() => store.close());
  return { dataDir, file, store, logs, options, members(value) { currentMembers = value; },
    async disk() { return JSON.parse(await readFile(file, 'utf8')); },
    async archives() { return (await readdir(dataDir)).filter(name => name.includes('.corrupt-')); } };
}

test('missing store stays empty until handled IDs are saved', async t => {
  const f = await fixture(t);
  assert.equal(f.store.has('player-a', 0), false);
  await f.store.add('missing', [1]);
  await f.store.add('player-a', []);
  assert.deepEqual(await readdir(f.dataDir), []);
  assert.deepEqual(f.logs, []);
});

test('handled IDs persist sorted and unique, including zero and the largest safe integer', async t => {
  const f = await fixture(t);
  await f.store.add('player-a', [9, 0, 3, 9, Number.MAX_SAFE_INTEGER]);
  await f.store.add('player-b', [4]);
  await f.store.add('player-a', [3, 2]);
  assert.deepEqual(await f.disk(), { v: 1, players: {
    'player-a': { handled: [0, 2, 3, 9, Number.MAX_SAFE_INTEGER] }, 'player-b': { handled: [4] },
  } });
  await f.store.close();
  const reopened = await openPluginAchievements(f.options);
  t.after(() => reopened.close());
  for (const id of [0, 2, 3, 9, Number.MAX_SAFE_INTEGER]) assert.equal(reopened.has('player-a', id), true);
  assert.equal(reopened.has('player-b', 4), true);
  assert.equal(reopened.has('player-a', 4), false);
  assert.equal(reopened.has('toString', 0), false);
  if (process.platform !== 'win32') assert.equal((await stat(f.file)).mode & 0o777, 0o600);
});

const invalidFiles = [
  '{broken', 'null', '[]', '{}', '{"v":2,"players":{}}', '{"v":1,"players":{},"extra":true}',
  '{"v":1,"players":[]}', '{"v":1,"players":{"bad player":{"handled":[1]}}}',
  '{"v":1,"players":{"player-a":null}}', '{"v":1,"players":{"player-a":{"handled":[1],"extra":true}}}',
  '{"v":1,"players":{"player-a":{"handled":"1"}}}', '{"v":1,"players":{"player-a":{"handled":[2,1]}}}',
  '{"v":1,"players":{"player-a":{"handled":[1,1]}}}', '{"v":1,"players":{"player-a":{"handled":[-1]}}}',
  '{"v":1,"players":{"player-a":{"handled":[1.5]}}}', '{"v":1,"players":{"player-a":{"handled":["1"]}}}',
  '{"v":1,"players":{"player-a":{"handled":[9007199254740992]}}}',
  JSON.stringify({ v: 1, players: { 'player-a': { handled: Array.from({ length: 20001 }, (_, id) => id) } } }),
];
for (const [index, contents] of invalidFiles.entries()) {
  test(`corrupt store ${index + 1} is preserved until a successful handled write`, async t => {
    const f = await fixture(t, contents);
    assert.equal(f.logs.length, 1);
    assert.equal(f.store.has('player-a', 1), false);
    await f.store.add('missing', [7]);
    await f.store.add('player-a', []);
    await f.store.close();
    assert.equal(await readFile(f.file, 'utf8'), contents);
    assert.deepEqual(await f.archives(), []);
    const reopened = await openPluginAchievements(f.options);
    t.after(() => reopened.close());
    assert.equal(f.logs.length, 2);
    await reopened.add('player-a', [7]);
    assert.deepEqual(await f.disk(), { v: 1, players: { 'player-a': { handled: [7] } } });
    const archives = await f.archives();
    assert.equal(archives.length, 1);
    assert.equal(await readFile(path.join(f.dataDir, archives[0]), 'utf8'), contents);
    await reopened.add('player-a', [8]);
    assert.equal((await f.archives()).length, 1);
    assert.equal(f.logs.length, 2);
  });
}

test('corrupt recovery never replaces an existing archive at the same timestamp', async t => {
  const f = await fixture(t, 'broken');
  const originalArchive = `${f.file}.corrupt-123456`;
  await writeFile(originalArchive, 'earlier broken file');
  await f.store.add('player-a', [1]);
  assert.equal(await readFile(originalArchive, 'utf8'), 'earlier broken file');
  assert.equal(await readFile(`${originalArchive}-1`, 'utf8'), 'broken');
});

test('invalid additions reject atomically and cannot poison the mutation queue', async t => {
  const f = await fixture(t);
  for (const ids of [null, {}, '1', [-1], [1.5], [NaN], [Infinity], ['1'], [null], Array(1), [Number.MAX_SAFE_INTEGER + 1], [1, -1]]) {
    await assert.rejects(f.store.add('player-a', ids), TypeError);
  }
  assert.deepEqual(await readdir(f.dataDir), []);
  await f.store.add('player-a', [1]);
  assert.equal(f.store.has('player-a', 1), true);
  for (const id of [-1, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(f.store.has('player-a', id), false);
});

test('limit retains handled IDs before deterministically choosing incoming IDs', async t => {
  const f = await fixture(t);
  await f.store.add('player-a', [50000, 50001]);
  await f.store.add('player-a', Array.from({ length: 20002 }, (_, index) => 20001 - index));
  const handled = (await f.disk()).players['player-a'].handled;
  assert.equal(handled.length, 20000);
  assert.deepEqual(handled.slice(-3), [19997, 50000, 50001]);
  assert.equal(f.store.has('player-a', 19998), false);
  assert.equal(f.store.has('player-a', 20001), false);
  await f.store.add('player-a', [60000]);
  assert.equal(f.store.has('player-a', 60000), false);
  assert.deepEqual((await f.disk()).players['player-a'].handled, handled);
});

test('add prunes deleted members using current membership and ignores missing players', async t => {
  const f = await fixture(t);
  await f.store.add('player-a', [1]);
  await f.store.add('player-b', [2]);
  f.members([{ id: 'player-b' }]);
  await f.store.add('player-a', [3]);
  assert.deepEqual(await f.disk(), { v: 1, players: { 'player-b': { handled: [2] } } });
  assert.equal(f.store.has('player-a', 1), false);
  assert.equal(f.store.has('player-a', 3), false);
});

test('queued additions are serialized and copy caller input before awaiting', async t => {
  const f = await fixture(t), ids = [3];
  const first = f.store.add('player-a', ids);
  ids[0] = 99;
  await Promise.all([first, f.store.add('player-a', [2]), f.store.add('player-a', [1])]);
  assert.deepEqual((await f.disk()).players['player-a'].handled, [1, 2, 3]);
  const pending = f.store.add('player-a', [4]);
  await f.store.close();
  await pending;
  assert.equal(f.store.has('player-a', 4), true);
  await assert.rejects(f.store.add('player-a', [5]), error => error.status === 503);
});

test('failed writes leave memory unchanged, clean temporary files and permit retry', async t => {
  const f = await fixture(t);
  await f.store.add('player-a', [1]);
  const saved = `${f.file}.saved`;
  await rename(f.file, saved);
  await mkdir(f.file);
  await assert.rejects(f.store.add('player-a', [2]));
  assert.equal(f.store.has('player-a', 1), true);
  assert.equal(f.store.has('player-a', 2), false);
  assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), { v: 1, players: { 'player-a': { handled: [1] } } });
  assert.equal((await readdir(f.dataDir)).some(name => name.endsWith('.tmp')), false);
  await rm(f.file, { recursive: true });
  await rename(saved, f.file);
  await f.store.add('player-a', [2]);
  assert.deepEqual((await f.disk()).players['player-a'].handled, [1, 2]);
});

test('failed corrupt recovery preserves original bytes and retries without another warning', async t => {
  const f = await fixture(t, 'broken original');
  const moved = `${f.dataDir}-moved`;
  t.after(() => rm(moved, { recursive: true, force: true }));
  await rename(f.dataDir, moved);
  await assert.rejects(f.store.add('player-a', [1]));
  assert.equal(f.store.has('player-a', 1), false);
  assert.equal(await readFile(path.join(moved, 'plugin-achievements.json'), 'utf8'), 'broken original');
  assert.deepEqual(await readdir(moved), ['plugin-achievements.json']);
  await rename(moved, f.dataDir);
  await f.store.add('player-a', [1]);
  assert.equal(f.store.has('player-a', 1), true);
  assert.equal(f.logs.length, 1);
  assert.equal(await readFile(path.join(f.dataDir, (await f.archives())[0]), 'utf8'), 'broken original');
});
