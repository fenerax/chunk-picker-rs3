import { EventEmitter } from 'node:events';
import { createProcessWorkerHost } from '../../app/tasks/process-worker-host-runtime.mjs';
import { ProcessWorker } from '../../app/tasks/process-worker.mjs';
import { checkpoint, manualClock, profileControls } from './process-lifecycle.mjs';

export function adapterFixture(t, options = {}) {
  const child = new EventEmitter(), clock = manualClock(), sent = [], signals = [];
  child.pid = 123; child.connected = true;
  child.send = (message, callback) => { sent.push(message); child.emit('request-issued', message); callback?.(); };
  child.kill = signal => { signals.push(signal); child.emit('exit', null, signal); return true; };
  const worker = new ProcessWorker({}, { clock, forkProcess: () => child, ...options });
  t.after(() => worker.terminate({ force: true }));
  return { child, clock, sent, signals, worker, reply: message => child.emit('message', message) };
}

// A paired IPC endpoint executes the actual host dispatcher and adapter.
// Only the OS transport, isolate and inspector acknowledgements are controlled.
export function hostFixture(t, { drop = () => false } = {}) {
  const c = profileControls(), clock = manualClock(), child = new EventEmitter(), parent = new EventEmitter();
  const outbound = [], inbound = [], foreground = [], exits = [];
  let native;
  Object.assign(parent, { connected: true, env: {}, pid: 123, memoryUsage: process.memoryUsage,
    send(message, callback) { outbound.push(message); if (!drop(message)) queueMicrotask(() => child.emit('message', message)); callback?.(); },
    exit(code) { exits.push(code); queueMicrotask(() => child.emit('exit', code)); },
  });
  class ControlledWorker extends EventEmitter {
    constructor() { super(); native = this; }
    startCpuProfile() { return c.worker.startCpuProfile(); }
    postMessage(request) { foreground.push(request); }
    async terminate() { this.emit('exit', 0); }
  }
  createProcessWorkerHost({ parent, WorkerClass: ControlledWorker, clock,
    profileOptions: { openSession: c.openSession, stopTimeoutMs: 10 } });
  child.pid = 123; child.connected = true;
  child.send = (message, callback) => { inbound.push(message); parent.emit('message', message); callback?.(); };
  child.kill = () => { parent.exit(1); return true; };
  const worker = new ProcessWorker({}, { clock, forkProcess: () => child, profileTimeoutMs: 200 });
  t.after(async () => { await c.cleanup(); await worker.terminate({ force: true }); });
  native.emit('message', { type: 'ready', catalogue: ['synthetic'] });
  return {
    c, clock, child, parent, worker, outbound, inbound, foreground, exits,
    online() { native.emit('online'); },
    complete(id = 1) { native.emit('message', { type: 'result', id }); },
    async admit() { for (const name of ['open', 'enable', 'relay-start']) await c.ack(name); this.online(); await c.ack('native-start'); },
    async barrier() { await checkpoint(); },
  };
}
