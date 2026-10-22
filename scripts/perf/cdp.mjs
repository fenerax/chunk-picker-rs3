import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromeStartupMessage } from './diagnostics.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(action, timeoutMs = 30000, interval = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const result = await action(); if (result) return result; await sleep(interval); }
  throw new Error('Timed out waiting for the scratch benchmark.');
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

export function chromeLaunchConfiguration(profile, { extraArgs = [], port, env = process.env } = {}) {
  const configured = env.RS3_SCRATCH_CDP_PORT;
  if (configured !== undefined && (typeof configured !== 'string' || !/^89\d{2}$/.test(configured))) throw new Error('Bounded Chrome port must be 8900–8999.');
  const selected = port ?? (configured === undefined ? 0 : Number(configured));
  if (!Number.isInteger(selected) || selected !== 0 && (selected < 8900 || selected > 8999)
    || configured !== undefined && selected !== Number(configured)) throw new Error('Chrome port conflicts with the bounded scratch policy.');
  if (!Array.isArray(extraArgs) || extraArgs.some(arg => typeof arg !== 'string' || /^--(?:remote-debugging(?:-|$)|user-data-dir(?:=|$))/i.test(arg))) throw new Error('Chrome ownership flags cannot be overridden.');
  return { port: selected, args: ['--headless=new', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${selected}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--hide-scrollbars', ...extraArgs, 'about:blank'] };
}

export async function openChrome(executable, profile, options = {}, dependencies = {}) {
  const { port: requestedPort, args } = chromeLaunchConfiguration(profile, { ...options, env: process.env });
  const { spawn: launch = spawn, readFile: read = readFile, fetch: request = globalThis.fetch, WebSocket: Socket = globalThis.WebSocket } = dependencies;
  const child = launch(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '', launchError;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-16384); });
  child.on('error', error => { launchError = error; });
  const checkStartup = () => {
    if (launchError) { const error = new Error('Chrome could not start.'); error.code = launchError.code; throw error; }
    if (child.exitCode !== null || child.signalCode != null) throw new Error(chromeStartupMessage(stderr));
  };
  let socket;
  try {
    const port = requestedPort || await until(async () => {
      checkStartup();
      try { return Number((await read(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return false; }
    });
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || [8788, 8789, 8790, 8791].includes(port)) throw new Error('Unsafe Chrome port.');
    const target = await until(async () => {
      checkStartup();
      try { return (await (await request(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { return false; }
    });
    const endpoint = new URL(target.webSocketDebuggerUrl);
    if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Chrome debugger target escaped its owned loopback port.');
    socket = new Socket(endpoint.href);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP connection failed.')), { once: true }); });
    let sequence = 0;
    const pending = new Map(), listeners = new Set();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = pending.get(message.id);
        if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(`CDP ${entry.method} failed.`)) : entry.resolve(message.result); }
      } else for (const listener of listeners) listener(message);
    });
    socket.addEventListener('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP closed.')); } pending.clear(); });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out.`)); }, 30000);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error('Benchmark browser probe failed.');
      return response.result?.value;
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    return { child, send, evaluate, listeners, async close() {
      try { await send('Browser.close'); } catch {} socket.close(); await stopChild(child);
    } };
  } catch (error) { socket?.close(); await stopChild(child); throw error; }
}
