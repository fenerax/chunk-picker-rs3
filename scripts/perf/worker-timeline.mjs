// Harness-only preload: observe worker dispatch and completion without retaining inputs.
import { parentPort, threadId } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

if (parentPort) {
  const pending = new Map();
  const epoch = () => performance.timeOrigin + performance.now();
  parentPort.on('message', message => {
    if (message.memoryPort) {
      message.memoryPort.postMessage({ threadId, memoryUsage: process.memoryUsage() });
      message.memoryPort.close();
    }
    if (message.id !== undefined && ['evaluate', undefined].includes(message.type)) {
      pending.set(message.id, { startedEpochMs: epoch(),
        memberId: ['player1', 'player2'].includes(message.memberId) ? message.memberId : null,
        revision: Number.isSafeInteger(message.stateRevision ?? message.state?.revision ?? message.revision)
          ? message.stateRevision ?? message.state?.revision ?? message.revision : null });
    }
  });
  const post = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...args) => {
    const start = pending.get(message?.id);
    if (start && !['progress', 'prediction-prepared'].includes(message.type)) {
      pending.delete(message.id);
      message = { ...message, perfTimeline: { ...start, doneEpochMs: epoch() } };
    }
    return post(message, ...args);
  };
}
