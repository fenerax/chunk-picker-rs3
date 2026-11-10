import { execFile, spawn } from 'node:child_process';
import { chromeLaunchConfiguration } from './chrome-launch.mjs';
import { acknowledgedUpgrade, acknowledgedConnection, chromeEndpoint } from './chrome-transport.mjs';
export { chromeLaunchConfiguration } from './chrome-launch.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(action, timeoutMs = 30000, interval = 50, label = 'condition') {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const result = await action(); if (result) return result; await sleep(interval); }
  throw new Error(`Timed out waiting for ${label}.`);
}
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, sleep(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(3000)]);
  }
  // Chrome can keep its Windows process tree alive after Browser.close and
  // Node's signals. Target only the child this harness spawned, never by name.
  if (process.platform === 'win32' && child.exitCode === null && child.signalCode === null && Number.isSafeInteger(child.pid) && child.pid > 0) {
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, timeout: 10000 }, () => resolve()));
    await Promise.race([exited, sleep(3000)]);
    // Windows may deliver the ChildProcess exit event after the process has
    // already disappeared. Verify that exact PID before retaining its scratch.
    try { process.kill(child.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; }
  }
  if (child.exitCode === null && child.signalCode === null) throw new Error('Child process did not exit; scratch retained.');
}

// The existing shutdown grace is an operational cleanup bound, independent of
// test readiness. Callers with an outer signal keep control of normal waiting.
async function waitForChromeClose(closed) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    closed.then(() => { clearTimeout(timer); resolve(true); });
  });
}

// Readiness and commands complete on acknowledgements, never on a local clock.
// The caller owns one outer guard and passes its signal for owned-process cleanup.
export async function openChrome(executable, profile, options = {}, dependencies = {}) {
  options.signal?.throwIfAborted();
  const { port, args } = chromeLaunchConfiguration(profile, { ...options, env: process.env });
  const { spawn: launch = spawn, WebSocket: Socket = globalThis.WebSocket,
    stopChild: stop = stopChild, waitForClose = waitForChromeClose } = dependencies;
  const child = launch(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let socket, connection, phase = 'Chrome stderr readiness', stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
  let stdioClosed = false, stopping, closing;
  const interrupted = Promise.withResolvers();
  const closed = new Promise(resolve => child.once('close', () => { stdioClosed = true; resolve(); }));
  const diagnostics = () => ({ phase, pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
    pending: connection?.pending() ?? [], stderr });
  const terminate = () => {
    if (!stopping) {
      options.report?.(diagnostics());
      stopping = Promise.resolve().then(() => stop(child));
      // Abort can arrive before a caller starts awaiting startup or close.
      stopping.catch(() => {});
    }
    return stopping;
  };
  const abort = () => { interrupted.resolve(); void terminate(); };
  const drain = async () => {
    await terminate();
    if (!stdioClosed && !await waitForClose(closed)) throw new Error('Chrome stdio did not close; scratch retained.');
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const endpoint = new URL(await Promise.race([chromeEndpoint(child), interrupted.promise.then(async () => {
      await terminate(); options.signal.throwIfAborted();
    })]));
    if (port && Number(endpoint.port) !== port) throw new Error('Chrome debugger target escaped its owned loopback port.');
    options.signal?.throwIfAborted();
    phase = 'CDP socket open';
    socket = new Socket(endpoint.href, { dispatcher: acknowledgedUpgrade() });
    await new Promise((resolve, reject) => {
      const done = failure => {
        options.signal?.removeEventListener('abort', abort); child.removeListener('exit', exit);
        for (const [event, listener] of [['open', open], ['error', error], ['close', close]]) socket.removeEventListener(event, listener);
        failure ? reject(failure) : resolve();
      };
      const abort = () => done(options.signal.reason);
      const exit = () => done(new Error('Chrome exited before CDP opened.'));
      const open = () => done();
      const error = () => done(new Error('CDP connection failed.'));
      const close = () => done(new Error('CDP closed before opening.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      child.once('exit', exit);
      socket.addEventListener('open', open); socket.addEventListener('error', error); socket.addEventListener('close', close);
      if (options.signal?.aborted) abort();
      else if (child.exitCode !== null || child.signalCode !== null) exit();
    });
    connection = acknowledgedConnection(socket, { signal: options.signal });
    // A dead browser cannot acknowledge pending work even if its socket's close
    // event is delayed. Release all waiters on the process acknowledgement too.
    const onExit = () => connection.close();
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
    let pageSession;
    if (!options.browser) {
      phase = 'initial page attachment';
      const { targetInfos } = await connection.send('Target.getTargets');
      const target = targetInfos.find(item => item.type === 'page');
      if (!target) throw new Error('Owned Chrome has no initial page.');
      ({ sessionId: pageSession } = await connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
    }
    const listeners = new Set();
    connection.listeners.add(message => {
      if (!pageSession || message.sessionId === pageSession) for (const listener of listeners) listener(message);
    });
    const send = (method, params = {}, sessionId = pageSession) => connection.send(method, params, sessionId);
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error('Benchmark browser probe failed.');
      return response.result?.value;
    };
    if (!options.browser) {
      await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    phase = 'browser work';
    const shutdown = async () => {
      phase = 'Chrome process exit';
      try {
        // Chrome may acknowledge close without exiting, or exit without an
        // acknowledgement. Neither CDP outcome owns process cleanup.
        if (!options.signal?.aborted) void connection.send('Browser.close').catch(() => {});
        if (options.signal) await Promise.race([closed, interrupted.promise.then(drain)]);
        else if (!await waitForClose(closed)) await drain();
      } finally {
        connection.close(); child.removeListener('exit', onExit);
        options.signal?.removeEventListener('abort', abort);
      }
      if (!options.signal?.aborted && (child.exitCode !== 0 || child.signalCode)) throw new Error(`Owned Chrome failed on exit. ${stderr}`);
    };
    return { child, send, evaluate, listeners, diagnostics, close: () => closing ??= shutdown() };
  } catch (error) {
    socket?.close();
    try { await drain(); } finally { options.signal?.removeEventListener('abort', abort); }
    options.signal?.throwIfAborted();
    throw error;
  }
}
