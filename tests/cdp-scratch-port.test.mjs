import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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

function transport(endpoint = 'ws://127.0.0.1:8947/devtools/page/synthetic') {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
  const observed = { requests: [], launches: [], sockets: [], activePortReads: 0 };
  class Socket extends EventTarget {
    constructor(url) { super(); observed.sockets.push(url); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(value) {
      const request = JSON.parse(value);
      if (request.method === 'Browser.close') child.exitCode = 0;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result: {} }) })));
    }
    close() { this.dispatchEvent(new Event('close')); }
  }
  return { child, observed, dependencies: {
    spawn: (file, args) => { observed.launches.push({ file, args }); return child; },
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
  assert.deepEqual(fixture.observed.requests, ['http://127.0.0.1:8947/json']);
  assert.deepEqual(fixture.observed.sockets, ['ws://127.0.0.1:8947/devtools/page/synthetic']);
  assert.equal(fixture.observed.activePortReads, 0);
  await browser.close();
});

test('CDP refuses a debugger target outside the selected loopback listener', async () => {
  for (const endpoint of ['ws://127.0.0.1:8788/devtools/page/synthetic', 'ws://example.invalid:8947/devtools/page/synthetic', 'wss://127.0.0.1:8947/devtools/page/synthetic']) {
    const fixture = transport(endpoint);
    // The fake process is already stopped; rejection must not create a socket.
    fixture.dependencies.fetch = async () => { fixture.child.exitCode = 0; return { json: async () => [{ type: 'page', webSocketDebuggerUrl: endpoint }] }; };
    await assert.rejects(openChrome('synthetic-chrome', profile, { port: Number('8947') }, fixture.dependencies), /escaped/);
    assert.deepEqual(fixture.observed.sockets, []);
  }
});
