import { Worker } from 'node:worker_threads';
import { mkdir, readdir, stat, writeFile, rename, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';

export const PROFILE_CAPS = Object.freeze({ count: 12, totalBytes: 128 * 1024 * 1024, fileBytes: 32 * 1024 * 1024 });
const validName = name => /^profile-\d+-\d+-(picker|calculator|relay)\.cpuprofile$/.test(name);
export async function createDeepProfiles(dataDir, { caps = PROFILE_CAPS, pruneOnOpen = true } = {}) {
  const directory = path.join(dataDir, 'cpu-profiles');
  const workers = new Set(), online = new WeakMap();
  let current, closing = false, sequence = 0, failures = 0, stopping;
  async function files() {
    let names; try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const entries = [];
    for (const name of names.filter(validName)) {
      try {
        const info = await stat(path.join(directory, name));
        if (info.isFile()) entries.push({ name, bytes: info.size, time: info.mtimeMs });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return entries.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  }
  async function prune(reserve = 0) {
    const entries = await files(); let bytes = 0, count = 0;
    for (const entry of entries) {
      bytes += entry.bytes; count++;
      if (entry.bytes > caps.fileBytes || count > caps.count - Number(reserve > 0) || bytes > caps.totalBytes - reserve) {
        bytes -= entry.bytes; count--; await unlink(path.join(directory, entry.name));
      }
    }
  }
  if (pruneOnOpen) {
    try { for (const name of await readdir(directory)) if (name.endsWith('.tmp') && validName(name.slice(0, -4))) await unlink(path.join(directory, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await prune();
  }
  // Serialize profile writes so overlapping worker stops cannot exceed the cap.
  let writes = Promise.resolve();
  function save(kind, profile) {
    writes = writes.then(async () => {
      const bytes = typeof profile === 'string' ? profile : JSON.stringify(profile);
      const length = Buffer.byteLength(bytes);
      if (length > caps.fileBytes || length > caps.totalBytes) { failures++; return; }
      await mkdir(directory, { recursive: true, mode: 0o700 }); await prune(length);
      const name = `profile-${Date.now()}-${++sequence}-${kind}.cpuprofile`;
      await writeFile(path.join(directory, `${name}.tmp`), bytes, { mode: 0o600 });
      await rename(path.join(directory, `${name}.tmp`), path.join(directory, name));
    }).catch(() => { failures++; });
    return writes;
  }
  async function startWorker(run, worker) {
    if (current !== run || run.handles.has(worker) || !worker.startCpuProfile) return;
    const pending = Promise.resolve(online.get(worker)).then(() => worker.startCpuProfile());
    run.handles.set(worker, pending);
    try { await pending; } catch { failures++; run.handles.delete(worker); }
  }
  return {
    attach(worker) {
      if (!worker?.on || closing || workers.has(worker)) return;
      workers.add(worker);
      if (worker instanceof Worker) {
        const ready = new Promise((resolve, reject) => {
          const cleanup = () => { worker.off('online', running); worker.off('exit', ended); worker.off('error', ended); };
          const running = () => { cleanup(); resolve(); };
          const ended = () => { cleanup(); reject(new Error('Calculator stopped before profiling.')); };
          worker.once('online', running); worker.once('exit', ended); worker.once('error', ended);
        });
        ready.catch(() => {}); online.set(worker, ready);
      }
      worker.once('exit', () => { workers.delete(worker); if (current?.handles.delete(worker)) failures++; });
      if (current) void startWorker(current, worker);
    },
    status() { return { active: !!current, deadline: current?.deadline ?? null, stopping: !!stopping, failures }; },
    async list() { return files(); },
    async download(name) {
      if (!validName(name)) throw Object.assign(new Error('Profile not found.'), { status: 404 });
      const entry = (await files()).find(item => item.name === name);
      if (!entry || entry.bytes > caps.fileBytes) throw Object.assign(new Error('Profile not found.'), { status: 404 });
      try { return await readFile(path.join(directory, name)); }
      catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Profile not found.'), { status: 404 }); throw error; }
    },
    async start(seconds = 180) {
      if (!Number.isFinite(seconds) || seconds < 0.01 || seconds > 600) throw Object.assign(new Error('Use a duration up to 600 seconds.'), { status: 400 });
      if (current || stopping || closing) throw Object.assign(new Error('A profile is already running or stopping.'), { status: 409 });
      const { Session } = await import('node:inspector');
      // Import is asynchronous; retain exclusive switch ownership across it.
      if (current || stopping || closing) throw Object.assign(new Error('A profile is already running or stopping.'), { status: 409 });
      const session = new Session(); session.connect();
      const post = (method) => new Promise((resolve, reject) => session.post(method, (error, result) => error ? reject(error) : resolve(result)));
      const run = current = { session, post, handles: new Map(), deadline: Date.now() + seconds * 1000 };
      run.timer = setTimeout(() => { void this.stop(); }, seconds * 1000); run.timer.unref();
      run.ready = (async () => { await post('Profiler.enable'); await post('Profiler.start'); })();
      try { await run.ready; await Promise.all([...workers].map(worker => startWorker(run, worker))); }
      catch { failures++; await this.stop(); throw Object.assign(new Error('CPU profiling is unavailable.'), { status: 503 }); }
      return this.status();
    },
    stop() {
      if (stopping) return stopping;
      const run = current; if (!run) return Promise.resolve();
      clearTimeout(run.timer); current = undefined;
      stopping = (async () => {
        try { await run.ready; const { profile } = await run.post('Profiler.stop'); await save('picker', profile); }
        catch { failures++; }
        finally { run.session.disconnect(); }
        await Promise.all([...run.handles.values()].map(async pending => {
          try {
            const handle = await pending, profile = await handle.stop();
            if (profile.calculator && profile.relay) { await save('calculator', profile.calculator); await save('relay', profile.relay); }
            else await save('calculator', profile);
          } catch { failures++; }
        }));
        await writes; await prune();
      })().catch(() => { failures++; }).finally(() => { stopping = undefined; });
      return stopping;
    },
    async close() { closing = true; await this.stop(); workers.clear(); await writes; },
  };
}
