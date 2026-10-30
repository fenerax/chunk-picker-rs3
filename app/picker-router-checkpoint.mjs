import { withStoreWrite } from './storage/snapshot.mjs';
import { performance } from 'node:perf_hooks';

// Only the registry/roster checkpoint fences global admission. Picker data is
// copied later under its own storage barrier, without holding this coordinator.
export function createPickerCheckpoint({ serialize, entries, registry }) {
  const active = new Set();
  let capturing = false, gate, unlock;
  const timing = { globalBarrierMs: 0, waitedRequests: 0, maxRequestWaitMs: 0, totalRequestWaitMs: 0 };
  return {
    async enter() {
      if (capturing) {
        const started = performance.now();
        while (capturing) await gate;
        const waitedMs = performance.now() - started;
        timing.waitedRequests++; timing.totalRequestWaitMs += waitedMs;
        timing.maxRequestWaitMs = Math.max(timing.maxRequestWaitMs, waitedMs);
      }
      let finish;
      const done = new Promise(resolve => { finish = resolve; }); active.add(done);
      return () => { active.delete(done); finish(); };
    },
    // Cold initialization writes bindings/state before ordinary store queues
    // exist. Make it participate in the same per-picker snapshot barrier.
    open(id, work) { return withStoreWrite(registry.pickerDirectory(id), work); },
    timings() { return { ...timing }; },
    counts() {
      const pickers = registry.listPickers(), available = pickers.filter(p => p.lifecycle === 'active');
      const open = entries.size + 1;
      return { registry: 'ready', pickers: pickers.length, active: available.length,
        openContexts: open, dormantContexts: Math.max(0, available.length - open), checkpoint: capturing };
    },
    async capture(work) {
      if (capturing) throw Object.assign(new Error('Service checkpoint in progress.'), { status: 503 });
      const started = performance.now();
      capturing = true; gate = new Promise(resolve => { unlock = resolve; });
      let timer, accepting = true;
      try {
        // The registry queue is the metadata transaction boundary. Waiting for
        // unrelated HTTP responses or residency drains would lengthen admission
        // without making the durable registry/account checkpoint more atomic.
        return await Promise.race([registry.withRecoveryCheckpoint(document => {
          if (!accepting) throw new Error('Service metadata checkpoint expired.');
          return work(document);
        }), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Service metadata checkpoint timed out.')), 30000);
        })]);
      } finally {
        accepting = false; clearTimeout(timer); timing.globalBarrierMs = performance.now() - started;
        capturing = false; unlock();
      }
    },
  };
}
