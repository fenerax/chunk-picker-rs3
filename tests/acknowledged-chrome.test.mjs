import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { acknowledgedConnection, acknowledgedUpgrade, chromeEndpoint, openAcknowledgedChrome, removeScratch } from './helpers/acknowledged-chrome.mjs';

class Socket extends EventTarget {
  requests = [];
  send(bytes) { this.requests.push(JSON.parse(bytes)); }
  reply(request, result = {}) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result }) })); }
  close() { this.dispatchEvent(new Event('close')); }
}
const childProcess = () => Object.assign(new EventEmitter(), { stderr: new PassThrough(), exitCode: null, signalCode: null });

test('acknowledged browser lifecycle has only its file hang guard', { timeout: 300000 }, async t => {
  await t.test('the HTTP upgrade remains pending through a scheduling delay with network timers disabled', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const req = new EventEmitter();
    req.end = () => {};
    let options, upgraded = false, abort;
    const dispatcher = acknowledgedUpgrade({ request: (url, value) => {
      assert.equal(url.href, 'http://127.0.0.1:8947/devtools/browser/synthetic');
      options = value; return req;
    } });
    const socket = { unshift: bytes => assert.equal(bytes.toString(), 'synthetic frame') };
    dispatcher.dispatch({ origin: 'http://127.0.0.1:8947', path: '/devtools/browser/synthetic', method: 'GET', headers: [] }, {
      onConnect: value => { abort = value; }, onError: error => assert.fail(error.message),
      onUpgrade: (status, headers, value) => { assert.equal(status, 101); assert.equal(value, socket); upgraded = true; },
    });
    assert.equal(options.timeout, 0); assert.equal(options.agent, false); assert.equal(typeof abort, 'function');
    t.mock.timers.tick(3600000); await Promise.resolve();
    assert.equal(upgraded, false);
    req.emit('upgrade', { statusCode: 101, rawHeaders: [] }, socket, Buffer.from('synthetic frame'));
    assert.equal(upgraded, true);
  });
  await t.test('a CDP acknowledgement may arrive well beyond the former 30-second budget', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const socket = new Socket(), connection = acknowledgedConnection(socket);
    let settled = false;
    const response = connection.send('Runtime.evaluate', { awaitPromise: true }).then(value => { settled = true; return value; });
    t.mock.timers.tick(3600000);
    await Promise.resolve();
    assert.equal(settled, false);
    socket.reply(socket.requests[0], { result: { value: 'acknowledged' } });
    assert.deepEqual(await response, { result: { value: 'acknowledged' } });
    assert.deepEqual(connection.pending(), []);
    connection.close();
  });
  await t.test('Chrome readiness uses a complete stderr endpoint event after any scheduling delay', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const child = childProcess(), readiness = chromeEndpoint(child);
    t.mock.timers.tick(3600000);
    child.stderr.write('DevTools listening on ws://127.0.0.1:');
    child.stderr.write('8947/devtools/browser/synthetic\n');
    assert.equal(await readiness, 'ws://127.0.0.1:8947/devtools/browser/synthetic');
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
  });
  await t.test('startup exit and an unsafe endpoint are actual failures', async () => {
    const child = childProcess(), readiness = chromeEndpoint(child);
    child.emit('exit', 17, null);
    await assert.rejects(readiness, /exited before readiness \(17\)/);
    const other = childProcess(), unsafe = chromeEndpoint(other);
    other.stderr.write('DevTools listening on ws://example.invalid:8947/devtools/browser/synthetic\n');
    await assert.rejects(unsafe, /Unsafe/);
  });
  await t.test('graceful shutdown waits for actual exit and stdio closure without timed escalation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const child = childProcess();
    child.kill = () => assert.fail('No elapsed-time termination');
    let socket;
    class BrowserSocket extends Socket {
      constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(bytes) { super.send(bytes); this.reply(this.requests.at(-1)); }
    }
    const browser = await openAcknowledgedChrome('synthetic-chrome', 'C:/synthetic-profile', {}, {
      spawn: () => { queueMicrotask(() => child.stderr.write('DevTools listening on ws://127.0.0.1:8947/devtools/browser/synthetic\n')); return child; },
      WebSocket: BrowserSocket,
    });
    let finished = false;
    const closing = browser.close().then(() => { finished = true; });
    await Promise.resolve(); t.mock.timers.tick(3600000); await Promise.resolve();
    assert.equal(socket.requests.at(-1).method, 'Browser.close');
    assert.equal(finished, false);
    child.exitCode = 0; child.emit('exit', 0, null);
    await Promise.resolve(); assert.equal(finished, false, 'inherited streams still own process handles');
    child.emit('close', 0, null);
    await closing; assert.equal(finished, true);
  });
  await t.test('an outer abort during final exit stops the owned Chrome handle and reports its state', async () => {
    const child = Object.assign(childProcess(), { pid: 424242, killed: false });
    const controller = new AbortController(), signals = [], reports = [];
    child.kill = signal => {
      signals.push(signal); child.killed = true;
      queueMicrotask(() => {
        child.signalCode = signal; child.emit('exit', null, signal); child.emit('close', null, signal);
      });
      return true;
    };
    class BrowserSocket extends Socket {
      constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(bytes) { super.send(bytes); this.reply(this.requests.at(-1)); }
    }
    const browser = await openAcknowledgedChrome('synthetic-chrome', 'C:/synthetic-profile', {
      signal: controller.signal, report: state => reports.push(state),
    }, {
      spawn: () => { queueMicrotask(() => child.stderr.write('DevTools listening on ws://127.0.0.1:8947/devtools/browser/synthetic\n')); return child; },
      WebSocket: BrowserSocket,
    });
    const closing = browser.close();
    assert.equal(browser.diagnostics().phase, 'Chrome process exit');
    assert.equal(browser.diagnostics().handle.exitObserved, false);
    controller.abort();
    await closing;
    assert.deepEqual(signals, ['SIGKILL']);
    assert.equal(reports[0].pid, 424242);
    assert.equal(reports[0].handle.exitObserved, false);
    assert.deepEqual(browser.diagnostics().handle, {
      exitCode: null, signalCode: 'SIGKILL', killed: true, exitObserved: true, stdioClosed: true,
    });
  });
  await t.test('socket failure and the one outer abort reject pending acknowledgements', async () => {
    const socket = new Socket(), controller = new AbortController();
    const connection = acknowledgedConnection(socket, { signal: controller.signal });
    const pending = connection.send('Runtime.evaluate');
    controller.abort();
    await assert.rejects(pending, /Outer browser-file hang guard/);
    assert.deepEqual(connection.pending(), []);
    const other = new Socket(), transport = acknowledgedConnection(other);
    const lost = transport.send('Page.navigate'); other.close();
    await assert.rejects(lost, /socket closed/);
  });
  await t.test('Chrome exit is sufficient when Browser.close never replies', async () => {
    const child = childProcess();
    class BrowserSocket extends Socket {
      constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(bytes) {
        super.send(bytes);
        assert.equal(this.requests.at(-1).method, 'Browser.close');
        queueMicrotask(() => { this.close(); child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null); });
      }
    }
    const browser = await openAcknowledgedChrome('synthetic-chrome', 'C:/synthetic-profile', {}, {
      spawn: () => { queueMicrotask(() => child.stderr.write('DevTools listening on ws://127.0.0.1:8947/devtools/browser/synthetic\n')); return child; },
      WebSocket: BrowserSocket,
    });
    await browser.close();
    assert.equal(child.listenerCount('exit'), 0);
  });
  await t.test('cleanup survives more than five transient sharing failures and acknowledges removal', async () => {
    let attempts = 0;
    await removeScratch('synthetic-owned-scratch', { remove: async () => {
      if (++attempts <= 8) throw Object.assign(new Error('Synthetic sharing violation'), { code: 'EPERM' });
    } });
    assert.equal(attempts, 9);
    const controller = new AbortController(), reports = [];
    await removeScratch('synthetic-busy-scratch', { signal: controller.signal, report: state => reports.push(state), remove: async () => {
      controller.abort();
      throw Object.assign(new Error('Synthetic sharing violation'), { code: 'EBUSY' });
    } });
    assert.deepEqual(reports, [{ pendingCleanup: 'synthetic-busy-scratch', code: 'EBUSY' }, { retainedScratch: 'synthetic-busy-scratch' }]);
    await assert.rejects(removeScratch('synthetic-owned-scratch', { remove: async () => {
      throw Object.assign(new Error('Broken filesystem'), { code: 'EIO' });
    } }), /Broken filesystem/);
  });
});
