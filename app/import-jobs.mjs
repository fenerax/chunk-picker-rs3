import { Worker } from 'node:worker_threads';
import { IMPORT_WORKER_RESOURCE_LIMITS } from './tasks/worker-limits.mjs';
import { encodeImportBytes, decodeImportBytes } from './import-bytes.mjs';
import { displayText } from './import-output.mjs';

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
export function runImportJob(job, { timeoutMs = IMPORT_TIMEOUT_MS, budget, queueWaitMs = IMPORT_QUEUE_WAIT_MS, request, maxUploadBytes, prepareHook, userId = Symbol(), clock = { now: () => performance.now(), setTimeout, clearTimeout }, createWorker = (...args) => new Worker(...args), workerURL = new URL(job.kind === 'parse' ? './import-parser-worker.mjs' : './import-worker.mjs', import.meta.url) } = {}) {
  if (users.has(userId) || users.size >= IMPORT_QUEUE_LIMIT) return Promise.reject(busy());
  users.add(userId);
  let expired = false, waitTimer;
  const waiting = new Promise((resolve, reject) => {
    waitTimer = clock.setTimeout(() => { expired = true; reject(busy()); }, queueWaitMs);
  });
  const result = queue.then(async () => {
    clock.clearTimeout(waitTimer);
    if (expired) return;
    const activeStart = clock.now();
    const available = Math.min(timeoutMs, budget?.remainingMs ?? timeoutMs);
    const timeout = () => Object.assign(new Error(`This backup took too long to check (${Math.ceil(timeoutMs / 1000)} seconds of active work). No records were imported. Try another backup.`), { status: 422 });
    if (available <= 0) throw timeout();
    const bytes = await encodeImportBytes({ ...job, prepareHook: Boolean(prepareHook) });
    if (clock.now() - activeStart >= available) throw timeout();
    // Packed providers require the parent's verified selection in each isolate.
    // Keep parser startup independent of catalogue initialization.
    const datasetSelection = job.kind === 'parse' ? undefined
      : (await import('./dataset-runtime.mjs')).selectedDataset.workerSelection();
    const worker = createWorker(workerURL, { workerData: { ...bytes, datasetSelection, enforceMemoryLimit: true }, transferList: bytes.buffers, resourceLimits: IMPORT_WORKER_RESOURCE_LIMITS });
    const controller = new AbortController();
    let timer, decoding = false, cleanup = () => {};
    try {
      return await new Promise((resolve, reject) => {
        timer = clock.setTimeout(() => reject(timeout()), Math.max(1, available - (clock.now() - activeStart)));
        worker.on('message', async message => {
          decoding = true;
          try {
            const decoded = await decodeImportBytes(message, { freezeStates: job.kind !== 'backup' && !message.hook,
              indexDictionaries: message.hook, signal: controller.signal });
            if (decoded.hook) {
              // The hook owns a mutable full-state input, exactly as on the
              // normal preparation path. Chunked transport yields around the
              // caller's work; validation stays with the authoritative worker.
              if (decoded.migrationInput) decoded.context.migration.state = decoded.input;
              const ready = await prepareHook(decoded.input, decoded.context) ?? decoded.input;
              const reply = await encodeImportBytes({ hookResult: ready });
              worker.postMessage(reply, reply.buffers);
            } else if (decoded.error) reject(Object.assign(new Error(decoded.error.message), { status: decoded.error.status ?? 400 }));
            else resolve(decoded.result);
          } catch (error) {
            reject(Object.assign(new Error(displayText(error.message)), { name: displayText(error.name), status: error.status ?? 400,
              ...(error.code ? { code: displayText(error.code) } : {}), ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }));
          }
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
    } finally { controller.abort(); cleanup(); clock.clearTimeout(timer); await worker.terminate(); if (budget) budget.remainingMs -= clock.now() - activeStart; }
  });
  const tracked = Promise.race([result, waiting]).finally(() => users.delete(userId));
  queue = result.catch(() => {});
  return tracked;
}

export const registryMetadata = registry => registry?.definitions.map(({ candidates, exclude, ...definition }) => definition);
