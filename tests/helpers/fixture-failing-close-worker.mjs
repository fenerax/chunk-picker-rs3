import { parentPort, workerData } from 'node:worker_threads';
import { acquireProcessGuard } from '../../app/storage/process-guard.mjs';
import { serveFixtureWorker } from '../../scripts/perf/capacity/fixture-worker-runtime.mjs';

serveFixtureWorker(parentPort, async (job, progress) => {
  const release = await acquireProcessGuard(job.dataDir);
  // Model the production fail-closed contract: a rejecting close keeps its
  // real native guard. Only exit of this scratch isolate may release it.
  const context = { close: async () => {
    parentPort.postMessage({ type: 'closing' });
    if (workerData.failClose) throw new Error('Synthetic context close failure');
    await release();
  } };
  try {
    await progress({ phase: 'synthetic-open' });
    return { index: job.item.index };
  } finally { await context.close(); }
});
