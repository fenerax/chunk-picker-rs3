// Synthetic shutdown probe: an advisory calculator never answers its warm job
// and acknowledges termination only when forced. No application save is opened.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('Node 24.20 or newer is required.');
const root = path.resolve(process.argv[2] ?? '.');
const { createTaskScheduler } = await import(pathToFileURL(path.join(root, 'app/tasks/scheduler.mjs')));
const samples = [];
for (let run = 0; run < 3; run++) {
  const workers = [], releases = [];
  const scheduler = await createTaskScheduler({ residency: { memoryBytes: 300, estimatedBytes: 100,
    maxResident: 3, activeMs: 10000, idleMs: 10000 }, workerFactory() {
    const worker = new EventEmitter();
    workers.push(worker);
    worker.postMessage = () => {};
    let release;
    const exited = new Promise(resolve => { release = () => { resolve(); worker.emit('exit', 0); }; });
    releases.push(release);
    worker.terminate = ({ force = false } = {}) => { if (force) release(); return exited; };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  } });
  scheduler.noteActivity?.();
  scheduler.prewarm({ revision: 0, rules: {}, members: [{ id: 'synthetic' }] }, 'synthetic',
    [{ memberId: 'synthetic', chunkIds: ['100'] }]);
  await new Promise(resolve => setImmediate(resolve));
  const started = performance.now();
  let durationMs, timer;
  const closing = scheduler.close(20).then(() => { durationMs = performance.now() - started; });
  try { await Promise.race([closing, new Promise(resolve => { timer = setTimeout(resolve, 200); })]); }
  finally { clearTimeout(timer); }
  samples.push({ durationMs: durationMs ?? null, timedOut: durationMs === undefined, calculators: workers.length });
  for (const release of releases) release();
  await closing;
}
console.log(JSON.stringify({ node: process.version, deadlineMs: 20, observationMs: 200, samples }));
