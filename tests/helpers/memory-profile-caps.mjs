// Fresh-process inspection of real scheduler/calculator/cache configuration.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  const { createServer } = await import('../../app/server.mjs');
  const { createGroupState } = await import('../../app/core/state.mjs');
  const definitions = { chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
    challenges: { Extra: { Synthetic: { Chunks: ['12850'] } } }, equipment: {}, codeItems: {}, drops: {} };
  let data, calculator, app, directory;
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
    const diagnosticBudget = scheduler.getDiagnostics().memoryBudget;
    if (data.memoryBudget) assert.strictEqual(diagnosticBudget, data.memoryBudget, 'Diagnostics must expose the exact worker budget object');
    const inspectHTTP = async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'synthetic-memory-diagnostics-'));
      let httpWorkerData;
      app = await createServer({ dataDir: directory, port: 0, definitions, taskMap: {},
        initialState: createGroupState([{ id: 'synthetic-member', name: 'Synthetic Player' }]),
        predictionPrewarm: false, taskWorkerOptions: { residency: false, workerFactory(input) {
          httpWorkerData = input;
          const worker = new EventEmitter();
          worker.postMessage = message => queueMicrotask(() => worker.emit('message', { id: message.id, result: { tasks: [], metrics: { availableCount: 0 } } }));
          worker.terminate = async () => { worker.emit('exit', 0); };
          queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
          return worker;
        } } });
      await app.listen();
      const origin = `http://127.0.0.1:${app.address().port}`;
      const headers = { Authorization: `Bearer ${app.store.getAccessToken()}`, Origin: origin, 'Content-Type': 'application/json' };
      const diagnostics = await fetch(origin + '/api/diagnostics', { headers });
      assert.equal(diagnostics.status, 200);
      const httpBudget = (await diagnostics.json()).memoryBudget;
      const unauthenticated = await fetch(origin + '/api/diagnostics');
      assert.equal(unauthenticated.status, 401); assert(!JSON.stringify(await unauthenticated.json()).includes('memoryBudget'));
      const refused = [];
      for (const viewer of [false, true]) {
        const invitation = await fetch(origin + '/api/invites', { method: 'POST', headers,
          body: JSON.stringify({ label: 'Synthetic diagnostics reader', viewer }) });
        assert.equal(invitation.status, 201);
        const joined = await fetch((await invitation.json()).link, { redirect: 'manual' });
        assert.equal(joined.status, 303);
        const cookie = joined.headers.get('set-cookie').split(';')[0];
        const response = await fetch(origin + '/api/diagnostics', { headers: { cookie } });
        refused.push(response.status); assert(!JSON.stringify(await response.json()).includes('memoryBudget'));
        for (const route of ['/api/health', '/api/state']) {
          const response = await fetch(origin + route, { headers: { cookie } });
          assert.equal(response.status, 200); assert(!JSON.stringify(await response.json()).includes('memoryBudget'), route);
        }
      }
      return { budget: httpBudget, refused, hasStartupBudget: Object.hasOwn(httpWorkerData, 'memoryBudget'), startupBudget: httpWorkerData.memoryBudget ?? null };
    };
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
    const http = await inspectHTTP();
    process.stdout.write(JSON.stringify({ profile: serviceMemoryBudget({ calculators: 4 }), workerLedgers, diagnosticBudget,
      http,
      hasStartupBudget: Object.hasOwn(data, 'memoryBudget'), startupBudget: data.memoryBudget ?? null,
      scheduler: scheduler.retentionLedger(), foreground: scheduler.getDiagnostics().cache,
      response, residentGroups, responses: Object.fromEntries(Object.entries(caches).map(([owner, cache]) => [owner, cache.retentionLedger()])) }));
  } finally {
    for (const cache of Object.values(caches)) cache.clear();
    await calculator?.terminate(); await scheduler.close();
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
