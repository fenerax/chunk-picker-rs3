// Publication belongs to a separate, short-lived thread so HTTP, saves and
// calculator cancellation never wait for collection checksums or disk writes.
import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createWarmStore, warmStoreAllowed, WARM_COLLECTION_LIMITS } from './warm-store.mjs';
import { validPreparedCollectionEntry, readPreparedCollectionFile } from './prepared-collection.mjs';
import { assertWorkerHeapLimit, PUBLISHER_WORKER_RESOURCE_LIMITS } from './worker-limits.mjs';

if (workerData.enforceMemoryLimit) assertWorkerHeapLimit(PUBLISHER_WORKER_RESOURCE_LIMITS);

const { key, value, reference, directory, persistentDirectory } = workerData;
let cacheDirectory;
try {
  if (warmStoreAllowed() && validPreparedCollectionEntry(value, key)) {
    if (persistentDirectory) {
      const store = createWarmStore(path.join(persistentDirectory, 'collections'), WARM_COLLECTION_LIMITS);
      const existing = validPreparedCollectionEntry(readPreparedCollectionFile(reference, key), key);
      parentPort.postMessage({ reference: existing ? reference : store?.put(key, value.bytes) });
      store?.close();
    } else {
      await mkdir(directory, { recursive: true });
      cacheDirectory = await mkdtemp(path.join(directory, 'rs3-prepared-'));
      const temporary = path.join(cacheDirectory, `${key}.tmp`), file = path.join(cacheDirectory, `${key}.bin`);
      await writeFile(temporary, value.bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
      parentPort.postMessage({ cacheDirectory, reference: { file, key, sha256: value.sha256, bytes: value.bytes.byteLength } });
    }
  }
} catch (error) {
  if (cacheDirectory && warmStoreAllowed()) await rm(cacheDirectory, { recursive: true, force: true });
  throw error;
}
