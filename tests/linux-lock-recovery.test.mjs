import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { exclusive, encode, json } from '../scripts/linux/files.mjs';
import { processIdentity } from '../scripts/linux/start-check.mjs';

const execute = promisify(execFile);
const linux = { skip: process.platform !== 'linux' };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'operator-lock-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, lock: path.join(root, 'operation.lock') };
}

test('a killed and reaped owner is moved aside before running an operation', linux, async t => {
  const { lock, root } = await fixture(t);
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await once(child.stdout, 'data');
  const record = encode({ pid: child.pid, processIdentity: await processIdentity(child.pid), startedAt: new Date().toISOString() });
  await writeFile(lock, record);
  child.kill('SIGKILL'); await once(child, 'exit');
  let ran = 0;
  assert.equal(await exclusive(lock, async () => {
    ran++;
    const owner = await json(lock);
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.processIdentity, await processIdentity(process.pid));
    return 42;
  }), 42);
  assert.equal(ran, 1);
  const names = (await readdir(root)).filter(name => name !== 'operation.lock.recovery');
  assert.equal(names.length, 1);
  assert.match(names[0], new RegExp('^stale-operation\\.lock\\.[0-9.]+-pid' + child.pid + '$'));
  assert.equal(await readFile(path.join(root, names[0]), 'utf8'), record);
});

test('a live owner remains busy even when the lock is old', linux, async t => {
  const { lock, root } = await fixture(t);
  await exclusive(lock, async () => {
    const old = new Date(Date.now() - 3600000); await utimes(lock, old, old);
    await assert.rejects(exclusive(lock, () => assert.fail()), { code: 'EEXIST' });
    assert.deepEqual(await exclusive(lock, () => assert.fail(), { skipBusy: true }), { skipped: true });
    assert.deepEqual(await readdir(root), ['operation.lock', 'operation.lock.recovery']);
  });
});

test('PID reuse and a previous boot prove that the recorded owner is gone', linux, async t => {
  const { lock, root } = await fixture(t);
  const identity = await processIdentity(process.pid), [boot, start] = identity.split(':');
  for (const oldIdentity of [boot + ':' + (BigInt(start) + 1n), '00000000-0000-0000-0000-000000000000:' + start]) {
    await writeFile(lock, encode({ pid: process.pid, processIdentity: oldIdentity }));
    await exclusive(lock, () => {});
  }
  assert.equal((await readdir(root)).filter(name => name.startsWith('stale-operation.lock.')).length, 2);
});

test('old-format, invalid and unreadable records cannot be taken over', linux, async t => {
  const { lock } = await fixture(t);
  for (const record of [encode({ pid: 2147483647, startedAt: '2000-01-01' }), '{private invalid json', encode({ pid: 2147483647, processIdentity: 'unknown' })]) {
    await writeFile(lock, record);
    await assert.rejects(exclusive(lock, () => assert.fail()), { code: 'EEXIST' });
    assert.equal(await readFile(lock, 'utf8'), record);
    await rm(lock);
  }
  // A directory cannot be read as a lock record, even when running as root.
  const { mkdir } = await import('node:fs/promises'); await mkdir(lock);
  await assert.rejects(exclusive(lock, () => assert.fail()), { code: 'EEXIST' });
});

test('concurrent reclaimers admit at most one operation', linux, async t => {
  const { lock } = await fixture(t);
  const [, start] = (await processIdentity(process.pid)).split(':');
  await writeFile(lock, encode({ pid: process.pid, processIdentity: '00000000-0000-0000-0000-000000000000:' + start }));
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const calls = Array.from({ length: 8 }, () => exclusive(lock, async () => { entered(); await barrier; return 'ran'; }, { skipBusy: true }));
  await ready;
  // Keep the winner active until the other contenders have observed its lock.
  await new Promise(resolve => setTimeout(resolve, 50)); release();
  const results = await Promise.all(calls);
  assert.equal(results.filter(value => value === 'ran').length, 1);
});

test('health CLI quietly skips a recent busy lock and fails with one static line after 30 minutes', linux, async t => {
  const { lock, root } = await fixture(t), config = path.join(root, 'operator.json');
  await writeFile(config, encode({ service: 'chunk-picker.service', current: path.join(root, 'unused-pointer'), dataDir: path.join(root, 'unused-save'),
    controlDir: root, scratchRoot: path.join(root, 'scratch'), backupDir: path.join(root, 'backups') }));
  await writeFile(lock, encode({ pid: process.pid, processIdentity: await processIdentity(process.pid), private: 'never-print-this' }));
  const args = ['scripts/linux/operator.mjs', 'health'], options = { env: { ...process.env, RS3_OPERATOR_CONFIG: config } };
  const fresh = await execute(process.execPath, args, options);
  assert.equal(fresh.stdout, ''); assert.equal(fresh.stderr, '');
  const old = new Date(Date.now() - 1801000); await utimes(lock, old, old);
  await assert.rejects(execute(process.execPath, args, options), error => {
    assert.equal(error.code, 1); assert.equal(error.stdout, '');
    assert.equal(error.stderr, 'Operator lock held for over 30 minutes; inspect privately.\n');
    return true;
  });
  await assert.rejects(execute(process.execPath, ['scripts/linux/operator.mjs', 'backup'], options), error => {
    assert.equal(error.stderr, 'Operator command refused; keep maintenance evidence and inspect privately. Lock busy.\n'); return true;
  });
});

test('a killed recovery coordinator cannot leave a second stale lock', linux, async t => {
  const { root, lock } = await fixture(t);
  const [, start] = (await processIdentity(process.pid)).split(':');
  await writeFile(lock, encode({ pid: process.pid, processIdentity: '00000000-0000-0000-0000-000000000000:' + start }));
  const script = `const { openSync } = require('node:fs');
    const { spawnSync } = require('node:child_process');
    const fd = openSync(process.argv[1], 'a', 0o600);
    if (spawnSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] }).status !== 0) process.exit(1);
    process.stdout.write('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['-e', script, lock + '.recovery'], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await once(child.stdout, 'data');
  assert.deepEqual(await exclusive(lock, () => assert.fail(), { skipBusy: true }), { skipped: true });
  child.kill('SIGKILL'); await once(child, 'exit');
  assert.equal(await exclusive(lock, () => 'recovered'), 'recovered');
  assert.equal((await readdir(root)).filter(name => name.startsWith('stale-operation.lock.')).length, 1);
});
