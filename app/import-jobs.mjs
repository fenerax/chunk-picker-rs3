import { Worker } from 'node:worker_threads';

export const IMPORT_TIMEOUT_MS = 15_000;
// Shared by every picker and every import stage. A failed job cannot poison the
// queue; terminate before admitting the next job so large heaps never accumulate.
let queue = Promise.resolve();
export function runImportJob(job, { timeoutMs = IMPORT_TIMEOUT_MS, deadline, request, maxUploadBytes, prepareHook, workerURL = new URL('./import-worker.mjs', import.meta.url) } = {}) {
  const result = queue.then(async () => {
    const timeout = () => Object.assign(new Error('This backup took too long to check (15 seconds). No records were imported. Try another backup.'), { status: 422 });
    if (deadline && deadline <= Date.now()) throw timeout();
    const worker = new Worker(workerURL, { workerData: { ...job, prepareHook: Boolean(prepareHook) }, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
    let timer, cleanup = () => {};
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(timeout()), deadline ? Math.min(timeoutMs, Math.max(1, deadline - Date.now())) : timeoutMs);
        worker.on('message', async message => {
          if (message.hook) {
            try { worker.postMessage({ hookResult: await prepareHook(message.state, message.context) ?? message.state }); }
            catch (error) { reject(error); }
          } else if (message.error) reject(Object.assign(new Error(message.error.message), { status: message.error.status ?? 400 }));
          else resolve(message.result);
        });
        worker.once('error', error => reject(Object.assign(new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? 'This backup could not be checked within the available memory. No records were imported.'
          : 'The backup checker failed. No records were imported. Try another backup.'), { status: 422 })));
        worker.once('exit', code => reject(Object.assign(new Error(`The backup checker stopped (${code}). No records were imported.`), { status: 422 })));
        if (request) {
          let bytes = 0;
          const data = chunk => {
            bytes += chunk.length;
            if (bytes > maxUploadBytes) reject(Object.assign(new Error('This backup is too large. The limit is 256 MiB after decompression.'), { status: 413 }));
            else worker.postMessage({ chunk });
          };
          const end = () => worker.postMessage({ end: true });
          const error = () => reject(Object.assign(new Error('The backup upload was interrupted. Choose it again.'), { status: 400 }));
          cleanup = () => { request.pause(); request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', error); };
          request.on('error', error); request.on('aborted', error); request.on('end', end); request.on('data', data);
        }
      });
    } finally { cleanup(); clearTimeout(timer); await worker.terminate(); }
  });
  queue = result.catch(() => {});
  return result;
}

export const registryMetadata = registry => registry?.definitions.map(({ candidates, exclude, ...definition }) => definition);
