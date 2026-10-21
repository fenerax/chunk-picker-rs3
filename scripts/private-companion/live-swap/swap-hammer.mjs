// Real core HTTP/store/client continuous workload; synthetic history/calculator.
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { SwapController } from './controller.mjs';
import { connectFrontDoor } from './front-door.mjs';
import { atomicJSON } from './journal.mjs';
import { createRuntimeDiagnostics } from './fixture-diagnostics.mjs';
import os from 'node:os';

if (process.env.BRIDGECORE_FAULT_HAMMER_ADMITTED !== '1') throw new Error('Use resource/activity admitted Test-Bridgecore.ps1 -Mode success');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
if (!args.includes('--core')) throw new Error('--core required');
const core = path.resolve(option('--core')), repeats = Number(option('--repeats', '6')), historyRows = Number(option('--history-rows', '420'));
if (!Number.isInteger(repeats) || repeats < 2 || repeats > 1000 || !Number.isInteger(historyRows) || historyRows < 0 || historyRows > 10000) throw new Error('Invalid workload bounds');
const root = path.join((process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(), 'rs3-live-swap-tests')), 'operator-success'); await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, 'run-')), dataDir = path.join(directory, 'data'); await mkdir(dataDir);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RS3_') && !['NODE_OPTIONS', 'NODE_PATH'].includes(key))); env.RS3_DATASET = 'open-f2p';
const processes = new Set();
function launch(file, config) {
  const child = fork(new URL(file, import.meta.url), [config], { windowsHide: true, env, execArgv: ['--max-old-space-size=192'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); processes.add(child);
  let diagnostic = ''; child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-4000); });
  const exited = once(child, 'exit'); child.once('exit', () => processes.delete(child)); let serial = 0; const pending = new Map();
  child.on('error', () => {});
  child.on('message', message => { const call = pending.get(message.id); if (call) { pending.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(Object.assign(new Error(message.error), { code: message.error })) : call.resolve(message.value); } });
  child.once('exit', () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Owned process exited')); } pending.clear(); });
  return { child, exited,
    boot: () => new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`Boot deadline: ${diagnostic}`)), 15000); child.on('message', message => { if (message.booted) { clearTimeout(timeout); resolve(); } }); exited.then(() => { clearTimeout(timeout); reject(new Error(`Boot failed: ${diagnostic}`)); }); }),
    rpc: (method, argument) => new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC deadline ${method}: ${diagnostic}`)); }, 15000); pending.set(id, { resolve, reject, timer }); child.send({ id, method, argument }); }),
    async stop() { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } },
  };
}
async function freePorts() {
  const held = [], ports = [];
  try {
    for (let port = 18700; port <= 18799 && ports.length < 2; port++) {
      const server = net.createServer();
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); held.push(server); ports.push(port); } catch { server.close(); }
    }
    assert.equal(ports.length, 2); return ports;
  } finally { await Promise.all(held.map(server => new Promise(resolve => server.close(resolve)))); }
}
const [portA, portB] = await freePorts(), suffix = randomUUID(), pipe = name => process.platform === 'win32' ? `\\\\.\\pipe\\bridgecore-success-${name}-${suffix}` : path.join(directory, `${name}.sock`);
const ingress = pipe('http'), control = pipe('control'), doorToken = randomUUID(); let token, doorProcess, door, old, next, monitoring = true, running = true, workload;
const operations = [], losses = [], errors = [], freezeDurations = [], ownerPids = new Set(); let samples = 0, zeroOwners = 0, retries = 0, frozenAt, phase = 'startup';
const timings = [];
const controllerDiagnostics = createRuntimeDiagnostics(), activationDiagnostics = [];
const freezeMaxSaveBytes = 2 * 1024 * 1024;
let freezeRequests = 0;
const sse = { clients: 2, connections: 0, initialEvents: 0, revisionEvents: 0, readyBeforeAttempts: 0, drainedPromotions: 0, serverClosures: 0 };
const sseSlots = [], sseConnections = new Set();
function openSse(version) {
  let request, response, resolveClosed, resolveReady, rejectReady, timeout, buffer = '', intentional = false, ended = false;
  const stream = { alive: false, ready: false, revision: false, version: false,
    closed: new Promise(resolve => { resolveClosed = resolve; }),
    initial: new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }),
    close() { intentional = true; response?.destroy(); request?.destroy(); finish(); },
  };
  function finish(error) {
    if (ended) return; ended = true; stream.alive = false; clearTimeout(timeout); sseConnections.delete(stream);
    if (!stream.ready) rejectReady(error ?? new Error('SSE closed before initial revision/version'));
    else if (!intentional) sse.serverClosures++;
    resolveClosed();
  }
  stream.initial.catch(() => {}); sseConnections.add(stream); sse.connections++;
  request = http.get({ socketPath: ingress, path: '/api/events', headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } }, received => {
    response = received;
    if (response.statusCode !== 200 || !response.headers['content-type']?.includes('text/event-stream')) { finish(new Error(`SSE status ${response.statusCode}`)); response.destroy(); return; }
    stream.alive = true; response.setEncoding('utf8');
    response.on('data', chunk => {
      try {
        buffer += chunk; assert.ok(buffer.length <= 64 * 1024, 'Bounded SSE frame buffer');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = frame.split('\n').find(line => line.startsWith('event: '))?.slice(7);
          const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6);
          if (event === 'revision') { assert.ok(Number.isSafeInteger(JSON.parse(data).revision)); stream.revision = true; sse.revisionEvents++; }
          if (event === 'version') { assert.equal(JSON.parse(data).version, version); stream.version = true; }
          if (!stream.ready && stream.revision && stream.version) { stream.ready = true; clearTimeout(timeout); sse.initialEvents += 2; resolveReady(); }
        }
      } catch (error) { errors.push(error.message); finish(error); response.destroy(); }
    });
    response.once('end', () => finish()); response.once('close', () => finish()); response.once('error', error => finish(error));
  });
  request.once('error', error => finish(error));
  timeout = setTimeout(() => { finish(new Error('SSE initial events deadline')); request.destroy(); }, 5000);
  return stream;
}
async function ensureSse(version) {
  await Promise.all(Array.from({ length: 2 }, async (_, index) => {
    if (!sseSlots[index]?.alive) sseSlots[index] = openSse(version);
    await sseSlots[index].initial; assert.equal(sseSlots[index].alive, true);
  }));
  assert.equal(sseSlots.filter(stream => stream.alive && stream.ready).length, 2);
}
async function assertSseDrained(streams) {
  let timer;
  try { await Promise.race([Promise.all(streams.map(stream => stream.closed)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Promoted SSE streams were not drained')), 5000); })]); }
  finally { clearTimeout(timer); }
  assert.ok(streams.every(stream => !stream.alive)); sse.drainedPromotions++;
}
const admissionWindows = [];
let deferredSwaps = 0;
const abort = new AbortController();
function request(route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: ingress, path: route, method: options.method ?? 'GET', headers: { Authorization: `Bearer ${token}`, ...options.headers } }, response => {
      let bytes = ''; response.setEncoding('utf8'); response.on('data', data => { bytes += data; }); response.on('end', () => resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
        json: async () => JSON.parse(bytes), arrayBuffer: async () => Buffer.from(bytes) })); response.once('error', reject);
    });
    req.setTimeout(7000, () => req.destroy(new Error('HTTP timeout'))); req.once('error', reject); req.end(options.body);
  });
}
const post = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const actionId = (session, sequence) => session.scope ? `v3.${session.scope}.${session.slot}.${session.generation}.${sequence}` : `v2.${session.slot}.${session.generation}.${sequence}`;
async function backend(name, port) {
  const identity = { release: name, version: `fixture-${name}`, port }, file = path.join(directory, `${name}.json`), nonce = randomUUID();
  await atomicJSON(file, { synthetic: true, core, dataDir, port, version: identity.version, nonce, historyRows, freezeMaxSaveBytes }); const owned = launch('./fixture-worker.mjs', file); await owned.boot(); ownerPids.add(owned.child.pid);
  return { identity, owned,
    observe: () => owned.rpc('observe'), standby: () => owned.rpc('start', { standby: true }),
    freeze: argument => { assert.ok(argument.maxSaveBytes === undefined || argument.maxSaveBytes === freezeMaxSaveBytes); freezeRequests++; return owned.rpc('freeze', { ...argument, maxSaveBytes: freezeMaxSaveBytes }); },
    close: () => owned.rpc('close'), activate: checkpoint => controllerDiagnostics.capture('activateRPC', () => owned.rpc('activate', checkpoint), { release: name, childPid: owned.child.pid }),
    async verify() { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 200); return response.json(); },
  };
}
let observer;
try {
  old = await backend('a', portA); next = await backend('b', portB); await old.owned.rpc('start', { standby: false }); token = (await readFile(path.join(dataDir, 'access-token'), 'utf8')).trim();
  const doorConfig = path.join(directory, 'door-config.json'); await atomicJSON(doorConfig, { listen: ingress, control, stateFile: path.join(directory, 'door-state.json'), token: doorToken, backendToken: token });
  doorProcess = launch('./fixture-door.mjs', doorConfig); await doorProcess.boot(); door = await connectFrontDoor(control, doorToken); await door.route(old.identity); await door.resume(old.identity);
  observer = (async () => {
    let wasFrozen = false;
    while (monitoring) {
      try {
        const lock = JSON.parse(await readFile(path.join(dataDir, 'store.lock'), 'utf8')); assert.ok(ownerPids.has(lock.pid), 'Unknown store owner'); samples++;
      } catch (error) { if (error.code === 'ENOENT') { zeroOwners++; samples++; } else errors.push(error.message); }
      try {
        const state = JSON.parse(await readFile(path.join(directory, 'door-state.json'), 'utf8'));
        if (state.frozen && !wasFrozen) frozenAt = performance.now();
        wasFrozen = state.frozen;
      } catch (error) { errors.push(error.message); }
      await sleep(2);
    }
  })();
  // Fill31 independent unacknowledged session slots. The active client uses slot32;
  // the bounded ledger remains full throughout every forward/reverse swap.
  let state = (await (await request('/api/state')).json()).state;
  for (let index = 0; index < 31; index++) {
    const sessionResponse = await post('/api/action-session', { clientId: randomUUID() }); assert.equal(sessionResponse.status, 200); const session = await sessionResponse.json();
    const response = await post('/api/command', { requestId: actionId(session, 1), requestAck: 0, expectedRevision: state.revision,
      command: { type: 'set-note', memberId: 'two', chunkId: '12597', note: `Synthetic dormant receipt ${index}` } }); assert.equal(response.status, 200, JSON.stringify(await response.json())); state = (await response.json()).state;
  }
  const seed = await post('/api/command', { expectedRevision: state.revision, command: { type: 'add-task', task: { id: 'custom:hammer', label: 'Synthetic tick', category: 'Custom' } } }); assert.equal(seed.status, 200); state = (await seed.json()).state;
  const initialRevision = state.revision, initialBytes = (await stat(path.join(dataDir, 'state.json'))).size;
  if (historyRows >= 420) assert.ok(initialBytes >= 611937, 'Synthetic live-like save must be at least recorded live metadata byte size');
  const { createLiveSwapCommandClient } = await import(pathToFileURL(path.join(core, 'app/web/live-swap-client.mjs')));
  const values = new Map(), attempts = new Map(), receipts = [];
  let dropNext = true, revision = state.revision;
  const client = createLiveSwapCommandClient({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, acquireSession: () => () => {},
    sleep: () => sleep(10), onRetry: () => { retries++; }, fetch: async (route, options) => {
      const pathname = route.split('?')[0];
      if (pathname === '/api/command') { const id = JSON.parse(options.body).requestId; const previous = attempts.get(id); if (previous !== undefined) assert.equal(options.body, previous, 'Every transport replay preserves exact request bytes'); attempts.set(id, options.body); }
      const response = await request(route, options);
      if (pathname === '/api/command' && response.ok && dropNext) { dropNext = false; const value = await response.json(); losses.push({ requestId: value.receipt.requestId, revision: value.receipt.revision, outcome: value.receipt.outcome, phase }); throw new Error('Deliberate lost postcommit response'); }
      return response;
    },
  });
  workload = (async () => {
    while (running) {
      const index = operations.length, command = index % 4 === 0 ? { type: 'roll', memberId: 'one', count: 2 }
        : index % 4 === 1 ? { type: 'cancel-roll', memberId: 'one' }
          : index % 4 === 2 ? { type: 'set-task-status', memberId: 'two', taskId: 'custom:hammer', challengeCompleted: index % 8 === 2 }
            : { type: 'set-note', memberId: 'one', chunkId: '12341', note: `Synthetic active edit ${index}` };
      const result = await client.send({ expectedRevision: revision, command }, { signal: abort.signal }); assert.equal(result.response.status, 200, JSON.stringify(result.value));
      assert.equal(result.value.state.revision, revision + 1); assert.equal(result.value.receipt.revision, revision + 1); assert.equal(result.value.receipt.outcome.type, command.type);
      revision++; operations.push(command); receipts.push(result.value.receipt); await sleep(8);
    }
  })(); workload.catch(() => {});
  async function waitActions(count) {
    const deadline = Date.now() + 20000;
    while (operations.length < count) { if (Date.now() > deadline) throw new Error('Action workload stalled'); await Promise.race([workload, sleep(10)]); }
  }
  await waitActions(8);
  let held = false;
  const managed = { acquire: async () => { assert.equal(held, false); held = true; return async () => { held = false; }; }, assertHeld: async () => assert.equal(held, true),
    pause: async () => atomicJSON(path.join(directory, 'pause.json'), { paused: true }), unpause: async () => atomicJSON(path.join(directory, 'pause.json'), { paused: false }),
    assertStoreReleased: async () => { for (const instance of [old, next]) { const observation = await instance.observe(); assert.ok(observation.state === 'stopped' || observation.standby); } },
    commit: async identity => atomicJSON(path.join(directory, 'pointer.json'), identity),
  };
  for (let index = 0; index < repeats; index++) {
    await ensureSse(old.identity.version); sse.readyBeforeAttempts++;
    const priorStreams = [...sseSlots];
    const before = operations.length;
    const controller = new SwapController({ journal: path.join(directory, 'journal.json'), dataDir, old, next, frontDoor: door, managed, policy: { mode: 'verification' },
      onPhase: async name => { phase = name; if (name === 'committed') dropNext = true; },
    });
    const swap = await controller.swap(); const actualDoor = await door.status(); assert.equal(actualDoor.frozen, false);
    admissionWindows.push({ kind: swap.deferred ? 'deferred' : 'promotion', freezeMs: actualDoor.lastFreezeMs });
    if (swap.deferred) { deferredSwaps++; assert.ok(deferredSwaps < 50, 'Too many deferred attempts'); index--; await sleep(20); continue; }
    freezeDurations.push(actualDoor.lastFreezeMs);
    timings.push(swap.timings);
    await assertSseDrained(priorStreams);
    // Retrieve observations after admission; no diagnostic RPC prolongs freeze.
    activationDiagnostics.push({ release: next.identity.release, ...await next.owned.rpc('diagnostics') });
    [old, next] = [next, old]; phase = 'active'; await ensureSse(old.identity.version); await waitActions(before + 8);
  }
  await waitActions(operations.length + 8); running = false; await workload;
  const final = (await (await request('/api/state')).json()).state, document = JSON.parse(await readFile(path.join(dataDir, 'state.json')));
  assert.equal(final.revision, initialRevision + operations.length); assert.equal(document.state.revision, final.revision);
  const history = document.state.history.filter(event => event.revision > initialRevision);
  assert.deepEqual(history.map(event => event.revision), operations.map((_operation, index) => initialRevision + index + 1));
  assert.deepEqual(history.map(event => event.type), operations.map(operation => operation.type));
  for (const loss of losses) { const confirmed = receipts.find(receipt => receipt.requestId === loss.requestId); assert.deepEqual(confirmed, { requestId: loss.requestId, revision: loss.revision, outcome: loss.outcome }); }
  for (const receipt of receipts.filter(row => row.outcome.type === 'roll')) { const event = history.find(event => event.revision === receipt.revision); assert.deepEqual(receipt.outcome.rolled, event.command.rolled); }
  assert.equal(document.actionReceipts.slots.length, 32); assert.equal(new Set(receipts.map(receipt => receipt.requestId)).size, operations.length);
  assert.ok(losses.length >= repeats + 1); assert.equal(client.pending(), null); assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(sse.readyBeforeAttempts, freezeRequests); assert.equal(sse.drainedPromotions, repeats); assert.equal(sseSlots.filter(stream => stream.alive).length, 2);
  monitoring = false; await observer; const sorted = freezeDurations.toSorted((a, b) => a - b), allSorted = admissionWindows.map(window => window.freezeMs).toSorted((a, b) => a - b);
  const result = { measuredAt: new Date().toISOString(), synthetic: true, qualification: 'diagnostic-synthetic-only', automaticPromotionQualified: false, fixture: 'real HTTP/store/client with synthetic history and tiny calculator', core, freezeMaxSaveBytes, freezeRequests, sse,
    diagnostics: { testOnly: true, childMaxOldSpaceMiB: 192, controller: controllerDiagnostics.snapshot(), backends: activationDiagnostics },
    swaps: repeats, deferredSwaps, initialBytes, historyRows, retainedReceiptSlots: 32, actions: operations.length, initialRevision, finalRevision: final.revision,
    types: Object.fromEntries(['roll', 'cancel-roll', 'set-task-status', 'set-note'].map(type => [type, operations.filter(operation => operation.type === type).length])),
    lostPostcommitResponses: losses.length, exactReplays: losses.length, retries, lockSamples: samples, zeroOwnerSamples: zeroOwners,
    freezeMs: { definition: 'all client-visible promotion and deferred windows, persistent door clock: actual closure through actual reopen; bootstrap excluded', samples: allSorted.length, p50: allSorted[Math.floor(allSorted.length / 2)] ?? null, max: allSorted.at(-1) ?? null },
    promotionFreezeMs: { samples: sorted.length, p50: sorted[Math.floor(sorted.length / 2)] ?? null, max: sorted.at(-1) ?? null }, admissionWindows, timings, tcpServerLimit: 2 };
  await atomicJSON(path.join(root, 'latest-results.json'), result); console.log(JSON.stringify(result));
} finally {
  controllerDiagnostics.close(); running = false; monitoring = false; abort.abort(); const streams = [...sseConnections]; for (const stream of streams) stream.close(); await Promise.all(streams.map(stream => stream.closed)); await observer?.catch(() => {}); door?.disconnect();
  for (const child of processes) child.kill('SIGKILL'); await Promise.all([...processes].map(child => once(child, 'exit').catch(() => {})));
  await workload?.catch(() => {}); await rm(directory, { recursive: true, force: true });
}
