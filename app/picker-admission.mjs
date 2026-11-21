const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('./profile-spans.mjs') : undefined;
// Cold acquisition bounds include work already opening. Cancelling its HTTP
// waiter does not free a permit until the underlying factory has settled.
export const COLD_OPEN_ADMISSION = Object.freeze({ maxPending: 64, perAccount: 2, deadlineMs: 2000, retryMs: 25, maxRetries: 80 });
const refused = reason => Object.assign(new Error(`Picker admission ${reason}. Wait a moment and retry.`), { status: 503, retryAfter: 1 });
export function createPickerAdmission({ limits, onEvent, bounds = COLD_OPEN_ADMISSION, clock = { setTimeout, clearTimeout } }) {
  const groups = new Map(), active = new Set(), shared = new Map(), items = new Set();
  let pending = 0, closed = false, pumping = false, sequence = 0;
  const drained = new Set();
  function observe(event, item, extra = {}) {
    try { onEvent?.({ event, admissionId: item.id, pickerId: item.owner?.pickerId,
      transition: ['queued', 'started', 'completed', 'deadline', 'released'].includes(event) ? event : 'rejected',
      reason: ['queued', 'started', 'completed', 'released'].includes(event) ? null : event,
      waitMs: (item.startedAt ?? performance.now()) - item.queuedAt,
      serviceMs: item.startedAt === undefined ? 0 : performance.now() - item.startedAt,
      pending, active: active.size, accounts: groups.size, ...extra }); } catch { /* Diagnostics cannot change admission. */ }
  }
  function remove(item) {
    if (item.removed) return;
    item.removed = true; items.delete(item);
    clock.clearTimeout(item.timer); item.signal?.removeEventListener('abort', item.abort);
    const group = groups.get(item.account); group.count--;
    if (!group.count) groups.delete(item.account);
    pending--; if (!pending) { for (const resolve of drained) resolve(); drained.clear(); }
  }
  function releaseWaiter(item) {
    if (item.removed || !item.job.drained || !item.settled || item.finishing || item.cancelDrain && !item.cancelDrained) return;
    remove(item); observe('released', item);
  }
  function settle(item, value, failed = false) {
    if (item.settled) return;
    item.settled = true; clock.clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.abort);
    if (failed) { item.reject(value); observe('error', item, { failureCode: value?.code ?? value?.name }); }
    else { item.resolve(value); observe('completed', item); }
    releaseWaiter(item);
  }
  function finish(item, value) {
    if (item.settled) return;
    if (!item.finish) { settle(item, value); return; }
    // The factory's lease and each waiter's acquisition have separate lifetimes.
    // A checkpoint may block one final pin after the shared work has drained.
    item.finishing = true;
    void Promise.resolve().then(() => {
      item.controller.signal.throwIfAborted();
      // A resource-owning finalizer accepts in the same synchronous step as
      // pinning. Later cancellation or finalizer failure cannot discard that
      // ownership before the request receives it and performs its cleanup.
      return item.finish(value, item.controller.signal, pinned => { settle(item, pinned); return pinned; });
    }).then(value => settle(item, value), error => settle(item, error, true))
      .finally(() => { item.finishing = false; releaseWaiter(item); });
  }
  function cancel(item, reason) {
    if (item.settled) return;
    item.settled = true; clock.clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.abort);
    const error = refused(reason), job = item.job;
    item.controller.abort(error);
    // A shared factory may outlive this waiter. Its last waiter can also own a
    // late close; keep a started lease until that cancellation drain settles.
    item.cancelDrain = Promise.resolve(item.onCancel?.()).catch(() => {}).then(() => {
      item.cancelDrained = true; releaseWaiter(item);
    });
    item.reject(error);
    if (item.startedAt === undefined) {
      const group = groups.get(item.account); group.queue.splice(group.queue.indexOf(item), 1);
      job.members.delete(item); remove(item);
      if (!job.members.size && shared.get(job.key) === job) shared.delete(job.key);
    }
    if (![...job.members].some(member => !member.settled)) job.controller.abort(error);
    observe(reason, item); pump();
  }
  function join(item) {
    const group = groups.get(item.account);
    group.queue.splice(group.queue.indexOf(item), 1);
    if (PROFILE_ENABLED) profile.interval('admission.queue', item._profileAt, profile.now(), item._profile);
    item.startedAt = performance.now(); observe('started', item);
  }
  function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      while (active.size < limits.config.coldStartsGlobal) {
        const eligible = [...groups].filter(([,g]) => g.queue.length && g.active < limits.config.coldStartsPerAccount);
        const selected = eligible[0];
        if (!selected) break;
        const [account, group] = selected, item = group.queue.shift();
        let release;
        try { release = limits.coldStart(item.owner); }
        catch (error) {
          item.settled = true; item.reject(error); item.job.members.delete(item);
          if (!item.job.members.size && shared.get(item.job.key) === item.job) shared.delete(item.job.key);
          remove(item); observe('lease-refused', item); continue;
        }
        if (PROFILE_ENABLED) profile.interval('admission.queue', item._profileAt, profile.now(), item._profile);
        const job = item.job;
        group.active++; active.add(job); job.started = true; job.work = item.work;
        // Only the factory takes a cold lease. Every follower still owns its
        // pending charge and original deadline, even across different accounts.
        for (const member of job.members) {
          if (member === item) { member.startedAt = performance.now(); observe('started', member); }
          else join(member);
        }
        void Promise.resolve().then(() => { job.controller.signal.throwIfAborted(); return job.work(job.controller.signal); }).then(
          value => {
            if (shared.get(job.key) === job) shared.delete(job.key);
            for (const member of job.members) finish(member, value);
          },
          error => {
            if (shared.get(job.key) === job) shared.delete(job.key);
            for (const member of job.members) settle(member, error, true);
          },
        ).finally(async () => {
          await Promise.all([...job.members].map(member => member.cancelDrain));
          if (shared.get(job.key) === job) shared.delete(job.key);
          release(); active.delete(job); group.active--; job.drained = true;
          for (const member of job.members) releaseWaiter(member);
          // Keep an account with repeat work behind accounts that arrived during
          // its turn, including two independently replenishing flooders.
          if (groups.get(account) === group) { groups.delete(account); groups.set(account, group); }
          pump(); });
      }
    } finally { pumping = false; }
  }
  return {
    run(owner, work, signal, { onCancel, sharedKey, finish } = {}) {
      const item = { id: ++sequence, owner, queuedAt: performance.now() };
      if (closed) { observe('shutdown', item); return Promise.reject(refused('shutdown')); }
      if (signal?.aborted) { observe('cancelled', item); return Promise.reject(refused('cancelled')); }
      const account = owner.accountId, group = groups.get(account);
      Object.assign(item, { account, work, signal, onCancel, finish, controller: new AbortController() });
      if (PROFILE_ENABLED) { item._profile = profile.capture(); item._profileAt = profile.now(); }
      if ((group?.count ?? 0) >= bounds.perAccount || pending >= bounds.maxPending) {
        const reason = (group?.count ?? 0) >= bounds.perAccount ? 'account-full' : 'queue-full';
        observe(reason, item); return Promise.reject(refused(reason));
      }
      let job = sharedKey === undefined ? undefined : shared.get(sharedKey);
      if (job?.controller.signal.aborted) { observe('draining', item); return Promise.reject(refused('draining')); }
      const promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
      if (!job) {
        job = { key: sharedKey, work, controller: new AbortController(), members: new Set() };
        if (sharedKey !== undefined) shared.set(sharedKey, job);
      }
      item.job = job; job.members.add(item);
      if (!group) groups.set(account, { queue: [item], count: 1, active: 0 });
      else { group.queue.push(item); group.count++; }
      pending++; items.add(item); item.abort = () => cancel(item, 'cancelled');
      signal?.addEventListener('abort', item.abort, { once: true });
      item.timer = clock.setTimeout(() => cancel(item, 'deadline'), bounds.deadlineMs);
      observe('queued', item);
      if (!item.settled && job.started) join(item);
      pump(); return promise;
    },
    close() {
      closed = true;
      // Include final pins whose factory permit has already been released.
      for (const item of items) cancel(item, 'shutdown');
      return pending ? new Promise(resolve => drained.add(resolve)) : Promise.resolve();
    },
  };
}
