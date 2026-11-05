import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, mkdtemp, readdir, rm, stat, readFile, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { offhostFixture, assertPayloadClosure } from './helpers/offhost.mjs';
import { offhostBackup } from '../scripts/linux/offhost-backup.mjs';
import { verifyBackup } from '../scripts/linux/recovery.mjs';
import { retentionArgs, verifyRestic, resticArgs, guardedRestic, resticTempBound, resticPackLimit, executeRestic } from '../scripts/linux/restic.mjs';
const execute = promisify(execFile);

async function temporary(t) {
  const base = fileURLToPath(new URL('../.local/restic-budget-tests/', import.meta.url)); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'run-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('restic pack concurrency and kernel-enforced temp bound are pinned', () => {
  const args = resticArgs(['backup', '/synthetic']);
  assert(args.includes('b2.connections=1')); assert(args.includes('--read-concurrency'));
  assert.equal(args[args.indexOf('--pack-size') + 1], '16');
  assert.equal(resticTempBound, 6 * resticPackLimit + 1024 ** 2);
});
test('temp admission refuses reserve shortfall before launch and cleans on success, failure and cancellation', async t => {
  const root = await temporary(t);
  for (const failure of ['space', 'process', 'abort', 'none']) {
    let launched = false; const controller = new AbortController();
    const promise = guardedRestic({ root, reserve: 1234, binary: '/synthetic', args: ['backup'], env: {}, signal: controller.signal,
      check: async (dir, bytes, reserve) => { assert(dir.startsWith(root)); assert.equal(bytes, resticTempBound); assert.equal(reserve, 1234); if (failure === 'space') throw Error('space'); },
      execute: async (_binary, args, { env, signal }) => {
        launched = true; assert(env.TMPDIR.startsWith(root)); assert.equal(env.GOMAXPROCS, '1');
        await writeFile(path.join(env.TMPDIR, 'pack'), 'synthetic');
        if (failure === 'process') throw Error('process');
        if (failure === 'abort') { controller.abort(); assert(signal.aborted); throw Error('abort'); }
        return 'receipt';
      } });
    if (failure === 'none') assert.equal(await promise, 'receipt'); else await assert.rejects(promise);
    assert.equal(launched, failure !== 'space'); assert.deepEqual(await readdir(root), []);
  }
});
test('reserve watcher cancels upload and waits for termination before removing private packs', async t => {
  const root = await temporary(t); let checks = 0, stopped = false;
  await assert.rejects(guardedRestic({ root, reserve: 1, args: ['backup'], env: {}, intervalMs: 5,
    check: async () => { if (++checks > 1) throw Error('reserve'); },
    execute: async (_binary, _args, { env, signal }) => {
      const aborted = signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      await writeFile(path.join(env.TMPDIR, 'pack'), 'synthetic');
      await aborted;
      assert((await readdir(env.TMPDIR)).includes('pack')); stopped = true; throw Error('killed');
    } }));
  assert(stopped); assert.deepEqual(await readdir(root), []);
});

test('private temp and cache override inherited paths and oversized PC packs cancel before cleanup', async t => {
  const root = await temporary(t); let stopped = false;
  await assert.rejects(guardedRestic({ root, reserve: 0, args: ['forget'], intervalMs: 5,
    env: { TMPDIR: 'untrusted', TEMP: 'untrusted', TMP: 'untrusted', RESTIC_CACHE_DIR: 'untrusted' },
    execute: async (_binary, args, { env, signal }) => {
      const aborted = signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      assert.equal(env.TEMP, env.TMPDIR); assert.equal(env.TMP, env.TMPDIR);
      assert.equal(env.RESTIC_CACHE_DIR, path.join(env.TMPDIR, 'cache')); assert(args.includes('--no-cache'));
      const pack = await open(path.join(env.TMPDIR, 'pack'), 'w');
      try { await pack.truncate(resticPackLimit + 1); } finally { await pack.close(); }
      await aborted;
      assert((await readdir(env.TMPDIR)).includes('pack')); stopped = true;
    } }));
  assert(stopped); assert.deepEqual(await readdir(root), []);
});

function resticBypass(source) {
  return /\bresticArgs\b/.test(source)
    || /\bexecuteRestic\s*\(/.test(source)
    || /\b(?:spawn|spawnSync|execFile|execFileSync|execute|run|repositoryRun)\s*\(\s*['"][^'"]*\brestic(?:\.exe)?['"]/.test(source)
    || /from ['"][^'"]*\/restic\.mjs['"]/.test(source)
      && /\b(?:spawn|spawnSync|execFile|execFileSync|execute|run|repositoryRun)\s*\(\s*(?:binary|file)\b/.test(source);
}
test('all script restic spawns and argument policies stay inside the guard', async () => {
  const scripts = fileURLToPath(new URL('../scripts/', import.meta.url)), bypasses = [];
  for (const name of await readdir(scripts, { recursive: true })) {
    if (!name.endsWith('.mjs') || name.replaceAll('\\', '/') === 'linux/restic.mjs') continue;
    if (resticBypass(await readFile(path.join(scripts, name), 'utf8'))) bypasses.push(name);
  }
  assert.deepEqual(bypasses, []);
  // Exercise the detector against both reviewed bypass shapes and a direct spawn.
  assert(resticBypass("execute('/usr/local/bin/restic', resticArgs(args), { env })"));
  assert(resticBypass("import { verifyRestic } from '../linux/restic.mjs'; repositoryRun(binary, args, env)"));
  assert(resticBypass("spawn('restic', ['check'])"));
  assert(resticBypass('executeRestic(binary, args, options)'));
});
test('kernel ceiling rejects oversized packs and abort waits for the owned process to close', { skip: process.platform !== 'linux' }, async t => {
  const root = await temporary(t), signal = new AbortController();
  const pack = path.join(root, 'pack');
  // The first write may return a short count; the next write at the ceiling
  // must fail. Verify both the failure and the exact kernel-enforced size.
  await assert.rejects(executeRestic('/usr/bin/python3', ['-c', `f=open(${JSON.stringify(pack)}, 'wb', buffering=0); f.write(b'x' * ${resticPackLimit + 1}); f.write(b'x')`], { env: { PATH: '/usr/bin:/bin' }, signal: signal.signal }));
  assert.equal((await stat(pack)).size, resticPackLimit);
  const pending = executeRestic('/usr/bin/python3', ['-c', 'import time;time.sleep(60)'], { env: {}, signal: signal.signal });
  signal.abort(); await assert.rejects(pending);
});

test('restic executor launches and cancels the owned child on the current platform', async () => {
  const env = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  assert.equal(await executeRestic(process.execPath, ['-e', "process.stdout.write('synthetic-receipt')"], { env }), 'synthetic-receipt');
  const controller = new AbortController();
  const pending = executeRestic(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env, signal: controller.signal });
  controller.abort(); await assert.rejects(pending);
});
test('real pinned restic encrypts, checks, restores the full snapshot and rebuild bundle, then prunes locally', { skip: process.platform !== 'linux' }, async t => {
  await verifyRestic(); // CI installs the reviewed binary; absence is a failure.
  const f = await offhostFixture(t), local = path.join(f.dir, 'local'); await mkdir(local);
  const password = path.join(local, 'password'); await writeFile(password, 'synthetic-local-repository-only', { mode: 0o600 });
  const env = { PATH: '/usr/bin:/bin', HOME: local, TZ: 'UTC', RESTIC_REPOSITORY: path.join(local, 'repository'),
    RESTIC_PASSWORD_FILE: password, RESTIC_CACHE_DIR: path.join(local, 'cache') };
  const run = async (args, options = {}) => guardedRestic({ root: path.join(local, 'temp'), reserve: 0,
    binary: '/usr/local/bin/restic', args, env, ...options });
  await run(['init']); await offhostBackup({ ...f, config: {}, run, ping: async () => false });
  await run(['check', '--read-data']);
  const snapshots = JSON.parse(await run(['snapshots', '--json'])); assert.equal(snapshots.length, 1);
  assert(Math.abs(Date.parse(snapshots[0].time) - Date.parse(f.snapshotAt)) < 1000);
  const restored = path.join(local, 'restored'); await run(['restore', 'latest', '--target', restored]);
  await verifyBackup(path.join(restored, snapshots[0].paths.find(file => path.basename(file) === 'snapshot').slice(1)));
  const { inventory, json, encode } = await import('../scripts/linux/files.mjs');
  const rebuild = path.join(restored, snapshots[0].paths.find(file => path.basename(file) === 'rebuild').slice(1));
  const manifest = await json(path.join(rebuild, 'rebuild-manifest.json'));
  await assertPayloadClosure(rebuild);
  assert.equal(encode((await inventory(rebuild)).filter(row => row.path !== 'rebuild-manifest.json')), encode(manifest.files));
  await run([...retentionArgs]); await run(['check', '--read-data']);
  assert.equal(JSON.parse(await run(['snapshots', '--json'])).length, 1);
  const { exists } = await import('../scripts/linux/files.mjs');
  assert.equal(await exists(env.RESTIC_CACHE_DIR), false);
});
