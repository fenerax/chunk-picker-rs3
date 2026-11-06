// Maximum-sized synthetic collection publication; no save or server access.
// Run separately under the shared heavy lock, as an unprivileged Linux user.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { WarmStoreWorker } from '../../app/tasks/warm-store-worker.mjs';
import { PUBLISHER_WORKER_RESOURCE_LIMITS } from '../../app/tasks/worker-limits.mjs';
import { PREPARED_COLLECTION_LIMIT } from '../../app/tasks/prepared-collection.mjs';

if (process.platform !== 'linux' || process.getuid() === 0) throw new Error('Run this probe as an unprivileged Linux user under the shared heavy lock.');
for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') && !key.startsWith('RS3_HEAVY_LOCK_')) delete process.env[key];
const directory = path.resolve(process.argv[2] ?? '.local/publisher-memory-synthetic');
await mkdir(directory, { recursive: false });
const bytes = new Uint8Array(new SharedArrayBuffer(PREPARED_COLLECTION_LIMIT)); bytes.fill(42);
const key = createHash('sha256').update('synthetic collection').digest('hex');
const value = { key, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
const marks = [];
for (const persistent of [false, true]) {
  const worker = new WarmStoreWorker(new URL('../../app/tasks/prepared-collection-publisher.mjs', import.meta.url), {
    resourceLimits: PUBLISHER_WORKER_RESOURCE_LIMITS,
    execArgv: ['--import', new URL('./publisher-memory-probe.mjs', import.meta.url).href],
    workerData: { key, value, directory, persistentDirectory: persistent ? directory : undefined, enforceMemoryLimit: true },
  }, persistent ? [path.join(directory, 'collections')] : []);
  let memory, published = false;
  worker.on('message', message => { published = Boolean(message.reference); memory = message.memorySample; });
  const deadline = setTimeout(() => { void worker.terminate(); }, 60000);
  try {
    const [code] = await once(worker, 'exit');
    if (code !== 0 || !published || !memory) throw new Error('Synthetic publication did not complete.');
    marks.push({ stage: persistent ? 'persistent' : 'temporary', ...memory });
  } finally { clearTimeout(deadline); await worker.terminate(); }
}
console.log(JSON.stringify({ node: process.version, entryMiB: bytes.length / 1048576, marks }, null, 2));
