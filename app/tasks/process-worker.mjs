import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { encodeProcessMessage, decodeReceivedProcessMessage } from './process-worker-transport.mjs';
import { WORKER_OLD_GENERATION_MB, CALCULATOR_PROCESS_RSS_BYTES, workerMemoryError } from './worker-limits.mjs';

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
  #profiles = new Map();
  #sequence = 0;
  #failed = false;
  #profileTimeoutMs;
  #clock;
  rssBytes = 0;

  constructor(workerData, { probeImport = process.env.RS3_WORKER_MEMORY_PROBE_IMPORT, profileTimeoutMs = 20000,
    forkProcess = fork, clock = { now: () => Date.now(),
      setTimeout: (...args) => setTimeout(...args), clearTimeout: timer => clearTimeout(timer) } } = {}) {
    super();
    this.#profileTimeoutMs = profileTimeoutMs;
    this.#clock = clock;
    // Serialization failures must occur before a child is created.
    const data = encodeProcessMessage(workerData);
    this.#exitPromise = new Promise(resolve => { this.#resolveExit = resolve; });
    this.#child = forkProcess(fileURLToPath(new URL('./process-worker-host.mjs', import.meta.url)), [], {
      // The relay host collects its own garbage (relay-collector.mjs).
      execArgv: [...process.execArgv, '--expose-gc', `--max-old-space-size=${WORKER_OLD_GENERATION_MB}`, '--max-semi-space-size=16'],
      // Optional warm-store failures must reach the service journal too.
      serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true,
    });
    this.#child.on('message', message => {
      try {
        if (message.kind === 'message') this.emit('message', decodeReceivedProcessMessage(message.payload));
        else if (message.kind === 'memory-rss') {
          if (Number.isSafeInteger(message.rssBytes) && message.rssBytes >= 0) this.rssBytes = message.rssBytes;
          if (this.rssBytes > CALCULATOR_PROCESS_RSS_BYTES) this.#fail(workerMemoryError(), true);
        }
        else if (message.kind === 'error') this.#fail(Object.assign(new Error(message.error.message), message.error));
        else if (message.kind === 'profile') {
          const request = this.#profiles.get(message.id);
          if (request) {
            const cleaned = message.cancelled || request.operation === 'stop' && !message.error;
            if (!request.timedOut || cleaned) {
              this.#profiles.delete(message.id); this.#clock.clearTimeout(request.timer);
              if (request.timedOut && cleaned) this.#restoreProfile();
              message.error ? request.reject(new Error('Calculator profile unavailable.')) : request.resolve(message.profile);
            }
          }
        }
        else if (message.kind === 'profile-retiring') this.#retireProfile();
        else if (message.kind === 'profile-cleaned') this.#restoreProfile();
        else if (message.kind === 'memory') {
          const request = this.#memory.get(message.id);
          if (request) {
            this.#memory.delete(message.id); this.#clock.clearTimeout(request.timer);
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
    // RSS reporting is mandatory even outside the session-residency pool.
    this.#send({ kind: 'init', data, probeImport, trackRss: true });
  }

  get pid() { return this.#child.pid; }

  #send(message) {
    if (this.#exited || this.#stopping && message.kind !== 'terminate') throw new Error('Task worker process has stopped.');
    try { this.#child.send(message, error => { if (error && !this.#stopping) this.#fail(error); }); }
    catch (error) { queueMicrotask(() => this.#fail(error)); }
  }

  #fail(error, force = false) {
    if (force && this.#stopping) { void this.terminate({ force: true }); return; }
    if (this.#failed || this.#exited || this.#stopping) return;
    this.#failed = true;
    void this.terminate({ force });
    this.emit('error', error);
  }

  #finish(code) {
    if (this.#exited) return;
    this.#exited = true;
    for (const timer of this.#killTimers) this.#clock.clearTimeout(timer);
    for (const { reject, timer } of this.#memory.values()) {
      this.#clock.clearTimeout(timer); reject(new Error('Task worker process exited.'));
    }
    this.#memory.clear();
    for (const { reject, timer } of this.#profiles.values()) { this.#clock.clearTimeout(timer); reject(new Error('Calculator exited.')); }
    this.#profiles.clear();
    this.#resolveExit(code);
    this.emit('exit', code);
  }

  postMessage(message) { this.#send({ kind: 'post', payload: encodeProcessMessage(message) }); }

  terminate({ force = false } = {}) {
    if (this.#exited) return this.#exitPromise;
    if (force) {
      this.#stopping = true;
      try { this.#child.kill('SIGKILL'); } catch {}
      return this.#exitPromise;
    }
    if (this.#stopping) return this.#exitPromise;
    this.#stopping = true;
    if (this.#child.connected) this.#send({ kind: 'terminate' });
    const kill = signal => { if (!this.#exited) try { this.#child.kill(signal); } catch {} };
    this.#killTimers = [this.#clock.setTimeout(() => kill('SIGTERM'), 1000), this.#clock.setTimeout(() => kill('SIGKILL'), 2000)];
    for (const timer of this.#killTimers) timer.unref();
    return this.#exitPromise;
  }

  unref() { this.#child.unref(); this.#child.channel?.unref(); return this; }
  ref() { this.#child.ref(); this.#child.channel?.ref(); return this; }

  async startCpuProfile({ deadline = this.#clock.now() + 600000 } = {}) {
    await this.#profileRequest('start', deadline);
    return { stop: () => this.#profileRequest('stop') };
  }

  #restoreProfile() {
    for (const [id, request] of this.#profiles) if (request.timedOut) { this.#clock.clearTimeout(request.timer); this.#profiles.delete(id); }
    this.profileRetiring = undefined; this.emit('profile-cleaned');
  }

  #retireProfile() {
    if (this.profileRetiring) return;
    this.profileRetiring = true; this.emit('profile-retiring');
  }

  #profileRequest(operation, deadline) {
    if (this.#exited || this.#stopping || this.profileRetiring) return Promise.reject(new Error('Calculator profile unavailable.'));
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = this.#clock.setTimeout(() => {
        this.#profiles.get(id).timedOut = true;
        // Mark uncertainty before any replacement can join this capture.
        // The scheduler/host may retire only when the request is finished.
        this.#retireProfile();
        reject(new Error('Calculator profile unavailable.'));
        this.#send({ kind: 'profile', operation: 'cancel', id });
      }, this.#profileTimeoutMs);
      timer.unref(); this.#profiles.set(id, { resolve, reject, timer, operation });
      this.#send({ kind: 'profile', operation, id, deadline });
    });
  }

  getMemoryUsage() {
    if (this.#exited || this.#stopping) return Promise.reject(new Error('Task worker process has stopped.'));
    const id = `adapter-memory-${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = this.#clock.setTimeout(() => { this.#memory.delete(id); reject(new Error('Task worker memory probe timed out.')); }, 20000);
      timer.unref(); this.#memory.set(id, { resolve, reject, timer });
      this.#send({ kind: 'memory', id });
    });
  }
}

export default ProcessWorker;
