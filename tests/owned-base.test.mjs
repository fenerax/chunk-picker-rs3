// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, rm, open, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildOwnedBase, verifyOwnedBaseBytes, readOwnedBase } from '../app/storage/owned-base.mjs';
import { OWNED_STORAGE_SCHEMA_VERSION, createOwnedBaseManifest, resolveOwnedBasePin,
  validateOwnedBaseReference, copyBaseJson } from '../app/storage/owned-base-schema.mjs';

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

test('cardinality refusals precede recursive copying in both builder and cold-open verifier', async t => {
  const parse = JSON.parse;
  for (const [field, limits, reason] of [['tasks', { tasks: 2 }, /task limit/],
    ['entries', { entries: 2 }, /identity limit/], ['aliases', { aliases: 2 }, /identity limit/]]) {
    const f = fixture(), base = structuredClone(f.base);
    if (field === 'tasks') base.tasks = [0, 0, 0];
    else base.identityRegistry[field] = { first: {}, second: {}, third: {} };
    const bytes = Buffer.from(JSON.stringify(base));
    const pin = { ...f.pin, sha256: sha(bytes) }, manifest = createOwnedBaseManifest([pin]);
    let enumerations = 0;
    const guard = value => new Proxy(value, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
    const instrument = document => {
      if (field === 'tasks') document.tasks = guard(document.tasks);
      else for (const key of Object.keys(document.identityRegistry[field])) {
        document.identityRegistry[field][key] = guard(document.identityRegistry[field][key]);
      }
      return document;
    };
    const { dataset, tasks, identityRegistry } = instrument(structuredClone(base));
    assert.throws(() => buildOwnedBase({ dataset, tasks, identityRegistry }, { limits }), reason);
    assert.equal(enumerations, 0, `${field}: builder must refuse before enumerating descendants`);
    await withDirectory(async directory => {
      await writeFile(filename(directory, pin), gzipSync(bytes));
      const mockedParse = t.mock.method(JSON, 'parse', source => instrument(parse(source)));
      try {
        await assert.rejects(readOwnedBase(directory, { ...f.reference, sha256: pin.sha256 }, { ...f.options, manifest, limits }),
          error => /restore or rebuild/.test(error.message) && reason.test(error.cause.message));
        assert.equal(enumerations, 0, `${field}: verifier must refuse before enumerating descendants`);
      } finally { mockedParse.mock.restore(); }
    });
  }
});

test('verifier freezes its parsed tree in place instead of constructing another tree', t => {
  const f = fixture(), parse = JSON.parse;
  let parsed;
  t.mock.method(JSON, 'parse', source => { parsed = parse(source); return parsed; });
  const verified = verifyOwnedBaseBytes(f.bytes, f.options);
  assert.equal(verified, parsed);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.tasks[0]));
  assert.ok(Object.isFrozen(parsed.identityRegistry.aliases.z));
});

test('JSON walks bound node allocation before enumerating a wide array', () => {
  let enumerations = 0;
  const wide = new Proxy([0, 0, 0, 0], { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  assert.throws(() => copyBaseJson(wide, 0, 32, 4), /JSON node limit/);
  assert.equal(enumerations, 0);
  assert.throws(() => copyBaseJson({ wide, second: 0, third: 0 }, 0, 32, 6), /JSON node limit/);
  assert.equal(enumerations, 0, 'unvisited siblings must also reserve key slots');
  const f = fixture();
  assert.throws(() => buildOwnedBase(projection(), { limits: { nodes: 8 } }), /JSON node limit/);
  assert.throws(() => verifyOwnedBaseBytes(f.bytes, { ...f.options, limits: { nodes: 8 } }), /JSON node limit/);
  assert.throws(() => verifyOwnedBaseBytes(f.bytes, { ...f.options, limits: { depth: 2 } }), /JSON depth limit/);
  assert.throws(() => buildOwnedBase(projection(), { limits: { nodes: Number.MAX_SAFE_INTEGER } }), /limits/);
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

test('cold-open uses non-blocking read-only flags and closes non-regular descriptors before reading', async () => {
  await withDirectory(async directory => {
    const f = fixture(); await writeFile(filename(directory, f.pin), gzipSync(f.bytes));
    let opens = 0, reads = 0, closes = 0;
    const io = { realpath, lstat, open: async (file, flags) => {
      opens++;
      assert.equal(flags, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
      return { stat: async () => ({ isFile: () => false }),
        read: async () => { reads++; throw new Error('must not read a special file'); }, close: async () => { closes++; } };
    } };
    await assert.rejects(readOwnedBase(directory, f.reference, { ...f.options, io }),
      error => /restore or rebuild/.test(error.message) && /not a regular file/.test(error.cause.message));
    assert.deepEqual({ opens, reads, closes }, { opens: 1, reads: 0, closes: 1 });
  });
});

test('cold-open rejects a FIFO without a writer instead of leaving the open pending', async t => {
  if (process.platform === 'win32') { t.skip('Windows does not provide filesystem FIFOs'); return; }
  await withDirectory(async directory => {
    const f = fixture(), target = filename(directory, f.pin);
    const created = spawnSync('mkfifo', [target], { encoding: 'utf8', windowsHide: true });
    if (created.error?.code === 'ENOENT') { t.skip('mkfifo is unavailable'); return; }
    assert.ifError(created.error);
    assert.equal(created.status, 0, created.stderr);
    assert.ok((await lstat(target)).isFIFO());
    await assert.rejects(readOwnedBase(directory, f.reference, f.options),
      error => /restore or rebuild/.test(error.message) && /not a regular file/.test(error.cause.message));
  });
});
