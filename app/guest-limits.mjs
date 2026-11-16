import { createHash, randomBytes } from 'node:crypto';
import { createRateLimits } from './security/request.mjs';

export const GUEST_LIMITS = Object.freeze({ sessionsPerIP: 2, sessionsGlobal: 8,
  admissionsPerIP: 4, admissionsGlobal: 16, requestsPerIP: 12, requestsGlobal: 30,
  lifetimeMs: 30 * 60000, deadlineMs: 30000, bodyBytes: 2 * 1024 ** 2 });
export const guestError = (status, message, retryAfter) => Object.assign(new Error(message), { status, retryAfter, guestPublic: true });
const busy = () => guestError(429, 'Guest mode is busy. Wait a minute and try again, or sign in.', 60);
const digest = token => createHash('sha256').update(token).digest('hex');

/** Admission metadata only. No gameplay or disk capability enters this owner. */
export function createGuestLimits({ now = Date.now, ...overrides } = {}) {
  const config = { ...GUEST_LIMITS, ...overrides };
  for (const value of Object.values(config)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid guest limit.');
  const rates = (perIP, global) => createRateLimits({ now, expensive: perIP, expensiveGlobal: global, maxClients: 1024 });
  const admissions = rates(config.admissionsPerIP, config.admissionsGlobal);
  const requests = rates(config.requestsPerIP, config.requestsGlobal);
  const sessions = new Map();
  let running = false, closed = false;
  function prune() { for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key); }
  function charge(limiter, ip) { try { limiter.expensive(ip); } catch { throw busy(); } }
  return {
    config,
    open(ip, previousToken) {
      if (closed) throw guestError(503, 'Guest mode is stopping. Try again shortly.', 60);
      prune();
      const previous = typeof previousToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(previousToken) && sessions.get(digest(previousToken));
      if (previous?.ip === ip) return { token: previousToken, expiresAt: previous.expiresAt };
      charge(admissions, ip);
      if (sessions.size >= config.sessionsGlobal || [...sessions.values()].filter(value => value.ip === ip).length >= config.sessionsPerIP) throw busy();
      const token = randomBytes(32).toString('base64url'), expiresAt = now() + config.lifetimeMs;
      sessions.set(digest(token), { ip, expiresAt });
      return { token, expiresAt };
    },
    acquire(token, ip) {
      if (closed) throw guestError(503, 'Guest mode is stopping. Try again shortly.', 60);
      prune();
      const session = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && sessions.get(digest(token));
      if (!session || session.ip !== ip) throw guestError(401, 'Guest access expired. Reload to resume your browser save.');
      if (running) throw busy();
      charge(requests, ip); running = true;
      let released = false;
      return { expiresAt: session.expiresAt, deadlineAt: Math.min(session.expiresAt, now() + config.deadlineMs),
        release() { if (!released) { released = true; running = false; } } };
    },
    close() { closed = true; sessions.clear(); },
  };
}
