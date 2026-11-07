import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProbe, cleanupProbeScratch } from '../scripts/private-companion/release-pack-check.mjs';

const config = { nodePath: process.execPath, coreRoot: '.', packsDir: '.',
  selection: { path: '.' }, profile: { path: '.', sha256: 'synthetic' }, addons: { path: '.', sha256: 'synthetic' } };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const child = new EventEmitter(); child.pid = 123;
  const pipe = () => Object.assign(new EventEmitter(), { destroyed: false, destroy() { this.destroyed = true; } });
  child.stdout = pipe(); child.stderr = pipe(); child.unref = () => {};
  let kills = 0, reads = 0, settled = 'pending', value;
  child.kill = () => { kills++; return true; };
  const timers = new Map();
  const promise = runProbe(config, 'synthetic', 'report.json', {
    spawnImpl: () => child,
    setTimer: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id), readReport: async () => { reads++; return { passed: true }; }, ...options,
  });
  promise.then(result => { settled = 'resolved'; value = result; }, error => { settled = 'rejected'; value = error; });
  return { child, promise, timers, get kills() { return kills; }, get reads() { return reads; },
    get settled() { return settled; }, get value() { return value; },
    fire(ms) { const row = [...timers.values()].find(row => row.ms === ms); assert.ok(row, `timer ${ms} exists`); row.fn(); },
    disposed() { assert.ok(child.stdout.destroyed); assert.ok(child.stderr.destroyed); assert.equal(timers.size, 0); },
  };
}
test('zero exit reads the report after close or bounded stderr drain, and disposes both pipes', async () => {
  for (const close of [false, true]) {
    const f = fixture(); f.child.emit('exit', 0, null);
    assert.equal(f.reads, 0);
    if (close) f.child.emit('close', 0, null); else f.fire(25);
    assert.deepEqual(await f.promise, { passed: true }); f.disposed(); assert.equal(f.kills, 0);
    f.child.emit('error', new Error('late')); assert.equal(f.reads, 1);
  }
});
test('nonzero and signal failures retain late stderr and child result without reading a report', async () => {
  for (const [code, signal] of [[1, null], [null, 'SIGTERM']]) {
    const f = fixture(); f.child.emit('exit', code, signal); f.child.stderr.emit('data', Buffer.from('late detail'));
    f.fire(25); await assert.rejects(f.promise, error => error.childResult.stderrTail === 'late detail'
      && error.childResult.exitCode === code && error.childResult.signal === signal);
    f.disposed(); assert.equal(f.reads, 0);
  }
});
test('watchdog stops only its own handle and joins exit independently of inherited pipe EOF', async () => {
  const f = fixture(); f.fire(180000); assert.equal(f.kills, 1); assert.equal(f.settled, 'pending');
  f.child.emit('exit', null, 'SIGKILL');
  await assert.rejects(f.promise, error => /timed out/.test(error.message) && error.childResult.termination.joined);
  f.disposed(); assert.equal(f.reads, 0);
});
test('stderr redaction preserves matches across chunk boundaries', async () => {
  const f = fixture();
  for (const chunk of ['password=synthetic-', 'private-suffix\nhttps://example.invalid/', 'synthetic-private-path']) f.child.stderr.emit('data', Buffer.from(chunk));
  f.child.emit('exit', 1, null); f.fire(25);
  await assert.rejects(f.promise, error => {
    for (const text of [error.message, error.childResult.stderrTail]) {
      assert.ok(!text.includes('private-suffix')); assert.ok(!text.includes('synthetic-private-path'));
      assert.ok(text.includes('[credential redacted]')); assert.ok(text.includes('[address redacted]'));
    }
    return true;
  });
  f.disposed();
});
test('missing exit, refused kill and throwing kill settle once within the unchanged cleanup budget', async () => {
  for (const behaviour of ['accepted', 'refused', 'throws']) {
    const f = fixture(); const killError = new Error('kill failed'); let calls = 0;
    f.child.kill = () => { calls++; if (behaviour === 'throws') throw killError; return behaviour === 'accepted'; };
    f.fire(180000); f.fire(15000);
    await assert.rejects(f.promise, error => /timed out/.test(error.message) && error.cleanupFailure
      && error.childResult.termination.joined === false);
    f.disposed(); assert.equal(calls, 1);
    f.child.emit('close', 0, null); await turn(); assert.equal(f.settled, 'rejected'); assert.equal(f.reads, 0);
  }
});
test('spawn errors and abort preserve the original cause, including abort before spawn', async () => {
  const original = new Error('original spawn refusal');
  const thrown = fixture({ spawnImpl: () => { throw original; } });
  await assert.rejects(thrown.promise, error => error === original && error.childResult.pid === null);
  const asyncError = fixture(); asyncError.child.pid = undefined; asyncError.child.emit('error', original);
  await assert.rejects(asyncError.promise, error => error === original); asyncError.disposed();
  const controller = new AbortController(), cause = new Error('owner cancelled');
  const active = fixture({ signal: controller.signal }); controller.abort(cause); assert.equal(active.kills, 1);
  active.child.emit('exit', null, 'SIGKILL'); await assert.rejects(active.promise, error => error === cause); active.disposed();
  const before = fixture({ signal: controller.signal, spawnImpl: () => assert.fail('must not spawn') });
  await assert.rejects(before.promise, error => error === cause);
});
test('exit and abort ordering preserves the first outcome through event-driven drain', async () => {
  for (const code of [0, 7]) for (const abortFirst of [false, true]) {
    const controller = new AbortController(), cause = new Error('owner cancelled');
    const f = fixture({ signal: controller.signal });
    if (abortFirst) controller.abort(cause);
    f.child.emit('exit', code, null);
    if (!abortFirst) {
      controller.abort(cause);
      assert.equal(f.settled, 'pending');
      f.child.emit('close', code, null);
    }
    if (abortFirst) await assert.rejects(f.promise, error => error === cause && error.childResult.exitCode === code);
    else if (code === 0) assert.deepEqual(await f.promise, { passed: true });
    else await assert.rejects(f.promise, error => /refused/.test(error.message) && error !== cause
      && error.childResult.exitCode === 7 && error.childResult.secondaryNotes.includes(cause));
    f.disposed(); assert.equal(f.kills, abortFirst ? 1 : 0); assert.equal(f.reads, !abortFirst && code === 0 ? 1 : 0);
  }
});
test('kill error events remain secondary when the direct child subsequently acknowledges exit', async () => {
  const controller = new AbortController(), cause = new Error('owner cancelled');
  const f = fixture({ signal: controller.signal }), killError = Object.assign(new Error('kill refused'), { code: 'EPERM' });
  f.child.kill = () => { f.child.emit('error', killError); return false; };
  controller.abort(cause); f.child.emit('exit', 7, null);
  await assert.rejects(f.promise, error => error === cause && error.cleanupFailure.errors.includes(killError)
    && error.childResult.termination.joined && error.childResult.exitCode === 7);
  f.disposed();
});
test('cleanup exceptions cannot replace a probe failure or prevent disposal of the other pipe', async () => {
  const f = fixture(), cleanupError = new Error('pipe destroy failed');
  f.child.stdout.destroy = () => { throw cleanupError; };
  f.child.emit('exit', 7, null); f.fire(25);
  await assert.rejects(f.promise, error => /refused/.test(error.message)
    && error.cleanupFailure.errors.includes(cleanupError) && error.childResult.exitCode === 7);
  assert.ok(f.child.stderr.destroyed); assert.equal(f.settled, 'rejected');
  const primary = f.value;
  await cleanupProbeScratch('synthetic', primary, async (_root, options) => {
    assert.equal(options.maxRetries, 10); throw new Error('rm failed');
  });
  assert.equal(primary.childResult.exitCode, 7); assert.equal(primary.cleanupFailure.errors.length, 2);
  const unjoined = new Error('timeout'); unjoined.childResult = { termination: { joined: false } };
  await cleanupProbeScratch('synthetic', unjoined, () => assert.fail('must retain unjoined scratch'));
  assert.match(unjoined.cleanupFailure.errors[0].message, /retained/);
});
test('report read errors keep their original cause and the successful child result', async () => {
  const cause = new Error('bad report'), f = fixture({ readReport: async () => { throw cause; } });
  f.child.emit('close', 0, null);
  await assert.rejects(f.promise, error => error === cause && error.childResult.closeObserved); f.disposed();
});
test('real inherited-stderr descendant acknowledges teardown after probe success or report rejection', async t => {
  for (const rejectReport of [false, true]) await t.test(rejectReport ? 'report rejects' : 'probe succeeds', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'probe-cleanup-'));
    const output = path.join(root, 'report.json'), connections = [], drains = new Map();
    // This channel belongs to the fixture, independently of runProbe's report.
    // Closing admission also makes a late leaf refuse startup and exit itself.
    const control = createServer(socket => {
      let data = '', stopped = false;
      const closed = new Promise((resolve, reject) => {
        socket.on('data', bytes => {
          data += bytes;
          while (data.includes('\n')) {
            const index = data.indexOf('\n'), message = JSON.parse(data.slice(0, index)); data = data.slice(index + 1);
            if (message.stopped) stopped = true;
          }
        });
        socket.on('error', reject);
        socket.on('close', () => stopped ? resolve() : reject(new Error('Fixture stop acknowledgement missing.')));
      });
      closed.catch(() => {}); connections.push({ socket, closed });
    });
    t.after(async () => {
      try {
        const closed = new Promise((resolve, reject) => control.close(error => error ? reject(error) : resolve()));
        for (const { socket } of connections) socket.write('stop\n');
        await Promise.all([closed, ...connections.map(row => row.closed)]);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', resolve); });
    const refusal = new Error('synthetic report rejection');
    const promise = runProbe(config, root, output, {
      spawnImpl: (_command, _args, options) => spawn(process.execPath,
        [fileURLToPath(new URL('./fixtures/probe-inherited-stderr.mjs', import.meta.url)), output, String(control.address().port)], options),
      // Readiness and process exit drive completion. Production watchdog/cleanup
      // bounds are covered above with the same controlled clock, never wall time.
      setTimer: (fn, ms) => { const id = {}; if (ms === 25) drains.set(id, setImmediate(fn)); return id; },
      clearTimer: id => { clearImmediate(drains.get(id)); drains.delete(id); },
      ...(rejectReport ? { readReport: async () => { throw refusal; } } : {}),
    });
    if (rejectReport) await assert.rejects(promise, error => error === refusal && error.childResult.exitCode === 0);
    else {
      const report = await promise;
      assert.equal(await (await fetch(report.endpoint)).text(), 'alive');
    }
    assert.equal(connections.length, 1);
  });
});
