import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

// No timers or polling: every step follows an actual worker message.
export async function proofWorker(workerData, { broker, WorkerClass = Worker } = {}) {
  const worker = WorkerClass === Worker ? new Worker(new URL('../../app/tasks/worker.mjs', import.meta.url), { workerData }) : new WorkerClass(workerData);
  const ready = await once(worker, 'message');
  let sequence = 0;
  const pending = new Map(), exports = [];
  worker.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  worker.on('message', message => {
    const request = pending.get(message.id);
    if (!request) return;
    if (message.type === 'progress') {
      if (message.eligibilitySeedRequest) {
        exports.push(message.eligibilitySeedRequest);
        Promise.resolve().then(() => broker?.(message.eligibilitySeedRequest, message))
          .then(proof => worker.postMessage({ id: message.id, pickerId: request.pickerId, type: 'eligibility-seed', proof }),
            () => worker.postMessage({ id: message.id, pickerId: request.pickerId, type: 'eligibility-seed' }));
      }
      return;
    }
    if (message.type === 'prediction-prepared') { request.prepared.push(message); return; }
    pending.delete(message.id);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
    else request.resolve({ ...message, prepared: request.prepared });
  });
  return { worker, ready: ready[0], exports,
    send(message) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, prepared: [], pickerId: message.pickerId ?? 'legacy-shared' });
        worker.postMessage({ id, ...message });
      });
    },
    close: () => worker.terminate(),
  };
}
