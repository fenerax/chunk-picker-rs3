import children from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { parentPort } from 'node:worker_threads';

// Hold every worker's process-identity preparation at the child-process
// boundary. A real Unix fork inherits all listening descriptors until exec;
// no fixture writer may hold a guard while a sibling is still preparing.
const servers = new Set(), createServer = net.createServer;
net.createServer = (...args) => {
  const server = createServer(...args); servers.add(server); return server;
};
const identity = Promise.withResolvers();
let stopping = false;
parentPort.on('message', message => {
  if (message.type === 'stop') stopping = true;
  if (message.type === 'identity-continue' || stopping) identity.resolve();
});
const execFile = children.execFile, execute = promisify(execFile);
children.execFile = Object.assign((...args) => execFile(...args), {
  [promisify.custom]: async (...args) => {
    if (!['ps', 'powershell.exe'].includes(args[0])) return execute(...args);
    parentPort.postMessage({ type: 'identity-preparing', guards: [...servers].filter(server => server.listening).length });
    await identity.promise;
    return { stdout: '2026-01-01T00:00:00.000Z\n', stderr: '' };
  },
});
syncBuiltinESMExports();
await import('../../scripts/perf/capacity/fixture-worker.mjs');
// This bootstrap listener can consume STOP before the runtime subscribes.
// Replay it after initialization so failed tests also drain naturally.
if (stopping) parentPort.emit('message', { type: 'stop' });
