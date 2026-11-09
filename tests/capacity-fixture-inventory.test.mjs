import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixtureInventory } from '../scripts/perf/capacity/fixture-cache.mjs';

// A full-size fixture is too slow to build in CI, so the walk reads an injected
// in-memory tree. The large directory is the shape that once overflowed the stack.
const root = path.resolve('synthetic-fixture-root');
const entry = kind => ({ isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'dir',
  isFile: () => kind === 'file', size: 7, mtime: new Date(1_700_000_000_000) });
function memoryTree(tree) {
  const node = filename => path.relative(root, filename).split(path.sep).filter(Boolean).reduce((value, name) => value[name], tree);
  return {
    list: async filename => Object.keys(node(filename)),
    status: async filename => { const value = node(filename); return entry(typeof value === 'string' ? value : 'dir'); }
  };
}

test('the fixture inventory lists a very large tree in walk order without overflowing', async () => {
  const large = {};
  for (let i = 0; i < 300_000; i++) large[`f${String(i).padStart(6, '0')}.json.gz`] = 'file';
  const inventory = await fixtureInventory(root, memoryTree({
    'server.log': 'file', 'fixture.json': 'file', pickers: { b: { 'state.json': 'file' }, a: { backups: large, 'state.json': 'file' } }
  }));
  assert.equal(inventory.length, 300_003);
  assert.deepEqual(inventory[0], { path: 'fixture.json', bytes: 7, modifiedMs: 1_700_000_000_000 });
  assert.equal(inventory[1].path, 'pickers/a/backups/f000000.json.gz');
  assert.equal(inventory[300_000].path, 'pickers/a/backups/f299999.json.gz');
  assert.deepEqual(inventory.slice(-2).map(item => item.path), ['pickers/a/state.json', 'pickers/b/state.json']);
});

test('the fixture inventory refuses links and special files at any depth', async () => {
  await assert.rejects(fixtureInventory(root, memoryTree({ pickers: { a: { 'state.json': 'link' } } })), /symbolic link/);
  await assert.rejects(fixtureInventory(root, memoryTree({ registry: { socket: 'other' } })), /non-regular file/);
});
