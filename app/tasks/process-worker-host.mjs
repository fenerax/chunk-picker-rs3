import { Worker, MessageChannel } from 'node:worker_threads';
import { encodeReceivedWorkerMessage, decodeReceivedProcessMessage } from './process-worker-transport.mjs';
import { createRelayCollector, envelopeBytes } from './relay-collector.mjs';
import { TASK_WORKER_RESOURCE_LIMITS } from './worker-limits.mjs';

let worker, stopping = false, failed = false, probeEnabled = false;
const cancellations = new Map();
const relay = createRelayCollector();
let cpuProfile, workerOnline;
const inspectorPost = (session, method) => new Promise((resolve, reject) => session.post(method, (error, value) => error ? reject(error) : resolve(value)));
let profileOperations = Promise.resolve();
function finishProfile(capture) {
  return capture.finished ??= (async () => {
    clearTimeout(capture.timer);
    // Stop both isolates immediately; a stalled native stop must not leave the
    // relay sampling while we wait. Retire if completion cannot be proven.
    const retirement = setTimeout(() => { void stop(1); }, 1000); retirement.unref();
    try {
      const [calculator, { profile: relay }] = await Promise.all([
        capture.handle.stop(), inspectorPost(capture.session, 'Profiler.stop'),
      ]);
      return { calculator, relay };
    } finally { clearTimeout(retirement); capture.session.disconnect(); }
  })();
}
async function profile(message) {
  try {
    if (!worker) throw new Error();
    if (message.operation === 'start') {
      if (cpuProfile || !Number.isFinite(message.deadline) || message.deadline <= Date.now()) throw new Error();
      // Bound capture locally even if the parent loses an acknowledgement or
      // never sends stop. A stalled start cannot postpone this watchdog.
      const capture = cpuProfile = {};
      capture.timer = setTimeout(() => {
        if (!capture.handle) { void stop(1); return; }
        void finishProfile(capture).catch(() => stop(1));
      }, Math.min(600000, message.deadline - Date.now()));
      capture.timer.unref();
      const { Session } = await import('node:inspector');
      capture.session = new Session(); capture.session.connect();
      await inspectorPost(capture.session, 'Profiler.enable'); await inspectorPost(capture.session, 'Profiler.start');
      await workerOnline;
      capture.handle = await worker.startCpuProfile();
      send({ kind: 'profile', id: message.id });
    } else {
      const capture = cpuProfile;
      if (!capture?.handle) throw new Error();
      const result = await finishProfile(capture); cpuProfile = undefined;
      send({ kind: 'profile', id: message.id, profile: result });
    }
  } catch {
    const capture = cpuProfile; cpuProfile = undefined;
    if (capture) {
      clearTimeout(capture.timer);
      if (capture.handle) try { await finishProfile(capture); } catch { void stop(1); return; }
      else {
        capture.session?.disconnect();
        // Exit, rather than an early failure acknowledgement, proves that an
        // uncertain native start can no longer be capturing.
        void stop(1); return;
      }
    }
    send({ kind: 'profile', id: message.id, error: true });
  }
}

function send(message) {
  if (!process.connected) return;
  try { process.send(message, error => { if (error) void stop(1); }); }
  catch { void stop(1); }
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true; cancellations.clear(); relay.close();
  // Parent also has a force-kill deadline; this covers orphan cleanup after a
  // parent crash or IPC disconnect.
  const deadline = setTimeout(() => process.exit(code || 1), 1500);
  try { await worker?.terminate(); } catch {}
  clearTimeout(deadline); process.exit(code);
}

function fail(error) {
  if (failed || stopping) return;
  failed = true;
  if (!process.connected) { void stop(1); return; }
  const deadline = setTimeout(() => { void stop(1); }, 500);
  try { process.send({ kind: 'error', error: { name: error.name, message: error.message, stack: error.stack } }, () => {
    clearTimeout(deadline); void stop(1);
  }); } catch { clearTimeout(deadline); void stop(1); }
}

async function memory(id) {
  let workers = [];
  if (worker && probeEnabled) {
    const { port1, port2 } = new MessageChannel();
    try {
      const sample = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker isolate memory probe timed out.')), 15000);
        port1.once('message', value => { clearTimeout(timer); resolve(value); });
        try { worker.postMessage({ type: 'cancel', id: -1, memoryPort: port2 }, [port2]); }
        catch (error) { clearTimeout(timer); reject(error); }
      });
      workers = [{ threadId: sample.threadId ?? worker.threadId, memoryUsage: sample.memoryUsage ?? sample }];
    } catch (error) { send({ kind: 'memory', id, error: error.message }); return; }
    finally { port1.close(); port2.close(); }
  }
  send({ kind: 'memory', id, pid: process.pid, main: process.memoryUsage(), workers });
}

process.on('message', message => {
  if (stopping) return;
  try {
    if (message.kind === 'profile') { profileOperations = profileOperations.then(() => profile(message)); return; }
    if (message.kind === 'terminate') { void stop(); return; }
    if (message.kind === 'memory-rss') {
      send({ kind: 'memory-rss', id: message.id, pid: process.pid, rssBytes: process.memoryUsage.rss() }); return;
    }
    if (message.kind === 'memory') { void memory(message.id); return; }
    if (message.kind === 'init') {
      if (worker) throw new Error('Task worker process was initialized twice.');
      const probeImport = message.probeImport ?? process.env.RS3_WORKER_MEMORY_PROBE_IMPORT;
      probeEnabled = !!probeImport;
      worker = new Worker(new URL('./worker.mjs', import.meta.url), {
        workerData: decodeReceivedProcessMessage(message.data), resourceLimits: TASK_WORKER_RESOURCE_LIMITS,
        // Diagnostic preloads need an explicit list. Native inheritance filters
        // process-only V8 flags; explicitly forwarding those flags rejects them.
        ...(probeEnabled ? { execArgv: ['--import', probeImport] } : {}),
      });
      workerOnline = new Promise(resolve => worker.once('online', resolve));
      worker.on('message', result => {
        if (result.id !== undefined && !['progress', 'prediction-prepared'].includes(result.type)) cancellations.delete(result.id);
        try { const payload = encodeReceivedWorkerMessage(result); send({ kind: 'message', payload }); relay.note(envelopeBytes(payload)); }
        catch (error) { fail(error); }
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
      worker.postMessage(request);
    }
  } catch (error) { fail(error); }
});
process.once('disconnect', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
