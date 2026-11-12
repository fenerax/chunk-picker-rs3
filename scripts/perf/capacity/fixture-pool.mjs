import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { integer } from './model.mjs';
import { fixtureCatalogues } from './fixture-catalogues.mjs';

export function fixtureWorkers(requested, { platform = process.platform, cores = availableParallelism(), groups = 2000 } = {}) {
  const count = requested === undefined ? (platform === 'win32' ? 1 : Math.max(1, cores - 2)) : Number(requested);
  integer(count, 1, 256, 'fixture workers');
  if (platform === 'win32' && count !== 1) throw new Error('Windows fixture generation requires one worker.');
  return Math.min(count, groups);
}

// Only the parent receives progress. A worker waits for its acknowledgement,
// bounding queued messages/writes and ensuring the phase is durable before work.
export async function buildGroups(jobs, { workers, workerData, onProgress = async () => {}, onComplete = async () => {} }) {
  const threads = [], results = Array(jobs.length);
  const count = Math.min(workers, jobs.length);
  let cursor = 0, catalogues;
  try {
    catalogues = await fixtureCatalogues(workerData.ownedServing, jobs, count);
    await Promise.all(Array.from({ length: count }, async (_, slot) => {
      const worker = new Worker(new URL('./fixture-worker.mjs', import.meta.url), {
        workerData: { ...workerData, ownedServing: catalogues.releases[slot] }, execArgv: [] });
      threads.push(worker);
      let pending, failed;
      worker.on('error', error => { failed = error; pending?.reject(error); });
      worker.on('exit', code => { failed ??= new Error(`Fixture worker exited (${code}).`); pending?.reject(failed); });
      worker.on('message', message => {
        if (message.type === 'progress') {
          Promise.resolve().then(() => onProgress(message.value, slot)).then(() => worker.postMessage({ type: 'ack', id: message.id }), error => pending?.reject(error));
        } else if (message.type === 'result') pending?.resolve(message.value);
        else if (message.type === 'failure') pending?.reject(new Error(message.message));
      });
      for (;;) {
        const index = cursor++;
        if (index >= jobs.length) break;
        if (failed) throw failed;
        await onProgress({ phase: 'start', groupIndex: jobs[index].item.index,
          rosterSize: jobs[index].item.size, grown: jobs[index].item.grown }, slot);
        if (failed) throw failed;
        const result = await new Promise((resolve, reject) => {
          pending = { resolve, reject };
          worker.postMessage({ type: 'build', job: jobs[index] });
        });
        pending = undefined;
        results[index] = result;
        await onComplete(result, slot);
      }
    }));
    return results;
  } finally {
    // A failed group never receives a completion seal. Stop only our workers,
    // and await their exits before the parent releases shared registry locks.
    await Promise.allSettled(threads.map(worker => worker.terminate()));
    await catalogues?.close();
  }
}
