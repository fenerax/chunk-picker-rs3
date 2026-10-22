// Private child process used only by page-load.mjs. Credentials travel over IPC.
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';
import { safeDiagnostic, serverMemorySample, recordServerMemory, SERVER_MEMORY_SAMPLE_INTERVAL_MS } from './diagnostics.mjs';
import { installCalculatorHeapPolicy } from './calculator-policy.mjs';

if (!process.send || !process.env.RS3_PERF_SCRATCH) throw new Error('Launch through npm run perf.');
const start = performance.now();
let application;
const workers = new Set();
let memoryTelemetry;
const sampleMemory = () => {
  memoryTelemetry = recordServerMemory(memoryTelemetry,
    serverMemorySample(process.memoryUsage(), getHeapStatistics().heap_size_limit, Date.now()));
  return memoryTelemetry;
};
const publishMemory = () => {
  if (process.connected === false) return;
  process.send({ type: 'memory', memoryTelemetry: sampleMemory() }, () => {});
};
publishMemory();
const memoryTimer = setInterval(publishMemory, SERVER_MEMORY_SAMPLE_INTERVAL_MS);
memoryTimer.unref();
try {
  const port = Number(process.env.RS3_PERF_PORT ?? 0);
  if (port !== 0 && (!Number.isInteger(port) || port < 8960 || port > 8969)) throw new Error('Invalid owned benchmark port.');
  const serverEntry = process.env.RS3_PERF_SERVER_ENTRY
    ? pathToFileURL(process.env.RS3_PERF_SERVER_ENTRY).href : new URL('../../app/server.mjs', import.meta.url).href;
  const appRoot = process.env.RS3_PERF_APP_ROOT ?? path.dirname(path.dirname(fileURLToPath(serverEntry)));
  installCalculatorHeapPolicy(appRoot, process.env.RS3_PERF_CALCULATOR_HEAP_MIB);
  // Only this harness preload may be injected into the measured process lane.
  process.env.RS3_WORKER_MEMORY_PROBE_IMPORT = new URL('./worker-timeline.mjs', import.meta.url).href;
  // Linux normally uses native threads, which inherit the server's --import.
  // Windows normally uses ProcessWorker, whose host selects the same preload.
  const threadEmit = Worker.prototype.emit;
  Worker.prototype.emit = function (event, message, ...args) {
    if (event === 'message' && message?.perfTimeline) process.send({ type: 'calculation', perfTimeline: message.perfTimeline });
    return threadEmit.call(this, event, message, ...args);
  };
  try {
    const { ProcessWorker } = await import(pathToFileURL(path.join(appRoot, 'app/tasks/process-worker.mjs')).href);
    const on = ProcessWorker.prototype.on;
    ProcessWorker.prototype.on = function (...args) {
      workers.add(this);
      return on.apply(this, args);
    };
    const emit = ProcessWorker.prototype.emit;
    ProcessWorker.prototype.emit = function (event, message, ...args) {
      if (event === 'exit') workers.delete(this);
      if (event === 'message' && message?.perfTimeline) process.send({ type: 'calculation', perfTimeline: message.perfTimeline });
      return emit.call(this, event, message, ...args);
    };
  } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  const { createServer } = await import(serverEntry);
  application = await createServer({ dataDir: process.env.RS3_PERF_SCRATCH,
    host: '127.0.0.1', port, loopbackPort: undefined, publicOrigin: undefined,
    packsDir: process.env.RS3_PACKS_DIR, packSelection: process.env.RS3_PACK_SELECTION,
    predictionPrewarm: process.env.RS3_PERF_PREWARM !== 'off' });
  await application.listen();
  if ([8788, 8789, 8790, 8791].includes(application.address().port)) throw new Error('Protected port selected.');
  const startup = application.getStartupTimingMs?.() ?? application.startupTimingMs;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const { selectedDataset } = await import(pathToFileURL(path.join(appRoot, 'app/dataset-runtime.mjs')).href).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
  });
  process.send({ type: 'ready', inviteUrl: application.inviteUrl,
    dataset: selectedDataset ? { datasetId: selectedDataset.datasetId, digest: selectedDataset.digest, packed: selectedDataset.packed === true } : null,
    readyMs: performance.now() - start, rssBytes: process.memoryUsage().rss, memoryTelemetry: sampleMemory(),
    startupTimingMs: { variantMs: numeric(startup?.variantMs), stateResponseMs: numeric(startup?.stateResponseMs) } });
  process.on('message', async message => {
    if (message.type === 'rss') {
      // A calculator process owns its worker thread RSS; summing isolate RSS
      // again would double count it. Sampling happens after timed scenarios.
      const samples = await Promise.allSettled([...workers].map(async worker => worker.getMemoryUsage()));
      let workersRssBytes = 0, workerRssSamples = 0, workerRssFailures = 0;
      for (const sample of samples) {
        const rss = sample.status === 'fulfilled' ? sample.value?.main?.rss : undefined;
        if (typeof rss === 'number' && Number.isFinite(rss) && rss >= 0) { workersRssBytes += rss; workerRssSamples++; }
        else workerRssFailures++;
      }
      const rssBytes = process.memoryUsage().rss;
      process.send({ type: 'rss', id: message.id, rssBytes, workersRssBytes: workerRssFailures ? null : workersRssBytes,
        totalRssBytes: workerRssFailures ? null : rssBytes + workersRssBytes, workerRssSamples, workerRssFailures,
        memoryTelemetry: sampleMemory() });
    }
    if (message.type === 'stop') { clearInterval(memoryTimer); await application.close(); process.exit(0); }
  });
  process.once('disconnect', async () => { clearInterval(memoryTimer); await application.close(); process.exit(0); });
} catch (error) {
  clearInterval(memoryTimer);
  // Never forward errors containing state, request URLs or credentials.
  process.send({ type: 'error', message: 'Scratch server startup failed.', diagnostic: safeDiagnostic(error, { stage: 'server-start' }), memoryTelemetry: sampleMemory() });
  await application?.close();
  process.exit(1);
}
