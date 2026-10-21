// Private benchmark child. Credentials and startup milestones travel only over IPC.
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

if (!process.send || !process.env.RS3_WARMSTART_SCRATCH) throw new Error('Launch through warmstart.mjs.');
const started = performance.now();
let application, readyApplication, closing = false;
const numericTree = value => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value).filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,70}$/.test(key))
    .map(([key, item]) => [key, numericTree(item)]).filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries);
};
const send = value => { if (process.connected) process.send(value); };
async function stop() {
  if (closing) return;
  closing = true;
  try { await application?.close(); } finally { process.exit(0); }
}
process.on('message', message => {
  if (message?.type === 'rss') {
    const memory = process.memoryUsage();
    send({ type: 'rss', id: message.id, rssBytes: memory.rss, memoryUsage: numericTree(memory),
      trace: numericTree(globalThis.__startupTrace), startupTimingMs: numericTree(readyApplication?.getStartupTimingMs?.()) });
  }
  if (message?.type === 'stop') void stop();
});
process.once('disconnect', () => void stop());
try {
  const module = await import(process.env.RS3_WARMSTART_ENTRY
    ? pathToFileURL(process.env.RS3_WARMSTART_ENTRY).href : '../../app/server.mjs');
  const options = { dataDir: process.env.RS3_WARMSTART_SCRATCH, host: '127.0.0.1',
    port: Number(process.env.RS3_WARMSTART_PORT), loopbackPort: undefined, publicOrigin: undefined,
    taskWorkerOptions: { idleMs: Number(process.env.RS3_WARMSTART_IDLE_MS ?? 60000), startupDeadlineMs: 300000 } };
  if (module.startServer) application = await module.startServer(options);
  else { application = await module.createServer(options); await application.listen(); }
  if (application.address()?.port !== options.port) throw new Error('Unexpected benchmark listener.');
  send({ type: 'listening', elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss });
  const ready = application.ready ? await application.ready : application;
  readyApplication = ready;
  send({ type: 'ready', elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss,
    trace: numericTree(globalThis.__startupTrace), startupTimingMs: numericTree(ready.getStartupTimingMs?.()) });
} catch {
  send({ type: 'error' });
  try { await application?.close(); } catch {}
  process.exit(1);
}
