import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { integer } from './model.mjs';
import { fixtureCatalogues } from './fixture-catalogues.mjs';
import { FixtureThread, observe } from './fixture-thread.mjs';

export function fixtureWorkers(requested, { platform = process.platform, cores = availableParallelism(), groups = 2000 } = {}) {
  const count = requested === undefined ? (platform === 'win32' ? 1 : Math.max(1, cores - 2)) : Number(requested);
  integer(count, 1, 256, 'fixture workers');
  if (platform === 'win32' && count !== 1) throw new Error('Windows fixture generation requires one worker.');
  return Math.min(count, groups);
}

// Only the parent receives progress. A worker waits for its acknowledgement,
// bounding queued messages/writes and ensuring the phase is durable before work.
export async function buildGroups(jobs, { workers, workerData, onProgress = async () => {}, onComplete = async () => {},
  workerFactory = data => new Worker(new URL('./fixture-worker.mjs', import.meta.url), { workerData: data, execArgv: [] }) }) {
  const threads = [], tasks = [], results = Array(jobs.length), controller = new AbortController();
  const { signal } = controller;
  const count = Math.min(workers, jobs.length);
  let cursor = 0, catalogues, failure;
  try {
    catalogues = await fixtureCatalogues(workerData.ownedServing, jobs, count);
    for (let slot = 0; slot < count; slot++) threads.push(new FixtureThread(
      workerFactory({ ...workerData, ownedServing: catalogues.releases[slot] }), {
        onProgress: value => observe(() => onProgress(value, slot, signal), signal),
        onFailure: error => controller.abort(error),
      }));
    tasks.push(...threads.map(async (thread, slot) => {
      await thread.ready;
      for (;;) {
        signal.throwIfAborted();
        const index = cursor++;
        if (index >= jobs.length) break;
        await observe(() => onProgress({ phase: 'start', groupIndex: jobs[index].item.index,
          rosterSize: jobs[index].item.size, grown: jobs[index].item.grown }, slot, signal), signal);
        signal.throwIfAborted();
        const result = await thread.build(jobs[index]);
        results[index] = result;
        await observe(() => onComplete(result, slot, signal), signal);
      }
    }));
    await observe(() => Promise.all(tasks), signal);
    return results;
  } catch (error) {
    failure = error; throw error;
  } finally {
    controller.abort(failure ?? new Error('Fixture pool closed.'));
    // Never terminate an isolate during async module evaluation or store I/O.
    // STOP unblocks ACK waits and drains real stores before natural worker exit.
    const stopped = await Promise.allSettled(threads.map(thread => thread.stop()));
    await Promise.allSettled(tasks);
    await catalogues?.close();
    if (!failure) {
      const rejected = stopped.find(result => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    }
  }
}
