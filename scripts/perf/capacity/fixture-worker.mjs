import { parentPort, workerData } from 'node:worker_threads';
import { buildGroup } from './fixture-group.mjs';
if (!parentPort) throw new Error('Use the fixture worker pool.');
let sequence = 0;
const acknowledgements = new Map();
const progress = value => new Promise(resolve => {
  const id = ++sequence; acknowledgements.set(id, resolve);
  parentPort.postMessage({ type: 'progress', id, value });
});
// The real calculator compiles once in the parent. Workers share its immutable
// migration inputs as UTF-8 and parse once; no engine compilation per group.
const { tasks, migrationInputs } = JSON.parse(Buffer.from(workerData.tasks).toString('utf8'));
parentPort.on('message', async message => {
  if (message.type === 'ack') { acknowledgements.get(message.id)?.(); acknowledgements.delete(message.id); return; }
  if (message.type !== 'build') return;
  try { parentPort.postMessage({ type: 'result', value: await buildGroup(message.job, { ...workerData, tasks, migrationInputs, progress }) }); }
  catch (error) { parentPort.postMessage({ type: 'failure', message: error.message }); }
});
