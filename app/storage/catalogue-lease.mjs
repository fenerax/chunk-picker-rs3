import { AsyncLocalStorage } from 'node:async_hooks';

const ownership = new AsyncLocalStorage();
export function catalogueLeaseMode(lease) {
  let owner = ownership.getStore();
  while (owner && !(owner.lease === lease && owner.active)) owner = owner.parent;
  return owner?.mode;
}
/** One in-process reader/writer admission queue, backed by one kernel guard
 * for each nonempty batch. Other processes still refuse either lease mode. */
export function createCatalogueLease(acquire) {
  const queue = [];
  let readers = 0, writer = false, guard, changing = false, failed;
  const abortError = signal => signal.reason ?? new DOMException('Aborted', 'AbortError');
  function pump() {
    if (changing || writer) return;
    if (!queue.length) {
      if (!readers && guard) {
        const release = guard; guard = undefined; changing = true;
        const retirement = release().then(() => { changing = false; pump(); }, error => {
          failed = error;
          changing = false; for (const request of queue.splice(0)) request.reject(error);
          throw error;
        });
        // pump also runs from cancellation, where no active caller awaits it.
        void retirement.catch(() => {});
        return retirement;
      }
      return;
    }
    if (!guard) {
      changing = true;
      void acquire().then(release => { guard = release; changing = false; pump(); }, error => {
        changing = false; for (const request of queue.splice(0)) request.reject(error);
      });
      return;
    }
    // A waiting writer takes precedence even over shared requests that arrived
    // during guard acquisition. No new reader can extend its drain indefinitely.
    const exclusive = queue.findIndex(request => request.mode === 'exclusive');
    if (exclusive >= 0) {
      if (readers) return;
      writer = true; queue.splice(exclusive, 1)[0].resolve();
    } else for (const request of queue.splice(0)) { readers++; request.resolve(); }
  }
  async function run(work, { mode = 'exclusive', signal, onQueued } = {}) {
    if (!['shared', 'exclusive'].includes(mode)) throw new TypeError('Invalid catalogue lease mode.');
    if (failed) throw failed; // uncertain kernel release fails closed
    signal?.throwIfAborted();
    let parent = ownership.getStore();
    while (parent && !(parent.lease === run && parent.active)) parent = parent.parent;
    if (parent) {
      if (parent.mode === 'shared' && mode === 'exclusive') throw new Error('Cannot upgrade a shared catalogue lease. Request exclusive admission before starting work.');
      // Reentrant work may be intentionally detached (retention maintenance).
      // Keep the parent's physical permit until every entered child finishes.
      const done = Promise.withResolvers(); parent.children.add(done.promise);
      const child = { lease: run, mode: parent.mode, active: true, parent: ownership.getStore(), children: new Set() };
      try { return await ownership.run(child, work); }
      finally {
        while (child.children.size) await Promise.all(child.children);
        child.active = false; parent.children.delete(done.promise); done.resolve();
      }
    }
    let request;
    await new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        const index = queue.indexOf(request);
        if (index < 0) return;
        queue.splice(index, 1); cleanup(); reject(abortError(signal)); pump();
      };
      request = { mode, resolve() { cleanup(); resolve(); }, reject(error) { cleanup(); reject(error); } };
      queue.push(request); signal?.addEventListener('abort', abort, { once: true });
      try { onQueued?.(); } catch (error) { const index = queue.indexOf(request); if (index >= 0) queue.splice(index, 1); request.reject(error); }
      pump();
    });
    const owner = { lease: run, mode, active: true, parent: ownership.getStore(), children: new Set() };
    try { signal?.throwIfAborted(); return await ownership.run(owner, work); }
    finally {
      while (owner.children.size) await Promise.all(owner.children);
      owner.active = false; if (mode === 'exclusive') writer = false; else readers--; await pump();
    }
  }
  return run;
}
