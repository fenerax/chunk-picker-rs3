import { parentPort, threadId } from 'node:worker_threads';

parentPort.on('message', message => {
  if (message.memoryPort) {
    message.memoryPort.postMessage({ threadId, memoryUsage: process.memoryUsage() }); message.memoryPort.close();
  }
  if (message.testWaitForCancellation) {
    const flag = new Int32Array(message.cancellation);
    parentPort.postMessage({ type: 'progress', id: message.id, testBlocked: true });
    // Model synchronous CPU work: the production cancellation contract is an
    // atomic word, not a wake notification. No timer decides when work ends.
    while (!Atomics.load(flag, 0)) { /* The host changes its local SAB over IPC. */ }
    parentPort.postMessage({ type: 'progress', id: message.id, testCancellationObserved: true });
  }
});
