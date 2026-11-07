import http from 'node:http';
import childProcess, { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

export async function startDescendant() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'descendant'], {
    windowsHide: true, detached: process.platform === 'win32', stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const [ready] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw Error('Descendant exited before readiness.'); })]);
  child.disconnect(); child.unref();
  return ready;
}

if (process.argv[2] === 'descendant') {
  // Sleep with inherited stderr open. Only the owning test knows this port.
  const server = http.createServer((request, response) => { response.end('owned descendant'); if (request.url === '/stop') server.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const fallback = setTimeout(() => server.close(), 300000);
  server.once('close', () => clearTimeout(fallback));
  process.send({ pid: process.pid, port: server.address().port });
} else if (process.argv[2] === 'runner') {
  const { checkPackTransition } = await import('../../scripts/private-companion/release-pack-check.mjs');
  const options = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const events = {};
  const launch = childProcess.spawn, schedule = globalThis.setTimeout;
  let watchdog;
  childProcess.spawn = (...args) => {
    const child = launch(...args);
    if (args[1].includes('probe')) {
      events.pid = child.pid;
      child.once('exit', () => { events.exit = true; });
      child.once('close', () => { events.close = true; });
      events.stream = child.stderr;
      if (process.argv[4] === 'timeout') {
        let text = '';
        const ready = bytes => { text += bytes; if (text.includes('PROBE_TREE_READY')) { child.stderr.off('data', ready); watchdog(); } };
        child.stderr.on('data', ready);
      }
    }
    return child;
  };
  syncBuiltinESMExports();
  if (process.argv[4] === 'timeout') {
    // Trigger the real watchdog only after the real owned tree acknowledges
    // readiness. Kill, join and diagnostic deadlines retain their real clocks.
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 180000) watchdog = () => callback(...args);
      return schedule(callback, delay, ...args);
    };
  }
  let message;
  try { message = { kind: 'settled', passed: true, result: await checkPackTransition(options) }; }
  catch (error) { message = { kind: 'settled', passed: false, message: error.message, childResult: error.childResult, cleanupFailure: error.cleanupFailure }; process.exitCode = 1; }
  message.events = { pid: events.pid, exit: events.exit, close: events.close, destroyed: events.stream?.destroyed, ref: events.stream?._handle?.hasRef() };
  childProcess.spawn = launch; globalThis.setTimeout = schedule; syncBuiltinESMExports();
  await new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
  process.disconnect(); // Natural exit must follow, with no forced process.exit.
}
