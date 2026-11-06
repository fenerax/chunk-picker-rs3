import assert from 'node:assert/strict';

// A checkpoint drains promise continuations; it makes no elapsed-time assumption.
export const checkpoint = () => new Promise(resolve => setImmediate(resolve));
export const profile = { nodes: [{ id: 1, callFrame: { functionName: 'synthetic' } }], startTime: 1, endTime: 2 };

export function manualClock() {
  let now = 1000, sequence = 0;
  const timers = new Map();
  const schedule = (callback, ms, interval) => {
    const timer = { id: ++sequence, at: now + ms, callback, interval, unref() {} };
    timers.set(timer.id, timer); return timer;
  };
  return {
    now: () => now,
    setTimeout: (callback, ms) => schedule(callback, ms),
    setInterval: (callback, ms) => schedule(callback, ms, ms),
    clearTimeout(timer) { if (timer) timers.delete(timer.id); },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.values()].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        now = next.at; timers.delete(next.id);
        if (next.interval) { next.at += next.interval; timers.set(next.id, next); }
        next.callback(); await checkpoint();
      }
      now = target; await checkpoint();
    },
    pending: () => [...timers.values()].filter(timer => !timer.interval).length,
  };
}

export function acknowledgement(name, value) {
  const entered = Promise.withResolvers(), reply = Promise.withResolvers();
  let calls = 0;
  return {
    name, entered: entered.promise,
    issue() { calls++; entered.resolve(); return reply.promise; },
    ack(result = value) { reply.resolve(result); },
    fail(error = new Error(`Synthetic ${name} failure.`)) { reply.reject(error); },
    get calls() { return calls; },
  };
}

export function profileControls() {
  const gates = Object.fromEntries([
    ['open', undefined], ['enable', {}], ['relay-start', {}], ['online', undefined],
    ['native-start', undefined], ['relay-stop', { profile }], ['native-stop', profile],
  ].map(([name, value]) => [name, acknowledgement(name, value)]));
  const calls = [];
  const session = {
    disconnect() { calls.push('disconnect'); },
    post(method, callback) {
      calls.push(method);
      const name = { 'Profiler.enable': 'enable', 'Profiler.start': 'relay-start', 'Profiler.stop': 'relay-stop' }[method];
      assert.ok(name, method);
      gates[name].issue().then(value => callback(null, value), error => callback(error));
    },
  };
  const handle = { stop() { calls.push('native-stop'); return gates['native-stop'].issue(); } };
  return {
    gates, calls, session, handle,
    openSession: () => gates.open.issue(),
    worker: { startCpuProfile() { calls.push('native-start'); return gates['native-start'].issue(); } },
    async ack(name) {
      gates[name].ack(name === 'open' ? session : name === 'native-start' ? handle : undefined);
      await checkpoint();
    },
    async admit() { for (const name of ['open', 'enable', 'relay-start', 'online', 'native-start']) await this.ack(name); },
    async cleanup() { for (const name of ['open', 'enable', 'relay-start', 'online', 'native-start', 'relay-stop', 'native-stop']) await this.ack(name); },
  };
}
