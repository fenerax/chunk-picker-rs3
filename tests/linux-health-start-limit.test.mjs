// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { healthRecovery, systemd } from '../scripts/linux/operator.mjs';

async function fixture(t) {
  const controlDir = await mkdtemp(path.join(tmpdir(), 'health-start-limit-'));
  t.after(() => rm(controlDir, { recursive: true, force: true }));
  const events = [];
  let state = { active: true, stopped: false, activeForMs: 600000, invocationId: 'synthetic-first', restarts: '0', result: 'success', mainStartedAt: '12345', mainExitSucceeded: true };
  const controller = { state: async () => ({ ...state }),
    stop: async () => { events.push('stop'); state = { ...state, active: false, stopped: true }; },
    start: async () => { events.push('start'); } };
  return { settings: { controlDir }, controller, events,
    request: async (_release, route) => { events.push(route); return { ready: false, savesReady: true }; },
    set: value => { state = { ...state, ...value }; } };
}

test('timer leaves inactive, failed, rate-limited and newly started writers alone', async t => {
  for (const state of [{ active: false }, { active: false, result: 'start-limit-hit' }, { activeForMs: 299999 }, { activeForMs: NaN }, { healthIdentityKnown: false }]) {
    const f = await fixture(t); f.set(state);
    assert.deepEqual(await healthRecovery({ ...f }), { skipped: true });
    assert.deepEqual(f.events, []);
  }
});

for (const boundary of [1, 3, 8]) for (const [reason, change] of [
  ['rate-limited', { active: false, result: 'start-limit-hit' }],
  ['failed', { active: false, result: 'exit-code' }],
  ['replaced', { invocationId: 'synthetic-replacement' }],
  ['restarted', { restarts: '1' }],
]) test(`writer ${reason} at recovery wait ${boundary}: no stop/start`, async t => {
  const f = await fixture(t); let waits = 0;
  const result = await healthRecovery({ ...f, wait: async () => { if (++waits === boundary) f.set(change); } });
  assert.deepEqual(result, { skipped: true });
  assert(!f.events.includes('stop')); assert(!f.events.includes('start'));
});

for (const marker of ['maintenance.json', 'tools-transaction.json', 'activation.json']) {
  test(`health preserves ${marker} and refuses recovery before requests`, async t => {
    const f = await fixture(t), file = path.join(f.settings.controlDir, marker);
    await writeFile(file, 'synthetic retained evidence');
    await assert.rejects(healthRecovery({ ...f }), /transaction evidence/);
    assert.equal(await readFile(file, 'utf8'), 'synthetic retained evidence');
    assert.deepEqual(f.events, []);
  });
  test(`health notices ${marker} arriving during a recovery wait`, async t => {
    const f = await fixture(t), file = path.join(f.settings.controlDir, marker);
    await assert.rejects(healthRecovery({ ...f, wait: () => writeFile(file, 'synthetic retained evidence') }), /transaction evidence/);
    assert(!f.events.includes('/api/worker-restart')); assert(!f.events.includes('stop')); assert(!f.events.includes('start'));
    assert.equal(await readFile(file, 'utf8'), 'synthetic retained evidence');
  });
}

test('incomplete service restore fences health without consuming evidence', async t => {
  const f = await fixture(t); f.settings.multiPicker = {};
  const directory = path.join(f.settings.controlDir, 'service-restore'); await mkdir(directory);
  await writeFile(path.join(directory, 'progress.json'), '{"phase":"restoring"}');
  await assert.rejects(healthRecovery({ ...f }), /incomplete/);
  assert.deepEqual(f.events, []);
});

test('failed drain result cannot be turned into a health auto-start', async t => {
  const f = await fixture(t);
  f.controller.stop = async () => { f.events.push('stop'); f.set({ active: false, stopped: true, result: 'exit-code' }); };
  await assert.rejects(healthRecovery({ ...f, wait: async () => {}, assertStopped: async () => {} }), /reconciliation/);
  assert(!f.events.includes('start'));
});

for (const change of [{ mainExitSucceeded: false }, { mainStartedAt: '67890' }]) test('cleared failed state cannot hide a crash or replacement during the stop race', async t => {
  const f = await fixture(t);
  f.controller.stop = async () => { f.events.push('stop'); f.set({ active: false, stopped: true, result: 'success', restarts: '0', ...change }); };
  await assert.rejects(healthRecovery({ ...f, wait: async () => {}, assertStopped: async () => {} }), /reconciliation/);
  assert(!f.events.includes('start'));
});

test('installed writer retains a finite crash budget, start gate and terminal failure alert', async () => {
  const writer = await readFile(new URL('../scripts/linux/systemd/chunk-picker.service', import.meta.url), 'utf8');
  assert.match(writer, /^StartLimitIntervalSec=300$/m); assert.match(writer, /^StartLimitBurst=3$/m);
  assert.match(writer, /^OnFailure=chunk-picker-notify@%n.service$/m);
  assert.match(writer, /^ExecStartPre=\+\/usr\/bin\/node .*\/start-check.mjs$/m);
  const health = await readFile(new URL('../scripts/linux/systemd/chunk-picker-health.service', import.meta.url), 'utf8');
  assert.doesNotMatch(health, /^(Requires|Wants|BindsTo)=.*chunk-picker.service/m);
  assert.match(health, /^OnFailure=chunk-picker-notify@%n.service$/m);
  const source = await readFile(new URL('../scripts/linux/operator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /command\(\['(?:reset-failed|restart)'\]/);
});

test('systemd adapter exposes crash identity and refuses health permits for failed or changed writers', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t), calls = [];
  f.settings.current = path.join(f.settings.controlDir, 'current.json');
  f.settings.service = 'synthetic-writer.service';
  await writeFile(f.settings.current, '{}');
  await writeFile(path.join(f.settings.controlDir, 'operation.lock'), JSON.stringify({ pid: process.pid }));
  let result = 'start-limit-hit', restarts = '3', activeState = 'failed', invocationId = 'synthetic-first', exitStatus = '0';
  const controller = systemd(f.settings, { executeCommand: async (binary, args) => {
    assert.equal(binary, 'systemctl'); calls.push(args[0]);
    if (args[0] === 'show') return { stdout: `ActiveState=${activeState}\nSubState=${activeState === 'failed' ? 'failed' : 'dead'}\nMainPID=0\nControlGroup=\nTasksCurrent=0\nResult=${result}\nNRestarts=${restarts}\nInvocationID=${invocationId}\nActiveEnterTimestampMonotonic=0\nExecMainStartTimestampMonotonic=12345\nExecMainCode=1\nExecMainStatus=${exitStatus}\n` };
    assert.equal(args[0], 'start');
    const permit = JSON.parse(await readFile(path.join(f.settings.controlDir, 'start-permit.json'), 'utf8'));
    assert(permit.expiresAt > Date.now()); return { stdout: '' };
  } });
  const state = await controller.state();
  assert.equal(state.result, result); assert.equal(state.invocationId, 'synthetic-first'); assert.equal(state.restarts, '3');
  await assert.rejects(controller.start(undefined, { health: true, restarts }), /successfully drained/);
  result = 'success'; restarts = '4';
  await assert.rejects(controller.start(undefined, { health: true, restarts: '3' }), /successfully drained/);
  assert(!calls.includes('start'));
  activeState = 'inactive'; invocationId = '';
  exitStatus = '1';
  await assert.rejects(controller.start(undefined, { health: true, restarts, mainStartedAt: '12345' }), /successfully drained/);
  exitStatus = '0';
  await assert.rejects(controller.start(undefined, { health: true, restarts, mainStartedAt: '67890' }), /successfully drained/);
  await controller.start(undefined, { health: true, restarts, mainStartedAt: '12345' });
  assert.equal(calls.filter(value => value === 'start').length, 1);
  await assert.rejects(readFile(path.join(f.settings.controlDir, 'start-permit.json')), { code: 'ENOENT' });
  await writeFile(path.join(f.settings.controlDir, 'maintenance.json'), 'synthetic evidence');
  await assert.rejects(controller.start(undefined, { health: true, restarts }), /transaction evidence/);
  assert.equal(calls.filter(value => value === 'start').length, 1); assert(!calls.includes('reset-failed'));
});
