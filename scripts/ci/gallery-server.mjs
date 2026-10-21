// Credentials travel over the owned IPC channel only. No live storage is discovered.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { originalFixtureFetch } from './gallery-support.mjs';

if (!process.send) throw new Error('Launch through gallery-check.mjs.');
const [checkout, scratch, portText] = process.argv.slice(2);
const port = Number(portText);
if (!checkout || !scratch || !Number.isInteger(port) || port < 8900 || port > 8999) throw new Error('INVALID_ARGUMENT');
let application, closing = false, stage = 'FIXTURE';
const stop = async () => {
  if (closing) return;
  closing = true;
  try { await application?.close(); } finally { process.exit(0); }
};
process.on('message', message => { if (message?.type === 'stop') void stop(); });
process.once('disconnect', () => void stop());
try {
  const capture = JSON.parse(await readFile(path.join(checkout, 'tests/fixtures/original-sync/capture.json'), 'utf8'));
  stage = 'IMPORT';
  const { createServer } = await import(pathToFileURL(path.join(checkout, 'app/server.mjs')).href);
  stage = 'CREATE';
  application = await createServer({ dataDir: path.join(scratch, 'save'), host: '127.0.0.1', port,
    // The browser gets the complete selected dataset and gallery fixtures.
    // Its live-game API is forbidden, so keep only the unused backend world tiny.
    definitions: { chunks: { 12341: {} }, challenges: {}, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] }, taskMap: {},
    loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false,
    taskWorkerOptions: { idleMs: 1000, startupDeadlineMs: 120000 },
    idleMemoryOptions: { delayMs: 1000 }, originalSync: { retries: 0,
      now: () => new Date(capture.metadata.capturedAt), fetchImpl: originalFixtureFetch(capture) } });
  stage = 'LISTEN'; await application.listen();
  // Gallery previews use fixtures; retire the startup calculator before Chrome.
  await new Promise(resolve => setTimeout(resolve, 1500));
  globalThis.gc?.();
  process.send({ type: 'ready', inviteUrl: application.inviteUrl });
} catch (error) {
  const code = /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'FAILED';
  process.send({ type: 'error', code: `SERVER_${stage}_${code}` });
  await application?.close();
  process.exit(1);
}
