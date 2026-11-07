import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

// Advance scheduled application work without advancing HTTP or worker deadlines.
// Callbacks run in deadline order, including timers they install while advancing.
export function createManualClock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  const scheduled = new Set();
  const completions = [];
  return {
    now: () => time,
    setTimeout(callback, delay) {
      const timer = { at: time + delay, sequence: ++sequence, callback, unref() {} };
      timers.set(timer, timer);
      for (const waiter of [...scheduled]) if (waiter.delay === delay) {
        scheduled.delete(waiter); waiter.resolve(timer);
      }
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    async settleCallbacks() { await Promise.all(completions.splice(0)); },
    nextScheduled(delay) {
      return new Promise(resolve => scheduled.add({ delay, resolve }));
    },
    async settled(promise) {
      // Drain the acknowledgement's full microtask chain (including async
      // assert.rejects wrappers) before observing its settled state.
      await yieldToEventLoop();
      const pending = Symbol('pending');
      const result = await Promise.race([promise, Promise.resolve(pending)]);
      if (result === pending) throw new Error('Controlled work did not settle at its clock boundary.');
      return result;
    },
    async advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Clock advance must be finite and nonnegative.');
      const target = time + ms;
      await yieldToEventLoop();
      while (true) {
        const next = [...timers.values()].filter(timer => timer.at <= target)
          .sort((a, b) => a.at - b.at || a.sequence - b.sequence)[0];
        if (!next) break;
        time = next.at;
        timers.delete(next);
        completions.push(next.callback());
        await yieldToEventLoop();
      }
      time = target;
      await yieldToEventLoop();
    },
  };
}
