// One parent-side channel. Shutdown must never interrupt a worker's module
// evaluation or native store operations, and late observers must never send ACKs.
export class FixtureThread {
  constructor(worker, { onProgress, onFailure }) {
    this.worker = worker; this.onProgress = onProgress; this.onFailure = onFailure;
    this.initialized = Promise.withResolvers(); this.exited = Promise.withResolvers();
    this.ready = this.initialized.promise;
    // A sibling's constructor can fail before the pool starts awaiting ready.
    void this.ready.catch(() => {});
    worker.on('error', error => this.fail(error));
    worker.on('exit', code => {
      this.closed = true;
      if (!this.stopping || !this.stopped || code !== 0) this.fail(new Error(`Fixture worker exited unexpectedly (${code}).`));
      this.exited.resolve();
    });
    worker.on('message', message => {
      if (this.closed) return;
      if (message.type === 'stopped') { this.stopped = true; return; }
      if (this.stopping) return;
      if (message.type === 'ready') this.initialized.resolve();
      else if (message.type === 'progress') void this.progress(message);
      else if (message.type === 'result') this.pending?.resolve(message.value);
      else if (message.type === 'failure') this.fail(new Error(message.message));
    });
  }
  fail(error) {
    this.failure ??= error;
    this.initialized.reject(this.failure); this.pending?.reject(this.failure);
    this.onFailure(this.failure);
  }
  async progress(message) {
    try {
      await this.onProgress(message.value);
      if (!this.stopping && !this.closed) this.worker.postMessage({ type: 'ack', id: message.id });
    } catch (error) { if (!this.stopping && !this.closed) this.fail(error); }
  }
  async build(job) {
    if (this.failure) throw this.failure;
    if (this.stopping || this.closed) throw new Error('Fixture worker is stopping.');
    this.pending = Promise.withResolvers();
    try {
      this.worker.postMessage({ type: 'build', job });
      return await this.pending.promise;
    } finally { this.pending = undefined; }
  }
  stop() {
    return this.shutdown ??= (async () => {
      this.stopping = true;
      const error = this.failure ?? new Error('Fixture worker is stopping.');
      this.initialized.reject(error); this.pending?.reject(error);
      // STOP is queued even during initialization. Let imports complete, cancel
      // blocked progress, unwind the active store, close the port, and exit.
      if (!this.closed) {
        try { this.worker.postMessage({ type: 'stop' }); }
        catch (error) { this.fail(error); }
      }
      await this.exited.promise;
      if (this.failure) throw this.failure;
    })();
  }
}

// Observers may themselves be waiting for another worker. Release pool control
// on cancellation; the channel's stopping/closed checks suppress any late ACK.
// Keep one signal subscription per pool, with only its active observers retained.
const cancellations = new WeakMap();
export function observe(work, signal) {
  signal.throwIfAborted();
  let active = cancellations.get(signal);
  if (!active) {
    active = new Set(); cancellations.set(signal, active);
    signal.addEventListener('abort', () => { for (const cancel of active) cancel(); active.clear(); }, { once: true });
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => active.delete(abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    active.add(abort);
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(
      value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
