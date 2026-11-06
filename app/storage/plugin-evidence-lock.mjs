import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

const queues = new Map(), context = new AsyncLocalStorage();
// Sidecar writers and restore publication share this small, reentrant lock.
// Store ownership remains the cross-process boundary.
export async function withPluginEvidence(dataDir, work) {
  const key = path.resolve(dataDir), parent = context.getStore();
  if (parent?.key === key && parent.active) return work();
  const previous = queues.get(key) ?? Promise.resolve();
  let release;
  const done = new Promise(resolve => { release = resolve; });
  const pending = previous.catch(() => {}).then(() => done);
  queues.set(key, pending);
  await previous.catch(() => {});
  const owner = { key, active: true };
  try { return await context.run(owner, work); }
  finally { owner.active = false; release(); if (queues.get(key) === pending) queues.delete(key); }
}
