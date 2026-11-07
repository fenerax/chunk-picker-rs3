import { EventEmitter, once } from 'node:events';

// Test fixtures publish acknowledgements when they accept or finish work.
// Waiting for those events has no host-speed deadline or retry interval.
export function createWorkAcknowledgements() {
  const events = new EventEmitter();
  const notify = () => queueMicrotask(() => events.emit('change'));
  return {
    notify,
    observe(worker) {
      const post = worker.postMessage;
      worker.postMessage = function (...args) { const result = post.apply(this, args); notify(); return result; };
      const terminate = worker.terminate;
      if (terminate) worker.terminate = function (...args) {
        const result = terminate.apply(this, args); notify();
        Promise.resolve(result).then(notify, notify); return result;
      };
      for (const name of ['message', 'error', 'exit', 'profile-retiring']) worker.on(name, notify);
      notify();
      return worker;
    },
    async until(predicate) {
      while (!predicate()) await once(events, 'change');
    },
  };
}

export async function pendingResult(promise) {
  const pending = Symbol('pending');
  return { pending, result: await Promise.race([promise, Promise.resolve(pending)]) };
}
