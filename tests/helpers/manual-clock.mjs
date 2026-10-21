import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

// Advance scheduled application work without advancing HTTP or worker deadlines.
// Callbacks run in deadline order, including timers they install while advancing.
export function createManualClock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(callback, delay) {
      const timer = { at: time + delay, sequence: ++sequence, callback, unref() {} };
      timers.set(timer, timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
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
        next.callback();
        await yieldToEventLoop();
      }
      time = target;
      await yieldToEventLoop();
    },
  };
}
