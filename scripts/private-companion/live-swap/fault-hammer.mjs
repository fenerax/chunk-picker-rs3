import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { atomicJSON, latestCheckpoint } from './journal.mjs';
import os from 'node:os';

if (process.env.BRIDGECORE_FAULT_HAMMER_ADMITTED !== '1') throw new Error('Run through Invoke-BridgeCoreFaultHammer.ps1 and the required activity/resource admission.');
const args = process.argv.slice(2), option = (key, fallback) => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1]; };
const core = path.resolve(option('--core', '')), phaseOption = option('--phase', 'all'), faultOption = option('--fault', 'all');
if (!args.includes('--core')) throw new Error('--core is required');
const supportedPhases = ['prepared', 'standby-intent', 'freeze-intent', 'frozen', 'release-intent', 'released', 'activate-intent', 'after-activate', 'acquired', 'commit-intent', 'after-commit', 'committed', 'after-resume', 'admitted', 'recovery-stopping', 'recovery-released', 'recovery-after-activate', 'recovery-acquired', 'recovery-after-commit', 'recovery-committed', 'recovery-after-resume'];
const phases = phaseOption === 'all' ? supportedPhases : [phaseOption];
const faults = faultOption === 'all' ? ['controller', 'old', 'next', 'reboot'] : [faultOption];
if (phases.some(value => !supportedPhases.includes(value)) || faults.some(value => !['controller', 'old', 'next', 'reboot'].includes(value))) throw new Error('Unknown fault/phase');
const repeats = Number(option('--repeats', '2')), receiptRounds = Number(option('--receipts', '4'));
const historyRows = Number(option('--history-rows', '420'));
if (![repeats, receiptRounds].every(value => Number.isInteger(value) && value >= 1 && value <= 1000)) throw new Error('Invalid repetition count');
if (!Number.isInteger(historyRows) || historyRows < 0 || historyRows > 10000) throw new Error('Invalid history shape');
const base = path.join((process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(), 'rs3-live-swap-tests')), 'operator-process'); await mkdir(base, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RS3_') && !['NODE_OPTIONS', 'NODE_PATH'].includes(key))); env.RS3_DATASET = 'open-f2p';
const children = new Set(); let total = 0;
const freezeMaxSaveBytes = 2 * 1024 * 1024;
const actionId = (session, sequence) => session.scope ? `v3.${session.scope}.${session.slot}.${session.generation}.${sequence}` : `v2.${session.slot}.${session.generation}.${sequence}`;
function launch(file, configFile) {
  const child = fork(new URL(file, import.meta.url), [configFile], { windowsHide: true, env, execArgv: ['--max-old-space-size=192'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child); let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data).slice(-3000); });
  const exited = once(child, 'exit'); child.once('exit', () => children.delete(child));
  let serial = 0; const pending = new Map();
  child.on('message', message => { const call = pending.get(message.id); if (call) { pending.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(new Error(message.error)) : call.resolve(message.value); } });
  child.once('exit', () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Owned fixture exited')); } pending.clear(); });
  child.on('error', () => {});
  return { child, exited, get alive() { return child.exitCode === null && child.signalCode === null; },
    boot: () => new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`Fixture boot deadline ${stderr}`)), 12000); const listener = message => { if (message.booted) { clearTimeout(timeout); child.off('message', listener); resolve(message); } }; child.on('message', listener); exited.then(() => { clearTimeout(timeout); reject(new Error(`Fixture boot failed ${stderr}`)); }); }),
    rpc: (method, argument) => new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC deadline ${method}: ${stderr}`)); }, 12000); pending.set(id, { resolve, reject, timer }); child.send({ id, method, argument }); }),
    async kill() { if (this.alive) { child.kill('SIGKILL'); await exited; } },
  };
}
async function freePorts() {
  const selected = [], reservations = [];
  try {
    for (let port = 18700; port <= 18799 && selected.length < 2; port++) {
      const server = net.createServer();
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); selected.push(port); reservations.push(server); }
      catch { server.close(); }
    }
    if (selected.length !== 2) throw new Error('Two free scratch ports unavailable');
    return selected;
  } finally { await Promise.all(reservations.map(server => new Promise(resolve => server.close(resolve)))); }
}
function request(socketPath, route, token, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : JSON.stringify(body);
    const request = http.request({ socketPath, path: route, method: bytes ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}) } }, response => {
      let data = ''; response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; }); response.on('end', () => { try { resolve({ status: response.statusCode, value: JSON.parse(data) }); } catch (error) { reject(error); } }); response.once('error', reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error('Fixture HTTP deadline'))); request.once('error', reject); request.end(bytes);
  });
}

async function runCase(phase, fault, iteration) {
  const directory = await mkdtemp(path.join(base, 'run-')), dataDir = path.join(directory, 'data'); await mkdir(dataDir);
  const [oldPort, nextPort] = await freePorts(), suffix = randomUUID();
  const pipe = name => process.platform === 'win32' ? `\\\\.\\pipe\\bridgecore-${name}-${suffix}` : path.join(directory, `${name}.sock`);
  const ingress = pipe('http'), control = pipe('control'), doorToken = randomUUID();
  let doorProcess, controllerProcess, held = false, token, injected = false, selected, latestPending, expectedCheckpoint, victimActive = false, freezeRequests = 0, lastObservedPhase = null;
  const journal = path.join(directory, 'journal.json'), pointer = path.join(directory, 'pointer.json'), pause = path.join(directory, 'pause.json');
  const backend = (name, port) => {
    const identity = { release: name, port, version: `fixture-${name}` }; let owned;
    const configFile = path.join(directory, `${name}.json`);
    return { identity,
      get process() { return owned; },
      async boot() { if (!owned?.alive) { await atomicJSON(configFile, { synthetic: true, core, dataDir, port, version: identity.version, nonce: randomUUID(), historyRows, freezeMaxSaveBytes }); owned = launch('./fixture-worker.mjs', configFile); await owned.boot(); } },
      async observe() { return owned?.alive ? owned.rpc('observe') : { state: 'dead' }; },
      async standby() { await this.boot(); await owned.rpc('start', { standby: true }); },
      async freeze(argument) { assert.ok(argument.maxSaveBytes === undefined || argument.maxSaveBytes === freezeMaxSaveBytes); freezeRequests++; return owned.rpc('freeze', { ...argument, maxSaveBytes: freezeMaxSaveBytes }); }, async close() { if (owned?.alive) await owned.rpc('close'); },
      async activate(checkpoint) { await this.boot(); await owned.rpc('activate', checkpoint); },
      async verify() { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 200); return response.json(); },
      async kill() { await owned?.kill(); },
    };
  };
  const old = backend('old', oldPort), next = backend('next', nextPort);
  async function doorStart() {
    const configFile = path.join(directory, 'door.json'); await atomicJSON(configFile, { listen: ingress, control, stateFile: path.join(directory, 'door-state.json'), token: doorToken, backendToken: token });
    doorProcess = launch('./fixture-door.mjs', configFile); await doorProcess.boot();
  }
  async function invariant() {
    const observations = await Promise.all([old.observe(), next.observe()]);
    const writers = observations.filter(value => value.state === 'owned' && !value.standby); assert.ok(writers.length <= 1, 'At most one owned writer');
    try { const lock = JSON.parse(await readFile(path.join(dataDir, 'store.lock'), 'utf8')); if (writers.length) assert.equal(lock.pid, writers[0].processIdentity.pid, 'Physical store.lock owner agrees'); }
    catch (error) { if (writers.length || error.code !== 'ENOENT') throw error; }
  }
  async function startController(operation, inject) {
    held = false;
    let injectionWork = Promise.resolve();
    const configFile = path.join(directory, `controller-${randomUUID()}.json`); await atomicJSON(configFile, { operation, journal, dataDir, old: old.identity, next: next.identity, control, token: doorToken });
    const processHandle = launch('./fixture-controller.mjs', configFile); controllerProcess = processHandle;
    const done = new Promise((resolve, reject) => {
      processHandle.child.on('message', message => { if (message.done) resolve(message); });
      processHandle.exited.then(() => { held = false; resolve({ killed: true }); });
      processHandle.child.on('message', async message => {
        if (!message.method) return;
        try {
          let value; const [group, method] = message.method.split('.');
          if (group === 'old' || group === 'next') value = await (group === 'old' ? old : next)[method](message.argument);
          else if (group === 'managed') {
            if (method === 'acquire') { assert.equal(held, false); held = true; }
            else if (method === 'release') held = false;
            else if (method === 'assertHeld') assert.equal(held, true);
            else if (method === 'pause') await atomicJSON(pause, { paused: true });
            else if (method === 'unpause') await atomicJSON(pause, { paused: false });
            else if (method === 'commit') { selected = message.argument; await atomicJSON(pointer, selected); }
            else if (method === 'assertStoreReleased') { for (const adapter of [old, next]) { const observation = await adapter.observe(); assert.ok(observation.state !== 'owned' || observation.standby); } }
            else throw new Error('Unknown managed hook');
          } else if (group === 'phase') {
            lastObservedPhase = message.argument.phase;
            await invariant();
            if (inject && !injected && message.argument.phase === phase) {
              injected = true;
              if (['after-resume', 'admitted', 'recovery-after-resume'].includes(phase)) {
                // A newer accepted action after cutover must survive recovery.
                const state = await request(ingress, '/api/state', token); assert.equal(state.status, 200);
                const parts = latestPending.requestId.split('.'), previousSequence = Number(parts.at(-1));
                latestPending = { requestId: `${parts.slice(0, -1).join('.')}.${previousSequence + 1}`, requestAck: previousSequence,
                  expectedRevision: state.value.state.revision, command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: 'Accepted after cutover before process death' } };
                const accepted = await request(ingress, '/api/command', token, latestPending); assert.equal(accepted.status, 200); expectedCheckpoint = await latestCheckpoint(dataDir);
              }
              if (fault === 'controller' || fault === 'reboot') {
                injectionWork = (async () => { await processHandle.kill(); if (fault === 'reboot') { await old.kill(); await next.kill(); await doorProcess.kill(); await doorStart(); } })();
                await injectionWork; return;
              }
              const victim = fault === 'old' ? old : next, observation = await victim.observe(); victimActive = observation.state === 'owned' && !observation.standby;
              await victim.kill();
            }
          } else throw new Error('Unknown supervisor RPC');
          if (processHandle.alive) processHandle.child.send({ id: message.id, value });
        } catch (error) { if (processHandle.alive) processHandle.child.send({ id: message.id, error: error.code ?? error.message }); }
      });
    });
    const deadline = setTimeout(() => { void processHandle.kill(); }, 25000);
    try { const result = await done; await injectionWork; return result; } finally { clearTimeout(deadline); }
  }
  try {
    await old.boot(); await next.boot(); await old.process.rpc('start', { standby: false }); token = (await readFile(path.join(dataDir, 'access-token'), 'utf8')).trim();
    await doorStart();
    // Bootstrap admission through the same separately owned control protocol.
    const { connectFrontDoor } = await import('./front-door.mjs'); const bootstrap = await connectFrontDoor(control, doorToken);
    await bootstrap.route(old.identity); await bootstrap.resume(old.identity);
    const session = await request(ingress, '/api/action-session', token, { clientId: randomUUID() }); assert.equal(session.status, 200);
    const allocated = session.value; let pending;
    for (let index = 0; index < receiptRounds; index++) {
      const state = await request(ingress, '/api/state', token);
      const sequence = allocated.sequence + index + 1;
      pending = { requestId: actionId(allocated, sequence), expectedRevision: state.value.state.revision, command: { type: 'set-rule', ruleId: 'access.shared', value: index % 2 === 0 }, ...(index ? { requestAck: sequence - 1 } : {}) };
      const committed = await request(ingress, '/api/command', token, pending); assert.equal(committed.status, 200, JSON.stringify(committed.value));
      const replay = await request(ingress, '/api/command', token, pending); assert.equal(replay.status, 200); assert.equal(replay.value.state.revision, committed.value.state.revision);
    }
    latestPending = pending; expectedCheckpoint = await latestCheckpoint(dataDir);
    bootstrap.disconnect(); await new Promise(resolve => setTimeout(resolve, 25));
    let outcome;
    if (phase.startsWith('recovery-')) {
      const initial = await startController('swap', false); assert.equal(initial.error, undefined, JSON.stringify({ phase, fault, iteration, stage: 'recovery-setup', initial })); await controllerProcess.kill(); await new Promise(resolve => setTimeout(resolve, 25));
      outcome = await startController('recover', true);
    } else outcome = await startController('swap', true);
    assert.equal(injected, true, `Fault reached ${phase}/${fault}: ${JSON.stringify({ phase, fault, iteration, lastObservedPhase, freezeRequests, outcome })}`);
    if (victimActive && ['old', 'next'].includes(fault) && ['after-resume', 'admitted', 'recovery-after-resume'].includes(phase)) {
      // Inspect the original backend-loss state BEFORE killing its controller.
      // The stable door's own monitor freezes a dead admitted backend.
      const deadline = Date.now() + 2000;
      let frozen = false;
      while (Date.now() < deadline) { if ((await request(ingress, '/api/health', token)).status === 503) { frozen = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.equal(frozen, true, 'Observed writer death freezes original ingress');
    }
    await controllerProcess.kill(); await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal((await request(ingress, '/api/health', token)).status, 503, 'Controller loss freezes actual ingress');
    const recovery = await startController('recover', false); assert.equal(recovery.error, undefined, JSON.stringify(recovery)); assert.ok(!recovery.killed);
    await invariant();
    const recovered = await request(ingress, '/api/state', token); assert.equal(recovered.status, 200); assert.equal(recovered.value.state.revision, expectedCheckpoint.revision);
    const replay = await request(ingress, '/api/command', token, latestPending); assert.equal(replay.status, 200, JSON.stringify(replay.value)); assert.equal(replay.value.state.revision, expectedCheckpoint.revision);
    assert.equal((await latestCheckpoint(dataDir)).sha256, expectedCheckpoint.sha256, 'Recovery and duplicate receipt replay preserve exact latest document');
    console.log(JSON.stringify({ phase, fault, iteration, result: 'passed', revision: expectedCheckpoint.revision, selected: selected.release, freezeMaxSaveBytes, freezeRequests, originalOutcome: outcome.error ?? (outcome.killed ? 'killed' : 'complete') })); total++;
  } finally {
    await controllerProcess?.kill(); await old.kill(); await next.kill(); await doorProcess?.kill();
    await rm(directory, { recursive: true, force: true });
  }
}
try {
  for (let iteration = 0; iteration < repeats; iteration++) for (const phase of phases) for (const fault of faults) await runCase(phase, fault, iteration);
  console.log(JSON.stringify({ passed: total, core, synthetic: true, tcpServerLimit: 2, ingress: 'named-pipe HTTP' }));
} finally {
  for (const child of children) child.kill('SIGKILL');
  await Promise.all([...children].map(child => once(child, 'exit').catch(() => {})));
}
