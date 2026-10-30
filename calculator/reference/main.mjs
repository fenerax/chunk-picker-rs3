import { Worker } from 'node:worker_threads';
import { frames, parseBundle, writer, packParts, packRawParts } from './codec.mjs';

const send = writer(process.stdout);
let host, initialized = false, closing = false;
function error(id, kind) { return send({ v: 1, type: 'error', ...(id === undefined ? {} : { id }), error: { kind, message: kind } }); }
async function close(code = 0) {
  if (closing) return;
  closing = true;
  await host?.terminate();
  process.exitCode = code;
}
process.stdout.on('error', () => { void close(1); });
if (process.argv.length !== 4 || process.argv[2] !== '--protocol' || process.argv[3] !== '1') {
  await error(undefined, 'invalid');
  process.exitCode = 1;
} else {
  try {
    for await (const { header, body } of frames(process.stdin)) {
      if (header.v !== 1 || typeof header.type !== 'string') { await error(header.id, 'invalid'); continue; }
      if (!initialized) {
        if (header.type !== 'init') { await error(header.id, 'invalid'); continue; }
        const bundle = parseBundle(body);
        if (!bundle?.definitions || !bundle?.datasetDigest || !bundle?.world) { await error(header.id, 'invalid'); continue; }
        initialized = true;
        host = new Worker(new URL('./host.mjs', import.meta.url), { workerData: bundle, stdout: true, stderr: true });
        // Never relay imported modules' logs: they can contain gameplay.
        host.stdout.resume(); host.stderr.resume();
        host.on('message', message => {
          try {
          const { values, rawParts, ...reply } = message;
          if (values || rawParts) {
            const normal = packParts(values ?? {}), raw = packRawParts(rawParts ?? []);
            void send({ v: 1, ...reply, parts: [...normal.parts, ...raw.parts] }, [normal.body, ...raw.body]).catch(() => close(1));
          } else void send({ v: 1, ...reply }).catch(() => close(1));
          } catch { void error(message.id, 'failed').then(() => close(1)); process.stdin.destroy(); }
        });
        host.on('error', () => { void error(undefined, 'failed').then(() => close(1)); });
        host.on('exit', () => { if (!closing) { void error(undefined, 'failed').then(() => close(1)); process.stdin.destroy(); } });
      } else if (header.type === 'init') await error(header.id, 'invalid');
      else host.postMessage({ header, body });
    }
    await close();
  } catch { await error(undefined, 'invalid').catch(() => {}); await close(1); }
}
