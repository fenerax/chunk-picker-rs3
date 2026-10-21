// Worker-only preload. The ordinary calculator treats this cancel as a no-op.
import { isMainThread, parentPort, threadId, MessagePort } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';

if (!isMainThread && parentPort) parentPort.on('message', message => {
  if (message?.type !== 'cancel' || message.id !== -1 || !(message.memoryPort instanceof MessagePort)) return;
  const port = message.memoryPort;
  try {
    const { rss, ...memoryUsage } = process.memoryUsage();
    // RSS belongs to the whole process; do not attribute or sum it by thread.
    port.postMessage({ threadId, memoryUsage, heapStatistics: getHeapStatistics() });
  } finally { port.close(); }
});
