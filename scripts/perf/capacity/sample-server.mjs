import { errorReceipt } from './failures.mjs';

// HTTP receipts and the main isolate never wait for a busy calculator isolate.
// Only one heap collection is owned at a time, even across sampling deadlines.
export function createSampleEmitter({ get, workers, snapshot, send, identity }) {
  let heapPending;
  return id => {
    const emit = value => send({ id, ...identity, ...value });
    const fail = (part, error) => emit({ type: 'sample-error', part, error: errorReceipt(error) });
    try { emit({ type: 'sample', ...snapshot() }); } catch (error) { fail('snapshot', error); }
    const required = Promise.all(['health', 'diagnostics'].map(async part => {
      try { emit({ type: `sample-${part}`, [part]: await get(`/api/${part}`) }); }
      catch (error) { fail(part, error); }
    }));
    if (heapPending) {
      fail('heap', Object.assign(new Error('Previous calculator heap probe is still pending.'), { name: 'HeapProbeBusy' }));
    } else {
      heapPending = Promise.all([...workers].filter(worker => typeof worker.getMemoryUsage === 'function').map(async worker => {
        try {
          const value = await worker.getMemoryUsage();
          return { pid: value.pid, hostHeapUsed: value.main?.heapUsed,
            threadHeapUsed: value.workers?.length ? value.workers.reduce((n, w) => n + (w.memoryUsage?.heapUsed ?? 0), 0) : null };
        } catch (error) { fail('heap', error); return null; }
      })).then(calculatorHeaps => emit({ type: 'sample-heap', calculatorHeaps })).finally(() => { heapPending = undefined; });
    }
    return { required, heap: heapPending };
  };
}
