const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('./profile-spans.mjs') : undefined;
// Cold acquisition bounds include work already opening. Cancelling its HTTP
// waiter does not free a permit until the underlying factory has settled.
export const COLD_OPEN_ADMISSION = Object.freeze({ maxPending: 64, perAccount: 2, deadlineMs: 2000, retryMs: 25, maxRetries: 80 });
const refused = reason => Object.assign(new Error(`Picker admission ${reason}. Wait a moment and retry.`), { status: 503, retryAfter: 1 });
export function createPickerAdmission({ limits, onEvent, bounds = COLD_OPEN_ADMISSION }) {
  const groups = new Map(), active = new Set();
  let pending = 0, closed = false, pumping = false;
  const drained = new Set();
  function observe(event, item, extra = {}) {
    try { onEvent?.({ event, waitMs: (item.startedAt ?? performance.now()) - item.queuedAt,
      serviceMs: item.startedAt === undefined ? 0 : performance.now() - item.startedAt,
      pending, active: active.size, accounts: groups.size, ...extra }); } catch { /* Diagnostics cannot change admission. */ }
  }
  function remove(item) {
    clearTimeout(item.timer); item.signal?.removeEventListener('abort', item.abort);
    const group = groups.get(item.account); group.count--;
    if (!group.count) groups.delete(item.account);
    pending--; if (!pending) { for (const resolve of drained) resolve(); drained.clear(); }
  }
  function cancel(item, reason) {
    if (item.settled) return;
    item.settled = true; clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.abort);
    const error = refused(reason); item.controller.abort(error); item.reject(error);
    if (item.startedAt === undefined) {
      const group = groups.get(item.account); group.queue.splice(group.queue.indexOf(item), 1);
      remove(item);
    }
    observe(reason, item); pump();
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
        catch (error) { item.settled = true; item.reject(error); remove(item); observe('lease-refused', item); continue; }
        if (PROFILE_ENABLED) profile.interval('admission.queue', item._profileAt, profile.now(), item._profile);
        group.active++; active.add(item); item.startedAt = performance.now(); observe('started', item);
        void Promise.resolve().then(() => { item.controller.signal.throwIfAborted(); return item.work(item.controller.signal); }).then(
          value => { if (!item.settled) { item.settled = true; item.resolve(value); observe('completed', item); } },
          error => { if (!item.settled) { item.settled = true; item.reject(error); observe('error', item); } },
        ).finally(() => { release(); active.delete(item); group.active--; remove(item);
          // Keep an account with repeat work behind accounts that arrived during
          // its turn, including two independently replenishing flooders.
          if (groups.get(account) === group) { groups.delete(account); groups.set(account, group); }
          observe('released', item); pump(); });
      }
    } finally { pumping = false; }
  }
  return {
    run(owner, work, signal) {
      if (closed) return Promise.reject(refused('shutdown'));
      if (signal?.aborted) return Promise.reject(refused('cancelled'));
      const account = owner.accountId, group = groups.get(account);
      const item = { account, owner, work, signal, queuedAt: performance.now(), controller: new AbortController() };
      if (PROFILE_ENABLED) { item._profile = profile.capture(); item._profileAt = profile.now(); }
      if ((group?.count ?? 0) >= bounds.perAccount || pending >= bounds.maxPending) {
        const reason = (group?.count ?? 0) >= bounds.perAccount ? 'account-full' : 'queue-full';
        observe(reason, item); return Promise.reject(refused(reason));
      }
      const promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
      if (!group) groups.set(account, { queue: [item], count: 1, active: 0 });
      else { group.queue.push(item); group.count++; }
      pending++; item.abort = () => cancel(item, 'cancelled');
      signal?.addEventListener('abort', item.abort, { once: true });
      item.timer = setTimeout(() => cancel(item, 'deadline'), bounds.deadlineMs);
      observe('queued', item); pump(); return promise;
    },
    close() {
      closed = true;
      for (const group of [...groups.values()]) for (const item of [...group.queue]) cancel(item, 'shutdown');
      for (const item of active) cancel(item, 'shutdown');
      return pending ? new Promise(resolve => drained.add(resolve)) : Promise.resolve();
    },
  };
}
