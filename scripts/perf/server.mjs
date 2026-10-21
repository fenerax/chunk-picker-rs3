// Private child process used only by page-load.mjs. Credentials travel over IPC.
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

if (!process.send || !process.env.RS3_PERF_SCRATCH) throw new Error('Launch through npm run perf.');
const start = performance.now();
let application;
try {
  const { createServer } = await import(process.env.RS3_PERF_SERVER_ENTRY
    ? pathToFileURL(process.env.RS3_PERF_SERVER_ENTRY).href : '../../app/server.mjs');
  application = await createServer({ dataDir: process.env.RS3_PERF_SCRATCH,
    host: '127.0.0.1', port: 0, loopbackPort: undefined, publicOrigin: undefined,
    predictionPrewarm: process.env.RS3_PERF_PREWARM !== 'off' });
  await application.listen();
  if ([8788, 8789, 8790, 8791].includes(application.address().port)) throw new Error('Protected port selected.');
  const startup = application.getStartupTimingMs?.() ?? application.startupTimingMs;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  process.send({ type: 'ready', inviteUrl: application.inviteUrl,
    readyMs: performance.now() - start, rssBytes: process.memoryUsage().rss,
    startupTimingMs: { variantMs: numeric(startup?.variantMs), stateResponseMs: numeric(startup?.stateResponseMs) } });
  process.on('message', async message => {
    if (message.type === 'rss') process.send({ type: 'rss', id: message.id, rssBytes: process.memoryUsage().rss });
    if (message.type === 'stop') { await application.close(); process.exit(0); }
  });
  process.once('disconnect', async () => { await application.close(); process.exit(0); });
} catch {
  // Never forward errors containing state, request URLs or credentials.
  process.send({ type: 'error', message: 'Scratch server startup failed.' });
  await application?.close();
  process.exit(1);
}
