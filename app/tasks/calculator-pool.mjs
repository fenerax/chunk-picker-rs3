import { EventEmitter } from 'node:events';

const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('../profile-spans.mjs') : undefined;

// One server owns the physical calculators. Lanes borrow a slot for one job;
// even a retiring calculator holds its slot until termination has completed.
export function createCalculatorPool({ limit, workerFactory, workerData, onReady, onWorker, idleMs = 600000, startupDeadlineMs = 30000,
  sessions, clock = { now: () => performance.now(), setTimeout, clearTimeout }, memoryUsage = worker => worker.rssBytes }) {
  const slots = new Set(), endpoints = new Set(), waiting = new Map(), turns = [];
  let ready, boot, closed = false, sequence = 0, peak = 0, pumping = false, evictions = 0, activityObserved = false;
  let memoryTrips = 0, optimizationsSuspended = false, closePromise;
  const keepWarm = () => sessions?.enabled && !optimizationsSuspended;
  const remainingSession = () => sessions?.remainingAny() ?? 0;
  const idleRemaining = slot => sessions
    ? keepWarm() && activityObserved ? remainingSession() : idleMs - (clock.now() - slot.idleAt)
    : idleMs - (clock.now() - slot.idleAt);
  const activity = slot => sessions?.lastActive(slot.pickerId) ?? -Infinity;
  // Process telemetry is sampled asynchronously, independently of calculation.
  // Missing, failed or stale reports never erase the last valid measurement;
  // reservations also retain their configured floor until proven process exit.
  const rss = slot => {
    try {
      const bytes = memoryUsage(slot.worker);
      if (Number.isFinite(bytes) && bytes >= 0 && bytes <= Number.MAX_SAFE_INTEGER) slot.rssBytes = Math.ceil(bytes);
    } catch { /* Keep the last validated sample. */ }
    return slot.rssBytes ?? 0;
  };
  const estimate = () => Math.min(sessions.estimatedBytes, sessions.memoryBytes);
  const reservation = slot => sessions ? Math.max(estimate(), rss(slot)) : 0;
  const reserved = () => [...slots].reduce((sum, slot) => sum + reservation(slot), 0);
  const diagnostics = pickerId => ({ limit, resident: slots.size, peak, active: [...slots].filter(slot => slot.owner).length,
    retiring: [...slots].filter(slot => slot.stopping || slot.worker.profileRetiring).length, waiting: waiting.size, ...(sessions ? { memoryBytes: sessions.memoryBytes,
      rssBytes: [...slots].reduce((sum, slot) => sum + rss(slot), 0), reservedBytes: reserved(), evictions, memoryTrips,
      optimizationsSuspended, residency: sessions.diagnostics(pickerId) } : {}) });
  // Unrequested producers and advisory graphs go before the foreground graph,
  // regardless of which picker's activity last touched them.
  const priority = slot => slot.owner?.isBackground?.() ? 0 : slot.group === 'advisory' ? slot.owner ? 2 : 1
    : slot.owner ? 4 : 3;
  const evictionOrder = values => values.sort((a, b) => priority(a) - priority(b) || (activity(a) - activity(b)) || a.idleAt - b.idleAt);
  function retire(slot, force = false) {
    if (force && !slot.forceStop) {
      slot.forceStop = true;
      if (slot.stopping) {
        // A graceful retirement may already be waiting on synchronous work.
        try { void Promise.resolve(slot.worker.terminate({ force: true })).catch(() => {}); } catch {}
      }
    }
    if (slot.stopping) return slot.stopping;
    clock.clearTimeout(slot.timer); clearTimeout(slot.startupTimer);
    slot.stopping = Promise.resolve().then(() => slot.worker.terminate({ force: !!slot.forceStop })).then(() => {
      slots.delete(slot); pump();
    }, () => { /* An unproven exit still occupies the hard cap. */ });
    return slot.stopping;
  }
  function idle(slot, reset = true) {
    clock.clearTimeout(slot.timer);
    if (reset) slot.idleAt = clock.now();
    const check = () => {
      if (slot.owner || slot.stopping || closed) return;
      const remaining = Math.max(0, idleRemaining(slot));
      if (!sessions || remaining <= 0) void retire(slot);
      else { slot.timer = clock.setTimeout(check, Math.min(remaining, 2147483647)); slot.timer?.unref?.(); }
    };
    slot.timer = clock.setTimeout(check, Math.min(Math.max(0, idleRemaining(slot)), 2147483647));
    slot.timer?.unref?.();
  }
  function allocate(pendingOwner, cold = true) {
    const slot = { worker: workerFactory(workerData(!ready, pendingOwner?.group)), ready: false, idleAt: clock.now(), cold: cold && !!pendingOwner, pendingOwner, group: pendingOwner?.group, snapshots: new Map() };
    onWorker?.(slot.worker);
    slots.add(slot); peak = Math.max(peak, slots.size);
    slot.initial = new Promise((resolve, reject) => { slot.resolve = resolve; slot.reject = reject; });
    // Later slots report failure through their owner, not an unobserved promise.
    slot.initial.catch(() => {});
    function fail(error) {
      if (slot.stopping) return;
      slot.reject(error);
      const owner = slot.owner ?? slot.pendingOwner; slot.owner = undefined;
      if (owner) { owner.slot = undefined; waiting.delete(owner); }
      void retire(slot);
      if (owner && !owner.stopped) owner.emit(slot.worker.profileRetiring ? 'profile-retired' : 'error', error);
    }
    slot.fail = fail;
    slot.startupTimer = setTimeout(() => fail(new Error('Calculator startup deadline exceeded.')), startupDeadlineMs);
    slot.worker.on('error', fail);
    slot.worker.on('profile-retiring', () => {
      if (slot.ready && !slot.owner) void retire(slot);
    });
    slot.worker.on('exit', () => {
      if (slot.stopping) { slots.delete(slot); pump(); }
      else fail(new Error('Calculator exited.'));
    });
    slot.worker.on('message', message => {
      if (slot.stopping) return;
      if (message.type === 'ready') {
        if (ready?.datasetDigest !== undefined && message.datasetDigest !== ready.datasetDigest) { fail(new Error('Calculator dataset mismatch.')); return; }
        onReady?.(message);
        // The control protocol belongs to the physical calculator, not the
        // logical lane endpoint that borrows it for individual jobs.
        if (PROFILE_ENABLED) profile.attach(slot.worker);
        clearTimeout(slot.startupTimer); slot.pendingOwner = undefined; slot.ready = true;
        ready ??= message;
        slot.resolve(ready);
        if (slot.worker.profileRetiring) void retire(slot); else idle(slot);
        pump(); return;
      }
      const owner = slot.owner;
      if (!owner || message.id !== slot.id || message.pickerId !== undefined && message.pickerId !== slot.pickerId) return;
      const complete = !['progress', 'prediction-prepared'].includes(message.type);
      const response = { ...message, id: slot.originalId };
      if (complete) { owner.lastSlot = new WeakRef(slot); slot.owner = undefined; owner.slot = undefined; idle(slot); }
      if (complete) enforceMemory();
      owner.emit('message', response);
      if (complete && slot.worker.profileRetiring) void retire(slot);
      if (complete) pump();
    });
    return slot;
  }
  function pump() {
    if (closed || pumping) return;
    pumping = true;
    try {
      enforceMemory();
      while (waiting.size) {
        const candidates = [];
        for (const [endpoint, request] of waiting) {
          const next = request.peek();
          if (endpoint.stopped || !next) waiting.delete(endpoint);
          else if (next.interactive || canPrewarm(next.pickerId)) candidates.push({ endpoint, request, ...next });
        }
        if (!candidates.length) break;
        const interactive = candidates.some(value => value.interactive);
        const eligible = candidates.filter(value => value.interactive === interactive);
        const ids = new Set(eligible.map(value => value.pickerId));
        for (let i = turns.length - 1; i >= 0; i--) if (!ids.has(turns[i])) turns.splice(i, 1);
        for (const id of ids) if (!turns.includes(id)) turns.push(id);
        const idleSlots = [...slots].filter(value => value.ready && !value.stopping && !value.worker.profileRetiring && !value.owner);
        const usable = (slot, endpoint) => limit === 1 || slot.group === endpoint.group;
        // Advisory lanes share at most limit - 1 slots, including retiring
        // slots. Foreground can then wake even after its idle worker exits.
        const canAllocate = endpoint => slots.size < limit && (!sessions || sessions.memoryBytes > 0
          && reserved() + estimate() + (limit > 1 && endpoint.group === 'advisory'
            && ![...slots].some(slot => slot.group === 'foreground') ? estimate() : 0) <= sessions.memoryBytes)
          && (limit === 1 || endpoint.group === 'foreground'
            || [...slots].filter(value => value.group === 'advisory').length < limit - 1)
          && ![...slots].some(value => !value.ready && !value.stopping && usable(value, endpoint));
        const ordered = turns.flatMap(id => eligible.filter(value => value.pickerId === id));
        // A request awaiting its group's cold start cannot block another
        // picker's interactive request on an already-ready calculator.
        const selected = ordered.find(value => idleSlots.some(slot => usable(slot, value.endpoint)))
          ?? ordered.find(value => canAllocate(value.endpoint)) ?? ordered[0];
        // Retiring processes still own their RSS and reservation until exit.
        if (sessions && (sessions.memoryBytes === 0 || reserved() > sessions.memoryBytes)) break;
        const slot = idleSlots.find(value => usable(value, selected.endpoint));
        if (!slot) {
          const starting = [...slots].some(value => !value.ready && !value.stopping && usable(value, selected.endpoint));
          if (canAllocate(selected.endpoint)) {
            const endpoint = selected.endpoint;
            try { allocate(endpoint); } catch (error) {
              waiting.delete(endpoint); queueMicrotask(() => { if (!endpoint.stopped) endpoint.emit('error', error); });
            }
          } else if (interactive && sessions && !starting && idleSlots.length && ![...slots].some(value => value.stopping)
            && (selected.endpoint.group === 'foreground' || limit === 1 || [...slots].filter(value => value.group === 'advisory').length < limit - 1)) {
            // Requested advisory work may reclaim an idle foreground graph.
            // Retirement stays charged until exit, and canAllocate still reserves
            // headroom to respawn foreground lazily for the next request.
            const oldest = evictionOrder(idleSlots)[0];
            evictions++; void retire(oldest);
          } else if (interactive && !starting && ![...slots].some(value => value.stopping && usable(value, selected.endpoint))) {
            // Memory and physical slots are shared across groups. A foreground
            // request must be able to displace unsolicited advisory production.
            for (const value of evictionOrder([...slots])) if (!value.stopping) {
              if (!value.ready && value.group === 'advisory' && selected.endpoint.group === 'foreground'
                && value.pendingOwner?.yieldWhileStarting?.()) break;
              if (value.owner?.yieldToInteractive?.()) break;
            }
          }
          break;
        }
        const { endpoint, request } = selected;
        turns.splice(turns.indexOf(selected.pickerId), 1); turns.push(selected.pickerId);
        waiting.delete(endpoint); clock.clearTimeout(slot.timer);
        slot.owner = endpoint; slot.pickerId = selected.pickerId; endpoint.slot = slot;
        endpoint.startedCalculator = slot.cold; slot.cold = false;
        request.run();
      }
    } finally { pumping = false; }
  }
  class Endpoint extends EventEmitter {
    constructor(includeReadyCatalogue) {
      super(); this.group = includeReadyCatalogue ? 'foreground' : 'advisory'; endpoints.add(this);
      boot ??= (async () => {
        await Promise.all([...slots].filter(slot => slot.stopping).map(slot => slot.stopping));
        if (closed) throw new Error('Calculator pool is closing.');
        return ready ?? await ([...slots][0] ?? allocate(this, false)).initial;
      })().catch(error => { boot = undefined; throw error; });
      boot.then(value => { if (!this.stopped) this.emit('message', { ...value }); }, error => { if (!this.stopped) this.emit('error', error); });
    }
    get snapshotHints() { return this.slot?.snapshots; }
    // A snapshot probe never joins the allocator or the wake queue. Other
    // admitted pickers keep their turn; a busy/retired pool is an immediate miss.
    tryReadSnapshot(pickerId, run) {
      const slot = [...slots].find(value => value.ready && !value.stopping && !value.worker.profileRetiring
        && !value.owner && (limit === 1 || value.group === this.group));
      return this.tryResident(pickerId, run, slot);
    }
    // Optional resident work never waits, allocates, or jumps a queued job.
    // A weak hint cannot keep a retired calculator or its graphs alive.
    tryIdle(pickerId, run) {
      return this.tryResident(pickerId, run, this.lastSlot?.deref());
    }
    tryResident(pickerId, run, slot) {
      if (closed || this.stopped || this.slot || waiting.size || optimizationsSuspended || !slot || !slots.has(slot)
        || !slot.ready || slot.stopping || slot.worker.profileRetiring || slot.owner
        || sessions && (sessions.memoryBytes === 0 || reserved() > sessions.memoryBytes)) return false;
      clock.clearTimeout(slot.timer);
      slot.owner = this; slot.pickerId = pickerId; this.slot = slot;
      this.startedCalculator = false;
      run(); return true;
    }
    schedule(peek, run, yieldToInteractive, isBackground, memoryPressure, yieldWhileStarting) {
      Object.assign(this, { yieldToInteractive, isBackground, memoryPressure, yieldWhileStarting }); waiting.set(this, { peek, run }); pump();
    }
    postMessage(message) {
      if (this.stopped) throw new Error('Calculator lane has stopped.');
      if (message.type === 'supersede') {
        for (const slot of slots) if (!slot.stopping) slot.worker.postMessage(message);
        return;
      }
      const slot = this.slot;
      if (message.type === 'cancel') {
        if (slot?.originalId === message.id && slot.pickerId === message.pickerId) slot.worker.postMessage({ ...message, id: slot.id });
        return;
      }
      if (!slot || slot.stopping) throw new Error('Calculator slot was not acquired.');
      slot.id = ++sequence; slot.originalId = message.id; slot.pickerId = message.pickerId;
      slot.worker.postMessage({ ...message, id: slot.id });
    }
    terminate() {
      if (this.stopped) return this.termination;
      this.stopped = true; waiting.delete(this); endpoints.delete(this);
      const slot = this.slot ?? [...slots].find(slot => !slot.ready && slot.pendingOwner === this); this.slot = undefined;
      if (slot) { slot.owner = undefined; this.termination = retire(slot); }
      pump(); return this.termination;
    }
    unref() { return this; }
  }
  function canPrewarm(pickerId) {
    return !sessions || keepWarm() && sessions.remaining(pickerId) > 0 && reserved() <= sessions.memoryBytes;
  }
  function enforceMemory() {
    if (closed || !sessions) return;
    const live = [...slots].filter(slot => !slot.stopping);
    const actual = live.reduce((sum, slot) => sum + rss(slot), 0);
    const totalActual = [...slots].reduce((sum, slot) => sum + rss(slot), 0);
    if (totalActual > sessions.memoryBytes && !optimizationsSuspended) {
      // Fail closed for optional work for the remainder of this pool's life.
      // Requested jobs may also be interrupted below: reservations are not a
      // licence for a synchronous calculator to grow without a bound.
      optimizationsSuspended = true; memoryTrips++;
      for (const slot of live) if (slot.ready && !slot.owner) idle(slot, false);
    }
    if (totalActual > sessions.memoryBytes) for (const slot of slots) if (slot.stopping && !slot.forceStop) {
      slot.forceStop = true;
      void Promise.resolve(slot.worker.terminate({ force: true })).catch(() => {});
    }
    // Already-retiring workers still count against admission, but their pending
    // exit must not cause another idle graph to be evicted on every sample.
    let bytes = [...slots].filter(slot => !slot.stopping).reduce((sum, slot) => sum + reservation(slot), 0);
    let actualRemaining = actual;
    const oldest = evictionOrder(live);
    for (const slot of oldest) {
      if (bytes <= sessions.memoryBytes) break;
      let stopped = false;
      if (!slot.owner && slot.ready) { slot.forceStop = actual > sessions.memoryBytes; void retire(slot); stopped = true; }
      else if (!slot.ready && actualRemaining > sessions.memoryBytes) {
        slot.forceStop = true; slot.fail(new Error('Calculator startup exceeded its memory budget.')); stopped = true;
      }
      else if (slot.owner?.isBackground?.() || actualRemaining > sessions.memoryBytes) {
        // Only an RSS emergency overrides served()/request waiters. The lane
        // settles its callers and atomically cancels before forced retirement.
        slot.forceStop = actual > sessions.memoryBytes;
        stopped = actualRemaining > sessions.memoryBytes ? slot.owner?.memoryPressure?.() ?? false
          : slot.owner?.yieldToInteractive?.() ?? false;
      }
      if (stopped) { bytes -= reservation(slot); actualRemaining -= rss(slot); evictions++; }
    }
  }
  const memoryTimer = sessions ? clock.setTimeout(function check() {
    pump();
    if (!closed) { maintenance = clock.setTimeout(check, 100); maintenance?.unref?.(); }
  }, 100) : undefined;
  let maintenance = memoryTimer;
  maintenance?.unref?.();
  return { createEndpoint: includeReadyCatalogue => new Endpoint(includeReadyCatalogue), diagnostics, canPrewarm, keepWarm,
    sessionChanged(pickerId) {
      if (closed) return;
      if (sessions && pickerId) activityObserved = true;
      for (const slot of slots) if (slot.ready && !slot.owner && !slot.stopping) {
        // Preserve the last completion time when extending a session lease.
        idle(slot, false);
      }
      enforceMemory(); pump();
    },
    releaseCatalogue() {
      // Foreground has decoded its immutable catalogue. Future lane handshakes
      // need only capabilities/digest, not another retained serialized copy.
      for (const key of ['catalogue', 'dynamicCatalogue', 'dynamicCatalogueBytes']) if (ready) delete ready[key];
    },
    forgetPicker(pickerId) {
      for (const slot of slots) {
        for (const key of slot.snapshots.keys()) if (JSON.parse(key)[0] === pickerId) slot.snapshots.set(key, {});
      }
    },
    close(timeoutMs = 10000) {
      if (closePromise) return closePromise;
      closed = true; clock.clearTimeout(maintenance); waiting.clear();
      for (const endpoint of endpoints) endpoint.stopped = true;
      endpoints.clear();
      // Shutdown cancels all calculator work. Do not queue a graceful IPC
      // request behind a warm calculation or wait for a residency lease.
      const exits = [...slots].map(slot => { slot.worker.unref?.(); return retire(slot, true); });
      closePromise = (async () => {
        let timer;
        try {
          await Promise.race([Promise.allSettled(exits), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
        } finally { clearTimeout(timer); ready = undefined; }
      })();
      return closePromise;
    } };
}
