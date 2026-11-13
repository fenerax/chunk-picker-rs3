import { parentPort, workerData } from 'node:worker_threads';
import { buildGroup } from './fixture-group.mjs';
import { serveFixtureWorker } from './fixture-worker-runtime.mjs';
import { prepareStoreProcessIdentity } from '../../../app/storage/store-lock.mjs';
if (!parentPort) throw new Error('Use the fixture worker pool.');
// The real calculator compiles once in the parent. Workers share its immutable
// migration inputs as UTF-8 and parse once; no engine compilation per group.
const { tasks, migrationInputs } = JSON.parse(Buffer.from(workerData.tasks).toString('utf8'));
// Unix fork inherits every isolate's listening guards until exec. Resolve the
// identity child before readiness; the pool waits for ALL workers' readiness
// before any temporary catalogue guard can be released and reacquired.
await prepareStoreProcessIdentity();
serveFixtureWorker(parentPort, (job, progress) => buildGroup(job, { ...workerData, tasks, migrationInputs, progress }));
