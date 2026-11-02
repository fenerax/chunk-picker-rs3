// Reuse the engine profiler controls, adding numeric job boundaries so start/
// stop inspector overhead cannot be mistaken for calculator self time.
import './engine-profile.mjs';
import { isMainThread, parentPort } from 'node:worker_threads';
if (!isMainThread && parentPort) {
  const starts = new Map(), now = () => Number(process.hrtime.bigint()) / 1000;
  parentPort.on('message', message => {
    if (!message.__engineProfile && !['cancel', 'supersede'].includes(message.type)) starts.set(message.id, now());
  });
  const send = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...rest) => {
    if (starts.has(message.id) && !['progress', 'prediction-prepared'].includes(message.type)) {
      message.__hotspotsWindow = { start: starts.get(message.id), end: now() };
      starts.delete(message.id);
    }
    return send(message, ...rest);
  };
}
