// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, rm, open, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildOwnedBase, verifyOwnedBaseBytes, readOwnedBase } from '../app/storage/owned-base.mjs';
import { OWNED_STORAGE_SCHEMA_VERSION, createOwnedBaseManifest, resolveOwnedBasePin,
  validateOwnedBaseReference } from '../app/storage/owned-base-schema.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const projection = () => ({ dataset: { id: 'synthetic', contractVersion: 1, digest: 'a'.repeat(64) },
  tasks: [{ label: 'Synthetic Z', id: 'rs3:task:synthetic-z', category: 'Synthetic' },
    { id: 'rs3:task:synthetic-a', label: 'Synthetic A', category: 'Synthetic', completionIds: ['synthetic-z', 'synthetic-a'] }],
  identityRegistry: { schemaVersion: 1, entries: {
    'rs3:task:synthetic-z': { label: 'Synthetic Z', kind: 'task', aliases: ['z', 'a'] },
    'rs3:task:synthetic-a': { id: 'rs3:task:synthetic-a', kind: 'task', label: 'Synthetic A' } },
  aliases: { z: ['rs3:task:synthetic-z', 'rs3:task:synthetic-a'], a: 'rs3:task:synthetic-a' }, unresolved: [] } });
function fixture() {
  const built = buildOwnedBase(projection()), manifest = createOwnedBaseManifest([built.pin]);
  return { ...built, options: { dataset: built.base.dataset, manifest },
    reference: { datasetDigest: built.pin.dataset.digest, sha256: built.pin.sha256 } };
}
async function withDirectory(run) {
  const parent = new URL('../var/', import.meta.url); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(fileURLToPath(parent), 'owned-base-test-'));
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const filename = (directory, pin) => path.join(directory, `catalogue-${pin.sha256}.json.gz`);

test('builder pins exact UTF-8 bytes and preserves row, dictionary and candidate order', () => {
  const built = buildOwnedBase(projection());
  const expected = '{"baseFormat":1,"generatorVersion":1,"dataset":{"id":"synthetic","contractVersion":1,"digest":"' + 'a'.repeat(64)
    + '"},"tasks":[{"label":"Synthetic Z","id":"rs3:task:synthetic-z","category":"Synthetic"},{"id":"rs3:task:synthetic-a","label":"Synthetic A","category":"Synthetic","completionIds":["synthetic-z","synthetic-a"]}],'
    + '"identityRegistry":{"schemaVersion":1,"entries":{"rs3:task:synthetic-z":{"label":"Synthetic Z","kind":"task","aliases":["z","a"]},"rs3:task:synthetic-a":{"id":"rs3:task:synthetic-a","kind":"task","label":"Synthetic A"}},'
    + '"aliases":{"z":["rs3:task:synthetic-z","rs3:task:synthetic-a"],"a":"rs3:task:synthetic-a"},"unresolved":[]}}';
  assert.equal(built.bytes.toString('utf8'), expected);
  assert.equal(built.pin.sha256, sha(Buffer.from(expected)));
  assert.deepEqual(buildOwnedBase(projection()).bytes, built.bytes);
  const reversed = projection(); reversed.tasks.reverse();
  assert.notEqual(buildOwnedBase(reversed).pin.sha256, built.pin.sha256);
  const candidates = projection(); candidates.identityRegistry.aliases.z.reverse();
  assert.notEqual(buildOwnedBase(candidates).pin.sha256, built.pin.sha256);
  const dictionaries = projection(); dictionaries.identityRegistry.entries = Object.fromEntries(Object.entries(dictionaries.identityRegistry.entries).reverse());
  assert.notEqual(buildOwnedBase(dictionaries).pin.sha256, built.pin.sha256);
});

test('builder detaches and deeply freezes only catalogue data', () => {
  const input = projection(), { base, bytes } = buildOwnedBase(input);
  input.tasks[0].label = 'Changed'; input.identityRegistry.aliases.z.reverse();
  assert.equal(base.tasks[0].label, 'Synthetic Z');
  assert.ok(Object.isFrozen(base.identityRegistry.aliases.z));
  assert.throws(() => { base.tasks[0].label = 'Changed'; }, TypeError);
  bytes.fill(0); assert.equal(base.tasks[0].label, 'Synthetic Z');
});

test('builder refuses group/save fields, assignments, custom tasks and unresolved discoveries', () => {
  for (const change of [
    p => { p.members = []; }, p => { p.history = []; }, p => { p.state = {}; },
    p => { p.tasks[0].memberIds = ['synthetic-member']; }, p => { p.tasks[0].completed = true; },
    p => { p.tasks[0].id = 'custom:synthetic'; }, p => { p.tasks[0].id = 'rs3:task:custom:synthetic'; },
    p => { p.identityRegistry.unresolved = ['synthetic-discovery']; },
  ]) { const input = projection(); change(input); assert.throws(() => buildOwnedBase(input)); }
});

test('schema rejects malformed identities, rows, versions and lossy JSON inputs', () => {
  for (const change of [
    p => { p.dataset.digest = '../escape'; }, p => { p.dataset.contractVersion = 0; },
    p => { p.tasks.push(p.tasks[0]); }, p => { p.tasks[0].label = ''; },
    p => { p.tasks[0].level = 2; }, p => { p.tasks[0].completionIds = ['same', 'same']; },
    p => { p.identityRegistry.schemaVersion = 2; }, p => { p.identityRegistry.entries['rs3:task:synthetic-z'].id = 'wrong'; },
    p => { p.identityRegistry.aliases.z = ['same', 'same']; }, p => { p.tasks[0].label = undefined; },
    p => { p.tasks[0].label = Infinity; }, p => { p.tasks[0].label = new Date(0); },
    p => { Object.defineProperty(p.tasks[0], 'label', { get() { throw new Error('must not invoke'); } }); },
    p => { p.tasks[0].extra = JSON.parse('{"__proto__":{}}'); },
  ]) { const input = projection(); change(input); assert.throws(() => buildOwnedBase(input), TypeError); }
  assert.throws(() => buildOwnedBase(projection(), { limits: { tasks: 1 } }), /task limit/);
  assert.throws(() => buildOwnedBase(projection(), { limits: { bytes: 1 } }), /byte limit/);
  assert.throws(() => buildOwnedBase(projection(), { limits: { depth: 2 } }), /depth limit/);
  assert.throws(() => buildOwnedBase(projection(), { limits: { entries: 1 } }), /identity limit/);
  assert.throws(() => buildOwnedBase(projection(), { limits: { aliases: 1 } }), /identity limit/);
  assert.throws(() => buildOwnedBase(projection(), { limits: { bytes: Number.MAX_SAFE_INTEGER } }), /limits/);
});

test('release manifest binds dataset triple, base hash and generator without ambiguity', () => {
  const f = fixture(); assert.equal(OWNED_STORAGE_SCHEMA_VERSION, 2);
  assert.deepEqual(resolveOwnedBasePin(f.options.manifest, f.base.dataset), f.pin);
  validateOwnedBaseReference(f.reference, f.pin);
  assert.throws(() => createOwnedBaseManifest([f.pin, { ...f.pin, sha256: 'b'.repeat(64) }]), /duplicate/);
  assert.throws(() => createOwnedBaseManifest([{ ...f.pin, generatorVersion: 2 }]), /pin/);
  for (const changed of [{ id: 'other' }, { contractVersion: 2 }, { digest: 'b'.repeat(64) }]) {
    assert.throws(() => resolveOwnedBasePin(f.options.manifest, { ...f.base.dataset, ...changed }), /pin mismatch/);
  }
  for (const changed of [{ sha256: '../escape' }, { datasetDigest: 'b'.repeat(64) }, { path: '../escape' }]) {
    assert.throws(() => validateOwnedBaseReference({ ...f.reference, ...changed }, f.pin));
  }
  const corrupt = structuredClone(f.options.manifest); corrupt.bases[f.pin.dataset.digest].dataset.digest = 'b'.repeat(64);
  assert.throws(() => resolveOwnedBasePin(corrupt, f.base.dataset), /manifest key/);
});

test('byte verifier checks integrity, canonical encoding, schema and every embedded dataset pin', () => {
  const f = fixture(); assert.deepEqual(verifyOwnedBaseBytes(f.bytes, f.options), f.base);
  assert.throws(() => verifyOwnedBaseBytes(Buffer.from('corrupt'), f.options), /checksum/);
  for (const mutate of [
    b => { b.dataset.id = 'other'; }, b => { b.dataset.contractVersion = 2; }, b => { b.dataset.digest = 'b'.repeat(64); },
    b => { b.baseFormat = 2; }, b => { b.generatorVersion = 2; }, b => { b.members = []; },
  ]) {
    const base = structuredClone(f.base); mutate(base); const bytes = Buffer.from(JSON.stringify(base));
    const manifest = createOwnedBaseManifest([{ ...f.pin, sha256: sha(bytes) }]);
    assert.throws(() => verifyOwnedBaseBytes(bytes, { ...f.options, manifest }));
  }
  for (const bytes of [Buffer.concat([f.bytes, Buffer.from('\n')]), Buffer.from('{'),
    Buffer.concat([f.bytes.subarray(0, -1), Buffer.from(',"baseFormat":1}')]), Buffer.from([0xff])]) {
    const manifest = createOwnedBaseManifest([{ ...f.pin, sha256: sha(bytes) }]);
    assert.throws(() => verifyOwnedBaseBytes(bytes, { ...f.options, manifest }));
  }
});

test('cold-open accepts distinct gzip encodings of the same pinned bytes without writing', async () => {
  await withDirectory(async directory => {
    const f = fixture(), target = filename(directory, f.pin);
    for (const level of [0, 9]) {
      const compressed = gzipSync(f.bytes, { level }); await writeFile(target, compressed);
      assert.deepEqual(await readOwnedBase(directory, f.reference, f.options), f.base);
      assert.deepEqual(await readFile(target), compressed);
    }
  });
});

test('cold-open refuses missing, corrupt, oversize and decompression-bomb bases', async () => {
  await withDirectory(async directory => {
    const f = fixture(), target = filename(directory, f.pin);
    await assert.rejects(readOwnedBase(directory, f.reference, f.options), error => error.cause.code === 'ENOENT' && /restore or rebuild/.test(error.message));
    for (const [bytes, limits, accepts] of [
      [Buffer.from('bad gzip'), {}, error => error.cause.code === 'Z_DATA_ERROR'],
      [gzipSync(Buffer.from('wrong hash')), {}, error => /checksum/.test(error.cause.message)],
      [gzipSync(f.bytes), { compressedBytes: 1 }, error => /compressed byte limit/.test(error.cause.message)],
      [gzipSync(Buffer.alloc(4096)), { bytes: 1024 }, error => error.cause.code === 'ERR_BUFFER_TOO_LARGE'],
    ]) {
      await writeFile(target, bytes);
      await assert.rejects(readOwnedBase(directory, f.reference, { ...f.options, limits }), accepts);
      assert.deepEqual(await readFile(target), bytes);
    }
  });
});

test('cold-open rejects path escape and replacement through deterministic filesystem seams', async () => {
  await withDirectory(async directory => {
    const f = fixture(), target = filename(directory, f.pin); await writeFile(target, gzipSync(f.bytes));
    const root = await realpath(directory), outside = path.join(path.dirname(root), path.basename(target));
    const escape = { open, lstat, realpath: async name => name === directory ? root : outside };
    await assert.rejects(readOwnedBase(directory, f.reference, { ...f.options, io: escape }), error => /location escapes/.test(error.cause.message));
    const changed = { open, realpath, lstat: async name => ({ ...await lstat(name), size: 0 }) };
    await assert.rejects(readOwnedBase(directory, f.reference, { ...f.options, io: changed }), error => /file changed/.test(error.cause.message));
  });
});
