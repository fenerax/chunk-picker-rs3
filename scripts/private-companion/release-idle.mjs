// Release admission uses metadata only. Never open the duo save or invitations.
import path from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Original watcher command in Claude transcript 981cc3e7-cbb2-4474-a361-
// 2dc50f0e409b, tool timestamp 2026-10-17T16:11:35.199Z:
// Get-ChildItem $d -Recurse -File | sort LastWriteTime -Desc | select -First 1;
// admit when ((Get-Date)-$last).TotalMinutes -ge 45. Preserve that recursive
// newest-file mtime rule. The supplied save must exist; linked inputs refuse.
export const RELEASE_IDLE_MS = 45 * 60 * 1000;
const failure = code => Object.assign(new Error(code), { code });

async function regularSignal(file, root) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw failure('RS3_IDLE_UNAVAILABLE');
    if (current === path.resolve(file) && (!stat.isFile() || stat.nlink !== 1)) throw failure('RS3_IDLE_UNAVAILABLE');
    if (path.dirname(current) === current) break;
  }
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure('RS3_IDLE_UNAVAILABLE');
  return { name: path.relative(root, file).split(path.sep).join('/'), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev };
}

export async function readIdleState(savePath, { now = Date.now() } = {}) {
  if (!path.isAbsolute(savePath ?? '') || !Number.isFinite(now)) throw failure('RS3_IDLE_UNAVAILABLE');
  try {
    const root = path.dirname(path.resolve(savePath)), signals = [];
    await regularSignal(savePath, root); // A missing live save never looks idle.
    async function walk(directory) {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('RS3_IDLE_UNAVAILABLE');
      const names = (await readdir(directory)).sort();
      for (const name of names) {
        const file = path.join(directory, name), entry = await lstat(file);
        if (entry.isSymbolicLink()) throw failure('RS3_IDLE_UNAVAILABLE');
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) signals.push(await regularSignal(file, root));
        else throw failure('RS3_IDLE_UNAVAILABLE');
      }
      if (JSON.stringify(names) !== JSON.stringify((await readdir(directory)).sort())) throw failure('RS3_IDLE_UNAVAILABLE');
    }
    await walk(root);
    signals.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const lastActivityMs = Math.max(...signals.map(signal => signal.mtimeMs));
    if (!Number.isFinite(lastActivityMs) || lastActivityMs > now) throw failure('RS3_IDLE_UNAVAILABLE');
    const quietMs = now - lastActivityMs;
    return { idle: quietMs >= RELEASE_IDLE_MS, thresholdMs: RELEASE_IDLE_MS, quietMs,
      lastActivityAt: new Date(lastActivityMs).toISOString(),
      signalDigest: createHash('sha256').update(JSON.stringify(signals)).digest('hex') };
  } catch { throw failure('RS3_IDLE_UNAVAILABLE'); }
}

export async function assertIdle(savePath, options = {}) {
  const state = await readIdleState(savePath, options);
  if (!state.idle) throw failure('RS3_RELEASE_ACTIVE');
  return state;
}

// Observe activity throughout a phase, but let the owned phase finish cleanup.
// The caller never kills descendants or interrupts an owned live handover.
export async function observeIdle(savePath, action, { now = Date.now, intervalMs = 250 } = {}) {
  const initial = await assertIdle(savePath, { now: now() });
  let changed = false, unavailable = false, pending = Promise.resolve();
  const inspect = async () => {
    try { const next = await readIdleState(savePath, { now: now() }); if (!next.idle || next.signalDigest !== initial.signalDigest) changed = true; }
    catch { unavailable = true; }
  };
  const timer = setInterval(() => { pending = pending.then(inspect); }, intervalMs); timer.unref();
  try {
    let result, actionFailure;
    try { result = await action(); } catch (error) { actionFailure = { error }; }
    clearInterval(timer); await pending;
    await inspect();
    if (unavailable) throw failure('RS3_IDLE_UNAVAILABLE');
    if (changed) throw failure('RS3_RELEASE_ACTIVE');
    if (actionFailure) throw actionFailure.error;
    return result;
  } finally { clearInterval(timer); await pending; }
}
