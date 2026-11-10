import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chromeLaunchConfiguration, openChrome } from '../scripts/perf/cdp.mjs';

const profile = 'C:/synthetic-owned-profile';
test('Chrome keeps the ordinary ephemeral default and enforces bounded explicit ports', () => {
  const ordinary = chromeLaunchConfiguration(profile, { env: {} });
  assert.equal(ordinary.port, 0);
  assert.ok(ordinary.args.includes('--remote-debugging-port=0'));
  for (const port of [8900, 8947, 8999]) {
    const configured = chromeLaunchConfiguration(profile, { env: { RS3_SCRATCH_CDP_PORT: String(port) } });
    assert.equal(configured.port, port);
    assert.ok(configured.args.includes('--remote-debugging-port=' + port));
    assert.equal(configured.args.filter(a => a.startsWith('--remote-debugging-port=')).length, 1);
  }
  for (const value of ['', '0', '8788', '8899', '9000', '8900x', '08900', ' 8900', '8900 ']) {
    assert.throws(() => chromeLaunchConfiguration(profile, { env: { RS3_SCRATCH_CDP_PORT: value } }), /port/);
  }
  for (const port of [0, 8788, 8899, 9000, 8901, '8900', NaN]) {
    assert.throws(() => chromeLaunchConfiguration(profile, { port, env: { RS3_SCRATCH_CDP_PORT: '8900' } }), /port/);
  }
  assert.equal(chromeLaunchConfiguration(profile, { port: Number('8950'), env: {} }).port, 8950);
});

test('extra arguments cannot override the debugging listener or owned profile', () => {
  for (const arg of ['--remote-debugging-port=' + '8788', '--remote-debugging-port', '--remote-debugging-address=0.0.0.0', '--remote-debugging-pipe', '--user-data-dir=C:/other']) {
    assert.throws(() => chromeLaunchConfiguration(profile, { extraArgs: [arg], env: {} }), /ownership/);
  }
  assert.ok(chromeLaunchConfiguration(profile, { extraArgs: ['--disable-gpu'], env: {} }).args.includes('--disable-gpu'));
});

function transport(endpoint = 'ws://127.0.0.1:8947/devtools/browser/synthetic') {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.stderr = new PassThrough(); child.pid = 424242;
  let closeChild = stoppedChild => { stoppedChild.exitCode = 0; stoppedChild.emit('exit', 0); stoppedChild.emit('close', 0); };
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0); };
  const observed = { requests: [], commands: [], launches: [], sockets: [], activePortReads: 0 };
  class Socket extends EventTarget {
    constructor(url) { super(); observed.sockets.push(url); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(value) {
      const request = JSON.parse(value);
      const result = request.method === 'Target.getTargets' ? { targetInfos: [{ type:'page', targetId:'owned-page' }] }
        : request.method === 'Target.attachToTarget' ? { sessionId:'owned-session' } : {};
      observed.commands.push(request);
      if (request.method === 'Browser.close' && closeChild(child) === false) return;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result }) })));
    }
    close() { this.dispatchEvent(new Event('close')); }
  }
  return { child, observed, onClose: action => { closeChild = action; }, dependencies: {
    spawn: (file, args, options) => {
      observed.launches.push({ file, args, options });
      queueMicrotask(() => child.stderr.write(`DevTools listening on ${endpoint}\n`));
      return child;
    },
    readFile: async () => { observed.activePortReads++; throw Error('Fixed-port mode must not read DevToolsActivePort.'); },
    fetch: async url => { observed.requests.push(url); return { json: async () => [{ type: 'page', webSocketDebuggerUrl: endpoint }] }; },
    WebSocket: Socket,
  } };
}

test('fixed-port CDP connects directly without an active-port file or a real browser', async () => {
  const fixture = transport();
  const browser = await openChrome('synthetic-chrome', profile, { port: Number('8947') }, fixture.dependencies);
  assert.equal(fixture.observed.launches.length, 1);
  assert.ok(fixture.observed.launches[0].args.includes('--remote-debugging-port=' + '8947'));
  assert.deepEqual(fixture.observed.requests, [], 'readiness is emitted by the owned process, not a polled port');
  assert.deepEqual(fixture.observed.sockets, ['ws://127.0.0.1:8947/devtools/browser/synthetic']);
  assert.equal(fixture.observed.activePortReads, 0);
  await browser.close();
});

test('browser CDP endpoint routes commands to isolated target sessions', async () => {
  const fixture = transport();
  const browser = await openChrome('synthetic-chrome', profile, { port: Number('8947'), browser: true }, fixture.dependencies);
  try {
    assert.deepEqual(fixture.observed.requests, []);
    assert.deepEqual(fixture.observed.commands, [], 'page domains belong to the attached page, not the browser');
    await browser.send('Page.enable', {}, 'synthetic-session');
    assert.equal(fixture.observed.commands.at(-1).sessionId, 'synthetic-session');
    await browser.send('Target.createBrowserContext');
    assert.equal(fixture.observed.commands.at(-1).sessionId, undefined);
  } finally { await browser.close(); }
});

test('CDP refuses a debugger target outside the selected loopback listener', async () => {
  for (const endpoint of ['ws://127.0.0.1:8788/devtools/browser/synthetic', 'ws://example.invalid:8947/devtools/browser/synthetic', 'wss://127.0.0.1:8947/devtools/browser/synthetic', 'ws://127.0.0.1:8948/devtools/browser/synthetic']) {
    const fixture = transport(endpoint);
    await assert.rejects(openChrome('synthetic-chrome', profile, { port: Number('8947') }, fixture.dependencies), /escaped|Unsafe/);
    assert.deepEqual(fixture.observed.sockets, []);
  }
});

test('CDP close waits for Chrome to finish exiting before scratch cleanup', async () => {
  let finishExit;
  const fixture = transport();
  fixture.onClose(child => {
    finishExit = () => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0); };
  });
  const signals = [];
  fixture.child.kill = signal => { signals.push(signal); finishExit(); };
  const browser = await openChrome('synthetic-chrome', profile, { port: Number('8947') }, fixture.dependencies);
  let closed = false;
  const closing = browser.close().then(() => { closed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finishExit, 'function', 'Browser.close was acknowledged');
    assert.equal(closed, false, 'an acknowledged close does not mean the process exited');
    assert.deepEqual(signals, [], 'allow graceful profile writes before sending a signal');
  } finally { finishExit(); await closing; }
  assert.equal(closed, true);
  assert.equal(fixture.child.listenerCount('exit'), 0, 'exit waiter releases its listener');
});

test('CDP close observes process exit even when Chrome sends no acknowledgement', async () => {
  const fixture = transport();
  fixture.onClose(child => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0); return false; });
  const browser = await openChrome('synthetic-chrome', profile, { port: Number('8947') }, fixture.dependencies);
  await browser.close();
  assert.equal(fixture.child.exitCode, 0);
  assert.equal(fixture.child.listenerCount('exit'), 0);
});

test('ephemeral Chrome readiness waits for its own endpoint event and preserves startup diagnostics', async () => {
  const fixture = transport();
  let acknowledge;
  fixture.dependencies.spawn = () => {
    acknowledge = () => fixture.child.stderr.write('DevTools listening on ws://127.0.0.1:8947/devtools/browser/synthetic\n');
    return fixture.child;
  };
  const opening = openChrome('synthetic-chrome', profile, {}, fixture.dependencies);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.observed.sockets, [], 'no connection before the owned process acknowledges readiness');
  acknowledge();
  const browser = await opening;
  assert.equal(fixture.observed.activePortReads, 0);
  assert.deepEqual(fixture.observed.requests, []);
  assert.equal(fixture.observed.commands.find(item => item.method === 'Page.enable').sessionId, 'owned-session');
  await browser.close();

  const failed = transport();
  failed.dependencies.spawn = () => {
    queueMicrotask(() => {
      failed.child.stderr.write('synthetic profile startup refusal\n');
      failed.child.exitCode = 17; failed.child.emit('exit', 17); failed.child.emit('close', 17);
    });
    return failed.child;
  };
  await assert.rejects(openChrome('synthetic-chrome', profile, {}, failed.dependencies), /exited before readiness.*17.*synthetic profile startup refusal/s);
});

test('outer cancellation during Chrome readiness drains the owned process before returning', async () => {
  const fixture = transport(), controller = new AbortController(), reports = [];
  let stopped;
  fixture.dependencies.spawn = () => fixture.child;
  fixture.child.kill = signal => { assert.equal(signal, 'SIGKILL'); stopped = true; return true; };
  const opening = openChrome('synthetic-chrome', profile, { signal: controller.signal, report: state => reports.push(state) }, fixture.dependencies);
  const rejected = assert.rejects(opening, /synthetic outer guard/);
  controller.abort(new Error('synthetic outer guard'));
  assert.equal(stopped, true);
  assert.equal(reports[0].phase, 'Chrome stderr readiness');
  fixture.child.signalCode = 'SIGKILL'; fixture.child.emit('exit', null, 'SIGKILL');
  fixture.child.emit('close', null, 'SIGKILL');
  await rejected;
});
