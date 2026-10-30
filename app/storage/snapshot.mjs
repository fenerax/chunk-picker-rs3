import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, mkdir, open, readdir, rm, statfs, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const barriers = new Map(), context = new AsyncLocalStorage();
function barrier(dataDir) {
  const key = path.resolve(dataDir);
  if (!barriers.has(key)) barriers.set(key, { key, active: new Set(), gate: null });
  return barriers.get(key);
}
// All durable mutation queues enter here. Nested work belongs to its caller.
export async function withStoreWrite(dataDir, work) {
  const state = barrier(dataDir);
  const parent = context.getStore();
  const nested = parent?.state === state && parent.active;
  if (!nested) while (state.gate) await state.gate;
  let release;
  const done = new Promise(resolve => { release = resolve; });
  state.active.add(done);
  const owner = { state, active: true };
  try { return await context.run(owner, work); }
  finally { owner.active = false; state.active.delete(done); release(); }
}

export function snapshotRoot(dataDir) { return path.resolve(dataDir) + '.snapshots'; }
export function snapshotPath(dataDir, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new TypeError('Invalid snapshot ID.');
  return path.join(snapshotRoot(dataDir), id);
}

// Pin immutable, atomically replaced files with open descriptors. Copy their
// bytes AFTER releasing writers: no hard links, full-store hashing or 70 MB
// allocation in the Linux write hold. Retention may unlink pinned files.
// Windows cannot replace an open file reliably: keep its barrier through copying
// and descriptor close, subject to the same cooperative deadline.
export async function snapshotStore(dataDir, id, { maxHoldMs = 1000, maxFiles = 4096 } = {}) {
  const target = snapshotPath(dataDir, id);
  const state = barrier(dataDir);
  if (state.snapshotBusy) throw Object.assign(new Error('A snapshot is already being captured.'), { status: 503 });
  state.snapshotBusy = true;
  let release;
  state.gate = new Promise(resolve => { release = resolve; });
  const started = performance.now(), handles = [], directories = [];
  let heldMs, holding = true, created = false;
  const unlock = () => { if (holding) { holding = false; state.gate = null; release(); } };
  const budget = () => {
    if (performance.now() - started > maxHoldMs || handles.length >= maxFiles) throw new Error('Snapshot capture budget exceeded.');
  };
  try {
    // A deadline abandons capture, never an in-flight write. Those writes keep
    // their own ownership; no snapshot is produced until all have finished.
    let timer;
    try {
      await Promise.race([(async () => { while (state.active.size) await Promise.all([...state.active]); })(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Snapshot writer drain timed out.')), maxHoldMs);
      })]);
    } finally { clearTimeout(timer); }
    async function pin(file, relative) {
      budget();
      const info = await lstat(file);
      if (!info.isFile() || info.nlink !== 1) throw new Error('Snapshot requires regular unlinked files.');
      const handle = await open(file, 'r'); handles.push({ handle, relative });
    }
    async function walk(relative = '') {
      for (const name of (await readdir(path.join(dataDir, relative))).sort()) {
        budget();
        if (!relative && ['store.lock', 'store.lock.recovery'].includes(name)) continue;
        const rel = relative ? relative + '/' + name : name;
        const file = path.join(dataDir, rel), info = await lstat(file);
        if (info.isDirectory()) { directories.push('store/' + rel); await walk(rel); }
        else await pin(file, 'store/' + rel);
      }
    }
    try { await walk(); await pin(dataDir + '.dataset.json', 'store.dataset.json'); budget(); }
    finally { if (process.platform !== 'win32') { heldMs = performance.now() - started; unlock(); } }
    await mkdir(snapshotRoot(dataDir), { recursive: true, mode: 0o700 });
    if (!(await lstat(snapshotRoot(dataDir))).isDirectory()) throw new Error('Invalid snapshot spool.');
    const disk = await statfs(snapshotRoot(dataDir), { bigint: true });
    let bytes = 0n;
    for (const { handle } of handles) bytes += BigInt((await handle.stat()).size);
    if (disk.bavail * disk.bsize < bytes + 64n * 1024n * 1024n) throw new Error('Insufficient snapshot free space.');
    await mkdir(target, { mode: 0o700 }); created = true;
    await mkdir(path.join(target, 'store'), { mode: 0o700 });
    for (const name of directories) await mkdir(path.join(target, name), { mode: 0o700 });
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (const row of handles) {
      const { handle, relative } = row;
      if (process.platform === 'win32') budget();
      const output = await open(path.join(target, relative), 'wx', 0o600);
      try {
        for (;;) {
          if (process.platform === 'win32') budget();
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          let offset = 0;
          while (offset < bytesRead) offset += (await output.write(buffer, offset, bytesRead - offset)).bytesWritten;
        }
        await output.sync();
      } finally { await output.close(); await handle.close(); row.closed = true; }
    }
    if (holding) { heldMs = performance.now() - started; unlock(); }
    await writeFile(path.join(target, 'complete.json'), JSON.stringify({ id, heldMs }) + '\n', { flag: 'wx', mode: 0o600 });
    return { id, heldMs };
  } catch (error) {
    if (created) await rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    try { for (const row of handles) if (!row.closed) await row.handle.close(); }
    finally { unlock(); state.snapshotBusy = false; }
  }
}

// Additive service checkpoint. Reserve all gates synchronously before draining
// any writer; single-directory snapshotStore and its callers are unchanged.
export async function withDirectoryBarriers(dataDirs, work, { maxDrainMs = 30000 } = {}) {
  if (!Number.isSafeInteger(maxDrainMs) || maxDrainMs < 1) throw new TypeError('Invalid checkpoint deadline.');
  const states = [...new Set(dataDirs.map(dir => path.resolve(dir)))].sort().map(barrier);
  if (states.some(state => state.snapshotBusy || state.gate)) throw Object.assign(new Error('A snapshot is already being captured.'), { status: 503 });
  const releases = states.map(state => {
    state.snapshotBusy = true;
    let release; state.gate = new Promise(resolve => { release = resolve; });
    return () => { state.gate = null; state.snapshotBusy = false; release(); };
  });
  let timer;
  try {
    await Promise.race([
      (async () => { for (const state of states) while (state.active.size) await Promise.all([...state.active]); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Service checkpoint writer drain timed out.')), maxDrainMs); }),
    ]);
    clearTimeout(timer);
    return await work();
  } finally { clearTimeout(timer); for (const release of releases.reverse()) release(); }
}
