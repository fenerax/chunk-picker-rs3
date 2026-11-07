import { Worker, MessageChannel } from 'node:worker_threads';
import { encodeReceivedWorkerMessage, decodeReceivedProcessMessage } from './process-worker-transport.mjs';
import { createRelayCollector, envelopeBytes } from './relay-collector.mjs';
import { TASK_WORKER_RESOURCE_LIMITS } from './worker-limits.mjs';
import { createProcessProfiles } from './process-profiles.mjs';
import { eligibilityTransferList, releaseEligibilityChunk } from './eligibility-transfer.mjs';

// Production and controlled tests execute the same message/retirement controller.
// Defaults retain the real process, Worker, inspector and timers.
export function createProcessWorkerHost({ parent = process, WorkerClass = Worker,
  clock = { now: () => Date.now(), setTimeout: (...args) => setTimeout(...args),
    clearTimeout: timer => clearTimeout(timer), setInterval: (...args) => setInterval(...args) }, profileOptions = {} } = {}) {
  let worker, stopping = false, failed = false, probeEnabled = false;
  const cancellations = new Map();
  const relay = createRelayCollector();
  let profiles, profileRetiring = false, calculatorReady = false;
  const requests = new Set();
  let profileOperations = Promise.resolve();
  function retireProfileWhenIdle() {
    if (profileRetiring && calculatorReady && !requests.size) void stop();
  }
  function retireProfile() {
    if (profileRetiring) return;
    profileRetiring = true; send({ kind: 'profile-retiring' });
    retireProfileWhenIdle();
  }
  function restoreProfile() {
    profileRetiring = false; send({ kind: 'profile-cleaned' });
  }
  async function profile(message) {
    try {
      if (!profiles || profileRetiring) throw new Error();
      if (message.operation === 'start') {
        await profiles.start(message.deadline);
        if (!profileRetiring) send({ kind: 'profile', id: message.id });
      } else {
        const result = await profiles.stop();
        if (!profileRetiring) send({ kind: 'profile', id: message.id, profile: result });
      }
    } catch {
      send({ kind: 'profile', id: message.id, error: true });
    }
  }

  function send(message) {
    if (!parent.connected) return;
    try { parent.send(message, error => { if (error) void stop(1); }); }
    catch { void stop(1); }
  }

  async function stop(code = 0) {
    if (stopping) return;
    stopping = true; cancellations.clear(); relay.close();
    // Parent also has a force-kill deadline; this covers orphan cleanup after a
    // parent crash or IPC disconnect.
    const deadline = clock.setTimeout(() => parent.exit(code || 1), 1500);
    try { await worker?.terminate(); } catch {}
    clock.clearTimeout(deadline); parent.exit(code);
  }

  function fail(error) {
    if (failed || stopping) return;
    failed = true;
    if (!parent.connected) { void stop(1); return; }
    const deadline = clock.setTimeout(() => { void stop(1); }, 500);
    try { parent.send({ kind: 'error', error: { name: error.name, message: error.message, stack: error.stack, code: error.code } }, () => {
      clock.clearTimeout(deadline); void stop(1);
    }); } catch { clock.clearTimeout(deadline); void stop(1); }
  }

  async function memory(id) {
    let workers = [];
    if (worker && probeEnabled) {
      const { port1, port2 } = new MessageChannel();
      try {
        const sample = await new Promise((resolve, reject) => {
          const timer = clock.setTimeout(() => reject(new Error('Worker isolate memory probe timed out.')), 15000);
          port1.once('message', value => { clock.clearTimeout(timer); resolve(value); });
          try { worker.postMessage({ type: 'cancel', id: -1, memoryPort: port2 }, [port2]); }
          catch (error) { clock.clearTimeout(timer); reject(error); }
        });
        workers = [{ threadId: sample.threadId ?? worker.threadId, memoryUsage: sample.memoryUsage ?? sample }];
      } catch (error) { send({ kind: 'memory', id, error: error.message }); return; }
      finally { port1.close(); port2.close(); }
    }
    send({ kind: 'memory', id, pid: parent.pid, main: parent.memoryUsage(), workers });
  }

  parent.on('message', message => {
    if (stopping) return;
    try {
      if (message.kind === 'profile') {
        if (message.operation === 'cancel') {
          void profiles?.cancel().then(safe => { if (safe) { restoreProfile(); send({ kind: 'profile', id: message.id, error: true, cancelled: true }); } }).catch(retireProfile);
        } else profileOperations = profileOperations.then(() => profile(message));
        return;
      }
      if (message.kind === 'terminate') { void stop(); return; }
      if (message.kind === 'memory-rss') {
        send({ kind: 'memory-rss', id: message.id, pid: parent.pid, rssBytes: parent.memoryUsage.rss() }); return;
      }
      if (message.kind === 'memory') { void memory(message.id); return; }
      if (message.kind === 'init') {
        if (worker) throw new Error('Task worker process was initialized twice.');
        if (message.trackRss) {
          const report = () => send({ kind: 'memory-rss', rssBytes: parent.memoryUsage.rss() });
          report(); clock.setInterval(report, 100).unref();
        }
        const probeImport = message.probeImport ?? parent.env.RS3_WORKER_MEMORY_PROBE_IMPORT;
        probeEnabled = !!probeImport;
        worker = new WorkerClass(new URL('./worker.mjs', import.meta.url), {
          workerData: { ...decodeReceivedProcessMessage(message.data), enforceMemoryLimit: true }, resourceLimits: TASK_WORKER_RESOURCE_LIMITS,
          // Diagnostic preloads need an explicit list. Native inheritance filters
          // process-only V8 flags; explicitly forwarding those flags rejects them.
          ...(probeEnabled ? { execArgv: ['--import', probeImport] } : {}),
        });
        profiles = createProcessProfiles({ worker, online: new Promise(resolve => worker.once('online', resolve)), retire: retireProfile, restore: restoreProfile, clock, ...profileOptions });
        worker.on('message', result => {
          if (result.type === 'ready') calculatorReady = true;
          if (result.id !== undefined && !['progress', 'prediction-prepared'].includes(result.type)) { cancellations.delete(result.id); requests.delete(result.id); }
          try { const payload = encodeReceivedWorkerMessage(result); send({ kind: 'message', payload }); relay.note(envelopeBytes(payload)); }
          catch (error) { fail(error); }
          finally { releaseEligibilityChunk(result); }
          retireProfileWhenIdle();
        });
        worker.on('error', fail);
        worker.once('exit', code => { if (!stopping && !failed) void stop(code); });
        // The decoded definitions and world are garbage once the Worker owns them.
        relay.note(Infinity);
      } else if (message.kind === 'post') {
        if (!worker) throw new Error('Task worker process has not initialized.');
        const request = decodeReceivedProcessMessage(message.payload);
        relay.note(envelopeBytes(message.payload));
        if (request.type === 'cancel') {
          const cancellation = cancellations.get(request.id);
          if (cancellation) Atomics.store(new Int32Array(cancellation), 0, 1);
        } else if (request.cancellation instanceof SharedArrayBuffer) cancellations.set(request.id, request.cancellation);
        if (request.id !== undefined && !['cancel', 'supersede'].includes(request.type)) requests.add(request.id);
        worker.postMessage(request, eligibilityTransferList(request));
      }
    } catch (error) { fail(error); }
  });
  parent.once('disconnect', () => { void stop(); });
  parent.once('SIGTERM', () => { void stop(); });
}
