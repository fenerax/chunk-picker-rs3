import { isMainThread, parentPort, threadId } from 'node:worker_threads';
import { getHeapStatistics, writeHeapSnapshot } from 'node:v8';

// Measurement preload only (`node --import`). Each task worker answers memory
// samples and heap snapshot requests; the main thread and child hosts ignore it.
// Thread workers answer on a BroadcastChannel. Process-worker hosts send a
// memoryPort through their own probe protocol (process-worker-host.mjs).
export const PROBE_CHANNEL = 'rs3-worker-memory-probe';
// Collect first (with --expose-gc) so samples compare retained memory, not garbage.
const sample = () => (globalThis.gc?.(), { threadId, pid: process.pid, memoryUsage: process.memoryUsage(),
  heap: (({ total_heap_size, used_heap_size, external_memory, malloced_memory }) =>
    ({ total_heap_size, used_heap_size, external_memory, malloced_memory }))(getHeapStatistics()) });

if (!isMainThread && parentPort) {
  parentPort.on('message', message => {
    if (message?.type !== 'cancel' || message.id !== -1 || !message.memoryPort) return;
    message.memoryPort.postMessage(sample());
  });
  const channel = new BroadcastChannel(PROBE_CHANNEL);
  channel.unref();
  channel.onmessage = ({ data }) => {
    if (data?.kind === 'sample') channel.postMessage({ kind: 'reply', request: data.request, ...sample() });
    if (data?.kind === 'snapshot') {
      const file = writeHeapSnapshot(`${data.prefix}-thread${threadId}.heapsnapshot`);
      channel.postMessage({ kind: 'reply', request: data.request, threadId, file });
    }
  };
}
