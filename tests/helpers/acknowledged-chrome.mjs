import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { chromeLaunchConfiguration } from '../../scripts/perf/cdp.mjs';

const aborted = () => Object.assign(new Error('Outer browser-file hang guard fired.'), { name: 'AbortError' });

// Node's WebSocket default dispatcher has a connection deadline. Keep its
// framing/parser, but acknowledge the loopback HTTP upgrade without that timer.
export function acknowledgedUpgrade({ request = httpRequest } = {}) {
  return { dispatch(options, handler) {
    const headers = Array.isArray(options.headers) ? options.headers : Object.entries(options.headers ?? {}).flat();
    const req = request(new URL(options.path, options.origin), { method: options.method, agent: false, timeout: 0,
      headers: [...headers, 'Connection', 'Upgrade', 'Upgrade', 'websocket'] });
    req.once('error', error => handler.onError(error));
    req.once('response', response => {
      response.resume();
      handler.onError(new Error(`Owned CDP upgrade returned HTTP ${response.statusCode}.`));
    });
    req.once('upgrade', (response, socket, head) => {
      if (head.length) socket.unshift(head);
      handler.onUpgrade(response.statusCode, response.rawHeaders, socket);
    });
    handler.onConnect(reason => req.destroy(reason instanceof Error ? reason : undefined), null);
    req.end();
    return true;
  } };
}

// A transport acknowledgement has no deadline. Only the owning file may abort.
export function acknowledgedConnection(socket, { signal } = {}) {
  let sequence = 0, stopped;
  const pending = new Map(), listeners = new Set();
  const stop = error => {
    stopped = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const abort = () => { stop(aborted()); socket.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      message.error ? entry.reject(new Error(`CDP ${entry.method}: ${message.error.message}`)) : entry.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  });
  socket.addEventListener('close', () => { signal?.removeEventListener('abort', abort); stop(new Error('Owned CDP socket closed.')); });
  socket.addEventListener('error', () => stop(new Error('Owned CDP socket failed.')));
  return { listeners, pending: () => [...pending.values()].map(({ method, sessionId }) => ({ method, sessionId })),
    send(method, params = {}, sessionId) {
      if (signal?.aborted || stopped) return Promise.reject(stopped ?? aborted());
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject, method, sessionId });
        try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
        catch (error) { pending.delete(id); reject(error); }
      });
    }, close: () => socket.close() };
}

export function chromeEndpoint(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const done = (error, value) => {
      child.stderr.removeListener('data', data); child.removeListener('exit', exit); child.removeListener('error', fail);
      error ? reject(error) : resolve(value);
    };
    const exit = (code, signal) => done(new Error(`Owned Chrome exited before readiness (${code ?? signal}). ${output}`));
    const fail = error => done(error);
    const data = chunk => {
      output = (output + chunk.toString()).slice(-8192);
      const endpoint = output.match(/DevTools listening on (ws:\/\/[^\r\n]+)\r?\n/)?.[1];
      if (!endpoint) return;
      let url;
      try { url = new URL(endpoint); }
      catch { return done(new Error('Malformed owned Chrome endpoint.')); }
      if (url.hostname !== '127.0.0.1' || !/^\/devtools\/browser\//.test(url.pathname)
        || url.username || url.password || url.search || url.hash || Number(url.port) < 1024
        || [8788, 8789, 8790, 8791].includes(Number(url.port))) return done(new Error('Unsafe owned Chrome endpoint.'));
      done(null, endpoint);
    };
    child.stderr.on('data', data); child.once('exit', exit); child.once('error', fail);
  });
}

export async function openAcknowledgedChrome(executable, profile, { signal, report = () => {}, extraArgs = [] } = {},
  { spawn: launch = spawn, WebSocket: Socket = globalThis.WebSocket } = {}) {
  const { args } = chromeLaunchConfiguration(profile, { port: 0, env: {}, extraArgs });
  const child = launch(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let connection, phase = 'Chrome stderr readiness', contexts = 0;
  let exitCode, exitSignal, exitObserved = false, stdioClosed = false;
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { exitCode = code; exitSignal = signal; exitObserved = true; resolve(); }));
  // close also acknowledges closure of inherited stdio, after actual exit.
  const closed = new Promise(resolve => child.once('close', () => { stdioClosed = true; resolve(); }));
  const diagnostics = () => ({ phase, pid: child.pid, launches: 1, contexts, pending: connection?.pending() ?? [],
    handle: { exitCode: child.exitCode, signalCode: child.signalCode, killed: child.killed, exitObserved, stdioClosed } });
  const terminate = () => {
    report(diagnostics());
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    // Stop the exact owned process through its handle; abort must not depend
    // on launching a second process on a starved runner.
    if (!child.kill('SIGKILL')) report({ retainedChrome: child.pid, ...diagnostics() });
  };
  signal?.addEventListener('abort', terminate, { once: true });
  try {
    const endpoint = await chromeEndpoint(child);
    if (signal?.aborted) throw aborted();
    phase = 'CDP socket open';
    const socket = new Socket(endpoint, { dispatcher: acknowledgedUpgrade() });
    await new Promise((resolve, reject) => {
      const abort = () => { socket.close(); reject(aborted()); };
      const exit = () => done(new Error('Chrome exited before CDP opened.'));
      const done = error => { signal?.removeEventListener('abort', abort); child.removeListener('exit', exit); error ? reject(error) : resolve(); };
      signal?.addEventListener('abort', abort, { once: true });
      child.once('exit', exit);
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => done(new Error('CDP socket failed to open.')), { once: true });
      socket.addEventListener('close', () => done(new Error('CDP socket closed before opening.')), { once: true });
    });
    connection = acknowledgedConnection(socket, { signal });
    phase = 'browser journeys';
    return { diagnostics,
      async page({ width, height, mobile }) {
        const { browserContextId } = await connection.send('Target.createBrowserContext');
        contexts++;
        const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
        const listeners = new Set();
        const listener = message => { if (message.sessionId === sessionId) for (const receive of listeners) receive(message); };
        connection.listeners.add(listener);
        const send = (method, params) => connection.send(method, params, sessionId);
        await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
        return { send, listeners, async close() {
          await connection.send('Target.disposeBrowserContext', { browserContextId });
          connection.listeners.delete(listener);
        } };
      }, async close() {
        phase = 'Chrome process exit';
        if (!signal?.aborted) {
          // Some builds exit without replying. Process exit is sufficient.
          await Promise.race([connection.send('Browser.close').catch(() => {}), exited]);
        }
        await exited; await closed;
        connection.close(); signal?.removeEventListener('abort', terminate);
        if (!signal?.aborted && (exitCode !== 0 || exitSignal)) throw new Error(`Owned Chrome failed on exit (${exitCode ?? exitSignal}).`);
      } };
  } catch (error) {
    terminate(); await closed; signal?.removeEventListener('abort', terminate); throw error;
  }
}

// Transient Windows sharing errors do not turn a passing journey into a timed
// cleanup failure. Yield between actual removal acknowledgements. The one file
// guard diagnoses a directory that truly remains; there is no retry budget.
export async function removeScratch(directory, { signal, report = () => {}, remove = rm } = {}) {
  let reported = false;
  for (;;) {
    if (signal?.aborted) { report({ retainedScratch: directory }); return; }
    try { await remove(directory, { recursive: true, force: true, maxRetries: 0 }); return; }
    catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code)) throw error;
      if (!reported) { report({ pendingCleanup: directory, code: error.code }); reported = true; }
      await yieldTurn();
    }
  }
}
