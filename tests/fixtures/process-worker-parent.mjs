import { ProcessWorker } from '../../app/tasks/process-worker.mjs';
import { genericWorkerData } from '../helpers/worker-dataset.mjs';
const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'], challenges: {} };
const worker = new ProcessWorker(genericWorkerData({ definitions }));
worker.on('error', () => process.exit(1));
worker.on('message', message => { if (message.type === 'ready') process.send({ workerPid: worker.pid }); });
process.on('message', message => { if (message.stop) process.exit(0); });
process.once('disconnect', () => process.exit(0));
