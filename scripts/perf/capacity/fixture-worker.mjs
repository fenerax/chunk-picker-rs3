import { parentPort, workerData } from 'node:worker_threads';
import { buildGroup } from './fixture-group.mjs';
if (!parentPort) throw new Error('Use the fixture worker pool.');
let sequence = 0;
const acknowledgements = new Map();
const progress = value => new Promise(resolve => {
  const id = ++sequence; acknowledgements.set(id, resolve);
  parentPort.postMessage({ type: 'progress', id, value });
});
// The engine graph is compiled once by the parent. Only small task rows are
// shared as immutable UTF-8 bytes; workers never compile the 200k-task graph.
const tasks = JSON.parse(Buffer.from(workerData.tasks).toString('utf8'));
parentPort.on('message', async message => {
  if (message.type === 'ack') { acknowledgements.get(message.id)?.(); acknowledgements.delete(message.id); return; }
  if (message.type !== 'build') return;
  try { parentPort.postMessage({ type: 'result', value: await buildGroup(message.job, { ...workerData, tasks, progress }) }); }
  catch (error) { parentPort.postMessage({ type: 'failure', message: error.message }); }
});
