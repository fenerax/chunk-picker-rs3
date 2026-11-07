import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProbe, cleanupProbeScratch } from '../scripts/private-companion/release-pack-check.mjs';

// Only a lost acknowledgement/process exit can reach this file-wide safety stop.
const safety = setTimeout(() => { console.error('Probe cleanup file stuck', process.getActiveResourcesInfo()); process.exitCode = 1; }, 600000);
safety.unref(); after(() => clearTimeout(safety));
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
test('real probe exits naturally with a descendant retaining stderr; the descendant stays alive', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'probe-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'report.json'); let endpoint;
  t.after(async () => { if (endpoint) { try { await fetch(endpoint + '/stop', { method: 'POST' }); } catch (error) { throw new Error('stop failed', { cause: error }); } } });
  const report = await runProbe(config, root, output, {
    spawnImpl: (_command, _args, options) => spawn(process.execPath,
      [fileURLToPath(new URL('./fixtures/probe-inherited-stderr.mjs', import.meta.url)), output], options),
  });
  endpoint = report.endpoint;
  assert.equal(await (await fetch(endpoint)).text(), 'alive');
});
