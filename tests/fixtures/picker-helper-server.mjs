// A disposable process for exercising Windows helper lifecycle behavior.
import http from 'node:http';
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'helper-test-config.json'), 'utf8'));
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) =>
  [process.argv[2 + index * 2], process.argv[3 + index * 2]]));
const token = 'a'.repeat(43);
await mkdir(args['--data-dir'], { recursive: true });
await writeFile(path.join(args['--data-dir'], 'access-token'), `${token}\n`);
await appendFile(path.join(root, 'starts.ndjson'), `${process.pid}\n`);
await writeFile(path.join(root, 'fixture-started'), 'started');
function acknowledged(name) {
  const file = path.join(root, name);
  return new Promise(resolve => {
    const watcher = watch(root, () => { if (existsSync(file)) { watcher.close(); resolve(); } });
    if (existsSync(file)) { watcher.close(); resolve(); }
  });
}
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/health') {
    response.end(JSON.stringify({ ready: !config.healthStatus, savesReady: true, status: config.healthStatus ?? 'ready' }));
  } else if (request.url === '/api/shutdown' && request.method === 'POST') {
    await writeFile(path.join(root, 'shutdown-requested'), 'authenticated');
    response.writeHead(202).end(JSON.stringify({ status: 'stopping' }));
    if (!config.ignoreShutdown) {
      await acknowledged('allow-drain');
      await writeFile(path.join(root, 'save-drained'), 'committed');
      server.close(() => process.exit(0));
      server.closeAllConnections();
    }
  } else {
    response.writeHead(404).end('{}');
  }
});
const listen = () => server.listen(Number(args['--port']), args['--host'], () => {
  process.stdout.write(`Private picker fixture ready at http://${args['--host']}:${args['--port']}.\n`);
  void writeFile(path.join(root, 'fixture-ready'), 'ready');
});
if (config.waitForReadySignal) await acknowledged('allow-ready');
listen();
