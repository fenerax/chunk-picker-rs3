import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { releaseWarmStoreLocks } from './warm-store.mjs';

// Register identity before starting the thread: termination can interrupt any
// synchronous filesystem call, before an acquisition message could be sent.
export class WarmStoreWorker extends Worker {
  constructor(file, options, directories = []) {
    const ownerId = randomUUID();
    super(file, { ...options, workerData: { ...options.workerData, warmStoreOwnerId: ownerId } });
    const ownerThreadId = this.threadId;
    this.once('exit', () => {
      for (const directory of directories) releaseWarmStoreLocks(directory, ownerId, ownerThreadId);
    });
  }
}
