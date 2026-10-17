import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { encodeProcessMessage, decodeReceivedProcessMessage } from './process-worker-transport.mjs';

// A Worker-compatible endpoint whose entire allocator belongs to an owned
// process. Retirement resolves only once that process has actually exited.
export class ProcessWorker extends EventEmitter {
  #child;
  #exited = false;
  #stopping = false;
  #exitPromise;
  #resolveExit;
  #killTimers = [];
  #memory = new Map();
  #sequence = 0;
  #failed = false;

  constructor(workerData, { probeImport = process.env.RS3_WORKER_MEMORY_PROBE_IMPORT } = {}) {
    super();
    // Serialization failures must occur before a child is created.
    const data = encodeProcessMessage(workerData);
    this.#exitPromise = new Promise(resolve => { this.#resolveExit = resolve; });
    this.#child = fork(fileURLToPath(new URL('./process-worker-host.mjs', import.meta.url)), [], {
      serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    });
    this.#child.on('message', message => {
      try {
        if (message.kind === 'message') this.emit('message', decodeReceivedProcessMessage(message.payload));
        else if (message.kind === 'error') this.#fail(Object.assign(new Error(message.error.message), message.error));
        else if (message.kind === 'memory') {
          const request = this.#memory.get(message.id);
          if (request) {
            this.#memory.delete(message.id); clearTimeout(request.timer);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve({ pid: message.pid, main: message.main, workers: message.workers });
          }
        }
      } catch (error) { this.#fail(error); }
    });
    this.#child.on('error', error => this.#fail(error));
    this.#child.once('exit', (code, signal) => this.#finish(code ?? (signal ? 1 : 0)));
    // A spawn failure has a close event, but no exit event or OS process.
    this.#child.once('close', code => { if (!this.#child.pid) this.#finish(code ?? 1); });
    this.#child.once('disconnect', () => { if (!this.#exited && !this.#stopping) void this.terminate(); });
    this.#send({ kind: 'init', data, probeImport });
  }

  get pid() { return this.#child.pid; }

  #send(message) {
    if (this.#exited || this.#stopping && message.kind !== 'terminate') throw new Error('Task worker process has stopped.');
    try { this.#child.send(message, error => { if (error && !this.#stopping) this.#fail(error); }); }
    catch (error) { queueMicrotask(() => this.#fail(error)); }
  }

  #fail(error) {
    if (this.#failed || this.#exited || this.#stopping) return;
    this.#failed = true;
    void this.terminate();
    this.emit('error', error);
  }

  #finish(code) {
    if (this.#exited) return;
    this.#exited = true;
    for (const timer of this.#killTimers) clearTimeout(timer);
    for (const { reject, timer } of this.#memory.values()) {
      clearTimeout(timer); reject(new Error('Task worker process exited.'));
    }
    this.#memory.clear();
    this.#resolveExit(code);
    this.emit('exit', code);
  }

  postMessage(message) { this.#send({ kind: 'post', payload: encodeProcessMessage(message) }); }

  terminate() {
    if (this.#stopping || this.#exited) return this.#exitPromise;
    this.#stopping = true;
    if (this.#child.connected) this.#send({ kind: 'terminate' });
    const kill = signal => { if (!this.#exited) try { this.#child.kill(signal); } catch {} };
    this.#killTimers = [setTimeout(() => kill('SIGTERM'), 1000), setTimeout(() => kill('SIGKILL'), 2000)];
    for (const timer of this.#killTimers) timer.unref();
    return this.#exitPromise;
  }

  unref() { this.#child.unref(); this.#child.channel?.unref(); return this; }
  ref() { this.#child.ref(); this.#child.channel?.ref(); return this; }

  getMemoryUsage() {
    if (this.#exited || this.#stopping) return Promise.reject(new Error('Task worker process has stopped.'));
    const id = `adapter-memory-${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#memory.delete(id); reject(new Error('Task worker memory probe timed out.')); }, 20000);
      timer.unref(); this.#memory.set(id, { resolve, reject, timer });
      this.#send({ kind: 'memory', id });
    });
  }
}

export default ProcessWorker;
