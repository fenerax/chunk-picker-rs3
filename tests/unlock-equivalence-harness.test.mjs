import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';

const source = await readFile(new URL('../scripts/perf/unlock-equivalence.mjs', import.meta.url), 'utf8');

test('application fingerprints accept pinned old layouts and include relocated reference inputs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-tidy-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, value = 'fixture\n') => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  };
  const helpers = ['scripts/research/local-parity-model.mjs', 'scripts/lib/provenance-hash.mjs'];
  for (const name of ['app/fixture.mjs', 'rs3-chunkpicker-chunkinfo-export.json', 'tasksMap.json', ...helpers]) await put(name);
  const start = source.indexOf('async function appFingerprint('), end = source.indexOf('\n// Archives have no git metadata.', start);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const context = vm.createContext({ path, readFile, readdir, lstat, sha, valueHash: value => sha(JSON.stringify(value)), REFERENCE_HELPERS: helpers });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.fingerprint = appFingerprint;', context);
  const legacy = await context.fingerprint(root);
  assert.ok(legacy.files.some(row => row.file === 'tasksMap.json'));
  assert.equal(legacy.files.length, 5);
  await put('reference/original-picker/tasksMap.json', 'relocated seed\n');
  await put('archive/data/historical.json', 'historical bundle\n');
  const relocated = await context.fingerprint(root);
  assert.equal(relocated.files.some(row => row.file === 'tasksMap.json'), false);
  assert.equal(relocated.files.find(row => row.file === 'reference/original-picker/tasksMap.json').sha256, sha('relocated seed\n'));
  assert.equal(relocated.files.find(row => row.file === 'archive/data/historical.json').sha256, sha('historical bundle\n'));
  assert.notEqual(relocated.sha256, legacy.sha256);
});

test('inherited lock requires exact direct parent ownership and token', () => {
  const start = source.indexOf('function verifyInheritedLock('), end = source.indexOf('\nfunction candidatesFor(', start);
  const context = vm.createContext({ assert, path, LOCK: path.resolve('fixture-lock') });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.verify = verifyInheritedLock;', context);
  const valid = { inheritedPath: path.resolve('fixture-lock'), inheritedToken: 'a'.repeat(32), inheritedPid: '42', parentPid: 42,
    owner: { pid: 42, script: '.local/with-heavy.ps1', token: 'a'.repeat(32), owner: 'owned fixture' }, marker: '\uFEFFowned fixture\n' };
  context.verify(valid);
  for (const patch of [{ inheritedPath: path.resolve('another-lock') }, { inheritedToken: undefined }, { inheritedToken: 'b'.repeat(32) },
    { inheritedPid: '43' }, { marker: 'another owner' }, { owner: { ...valid.owner, pid: 43 } },
    { owner: { ...valid.owner, script: 'another.ps1' } }]) assert.throws(() => context.verify({ ...valid, ...patch }));
});

test('archive verification rejects altered blobs, links, extra files and outside roots before app imports', async () => {
  const start = source.indexOf('async function verifiedArchive('), end = source.indexOf('\nfunction verifyInheritedLock(', start);
  const root = path.resolve('fixture-worktree'), local = path.join(root, '.local'), archive = path.join(local, 'archive');
  const bytes = Buffer.from('pinned fixture\n'), blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const files = ['app/fixture.mjs', 'rs3-chunkpicker-chunkinfo-export.json', 'tasksMap.json', 'scripts/research/local-parity-model.mjs', 'scripts/lib/provenance-hash.mjs'];
  const fixture = { tree: files.map(name => `100644 blob ${blob}\t${name}\0`).join(''), bytes, extra: false, changedHelper: false };
  const context = vm.createContext({ assert, path, ROOT: root, createHash,
    inside: (base, filename) => { const value = path.relative(base, filename); return !!value && !path.isAbsolute(value) && value !== '..' && !value.startsWith(`..${path.sep}`); },
    rejectLinks: async () => {}, realpath: async value => value,
    execFileSync: () => fixture.tree, readFile: async filename => fixture.changedHelper && filename.endsWith(path.join('scripts', 'lib', 'provenance-hash.mjs')) ? Buffer.from('changed helper') : fixture.bytes,
    sha: value => createHash('sha256').update(value).digest('hex'),
    REFERENCE_HELPERS: ['scripts/research/local-parity-model.mjs', 'scripts/lib/provenance-hash.mjs'],
    appFingerprint: async () => ({ sha256: 'fixture', files: [...files, ...(fixture.extra ? ['app/injected.mjs'] : [])].map(file => ({ file, sha256: 'fixture' })) }),
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.verify = verifiedArchive;', context);
  assert.equal((await context.verify(archive, 'pinned', local)).commit, 'pinned');
  fixture.bytes = Buffer.from('changed');
  await assert.rejects(context.verify(archive, 'pinned', local), /Archive differs/);
  fixture.bytes = bytes; fixture.changedHelper = true;
  await assert.rejects(context.verify(archive, 'pinned', local), /Archive differs.*provenance-hash\.mjs/);
  fixture.changedHelper = false; fixture.extra = true;
  await assert.rejects(context.verify(archive, 'pinned', local), /extra or missing application\/helper files/);
  fixture.extra = false; fixture.tree = `120000 blob ${blob}\tapp/link\0`;
  await assert.rejects(context.verify(archive, 'pinned', local), /link or unsupported/);
  await assert.rejects(context.verify(path.join(root, 'outside'), 'pinned', local), /stay under/);
});

test('private oracle helpers preserve exact results and reject changed retained blobs without game data', () => {
  const script = fileURLToPath(new URL('../scripts/perf/unlock-equivalence.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [script, '--self-test'], { encoding: 'utf8', timeout: 15000 });
  assert.match(output, /Canonicalization, preserved counters\/array order and first-difference self-tests passed/);
  assert.match(output, /Retained compressed bytes: exact, tampered, truncated, metadata and unsafe-path checks passed/);
  assert.match(output, /Exact-byte comparison: zero canonical calls, mismatch canonical checks, first path\/order, fresh artifact and corrupt reference checks passed/);
  assert.match(output, /Pinned reference manifest: unchanged, missing resume pin and tampered reference checks passed/);
});
