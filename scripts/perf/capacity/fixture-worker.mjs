import { parentPort, workerData } from 'node:worker_threads';
import { buildGroup } from './fixture-group.mjs';
import { serveFixtureWorker } from './fixture-worker-runtime.mjs';
if (!parentPort) throw new Error('Use the fixture worker pool.');
// The real calculator compiles once in the parent. Workers share its immutable
// migration inputs as UTF-8 and parse once; no engine compilation per group.
const { tasks, migrationInputs } = JSON.parse(Buffer.from(workerData.tasks).toString('utf8'));
serveFixtureWorker(parentPort, (job, progress) => buildGroup(job, { ...workerData, tasks, migrationInputs, progress }));
