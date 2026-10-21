import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, lstat } from 'node:fs/promises';
import { hashTree, captureInputIdentity, captureExecutionIdentity, deriveLaneKey, digestValue, stableStringify, sanitizeExecutionEnvironment, readSuccessReceipt, writeSuccessReceipt } from '../scripts/private-companion/release-identity.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-identity-v2-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('canonical digests ignore object insertion order and reject ambiguous values', () => {
  assert.equal(digestValue({ b: 2, a: [1, true] }), digestValue({ a: [1, true], b: 2 }));
  assert.notEqual(digestValue(['a', 'bc']), digestValue(['ab', 'c']));
  const sparse = new Array(1); sparse.extra = true;
  for (const value of [undefined, NaN, Infinity, new Date(), { missing: undefined }, new Array(1), sparse]) assert.throws(() => stableStringify(value), /unsupported/);
});

test('every explicit candidate input class and extra authored files affect complete identity', async t => {
  const directory = await fixture(t);
  const treeNames = ['core', 'private-source', 'tools', 'operator', 'wrappers', 'packs', 'addon', 'assembly'];
  const fileNames = ['profile', 'companion-receipt', 'config', 'pointer'];
  const components = [];
  for (const name of treeNames) {
    const root = path.join(directory, name);
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await writeFile(path.join(root, 'nested/input'), 'original');
    components.push({ name, root });
  }
  for (const name of fileNames) {
    const file = path.join(directory, name + '.json');
    await writeFile(file, '{"version":1}');
    components.push({ name, file });
  }
  const capture = () => captureInputIdentity({ components, metadata: { policy: 2 } });
  const initial = await capture();
  assert.equal((await captureInputIdentity({ components: [...components].reverse(), metadata: { policy: 2 } })).digest, initial.digest);
  for (const component of components) {
    await t.test(component.name, async () => {
      const target = component.file ?? path.join(component.root, 'nested/input');
      const original = await readFile(target);
      await writeFile(target, 'modified');
      assert.notEqual((await capture()).digest, initial.digest);
      await writeFile(target, original);
      assert.equal((await capture()).digest, initial.digest);
      if (component.root) {
        const extra = path.join(component.root, '.extra-authored');
        await writeFile(extra, 'new');
        assert.notEqual((await capture()).digest, initial.digest);
        await rm(extra);
      }
    });
  }
  assert.notEqual((await captureInputIdentity({ components, metadata: { policy: 3 } })).digest, initial.digest);
  assert.equal(JSON.stringify(initial).includes(directory), false);
});

test('only exact explicit mutable exclusions are omitted; assembly local bytes count by default', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, '.local'));
  await mkdir(path.join(root, 'nested', '.local'), { recursive: true });
  await mkdir(path.join(root, 'release-gate'));
  await writeFile(path.join(root, '.local/cache'), 'one');
  await writeFile(path.join(root, 'release-gate/receipt'), 'one');
  await writeFile(path.join(root, 'nested/.local/authored'), 'one');
  const exclusions = { excludePaths: ['.local', 'release-gate'] };
  const initial = await hashTree(root, exclusions), assembly = await hashTree(root);
  await writeFile(path.join(root, '.local/cache'), 'two');
  await writeFile(path.join(root, 'release-gate/receipt'), 'two');
  assert.equal((await hashTree(root, exclusions)).digest, initial.digest);
  assert.notEqual((await hashTree(root)).digest, assembly.digest);
  await writeFile(path.join(root, 'nested/.local/authored'), 'two');
  assert.notEqual((await hashTree(root, exclusions)).digest, initial.digest);
  for (const bad of ['../outside', '/absolute', '**', 'nested\\input', '']) await assert.rejects(hashTree(root, { excludePaths: [bad] }), /exclusion/);
});

test('empty directories and renamed bytes remain part of inventory', async t => {
  const root = await fixture(t);
  const original = await hashTree(root);
  await mkdir(path.join(root, 'empty'));
  assert.notEqual((await hashTree(root)).digest, original.digest);
  await writeFile(path.join(root, 'one'), 'same');
  const first = await hashTree(root);
  await writeFile(path.join(root, 'two'), 'same');
  await rm(path.join(root, 'one'));
  assert.notEqual((await hashTree(root)).digest, first.digest);
  assert.deepEqual(first.files.map(item => item.path), ['one']);
});

test('linked roots, nested directories, excluded links and hardlinked inputs fail closed', async t => {
  const root = await fixture(t), source = path.join(root, 'source'), tree = path.join(root, 'tree');
  await mkdir(source); await mkdir(tree);
  await writeFile(path.join(source, 'payload'), 'bytes');
  const alias = path.join(root, 'alias');
  try { await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Link creation unavailable.'); throw error; }
  await assert.rejects(hashTree(alias), /linked/);
  await assert.rejects(captureInputIdentity({ components: [{ name: 'file', file: path.join(alias, 'payload') }] }), /linked/);
  const nested = path.join(tree, '.local');
  await symlink(source, nested, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(hashTree(tree), /linked/);
  await assert.rejects(hashTree(tree, { excludePaths: ['.local'] }), /linked/);
  await rm(nested);
  await link(path.join(source, 'payload'), path.join(tree, 'hardlink'));
  await assert.rejects(hashTree(tree), /linked/);
});

test('missing or duplicate input components refuse sanitized diagnostics', async t => {
  const root = await fixture(t);
  await assert.rejects(hashTree(path.join(root, 'private-secret-origin')), error => !error.message.includes(root) && !error.message.includes('private-secret-origin'));
  await assert.rejects(captureInputIdentity({ components: [{ name: 'same', root }, { name: 'same', root }] }), /invalid/);
  await assert.rejects(captureInputIdentity({ components: [{ name: 'both', root, file: root }] }), /invalid/);
});

test('execution binds binary bytes, lane, arguments, policy, cwd and all actual behavioral env', async t => {
  const root = await fixture(t);
  const inherited = { PATH: process.env.PATH ?? '', NODE_OPTIONS: '--inspect', RS3_DATASET: 'ambient', SECRET_TOKEN: 'never-retained' };
  const env = sanitizeExecutionEnvironment(inherited, { overrides: { RS3_GAME_DATA_DIR: path.join(root, '.local/game-data') } });
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.RS3_DATASET, undefined); assert.equal(env.SECRET_TOKEN, undefined);
  const options = { lane: 'private-full', cwd: root, args: ['scripts/test.mjs', 'full'], env, policy: { version: 2 } };
  const first = await captureExecutionIdentity(options);
  assert.equal((await captureExecutionIdentity(options)).digest, first.digest);
  assert.equal(JSON.stringify(first).includes(root), false);
  assert.equal(first.binaries.components[0].files[0].size > 0, true);
  for (const change of [{ lane: 'public-full' }, { args: ['scripts/test.mjs', 'quick'] }, { cwd: path.dirname(root) }, { policy: { version: 3 } }, { env: { ...env, NODE_OPTIONS: '--conditions=changed' } }, { env: { ...env, RS3_GAME_DATA_DIR: 'changed' } }]) {
    assert.notEqual((await captureExecutionIdentity({ ...options, ...change })).digest, first.digest);
  }
  const ownerEnv = { ...env, RS3_HEAVY_LOCK_PATH: 'owned', RS3_HEAVY_LOCK_TOKEN: 'volatile-secret', RS3_HEAVY_LOCK_PID: '123' };
  assert.equal((await captureExecutionIdentity({ ...options, env: ownerEnv })).digest, first.digest);
  const command = path.join(root, 'command'); await writeFile(command, 'one');
  const alternate = await captureExecutionIdentity({ ...options, command });
  await writeFile(command, 'two');
  assert.notEqual((await captureExecutionIdentity({ ...options, command })).digest, alternate.digest);
});

test('hardlinked command binaries are hashed while authored file components still refuse them', async t => {
  const root = await fixture(t), original = path.join(root, 'system-command'), alias = path.join(root, 'linked-command');
  await writeFile(original, 'system binary bytes');
  await link(original, alias);
  const options = { lane: 'system-command', command: alias, cwd: root, env: {} };
  const before = await captureExecutionIdentity(options);
  assert.equal(before.binaries.components.find(record => record.name === 'command').files[0].size, Buffer.byteLength('system binary bytes'));
  await assert.rejects(captureInputIdentity({ components: [{ name: 'authored', file: alias }] }), /linked/);
  await assert.rejects(hashTree(root), /linked/);
  await writeFile(original, 'changed system binary bytes');
  const changed = await captureExecutionIdentity(options);
  assert.notEqual(changed.digest, before.digest);
  await rm(original);
  assert.equal((await captureExecutionIdentity(options)).digest, changed.digest);
});

function receiptInputs() {
  const inputDigest = digestValue('input'), executionDigest = digestValue('execution');
  return { inputDigest, executionDigest, key: deriveLaneKey({ inputIdentity: { digest: inputDigest }, executionIdentity: { digest: executionDigest } }), exitCode: 0, cleanupVerified: true, startedAt: new Date(Date.now() - 1000).toISOString(), assemblyDigest: digestValue('assembly') };
}

test('success publication is exclusive and exact success evidence is reusable', async t => {
  const root = await fixture(t), filename = path.join(root, 'release-gate/private-full.json'), inputs = receiptInputs();
  assert.equal(await readSuccessReceipt(filename, inputs), null);
  const written = await writeSuccessReceipt(filename, inputs);
  assert.deepEqual(await readSuccessReceipt(filename, inputs), written);
  await assert.rejects(writeSuccessReceipt(filename, inputs), /already exists/);
  assert.deepEqual(await readSuccessReceipt(filename, inputs), written);
  assert.equal(await readSuccessReceipt(filename, { ...inputs, executionDigest: digestValue('different') }), null);
  assert.equal(await readSuccessReceipt(filename, { ...inputs, inputDigest: digestValue('different') }), null);
  assert.equal(await readSuccessReceipt(filename, { ...inputs, key: digestValue('different') }), null);
  assert.equal(await readSuccessReceipt(filename, { ...inputs, assemblyDigest: digestValue('different') }), null);
  assert.equal(await readSuccessReceipt(filename, inputs, { now: Date.now() + 10000, maxAgeMs: 1000 }), null);
  assert.equal(await readSuccessReceipt(filename, inputs, { now: NaN }), null);
  assert.equal(await readSuccessReceipt(filename, inputs, { maxAgeMs: NaN }), null);
  assert.equal(await readSuccessReceipt(filename, inputs, { maxAgeMs: -1 }), null);
});

test('concurrent publishers produce one complete receipt', async t => {
  const root = await fixture(t), filename = path.join(root, 'raced.json'), inputs = receiptInputs();
  const results = await Promise.allSettled([writeSuccessReceipt(filename, inputs), writeSuccessReceipt(filename, inputs)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await readSuccessReceipt(filename, inputs)).cleanupVerified, true);
});

test('linked receipt parent refuses publication before creating directories', async t => {
  const root = await fixture(t), target = path.join(root, 'target'), alias = path.join(root, 'alias');
  await mkdir(target);
  try { await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Link creation unavailable.'); throw error; }
  const filename = path.join(alias, 'must-not-create', 'receipt.json'), inputs = receiptInputs();
  await assert.rejects(writeSuccessReceipt(filename, inputs), /linked/);
  await assert.rejects(lstat(path.join(target, 'must-not-create')), { code: 'ENOENT' });
  assert.equal(await readSuccessReceipt(filename, inputs), null);
});

test('failed, incomplete, malformed, stale and interrupted receipts cannot authorize reuse', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json'), inputs = receiptInputs();
  for (const changes of [{ exitCode: 1 }, { exitCode: null }, { cleanupVerified: false }, { startedAt: undefined }, { key: digestValue('wrong') }]) {
    await assert.rejects(writeSuccessReceipt(filename, { ...inputs, ...changes }), /requires exact/);
    assert.equal(await readSuccessReceipt(filename, inputs), null);
  }
  const valid = await writeSuccessReceipt(filename, inputs);
  for (const changes of [{ success: false }, { exitCode: 7 }, { cleanupVerified: false }, { cleanupVerified: undefined }, { executionDigest: digestValue('stale') }, { schema: 'rs3-success-v1' }, { completedAt: new Date(Date.now() + 100000).toISOString() }, { startedAt: '1' }, { startedAt: undefined }, { key: undefined }, { assemblyDigest: 'bad' }]) {
    await writeFile(filename, JSON.stringify({ ...valid, ...changes }));
    assert.equal(await readSuccessReceipt(filename, inputs), null);
  }
  await writeFile(filename, '{"schema":');
  assert.equal(await readSuccessReceipt(filename, inputs), null);
  await rm(filename);
  await writeFile(filename + '.crashed.tmp', JSON.stringify(valid));
  await writeFile(filename + '.lock', 'interrupted publisher');
  assert.equal(await readSuccessReceipt(filename, inputs), null);
  await assert.rejects(writeSuccessReceipt(filename, inputs), /publication refused/);
  assert.equal(await readSuccessReceipt(filename, inputs), null);
});
