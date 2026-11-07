import { parentPort, workerData } from 'node:worker_threads';
import { encodeImportBytes, decodeImportBytes } from '../../app/import-bytes.mjs';

// Reach a real preparation hook with a synthetic partial replacement, then
// wedge the isolate. Only Worker.terminate(), never a cooperative reply, exits.
const { document } = await decodeImportBytes(workerData);
const message = await encodeImportBytes({ hook: true, input: document, context: {} });
parentPort.postMessage({ ...message, hook: true }, message.buffers);
while (true) {}
