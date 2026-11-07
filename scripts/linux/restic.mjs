import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { credential } from './ops-status.mjs';
import { directory, headroom } from './files.mjs';
// Compressed sums checked against upstream v0.18.1 SHA256SUMS; binary sums
// independently calculated from those verified archives on 2026-11-05.
export const resticPin = Object.freeze({ version: '0.18.1',
  windowsX64: { archive: '0c1a713440578cb400d2e76208feb24f1b339426b075a21f73b6b2132692515d', binary: '034b7bf67a23049d30d58ddf4fb318239726cc74728b80bff876de824f2fc786' },
  x64: { archive: '680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d', binary: '01143daba61a1dc8afb0cb3d03ba83e6b118f55b6b146b27473a09efc3df13d6' },
  arm64: { archive: '87f53fddde38764095e9c058a3b31834052c37e5826d2acf34e18923c006bd45', binary: 'f04a6bf766a33fba44b5be068e29091259dda5ef37f1e68ba9a8e0cda053120e' } });
// Restore-point tags vary per upload; grouping by them would retain every point.
export const retentionArgs = Object.freeze(['forget', '--tag', 'chunk-picker', '--group-by', 'host',
  '--keep-daily', '30', '--keep-weekly', '8', '--keep-monthly', '12', '--prune']);
export async function verifyRestic(binary = '/usr/local/bin/restic') {
  const pin = process.platform === 'win32' && process.arch === 'x64' ? resticPin.windowsX64 : resticPin[process.arch];
  if (!pin || !path.isAbsolute(binary)) throw Error('Unsupported restic platform.');
  const hash = createHash('sha256'); for await (const bytes of createReadStream(binary)) hash.update(bytes);
  if (hash.digest('hex') !== pin.binary) throw Error('Restic binary pin differs.');
}
// backup and forget require repository locks in 0.18.1; read-only commands
// can avoid them. Locks on B2 do not grant the VPS permanent-delete authority.
const prunes = args => args[0] === 'prune' || args[0] === 'forget' && args.includes('--prune');
export const resticConnections = args => prunes(args) || args[0] === 'check' ? 2 : 1;
export const resticArgs = (args, cacheDir) => [...(cacheDir ? ['--cache-dir', cacheDir] : ['--no-cache']), '--pack-size', '16', '-o', `b2.connections=${resticConnections(args)}`,
  '-o', `local.connections=${resticConnections(args)}`,
  ...(['check', 'snapshots', 'stats', 'restore', 'ls'].includes(args[0]) ? ['--no-lock'] : []),
  ...args, ...(args[0] === 'backup' ? ['--read-concurrency', '1'] : [])];
// 0.18.1: two data + two tree packers, one blocked QueuePacker and one
// uploader per backend connection (unbuffered queue). GOMAXPROCS=1 pins the
// blob saver to one. Backup uses one connection; prune/check need two.
// Pack targets are NOT file limits: blobs/trees can overshoot. RLIMIT_FSIZE
// enforces a 2*pack-size ceiling even for an oversized tree. Such an upload
// fails safely instead of consuming the writer's reserve. Include allocation
// rounding and directory metadata, in addition to every active pack slot.
export const resticPackLimit = 32 * 1024 ** 2;
export const resticTempBound = 6 * resticPackLimit + 1024 ** 2;
export const resticTempBudget = args => (5 + resticConnections(args)) * resticPackLimit + 1024 ** 2;
// On Windows no RLIMIT_FSIZE bounds oversized blobs. Treat the entire live
// blob corpus as a possible single pack, with header/encryption margin, in
// every packer/queue/upload slot. Admit this worst case before any mutation.
export function windowsRepackBudget(stats, args) {
  const values = [stats.total_size, stats.total_uncompressed_size ?? stats.total_size, stats.total_blob_count ?? 0];
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)
    || values[0] > 0 && !values[2]) throw Error('Repack size unavailable.');
  const pack = Math.max(resticPackLimit, Math.max(...values.slice(0, 2)) * 2 + values[2] * 128 + 1024 ** 2);
  const budget = (5 + resticConnections(args)) * pack + 1024 ** 2;
  if (!Number.isSafeInteger(budget)) throw Error('Repack size unavailable.');
  return { pack, budget };
}
// Preserve only known diagnostic phrases from the bounded tail. Arbitrary
// words (including single-label hosts, paths and credentials) never reach logs.
export function redactedResticTail(stderr) {
  const phrases = /\b(?:connection refused|context deadline exceeded|permission denied|access denied|repository does not exist|unable to open config file|no space left on device|request canceled|i\/o timeout|fatal|error|failed|timeout|killed|corrupt|not found)\b/gi;
  return String(stderr).slice(-8192).split(/\r?\n/).filter(Boolean).slice(-8)
    .map(line => '[redacted] ' + (line.match(phrases) ?? []).join(' ').slice(0, 160)).join('\n').slice(-1536);
}
export function executeRestic(binary, args, { env, signal, packProducing = false, timeoutMs = 25 * 60000,
  log = message => process.stderr.write(message + '\n'), clock = { setTimeout, clearTimeout }, execute = spawn }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120 * 60000) throw Error('Invalid restic deadline.');
    // Wait for close before allowing temp cleanup, including on cancellation.
    // Linux has a hard per-pack ceiling. The trusted Windows PC uses the
    // same private temp directory, reserve admission and sampled byte budget.
    const limit = process.platform === 'linux' && packProducing;
    const child = execute(limit ? 'prlimit' : binary,
      limit ? [`--fsize=${resticPackLimit}:${resticPackLimit}`, '--', binary, ...args] : args,
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, fault = false;
    const abort = () => child.kill('SIGKILL');
    const timer = clock.setTimeout(() => { fault = true; abort(); }, timeoutMs);
    child.stdout.on('data', chunk => {
      // ls walks all trees, but its potentially huge listing is not a receipt.
      if (args.includes('ls')) return;
      bytes += chunk.length;
      if (bytes > 4 * 1024 ** 2) { fault = true; abort(); } else stdout += chunk;
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on('error', () => { fault = true; });
    child.on('close', code => {
      clock.clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (fault || code !== 0 || signal?.aborted) {
        const phase = args.find(arg => ['backup', 'check', 'snapshots', 'ls', 'init', 'restore', 'stats', 'prune', 'forget'].includes(arg)) ?? 'command';
        log(`Restic ${phase} failed${fault ? ' (limit or process failure)' : ''}; stderr tail:\n${redactedResticTail(stderr) || '[empty]'}`);
        reject(Error('Encrypted repository operation failed.'));
      } else resolve(stdout);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function tempBudget(root, packLimit, totalLimit) {
  let bytes = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (!info) continue; // A pack can disappear while it is uploaded.
        if (!info.isFile() || info.size > packLimit || (bytes += info.size) > totalLimit) throw Error('Restic temporary budget exceeded.');
      }
    }
  }
  await walk(root);
}
export async function guardedRestic({ root, reserve, binary, args, env, signal,
  check = headroom, execute = executeRestic, intervalMs = 250, platform = process.platform, cacheDir, timeoutMs, useCache = true }) {
  // Integrity verification must fetch remote metadata, even when callers
  // supply a warm cache. check uses its default isolated temporary cache.
  if (!useCache || args[0] === 'check') cacheDir = undefined;
  await directory(root);
  if (cacheDir) { if (!path.isAbsolute(cacheDir)) throw Error('Absolute cache path required.'); await directory(cacheDir); }
  const temporary = await mkdtemp(path.join(root, 'restic-'));
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  process.once('SIGTERM', abort); process.once('SIGINT', abort);
  let timer, checking, fault, destination;
  let packLimit = resticPackLimit, tempBound = resticTempBudget(args);
  try {
    signal?.throwIfAborted();
    await check(temporary, tempBound, reserve);
    if (cacheDir) await check(cacheDir, 0, reserve);
    timer = setInterval(() => {
      if (checking) return;
      // Retain another full write envelope between samples. No other writer's
      // future allocations are assumed; loss of headroom fails closed.
      checking = Promise.all([check(temporary, tempBound, reserve), tempBudget(temporary, packLimit, tempBound),
        ...(destination ? [check(destination, 0, reserve)] : []), ...(cacheDir ? [check(cacheDir, 0, reserve)] : [])])
        .catch(error => { fault = error; controller.abort(); }).finally(() => { checking = null; });
    }, intervalMs);
    const options = { env: { ...env, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      RESTIC_CACHE_DIR: cacheDir ?? path.join(temporary, 'cache'), GOMAXPROCS: '1' }, signal: controller.signal, timeoutMs };
    if (platform === 'win32' && prunes(args)) {
      const stats = JSON.parse(await execute(binary, resticArgs(['stats', '--mode', 'raw-data', '--json'], cacheDir), options));
      const worst = windowsRepackBudget(stats, args);
      packLimit = worst.pack; tempBound = worst.budget;
      await check(temporary, tempBound, reserve);
    }
    if (args[0] === 'restore') {
      // Resolve mutable selectors such as "latest" once, then budget and restore
      // that exact snapshot. Budget the full tree even for a filtered restore.
      const target = args.indexOf('--target');
      const restoreTarget = target >= 0 ? args[target + 1] : args.find(arg => arg.startsWith('--target='))?.slice(9);
      if (!path.isAbsolute(restoreTarget ?? '') || !args[1] || args[1].startsWith('-')) throw Error('Restore snapshot and absolute target required.');
      const snapshots = JSON.parse(await execute(binary, resticArgs(['snapshots', '--json', args[1]], cacheDir), options));
      if (!Array.isArray(snapshots) || snapshots.length !== 1 || !/^[a-f0-9]{64}$/.test(snapshots[0].id)) throw Error('One restore snapshot required.');
      const id = snapshots[0].id;
      const stats = JSON.parse(await execute(binary, resticArgs(['stats', id, '--mode', 'restore-size', '--json'], cacheDir), options));
      if (!Number.isSafeInteger(stats.total_size) || stats.total_size < 0
        || !Number.isSafeInteger(stats.total_size + tempBound)) throw Error('Restore size unavailable.');
      await directory(restoreTarget);
      // Include the temp envelope when both paths share a filesystem; reserving
      // it on a separate destination filesystem is conservative too.
      await check(restoreTarget, stats.total_size + tempBound, reserve);
      destination = restoreTarget;
      args = ['restore', id, ...args.slice(2)];
    }
    const packProducing = ['backup', 'prune', 'init', 'check'].includes(args[0])
      || prunes(args);
    const result = await execute(binary, resticArgs(args, cacheDir), { ...options, packProducing });
    await checking;
    if (fault) throw fault;
    await tempBudget(temporary, packLimit, tempBound);
    controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    return result;
  } finally {
    clearInterval(timer); await checking;
    signal?.removeEventListener('abort', abort);
    process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort);
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function resticRunner(config, { signal, settings } = {}) {
  const binary = '/usr/local/bin/restic'; await verifyRestic(binary);
  if (!/^b2:[a-z0-9][a-z0-9-]{5,49}:chunk-picker$/.test(config.repository ?? '')) throw Error('Private B2 repository required.');
  const credentials = process.env.CREDENTIALS_DIRECTORY;
  const env = { PATH: '/usr/bin:/bin', HOME: '/root', TZ: 'UTC', RESTIC_REPOSITORY: config.repository,
    RESTIC_PASSWORD_FILE: path.join(credentials ?? '', 'restic-password'),
    B2_ACCOUNT_ID: await credential('b2-account'), B2_ACCOUNT_KEY: await credential('b2-key') };
  await credential('restic-password');
  return async (args, { timeoutMs, useCache } = {}) => {
    // No inherited RESTIC/B2 endpoints, hooks, proxy credentials or debug logs.
    try { return await guardedRestic({ root: path.join(settings.scratchRoot, 'restic-tmp'), reserve: settings.minFreeBytes,
      binary, args, env, signal, timeoutMs, useCache, cacheDir: path.join(settings.controlDir, 'restic-cache') }); }
    catch { throw Error('Encrypted repository operation failed.'); }
  };
}
