import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { credential } from './ops-status.mjs';
import { directory, headroom } from './files.mjs';
// Compressed sums checked against upstream v0.18.1 SHA256SUMS; binary sums
// independently calculated from those verified archives on 2026-11-05.
export const resticPin = Object.freeze({ version: '0.18.1',
  windowsX64: { archive: '0c1a713440578cb400d2e76208feb24f1b339426b075a21f73b6b2132692515d', binary: '034b7bf67a23049d30d58ddf4fb318239726cc74728b80bff876de824f2fc786' },
  x64: { archive: '680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d', binary: '01143daba61a1dc8afb0cb3d03ba83e6b118f55b6b146b27473a09efc3df13d6' },
  arm64: { archive: '87f53fddde38764095e9c058a3b31834052c37e5826d2acf34e18923c006bd45', binary: 'f04a6bf766a33fba44b5be068e29091259dda5ef37f1e68ba9a8e0cda053120e' } });
export const retentionArgs = Object.freeze(['forget', '--tag', 'chunk-picker', '--group-by', 'host,tags',
  '--keep-daily', '30', '--keep-weekly', '8', '--keep-monthly', '12', '--prune']);
export async function verifyRestic(binary = '/usr/local/bin/restic') {
  const pin = process.platform === 'win32' && process.arch === 'x64' ? resticPin.windowsX64 : resticPin[process.arch];
  if (!pin || !path.isAbsolute(binary)) throw Error('Unsupported restic platform.');
  const hash = createHash('sha256'); for await (const bytes of createReadStream(binary)) hash.update(bytes);
  if (hash.digest('hex') !== pin.binary) throw Error('Restic binary pin differs.');
}
// backup and forget require repository locks in 0.18.1; read-only commands
// can avoid them. Locks on B2 do not grant the VPS permanent-delete authority.
export const resticArgs = args => ['--no-cache', '--pack-size', '16', '-o', 'b2.connections=1',
  ...(['check', 'snapshots', 'restore'].includes(args[0]) ? ['--no-lock'] : []),
  ...args, ...(args[0] === 'backup' ? ['--read-concurrency', '1'] : [])];
// 0.18.1: two data + two tree packers, one blocked QueuePacker and one
// uploader (unbuffered queue). GOMAXPROCS=1 pins the blob saver to one.
// Pack targets are NOT file limits: blobs/trees can overshoot. RLIMIT_FSIZE
// enforces a 2*pack-size ceiling even for an oversized tree. Such an upload
// fails safely instead of consuming the writer's reserve. Include allocation
// rounding and directory metadata, in addition to all six full pack slots.
export const resticPackLimit = 32 * 1024 ** 2;
export const resticTempBound = 6 * resticPackLimit + 1024 ** 2;
export function executeRestic(binary, args, { env, signal }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    // Do not give execFile an AbortSignal: its abort callback may precede exit.
    // Wait for the normal close callback before allowing temp cleanup.
    // Linux has a hard per-pack ceiling. The trusted Windows PC uses the
    // same private temp directory, reserve admission and sampled byte budget.
    const child = execFile(process.platform === 'win32' ? binary : 'prlimit',
      process.platform === 'win32' ? args : [`--fsize=${resticPackLimit}:${resticPackLimit}`, '--', binary, ...args],
      { env, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 4 * 1024 ** 2, timeout: 25 * 60000 },
      (error, stdout) => { signal?.removeEventListener('abort', abort); error || signal?.aborted ? reject(Error('Encrypted repository operation failed.')) : resolve(stdout); });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
async function tempBudget(root) {
  let bytes = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (!info) continue; // A pack can disappear while it is uploaded.
        if (!info.isFile() || info.size > resticPackLimit || (bytes += info.size) > resticTempBound) throw Error('Restic temporary budget exceeded.');
      }
    }
  }
  await walk(root);
}
export async function guardedRestic({ root, reserve, binary, args, env, signal,
  check = headroom, execute = executeRestic, intervalMs = 250 }) {
  await directory(root);
  const temporary = await mkdtemp(path.join(root, 'restic-'));
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  process.once('SIGTERM', abort); process.once('SIGINT', abort);
  let timer, checking, fault;
  try {
    signal?.throwIfAborted();
    await check(temporary, resticTempBound, reserve);
    timer = setInterval(() => {
      if (checking) return;
      // Retain another full write envelope between samples. No other writer's
      // future allocations are assumed; loss of headroom fails closed.
      checking = Promise.all([check(temporary, resticTempBound, reserve), tempBudget(temporary)])
        .catch(error => { fault = error; controller.abort(); }).finally(() => { checking = null; });
    }, intervalMs);
    const result = await execute(binary, resticArgs(args), { env: { ...env, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      RESTIC_CACHE_DIR: path.join(temporary, 'cache'), GOMAXPROCS: '1' }, signal: controller.signal });
    await checking;
    if (fault) throw fault;
    await tempBudget(temporary);
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
  return async args => {
    // No inherited RESTIC/B2 endpoints, hooks, proxy credentials or debug logs.
    try { return await guardedRestic({ root: path.join(settings.scratchRoot, 'restic-tmp'), reserve: settings.minFreeBytes,
      binary, args, env, signal }); }
    catch { throw Error('Encrypted repository operation failed.'); }
  };
}
