import { totalmem, freemem } from 'node:os';

const GiB = 1024 ** 3;
const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer.`);
  return value;
};
// Reserve room for the server, the OS and a calculator's transient allocations.
// Reservations include starting/retiring workers; RSS can only raise them.
export function residencyDefaults({ total = totalmem(), free = freemem(), constrained = process.constrainedMemory?.() || total,
  env = process.env } = {}) {
  const available = Math.min(total, constrained);
  const estimatedBytes = integer(Number(env.RS3_CALCULATOR_RESERVATION_BYTES ?? 2 * GiB), 'estimatedBytes');
  const memoryBytes = integer(Number(env.RS3_CALCULATOR_MEMORY_BYTES
    ?? Math.max(estimatedBytes, Math.floor(Math.min(available * 0.6, free - Math.min(2 * GiB, available * 0.25))))), 'memoryBytes');
  return { memoryBytes, estimatedBytes,
    maxResident: integer(Number(env.RS3_MAX_RESIDENT_CALCULATORS ?? Math.max(1, Math.min(4, Math.floor(memoryBytes / estimatedBytes)))), 'maxResident'),
    activeMs: integer(Number(env.RS3_SESSION_ACTIVE_MS ?? 30 * 60000), 'activeMs'),
    idleMs: integer(Number(env.RS3_SESSION_IDLE_MS ?? env.RS3_WORKER_IDLE_MS ?? 10 * 60000), 'idleMs') };
}

// Requests and writable SSE leases describe interest, not calculator ownership.
// Background completions never extend a session. No timer or save data is kept.
export function createSessionResidency(options = {}, clock = { now: () => performance.now() }) {
  const config = { ...residencyDefaults(), ...options };
  for (const key of ['memoryBytes', 'estimatedBytes', 'maxResident', 'activeMs', 'idleMs']) integer(config[key], key);
  if (config.memoryBytes < config.estimatedBytes) throw new TypeError('memoryBytes must cover one calculator reservation.');
  const sessions = new Map();
  const session = id => {
    if (!sessions.has(id)) sessions.set(id, { at: clock.now(), lastAt: clock.now(), streams: 0 });
    return sessions.get(id);
  };
  const remaining = entry => !entry ? 0 : entry.streams ? config.idleMs
    : Math.max(0, entry.at + config.activeMs + config.idleMs - clock.now());
  return { ...config,
    note(id) { const entry = session(id); entry.at = entry.lastAt = clock.now(); },
    open(id) {
      const entry = session(id); entry.at = entry.lastAt = clock.now(); entry.streams++;
      let released = false;
      return () => {
        if (released) return;
        released = true; entry.streams--;
        if (!entry.streams) {
          entry.at = clock.now() - config.activeMs;
          entry.lastAt = clock.now();
        }
      };
    },
    remaining(id) { return remaining(sessions.get(id)); },
    remainingAny() { return [...sessions.values()].reduce((maximum, entry) => Math.max(maximum, remaining(entry)), 0); },
    lastActive(id) { return sessions.get(id)?.lastAt ?? -Infinity; },
    diagnostics() { return { activeMs: config.activeMs, idleMs: config.idleMs,
      sessions: [...sessions.values()].filter(entry => remaining(entry) > 0).length,
      streams: [...sessions.values()].reduce((sum, entry) => sum + entry.streams, 0) }; },
    forget(id) { sessions.delete(id); },
    clear() { sessions.clear(); },
  };
}
