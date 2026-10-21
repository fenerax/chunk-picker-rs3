// Private measurement child: no application logs or arbitrary errors leave IPC.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { Session } from 'node:inspector';

if (!process.send || !process.env.RS3_IDLEMEM_SCRATCH) throw new Error('Launch through idlemem.mjs.');
const started = performance.now();
const mainMemory = () => ({ memoryUsage: process.memoryUsage(), heapStatistics: getHeapStatistics() });
const startMemory = mainMemory();
const send = value => { if (process.connected) process.send(value); };
const threads = new Map();
const children = new Map();
const childProcesses = createRequire(import.meta.url)('node:child_process');
const originalFork = childProcesses.fork;
const workerThreads = createRequire(import.meta.url)('node:worker_threads');
const OriginalWorker = workerThreads.Worker;
const probeURL = new URL('./idlemem-probe.mjs', import.meta.url).href;
childProcesses.fork = function(filename, args, options = {}) {
  const taskHost = String(filename).endsWith('process-worker-host.mjs');
  const child = originalFork(filename, args, taskHost ? { ...options,
    env: { ...(options.env ?? process.env), RS3_WORKER_MEMORY_PROBE_IMPORT: probeURL } } : options);
  if (taskHost) { children.set(child.pid, child); child.once('exit', () => children.delete(child.pid)); }
  return child;
};
workerThreads.Worker = class MeasuredWorker extends OriginalWorker {
  constructor(filename, options = {}) {
    const execArgv = (options.execArgv ?? process.execArgv).filter(arg => !/^--(?:expose[-_]gc|cpu[-_]prof|heap[-_]prof)(?:=|$)/.test(arg));
    super(filename, { ...options, execArgv: [...execArgv, '--import', probeURL] });
    const id = this.threadId;
    threads.set(id, { worker: this, status: 0 });
    this.once('online', () => { const entry = threads.get(id); if (entry) entry.status = 1; });
    this.once('exit', () => threads.delete(id));
  }
};
// Application ESM imports must see the wrapped built-in Worker export.
syncBuiltinESMExports();

let application, closing = false;
let childProbeSequence = 0;
function childMemory(pid, child, kind = 'memory') {
  return new Promise(resolve => {
    const id = `idlemem-${pid}-${++childProbeSequence}`;
    const finish = value => { clearTimeout(timer); child.off('message', listener); child.off('exit', exited); resolve(value); };
    const listener = message => { if (message?.kind === kind && message.id === id) {
      const { kind: ignoredKind, id: ignoredId, ...memory } = message; finish(memory);
    } };
    const exited = () => finish({ pid, unavailable: true });
    const timer = setTimeout(() => finish({ pid, unavailable: true }), 20000);
    child.on('message', listener); child.once('exit', exited);
    try { child.send({ kind, id }, error => { if (error) finish({ pid, unavailable: true }); }); }
    catch { finish({ pid, unavailable: true }); }
  });
}
async function workerMemory(id, entry) {
  const { port1, port2 } = new workerThreads.MessageChannel();
  return new Promise(resolve => {
    let timer;
    const finish = value => { clearTimeout(timer); port1.close(); resolve(value); };
    timer = setTimeout(() => finish({ threadId: id, status: entry.status, unavailable: true }), 15000);
    port1.once('message', value => finish({ ...value, status: entry.status, unavailable: false }));
    try { entry.worker.postMessage({ type: 'cancel', id: -1, memoryPort: port2 }, [port2]); }
    catch { port2.close(); finish({ threadId: id, status: entry.status, unavailable: true }); }
  });
}
async function sample() {
  const main = mainMemory();
  const workers = await Promise.all([...threads].map(([id, entry]) => workerMemory(id, entry)));
  const processes = await Promise.all([...children].map(([pid, child]) => childMemory(pid, child)));
  return { elapsedMs: performance.now() - started, main, workers, processes,
    activeWorkerCount: threads.size + children.size, totalRssBytes: main.memoryUsage.rss + processes.reduce((sum, entry) => sum + (entry.main?.rss ?? entry.main?.memoryUsage?.rss ?? 0), 0) };
}
async function stop() {
  if (closing) return;
  closing = true;
  try { await application?.close(); } finally { process.exit(0); }
}
async function collectGarbage() {
  const session = new Session();
  try {
    session.connect();
    await new Promise((resolve, reject) => session.post('HeapProfiler.collectGarbage', error => error ? reject(error) : resolve()));
  } finally { session.disconnect(); }
}
process.on('message', message => {
  if (message?.type === 'rss') {
    if (!children.size) send({ type: 'rss', id: message.id, rssBytes: process.memoryUsage.rss() });
    else void Promise.all([...children].map(([pid, child]) => childMemory(pid, child, 'memory-rss')))
      .then(samples => send({ type: 'rss', id: message.id,
        rssBytes: process.memoryUsage.rss() + samples.reduce((sum, entry) => sum + (entry.rssBytes ?? 0), 0) }));
  }
  if (message?.type === 'sample') void sample().then(value => send({ type: 'sample', id: message.id, ...value }), () => send({ type: 'probe-error', id: message.id }));
  if (message?.type === 'gc') void collectGarbage().then(async () => send({ type: 'gc', id: message.id, ...await sample() }), () => send({ type: 'probe-error', id: message.id }));
  if (message?.type === 'stop') void stop();
});
process.once('disconnect', () => void stop());
send({ type: 'start', elapsedMs: performance.now() - started, main: startMemory, workers: [], activeWorkerCount: 0 });
try {
  const module = await import(process.env.RS3_IDLEMEM_ENTRY
    ? pathToFileURL(process.env.RS3_IDLEMEM_ENTRY).href : '../../app/server.mjs');
  send({ type: 'imports', elapsedMs: performance.now() - started, main: mainMemory(), workers: [], activeWorkerCount: 0 });
  const options = { dataDir: process.env.RS3_IDLEMEM_SCRATCH, host: '127.0.0.1',
    port: Number(process.env.RS3_IDLEMEM_PORT), loopbackPort: undefined, publicOrigin: undefined,
    taskWorkerOptions: { idleMs: 60000, startupDeadlineMs: 300000 } };
  if (module.startServer) application = await module.startServer(options);
  else { application = await module.createServer(options); await application.listen(); }
  if (application.address()?.port !== options.port) throw new Error('Unexpected listener.');
  send({ type: 'listening', elapsedMs: performance.now() - started, rssBytes: process.memoryUsage.rss() });
  if (application.ready) await application.ready;
  send({ type: 'ready', elapsedMs: performance.now() - started });
} catch {
  send({ type: 'error' });
  try { await application?.close(); } catch {}
  process.exit(1);
}
