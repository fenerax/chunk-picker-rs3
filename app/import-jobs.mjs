import { Worker } from 'node:worker_threads';
import { encodeImportBytes, decodeImportBytes } from './import-bytes.mjs';

export const IMPORT_TIMEOUT_MS = 120_000;
export const IMPORT_QUEUE_WAIT_MS = 120_000;
// Shared by every picker and every import stage. A failed job cannot poison the
// queue; terminate before admitting the next job so large heaps never accumulate.
let queue = Promise.resolve();
export const IMPORT_QUEUE_LIMIT = 4;
const users = new Set(), requests = new Set();
const busy = () => Object.assign(new Error('Backup import is busy. Try again in a moment.'), { status: 503, retryAfter: 5 });
export function reserveImportUser(userId) {
  if (requests.has(userId) || requests.size >= IMPORT_QUEUE_LIMIT) throw busy();
  requests.add(userId);
  let active = true;
  return () => { if (active) { active = false; requests.delete(userId); } };
}
export function runImportJob(job, { timeoutMs = IMPORT_TIMEOUT_MS, budget, queueWaitMs = IMPORT_QUEUE_WAIT_MS, request, maxUploadBytes, prepareHook, userId = Symbol(), workerURL = new URL(job.kind === 'parse' ? './import-parser-worker.mjs' : './import-worker.mjs', import.meta.url) } = {}) {
  if (users.has(userId) || users.size >= IMPORT_QUEUE_LIMIT) return Promise.reject(busy());
  users.add(userId);
  let expired = false, waitTimer;
  const waiting = new Promise((resolve, reject) => {
    waitTimer = setTimeout(() => { expired = true; reject(busy()); }, queueWaitMs);
  });
  const result = queue.then(async () => {
    clearTimeout(waitTimer);
    if (expired) return;
    const activeStart = performance.now();
    const available = Math.min(timeoutMs, budget?.remainingMs ?? timeoutMs);
    const timeout = () => Object.assign(new Error(`This backup took too long to check (${Math.ceil(timeoutMs / 1000)} seconds of active work). No records were imported. Try another backup.`), { status: 422 });
    if (available <= 0) throw timeout();
    const bytes = await encodeImportBytes({ ...job, prepareHook: Boolean(prepareHook) });
    if (performance.now() - activeStart >= available) throw timeout();
    const worker = new Worker(workerURL, { workerData: bytes, transferList: bytes.buffers, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
    const controller = new AbortController();
    let timer, decoding = false, cleanup = () => {};
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(timeout()), Math.max(1, available - (performance.now() - activeStart)));
        worker.on('message', async message => {
          decoding = true;
          try {
            const decoded = await decodeImportBytes(message, { freezeStates: job.kind !== 'backup', signal: controller.signal });
            if (decoded.hook) {
              await prepareHook(decoded.summary, decoded.context);
              const reply = await encodeImportBytes({ hookResult: true });
              worker.postMessage(reply, reply.buffers);
            } else if (decoded.error) reject(Object.assign(new Error(decoded.error.message), { status: decoded.error.status ?? 400 }));
            else resolve(decoded.result);
          } catch (error) { reject(error); }
        });
        worker.once('error', error => reject(Object.assign(new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? 'This backup could not be checked within the available memory. No records were imported.'
          : 'The backup checker failed. No records were imported. Try another backup.'), { status: 422 })));
        worker.once('exit', code => { if (code !== 0 || !decoding) reject(Object.assign(new Error(`The backup checker stopped (${code}). No records were imported.`), { status: 422 })); });
        if (request) {
          let bytes = 0, sending = Promise.resolve();
          const data = chunk => {
            request.pause();
            if (typeof chunk === 'string') chunk = Buffer.from(chunk);
            bytes += chunk.length;
            if (bytes > maxUploadBytes) reject(Object.assign(new Error('This backup is too large. Choose a smaller backup.'), { status: 413 }));
            else {
              sending = sending.then(async () => {
                let turn = performance.now();
                // Backpressure bounds even a source supplying one giant chunk.
                for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
                  controller.signal.throwIfAborted();
                  const part = Uint8Array.from(chunk.subarray(offset, offset + 64 * 1024));
                  worker.postMessage({ chunk: part.buffer }, [part.buffer]);
                  if (performance.now() - turn >= 4) { await new Promise(resolve => setImmediate(resolve)); turn = performance.now(); }
                }
                request.resume();
              }).catch(reject);
            }
          };
          const end = () => { void sending.then(() => { if (!controller.signal.aborted) worker.postMessage({ end: true }); }).catch(reject); };
          const error = () => reject(Object.assign(new Error('The backup upload was interrupted. Choose it again.'), { status: 400 }));
          cleanup = () => { request.pause(); request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', error); };
          request.on('error', error); request.on('aborted', error); request.on('end', end); request.on('data', data);
        }
      });
    } finally { controller.abort(); cleanup(); clearTimeout(timer); await worker.terminate(); if (budget) budget.remainingMs -= performance.now() - activeStart; }
  });
  const tracked = Promise.race([result, waiting]).finally(() => users.delete(userId));
  queue = result.catch(() => {});
  return tracked;
}

export const registryMetadata = registry => registry?.definitions.map(({ candidates, exclude, ...definition }) => definition);
