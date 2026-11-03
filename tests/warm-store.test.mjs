import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm, utimes, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWarmStore, warmHash } from '../app/tasks/warm-store.mjs';
import { createWarmResults, warmResultNamespace, warmResultKey } from '../app/tasks/warm-results.mjs';
const key = value => warmHash(String(value));
async function scratch(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
test('warm publications survive reopening; corrupt, partial, oversized and wrong-key files miss', async t => {
  const directory = await scratch(t), store = createWarmStore(directory), bytes = Buffer.from('synthetic reply');
  const reference = store.put(key(1), bytes);
  store.close();
  const reopened = createWarmStore(directory);
  assert.deepEqual(reopened.get(key(1)), bytes);
  assert.equal(reopened.get(key(2)), undefined);
  const complete = await readFile(reference.file);
  for (const broken of [complete.subarray(0, 20), complete.subarray(0, complete.length - 1), Buffer.concat([complete, Buffer.from('x')]),
    Buffer.from(complete).fill(0, 8, 40), Buffer.from(complete).fill(0, 76)]) {
    await writeFile(reference.file, broken);
    assert.equal(reopened.get(key(1)), undefined);
    assert.ok(reopened.put(key(1), bytes));
  }
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), []);
});
test('disk bytes, entry count, age and abandoned writes are pruned; lock contention skips writes', async t => {
  const directory = await scratch(t), caps = { bytes: 300, entries: 2, entryBytes: 100, ageMs: 1000 };
  const store = createWarmStore(directory, caps);
  for (let i = 0; i < 6; i++) store.put(key(i), Buffer.alloc(40, i));
  let files = await readdir(directory);
  assert.equal(files.length, 2);
  assert.ok((await Promise.all(files.map(name => readFile(path.join(directory, name))))).reduce((n, b) => n + b.length, 0) <= caps.bytes);
  assert.equal(store.put(key(7), Buffer.alloc(101)), undefined);
  await writeFile(path.join(directory, 'aaaa.tmp'), 'partial');
  await utimes(path.join(directory, files[0]), new Date(0), new Date(0));
  createWarmStore(directory, caps);
  assert.equal((await readdir(directory)).length, 1);
  assert.equal(store.get(key(0)), undefined);
  const lock = path.join(directory, '.write-lock'); await mkdir(lock);
  assert.equal(store.put(key(8), Buffer.alloc(40)), undefined);
  await utimes(lock, new Date(0), new Date(0));
  assert.ok(store.put(key(8), Buffer.alloc(40)), 'an interrupted writer cannot permanently disable persistence');
  files = await readdir(directory); assert.equal(files.length, 2);
});
test('unsafe directory/file links and invalid limits decline optional storage', async t => {
  const directory = await scratch(t), link = path.join(directory, 'link');
  await symlink(directory, link, 'dir');
  const store = createWarmStore(link);
  assert.equal(store.put(key(1), Buffer.from('x')), undefined);
  assert.equal(store.get(key(1)), undefined);
  assert.equal(createWarmStore('relative'), undefined);
  assert.equal(createWarmStore(directory, { bytes: 100 }), undefined);
  const blocked = path.join(directory, 'blocked'); await writeFile(blocked, 'x');
  assert.equal(createWarmStore(blocked).put(key(1), Buffer.from('x')), undefined);
});
test('result namespace binds source, runtime, dataset, exact definitions, world and every semantic worker option', () => {
  const data = { datasetDigest: key('dataset'), definitions: { chunks: {} }, world: { chunks: new Map() }, extraRules: [], datasetOptions: {} };
  const environment = { source: key('source'), node: '24.21.0', v8: '1' }, namespace = warmResultNamespace(data, environment);
  for (const changed of [{ datasetDigest: key('other') }, { definitions: {} }, { world: {} }, { extraRules: [{}] },
    { datasetOptions: { reviewedOverlays: true } }, { preparedDatasetStages: ['stage'] }, { skillGuideCatalogue: [] }, { datasetSelection: {} }]) {
    assert.notEqual(warmResultNamespace({ ...data, ...changed }, environment), namespace);
  }
  for (const changed of [{ source: key('release') }, { node: '24.22.0' }, { v8: '2' }]) assert.notEqual(warmResultNamespace(data, { ...environment, ...changed }), namespace);
  assert.equal(warmResultNamespace({ ...data, warmStoreDirectory: '/tmp/elsewhere', omitReadyCatalogue: true, collectPreparedCollection: true }, environment), namespace);
  assert.equal(warmResultNamespace({ ...data, extraRules: [() => {}] }, environment), undefined);
});
test('result keys bind exact save bytes/revision, picker, task input and all request projections', () => {
  const namespace = key('namespace'), request = { type: 'evaluate', state: { revision: 3, members: [{ id: 'a', unlocked: [] }] }, input: 'input', memberId: 'a', resultView: 'full' };
  const first = warmResultKey(namespace, request);
  for (const changed of [{ state: { ...request.state, revision: 4 } }, { state: { ...request.state, members: [{ id: 'a', unlocked: ['1'] }] } },
    { input: 'other' }, { memberId: 'b' }, { pickerId: 'other' }, { type: 'predict' }, { chunkId: '1' }, { draft: {} }, { resultTransport: 'json-shared-v1' },
    { resultView: 'play-v1' }, { duoProjection: true }, { duoSidebarProjection: true }, { chunkIds: ['2'] }]) assert.notEqual(warmResultKey(namespace, { ...request, ...changed }), first);
  assert.notEqual(warmResultKey(key('other'), request), first);
  assert.equal(warmResultKey(namespace, { ...request, type: 'how-task' }), undefined);
});
test('persisted result and paired reply transport bytes are restored exactly; cancellation is never published', async t => {
  const directory = await scratch(t), data = { warmStoreDirectory: directory, definitions: {} };
  const store = createWarmResults(data), request = { type: 'evaluate', state: { revision: 1 } }, cacheKey = store.key(request);
  const shared = value => { const b = Buffer.from(value), s = new SharedArrayBuffer(b.length); Buffer.from(s).set(b); return s; };
  const value = { resultJSON: shared('{"tasks":[]}'), playJSON: shared('{"tasks":[]}'), unlockReuse: { taskInputKey: key('input'), playJSON: shared('{}'), duoJSON: shared('[]'), duoSidebarJSON: shared('[]') } };
  store.put(cacheKey, value);
  const restored = createWarmResults(data).get(cacheKey);
  for (const field of ['resultJSON', 'playJSON']) assert.deepEqual(Buffer.from(restored[field]), Buffer.from(value[field]));
  for (const field of ['playJSON', 'duoJSON', 'duoSidebarJSON']) assert.deepEqual(Buffer.from(restored.unlockReuse[field]), Buffer.from(value.unlockReuse[field]));
  assert.equal(restored.unlockReuse.taskInputKey, value.unlockReuse.taskInputKey);
  store.put(key('cancelled'), { result: { cancelled: true } }); assert.equal(store.get(key('cancelled')), undefined);
  store.put(key('error'), { error: {} }); assert.equal(store.get(key('error')), undefined);
  assert.equal(createWarmResults({}), undefined);
});

test('process termination during publication yields an intact hit or a miss, with reclaimable bounded remnants', async t => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const moduleURL = new URL('../app/tasks/warm-store.mjs', import.meta.url).href;
  for (const delay of [0, 5, 25]) {
    const directory = await scratch(t), cacheKey = key(delay), size = 32 * 1024 * 1024;
    const script = `import { createWarmStore } from ${JSON.stringify(moduleURL)};
      const store = createWarmStore(${JSON.stringify(directory)}), bytes = Buffer.alloc(${size}, 7);
      process.send('ready', () => { store.put(${JSON.stringify(cacheKey)}, bytes); });`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = once(child, 'close');
    await once(child, 'message');
    await new Promise(resolve => setTimeout(resolve, delay)); child.kill('SIGKILL'); await exited;
    const store = createWarmStore(directory), restored = store.get(cacheKey);
    if (restored) assert.deepEqual(restored, Buffer.alloc(size, 7));
    const lock = path.join(directory, '.write-lock');
    try { await utimes(lock, new Date(0), new Date(0)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.ok(store.put(key('replacement'), Buffer.from('complete')));
    assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp') || name === '.write-lock'), []);
  }
});
