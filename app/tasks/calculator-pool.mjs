import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

// One server owns the physical calculators. Lanes borrow a slot for one job;
// even a retiring calculator holds its slot until termination has completed.
export function createCalculatorPool({ limit, workerFactory, workerData, onReady, idleMs = 600000, startupDeadlineMs = 30000,
  sessions, clock = { now: () => performance.now(), setTimeout, clearTimeout }, memoryUsage = worker => {
    if (!worker.pid) return 0;
    try { return Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${worker.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; }
    catch { return 0; }
  } }) {
  const slots = new Set(), endpoints = new Set(), waiting = new Map(), turns = [];
  let ready, boot, closed = false, sequence = 0, peak = 0, pumping = false, evictions = 0, activityObserved = false;
  const bootAt = clock.now();
  const remainingSession = () => sessions?.remainingAny() ?? 0;
  const idleRemaining = slot => sessions
    ? activityObserved ? remainingSession() : idleMs - (clock.now() - bootAt)
    : idleMs - (clock.now() - slot.idleAt);
  const activity = slot => sessions?.lastActive(slot.pickerId) ?? -Infinity;
  const reservation = slot => sessions ? Math.max(sessions.estimatedBytes, memoryUsage(slot.worker)) : 0;
  const reserved = () => [...slots].reduce((sum, slot) => sum + reservation(slot), 0);
  const diagnostics = () => ({ limit, resident: slots.size, peak, active: [...slots].filter(slot => slot.owner).length,
    retiring: [...slots].filter(slot => slot.stopping).length, waiting: waiting.size, ...(sessions ? { memoryBytes: sessions.memoryBytes, reservedBytes: reserved(), evictions, residency: sessions.diagnostics() } : {}) });
  function retire(slot) {
    if (slot.stopping) return slot.stopping;
    clock.clearTimeout(slot.timer); clearTimeout(slot.startupTimer);
    slot.stopping = Promise.resolve().then(() => slot.worker.terminate()).then(() => {
      slots.delete(slot); pump();
    }, () => { /* An unproven exit still occupies the hard cap. */ });
    return slot.stopping;
  }
  function idle(slot) {
    clock.clearTimeout(slot.timer);
    slot.idleAt = clock.now();
    const check = () => {
      if (slot.owner || slot.stopping || closed) return;
      const remaining = Math.max(0, idleRemaining(slot));
      if (!sessions || remaining <= 0) void retire(slot);
      else { slot.timer = clock.setTimeout(check, Math.min(remaining, 2147483647)); slot.timer?.unref?.(); }
    };
    slot.timer = clock.setTimeout(check, Math.min(Math.max(0, idleRemaining(slot)), 2147483647));
    slot.timer?.unref?.();
  }
  function allocate(pendingOwner) {
    const slot = { worker: workerFactory(workerData(!ready, pendingOwner?.group)), ready: false, idleAt: clock.now(), pendingOwner, group: pendingOwner?.group, snapshots: new Map() };
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
      if (owner && !owner.stopped) owner.emit('error', error);
    }
    slot.startupTimer = setTimeout(() => fail(new Error('Calculator startup deadline exceeded.')), startupDeadlineMs);
    slot.worker.on('error', fail);
    slot.worker.on('exit', () => {
      if (slot.stopping) { slots.delete(slot); pump(); }
      else fail(new Error('Calculator exited.'));
    });
    slot.worker.on('message', message => {
      if (slot.stopping) return;
      if (message.type === 'ready') {
        if (ready?.datasetDigest !== undefined && message.datasetDigest !== ready.datasetDigest) { fail(new Error('Calculator dataset mismatch.')); return; }
        onReady?.(message);
        clearTimeout(slot.startupTimer); slot.pendingOwner = undefined; slot.ready = true;
        ready ??= message;
        slot.resolve(ready); idle(slot); pump(); return;
      }
      const owner = slot.owner;
      if (!owner || message.id !== slot.id || message.pickerId !== undefined && message.pickerId !== slot.pickerId) return;
      const complete = !['progress', 'prediction-prepared'].includes(message.type);
      const response = { ...message, id: slot.originalId };
      if (complete) { slot.owner = undefined; owner.slot = undefined; idle(slot); }
      if (complete) enforceMemory();
      owner.emit('message', response);
      if (complete) pump();
    });
    return slot;
  }
  function pump() {
    if (closed || pumping) return;
    pumping = true;
    try {
      while (waiting.size) {
        const candidates = [];
        for (const [endpoint, request] of waiting) {
          const next = request.peek();
          if (endpoint.stopped || !next) waiting.delete(endpoint);
          else candidates.push({ endpoint, request, ...next });
        }
        if (!candidates.length) break;
        const interactive = candidates.some(value => value.interactive);
        const eligible = candidates.filter(value => value.interactive === interactive);
        const ids = new Set(eligible.map(value => value.pickerId));
        for (let i = turns.length - 1; i >= 0; i--) if (!ids.has(turns[i])) turns.splice(i, 1);
        for (const id of ids) if (!turns.includes(id)) turns.push(id);
        const idleSlots = [...slots].filter(value => value.ready && !value.stopping && !value.owner);
        const usable = (slot, endpoint) => limit === 1 || slot.group === endpoint.group;
        // Advisory lanes share at most limit - 1 slots, including retiring
        // slots. Foreground can then wake even after its idle worker exits.
        const canAllocate = endpoint => slots.size < limit && (!sessions || reserved() + sessions.estimatedBytes <= sessions.memoryBytes)
          && (limit === 1 || endpoint.group === 'foreground'
            || [...slots].filter(value => value.group === 'advisory').length < limit - 1)
          && ![...slots].some(value => !value.ready && !value.stopping && usable(value, endpoint));
        const ordered = turns.flatMap(id => eligible.filter(value => value.pickerId === id));
        // A request awaiting its group's cold start cannot block another
        // picker's interactive request on an already-ready calculator.
        const selected = ordered.find(value => idleSlots.some(slot => usable(slot, value.endpoint)))
          ?? ordered.find(value => canAllocate(value.endpoint)) ?? ordered[0];
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
            // Another group's idle graph can make room; do not exceed either
            // cap while its process is still terminating.
            const oldest = idleSlots.sort((a, b) => (activity(a) - activity(b)) || a.idleAt - b.idleAt)[0];
            evictions++; void retire(oldest);
          } else if (interactive && !starting && ![...slots].some(value => value.stopping && usable(value, selected.endpoint))) {
            // Keep foreground free of advisory graphs. An unrequested producer
            // in the requested group yields instead of occupying its slot.
            for (const value of slots) if (usable(value, selected.endpoint) && value.owner?.yieldToInteractive?.()) break;
          }
          break;
        }
        const { endpoint, request } = selected;
        turns.splice(turns.indexOf(selected.pickerId), 1); turns.push(selected.pickerId);
        waiting.delete(endpoint); clock.clearTimeout(slot.timer);
        slot.owner = endpoint; slot.pickerId = selected.pickerId; endpoint.slot = slot;
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
        return ready ?? await ([...slots][0] ?? allocate(this)).initial;
      })().catch(error => { boot = undefined; throw error; });
      boot.then(value => { if (!this.stopped) this.emit('message', { ...value }); }, error => { if (!this.stopped) this.emit('error', error); });
    }
    get snapshotHints() { return this.slot?.snapshots; }
    schedule(peek, run, yieldToInteractive) {
      this.yieldToInteractive = yieldToInteractive; waiting.set(this, { peek, run }); pump();
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
  function enforceMemory() {
    if (closed || !sessions) return;
    // Already-retiring workers still count against admission, but their pending
    // exit must not cause another idle graph to be evicted on every sample.
    let bytes = [...slots].filter(slot => !slot.stopping).reduce((sum, slot) => sum + reservation(slot), 0);
    const oldest = [...slots].filter(slot => !slot.stopping)
      .sort((a, b) => (activity(a) - activity(b)) || a.idleAt - b.idleAt);
    for (const slot of oldest) {
      if (bytes <= sessions.memoryBytes) break;
      if (!slot.owner && slot.ready) { bytes -= reservation(slot); evictions++; void retire(slot); }
      else if (slot.owner?.yieldToInteractive?.()) { bytes -= reservation(slot); evictions++; }
    }
  }
  const memoryTimer = sessions ? clock.setTimeout(function check() {
    enforceMemory();
    if (!closed) { maintenance = clock.setTimeout(check, 1000); maintenance?.unref?.(); }
  }, 1000) : undefined;
  let maintenance = memoryTimer;
  maintenance?.unref?.();
  return { createEndpoint: includeReadyCatalogue => new Endpoint(includeReadyCatalogue), diagnostics,
    sessionChanged(pickerId) {
      if (closed) return;
      if (sessions && pickerId) activityObserved = true;
      for (const slot of slots) if (slot.ready && !slot.owner && !slot.stopping) {
        // Preserve the last completion time when extending a session lease.
        const at = slot.idleAt; idle(slot); slot.idleAt = at;
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
    async close() {
      closed = true; clock.clearTimeout(maintenance); waiting.clear();
      for (const endpoint of endpoints) endpoint.stopped = true;
      endpoints.clear(); await Promise.all([...slots].map(retire));
      ready = undefined;
    } };
}
