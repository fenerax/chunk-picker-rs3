// Opt-in diagnostic preload: collect the calculator isolate outside timed work.
import { parentPort } from 'node:worker_threads';
import { Session } from 'node:inspector';
import { setImmediate as turn } from 'node:timers/promises';
import { registerHooks } from 'node:module';
const accounting = Symbol.for('snapshot-throughput.accounting');
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/app/tasks/worker.mjs')) return result;
  const source = String(result.source), anchor = 'const snapshots = completeCache.entries;';
  if (!source.includes(anchor)) throw Error('Snapshot throughput accounting anchor changed');
  return { ...result, source: source.replace(anchor, anchor + `
globalThis[Symbol.for('snapshot-throughput.accounting')] = () => ({ hotEntries: snapshotOptions.hotSet.size,
  hotBytes: snapshotOptions.hotSet.bytes, ledgerBytes: snapshotBudget.bytes,
  coldEntries: [...snapshots.values()].filter(record => !record.value).length });`) };
} });
const inspector = new Session(); inspector.connect();
const collect = () => new Promise((resolve, reject) => inspector.post('HeapProfiler.collectGarbage', error => error ? reject(error) : resolve()));
parentPort.on('message', async message => {
  if (message?.type !== 'cancel' || message.id !== -1 || !message.memoryPort) return;
  try {
    await turn(); await collect(); await turn(); await collect(); await turn();
    message.memoryPort.postMessage({ memoryUsage: { ...process.memoryUsage(), snapshotCache: globalThis[accounting]?.() } });
  } finally { message.memoryPort.close(); }
});
