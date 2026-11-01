import { Worker } from 'node:worker_threads';
import { ProcessWorker } from '../../app/tasks/process-worker.mjs';
import path from 'node:path';

/** Opt-in Worker-compatible calculator. The normal scheduler is unchanged.
 * The existing explicit preload slot also works in the owned-process host. */
export function createBundleWorker(directory, { mode = 'process', datasetDigest, manifestSha256 } = {}) {
  const workerData = { calculatorBundle: path.resolve(directory), datasetDigest, bundleManifestSha256: manifestSha256 };
  const preload = new URL('./preload.mjs', import.meta.url).href;
  if (mode === 'process') return new ProcessWorker(workerData, { probeImport: preload });
  if (mode === 'thread') return new Worker(new URL('../../app/tasks/worker.mjs', import.meta.url), { workerData, execArgv: ['--import', preload] });
  throw new TypeError('Unknown calculator bundle worker mode.');
}
