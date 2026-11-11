// Fresh-process inspection of real scheduler/calculator/cache configuration.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { EventEmitter } from 'node:events';

if (!isMainThread) {
  globalThis[Symbol.for('rs3.acceptance.probe')] = {};
  await import('../../app/tasks/worker.mjs');
  parentPort.postMessage({ type: 'effective-caps', ledgers: globalThis[Symbol.for('rs3.acceptance.probe')].ownerLedgers() });
} else {
  const { createTaskScheduler } = await import('../../app/tasks/scheduler.mjs');
  const { genericWorkerData } = await import('./worker-dataset.mjs');
  const { createResponseCache, RESPONSE_CACHE_DEFAULTS } = await import('../../app/http-response.mjs');
  const { serviceResponseCacheBudget } = await import('../../app/response-cache-budget.mjs');
  const { serviceMemoryBudget } = await import('../../app/service-memory-budget.mjs');
  const definitions = { chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
    challenges: { Extra: { Synthetic: { Chunks: ['12850'] } } }, equipment: {}, codeItems: {}, drops: {} };
  let data, calculator;
  const scheduler = await createTaskScheduler({ workerData: genericWorkerData({ definitions,
    skillGuideCatalogue: { skills: [], tasks: [] } }), workerFactory(input) {
    data = input;
    const worker = new EventEmitter();
    worker.postMessage = () => {};
    worker.terminate = async () => { worker.emit('exit', 0); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
    return worker;
  } });
  const caches = Object.fromEntries(Object.entries(RESPONSE_CACHE_DEFAULTS).map(([owner, limits]) => [owner, createResponseCache(limits)]));
  try {
    calculator = new Worker(new URL(import.meta.url), { workerData: data });
    const workerLedgers = await new Promise((resolve, reject) => {
      calculator.on('error', reject);
      calculator.on('message', message => { if (message.type === 'effective-caps') resolve(message.ledgers); });
      calculator.on('exit', code => reject(new Error(`Calculator exited before census (${code}).`)));
    });
    // Synthetic charges exercise aggregate admission without allocating large
    // buffers. These remain below the unchanged local group cap.
    const groups = Array.from({ length: 4 }, () => createResponseCache(RESPONSE_CACHE_DEFAULTS.group));
    for (const cache of groups) cache.set('synthetic', { retainedBytes: 48 * 1024 ** 2 });
    const response = serviceResponseCacheBudget.retentionLedger();
    const residentGroups = groups.map(cache => cache.size);
    for (const cache of groups) cache.clear();
    process.stdout.write(JSON.stringify({ profile: serviceMemoryBudget({ calculators: 4 }), workerLedgers,
      hasStartupBudget: Object.hasOwn(data, 'memoryBudget'), startupBudget: data.memoryBudget ?? null,
      scheduler: scheduler.retentionLedger(), foreground: scheduler.getDiagnostics().cache,
      response, residentGroups, responses: Object.fromEntries(Object.entries(caches).map(([owner, cache]) => [owner, cache.retentionLedger()])) }));
  } finally {
    for (const cache of Object.values(caches)) cache.clear();
    await calculator?.terminate(); await scheduler.close();
  }
}
