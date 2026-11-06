// File-backed diagnostic preload for publisher-memory-ceilings.mjs only.
import { parentPort, isMainThread } from 'node:worker_threads';

if (!isMainThread) {
  const send = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = value => send({ ...value, memorySample: {
    heapMiB: process.memoryUsage().heapUsed / 1048576,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
  } });
}
