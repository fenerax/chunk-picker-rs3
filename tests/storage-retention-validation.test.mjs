// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const storeURL = new URL('../app/storage/store.mjs', import.meta.url).href;
const stateURL = new URL('../app/core/state.mjs', import.meta.url).href;
const stats = globalThis[Symbol.for('retention-validation-test')] = {};
const reset = () => Object.assign(stats, { imports: 0, candidates: 0, taskChecks: 0, fields: [], cacheSamples: [] });
reset();
// Count actual boundaries in the loaded implementation, never elapsed time.
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (![storeURL, stateURL].includes(url)) return result;
  let source = String(result.source);
  const replace = (anchor, replacement) => {
    assert.equal(source.split(anchor).length, 2, `Instrumentation anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  };
  if (url === storeURL) {
    const anchor = 'async function importStoredBackup(document, ownsDocument = false, forImport = false, retentionCache) {';
    replace(anchor, `${anchor}\n __retentionProbe.imports++; if (retentionCache) __retentionProbe.candidates++;`);
  } else {
    const anchor = 'function validateTask(task, memberIds) {';
    replace(anchor, `${anchor}\n if (task?.id === 'rs3:task:retention-probe') __retentionProbe.taskChecks++;`);
    replace('checkStaticField(value) {', `checkStaticField(value) {
      __retentionProbe.fields.push(Array.isArray(value) ? 'tasks' : value?.entries ? 'identityRegistry' : value?.retentionKind);`);
  }
  return { ...result, source: `const __retentionProbe = globalThis[Symbol.for('retention-validation-test')];\n${source}` };
} });
const { openStore } = await import(storeURL);
const { createGroupState, createOwnedStateValidationCache, importBackup, validateOwnedState } = await import(stateURL);
const command = value => ({ type: 'set-rule', ruleId: 'access.shared', value });
const now = () => '2026-10-07T00:00:00.000Z';
const digest = value => createHash('sha256').update(value).digest('hex');

async function seed(t, { staticFields = false, count = 6, compactHistory = false } = {}) {
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(root, '.local', 'test-retention-validation-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const initialState = createGroupState([{ id: 'actor', name: 'Synthetic Player' }]);
  if (staticFields) {
    const id = 'rs3:task:retention-probe', evidence = 'Synthetic evidence. '.repeat(14000);
    initialState.tasks = [{ id, category: 'custom', label: evidence, memberIds: ['actor'] }];
    initialState.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, kind: 'task', label: evidence } }, aliases: {}, unresolved: [] };
    initialState.legacy = { retentionKind: 'legacy', evidence };
    initialState.provenance = { retentionKind: 'provenance', evidence };
  }
  const store = await openStore({ dataDir, initialState, retention: compactHistory ? { historyEntries: 1 } : false, now: () => '2026-01-01T00:00:00.000Z' });
  t.after(() => store.close());
  for (let revision = 0; revision < count; revision++) await store.command(command(Boolean(revision % 2)), revision);
  const snapshots = await store.listBackups();
  await store.close();
  const sources = new Map(await Promise.all(snapshots.map(async row => [row.id, await fs.readFile(path.join(dataDir, 'backups', row.id))])));
  return { dataDir, snapshots, sources, initialState };
}
async function writable(t, dataDir, extra = {}) {
  const store = await openStore({ dataDir, retention: { backupDays: 1 }, now, ...extra });
  t.after(() => store.close());
  return store;
}
async function packs(dataDir) {
  const directory = path.join(dataDir, 'backups', 'archives');
  return Promise.all((await fs.readdir(directory)).map(async id => {
    const file = path.join(directory, id), bytes = await fs.readFile(file);
    return { file, bytes, document: JSON.parse(gunzipSync(bytes)) };
  }));
}
async function editSource(fixture, revision, change) {
  const row = fixture.snapshots.find(row => row.revision === revision), file = path.join(fixture.dataDir, 'backups', row.id);
  const document = JSON.parse(gunzipSync(fixture.sources.get(row.id)));
  change(document);
  const bytes = gzipSync(JSON.stringify(document));
  await fs.writeFile(file, bytes);
  await fs.utimes(file, new Date(row.at), new Date(row.at));
  fixture.sources.set(row.id, bytes);
  return row;
}

async function limitedStore({ portableBytes, staticCacheBytes, frozenSource } = {}) {
  const url = `${storeURL}?retention-limits=${portableBytes}-${staticCacheBytes}-${Boolean(frozenSource)}`;
  const hook = registerHooks({ load(target, context, next) {
    if (target !== url) return next(target, context);
    let source = frozenSource ?? String(next(target, context).source);
    // Exercise the real byte comparisons with small synthetic documents. Only
    // constants change; publication, compression, import and parsing stay real.
    // The frozen release has no portable-limit import and its readBackup ignores
    // forImport, so frozen runs are format-compatibility checks only.
    if (portableBytes && !frozenSource) {
      const limitImport = 'MAX_PORTABLE_BACKUP_BYTES, BACKUP_LIMIT_LABEL';
      assert.equal(source.split(limitImport).length, 2);
      source = source.replace(limitImport, 'MAX_PORTABLE_BACKUP_BYTES as productionLimit, BACKUP_LIMIT_LABEL');
      source = `const MAX_PORTABLE_BACKUP_BYTES = ${portableBytes};\n${source}`;
    }
    if (staticCacheBytes) {
      source = source.replace(/const RETENTION_STATIC_CACHE_BYTES = [^;]+;/, `const RETENTION_STATIC_CACHE_BYTES = ${staticCacheBytes};`);
      const anchor = 'retentionCache.fields.set(cacheKey, result);';
      assert.equal(source.split(anchor).length, 2);
      source = source.replace(anchor, `${anchor}
        globalThis[Symbol.for('retention-validation-test')].cacheSamples.push({
          entries: retentionCache.fields.size,
          bytes: [...retentionCache.fields.values()].reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry.value)), 0),
          accountedBytes: retentionCache.bytes,
        });`);
    }
    return { format: 'module', source, shortCircuit: true };
  } });
  try { return await import(url); } finally { hook.deregister(); }
}

test('shared History segments normalize claim aliases independently for each retained snapshot', async t => {
  const fixture = await seed(t);
  const reference = { id: 'history-0000000000000001-0000000000000001-bbbbbbbbbbbbbbbb.json.gz' };
  const claim = { memberId: 'actor', at: now() };
  const segment = { format: 'rs3-chunk-picker-history', events: [{
    id: 'revision-1', revision: 1, type: 'claim-task', at: now(),
    undo: { taskClaimChanges: { beforeExists: false, afterExists: true,
      changes: [{ id: 'old-id', before: { exists: false }, after: { exists: true, value: claim } }] } },
  }] };
  const file = path.join(fixture.dataDir, 'history', reference.id);
  await fs.writeFile(file, gzipSync(JSON.stringify(segment)));
  const source = await fs.readFile(file);
  const taskId = revision => `rs3:task:alias-${revision % 2 ? 'a' : 'b'}`;
  for (const revision of [1, 2, 3, 4]) await editSource(fixture, revision, document => {
    const id = taskId(revision);
    document.state.tasks = [{ id, label: 'Synthetic alias target', category: 'custom' }];
    document.state.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, kind: 'task', label: 'Synthetic alias target' } }, aliases: { 'old-id': id }, unresolved: [] };
    document.state.taskClaims = { [id]: claim };
    document.state.history = document.state.history.filter(event => event.revision !== 1);
    document.state.provenance = { historyArchive: [reference] };
  });
  const baseline = await writable(t, fixture.dataDir, { retention: false });
  for (const revision of [4, 3, 2, 1]) {
    const row = fixture.snapshots.find(row => row.revision === revision);
    assert.equal((await baseline.readBackup(row.id)).state.history[0].undo.taskClaimChanges.changes[0].id, taskId(revision));
  }
  await baseline.close();
  const retained = await writable(t, fixture.dataDir);
  assert.equal(retained.getInfo().retention.failure, undefined);
  for (const revision of [4, 3, 2, 1]) {
    const row = fixture.snapshots.find(row => row.revision === revision);
    await assert.rejects(fs.stat(path.join(fixture.dataDir, 'backups', row.id)), { code: 'ENOENT' });
    assert.equal((await retained.readBackup(row.id, { forImport: true })).state.history[0].undo.taskClaimChanges.changes[0].id, taskId(revision));
  }
  assert.deepEqual(await fs.readFile(file), source);
});

for (const boundary of ['escaped', 'envelope-overhead', 'exact-limit']) test(`${boundary} singleton preserves restorability at the archive reader limit`, async t => {
  const fixture = await seed(t, { count: 3 });
  const row = await editSource(fixture, 1, document => { document.state.members[0].journal = '\\"'.repeat(1800); });
  const text = gunzipSync(fixture.sources.get(row.id)).toString('utf8');
  const { event, ...metadata } = row;
  const singleton = JSON.stringify({ format: 'rs3-chunk-picker-retained-archive', snapshots: [{ ...metadata, document: text }] });
  const size = Buffer.byteLength(singleton);
  const limit = boundary === 'escaped' ? 12 * 1024 : size - (boundary === 'envelope-overhead' ? 1 : 0);
  assert.ok(Buffer.byteLength(text) < limit);
  if (boundary === 'escaped') assert.ok(Buffer.byteLength(JSON.stringify(text)) > limit);
  if (boundary === 'envelope-overhead') assert.ok(Buffer.byteLength(JSON.stringify(text)) < limit);
  const bounded = await limitedStore({ portableBytes: limit });
  const before = await bounded.openStore({ dataDir: fixture.dataDir, retention: false, now });
  const expected = await before.readBackup(row.id, { forImport: true });
  await before.close();
  const store = await bounded.openStore({ dataDir: fixture.dataDir, retention: { backupDays: 1 }, now });
  t.after(() => store.close());
  assert.equal(store.getInfo().retention.failure, undefined);
  assert.deepEqual(await store.readBackup(row.id, { forImport: true }), expected);
  if (boundary === 'exact-limit') {
    const [pack] = await packs(fixture.dataDir);
    assert.equal(gunzipSync(pack.bytes).length, limit);
    await assert.rejects(fs.stat(path.join(fixture.dataDir, 'backups', row.id)), { code: 'ENOENT' });
  } else {
    assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', row.id)), fixture.sources.get(row.id));
  }
  assert.deepEqual((await store.listBackups()).map(row => row.id), fixture.snapshots.map(row => row.id));
  await store.close();
  let frozenSource;
  try { frozenSource = execFileSync('git', ['show', '06e15939dbf73ecd1a0e7bc9c29088e0281ca11e:app/storage/store.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }); }
  catch { return t.skip('Pinned 06e1593 Git object unavailable; full CI fetches it.'); }
  const frozen = await limitedStore({ portableBytes: limit, frozenSource });
  const old = await frozen.openStore({ dataDir: fixture.dataDir, retention: false, now });
  t.after(() => old.close());
  assert.deepEqual(await old.readBackup(row.id, { forImport: true }), expected);
  assert.deepEqual((await old.listBackups()).map(row => row.id), fixture.snapshots.map(row => row.id));
});

test('static retention cache evicts distinct fields by byte budget and skips oversized fields', async t => {
  const fixture = await seed(t, { count: 36 });
  const limit = 4 * 1024;
  const sharedTasks = [{ id: 'rs3:task:retention-probe', label: 'Synthetic shared task', category: 'custom' }];
  const oversized = { retentionKind: 'provenance', evidence: 'x'.repeat(limit + 1) };
  await fs.mkdir(path.join(fixture.dataDir, 'static'), { recursive: true });
  async function field(value) {
    const json = JSON.stringify(value), sha256 = digest(json), id = `static-${sha256}.json.gz`;
    await fs.writeFile(path.join(fixture.dataDir, 'static', id), gzipSync(json));
    return { id, sha256 };
  }
  const tasks = await field(sharedTasks), provenance = await field(oversized);
  for (let revision = 1; revision <= 34; revision++) {
    const legacy = await field({ retentionKind: 'legacy', revision, evidence: 'x'.repeat(1024) });
    await editSource(fixture, revision, document => {
      delete document.state.tasks;
      document.storage = { schemaVersion: 1, fields: { tasks, legacy, provenance } };
    });
  }
  const bounded = await limitedStore({ staticCacheBytes: limit });
  reset();
  const store = await bounded.openStore({ dataDir: fixture.dataDir, retention: { backupDays: 1 }, now });
  t.after(() => store.close());
  assert.equal(store.getInfo().retention.failure, undefined);
  assert.ok(stats.cacheSamples.length >= 34, 'observe insertions across multiple published batches');
  assert.ok(stats.cacheSamples.every(sample => sample.bytes <= limit), JSON.stringify(stats.cacheSamples));
  for (const sample of stats.cacheSamples) assert.equal(sample.accountedBytes, sample.bytes);
  assert.ok(stats.cacheSamples.every(sample => sample.entries <= 4), 'old unique fields are evicted; oversized field is never cached');
  assert.equal(stats.taskChecks, 1, 'the frequently reused catalogue survives eviction of one-off fields');
  assert.equal((await store.listBackups()).length, fixture.snapshots.length);
  assert.equal((await packs(fixture.dataDir)).length, 2);
});

test('static cached roots stay immutable during diagnostics normalization and identity projection', () => {
  const cache = createOwnedStateValidationCache(), id = 'rs3:task:retention-probe';
  const fields = {
    tasks: [{ id, label: 'Synthetic shared task', category: 'custom' }],
    identityRegistry: { schemaVersion: 1, entries: { [id]: { id, kind: 'task', label: 'Synthetic shared task' } }, aliases: { 'old-id': id }, unresolved: [] },
    legacy: { evidence: { text: 'Synthetic immutable legacy' } },
    provenance: { taskRuleDiagnostics: ['stale'], evidence: { text: 'Synthetic immutable provenance' } },
  };
  const before = JSON.stringify(fields);
  for (const value of Object.values(fields)) cache.checkStaticField(value);
  for (const completedTasks of [['old-id'], [id]]) {
    const state = createGroupState([{ id: 'actor', name: 'Synthetic Player', completedTasks: [] }]);
    state.members[0].completedTasks = completedTasks;
    const validated = validateOwnedState({ ...state, ...fields }, undefined, cache);
    assert.deepEqual(validated.members[0].completedTasks, [id]);
    assert.equal(validated.provenance.taskRuleDiagnostics, undefined);
    assert.equal(JSON.stringify(fields), before);
  }
  for (const value of Object.values(fields)) assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(fields.provenance.evidence), true);
});

test('cold open and listing import only current state; each static field is checked once per hash in a multi-snapshot pass', async t => {
  const fixture = await seed(t, { staticFields: true });
  reset();
  const retained = await writable(t, fixture.dataDir);
  assert.equal(retained.getInfo().retention.failure, undefined);
  assert.equal(stats.candidates, 4);
  assert.equal(stats.imports, 5, 'one current-state import plus one per newly packed candidate');
  assert.equal(stats.taskChecks, 2, 'current state and one shared static task field');
  assert.deepEqual(stats.fields.sort(), ['identityRegistry', 'legacy', 'provenance', 'tasks']);
  const expected = fixture.snapshots.map(({ event, ...metadata }) => metadata);
  assert.deepEqual((await retained.listBackups()).map(({ event, ...metadata }) => metadata), expected);
  await retained.close();
  reset();
  const cold = await writable(t, fixture.dataDir);
  assert.equal(cold.getInfo().retention.failure, undefined);
  assert.equal(stats.imports, 1, 'no archived snapshot crosses the semantic import boundary');
  assert.equal(stats.candidates, 0);
  await cold.listBackups();
  assert.equal(stats.imports, 1);
});

test('packing preserves exact source JSON and every portable restore point; an unchanged pass makes zero writes', async t => {
  const fixture = await seed(t);
  // Valid noncanonical whitespace must survive physical relocation too.
  const row = fixture.snapshots.find(row => row.revision === 2), file = path.join(fixture.dataDir, 'backups', row.id);
  const text = ` \n${JSON.stringify(JSON.parse(gunzipSync(fixture.sources.get(row.id))), null, 2)}\n\t`;
  await fs.writeFile(file, gzipSync(text));
  await fs.utimes(file, new Date(row.at), new Date(row.at));
  fixture.sources.set(row.id, await fs.readFile(file));
  const store = await writable(t, fixture.dataDir);
  assert.equal(store.getInfo().retention.failure, undefined);
  const before = await packs(fixture.dataDir);
  for (const pack of before) for (const snapshot of pack.document.snapshots) {
    assert.equal(snapshot.document, gunzipSync(fixture.sources.get(snapshot.id)).toString('utf8'));
    await assert.rejects(fs.stat(path.join(fixture.dataDir, 'backups', snapshot.id)), { code: 'ENOENT' });
  }
  const writes = [], originals = {};
  for (const method of ['open', 'writeFile', 'rename', 'unlink', 'utimes']) {
    originals[method] = fs[method];
    fs[method] = (...args) => {
      if (method !== 'open' || args[1] !== 'r') writes.push(method);
      return originals[method](...args);
    };
  }
  syncBuiltinESMExports();
  try { await store.prepareSnapshot(); } finally {
    Object.assign(fs, originals); syncBuiltinESMExports();
  }
  assert.deepEqual(writes, []);
  assert.equal(store.getInfo().retention.failure, undefined);
  assert.deepEqual((await packs(fixture.dataDir)).map(pack => digest(pack.bytes)), before.map(pack => digest(pack.bytes)));
  for (const row of fixture.snapshots) {
    const portable = await store.readBackup(row.id);
    assert.equal(portable.schemaVersion, 1);
    assert.deepEqual(portable.state, importBackup(gunzipSync(fixture.sources.get(row.id)).toString('utf8')));
    assert.equal(portable.state.revision, row.revision);
  }
});

test('pinned labels and first/latest standalone tiers survive packing with their original metadata', async t => {
  const fixture = await seed(t), label = 'Synthetic pinned checkpoint';
  const pinned = await editSource(fixture, 1, document => {
    document.retentionPinned = true;
    document.retentionLabel = label;
  });
  await fs.writeFile(path.join(fixture.dataDir, 'backups', `${pinned.id}.meta.json`), JSON.stringify({ label }));
  const baseline = await writable(t, fixture.dataDir, { retention: false });
  const before = await baseline.listBackups();
  await baseline.close();
  const store = await writable(t, fixture.dataDir);
  assert.equal(store.getInfo().retention.failure, undefined);
  assert.deepEqual(await store.listBackups(), before);
  const standalone = (await fs.readdir(path.join(fixture.dataDir, 'backups'))).filter(name => name.endsWith('.json.gz')).sort();
  assert.deepEqual(standalone, fixture.snapshots.filter(row => [0, 1, 5].includes(row.revision)).map(row => row.id).sort());
  assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', pinned.id)), fixture.sources.get(pinned.id));
  assert.equal((await store.listBackups()).find(row => row.id === pinned.id).label, label);
});

test('cached JSON trees still check actor roles when used as History', () => {
  const cache = createOwnedStateValidationCache();
  const events = [{ id: 'revision-1', revision: 1, type: 'synthetic', at: now(), actor: { kind: 'invalid', label: 'Synthetic' } }];
  // It is valid JSON in a generic static field, but is not a valid History actor.
  cache.checkStaticField(events);
  const state = createGroupState([{ id: 'actor', name: 'Synthetic Player' }]);
  state.revision = 1;
  state.history = events;
  assert.throws(() => validateOwnedState(state, undefined, cache), /History actor kind/);
});

for (const fault of ['document-byte', 'truncated-gzip', 'missing-snapshot', 'extra-snapshot', 'metadata', 'format']) {
  test(`post-write ${fault} corruption retains every standalone source and reports failure`, async t => {
    const fixture = await seed(t);
    const nativeRead = fs.readFile;
    let injected = false;
    fs.readFile = async (file, ...args) => {
      if (!injected && path.dirname(String(file)) === path.join(fixture.dataDir, 'backups', 'archives')) {
        injected = true;
        const bytes = await nativeRead(file), pack = JSON.parse(gunzipSync(bytes));
        if (fault === 'document-byte') pack.snapshots.at(-1).document = pack.snapshots.at(-1).document.replace('Synthetic Player', 'Synthetic Slayer');
        if (fault === 'missing-snapshot') pack.snapshots.pop();
        if (fault === 'extra-snapshot') pack.snapshots.push({ ...pack.snapshots[0], id: 'unexpected' });
        if (fault === 'metadata') pack.snapshots.at(-1).at = '2000-01-01T00:00:00.000Z';
        if (fault === 'format') pack.format = 'invalid';
        await fs.writeFile(file, fault === 'truncated-gzip' ? bytes.subarray(0, bytes.length - 5) : gzipSync(JSON.stringify(pack)));
      }
      return nativeRead(file, ...args);
    };
    syncBuiltinESMExports();
    let retained;
    try { retained = await writable(t, fixture.dataDir); } finally { fs.readFile = nativeRead; syncBuiltinESMExports(); }
    assert.equal(injected, true, 'fault occurs on reread after durable archive publication');
    assert.ok(retained.getInfo().retention.failure);
    for (const [id, bytes] of fixture.sources) assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', id)), bytes);
  });
}

for (const representation of ['text', 'object']) test(`invalid ${representation} archived snapshots list shallowly but are refused on use`, async t => {
  const fixture = await seed(t), packed = await writable(t, fixture.dataDir);
  await packed.close();
  const [pack] = await packs(fixture.dataDir), target = pack.document.snapshots[0];
  const document = JSON.parse(target.document);
  document.state.members[0].completedTasks = ['absent-task'];
  target.document = representation === 'text' ? JSON.stringify(document) : document;
  await fs.writeFile(pack.file, gzipSync(JSON.stringify(pack.document)));
  reset();
  const store = await writable(t, fixture.dataDir);
  assert.equal(store.getInfo().retention.failure, undefined);
  assert.equal(stats.imports, 1);
  assert.ok((await store.listBackups()).some(row => row.id === target.id));
  for (const forImport of [false, true]) {
    await assert.rejects(store.readBackup(target.id, { forImport }), /completion references absent task/);
  }
  const before = await fs.readFile(path.join(fixture.dataDir, 'state.json'));
  await assert.rejects(async () => store.replace(await store.readBackup(target.id, { forImport: true }), store.getInfo().revision), /completion references absent task/);
  assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'state.json')), before);
});

for (const fault of ['format', 'schema', 'id', 'revision']) test(`shallow archive indexing still refuses a bad ${fault}`, async t => {
  const fixture = await seed(t), retained = await writable(t, fixture.dataDir);
  await retained.close();
  const [pack] = await packs(fixture.dataDir), target = pack.document.snapshots[0];
  const document = JSON.parse(target.document);
  if (fault === 'format') document.format = 'invalid';
  if (fault === 'schema') document.schemaVersion = 99;
  if (fault === 'id') target.id = 'invalid';
  if (fault === 'revision') document.state.revision++;
  target.document = JSON.stringify(document);
  await fs.writeFile(pack.file, gzipSync(JSON.stringify(pack.document)));
  reset();
  const store = await writable(t, fixture.dataDir);
  assert.match(store.getInfo().retention.failure, /Unsupported backup|Invalid archived backup ID|revision does not match/);
  assert.equal(stats.imports, 1, 'structural refusal does not semantically import the archive');
});

test('legacy object packs remain readable and verify interrupted standalone duplicates before removal', async t => {
  const fixture = await seed(t), retained = await writable(t, fixture.dataDir);
  await retained.close();
  const [pack] = await packs(fixture.dataDir);
  for (const snapshot of pack.document.snapshots) snapshot.document = JSON.parse(snapshot.document);
  await fs.writeFile(pack.file, gzipSync(JSON.stringify(pack.document)));
  const target = pack.document.snapshots[0], source = path.join(fixture.dataDir, 'backups', target.id);
  await fs.writeFile(source, fixture.sources.get(target.id));
  await fs.utimes(source, new Date(target.at), new Date(target.at));
  const store = await writable(t, fixture.dataDir);
  assert.equal(store.getInfo().retention.failure, undefined);
  await assert.rejects(fs.stat(source), { code: 'ENOENT' });
  const backup = await store.readBackup(target.id);
  assert.deepEqual(backup.state, importBackup(gunzipSync(fixture.sources.get(target.id)).toString('utf8')));
  assert.equal((await store.listBackups()).length, fixture.snapshots.length);
});

test('unknown-provenance candidates validate state and full History dependencies before packing', async t => {
  const fixture = await seed(t);
  const target = await editSource(fixture, 2, document => {
    document.state.provenance = { historyArchive: [{ id: 'history-0000000000000001-0000000000000001-aaaaaaaaaaaaaaaa.json.gz' }] };
  });
  const store = await writable(t, fixture.dataDir);
  assert.match(store.getInfo().retention.failure, /ENOENT/);
  assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', target.id)), fixture.sources.get(target.id));
  assert.equal((await fs.readdir(path.join(fixture.dataDir, 'backups'))).filter(id => id.endsWith('.gz')).length, fixture.sources.size);
});

test('a shared static task hash is rechecked against changed rosters', async t => {
  const fixture = await seed(t, { staticFields: true });
  await editSource(fixture, 1, document => { document.state.members = createGroupState([{ id: 'other', name: 'Other Player' }]).members; });
  reset();
  const store = await writable(t, fixture.dataDir);
  assert.match(store.getInfo().retention.failure, /Task assignment references absent member/);
  assert.equal(stats.taskChecks, 3, 'current state, first retention roster, changed retention roster');
  assert.deepEqual(stats.fields.sort(), ['identityRegistry', 'legacy', 'provenance', 'tasks']);
  for (const [id, bytes] of fixture.sources) assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', id)), bytes);
});

test('cached static fields never skip per-snapshot member validation', async t => {
  const fixture = await seed(t, { staticFields: true });
  await editSource(fixture, 1, document => {
    document.state.members[0].taskStatus = { 'rs3:task:retention-probe': { favorite: 'invalid' } };
  });
  const store = await writable(t, fixture.dataDir);
  assert.match(store.getInfo().retention.failure, /favorite must be boolean/);
  for (const [id, bytes] of fixture.sources) assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', id)), bytes);
});

test('a different static hash in the same pass still verifies its bytes', async t => {
  const fixture = await seed(t, { staticFields: true });
  const sha256 = digest('[]'), id = `static-${sha256}.json.gz`;
  // The filename/hash pair is structurally valid, but contains different bytes.
  await fs.writeFile(path.join(fixture.dataDir, 'static', id), gzipSync('[{}]'));
  await editSource(fixture, 1, document => { document.storage.fields.tasks = { id, sha256 }; });
  const store = await writable(t, fixture.dataDir);
  assert.match(store.getInfo().retention.failure, /Static field checksum mismatch/);
  for (const [id, bytes] of fixture.sources) assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', id)), bytes);
});

test('a checksummed but semantically invalid static task field never acquires a valid cache entry', async t => {
  const fixture = await seed(t, { staticFields: true });
  const json = JSON.stringify([{ id: 'rs3:task:retention-probe', category: 'custom', label: 17 }]);
  const sha256 = digest(json), id = `static-${sha256}.json.gz`;
  await fs.writeFile(path.join(fixture.dataDir, 'static', id), gzipSync(json));
  await editSource(fixture, 1, document => { document.storage.fields.tasks = { id, sha256 }; });
  const store = await writable(t, fixture.dataDir);
  assert.match(store.getInfo().retention.failure, /label must be a nonempty string/);
  for (const [id, bytes] of fixture.sources) assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'backups', id)), bytes);
});

test('packing shared static fields with archived History preserves complete exports and Undo after restart', async t => {
  const fixture = await seed(t, { staticFields: true, compactHistory: true });
  const retained = await writable(t, fixture.dataDir, { retention: { backupDays: 1, historyEntries: 1 } });
  assert.equal(retained.getInfo().retention.failure, undefined);
  assert.deepEqual((await retained.listBackups()).map(row => row.id), fixture.snapshots.map(row => row.id));
  for (const row of fixture.snapshots) {
    const backup = await retained.readBackup(row.id);
    assert.equal(backup.state.history.length, row.revision);
    assert.deepEqual(backup.state.tasks, fixture.initialState.tasks);
  }
  await retained.close();
  const cold = await writable(t, fixture.dataDir, { retention: { backupDays: 1, historyEntries: 1 } });
  const previous = await cold.readBackup(fixture.snapshots.find(row => row.revision === 5).id);
  await cold.command({ type: 'undo' }, 6);
  const complete = await cold.backup();
  assert.deepEqual(complete.state.rules, previous.state.rules);
  assert.equal(complete.state.history.length, 7);
  assert.equal(complete.state.history.find(event => event.revision === 6).undoneRevision, 7);
});

test('static validation is discarded between passes', async t => {
  const fixture = await seed(t, { staticFields: true });
  const store = await writable(t, fixture.dataDir);
  const [pack] = await packs(fixture.dataDir), target = pack.document.snapshots[0];
  // Recreate an interrupted-pass duplicate, then remove its dependency after
  // the preceding pass validated it. No lifetime validation may authorize it.
  const file = path.join(fixture.dataDir, 'backups', target.id), document = JSON.parse(target.document);
  await fs.writeFile(file, fixture.sources.get(target.id));
  await fs.utimes(file, new Date(target.at), new Date(target.at));
  const reference = document.storage.fields.tasks, staticFile = path.join(fixture.dataDir, 'static', reference.id);
  await fs.writeFile(staticFile, gzipSync('[]'));
  reset();
  await store.prepareSnapshot();
  assert.match(store.getInfo().retention.failure, /Static field checksum mismatch/);
  assert.deepEqual(await fs.readFile(file), fixture.sources.get(target.id));
});

test('06e1593 frozen archive index and reader accept newly packed byte-preserving documents', async t => {
  const fixture = await seed(t, { staticFields: true }), store = await writable(t, fixture.dataDir);
  assert.equal(store.getInfo().retention.failure, undefined);
  const current = await store.listBackups();
  await store.close();
  // Load the actual pinned store module, resolving its unchanged dependencies
  // from this checkout. No shell checkout, live store, or copied approximation.
  let source;
  try { source = execFileSync('git', ['show', '06e15939dbf73ecd1a0e7bc9c29088e0281ca11e:app/storage/store.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }); }
  catch { return t.skip('Pinned 06e1593 Git object unavailable; full CI fetches it.'); }
  const frozenURL = `${storeURL}?retention-frozen=06e1593`;
  const hook = registerHooks({ load(url, context, next) {
    return url === frozenURL ? { format: 'module', source, shortCircuit: true } : next(url, context);
  } });
  let frozen;
  try { frozen = await import(frozenURL); } finally { hook.deregister(); }
  const old = await frozen.openStore({ dataDir: fixture.dataDir, retention: false, now });
  t.after(() => old.close());
  assert.deepEqual(await old.listBackups(), current);
  for (const row of fixture.snapshots) {
    const portable = await old.readBackup(row.id);
    const document = JSON.parse(gunzipSync(fixture.sources.get(row.id)));
    assert.equal(portable.state.revision, row.revision);
    assert.deepEqual(portable.state.members, document.state.members);
    assert.deepEqual(portable.state.tasks, fixture.initialState.tasks);
    assert.equal(portable.schemaVersion, 1);
  }
});
